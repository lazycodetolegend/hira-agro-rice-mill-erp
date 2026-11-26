import { queryAll, queryOne, execute, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';

export type MovementType =
  | 'GOODS_RECEIVED'
  | 'PRODUCTION_IN'
  | 'PRODUCTION_OUT'
  | 'BAG_SEALED'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RESERVATION'
  | 'DISPATCH'
  | 'SALE'
  | 'SALE_RETURN'
  | 'PURCHASE_RETURN'
  | 'DAMAGED'
  | 'ADJUSTMENT'
  | 'STOCK_COUNT'
  | 'OPENING';

export interface InventoryMovementInput {
  businessId: string;
  movementType: MovementType;
  productId: string;
  varietyId?: string | null;
  gradeId?: string | null;
  lotId?: string | null;
  batchId?: string | null;
  bagId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  qtyKg: number; // positive = inflow, negative = outflow
  displayUnit?: string;
  unitCost: number;
  totalCost?: number;
  sourceDocType: string;
  sourceDocId: string;
  sourceDocNumber?: string;
  note?: string;
  occurredAt?: string;
  userId: string;
  isDemo?: number;
}

export function recordInventoryMovement(input: InventoryMovementInput) {
  const id = newId();
  const now = nowIso();
  const occurredAt = input.occurredAt || now;
  const qtyKg = Number(input.qtyKg.toFixed(4));
  const unitCost = Number((input.unitCost || 0).toFixed(4));
  const totalCost =
    input.totalCost !== undefined
      ? Number(input.totalCost.toFixed(2))
      : Number((qtyKg * unitCost).toFixed(2));

  execute(
    `INSERT INTO inventory_movements (
      id, business_id, movement_type, product_id, variety_id, grade_id,
      lot_id, batch_id, bag_id, warehouse_id, location_id,
      qty_kg, display_unit, unit_cost, total_cost,
      source_doc_type, source_doc_id, source_doc_number,
      status, note, occurred_at, created_at, created_by, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
    [
      id,
      input.businessId,
      input.movementType,
      input.productId,
      input.varietyId ?? null,
      input.gradeId ?? null,
      input.lotId ?? null,
      input.batchId ?? null,
      input.bagId ?? null,
      input.warehouseId,
      input.locationId ?? null,
      qtyKg,
      input.displayUnit || 'kg',
      unitCost,
      totalCost,
      input.sourceDocType,
      input.sourceDocId,
      input.sourceDocNumber ?? null,
      input.note ?? null,
      occurredAt,
      now,
      input.userId,
      input.isDemo ?? 0,
    ]
  );

  return { id, qtyKg, unitCost, totalCost };
}

export function getProductWarehouseBalance(
  businessId: string,
  productId: string,
  warehouseId?: string
): { qtyKg: number; totalValue: number; avgCostPerKg: number } {
  const params: unknown[] = [businessId, productId];
  let where = 'business_id = ? AND product_id = ? AND status = \'ACTIVE\'';
  if (warehouseId) {
    where += ' AND warehouse_id = ?';
    params.push(warehouseId);
  }
  const row = queryOne<{ qty_kg: number; total_cost: number }>(
    `SELECT COALESCE(SUM(qty_kg), 0) AS qty_kg, COALESCE(SUM(total_cost), 0) AS total_cost
     FROM inventory_movements WHERE ${where}`,
    params
  );
  const qtyKg = Number((row?.qty_kg || 0).toFixed(4));
  const totalValue = Number((row?.total_cost || 0).toFixed(2));
  const avgCostPerKg = qtyKg > 0.0001 ? Number((totalValue / qtyKg).toFixed(4)) : 0;
  return { qtyKg, totalValue: Math.max(0, totalValue), avgCostPerKg: Math.max(0, avgCostPerKg) };
}

/**
 * Computes unit cost per kg for an outgoing quantity according to the business's
 * configured valuation method (WEIGHTED_AVG or FIFO).
 */
export function getValuationCostForOutflow(
  businessId: string,
  productId: string,
  warehouseId: string,
  outflowQtyKg: number
): { unitCost: number; totalCost: number; method: 'WEIGHTED_AVG' | 'FIFO' } {
  const biz = queryOne<{ valuation_method: 'WEIGHTED_AVG' | 'FIFO' }>(
    'SELECT valuation_method FROM businesses WHERE id = ?',
    [businessId]
  );
  const method = biz?.valuation_method || 'WEIGHTED_AVG';

  if (method === 'WEIGHTED_AVG' || outflowQtyKg <= 0) {
    const bal = getProductWarehouseBalance(businessId, productId, warehouseId);
    const unitCost = bal.avgCostPerKg || getProductWarehouseBalance(businessId, productId).avgCostPerKg;
    return {
      unitCost: Number(unitCost.toFixed(4)),
      totalCost: Number((outflowQtyKg * unitCost).toFixed(2)),
      method: 'WEIGHTED_AVG',
    };
  }

  // FIFO: consume oldest positive layers after accounting for prior outflows
  const inflows = queryAll<{ qty_kg: number; unit_cost: number }>(
    `SELECT qty_kg, unit_cost FROM inventory_movements
     WHERE business_id = ? AND product_id = ? AND warehouse_id = ? AND status = 'ACTIVE' AND qty_kg > 0
     ORDER BY occurred_at ASC, created_at ASC`,
    [businessId, productId, warehouseId]
  );
  const outflowSumRow = queryOne<{ total_out: number }>(
    `SELECT COALESCE(SUM(ABS(qty_kg)), 0) AS total_out FROM inventory_movements
     WHERE business_id = ? AND product_id = ? AND warehouse_id = ? AND status = 'ACTIVE' AND qty_kg < 0`,
    [businessId, productId, warehouseId]
  );
  let alreadyConsumed = outflowSumRow?.total_out || 0;
  let remainingToCost = outflowQtyKg;
  let totalCost = 0;

  for (const layer of inflows) {
    if (alreadyConsumed >= layer.qty_kg) {
      alreadyConsumed -= layer.qty_kg;
      continue;
    }
    const availableInLayer = layer.qty_kg - alreadyConsumed;
    alreadyConsumed = 0;
    const take = Math.min(availableInLayer, remainingToCost);
    totalCost += take * layer.unit_cost;
    remainingToCost -= take;
    if (remainingToCost <= 0.0001) break;
  }

  if (remainingToCost > 0.0001) {
    const fallback = getProductWarehouseBalance(businessId, productId).avgCostPerKg;
    totalCost += remainingToCost * fallback;
  }

  const unitCost = outflowQtyKg > 0 ? totalCost / outflowQtyKg : 0;
  return {
    unitCost: Number(unitCost.toFixed(4)),
    totalCost: Number(totalCost.toFixed(2)),
    method: 'FIFO',
  };
}
