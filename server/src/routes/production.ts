import { Router } from 'express';
import { queryAll } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { createOrCompleteProductionBatch, getProductionBatch } from '../services/production.js';

export const productionRouter = Router();

productionRouter.get('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTION_VIEW), (req, res) => {
  const rows = queryAll(
    `SELECT pb.*, w.name AS warehouse_name, u.full_name AS operator_name
     FROM production_batches pb
     JOIN warehouses w ON w.id = pb.warehouse_id
     LEFT JOIN users u ON u.id = pb.operator_id
     WHERE pb.business_id = ?
     ORDER BY pb.created_at DESC`,
    [req.auth!.businessId]
  );
  res.json(rows);
});

productionRouter.get('/:id', requireAuth, requirePermission(PERMISSIONS.PRODUCTION_VIEW), (req, res) => {
  const batch = getProductionBatch(req.auth!.businessId, String(req.params.id));
  if (!batch) {
    res.status(404).json({ error: 'Production batch not found.' });
    return;
  }
  res.json(batch);
});

productionRouter.post('/', requireAuth, requirePermission(PERMISSIONS.PRODUCTION_MANAGE), (req, res) => {
  try {
    const batch = createOrCompleteProductionBatch({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(batch);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
