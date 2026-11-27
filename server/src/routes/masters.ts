import { Router } from 'express';
import { queryAll, queryOne, execute, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { recordAudit } from '../middleware/audit.js';
import { sanitizeBusiness } from './auth.js';

export const mastersRouter = Router();

// Business Profile & Settings
mastersRouter.get('/business', requireAuth, (req, res) => {
  const biz = queryOne('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
  res.json(sanitizeBusiness(biz));
});

mastersRouter.patch('/business', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  const b = req.body || {};
  const now = nowIso();
  execute(
    `UPDATE businesses SET
       name = COALESCE(?, name),
       legal_name = COALESCE(?, legal_name),
       address = COALESCE(?, address),
       phone = COALESCE(?, phone),
       email = COALESCE(?, email),
       gstin = COALESCE(?, gstin),
       pan = COALESCE(?, pan),
       currency = COALESCE(?, currency),
       fiscal_year_start_month = COALESCE(?, fiscal_year_start_month),
       fiscal_year_start_day = COALESCE(?, fiscal_year_start_day),
       date_format = COALESCE(?, date_format),
       number_format = COALESCE(?, number_format),
       valuation_method = COALESCE(?, valuation_method),
       default_weight_unit = COALESCE(?, default_weight_unit),
       bag_prefix = COALESCE(?, bag_prefix),
       receiving_prefix = COALESCE(?, receiving_prefix),
       lot_prefix = COALESCE(?, lot_prefix),
       batch_prefix = COALESCE(?, batch_prefix),
       purchase_prefix = COALESCE(?, purchase_prefix),
       sales_prefix = COALESCE(?, sales_prefix),
       receipt_prefix = COALESCE(?, receipt_prefix),
       payment_prefix = COALESCE(?, payment_prefix),
       expense_prefix = COALESCE(?, expense_prefix),
       journal_prefix = COALESCE(?, journal_prefix),
       label_layout_json = COALESCE(?, label_layout_json),
       approval_thresholds_json = COALESCE(?, approval_thresholds_json),
       offline_sync_settings_json = COALESCE(?, offline_sync_settings_json),
       tax_disclaimer_acknowledged = COALESCE(?, tax_disclaimer_acknowledged),
       google_client_id = COALESCE(?, google_client_id),
       require_2fa_all = COALESCE(?, require_2fa_all),
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
    [
      b.name ?? null,
      b.legal_name ?? null,
      b.address ?? null,
      b.phone ?? null,
      b.email ?? null,
      b.gstin ?? null,
      b.pan ?? null,
      b.currency ?? null,
      b.fiscal_year_start_month ?? null,
      b.fiscal_year_start_day ?? null,
      b.date_format ?? null,
      b.number_format ?? null,
      b.valuation_method ?? null,
      b.default_weight_unit ?? null,
      b.bag_prefix ?? null,
      b.receiving_prefix ?? null,
      b.lot_prefix ?? null,
      b.batch_prefix ?? null,
      b.purchase_prefix ?? null,
      b.sales_prefix ?? null,
      b.receipt_prefix ?? null,
      b.payment_prefix ?? null,
      b.expense_prefix ?? null,
      b.journal_prefix ?? null,
      b.label_layout ? JSON.stringify(b.label_layout) : b.label_layout_json ?? null,
      b.approval_thresholds ? JSON.stringify(b.approval_thresholds) : null,
      b.offline_sync_settings ? JSON.stringify(b.offline_sync_settings) : null,
      b.tax_disclaimer_acknowledged !== undefined ? (b.tax_disclaimer_acknowledged ? 1 : 0) : null,
      b.google_client_id !== undefined ? (String(b.google_client_id).trim() || null) : null,
      b.require_2fa_all !== undefined ? (b.require_2fa_all ? 1 : 0) : null,
      now,
      req.auth!.userId,
      req.auth!.businessId,
    ]
  );

  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'BUSINESS_SETTINGS_UPDATED',
    entityType: 'business',
    entityId: req.auth!.businessId,
    summary: 'Updated business profile/configuration',
  });

  res.json(sanitizeBusiness(queryOne('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId])));
});

// Suppliers
mastersRouter.get('/masters/suppliers', requireAuth, (req, res) => {
  res.json(
    queryAll('SELECT * FROM suppliers WHERE business_id = ? ORDER BY name ASC', [req.auth!.businessId])
  );
});

mastersRouter.post('/masters/suppliers', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { code, name, phone, address, gstin, paymentTerms, openingBalance } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Supplier name is required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  const sCode = code || `SUP-${Math.floor(1000 + Math.random() * 9000)}`;
  execute(
    `INSERT INTO suppliers (id, business_id, code, name, phone, address, gstin, payment_terms, opening_balance, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      sCode,
      name.trim(),
      phone ?? null,
      address ?? null,
      gstin ?? null,
      paymentTerms ?? null,
      Number(openingBalance || 0),
      now,
      now,
      req.auth!.userId,
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM suppliers WHERE id = ?', [id]));
});

// Customers
mastersRouter.get('/masters/customers', requireAuth, (req, res) => {
  res.json(
    queryAll('SELECT * FROM customers WHERE business_id = ? ORDER BY name ASC', [req.auth!.businessId])
  );
});

mastersRouter.post('/masters/customers', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { code, name, phone, address, gstin, paymentTerms, creditLimit, openingBalance } = req.body;
  if (!name) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  const cCode = code || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
  execute(
    `INSERT INTO customers (id, business_id, code, name, phone, address, gstin, payment_terms, credit_limit, opening_balance, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      cCode,
      name.trim(),
      phone ?? null,
      address ?? null,
      gstin ?? null,
      paymentTerms ?? null,
      Number(creditLimit || 0),
      Number(openingBalance || 0),
      now,
      now,
      req.auth!.userId,
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM customers WHERE id = ?', [id]));
});

// Products, Varieties, Grades, Packaging, Units, Taxes
mastersRouter.get('/masters/catalog', requireAuth, (req, res) => {
  const biz = req.auth!.businessId;
  res.json({
    products: queryAll(
      `SELECT p.*, v.name AS variety_name, g.name AS grade_name, pk.name AS packaging_name
       FROM products p
       LEFT JOIN product_varieties v ON v.id = p.variety_id
       LEFT JOIN product_grades g ON g.id = p.grade_id
       LEFT JOIN packaging_types pk ON pk.id = p.default_packaging_id
       WHERE p.business_id = ? ORDER BY p.name ASC`,
      [biz]
    ),
    varieties: queryAll('SELECT * FROM product_varieties WHERE business_id = ? ORDER BY name ASC', [biz]),
    grades: queryAll('SELECT * FROM product_grades WHERE business_id = ? ORDER BY name ASC', [biz]),
    packagingTypes: queryAll('SELECT * FROM packaging_types WHERE business_id = ? ORDER BY name ASC', [biz]),
    units: queryAll('SELECT * FROM units WHERE business_id = ? ORDER BY kg_factor ASC', [biz]),
    taxes: queryAll('SELECT * FROM tax_settings WHERE business_id = ? ORDER BY rate_percent ASC', [biz]),
    warehouses: queryAll('SELECT * FROM warehouses WHERE business_id = ? ORDER BY name ASC', [biz]),
    locations: queryAll('SELECT * FROM warehouse_locations WHERE business_id = ? ORDER BY code ASC', [biz]),
  });
});

mastersRouter.post('/masters/products', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { sku, name, materialType, varietyId, gradeId, defaultPackagingId, defaultUnit, lowStockThresholdKg, defaultSaleRatePerKg, defaultTaxId, hsnCode } = req.body;
  if (!name || !materialType) {
    res.status(400).json({ error: 'Product name and materialType are required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  const pSku = sku || `PRD-${Math.floor(1000 + Math.random() * 9000)}`;
  execute(
    `INSERT INTO products (
      id, business_id, sku, name, material_type, variety_id, grade_id, default_packaging_id,
      default_unit, low_stock_threshold_kg, default_sale_rate_per_kg, default_tax_id, hsn_code,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      pSku,
      name.trim(),
      materialType,
      varietyId ?? null,
      gradeId ?? null,
      defaultPackagingId ?? null,
      defaultUnit || 'kg',
      Number(lowStockThresholdKg || 500),
      Number(defaultSaleRatePerKg || 0),
      defaultTaxId ?? null,
      hsnCode ?? null,
      now,
      now,
      req.auth!.userId,
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM products WHERE id = ?', [id]));
});

mastersRouter.post('/masters/varieties', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  const id = newId();
  const now = nowIso();
  execute('INSERT INTO product_varieties (id, business_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, req.auth!.businessId, name.trim(), description ?? null, now, now,
  ]);
  res.status(201).json(queryOne('SELECT * FROM product_varieties WHERE id = ?', [id]));
});

mastersRouter.post('/masters/grades', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: 'Name required' }); return; }
  const id = newId();
  const now = nowIso();
  execute('INSERT INTO product_grades (id, business_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, req.auth!.businessId, name.trim(), description ?? null, now, now,
  ]);
  res.status(201).json(queryOne('SELECT * FROM product_grades WHERE id = ?', [id]));
});

mastersRouter.post('/masters/warehouses', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { code, name, address } = req.body;
  if (!name) { res.status(400).json({ error: 'Warehouse name required' }); return; }
  const id = newId();
  const now = nowIso();
  execute('INSERT INTO warehouses (id, business_id, code, name, address, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    id, req.auth!.businessId, code || `WH-${Math.floor(100 + Math.random() * 900)}`, name.trim(), address ?? null, now, now, req.auth!.userId,
  ]);
  res.status(201).json(queryOne('SELECT * FROM warehouses WHERE id = ?', [id]));
});

mastersRouter.post('/masters/locations', requireAuth, requirePermission(PERMISSIONS.MASTERS_EDIT), (req, res) => {
  const { warehouseId, code, name } = req.body;
  if (!warehouseId || !name || !code) { res.status(400).json({ error: 'warehouseId, code, and name required' }); return; }
  const id = newId();
  const now = nowIso();
  execute('INSERT INTO warehouse_locations (id, business_id, warehouse_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    id, req.auth!.businessId, warehouseId, code.trim(), name.trim(), now, now,
  ]);
  res.status(201).json(queryOne('SELECT * FROM warehouse_locations WHERE id = ?', [id]));
});

mastersRouter.post('/masters/units', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  const { code, name, kgFactor } = req.body;
  if (!code || !name || !kgFactor || Number(kgFactor) <= 0) {
    res.status(400).json({ error: 'Valid code, name, and positive kgFactor required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO units (id, business_id, code, name, kg_factor, is_base, is_configurable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
     ON CONFLICT(business_id, code) DO UPDATE SET name = excluded.name, kg_factor = excluded.kg_factor, updated_at = excluded.updated_at`,
    [id, req.auth!.businessId, code.trim().toLowerCase(), name.trim(), Number(kgFactor), now, now]
  );
  res.status(201).json(queryOne('SELECT * FROM units WHERE business_id = ? AND code = ?', [req.auth!.businessId, code.trim().toLowerCase()]));
});

mastersRouter.post('/masters/taxes', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  const { name, code, ratePercent, cgstPercent, sgstPercent, igstPercent, notes } = req.body;
  if (!name || !code || ratePercent === undefined) {
    res.status(400).json({ error: 'Tax name, code, and ratePercent are required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO tax_settings (id, business_id, name, code, rate_percent, cgst_percent, sgst_percent, igst_percent, is_active, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      name.trim(),
      code.trim().toUpperCase(),
      Number(ratePercent),
      Number(cgstPercent ?? Number(ratePercent) / 2),
      Number(sgstPercent ?? Number(ratePercent) / 2),
      Number(igstPercent ?? ratePercent),
      notes ?? null,
      now,
      now,
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM tax_settings WHERE id = ?', [id]));
});

// Global Search
mastersRouter.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ bags: [], lots: [], batches: [], suppliers: [], customers: [], purchases: [], sales: [], payments: [], products: [] });
    return;
  }
  const like = `%${q}%`;
  const biz = req.auth!.businessId;

  res.json({
    bags: queryAll(
      `SELECT b.id, b.bag_number, b.current_status, b.net_weight_kg, p.name AS product_name
       FROM bags b JOIN products p ON p.id = b.product_id
       WHERE b.business_id = ? AND (b.bag_number LIKE ? OR b.qr_token = ? OR b.batch_lot_ref LIKE ?) LIMIT 15`,
      [biz, like, q, like]
    ),
    lots: queryAll(
      `SELECT l.id, l.lot_number, l.status, l.received_qty_kg, t.truck_number, t.receiving_number
       FROM inbound_lots l JOIN trucks t ON t.id = l.truck_id
       WHERE l.business_id = ? AND (l.lot_number LIKE ? OR t.truck_number LIKE ? OR t.receiving_number LIKE ?) LIMIT 15`,
      [biz, like, like, like]
    ),
    batches: queryAll(
      `SELECT id, batch_number, status, total_input_kg, finished_rice_kg FROM production_batches WHERE business_id = ? AND batch_number LIKE ? LIMIT 10`,
      [biz, like]
    ),
    suppliers: queryAll(
      `SELECT id, code, name, phone FROM suppliers WHERE business_id = ? AND (name LIKE ? OR code LIKE ? OR phone LIKE ?) LIMIT 10`,
      [biz, like, like, like]
    ),
    customers: queryAll(
      `SELECT id, code, name, phone FROM customers WHERE business_id = ? AND (name LIKE ? OR code LIKE ? OR phone LIKE ?) LIMIT 10`,
      [biz, like, like, like]
    ),
    purchases: queryAll(
      `SELECT id, doc_number, doc_date, total_amount, status FROM purchase_documents WHERE business_id = ? AND doc_number LIKE ? LIMIT 10`,
      [biz, like]
    ),
    sales: queryAll(
      `SELECT id, doc_number, doc_date, total_amount, status FROM sales_documents WHERE business_id = ? AND doc_number LIKE ? LIMIT 10`,
      [biz, like]
    ),
    payments: queryAll(
      `SELECT id, voucher_number, voucher_type, amount, reference_no FROM payments_receipts WHERE business_id = ? AND (voucher_number LIKE ? OR reference_no LIKE ?) LIMIT 10`,
      [biz, like, like]
    ),
    products: queryAll(
      `SELECT id, sku, name, material_type FROM products WHERE business_id = ? AND (name LIKE ? OR sku LIKE ?) LIMIT 10`,
      [biz, like, like]
    ),
  });
});
