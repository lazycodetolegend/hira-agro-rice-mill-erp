import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import {
  createTruckAndLot,
  getLotWithSummary,
  listLotsWithSummary,
  recordLotWastageOrAdjustment,
  updateLotStatus,
} from '../services/lots.js';

export const lotsRouter = Router();

lotsRouter.get('/', requireAuth, requirePermission(PERMISSIONS.LOTS_VIEW), (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  res.json(listLotsWithSummary(req.auth!.businessId, { status, search }));
});

lotsRouter.get('/:id', requireAuth, requirePermission(PERMISSIONS.LOTS_VIEW), (req, res) => {
  const lot = getLotWithSummary(req.auth!.businessId, String(req.params.id));
  if (!lot) {
    res.status(404).json({ error: 'Lot not found.' });
    return;
  }
  res.json(lot);
});

lotsRouter.post('/', requireAuth, requirePermission(PERMISSIONS.LOTS_MANAGE), (req, res) => {
  try {
    const lot = createTruckAndLot({
      ...req.body,
      businessId: req.auth!.businessId,
      userId: req.auth!.userId,
      deviceId: req.auth!.deviceId,
    });
    res.status(201).json(lot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

lotsRouter.post('/:id/wastage', requireAuth, requirePermission(PERMISSIONS.LOTS_MANAGE), (req, res) => {
  try {
    const { adjustmentKg, reason } = req.body;
    const lot = recordLotWastageOrAdjustment(
      req.auth!.businessId,
      String(req.params.id),
      Number(adjustmentKg),
      String(reason || ''),
      req.auth!.userId,
      req.auth!.deviceId
    );
    res.json(lot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

lotsRouter.post('/:id/status', requireAuth, requirePermission(PERMISSIONS.LOTS_MANAGE), (req, res) => {
  try {
    const lot = updateLotStatus(
      req.auth!.businessId,
      String(req.params.id),
      req.body.status,
      req.auth!.userId,
      req.auth!.deviceId
    );
    res.json(lot);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
