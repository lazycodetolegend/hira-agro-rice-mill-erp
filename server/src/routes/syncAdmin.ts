import { Router } from 'express';
import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { requireAuth, requirePermission, hasPermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { processSyncPush, resolveSyncConflict, getSyncSnapshot } from '../services/sync.js';
import { getStockValuationReport, getAccountLedger } from '../services/reports.js';
import { clearDemoTransactions, seedInitialDemoBusiness } from '../db/seed.js';
import { recordAudit } from '../middleware/audit.js';

export const syncAdminRouter = Router();

// Dashboard (role-aware)
syncAdminRouter.get('/dashboard', requireAuth, (req, res) => {
  const biz = req.auth!.businessId;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';

  const receivedToday = queryOne<{ qty: number }>(
    `SELECT COALESCE(SUM(received_qty_kg), 0) AS qty FROM inbound_lots
     WHERE business_id = ? AND substr(created_at, 1, 10) = ? AND status != 'Cancelled'`,
    [biz, today]
  );

  const sealedToday = queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT bag_id) AS cnt FROM bag_events
     WHERE business_id = ? AND new_status = 'Sealed' AND substr(occurred_at, 1, 10) = ?`,
    [biz, today]
  );

  const bagCounts = queryOne<{ available: number; unsealed: number; total: number }>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN current_status IN ('Sealed', 'In Stock') THEN 1 ELSE 0 END), 0) AS available,
       COALESCE(SUM(CASE WHEN current_status IN ('Generated', 'Printed', 'Applied', 'Filled', 'Weighed', 'Scanned') THEN 1 ELSE 0 END), 0) AS unsealed
     FROM bags WHERE business_id = ?`,
    [biz]
  );

  const pendingLots = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM inbound_lots
     WHERE business_id = ? AND status IN ('Draft', 'Received', 'In Processing', 'Partially Bagged')`,
    [biz]
  );

  const stockVal = getStockValuationReport(biz);
  const lowStockAlerts = stockVal.items.filter((i) => i.is_low_stock);

  const pendingConflicts = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM sync_conflicts WHERE business_id = ? AND resolution_status = 'PENDING'`,
    [biz]
  );

  const recentActivity = queryAll(
    `SELECT al.*, u.full_name AS user_name
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.business_id = ?
     ORDER BY al.created_at DESC LIMIT 12`,
    [biz]
  );

  const result: any = {
    today_received_kg: Number((receivedToday?.qty || 0).toFixed(2)),
    today_sealed_bags: sealedToday?.cnt || 0,
    available_bag_count: bagCounts?.available || 0,
    unsealed_bag_count: bagCounts?.unsealed || 0,
    total_bag_count: bagCounts?.total || 0,
    pending_truck_lots: pendingLots?.cnt || 0,
    current_stock_kg: stockVal.total_qty_kg,
    current_stock_value: hasPermission(req.auth!, PERMISSIONS.REPORTS_FINANCIAL_VIEW) || hasPermission(req.auth!, PERMISSIONS.BAGS_COST_VIEW)
      ? stockVal.total_value
      : null,
    low_stock_alerts: lowStockAlerts,
    pending_conflicts: pendingConflicts?.cnt || 0,
    recent_activity: recentActivity,
  };

  if (
    hasPermission(req.auth!, PERMISSIONS.REPORTS_FINANCIAL_VIEW) ||
    hasPermission(req.auth!, PERMISSIONS.SALES_VIEW) ||
    hasPermission(req.auth!, PERMISSIONS.PURCHASES_VIEW)
  ) {
    const salesToday = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' AND doc_date = ?`,
      [biz, today]
    );
    const salesMonth = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' AND doc_date >= ?`,
      [biz, monthStart]
    );
    const purchasesToday = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM purchase_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' AND doc_date = ?`,
      [biz, today]
    );
    const purchasesMonth = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM purchase_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' AND doc_date >= ?`,
      [biz, monthStart]
    );
    const expensesMonth = queryOne<{ total: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM expenses
       WHERE business_id = ? AND voucher_type = 'EXPENSE' AND status = 'Posted' AND voucher_date >= ?`,
      [biz, monthStart]
    );
    const receivables = queryOne<{ bal: number }>(
      `SELECT COALESCE(SUM(total_amount - received_amount), 0) AS bal FROM sales_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted'`,
      [biz]
    );
    const payables = queryOne<{ bal: number }>(
      `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS bal FROM purchase_documents
       WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted'`,
      [biz]
    );

    const cashAcc = queryOne<{ id: string }>(
      `SELECT id FROM chart_of_accounts WHERE business_id = ? AND subtype = 'CASH' LIMIT 1`,
      [biz]
    );
    const bankAcc = queryOne<{ id: string }>(
      `SELECT id FROM chart_of_accounts WHERE business_id = ? AND subtype = 'BANK' LIMIT 1`,
      [biz]
    );
    const cashBal = cashAcc ? getAccountLedger(biz, cashAcc.id) : null;
    const bankBal = bankAcc ? getAccountLedger(biz, bankAcc.id) : null;

    result.financial = {
      sales_today: Number((salesToday?.total || 0).toFixed(2)),
      sales_month: Number((salesMonth?.total || 0).toFixed(2)),
      purchases_today: Number((purchasesToday?.total || 0).toFixed(2)),
      purchases_month: Number((purchasesMonth?.total || 0).toFixed(2)),
      expenses_month: Number((expensesMonth?.total || 0).toFixed(2)),
      receivables: Number((receivables?.bal || 0).toFixed(2)),
      payables: Number((payables?.bal || 0).toFixed(2)),
      cash_balance: cashBal ? (cashBal.closing_side === 'Dr' ? cashBal.closing_balance : -cashBal.closing_balance) : 0,
      bank_balance: bankBal ? (bankBal.closing_side === 'Dr' ? bankBal.closing_balance : -bankBal.closing_balance) : 0,
    };
  }

  res.json(result);
});

// Offline Sync
syncAdminRouter.post('/sync/push', requireAuth, (req, res) => {
  const ops = Array.isArray(req.body?.operations) ? req.body.operations : [];
  res.json(processSyncPush(ops, req.auth!));
});

syncAdminRouter.get('/sync/pull', requireAuth, (req, res) => {
  res.json(getSyncSnapshot(req.auth!.businessId));
});

syncAdminRouter.get('/sync/conflicts', requireAuth, (req, res) => {
  const rows = queryAll(
    `SELECT sc.*, u.full_name AS user_name
     FROM sync_conflicts sc LEFT JOIN users u ON u.id = sc.user_id
     WHERE sc.business_id = ?
     ORDER BY CASE WHEN sc.resolution_status = 'PENDING' THEN 0 ELSE 1 END, sc.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

syncAdminRouter.post('/sync/conflicts/:id/resolve', requireAuth, requirePermission(PERMISSIONS.SYNC_RESOLVE), (req, res) => {
  try {
    const { decision, note } = req.body;
    res.json(resolveSyncConflict(req.auth!.businessId, String(req.params.id), decision, note || '', req.auth!));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Audit Logs
syncAdminRouter.get('/admin/audit-logs', requireAuth, requirePermission(PERMISSIONS.AUDIT_VIEW), (req, res) => {
  const { entityType, userId } = req.query;
  let sql = `
    SELECT al.*, u.full_name AS user_name, u.username, d.device_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    LEFT JOIN devices d ON d.id = al.device_id
    WHERE al.business_id = ?
  `;
  const params: unknown[] = [req.auth!.businessId];
  if (entityType) { sql += ' AND al.entity_type = ?'; params.push(String(entityType)); }
  if (userId) { sql += ' AND al.user_id = ?'; params.push(String(userId)); }
  sql += ' ORDER BY al.created_at DESC LIMIT 300';
  res.json(queryAll(sql, params));
});

// Custom Fields
syncAdminRouter.get('/admin/custom-fields', requireAuth, (req, res) => {
  res.json(
    queryAll('SELECT * FROM custom_field_definitions WHERE business_id = ? AND is_active = 1 ORDER BY entity_type, label', [
      req.auth!.businessId,
    ])
  );
});

syncAdminRouter.post('/admin/custom-fields', requireAuth, requirePermission(PERMISSIONS.CUSTOM_FIELDS_MANAGE), (req, res) => {
  const { entityType, fieldKey, label, fieldType, options, isRequired, isSensitive } = req.body;
  if (!entityType || !fieldKey || !label || !fieldType) {
    res.status(400).json({ error: 'entityType, fieldKey, label, and fieldType are required.' });
    return;
  }
  const id = newId();
  execute(
    `INSERT INTO custom_field_definitions (
      id, business_id, entity_type, field_key, label, field_type, options_json, is_required, is_sensitive, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      req.auth!.businessId,
      entityType,
      String(fieldKey).toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      label,
      fieldType,
      JSON.stringify(options || []),
      isRequired ? 1 : 0,
      isSensitive ? 1 : 0,
      nowIso(),
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM custom_field_definitions WHERE id = ?', [id]));
});

syncAdminRouter.get('/custom-field-values/:entityType/:entityId', requireAuth, (req, res) => {
  res.json(
    queryAll(
      `SELECT cfv.*, cfd.field_key, cfd.label, cfd.field_type
       FROM custom_field_values cfv
       JOIN custom_field_definitions cfd ON cfd.id = cfv.definition_id
       WHERE cfv.business_id = ? AND cfv.entity_type = ? AND cfv.entity_id = ?`,
      [req.auth!.businessId, req.params.entityType, req.params.entityId]
    )
  );
});

syncAdminRouter.post('/custom-field-values', requireAuth, (req, res) => {
  const { entityType, entityId, values } = req.body;
  if (!entityType || !entityId || !values) {
    res.status(400).json({ error: 'entityType, entityId, and values are required.' });
    return;
  }
  const now = nowIso();
  for (const [definitionId, val] of Object.entries(values)) {
    execute(
      `INSERT INTO custom_field_values (id, business_id, definition_id, entity_type, entity_id, value_text, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(definition_id, entity_id) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at`,
      [newId(), req.auth!.businessId, definitionId, entityType, entityId, String(val ?? ''), now]
    );
  }
  res.json({ ok: true });
});

// Attachments
syncAdminRouter.get('/attachments/:entityType/:entityId', requireAuth, (req, res) => {
  res.json(
    queryAll(
      'SELECT id, file_name, mime_type, size_bytes, created_at FROM attachments WHERE business_id = ? AND entity_type = ? AND entity_id = ?',
      [req.auth!.businessId, req.params.entityType, req.params.entityId]
    )
  );
});

syncAdminRouter.post('/attachments', requireAuth, (req, res) => {
  const { entityType, entityId, fileName, mimeType, dataBase64 } = req.body;
  if (!entityType || !entityId || !fileName || !dataBase64) {
    res.status(400).json({ error: 'Attachment metadata and dataBase64 are required.' });
    return;
  }
  const id = newId();
  execute(
    `INSERT INTO attachments (id, business_id, entity_type, entity_id, file_name, mime_type, size_bytes, data_base64, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      entityType,
      entityId,
      fileName,
      mimeType || 'application/octet-stream',
      Buffer.byteLength(dataBase64, 'base64'),
      dataBase64,
      nowIso(),
      req.auth!.userId,
    ]
  );
  res.status(201).json({ id, fileName });
});

// Backup Export & Demo Reset
syncAdminRouter.get('/admin/backup', requireAuth, requirePermission(PERMISSIONS.BACKUP_MANAGE), (req, res) => {
  const biz = req.auth!.businessId;
  const tables = [
    'businesses', 'roles', 'users', 'warehouses', 'warehouse_locations',
    'suppliers', 'customers', 'units', 'product_varieties', 'product_grades',
    'packaging_types', 'products', 'tax_settings', 'trucks', 'inbound_lots',
    'production_batches', 'production_inputs', 'production_outputs',
    'qr_tokens', 'bags', 'bag_events', 'print_jobs', 'inventory_movements',
    'purchase_documents', 'purchase_lines', 'sales_documents', 'sales_lines',
    'expenses', 'payments_receipts', 'chart_of_accounts', 'account_mappings',
    'fiscal_periods', 'journal_entries', 'journal_lines', 'custom_field_definitions',
    'custom_field_values', 'audit_logs',
  ];
  const backup: Record<string, any> = {
    exportedAt: nowIso(),
    businessId: biz,
    version: '1.0.0',
    tables: {},
  };
  for (const t of tables) {
    const col = t === 'businesses' ? 'id' : 'business_id';
    backup.tables[t] = queryAll(`SELECT * FROM ${t} WHERE ${col} = ?`, [biz]);
  }
  recordAudit({
    businessId: biz,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'BACKUP_EXPORTED',
    entityType: 'business',
    entityId: biz,
    summary: 'Exported full JSON business backup',
  });
  res.json(backup);
});

syncAdminRouter.post('/admin/demo/clear', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  clearDemoTransactions(req.auth!.businessId);
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'DEMO_DATA_CLEARED',
    entityType: 'business',
    entityId: req.auth!.businessId,
    summary: 'Cleared all demo transactions to switch to live production',
  });
  res.json({ ok: true });
});

syncAdminRouter.post('/admin/demo/reset', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  withTransaction(() => {
    clearDemoTransactions(req.auth!.businessId);
  });
  seedInitialDemoBusiness();
  res.json({ ok: true });
});
