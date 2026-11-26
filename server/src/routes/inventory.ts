import { Router } from 'express';
import { queryAll, queryOne, withTransaction, execute, nowIso } from '../db/connection.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { recordInventoryMovement, getValuationCostForOutflow } from '../services/inventory.js';
import { getStockValuationReport } from '../services/reports.js';
import { getMappedAccountId, postJournalEntry } from '../services/accounting.js';
import { recordAudit } from '../middleware/audit.js';
import { newId } from '../utils/crypto.js';

export const inventoryRouter = Router();

inventoryRouter.get('/balances', requireAuth, requirePermission(PERMISSIONS.INVENTORY_VIEW), (req, res) => {
  res.json(getStockValuationReport(req.auth!.businessId));
});

inventoryRouter.get('/ledger', requireAuth, requirePermission(PERMISSIONS.INVENTORY_VIEW), (req, res) => {
  const { productId, warehouseId, movementType, fromDate, toDate } = req.query;
  let sql = `
    SELECT im.*, p.name AS product_name, p.sku, w.name AS warehouse_name,
           l.lot_number, pb.batch_number, b.bag_number, u.full_name AS user_name
    FROM inventory_movements im
    JOIN products p ON p.id = im.product_id
    JOIN warehouses w ON w.id = im.warehouse_id
    LEFT JOIN inbound_lots l ON l.id = im.lot_id
    LEFT JOIN production_batches pb ON pb.id = im.batch_id
    LEFT JOIN bags b ON b.id = im.bag_id
    LEFT JOIN users u ON u.id = im.created_by
    WHERE im.business_id = ?
  `;
  const params: unknown[] = [req.auth!.businessId];
  if (productId) { sql += ' AND im.product_id = ?'; params.push(String(productId)); }
  if (warehouseId) { sql += ' AND im.warehouse_id = ?'; params.push(String(warehouseId)); }
  if (movementType) { sql += ' AND im.movement_type = ?'; params.push(String(movementType)); }
  if (fromDate) { sql += ' AND im.occurred_at >= ?'; params.push(String(fromDate)); }
  if (toDate) { sql += ' AND im.occurred_at <= ?'; params.push(String(toDate) + 'T23:59:59Z'); }
  sql += ' ORDER BY im.occurred_at DESC, im.created_at DESC LIMIT 500';
  res.json(queryAll(sql, params));
});

inventoryRouter.post('/transfer', requireAuth, requirePermission(PERMISSIONS.INVENTORY_MOVE), (req, res) => {
  try {
    const { productId, fromWarehouseId, toWarehouseId, qtyKg, bagIds, note } = req.body;
    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
      res.status(400).json({ error: 'Valid distinct source and destination warehouses are required.' });
      return;
    }

    const result = withTransaction(() => {
      const refId = newId();
      const refNum = `TRF-${Date.now().toString().slice(-6)}`;
      let transferQty = Number(qtyKg || 0);
      let resolvedProductId = productId;

      if (Array.isArray(bagIds) && bagIds.length > 0) {
        transferQty = 0;
        for (const bagId of bagIds) {
          const bag = queryOne<any>('SELECT * FROM bags WHERE id = ? AND business_id = ?', [
            bagId,
            req.auth!.businessId,
          ]);
          if (!bag) throw new Error(`Bag not found: ${bagId}`);
          resolvedProductId = bag.product_id;
          transferQty += bag.net_weight_kg;
          execute('UPDATE bags SET warehouse_id = ?, updated_at = ?, updated_by = ? WHERE id = ?', [
            toWarehouseId,
            nowIso(),
            req.auth!.userId,
            bag.id,
          ]);
        }
      }

      if (transferQty <= 0 || !resolvedProductId) {
        throw new Error('Positive quantity and product are required for transfer.');
      }

      const val = getValuationCostForOutflow(req.auth!.businessId, resolvedProductId, fromWarehouseId, transferQty);
      recordInventoryMovement({
        businessId: req.auth!.businessId,
        movementType: 'TRANSFER_OUT',
        productId: resolvedProductId,
        warehouseId: fromWarehouseId,
        qtyKg: -transferQty,
        unitCost: val.unitCost,
        totalCost: -val.totalCost,
        sourceDocType: 'WAREHOUSE_TRANSFER',
        sourceDocId: refId,
        sourceDocNumber: refNum,
        note: note || `Transfer out to warehouse`,
        userId: req.auth!.userId,
      });
      recordInventoryMovement({
        businessId: req.auth!.businessId,
        movementType: 'TRANSFER_IN',
        productId: resolvedProductId,
        warehouseId: toWarehouseId,
        qtyKg: transferQty,
        unitCost: val.unitCost,
        totalCost: val.totalCost,
        sourceDocType: 'WAREHOUSE_TRANSFER',
        sourceDocId: refId,
        sourceDocNumber: refNum,
        note: note || `Transfer in from warehouse`,
        userId: req.auth!.userId,
      });

      recordAudit({
        businessId: req.auth!.businessId,
        userId: req.auth!.userId,
        deviceId: req.auth!.deviceId,
        action: 'INVENTORY_TRANSFER',
        entityType: 'warehouse_transfer',
        entityId: refId,
        summary: `Transferred ${transferQty} kg (${refNum})`,
      });

      return { refId, refNum, transferQty };
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

inventoryRouter.post('/adjustment', requireAuth, requirePermission(PERMISSIONS.INVENTORY_ADJUST), (req, res) => {
  try {
    const { productId, warehouseId, deltaQtyKg, unitCost, reason, movementType } = req.body;
    const delta = Number(deltaQtyKg);
    if (!productId || !warehouseId || !delta || !reason) {
      res.status(400).json({ error: 'productId, warehouseId, non-zero deltaQtyKg, and reason are required.' });
      return;
    }

    const result = withTransaction(() => {
      const prod = queryOne<any>('SELECT material_type, name FROM products WHERE id = ? AND business_id = ?', [
        productId,
        req.auth!.businessId,
      ]);
      if (!prod) throw new Error('Product not found.');

      const val =
        delta < 0
          ? getValuationCostForOutflow(req.auth!.businessId, productId, warehouseId, Math.abs(delta))
          : { unitCost: Number(unitCost || 0), totalCost: Number((delta * Number(unitCost || 0)).toFixed(2)) };

      const costValue = delta < 0 ? -val.totalCost : val.totalCost;
      const docId = newId();
      const docNum = `ADJ-${Date.now().toString().slice(-6)}`;

      const mov = recordInventoryMovement({
        businessId: req.auth!.businessId,
        movementType: movementType === 'STOCK_COUNT' ? 'STOCK_COUNT' : 'ADJUSTMENT',
        productId,
        warehouseId,
        qtyKg: delta,
        unitCost: val.unitCost,
        totalCost: costValue,
        sourceDocType: 'STOCK_ADJUSTMENT',
        sourceDocId: docId,
        sourceDocNumber: docNum,
        note: reason,
        userId: req.auth!.userId,
      });

      if (Math.abs(costValue) > 0.01) {
        const invAcc = getMappedAccountId(
          req.auth!.businessId,
          prod.material_type === 'PADDY' ? 'RAW_MATERIAL_INVENTORY' : 'FINISHED_GOODS_INVENTORY'
        );
        const varAcc = getMappedAccountId(req.auth!.businessId, 'STOCK_VARIANCE');
        const absVal = Math.abs(costValue);
        postJournalEntry({
          businessId: req.auth!.businessId,
          entryDate: nowIso().slice(0, 10),
          entryType: 'STOCK_ADJUSTMENT',
          sourceDocType: 'STOCK_ADJUSTMENT',
          sourceDocId: docId,
          sourceDocNumber: docNum,
          narration: `Stock adjustment (${prod.name}): ${reason}`,
          lines:
            costValue > 0
              ? [
                  { accountId: invAcc, debit: absVal, credit: 0 },
                  { accountId: varAcc, debit: 0, credit: absVal },
                ]
              : [
                  { accountId: varAcc, debit: absVal, credit: 0 },
                  { accountId: invAcc, debit: 0, credit: absVal },
                ],
          userId: req.auth!.userId,
          deviceId: req.auth!.deviceId,
        });
      }

      return { docId, docNum, movement: mov };
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
