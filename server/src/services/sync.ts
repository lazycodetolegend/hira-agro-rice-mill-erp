import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { createTruckAndLot } from './lots.js';
import { createBags, transitionBagStatus } from './bags.js';
import { recordInventoryMovement } from './inventory.js';
import { recordAudit } from '../middleware/audit.js';
import type { AuthContext } from '../middleware/auth.js';

export interface OfflineOperation {
  idempotencyKey: string;
  entityType: 'LOT_DRAFT' | 'BAGS_CREATE' | 'BAG_TRANSITION' | 'STOCK_COUNT' | 'PRODUCTION_DRAFT';
  action: string;
  offlineCreatedAt: string;
  payload: any;
}

export function processSyncPush(ops: OfflineOperation[], auth: AuthContext) {
  const results: Array<{
    idempotencyKey: string;
    status: 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'REJECTED';
    result?: any;
    conflictId?: string;
    error?: string;
  }> = [];

  for (const op of ops) {
    // 1. Idempotency check
    const existing = queryOne<{ status: string; result_json: string | null }>(
      'SELECT status, result_json FROM sync_operations WHERE business_id = ? AND idempotency_key = ?',
      [auth.businessId, op.idempotencyKey]
    );
    if (existing) {
      results.push({
        idempotencyKey: op.idempotencyKey,
        status: 'DUPLICATE',
        result: existing.result_json ? JSON.parse(existing.result_json) : null,
      });
      continue;
    }

    const syncedAt = nowIso();

    try {
      let appliedResult: any = null;

      if (op.entityType === 'BAGS_CREATE') {
        // Check for QR token collisions with existing bags before creating
        const clientBags: any[] = op.payload?.clientBags || [];
        const tokenCollisions: string[] = [];
        for (const cb of clientBags) {
          if (cb.qrToken) {
            const dup = queryOne('SELECT id FROM qr_tokens WHERE token = ?', [cb.qrToken]);
            if (dup) tokenCollisions.push(cb.qrToken);
          }
        }
        // Note: createBags automatically regenerates colliding QR tokens for unprinted bags,
        // or if client marks alreadyPrinted=true, we flag conflict for Admin review!
        if (tokenCollisions.length > 0 && op.payload?.alreadyPrinted) {
          const conflictId = createSyncConflict({
            businessId: auth.businessId,
            idempotencyKey: op.idempotencyKey,
            entityType: 'bag',
            conflictType: 'QR_TOKEN_COLLISION',
            description: `Printed offline QR token(s) collided with existing server tokens: ${tokenCollisions.join(', ')}`,
            clientPayload: op.payload,
            serverSnapshot: { collidingTokens: tokenCollisions },
            userId: auth.userId,
            deviceId: auth.deviceId,
          });
          recordSyncOp(auth, op, 'CONFLICT', { conflictId }, syncedAt);
          results.push({ idempotencyKey: op.idempotencyKey, status: 'CONFLICT', conflictId });
          continue;
        }

        appliedResult = createBags({
          ...op.payload,
          businessId: auth.businessId,
          userId: auth.userId,
          deviceId: auth.deviceId,
        });
      } else if (op.entityType === 'BAG_TRANSITION') {
        try {
          appliedResult = transitionBagStatus({
            businessId: auth.businessId,
            bagId: op.payload.bagId,
            newStatus: op.payload.newStatus,
            scanMode: op.payload.scanMode,
            userId: auth.userId,
            deviceId: auth.deviceId,
            occurredAt: op.offlineCreatedAt,
            gpsLat: op.payload.gpsLat,
            gpsLng: op.payload.gpsLng,
            reason: op.payload.reason,
            note: op.payload.note,
            idempotencyKey: op.idempotencyKey,
            netWeightKg: op.payload.netWeightKg,
            warehouseId: op.payload.warehouseId,
            locationId: op.payload.locationId,
          });
        } catch (err: any) {
          if (err?.code === 'ALREADY_SEALED' || err?.code === 'DUPLICATE_TRANSITION' || err?.code === 'INVALID_STATE_TRANSITION') {
            const serverBag = queryOne('SELECT * FROM bags WHERE id = ? AND business_id = ?', [
              op.payload.bagId,
              auth.businessId,
            ]);
            const conflictId = createSyncConflict({
              businessId: auth.businessId,
              idempotencyKey: op.idempotencyKey,
              entityType: 'bag',
              entityId: op.payload.bagId,
              conflictType: err.code === 'ALREADY_SEALED' ? 'CONCURRENT_BAG_SEAL' : 'BAG_STATE_CONFLICT',
              description: err.message,
              clientPayload: op.payload,
              serverSnapshot: serverBag,
              userId: auth.userId,
              deviceId: auth.deviceId,
            });
            recordSyncOp(auth, op, 'CONFLICT', { conflictId }, syncedAt);
            results.push({ idempotencyKey: op.idempotencyKey, status: 'CONFLICT', conflictId, error: err.message });
            continue;
          }
          throw err;
        }
      } else if (op.entityType === 'LOT_DRAFT') {
        appliedResult = createTruckAndLot({
          ...op.payload,
          businessId: auth.businessId,
          status: op.payload.status || 'Draft',
          userId: auth.userId,
          deviceId: auth.deviceId,
        });
      } else if (op.entityType === 'STOCK_COUNT') {
        // Reconcile inventory via stock movement delta, never overwrite balances directly
        appliedResult = recordInventoryMovement({
          businessId: auth.businessId,
          movementType: 'STOCK_COUNT',
          productId: op.payload.productId,
          warehouseId: op.payload.warehouseId,
          locationId: op.payload.locationId,
          qtyKg: op.payload.deltaQtyKg,
          unitCost: op.payload.unitCost || 0,
          sourceDocType: 'OFFLINE_STOCK_COUNT',
          sourceDocId: op.idempotencyKey,
          note: op.payload.note || 'Offline physical stock check',
          occurredAt: op.offlineCreatedAt,
          userId: auth.userId,
        });
      } else {
        throw new Error(`Unsupported offline sync entityType: ${op.entityType}`);
      }

      recordSyncOp(auth, op, 'APPLIED', appliedResult, syncedAt);
      results.push({ idempotencyKey: op.idempotencyKey, status: 'APPLIED', result: appliedResult });
    } catch (err: any) {
      const msg = err?.message || 'Sync operation failed';
      recordSyncOp(auth, op, 'REJECTED', { error: msg }, syncedAt);
      results.push({ idempotencyKey: op.idempotencyKey, status: 'REJECTED', error: msg });
    }
  }

  return { processed: results.length, results, syncedAt: nowIso() };
}

function recordSyncOp(
  auth: AuthContext,
  op: OfflineOperation,
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED',
  result: unknown,
  syncedAt: string
) {
  execute(
    `INSERT INTO sync_operations (
      id, business_id, idempotency_key, user_id, device_id, entity_type, action,
      status, result_json, offline_created_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      auth.businessId,
      op.idempotencyKey,
      auth.userId,
      auth.deviceId,
      op.entityType,
      op.action,
      status,
      JSON.stringify(result ?? null),
      op.offlineCreatedAt,
      syncedAt,
    ]
  );
}

function createSyncConflict(input: {
  businessId: string;
  idempotencyKey: string;
  entityType: string;
  entityId?: string;
  conflictType: string;
  description: string;
  clientPayload: unknown;
  serverSnapshot: unknown;
  userId: string;
  deviceId: string;
}) {
  const id = newId();
  execute(
    `INSERT INTO sync_conflicts (
      id, business_id, idempotency_key, entity_type, entity_id, conflict_type,
      description, client_payload_json, server_snapshot_json, resolution_status,
      created_at, user_id, device_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
    [
      id,
      input.businessId,
      input.idempotencyKey,
      input.entityType,
      input.entityId ?? null,
      input.conflictType,
      input.description,
      JSON.stringify(input.clientPayload),
      JSON.stringify(input.serverSnapshot ?? null),
      nowIso(),
      input.userId,
      input.deviceId,
    ]
  );
  return id;
}

export function resolveSyncConflict(
  businessId: string,
  conflictId: string,
  decision: 'RESOLVED_SERVER' | 'RESOLVED_CLIENT' | 'DISMISSED',
  note: string,
  auth: AuthContext
) {
  return withTransaction(() => {
    const conflict = queryOne<any>(
      'SELECT * FROM sync_conflicts WHERE id = ? AND business_id = ?',
      [conflictId, businessId]
    );
    if (!conflict) throw new Error('Conflict record not found.');
    if (conflict.resolution_status !== 'PENDING') {
      throw new Error('Conflict has already been resolved.');
    }

    const now = nowIso();
    if (decision === 'RESOLVED_CLIENT' && conflict.entity_type === 'bag' && conflict.entity_id) {
      const payload = JSON.parse(conflict.client_payload_json);
      if (payload.newStatus) {
        // Record a correction event explicitly noting conflict override
        const bag = queryOne<any>('SELECT current_status FROM bags WHERE id = ? AND business_id = ?', [
          conflict.entity_id,
          businessId,
        ]);
        if (bag) {
          execute('UPDATE bags SET current_status = ?, updated_at = ?, updated_by = ? WHERE id = ?', [
            payload.newStatus,
            now,
            auth.userId,
            conflict.entity_id,
          ]);
          execute(
            `INSERT INTO bag_events (
              id, business_id, bag_id, previous_status, new_status, scan_mode,
              user_id, device_id, occurred_at, synced_at, reason, note
            ) VALUES (?, ?, ?, ?, ?, 'AUDIT', ?, ?, ?, ?, ?, ?)`,
            [
              newId(),
              businessId,
              conflict.entity_id,
              bag.current_status,
              payload.newStatus,
              auth.userId,
              auth.deviceId,
              now,
              now,
              `Admin conflict override: ${note}`,
              `Applied offline client action from ${conflict.device_id}`,
            ]
          );
        }
      }
    }

    execute(
      `UPDATE sync_conflicts
       SET resolution_status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?
       WHERE id = ?`,
      [decision, auth.userId, now, note || decision, conflictId]
    );

    recordAudit({
      businessId,
      userId: auth.userId,
      deviceId: auth.deviceId,
      action: 'SYNC_CONFLICT_RESOLVED',
      entityType: 'sync_conflict',
      entityId: conflictId,
      summary: `Conflict ${conflict.conflict_type} marked ${decision}: ${note}`,
    });

    return queryOne('SELECT * FROM sync_conflicts WHERE id = ?', [conflictId]);
  });
}

export function getSyncSnapshot(businessId: string) {
  return {
    snapshotAt: nowIso(),
    products: queryAll('SELECT * FROM products WHERE business_id = ? AND is_active = 1', [businessId]),
    varieties: queryAll('SELECT * FROM product_varieties WHERE business_id = ? AND is_active = 1', [businessId]),
    grades: queryAll('SELECT * FROM product_grades WHERE business_id = ? AND is_active = 1', [businessId]),
    packagingTypes: queryAll('SELECT * FROM packaging_types WHERE business_id = ? AND is_active = 1', [businessId]),
    units: queryAll('SELECT * FROM units WHERE business_id = ?', [businessId]),
    warehouses: queryAll('SELECT * FROM warehouses WHERE business_id = ? AND is_active = 1', [businessId]),
    locations: queryAll('SELECT * FROM warehouse_locations WHERE business_id = ? AND is_active = 1', [businessId]),
    suppliers: queryAll('SELECT * FROM suppliers WHERE business_id = ? AND is_active = 1', [businessId]),
    customers: queryAll('SELECT * FROM customers WHERE business_id = ? AND is_active = 1', [businessId]),
    lots: queryAll('SELECT * FROM inbound_lots WHERE business_id = ? ORDER BY created_at DESC LIMIT 200', [businessId]),
    bags: queryAll(
      `SELECT b.*, p.name AS product_name, p.material_type, w.name AS warehouse_name, l.lot_number
       FROM bags b
       JOIN products p ON p.id = b.product_id
       JOIN warehouses w ON w.id = b.warehouse_id
       LEFT JOIN inbound_lots l ON l.id = b.lot_id
       WHERE b.business_id = ?
       ORDER BY b.created_at DESC LIMIT 1000`,
      [businessId]
    ),
  };
}
