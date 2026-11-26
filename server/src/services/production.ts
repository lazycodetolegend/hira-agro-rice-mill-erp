import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { recordInventoryMovement, getValuationCostForOutflow } from './inventory.js';
import { getMappedAccountId, postJournalEntry } from './accounting.js';
import { recordAudit } from '../middleware/audit.js';

export interface ProductionBatchInput {
  businessId: string;
  startDate: string;
  endDate?: string;
  machineLine?: string;
  operatorId?: string;
  warehouseId: string;
  inputs: Array<{ lotId: string; qtyKg: number }>;
  outputs: Array<{
    productId: string;
    outputCategory: 'FINISHED_RICE' | 'BROKEN_RICE' | 'BRAN' | 'HUSK' | 'WASTE';
    qtyKg: number;
    warehouseId?: string;
    costSharePercent?: number;
  }>;
  approvedVarianceKg?: number;
  varianceReason?: string;
  approveVariance?: boolean;
  moistureBefore?: number;
  moistureAfter?: number;
  processingCost?: number;
  qualityNotes?: string;
  completeNow?: boolean;
  userId: string;
  deviceId: string;
  isDemo?: number;
}

export function createOrCompleteProductionBatch(input: ProductionBatchInput) {
  return withTransaction(() => {
    if (!input.inputs.length) throw new Error('At least one input lot is required.');
    const biz = queryOne<{ batch_prefix: string }>(
      'SELECT batch_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const batchNumber = nextSequenceNumber(
      input.businessId,
      'production_batches',
      'batch_number',
      biz?.batch_prefix || 'PRD'
    );
    const batchId = newId();
    const now = nowIso();

    let totalInputKg = 0;
    let totalInputCost = 0;
    const resolvedInputs: Array<{
      lotId: string;
      productId: string;
      warehouseId: string;
      qtyKg: number;
      unitCost: number;
      totalCost: number;
      lotNumber: string;
    }> = [];

    for (const inp of input.inputs) {
      if (inp.qtyKg <= 0) throw new Error('Input quantity must be positive.');
      const lot = queryOne<any>(
        'SELECT * FROM inbound_lots WHERE id = ? AND business_id = ?',
        [inp.lotId, input.businessId]
      );
      if (!lot) throw new Error(`Input lot not found: ${inp.lotId}`);
      if (lot.status === 'Cancelled') throw new Error(`Lot ${lot.lot_number} is cancelled.`);

      const val = getValuationCostForOutflow(input.businessId, lot.product_id, lot.warehouse_id, inp.qtyKg);
      const unitCost = val.unitCost || lot.landed_cost_per_kg || 0;
      const lineCost = Number((inp.qtyKg * unitCost).toFixed(2));
      totalInputKg += inp.qtyKg;
      totalInputCost += lineCost;
      resolvedInputs.push({
        lotId: lot.id,
        productId: lot.product_id,
        warehouseId: lot.warehouse_id,
        qtyKg: inp.qtyKg,
        unitCost,
        totalCost: lineCost,
        lotNumber: lot.lot_number,
      });
    }

    let finishedRiceKg = 0;
    let brokenRiceKg = 0;
    let branKg = 0;
    let huskKg = 0;
    let wasteLossKg = 0;

    for (const out of input.outputs) {
      if (out.qtyKg < 0) throw new Error('Output quantity cannot be negative.');
      if (out.outputCategory === 'FINISHED_RICE') finishedRiceKg += out.qtyKg;
      else if (out.outputCategory === 'BROKEN_RICE') brokenRiceKg += out.qtyKg;
      else if (out.outputCategory === 'BRAN') branKg += out.qtyKg;
      else if (out.outputCategory === 'HUSK') huskKg += out.qtyKg;
      else if (out.outputCategory === 'WASTE') wasteLossKg += out.qtyKg;
    }

    const approvedVarianceKg = Number((input.approvedVarianceKg || 0).toFixed(4));
    const totalAccountedOutKg = finishedRiceKg + brokenRiceKg + branKg + huskKg + wasteLossKg + approvedVarianceKg;
    const unexplainedVarianceKg = Number((totalInputKg - totalAccountedOutKg).toFixed(4));

    if (input.completeNow) {
      if (Math.abs(unexplainedVarianceKg) > 0.5) {
        throw new Error(
          `Mass balance mismatch: Input (${totalInputKg.toFixed(2)} kg) != Outputs + Waste + Approved Variance (${totalAccountedOutKg.toFixed(2)} kg). Unexplained variance of ${unexplainedVarianceKg.toFixed(2)} kg requires variance approval.`
        );
      }
      if (approvedVarianceKg !== 0 && !input.approveVariance) {
        throw new Error('Variance requires explicit approval and reason before completion.');
      }
    }

    const processingCost = Number((input.processingCost || 0).toFixed(2));
    const totalPoolCost = Number((totalInputCost + processingCost).toFixed(2));
    const status = input.completeNow ? 'Completed' : 'In Progress';

    execute(
      `INSERT INTO production_batches (
        id, business_id, batch_number, start_date, end_date, machine_line, operator_id,
        warehouse_id, total_input_kg, finished_rice_kg, broken_rice_kg, bran_kg, husk_kg,
        waste_loss_kg, approved_variance_kg, variance_reason, variance_approved_by,
        moisture_before, moisture_after, quality_notes, total_input_cost, processing_cost,
        status, sync_status, is_demo, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Synced', ?, ?, ?, ?, ?)`,
      [
        batchId,
        input.businessId,
        batchNumber,
        input.startDate,
        input.endDate ?? (input.completeNow ? now.slice(0, 10) : null),
        input.machineLine ?? 'Main Mill Line 1',
        input.operatorId ?? input.userId,
        input.warehouseId,
        totalInputKg,
        finishedRiceKg,
        brokenRiceKg,
        branKg,
        huskKg,
        wasteLossKg,
        approvedVarianceKg,
        input.varianceReason ?? null,
        input.approveVariance ? input.userId : null,
        input.moistureBefore ?? null,
        input.moistureAfter ?? null,
        input.qualityNotes ?? null,
        totalInputCost,
        processingCost,
        status,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    for (const ri of resolvedInputs) {
      execute(
        `INSERT INTO production_inputs (
          id, business_id, batch_id, lot_id, product_id, qty_kg, unit_cost_per_kg, total_cost, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), input.businessId, batchId, ri.lotId, ri.productId, ri.qtyKg, ri.unitCost, ri.totalCost, now]
      );

      if (input.completeNow) {
        recordInventoryMovement({
          businessId: input.businessId,
          movementType: 'PRODUCTION_OUT',
          productId: ri.productId,
          lotId: ri.lotId,
          batchId,
          warehouseId: ri.warehouseId,
          qtyKg: -ri.qtyKg,
          unitCost: ri.unitCost,
          totalCost: -ri.totalCost,
          sourceDocType: 'PRODUCTION_BATCH',
          sourceDocId: batchId,
          sourceDocNumber: batchNumber,
          note: `Consumed from ${ri.lotNumber} in ${batchNumber}`,
          userId: input.userId,
          isDemo: input.isDemo ?? 0,
        });
        execute(
          `UPDATE inbound_lots SET status = CASE WHEN status = 'Received' THEN 'In Processing' ELSE status END, updated_at = ? WHERE id = ?`,
          [now, ri.lotId]
        );
      }
    }

    // Allocate cost across non-waste outputs (weighted by costSharePercent if provided, or relative market value/weight)
    const valuableOutputs = input.outputs.filter((o) => o.outputCategory !== 'WASTE' && o.qtyKg > 0);
    const totalExplicitShare = valuableOutputs.reduce((acc, o) => acc + (o.costSharePercent || 0), 0);

    // Weight factors if explicit shares aren't supplied: Rice=1.0, Broken=0.55, Bran=0.35, Husk=0.1
    const categoryWeight = (cat: string) => {
      if (cat === 'FINISHED_RICE') return 1.0;
      if (cat === 'BROKEN_RICE') return 0.55;
      if (cat === 'BRAN') return 0.35;
      if (cat === 'HUSK') return 0.1;
      return 0;
    };
    const totalWeightedQty = valuableOutputs.reduce(
      (acc, o) => acc + o.qtyKg * categoryWeight(o.outputCategory),
      0
    );

    let totalAllocatedCost = 0;
    for (let idx = 0; idx < input.outputs.length; idx++) {
      const out = input.outputs[idx];
      let allocatedCost = 0;
      if (out.outputCategory !== 'WASTE' && out.qtyKg > 0) {
        if (totalExplicitShare > 0) {
          allocatedCost = Number(((totalPoolCost * (out.costSharePercent || 0)) / totalExplicitShare).toFixed(2));
        } else if (totalWeightedQty > 0) {
          const share = (out.qtyKg * categoryWeight(out.outputCategory)) / totalWeightedQty;
          allocatedCost = Number((totalPoolCost * share).toFixed(2));
        }
      }
      totalAllocatedCost += allocatedCost;
      const costPerKg = out.qtyKg > 0 ? Number((allocatedCost / out.qtyKg).toFixed(4)) : 0;
      const outWh = out.warehouseId || input.warehouseId;

      execute(
        `INSERT INTO production_outputs (
          id, business_id, batch_id, product_id, output_category, qty_kg,
          allocated_cost, cost_per_kg, warehouse_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          input.businessId,
          batchId,
          out.productId,
          out.outputCategory,
          out.qtyKg,
          allocatedCost,
          costPerKg,
          outWh,
          now,
        ]
      );

      if (input.completeNow && out.outputCategory !== 'WASTE' && out.qtyKg > 0) {
        recordInventoryMovement({
          businessId: input.businessId,
          movementType: 'PRODUCTION_IN',
          productId: out.productId,
          batchId,
          warehouseId: outWh,
          qtyKg: out.qtyKg,
          unitCost: costPerKg,
          totalCost: allocatedCost,
          sourceDocType: 'PRODUCTION_BATCH',
          sourceDocId: batchId,
          sourceDocNumber: batchNumber,
          note: `Output (${out.outputCategory}) from ${batchNumber}`,
          userId: input.userId,
          isDemo: input.isDemo ?? 0,
        });
      }
    }

    // Post balanced accounting journal entry when production batch completes
    if (input.completeNow && totalInputCost > 0) {
      const rawInvAcc = getMappedAccountId(input.businessId, 'RAW_MATERIAL_INVENTORY');
      const fgInvAcc = getMappedAccountId(input.businessId, 'FINISHED_GOODS_INVENTORY');
      const varianceAcc = getMappedAccountId(input.businessId, 'STOCK_VARIANCE');

      const lines: Array<{ accountId: string; debit: number; credit: number; narration?: string }> = [];
      if (totalAllocatedCost > 0) {
        lines.push({
          accountId: fgInvAcc,
          debit: Number(totalAllocatedCost.toFixed(2)),
          credit: 0,
          narration: `Finished rice & by-products from ${batchNumber}`,
        });
      }
      const roundingDiff = Number((totalInputCost - totalAllocatedCost).toFixed(2));
      if (Math.abs(roundingDiff) >= 0.01) {
        if (roundingDiff > 0) {
          lines.push({ accountId: varianceAcc, debit: roundingDiff, credit: 0, narration: 'Milling cost rounding/variance' });
        } else {
          lines.push({ accountId: varianceAcc, debit: 0, credit: Math.abs(roundingDiff), narration: 'Milling cost allocation variance' });
        }
      }
      lines.push({
        accountId: rawInvAcc,
        debit: 0,
        credit: Number(totalInputCost.toFixed(2)),
        narration: `Paddy/raw material consumed in ${batchNumber}`,
      });

      postJournalEntry({
        businessId: input.businessId,
        entryDate: input.endDate || now.slice(0, 10),
        entryType: 'PRODUCTION',
        sourceDocType: 'PRODUCTION_BATCH',
        sourceDocId: batchId,
        sourceDocNumber: batchNumber,
        narration: `Production milling batch ${batchNumber}`,
        lines,
        userId: input.userId,
        deviceId: input.deviceId,
        isDemo: input.isDemo ?? 0,
      });
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: input.completeNow ? 'PRODUCTION_COMPLETED' : 'PRODUCTION_STARTED',
      entityType: 'production_batch',
      entityId: batchId,
      summary: `${batchNumber}: Input ${totalInputKg} kg -> Finished ${finishedRiceKg} kg, Broken ${brokenRiceKg} kg, Bran ${branKg} kg, Husk ${huskKg} kg`,
    });

    return getProductionBatch(input.businessId, batchId);
  });
}

export function getProductionBatch(businessId: string, batchId: string) {
  const batch = queryOne<any>(
    `SELECT pb.*, w.name AS warehouse_name, u.full_name AS operator_name
     FROM production_batches pb
     JOIN warehouses w ON w.id = pb.warehouse_id
     LEFT JOIN users u ON u.id = pb.operator_id
     WHERE pb.id = ? AND pb.business_id = ?`,
    [batchId, businessId]
  );
  if (!batch) return null;

  const inputs = queryAll<any>(
    `SELECT pi.*, l.lot_number, p.name AS product_name
     FROM production_inputs pi
     JOIN inbound_lots l ON l.id = pi.lot_id
     JOIN products p ON p.id = pi.product_id
     WHERE pi.batch_id = ? AND pi.business_id = ?`,
    [batchId, businessId]
  );

  const outputs = queryAll<any>(
    `SELECT po.*, p.name AS product_name, w.name AS warehouse_name
     FROM production_outputs po
     JOIN products p ON p.id = po.product_id
     JOIN warehouses w ON w.id = po.warehouse_id
     WHERE po.batch_id = ? AND po.business_id = ?`,
    [batchId, businessId]
  );

  const totalOut =
    batch.finished_rice_kg +
    batch.broken_rice_kg +
    batch.bran_kg +
    batch.husk_kg +
    batch.waste_loss_kg +
    batch.approved_variance_kg;

  return {
    ...batch,
    inputs,
    outputs,
    mass_balance: {
      input_kg: batch.total_input_kg,
      output_and_loss_kg: totalOut,
      unexplained_variance_kg: Number((batch.total_input_kg - totalOut).toFixed(4)),
    },
  };
}
