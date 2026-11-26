import { Router } from 'express';
import { queryAll, queryOne, execute, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { postJournalEntry, reverseJournalEntry } from '../services/accounting.js';
import {
  getTrialBalance,
  getProfitAndLoss,
  getBalanceSheet,
  getAccountLedger,
  getStockValuationReport,
  getAgeingReport,
  getTaxSummaryReport,
} from '../services/reports.js';

export const accountingRouter = Router();

// Chart of Accounts
accountingRouter.get('/coa', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_VIEW), (req, res) => {
  res.json(
    queryAll('SELECT * FROM chart_of_accounts WHERE business_id = ? ORDER BY code ASC', [
      req.auth!.businessId,
    ])
  );
});

accountingRouter.post('/coa', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  const { code, name, accountType, subtype, openingBalance, openingSide } = req.body;
  if (!code || !name || !accountType) {
    res.status(400).json({ error: 'code, name, and accountType are required.' });
    return;
  }
  const dup = queryOne('SELECT id FROM chart_of_accounts WHERE business_id = ? AND code = ?', [
    req.auth!.businessId,
    code.trim(),
  ]);
  if (dup) {
    res.status(409).json({ error: 'Account code already exists.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO chart_of_accounts (
      id, business_id, code, name, account_type, subtype, is_system, is_active,
      opening_balance, opening_side, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      code.trim(),
      name.trim(),
      accountType,
      subtype || 'GENERAL',
      Number(openingBalance || 0),
      openingSide || (accountType === 'ASSET' || accountType === 'EXPENSE' ? 'DEBIT' : 'CREDIT'),
      now,
      now,
    ]
  );
  res.status(201).json(queryOne('SELECT * FROM chart_of_accounts WHERE id = ?', [id]));
});

accountingRouter.patch('/coa/:id', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  const acc = queryOne<any>('SELECT * FROM chart_of_accounts WHERE id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  if (!acc) { res.status(404).json({ error: 'Account not found' }); return; }
  const { name, isActive, openingBalance, openingSide } = req.body;
  execute(
    `UPDATE chart_of_accounts SET
       name = COALESCE(?, name),
       is_active = COALESCE(?, is_active),
       opening_balance = COALESCE(?, opening_balance),
       opening_side = COALESCE(?, opening_side),
       updated_at = ?
     WHERE id = ?`,
    [
      name ?? null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      openingBalance ?? null,
      openingSide ?? null,
      nowIso(),
      acc.id,
    ]
  );
  res.json(queryOne('SELECT * FROM chart_of_accounts WHERE id = ?', [acc.id]));
});

accountingRouter.delete('/coa/:id', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  const used = queryOne(
    `SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE jl.account_id = ? AND jl.business_id = ? AND je.status = 'Posted' LIMIT 1`,
    [req.params.id, req.auth!.businessId]
  );
  if (used) {
    res.status(409).json({
      error: 'Cannot delete an account that is used by posted accounting transactions. Deactivate it instead.',
    });
    return;
  }
  const acc = queryOne<any>('SELECT is_system FROM chart_of_accounts WHERE id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  if (acc?.is_system) {
    res.status(409).json({ error: 'System accounts cannot be deleted. Deactivate if unused.' });
    return;
  }
  execute('DELETE FROM chart_of_accounts WHERE id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  res.json({ ok: true });
});

// Account Mappings
accountingRouter.get('/mappings', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_VIEW), (req, res) => {
  res.json(
    queryAll(
      `SELECT am.*, coa.code AS account_code, coa.name AS account_name
       FROM account_mappings am JOIN chart_of_accounts coa ON coa.id = am.account_id
       WHERE am.business_id = ? ORDER BY am.mapping_key ASC`,
      [req.auth!.businessId]
    )
  );
});

accountingRouter.patch('/mappings', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  const { mappingKey, accountId } = req.body;
  if (!mappingKey || !accountId) {
    res.status(400).json({ error: 'mappingKey and accountId are required.' });
    return;
  }
  execute(
    'UPDATE account_mappings SET account_id = ?, updated_at = ? WHERE business_id = ? AND mapping_key = ?',
    [accountId, nowIso(), req.auth!.businessId, mappingKey]
  );
  res.json({ ok: true });
});

// Fiscal Periods
accountingRouter.get('/periods', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_VIEW), (req, res) => {
  res.json(
    queryAll('SELECT * FROM fiscal_periods WHERE business_id = ? ORDER BY start_date DESC', [
      req.auth!.businessId,
    ])
  );
});

accountingRouter.post('/periods/:id/close', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  execute('UPDATE fiscal_periods SET is_closed = 1, closed_at = ?, closed_by = ? WHERE id = ? AND business_id = ?', [
    nowIso(),
    req.auth!.userId,
    req.params.id,
    req.auth!.businessId,
  ]);
  res.json({ ok: true });
});

// Journal Entries
accountingRouter.get('/journals', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_VIEW), (req, res) => {
  const { sourceDocId, fromDate, toDate, entryType } = req.query;
  let sql = 'SELECT * FROM journal_entries WHERE business_id = ?';
  const params: unknown[] = [req.auth!.businessId];
  if (sourceDocId) { sql += ' AND source_doc_id = ?'; params.push(String(sourceDocId)); }
  if (entryType) { sql += ' AND entry_type = ?'; params.push(String(entryType)); }
  if (fromDate) { sql += ' AND entry_date >= ?'; params.push(String(fromDate)); }
  if (toDate) { sql += ' AND entry_date <= ?'; params.push(String(toDate)); }
  sql += ' ORDER BY entry_date DESC, created_at DESC LIMIT 200';

  const entries = queryAll<any>(sql, params);
  for (const e of entries) {
    e.lines = queryAll(
      `SELECT jl.*, coa.code AS account_code, coa.name AS account_name
       FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_entry_id = ?`,
      [e.id]
    );
  }
  res.json(entries);
});

accountingRouter.post('/journals', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  try {
    const result = postJournalEntry({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

accountingRouter.post('/journals/:id/reverse', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  try {
    const rev = reverseJournalEntry(
      req.auth!.businessId,
      String(req.params.id),
      String(req.body.reason || 'Manual reversal'),
      req.auth!.userId,
      req.auth!.deviceId
    );
    res.json(rev);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Financial & Accounting Reports
accountingRouter.get('/reports/trial-balance', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  res.json(getTrialBalance(req.auth!.businessId, req.query.asOfDate ? String(req.query.asOfDate) : undefined));
});

accountingRouter.get('/reports/profit-loss', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  res.json(
    getProfitAndLoss(
      req.auth!.businessId,
      req.query.fromDate ? String(req.query.fromDate) : undefined,
      req.query.toDate ? String(req.query.toDate) : undefined
    )
  );
});

accountingRouter.get('/reports/balance-sheet', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  res.json(getBalanceSheet(req.auth!.businessId, req.query.asOfDate ? String(req.query.asOfDate) : undefined));
});

accountingRouter.get('/reports/ledger/:accountId', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  try {
    res.json(
      getAccountLedger(
        req.auth!.businessId,
        String(req.params.accountId),
        req.query.fromDate ? String(req.query.fromDate) : undefined,
        req.query.toDate ? String(req.query.toDate) : undefined
      )
    );
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

accountingRouter.get('/reports/day-book', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const entries = queryAll<any>(
    `SELECT * FROM journal_entries WHERE business_id = ? AND entry_date = ? AND status = 'Posted' ORDER BY created_at ASC`,
    [req.auth!.businessId, date]
  );
  for (const e of entries) {
    e.lines = queryAll(
      `SELECT jl.*, coa.code AS account_code, coa.name AS account_name
       FROM journal_lines jl JOIN chart_of_accounts coa ON coa.id = jl.account_id
       WHERE jl.journal_entry_id = ?`,
      [e.id]
    );
  }
  res.json({ date, entries });
});

accountingRouter.get('/reports/cash-bank-book', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  const subtype = req.query.type === 'BANK' ? 'BANK' : 'CASH';
  const acc = queryOne<{ id: string }>(
    'SELECT id FROM chart_of_accounts WHERE business_id = ? AND subtype = ? AND is_active = 1 LIMIT 1',
    [req.auth!.businessId, subtype]
  );
  if (!acc) { res.json({ account: null, lines: [] }); return; }
  res.json(
    getAccountLedger(
      req.auth!.businessId,
      acc.id,
      req.query.fromDate ? String(req.query.fromDate) : undefined,
      req.query.toDate ? String(req.query.toDate) : undefined
    )
  );
});

accountingRouter.get('/reports/ageing', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  const type = req.query.type === 'AP' ? 'AP' : 'AR';
  res.json(getAgeingReport(req.auth!.businessId, type));
});

accountingRouter.get('/reports/tax-summary', requireAuth, requirePermission(PERMISSIONS.REPORTS_FINANCIAL_VIEW), (req, res) => {
  res.json(
    getTaxSummaryReport(
      req.auth!.businessId,
      req.query.fromDate ? String(req.query.fromDate) : undefined,
      req.query.toDate ? String(req.query.toDate) : undefined
    )
  );
});

accountingRouter.get('/reports/stock-valuation', requireAuth, requirePermission(PERMISSIONS.REPORTS_STOCK_VIEW), (req, res) => {
  res.json(getStockValuationReport(req.auth!.businessId));
});
