import { Router } from 'express';
import { queryAll, queryOne } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import {
  createPurchaseDocument,
  postPurchaseDocument,
  reversePurchaseDocument,
  getPurchaseDocument,
  createSalesDocument,
  postSalesDocument,
  reverseSalesDocument,
  getSalesDocument,
  createExpenseOrIncome,
  createPaymentOrReceipt,
} from '../services/commercial.js';

export const commercialRouter = Router();

// Purchases
commercialRouter.get('/purchases', requireAuth, requirePermission(PERMISSIONS.PURCHASES_VIEW), (req, res) => {
  const rows = queryAll(
    `SELECT pd.*, s.name AS supplier_name, l.lot_number
     FROM purchase_documents pd
     JOIN suppliers s ON s.id = pd.supplier_id
     LEFT JOIN inbound_lots l ON l.id = pd.lot_id
     WHERE pd.business_id = ?
     ORDER BY pd.doc_date DESC, pd.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

commercialRouter.get('/purchases/:id', requireAuth, requirePermission(PERMISSIONS.PURCHASES_VIEW), (req, res) => {
  const doc = getPurchaseDocument(req.auth!.businessId, String(req.params.id));
  if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(doc);
});

commercialRouter.post('/purchases', requireAuth, requirePermission(PERMISSIONS.PURCHASES_MANAGE), (req, res) => {
  try {
    const doc = createPurchaseDocument({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(doc);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

commercialRouter.post('/purchases/:id/post', requireAuth, requirePermission(PERMISSIONS.PURCHASES_MANAGE), (req, res) => {
  try {
    res.json(postPurchaseDocument(req.auth!.businessId, String(req.params.id), req.auth!.userId, req.auth!.deviceId));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

commercialRouter.post('/purchases/:id/reverse', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  try {
    res.json(
      reversePurchaseDocument(
        req.auth!.businessId,
        String(req.params.id),
        String(req.body.reason || ''),
        req.auth!.userId,
        req.auth!.deviceId
      )
    );
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Sales
commercialRouter.get('/sales', requireAuth, requirePermission(PERMISSIONS.SALES_VIEW), (req, res) => {
  const rows = queryAll(
    `SELECT sd.*, c.name AS customer_name
     FROM sales_documents sd
     JOIN customers c ON c.id = sd.customer_id
     WHERE sd.business_id = ?
     ORDER BY sd.doc_date DESC, sd.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

commercialRouter.get('/sales/:id', requireAuth, requirePermission(PERMISSIONS.SALES_VIEW), (req, res) => {
  const doc = getSalesDocument(req.auth!.businessId, String(req.params.id));
  if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(doc);
});

commercialRouter.post('/sales', requireAuth, requirePermission(PERMISSIONS.SALES_MANAGE), (req, res) => {
  try {
    const doc = createSalesDocument({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(doc);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

commercialRouter.post('/sales/:id/post', requireAuth, requirePermission(PERMISSIONS.SALES_MANAGE), (req, res) => {
  try {
    res.json(postSalesDocument(req.auth!.businessId, String(req.params.id), req.auth!.userId, req.auth!.deviceId));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

commercialRouter.post('/sales/:id/reverse', requireAuth, requirePermission(PERMISSIONS.ACCOUNTING_POST), (req, res) => {
  try {
    res.json(
      reverseSalesDocument(
        req.auth!.businessId,
        String(req.params.id),
        String(req.body.reason || ''),
        req.auth!.userId,
        req.auth!.deviceId
      )
    );
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Expenses & Other Income
commercialRouter.get('/expenses', requireAuth, requirePermission(PERMISSIONS.EXPENSES_VIEW), (req, res) => {
  const rows = queryAll(
    `SELECT e.*, coa.name AS account_name, pa.name AS payment_account_name
     FROM expenses e
     JOIN chart_of_accounts coa ON coa.id = e.account_id
     LEFT JOIN chart_of_accounts pa ON pa.id = e.payment_account_id
     WHERE e.business_id = ?
     ORDER BY e.voucher_date DESC, e.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

commercialRouter.post('/expenses', requireAuth, requirePermission(PERMISSIONS.EXPENSES_MANAGE), (req, res) => {
  try {
    const doc = createExpenseOrIncome({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(doc);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Payments, Receipts & Contra
commercialRouter.get('/payments', requireAuth, requirePermission(PERMISSIONS.PAYMENTS_VIEW), (req, res) => {
  const rows = queryAll(
    `SELECT pr.*, pa.name AS payment_account_name, ta.name AS target_account_name,
            COALESCE(s.name, c.name) AS party_name
     FROM payments_receipts pr
     JOIN chart_of_accounts pa ON pa.id = pr.payment_account_id
     LEFT JOIN chart_of_accounts ta ON ta.id = pr.target_account_id
     LEFT JOIN suppliers s ON pr.party_type = 'SUPPLIER' AND s.id = pr.party_id
     LEFT JOIN customers c ON pr.party_type = 'CUSTOMER' AND c.id = pr.party_id
     WHERE pr.business_id = ?
     ORDER BY pr.voucher_date DESC, pr.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

commercialRouter.post('/payments', requireAuth, requirePermission(PERMISSIONS.PAYMENTS_MANAGE), (req, res) => {
  try {
    const doc = createPaymentOrReceipt({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(doc);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

commercialRouter.get('/parties/balances', requireAuth, (req, res) => {
  const biz = req.auth!.businessId;
  const suppliers = queryAll<any>(
    `SELECT s.id, s.code, s.name, s.phone, s.opening_balance,
            COALESCE((SELECT SUM(total_amount) FROM purchase_documents WHERE business_id = ? AND supplier_id = s.id AND doc_type = 'INVOICE' AND status = 'Posted'), 0) AS total_billed,
            COALESCE((SELECT SUM(amount) FROM payments_receipts WHERE business_id = ? AND party_type = 'SUPPLIER' AND party_id = s.id AND voucher_type = 'PAYMENT' AND status = 'Posted'), 0) AS total_paid
     FROM suppliers s WHERE s.business_id = ?`,
    [biz, biz, biz]
  );
  const customers = queryAll<any>(
    `SELECT c.id, c.code, c.name, c.phone, c.opening_balance,
            COALESCE((SELECT SUM(total_amount) FROM sales_documents WHERE business_id = ? AND customer_id = c.id AND doc_type = 'INVOICE' AND status = 'Posted'), 0) AS total_invoiced,
            COALESCE((SELECT SUM(amount) FROM payments_receipts WHERE business_id = ? AND party_type = 'CUSTOMER' AND party_id = c.id AND voucher_type = 'RECEIPT' AND status = 'Posted'), 0) AS total_received
     FROM customers c WHERE c.business_id = ?`,
    [biz, biz, biz]
  );
  res.json({
    suppliers: suppliers.map((s) => ({
      ...s,
      payable_balance: Number((s.opening_balance + s.total_billed - s.total_paid).toFixed(2)),
    })),
    customers: customers.map((c) => ({
      ...c,
      receivable_balance: Number((c.opening_balance + c.total_invoiced - c.total_received).toFixed(2)),
    })),
  });
});
void queryOne;
