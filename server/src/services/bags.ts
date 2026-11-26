import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId, generateOpaqueQrToken } from '../utils/crypto.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { getLotWithSummary } from './lots.js';
import { recordInventoryMovement } from './inventory.js';
import { recordAudit } from '../middleware/audit.js';
import type { AuthContext } from '../middleware/auth.js';
import { hasPermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';

export type BagStatus =
  | 'Generated'
  | 'Printed'
  | 'Applied'
  | 'Filled'
  | 'Weighed'
  | 'Scanned'
  | 'Sealed'
  | 'In Stock'
  | 'Reserved'
  | 'Dispatched'
  | 'Sold'
  | 'Delivered'
  | 'Rejected'
  | 'Damaged'
  | 'Returned'
  | 'Repacked'
  | 'Adjusted'
  | 'Cancelled';

export type ScanMode =
  | 'RECEIVE'
  | 'PRINT_VERIFY'
  | 'SEAL'
  | 'STOCK_CHECK'
  | 'DISPATCH'
  | 'SALE_RETURN'
  | 'AUDIT';

export interface CreateBagsInput {
  businessId: string;
  sourceType: 'LOT' | 'PRODUCTION' | 'OPENING';
  lotId?: string | null;
  productionBatchId?: string | null;
  productId: string;
  varietyId?: string | null;
  gradeId?: string | null;
  brand?: string;
  packagingTypeId?: string | null;
  warehouseId: string;
  locationId?: string | null;
  packingDate?: string;
  bestBeforeDate?: string | null;
  moisturePercent?: number | null;
  batchLotRef?: string;
  costRatePerKg?: number;
  salePricePerKg?: number;
  standardSizeKg?: number;
  mode: 'FIXED' | 'VARIABLE';
  count?: number;
  fixedNetWeightKg?: number;
  fixedTareWeightKg?: number;
  variableBags?: Array<{ netWeightKg: number; tareWeightKg?: number; grossWeightKg?: number; notes?: string }>;
  allowAuthorizedOverage?: boolean;
  notes?: string;
  userId: string;
  deviceId: string;
  isDemo?: number;
  clientBags?: Array<{ id?: string; bagNumber?: string; qrToken?: string; netWeightKg: number; tareWeightKg?: number }>;
}

function generateUniqueQrToken(businessId: string): { tokenId: string; token: string } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const token = generateOpaqueQrToken();
    const existing = queryOne('SELECT id FROM qr_tokens WHERE token = ?', [token]);
    if (!existing) {
      const tokenId = newId();
      execute(
        'INSERT INTO qr_tokens (id, business_id, token, status, created_at) VALUES (?, ?, ?, \'ACTIVE\', ?)',
        [tokenId, businessId, token, nowIso()]
      );
      return { tokenId, token };
    }
  }
  throw new Error('Failed to generate unique QR token after retries.');
}

export function createBags(input: CreateBagsInput) {
  return withTransaction(() => {
    const biz = queryOne<{ bag_prefix: string }>(
      'SELECT bag_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const prefix = biz?.bag_prefix || 'BAG';

    const prod = queryOne<{
      id: string;
      variety_id: string | null;
      grade_id: string | null;
      default_sale_rate_per_kg: number;
    }>('SELECT id, variety_id, grade_id, default_sale_rate_per_kg FROM products WHERE id = ? AND business_id = ?', [
      input.productId,
      input.businessId,
    ]);
    if (!prod) throw new Error('Product not found.');

    const wh = queryOne('SELECT id FROM warehouses WHERE id = ? AND business_id = ?', [
      input.warehouseId,
      input.businessId,
    ]);
    if (!wh) throw new Error('Warehouse not found.');

    let lot: any = null;
    if (input.sourceType === 'LOT') {
      if (!input.lotId) throw new Error('lotId is required when creating bags from an inbound lot.');
      lot = getLotWithSummary(input.businessId, input.lotId);
      if (!lot) throw new Error('Inbound lot not found.');
      if (lot.status === 'Cancelled' || lot.status === 'Completed') {
        throw new Error(`Cannot create bags for a ${lot.status} lot.`);
      }
    }

    // Build list of weights
    const bagSpecs: Array<{
      id?: string;
      bagNumber?: string;
      qrToken?: string;
      netKg: number;
      tareKg: number;
      grossKg: number;
      notes?: string;
    }> = [];

    if (input.clientBags && input.clientBags.length > 0) {
      for (const cb of input.clientBags) {
        const tare = Number((cb.tareWeightKg ?? input.fixedTareWeightKg ?? 0.2).toFixed(4));
        const net = Number(cb.netWeightKg.toFixed(4));
        if (net <= 0 || tare < 0) throw new Error('Bag weight must be positive and tare non-negative.');
        bagSpecs.push({
          id: cb.id,
          bagNumber: cb.bagNumber,
          qrToken: cb.qrToken,
          netKg: net,
          tareKg: tare,
          grossKg: Number((net + tare).toFixed(4)),
        });
      }
    } else if (input.mode === 'FIXED') {
      const count = input.count || 0;
      const net = Number((input.fixedNetWeightKg || 0).toFixed(4));
      const tare = Number((input.fixedTareWeightKg ?? 0.2).toFixed(4));
      if (count < 1 || count > 1000) {
        throw new Error('Bag count must be between 1 and 1000 per batch.');
      }
      if (net <= 0 || tare < 0) {
        throw new Error('Bag net weight must be positive and tare non-negative.');
      }
      for (let i = 0; i < count; i++) {
        bagSpecs.push({
          netKg: net,
          tareKg: tare,
          grossKg: Number((net + tare).toFixed(4)),
        });
      }
    } else {
      const items = input.variableBags || [];
      if (items.length < 1 || items.length > 1000) {
        throw new Error('Variable bag list must contain between 1 and 1000 bags.');
      }
      for (const item of items) {
        const tare = Number((item.tareWeightKg ?? 0.2).toFixed(4));
        const net = Number((item.netWeightKg || 0).toFixed(4));
        const gross = Number((item.grossWeightKg ?? net + tare).toFixed(4));
        if (net <= 0 || tare < 0 || gross < net) {
          throw new Error('Every variable bag must have positive net weight and valid tare/gross weight.');
        }
        bagSpecs.push({ netKg: net, tareKg: tare, grossKg: gross, notes: item.notes });
      }
    }

    const totalNewWeightKg = bagSpecs.reduce((acc, b) => acc + b.netKg, 0);

    // Enforce lot weight cap unless authorized adjustment
    if (lot && !input.allowAuthorizedOverage) {
      const available = lot.summary.remaining_qty_kg;
      if (totalNewWeightKg > available + 0.01) {
        throw new Error(
          `Total bag weight (${totalNewWeightKg.toFixed(2)} kg) exceeds remaining available lot quantity (${available.toFixed(2)} kg). Record an authorized adjustment to allow overage.`
        );
      }
    }

    const now = nowIso();
    const packingDate = input.packingDate || now.slice(0, 10);
    const costRate = input.costRatePerKg ?? (lot ? lot.landed_cost_per_kg : 0);
    const saleRate = input.salePricePerKg ?? prod.default_sale_rate_per_kg ?? 0;

    const createdBags: any[] = [];
    for (const spec of bagSpecs) {
      // Ensure unique bag number
      let bagNumber = spec.bagNumber;
      if (bagNumber) {
        const dup = queryOne('SELECT id FROM bags WHERE business_id = ? AND bag_number = ?', [
          input.businessId,
          bagNumber,
        ]);
        if (dup) bagNumber = undefined; // regenerate cleanly if offline collision
      }
      if (!bagNumber) {
        bagNumber = nextSequenceNumber(input.businessId, 'bags', 'bag_number', prefix, 6);
      }

      // Ensure unique QR token (reject duplicate client token and regenerate)
      let tokenId: string;
      let token: string;
      if (spec.qrToken) {
        const existingTok = queryOne('SELECT id FROM qr_tokens WHERE token = ?', [spec.qrToken]);
        if (!existingTok) {
          tokenId = newId();
          token = spec.qrToken;
          execute(
            'INSERT INTO qr_tokens (id, business_id, token, status, created_at, created_by) VALUES (?, ?, ?, \'ACTIVE\', ?, ?)',
            [tokenId, input.businessId, token, now, input.userId]
          );
        } else {
          const gen = generateUniqueQrToken(input.businessId);
          tokenId = gen.tokenId;
          token = gen.token;
        }
      } else {
        const gen = generateUniqueQrToken(input.businessId);
        tokenId = gen.tokenId;
        token = gen.token;
      }

      const bagId = spec.id || newId();
      const costValue = Number((spec.netKg * costRate).toFixed(2));

      execute(
        `INSERT INTO bags (
          id, business_id, bag_number, qr_token_id, qr_token, source_type,
          truck_id, lot_id, production_batch_id, supplier_id, product_id,
          variety_id, grade_id, brand, packaging_type_id, standard_size_kg,
          gross_weight_kg, tare_weight_kg, net_weight_kg, display_unit,
          packing_date, best_before_date, moisture_percent, batch_lot_ref,
          warehouse_id, location_id, cost_rate_per_kg, cost_value, sale_price_per_kg,
          current_status, print_count, notes, sync_status, is_demo,
          created_at, updated_at, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kg', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Generated', 0, ?, 'Synced', ?, ?, ?, ?, ?)`,
        [
          bagId,
          input.businessId,
          bagNumber,
          tokenId,
          token,
          input.sourceType,
          lot ? lot.truck_id : null,
          input.lotId ?? null,
          input.productionBatchId ?? null,
          lot ? lot.supplier_id : null,
          input.productId,
          input.varietyId ?? prod.variety_id ?? null,
          input.gradeId ?? prod.grade_id ?? null,
          input.brand ?? null,
          input.packagingTypeId ?? null,
          input.standardSizeKg ?? spec.netKg,
          spec.grossKg,
          spec.tareKg,
          spec.netKg,
          packingDate,
          input.bestBeforeDate ?? null,
          input.moisturePercent ?? (lot ? lot.moisture_percent : null),
          input.batchLotRef ?? (lot ? lot.lot_number : null),
          input.warehouseId,
          input.locationId ?? null,
          costRate,
          costValue,
          saleRate,
          spec.notes ?? input.notes ?? null,
          input.isDemo ?? 0,
          now,
          now,
          input.userId,
          input.userId,
        ]
      );

      execute(
        `INSERT INTO bag_events (
          id, business_id, bag_id, previous_status, new_status, scan_mode,
          user_id, device_id, occurred_at, synced_at, note
        ) VALUES (?, ?, ?, NULL, 'Generated', 'RECEIVE', ?, ?, ?, ?, ?)`,
        [newId(), input.businessId, bagId, input.userId, input.deviceId, now, now, 'Bag created & QR assigned']
      );

      createdBags.push({
        id: bagId,
        bag_number: bagNumber,
        qr_token: token,
        net_weight_kg: spec.netKg,
        gross_weight_kg: spec.grossKg,
        tare_weight_kg: spec.tareKg,
        current_status: 'Generated',
        packing_date: packingDate,
      });
    }

    // Update lot status automatically if partially bagged
    if (lot && lot.status === 'Received') {
      execute(
        'UPDATE inbound_lots SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        ['Partially Bagged', now, userIdOrFallback(input.userId), lot.id]
      );
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: 'BAGS_BULK_CREATED',
      entityType: 'bag',
      entityId: createdBags[0]?.id || input.lotId || input.productId,
      summary: `Created ${createdBags.length} bags (${totalNewWeightKg.toFixed(2)} kg)`,
      after: { count: createdBags.length, totalNewWeightKg, lotId: input.lotId },
    });

    return createdBags;
  });
}

function userIdOrFallback(u: string) {
  return u;
}

export function sanitizeBagForAuth(bag: any, auth: AuthContext) {
  const result = { ...bag };
  if (!hasPermission(auth, PERMISSIONS.BAGS_COST_VIEW)) {
    delete result.cost_rate_per_kg;
    delete result.cost_value;
  }
  if (!hasPermission(auth, PERMISSIONS.BAGS_PRICE_VIEW)) {
    delete result.sale_price_per_kg;
  }
  return result;
}

export function getBagDetails(businessId: string, bagId: string, auth: AuthContext) {
  const bag = queryOne<any>(
    `SELECT b.*, p.name AS product_name, p.sku AS product_sku, p.material_type,
            v.name AS variety_name, g.name AS grade_name,
            w.name AS warehouse_name, wl.name AS location_name,
            l.lot_number, t.truck_number, t.receiving_number,
            s.name AS supplier_name, pb.batch_number AS production_batch_number,
            c.name AS customer_name
     FROM bags b
     JOIN products p ON p.id = b.product_id
     LEFT JOIN product_varieties v ON v.id = b.variety_id
     LEFT JOIN product_grades g ON g.id = b.grade_id
     JOIN warehouses w ON w.id = b.warehouse_id
     LEFT JOIN warehouse_locations wl ON wl.id = b.location_id
     LEFT JOIN inbound_lots l ON l.id = b.lot_id
     LEFT JOIN trucks t ON t.id = b.truck_id
     LEFT JOIN suppliers s ON s.id = b.supplier_id
     LEFT JOIN production_batches pb ON pb.id = b.production_batch_id
     LEFT JOIN customers c ON c.id = b.customer_id
     WHERE b.id = ? AND b.business_id = ?`,
    [bagId, businessId]
  );
  if (!bag) return null;

  const events = queryAll<any>(
    `SELECT be.*, u.full_name AS user_name, u.username
     FROM bag_events be
     LEFT JOIN users u ON u.id = be.user_id
     WHERE be.bag_id = ? AND be.business_id = ?
     ORDER BY be.occurred_at DESC`,
    [bagId, businessId]
  );

  return {
    ...sanitizeBagForAuth(bag, auth),
    events,
  };
}

export function lookupQrToken(rawScanned: string, auth: AuthContext) {
  // Support either bare opaque token "RM1-..." or app-scoped URL "...?t=RM1-..."
  let token = rawScanned.trim();
  if (token.includes('t=')) {
    try {
      const u = new URL(token);
      token = u.searchParams.get('t') || token;
    } catch {
      const m = token.match(/[?&]t=([^&]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
  }

  const tokenRow = queryOne<{ id: string; business_id: string; status: string }>(
    'SELECT id, business_id, status FROM qr_tokens WHERE token = ?',
    [token]
  );

  if (!tokenRow) {
    return {
      validity: 'UNKNOWN' as const,
      token,
      bag: null,
    };
  }

  if (tokenRow.business_id !== auth.businessId) {
    return {
      validity: 'OTHER_BUSINESS' as const,
      token,
      bag: null,
    };
  }

  const bagRow = queryOne<{ id: string; current_status: BagStatus }>(
    'SELECT id, current_status FROM bags WHERE qr_token_id = ? AND business_id = ?',
    [tokenRow.id, auth.businessId]
  );

  if (!bagRow) {
    return { validity: 'UNKNOWN' as const, token, bag: null };
  }

  const bag = getBagDetails(auth.businessId, bagRow.id, auth);
  let validity:
    | 'VALID'
    | 'ALREADY_SEALED'
    | 'SOLD'
    | 'CANCELLED'
    | 'DAMAGED' = 'VALID';

  if (bagRow.current_status === 'Cancelled') validity = 'CANCELLED';
  else if (bagRow.current_status === 'Damaged') validity = 'DAMAGED';
  else if (bagRow.current_status === 'Sold' || bagRow.current_status === 'Delivered') validity = 'SOLD';
  else if (bagRow.current_status === 'Sealed' || bagRow.current_status === 'In Stock') validity = 'ALREADY_SEALED';

  return {
    validity,
    token,
    bag,
  };
}

const TERMINAL_LOCKED: BagStatus[] = ['Cancelled', 'Sold', 'Delivered'];

export function transitionBagStatus(input: {
  businessId: string;
  bagId: string;
  newStatus: BagStatus;
  scanMode?: ScanMode;
  userId: string;
  deviceId: string;
  occurredAt?: string;
  gpsLat?: number | null;
  gpsLng?: number | null;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
  netWeightKg?: number;
  warehouseId?: string;
  locationId?: string | null;
}) {
  return withTransaction(() => {
    if (input.idempotencyKey) {
      const existingEvent = queryOne<{ id: string; new_status: string }>(
        'SELECT id, new_status FROM bag_events WHERE idempotency_key = ?',
        [input.idempotencyKey]
      );
      if (existingEvent) {
        return { duplicate: true, eventId: existingEvent.id, status: existingEvent.new_status };
      }
    }

    const bag = queryOne<any>('SELECT * FROM bags WHERE id = ? AND business_id = ?', [
      input.bagId,
      input.businessId,
    ]);
    if (!bag) throw new Error('Bag not found.');

    const prevStatus = bag.current_status as BagStatus;

    // Prevent accidental duplicate transitions
    if (prevStatus === input.newStatus) {
      if (input.newStatus === 'Sealed') {
        const err: any = new Error(`Bag ${bag.bag_number} is already SEALED. Duplicate sealing is prevented.`);
        err.code = 'ALREADY_SEALED';
        throw err;
      }
      const err: any = new Error(`Bag ${bag.bag_number} is already in status ${prevStatus}.`);
      err.code = 'DUPLICATE_TRANSITION';
      throw err;
    }

    // Prevent sealing/stocking a cancelled, damaged, or already sold bag
    if (
      TERMINAL_LOCKED.includes(prevStatus) &&
      input.newStatus !== 'Returned' &&
      input.newStatus !== 'Adjusted'
    ) {
      const err: any = new Error(`Bag ${bag.bag_number} is ${prevStatus} and cannot transition to ${input.newStatus}.`);
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }

    // Also block sealing if bag is already In Stock / Reserved / Dispatched
    if (
      input.newStatus === 'Sealed' &&
      ['In Stock', 'Reserved', 'Dispatched', 'Sold', 'Delivered', 'Damaged'].includes(prevStatus)
    ) {
      const err: any = new Error(`Bag ${bag.bag_number} cannot be sealed from status ${prevStatus}.`);
      err.code = 'ALREADY_SEALED';
      throw err;
    }

    const now = nowIso();
    const occurredAt = input.occurredAt || now;
    const updatedWeight = input.netWeightKg && input.netWeightKg > 0 ? input.netWeightKg : bag.net_weight_kg;
    const updatedWh = input.warehouseId || bag.warehouse_id;
    const updatedLoc = input.locationId !== undefined ? input.locationId : bag.location_id;

    execute(
      `UPDATE bags
       SET current_status = ?, net_weight_kg = ?, warehouse_id = ?, location_id = ?,
           updated_at = ?, updated_by = ?
       WHERE id = ? AND business_id = ?`,
      [input.newStatus, updatedWeight, updatedWh, updatedLoc, now, input.userId, bag.id, input.businessId]
    );

    const eventId = newId();
    execute(
      `INSERT INTO bag_events (
        id, business_id, bag_id, previous_status, new_status, scan_mode,
        user_id, device_id, occurred_at, synced_at, gps_lat, gps_lng,
        reason, note, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        input.businessId,
        bag.id,
        prevStatus,
        input.newStatus,
        input.scanMode ?? null,
        input.userId,
        input.deviceId,
        occurredAt,
        now,
        input.gpsLat ?? null,
        input.gpsLng ?? null,
        input.reason ?? null,
        input.note ?? null,
        input.idempotencyKey ?? null,
      ]
    );

    // Stock ledger hooks
    if (input.newStatus === 'Sealed' || input.newStatus === 'In Stock') {
      // Note: if bag came from PRODUCTION or OPENING, Sealing/Stocking confirms packed stock if not already moved.
      // For LOT-sourced bags, raw stock was already received at lot level; BAG_SEALED records bag-level audit event.
      recordInventoryMovement({
        businessId: input.businessId,
        movementType: 'BAG_SEALED',
        productId: bag.product_id,
        varietyId: bag.variety_id,
        gradeId: bag.grade_id,
        lotId: bag.lot_id,
        batchId: bag.production_batch_id,
        bagId: bag.id,
        warehouseId: updatedWh,
        locationId: updatedLoc,
        qtyKg: 0, // 0 net delta when already in lot/batch stock; tracks bag-level traceability event
        unitCost: bag.cost_rate_per_kg || 0,
        totalCost: 0,
        sourceDocType: 'BAG_EVENT',
        sourceDocId: eventId,
        sourceDocNumber: bag.bag_number,
        note: `Bag ${bag.bag_number} ${input.newStatus}`,
        occurredAt,
        userId: input.userId,
        isDemo: bag.is_demo,
      });
    } else if (input.newStatus === 'Damaged') {
      recordInventoryMovement({
        businessId: input.businessId,
        movementType: 'DAMAGED',
        productId: bag.product_id,
        varietyId: bag.variety_id,
        gradeId: bag.grade_id,
        lotId: bag.lot_id,
        batchId: bag.production_batch_id,
        bagId: bag.id,
        warehouseId: updatedWh,
        locationId: updatedLoc,
        qtyKg: -updatedWeight,
        unitCost: bag.cost_rate_per_kg || 0,
        sourceDocType: 'BAG_EVENT',
        sourceDocId: eventId,
        sourceDocNumber: bag.bag_number,
        note: input.reason || `Bag ${bag.bag_number} marked damaged`,
        occurredAt,
        userId: input.userId,
        isDemo: bag.is_demo,
      });
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: 'BAG_STATUS_CHANGED',
      entityType: 'bag',
      entityId: bag.id,
      summary: `${bag.bag_number}: ${prevStatus} -> ${input.newStatus}`,
      before: { status: prevStatus },
      after: { status: input.newStatus, scanMode: input.scanMode, reason: input.reason },
    });

    return {
      duplicate: false,
      eventId,
      bagId: bag.id,
      bagNumber: bag.bag_number,
      previousStatus: prevStatus,
      newStatus: input.newStatus,
    };
  });
}

export function recordPrintJob(input: {
  businessId: string;
  printerType: string;
  layoutConfig: unknown;
  bagIds: string[];
  reprintReason?: string;
  userId: string;
  deviceId: string;
}) {
  return withTransaction(() => {
    if (!input.bagIds.length) throw new Error('Select at least one bag to print.');
    const now = nowIso();
    let reprintCount = 0;

    for (const bagId of input.bagIds) {
      const bag = queryOne<{ id: string; current_status: string; print_count: number; bag_number: string }>(
        'SELECT id, current_status, print_count, bag_number FROM bags WHERE id = ? AND business_id = ?',
        [bagId, input.businessId]
      );
      if (!bag) throw new Error(`Bag not found: ${bagId}`);
      if (bag.print_count > 0) reprintCount += 1;

      const nextStatus = bag.current_status === 'Generated' ? 'Printed' : bag.current_status;
      execute(
        'UPDATE bags SET print_count = print_count + 1, current_status = ?, updated_at = ?, updated_by = ? WHERE id = ?',
        [nextStatus, now, input.userId, bag.id]
      );

      if (bag.current_status === 'Generated') {
        execute(
          `INSERT INTO bag_events (
            id, business_id, bag_id, previous_status, new_status, scan_mode,
            user_id, device_id, occurred_at, synced_at, note
          ) VALUES (?, ?, ?, 'Generated', 'Printed', 'PRINT_VERIFY', ?, ?, ?, ?, ?)`,
          [newId(), input.businessId, bag.id, input.userId, input.deviceId, now, now, `Printed (${input.printerType})`]
        );
      } else {
        execute(
          `INSERT INTO bag_events (
            id, business_id, bag_id, previous_status, new_status, scan_mode,
            user_id, device_id, occurred_at, synced_at, reason, note
          ) VALUES (?, ?, ?, ?, ?, 'PRINT_VERIFY', ?, ?, ?, ?, ?, ?)`,
          [
            newId(),
            input.businessId,
            bag.id,
            bag.current_status,
            bag.current_status,
            input.userId,
            input.deviceId,
            now,
            now,
            input.reprintReason || 'Label reprint',
            `Label reprinted #${bag.print_count + 1}`,
          ]
        );
      }
    }

    const isReprint = reprintCount > 0 ? 1 : 0;
    const jobId = newId();
    execute(
      `INSERT INTO print_jobs (
        id, business_id, printer_type, layout_config_json, bag_ids_json,
        bag_count, is_reprint, reprint_reason, printed_by, device_id, printed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        input.businessId,
        input.printerType || 'A4_HP',
        JSON.stringify(input.layoutConfig || {}),
        JSON.stringify(input.bagIds),
        input.bagIds.length,
        isReprint,
        input.reprintReason ?? null,
        input.userId,
        input.deviceId,
        now,
      ]
    );

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: isReprint ? 'QR_LABELS_REPRINTED' : 'QR_LABELS_PRINTED',
      entityType: 'print_job',
      entityId: jobId,
      summary: `${isReprint ? 'Reprinted' : 'Printed'} ${input.bagIds.length} QR labels (${input.printerType})`,
      after: { bagCount: input.bagIds.length, isReprint, reprintReason: input.reprintReason },
    });

    return { jobId, bagCount: input.bagIds.length, isReprint };
  });
}
