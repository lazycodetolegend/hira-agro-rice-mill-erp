import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { toKg } from '../utils/units.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { recordInventoryMovement } from './inventory.js';
import { createBags } from './bags.js';
import { createPurchaseDocument, getPurchaseDocument } from './commercial.js';
import { recordAudit } from '../middleware/audit.js';

export interface CreateTruckLotInput {
  businessId: string;
  receivedAt?: string;
  truckNumber: string;
  customerName?: string;
  customerPhone?: string;
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
  weightMode?: 'EXACT' | 'BAG_BY_BAG';
  weighbridgeGross: number;
  tareWeight: number;
  netWeight?: number;
  weighedBags?: Array<{ netWeightKg: number; qrToken?: string }>;
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
  billType?: 'GST' | 'SUPPLY_ONLY';
  autoGenerateBill?: boolean;
  paymentTerms?: string;
  notes?: string;
  status?: 'Draft' | 'Received';
  userId: string;
  deviceId: string;
  isDemo?: number;
}

export function createTruckAndLot(input: CreateTruckLotInput) {
  return withTransaction(() => {
    const weightMode = input.weightMode === 'BAG_BY_BAG' ? 'BAG_BY_BAG' : 'EXACT';
    let grossKg = 0;
    let tareKg = 0;
    let computedNetKg = 0;

    if (weightMode === 'BAG_BY_BAG') {
      const bagsList = input.weighedBags || [];
      if (!bagsList.length) {
        throw new Error('Add at least one weighed bag in Bag-by-Bag weighing mode.');
      }
      for (const b of bagsList) {
        if (!b.netWeightKg || b.netWeightKg <= 0) {
          throw new Error('Every weighed bag must have a positive weight (kg).');
        }
        computedNetKg += Number(b.netWeightKg);
      }
      computedNetKg = Number(computedNetKg.toFixed(4));
      grossKg = computedNetKg;
      tareKg = 0;
    } else {
      grossKg = toKg(input.businessId, input.weighbridgeGross, input.unit);
      tareKg = toKg(input.businessId, input.tareWeight, input.unit);
      computedNetKg =
        input.netWeight !== undefined && input.netWeight > 0
          ? toKg(input.businessId, input.netWeight, input.unit)
          : Number((grossKg - tareKg).toFixed(4));

      if (grossKg <= 0 || tareKg < 0 || computedNetKg <= 0) {
        throw new Error('Invalid weights: gross and net weight must be positive, tare cannot be negative.');
      }
      if (tareKg >= grossKg && input.netWeight === undefined) {
        throw new Error('Tare weight cannot be greater than or equal to gross weight.');
      }
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

    const now = nowIso();
    const customerName = (input.customerName || input.driverName || '').trim() || null;
    const customerPhone = (input.customerPhone || input.driverPhone || '').trim() || null;

    // Auto-create or reuse party record if Customer Name provided without supplierId
    let resolvedSupplierId = input.supplierId || null;
    if (!resolvedSupplierId && customerName) {
      const existingSup = queryOne<{ id: string }>(
        'SELECT id FROM suppliers WHERE business_id = ? AND LOWER(name) = LOWER(?)',
        [input.businessId, customerName]
      );
      if (existingSup) {
        resolvedSupplierId = existingSup.id;
      } else {
        resolvedSupplierId = newId();
        execute(
          `INSERT INTO suppliers (id, business_id, code, name, phone, is_active, is_demo, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            resolvedSupplierId,
            input.businessId,
            `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
            customerName,
            customerPhone,
            input.isDemo ?? 0,
            now,
            now,
            input.userId,
          ]
        );
      }
    }

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
    const receivedAt = input.receivedAt || now;
    const status = input.status || 'Received';
    const billType = input.billType || (input.taxId ? 'GST' : 'SUPPLY_ONLY');
    const effectiveTaxId = billType === 'SUPPLY_ONLY' ? null : (input.taxId ?? null);

    execute(
      `INSERT INTO trucks (
        id, business_id, receiving_number, received_at, truck_number, driver_name, driver_phone,
        customer_name, customer_phone, weight_mode,
        supplier_id, supplier_invoice_no, po_reference, weighbridge_gross_kg, tare_kg, net_kg,
        display_unit, freight_charges, other_charges, payment_terms, notes, is_demo,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        truckId,
        input.businessId,
        receivingNumber,
        receivedAt,
        input.truckNumber.trim().toUpperCase(),
        customerName,
        customerPhone,
        customerName,
        customerPhone,
        weightMode,
        resolvedSupplierId,
        input.supplierInvoiceNo ?? null,
        input.poReference ?? null,
        grossKg,
        tareKg,
        computedNetKg,
        weightMode === 'BAG_BY_BAG' ? 'kg' : (input.unit || 'kg'),
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
        rate_per_kg, freight_per_kg, landed_cost_per_kg, tax_id, bill_type,
        wastage_adjusted_kg, status, notes, sync_status, is_demo,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'Synced', ?, ?, ?, ?, ?)`,
      [
        lotId,
        input.businessId,
        lotNumber,
        truckId,
        resolvedSupplierId,
        input.productId,
        input.materialType,
        input.varietyId ?? prod.variety_id ?? null,
        input.gradeId ?? prod.grade_id ?? null,
        input.warehouseId,
        input.locationId ?? null,
        computedNetKg,
        weightMode === 'BAG_BY_BAG' ? 'kg' : (input.unit || 'kg'),
        input.moisturePercent ?? null,
        input.foreignMatterPercent ?? null,
        input.brokenPercent ?? null,
        input.qualityRemarks ?? null,
        ratePerKg,
        freightPerKg,
        landedCostPerKg,
        effectiveTaxId,
        billType,
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
        displayUnit: weightMode === 'BAG_BY_BAG' ? 'kg' : (input.unit || 'kg'),
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

    // If weighed one-by-one bags, automatically create the individual QR bag records linked to this lot
    if (weightMode === 'BAG_BY_BAG' && input.weighedBags?.length) {
      createBags({
        businessId: input.businessId,
        sourceType: 'LOT',
        lotId,
        productId: input.productId,
        varietyId: input.varietyId ?? prod.variety_id,
        gradeId: input.gradeId ?? prod.grade_id,
        warehouseId: input.warehouseId,
        locationId: input.locationId,
        packingDate: receivedAt.slice(0, 10),
        costRatePerKg: landedCostPerKg,
        mode: 'VARIABLE',
        variableBags: input.weighedBags.map((wb) => ({ netWeightKg: Number(wb.netWeightKg), tareWeightKg: 0 })),
        userId: input.userId,
        deviceId: input.deviceId,
        isDemo: input.isDemo ?? 0,
      });
    }

    // Auto-generate GST or Supply-Only Bill when requested
    if (input.autoGenerateBill && status === 'Received') {
      // Ensure a party exists on the bill (fallback to Walk-in Customer if neither supplier nor customerName given)
      let billSupplierId = resolvedSupplierId;
      if (!billSupplierId) {
        const walkInName = customerName || `Walk-in Farmer (${input.truckNumber.trim().toUpperCase()})`;
        const existingWalk = queryOne<{ id: string }>(
          'SELECT id FROM suppliers WHERE business_id = ? AND LOWER(name) = LOWER(?)',
          [input.businessId, walkInName]
        );
        if (existingWalk) {
          billSupplierId = existingWalk.id;
        } else {
          billSupplierId = newId();
          execute(
            `INSERT INTO suppliers (id, business_id, code, name, phone, is_active, is_demo, created_at, updated_at, created_by)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [
              billSupplierId,
              input.businessId,
              `SUP-${Math.floor(1000 + Math.random() * 9000)}`,
              walkInName,
              customerPhone,
              input.isDemo ?? 0,
              now,
              now,
              input.userId,
            ]
          );
        }
        execute('UPDATE inbound_lots SET supplier_id = ? WHERE id = ?', [billSupplierId, lotId]);
        execute('UPDATE trucks SET supplier_id = ? WHERE id = ?', [billSupplierId, truckId]);
      }

      const bill = createPurchaseDocument({
        businessId: input.businessId,
        docType: 'INVOICE',
        billType,
        docDate: receivedAt.slice(0, 10),
        supplierId: billSupplierId,
        truckId,
        lotId,
        freightAmount: freightCharges + otherCharges,
        lines: [
          {
            productId: input.productId,
            warehouseId: input.warehouseId,
            qtyKg: computedNetKg,
            displayUnit: weightMode === 'BAG_BY_BAG' ? 'kg' : (input.unit || 'kg'),
            ratePerKg,
            taxId: effectiveTaxId,
          },
        ],
        postImmediately: true,
        notes: `${billType === 'GST' ? 'GST Bill' : 'Supply Only Bill'} for Truck ${input.truckNumber.trim().toUpperCase()} (${lotNumber})`,
        userId: input.userId,
        deviceId: input.deviceId,
        isDemo: input.isDemo ?? 0,
      });

      if (bill?.id) {
        execute('UPDATE inbound_lots SET bill_document_id = ? WHERE id = ?', [bill.id, lotId]);
      }
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: 'TRUCK_LOT_CREATED',
      entityType: 'inbound_lot',
      entityId: lotId,
      summary: `Received ${lotNumber} (${computedNetKg} kg, ${weightMode}) via Truck ${input.truckNumber}`,
      after: { truckId, receivingNumber, lotId, lotNumber, netKg: computedNetKg, status, billType },
    });

    return getLotWithSummary(input.businessId, lotId);
  });
}

export function getLotWithSummary(businessId: string, lotId: string) {
  const lot = queryOne<any>(
    `SELECT l.*, t.receiving_number, t.received_at, t.truck_number,
            COALESCE(t.customer_name, t.driver_name) AS customer_name,
            COALESCE(t.customer_phone, t.driver_phone) AS customer_phone,
            t.weight_mode,
            t.supplier_invoice_no, t.po_reference, t.weighbridge_gross_kg, t.tare_kg AS truck_tare_kg,
            t.net_kg AS truck_net_kg, t.freight_charges, t.other_charges, t.payment_terms,
            p.name AS product_name, p.sku AS product_sku, p.hsn_code,
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

  const generatedBill = lot.bill_document_id ? getPurchaseDocument(businessId, lot.bill_document_id) : null;

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
    generated_bill: generatedBill,
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
