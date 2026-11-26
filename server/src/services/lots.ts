import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { toKg } from '../utils/units.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { recordInventoryMovement } from './inventory.js';
import { recordAudit } from '../middleware/audit.js';

export interface CreateTruckLotInput {
  businessId: string;
  receivedAt?: string;
  truckNumber: string;
  driverName?: string;
  driverPhone?: string;
  supplierId?: string | null;
  supplierInvoiceNo?: string;
  poReference?: string;
  materialType: 'PADDY' | 'RICE' | 'BROKEN_RICE' | 'BRAN' | 'HUSK' | 'OTHER';
  productId: string;
  varietyId?: string | null;
  gradeId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  weighbridgeGross: number;
  tareWeight: number;
  netWeight?: number;
  unit: string;
  moisturePercent?: number;
  foreignMatterPercent?: number;
  brokenPercent?: number;
  qualityRemarks?: string;
  ratePerUnit?: number;
  rateUnit?: string;
  freightCharges?: number;
  otherCharges?: number;
  taxId?: string | null;
  paymentTerms?: string;
  notes?: string;
  status?: 'Draft' | 'Received';
  userId: string;
  deviceId: string;
  isDemo?: number;
}

export function createTruckAndLot(input: CreateTruckLotInput) {
  return withTransaction(() => {
    const grossKg = toKg(input.businessId, input.weighbridgeGross, input.unit);
    const tareKg = toKg(input.businessId, input.tareWeight, input.unit);
    const computedNetKg =
      input.netWeight !== undefined && input.netWeight > 0
        ? toKg(input.businessId, input.netWeight, input.unit)
        : Number((grossKg - tareKg).toFixed(4));

    if (grossKg <= 0 || tareKg < 0 || computedNetKg <= 0) {
      throw new Error('Invalid weights: gross and net weight must be positive, tare cannot be negative.');
    }
    if (tareKg >= grossKg && input.netWeight === undefined) {
      throw new Error('Tare weight cannot be greater than or equal to gross weight.');
    }

    const prod = queryOne<{ id: string; variety_id: string | null; grade_id: string | null }>(
      'SELECT id, variety_id, grade_id FROM products WHERE id = ? AND business_id = ?',
      [input.productId, input.businessId]
    );
    if (!prod) throw new Error('Product not found.');

    const wh = queryOne('SELECT id FROM warehouses WHERE id = ? AND business_id = ?', [
      input.warehouseId,
      input.businessId,
    ]);
    if (!wh) throw new Error('Warehouse not found.');

    const biz = queryOne<{ receiving_prefix: string; lot_prefix: string }>(
      'SELECT receiving_prefix, lot_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const receivingNumber = nextSequenceNumber(
      input.businessId,
      'trucks',
      'receiving_number',
      biz?.receiving_prefix || 'RCV'
    );
    const lotNumber = nextSequenceNumber(
      input.businessId,
      'inbound_lots',
      'lot_number',
      biz?.lot_prefix || 'LOT'
    );

    const rateUnit = (input.rateUnit || input.unit || 'kg').toLowerCase();
    const kgPerRateUnit = toKg(input.businessId, 1, rateUnit);
    const ratePerKg = Number(((input.ratePerUnit || 0) / kgPerRateUnit).toFixed(4));
    const freightCharges = Number((input.freightCharges || 0).toFixed(2));
    const otherCharges = Number((input.otherCharges || 0).toFixed(2));
    const freightPerKg = Number(((freightCharges + otherCharges) / computedNetKg).toFixed(4));
    const landedCostPerKg = Number((ratePerKg + freightPerKg).toFixed(4));

    const truckId = newId();
    const lotId = newId();
    const now = nowIso();
    const receivedAt = input.receivedAt || now;
    const status = input.status || 'Received';

    execute(
      `INSERT INTO trucks (
        id, business_id, receiving_number, received_at, truck_number, driver_name, driver_phone,
        supplier_id, supplier_invoice_no, po_reference, weighbridge_gross_kg, tare_kg, net_kg,
        display_unit, freight_charges, other_charges, payment_terms, notes, is_demo,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        truckId,
        input.businessId,
        receivingNumber,
        receivedAt,
        input.truckNumber.trim().toUpperCase(),
        input.driverName ?? null,
        input.driverPhone ?? null,
        input.supplierId ?? null,
        input.supplierInvoiceNo ?? null,
        input.poReference ?? null,
        grossKg,
        tareKg,
        computedNetKg,
        input.unit || 'kg',
        freightCharges,
        otherCharges,
        input.paymentTerms ?? null,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    execute(
      `INSERT INTO inbound_lots (
        id, business_id, lot_number, truck_id, supplier_id, product_id, material_type,
        variety_id, grade_id, warehouse_id, location_id, received_qty_kg, display_unit,
        moisture_percent, foreign_matter_percent, broken_percent, quality_remarks,
        rate_per_kg, freight_per_kg, landed_cost_per_kg, tax_id,
        wastage_adjusted_kg, status, notes, sync_status, is_demo,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'Synced', ?, ?, ?, ?, ?)`,
      [
        lotId,
        input.businessId,
        lotNumber,
        truckId,
        input.supplierId ?? null,
        input.productId,
        input.materialType,
        input.varietyId ?? prod.variety_id ?? null,
        input.gradeId ?? prod.grade_id ?? null,
        input.warehouseId,
        input.locationId ?? null,
        computedNetKg,
        input.unit || 'kg',
        input.moisturePercent ?? null,
        input.foreignMatterPercent ?? null,
        input.brokenPercent ?? null,
        input.qualityRemarks ?? null,
        ratePerKg,
        freightPerKg,
        landedCostPerKg,
        input.taxId ?? null,
        status,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    if (status === 'Received') {
      recordInventoryMovement({
        businessId: input.businessId,
        movementType: 'GOODS_RECEIVED',
        productId: input.productId,
        varietyId: input.varietyId ?? prod.variety_id,
        gradeId: input.gradeId ?? prod.grade_id,
        lotId,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        qtyKg: computedNetKg,
        displayUnit: input.unit || 'kg',
        unitCost: landedCostPerKg,
        sourceDocType: 'INBOUND_LOT',
        sourceDocId: lotId,
        sourceDocNumber: lotNumber,
        note: `Truck ${input.truckNumber} (${receivingNumber})`,
        occurredAt: receivedAt,
        userId: input.userId,
        isDemo: input.isDemo ?? 0,
      });
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: 'TRUCK_LOT_CREATED',
      entityType: 'inbound_lot',
      entityId: lotId,
      summary: `Received ${lotNumber} (${computedNetKg} kg) via Truck ${input.truckNumber}`,
      after: { truckId, receivingNumber, lotId, lotNumber, netKg: computedNetKg, status },
    });

    return getLotWithSummary(input.businessId, lotId);
  });
}

export function getLotWithSummary(businessId: string, lotId: string) {
  const lot = queryOne<any>(
    `SELECT l.*, t.receiving_number, t.received_at, t.truck_number, t.driver_name, t.driver_phone,
            t.supplier_invoice_no, t.po_reference, t.weighbridge_gross_kg, t.tare_kg AS truck_tare_kg,
            t.net_kg AS truck_net_kg, t.freight_charges, t.other_charges, t.payment_terms,
            p.name AS product_name, p.sku AS product_sku,
            s.name AS supplier_name, w.name AS warehouse_name
     FROM inbound_lots l
     JOIN trucks t ON t.id = l.truck_id
     JOIN products p ON p.id = l.product_id
     LEFT JOIN suppliers s ON s.id = l.supplier_id
     JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.id = ? AND l.business_id = ?`,
    [lotId, businessId]
  );
  if (!lot) return null;

  const bagStats = queryOne<{
    bag_count: number;
    assigned_kg: number;
    sealed_kg: number;
    sold_dispatched_kg: number;
  }>(
    `SELECT
       COUNT(*) AS bag_count,
       COALESCE(SUM(CASE WHEN current_status NOT IN ('Cancelled', 'Rejected') THEN net_weight_kg ELSE 0 END), 0) AS assigned_kg,
       COALESCE(SUM(CASE WHEN current_status IN ('Sealed', 'In Stock', 'Reserved', 'Dispatched', 'Sold', 'Delivered') THEN net_weight_kg ELSE 0 END), 0) AS sealed_kg,
       COALESCE(SUM(CASE WHEN current_status IN ('Dispatched', 'Sold', 'Delivered') THEN net_weight_kg ELSE 0 END), 0) AS sold_dispatched_kg
     FROM bags WHERE business_id = ? AND lot_id = ?`,
    [businessId, lotId]
  );

  const prodStats = queryOne<{ consumed_kg: number }>(
    `SELECT COALESCE(SUM(pi.qty_kg), 0) AS consumed_kg
     FROM production_inputs pi
     JOIN production_batches pb ON pb.id = pi.batch_id
     WHERE pi.business_id = ? AND pi.lot_id = ? AND pb.status != 'Cancelled'`,
    [businessId, lotId]
  );

  const receivedKg = Number(lot.received_qty_kg || 0);
  const assignedKg = Number((bagStats?.assigned_kg || 0).toFixed(4));
  const sealedKg = Number((bagStats?.sealed_kg || 0).toFixed(4));
  const soldDispatchedKg = Number((bagStats?.sold_dispatched_kg || 0).toFixed(4));
  const consumedInProductionKg = Number((prodStats?.consumed_kg || 0).toFixed(4));
  const wastageAdjustedKg = Number((lot.wastage_adjusted_kg || 0).toFixed(4));

  // Unaccounted remaining quantity in lot
  const remainingKg = Number(
    (receivedKg - assignedKg - consumedInProductionKg - wastageAdjustedKg).toFixed(4)
  );
  const varianceKg = Number((receivedKg - assignedKg).toFixed(4));

  return {
    ...lot,
    summary: {
      total_received_kg: receivedKg,
      total_assigned_to_bags_kg: assignedKg,
      total_sealed_kg: sealedKg,
      total_sold_dispatched_kg: soldDispatchedKg,
      total_consumed_in_production_kg: consumedInProductionKg,
      total_wastage_adjustment_kg: wastageAdjustedKg,
      remaining_qty_kg: remainingKg,
      bag_count: bagStats?.bag_count || 0,
      total_bag_weight_kg: assignedKg,
      variance_kg: varianceKg,
    },
  };
}

export function listLotsWithSummary(businessId: string, filters?: { status?: string; search?: string }) {
  let sql = 'SELECT id FROM inbound_lots WHERE business_id = ?';
  const params: unknown[] = [businessId];
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  sql += ' ORDER BY created_at DESC';
  const rows = queryAll<{ id: string }>(sql, params);
  let results = rows.map((r) => getLotWithSummary(businessId, r.id)).filter(Boolean);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (l) =>
        l.lot_number.toLowerCase().includes(q) ||
        l.truck_number.toLowerCase().includes(q) ||
        l.receiving_number.toLowerCase().includes(q) ||
        (l.supplier_name || '').toLowerCase().includes(q)
    );
  }
  return results;
}

export function recordLotWastageOrAdjustment(
  businessId: string,
  lotId: string,
  adjustmentKg: number,
  reason: string,
  userId: string,
  deviceId: string
) {
  return withTransaction(() => {
    const lot = getLotWithSummary(businessId, lotId);
    if (!lot) throw new Error('Lot not found.');
    if (lot.status === 'Cancelled') throw new Error('Cannot adjust a cancelled lot.');
    if (!reason || reason.trim().length < 3) {
      throw new Error('A clear reason is required for wastage or quantity adjustment.');
    }

    const newWastage = Number((Number(lot.wastage_adjusted_kg || 0) + adjustmentKg).toFixed(4));
    if (newWastage < 0) {
      throw new Error('Total wastage adjustment cannot become negative.');
    }

    const now = nowIso();
    execute(
      `UPDATE inbound_lots
       SET wastage_adjusted_kg = ?, wastage_reason = ?, wastage_approved_by = ?, updated_at = ?, updated_by = ?
       WHERE id = ? AND business_id = ?`,
      [newWastage, reason.trim(), userId, now, userId, lotId, businessId]
    );

    // Record stock ledger adjustment (negative reduces available stock)
    if (adjustmentKg !== 0) {
      recordInventoryMovement({
        businessId,
        movementType: 'ADJUSTMENT',
        productId: lot.product_id,
        varietyId: lot.variety_id,
        gradeId: lot.grade_id,
        lotId,
        warehouseId: lot.warehouse_id,
        locationId: lot.location_id,
        qtyKg: -adjustmentKg,
        unitCost: lot.landed_cost_per_kg || 0,
        sourceDocType: 'LOT_ADJUSTMENT',
        sourceDocId: lotId,
        sourceDocNumber: lot.lot_number,
        note: `Wastage/Adjustment: ${reason.trim()}`,
        userId,
        isDemo: lot.is_demo,
      });
    }

    recordAudit({
      businessId,
      userId,
      deviceId,
      action: 'LOT_WASTAGE_ADJUSTED',
      entityType: 'inbound_lot',
      entityId: lotId,
      summary: `Adjusted ${lot.lot_number} by ${adjustmentKg} kg: ${reason}`,
      before: { wastage_adjusted_kg: lot.wastage_adjusted_kg },
      after: { wastage_adjusted_kg: newWastage, reason },
    });

    return getLotWithSummary(businessId, lotId);
  });
}

export function updateLotStatus(
  businessId: string,
  lotId: string,
  newStatus: 'Draft' | 'Received' | 'In Processing' | 'Partially Bagged' | 'Completed' | 'Cancelled',
  userId: string,
  deviceId: string
) {
  return withTransaction(() => {
    const lot = getLotWithSummary(businessId, lotId);
    if (!lot) throw new Error('Lot not found.');

    if (newStatus === 'Completed') {
      const rem = Math.abs(lot.summary.remaining_qty_kg);
      if (rem > 0.5) {
        throw new Error(
          `Cannot mark lot ${lot.lot_number} Completed while unexplained quantity (${lot.summary.remaining_qty_kg} kg) remains. Bag the remaining quantity, mill it in production, or record an approved wastage/adjustment first.`
        );
      }
    }

    execute(
      'UPDATE inbound_lots SET status = ?, updated_at = ?, updated_by = ? WHERE id = ? AND business_id = ?',
      [newStatus, nowIso(), userId, lotId, businessId]
    );

    recordAudit({
      businessId,
      userId,
      deviceId,
      action: 'LOT_STATUS_UPDATED',
      entityType: 'inbound_lot',
      entityId: lotId,
      summary: `${lot.lot_number}: ${lot.status} -> ${newStatus}`,
      before: { status: lot.status },
      after: { status: newStatus },
    });

    return getLotWithSummary(businessId, lotId);
  });
}
