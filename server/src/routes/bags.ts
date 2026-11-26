import { Router } from 'express';
import { queryAll } from '../db/connection.js';
import { requireAuth, requirePermission, hasPermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import {
  createBags,
  getBagDetails,
  lookupQrToken,
  transitionBagStatus,
  recordPrintJob,
  sanitizeBagForAuth,
} from '../services/bags.js';

export const bagsRouter = Router();
const qrLookupLimiter = createRateLimiter('qr-lookup', 180, 60_000);

bagsRouter.get('/', requireAuth, requirePermission(PERMISSIONS.BAGS_VIEW), (req, res) => {
  const { status, lotId, batchId, productId, warehouseId, search } = req.query;
  let sql = `
    SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.material_type,
           w.name AS warehouse_name, l.lot_number, pb.batch_number AS production_batch_number
    FROM bags b
    JOIN products p ON p.id = b.product_id
    JOIN warehouses w ON w.id = b.warehouse_id
    LEFT JOIN inbound_lots l ON l.id = b.lot_id
    LEFT JOIN production_batches pb ON pb.id = b.production_batch_id
    WHERE b.business_id = ?
  `;
  const params: unknown[] = [req.auth!.businessId];

  if (status) { sql += ' AND b.current_status = ?'; params.push(String(status)); }
  if (lotId) { sql += ' AND b.lot_id = ?'; params.push(String(lotId)); }
  if (batchId) { sql += ' AND b.production_batch_id = ?'; params.push(String(batchId)); }
  if (productId) { sql += ' AND b.product_id = ?'; params.push(String(productId)); }
  if (warehouseId) { sql += ' AND b.warehouse_id = ?'; params.push(String(warehouseId)); }
  if (search) {
    const like = `%${String(search)}%`;
    sql += ' AND (b.bag_number LIKE ? OR b.qr_token = ? OR b.batch_lot_ref LIKE ?)';
    params.push(like, String(search), like);
  }
  sql += ' ORDER BY b.created_at DESC LIMIT 500';

  const rows = queryAll(sql, params).map((b) => sanitizeBagForAuth(b, req.auth!));
  res.json(rows);
});

bagsRouter.get('/print-jobs', requireAuth, requirePermission(PERMISSIONS.BAGS_PRINT), (req, res) => {
  const jobs = queryAll(
    `SELECT pj.*, u.full_name AS printed_by_name
     FROM print_jobs pj LEFT JOIN users u ON u.id = pj.printed_by
     WHERE pj.business_id = ? ORDER BY pj.printed_at DESC LIMIT 100`,
    [req.auth!.businessId]
  );
  res.json(jobs);
});

bagsRouter.post('/print-jobs', requireAuth, requirePermission(PERMISSIONS.BAGS_PRINT), (req, res) => {
  try {
    const result = recordPrintJob({
      businessId: req.auth!.businessId,
      printerType: req.body.printerType || 'A4_HP',
      layoutConfig: req.body.layoutConfig || {},
      bagIds: req.body.bagIds || [],
      reprintReason: req.body.reprintReason,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bagsRouter.post('/bulk', requireAuth, requirePermission(PERMISSIONS.BAGS_CREATE), (req, res) => {
  try {
    const allowOverage =
      Boolean(req.body.allowAuthorizedOverage) &&
      (hasPermission(req.auth!, PERMISSIONS.LOTS_MANAGE) || hasPermission(req.auth!, PERMISSIONS.INVENTORY_ADJUST));

    const bags = createBags({
      ...req.body,
      allowAuthorizedOverage: allowOverage,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(bags);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bagsRouter.post('/lookup-qr', requireAuth, requirePermission(PERMISSIONS.BAGS_SCAN), qrLookupLimiter, (req, res) => {
  const token = String(req.body?.token || '');
  if (!token) {
    res.status(400).json({ error: 'QR token is required.' });
    return;
  }
  const result = lookupQrToken(token, req.auth!);
  res.json(result);
});

bagsRouter.get('/:id', requireAuth, requirePermission(PERMISSIONS.BAGS_VIEW), (req, res) => {
  const bag = getBagDetails(req.auth!.businessId, String(req.params.id), req.auth!);
  if (!bag) {
    res.status(404).json({ error: 'Bag not found.' });
    return;
  }
  res.json(bag);
});

bagsRouter.post('/:id/transition', requireAuth, requirePermission(PERMISSIONS.BAGS_SCAN), (req, res) => {
  try {
    const { newStatus, scanMode, reason, note, gpsLat, gpsLng, netWeightKg, warehouseId, locationId, idempotencyKey } = req.body;
    if (newStatus === 'Sealed' && !hasPermission(req.auth!, PERMISSIONS.BAGS_SEAL)) {
      res.status(403).json({ error: 'Permission bags.seal is required to seal bags.' });
      return;
    }
    const result = transitionBagStatus({
      businessId: req.auth!.businessId,
      bagId: String(req.params.id),
      newStatus,
      scanMode,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
      gpsLat,
      gpsLng,
      reason,
      note,
      netWeightKg,
      warehouseId,
      locationId,
      idempotencyKey,
    });
    res.json(result);
  } catch (err: any) {
    const status = err.code === 'ALREADY_SEALED' || err.code === 'DUPLICATE_TRANSITION' ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code });
  }
});
