import React, { useEffect, useState } from 'react';
import { Factory, Plus, PackagePlus } from 'lucide-react';
import { apiFetch, isNetworkError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { StatusBadge } from '../components/StatusBadge';

export function ProductionPage() {
  const { hasPerm } = useAuth();
  const { isOnline, outbox, queueOfflineOp } = useSync();
  const [batches, setBatches] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], warehouses: [] });
  const [showCreate, setShowCreate] = useState(false);
  const [packBatch, setPackBatch] = useState<any | null>(null);
  const [packCount, setPackCount] = useState('10');
  const [packWeight, setPackWeight] = useState('50');
  const [packProductId, setPackProductId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Form
  const [lotId, setLotId] = useState('');
  const [inputQtyKg, setInputQtyKg] = useState('2000');
  const [warehouseId, setWarehouseId] = useState('');
  const [machineLine, setMachineLine] = useState('Buhler Mill Line 1');
  const [riceProductId, setRiceProductId] = useState('');
  const [brokenProductId, setBrokenProductId] = useState('');
  const [branProductId, setBranProductId] = useState('');
  const [huskProductId, setHuskProductId] = useState('');
  const [riceKg, setRiceKg] = useState('1300');
  const [brokenKg, setBrokenKg] = useState('160');
  const [branKg, setBranKg] = useState('140');
  const [huskKg, setHuskKg] = useState('370');
  const [wasteKg, setWasteKg] = useState('30');
  const [approvedVarianceKg, setApprovedVarianceKg] = useState('0');
  const [varianceReason, setVarianceReason] = useState('');
  const [approveVariance, setApproveVariance] = useState(false);

  const loadData = async () => {
    const [b, l, cat] = await Promise.all([
      apiFetch<any[]>('/production').catch(() => []),
      apiFetch<any[]>('/lots').catch(() => []),
      apiFetch<any>('/masters/catalog').catch(() => ({ products: [], warehouses: [] })),
    ]);
    const pendingBatches = outbox
      .filter((o) => o.entityType === 'PRODUCTION_DRAFT' && o.syncStatus !== 'Synced')
      .map((o) => ({
        id: `offline-${o.idempotencyKey}`,
        batch_number: `OFF-PRD-${o.idempotencyKey.slice(0, 5).toUpperCase()}`,
        start_date: o.payload.startDate,
        machine_line: o.payload.machineLine,
        total_input_kg: o.payload.inputs?.[0]?.qtyKg || 0,
        status: `Offline (${o.syncStatus})`,
        created_at: o.offlineCreatedAt,
      }));
    setBatches([...pendingBatches, ...b]);
    setLots(l);
    setCatalog(cat);
    if (!lotId && l.length) setLotId(l[0].id);
    if (!warehouseId && cat.warehouses.length) setWarehouseId(cat.warehouses[cat.warehouses.length - 1].id);
    const findType = (t: string) => cat.products.find((p: any) => p.material_type === t)?.id || cat.products[0]?.id || '';
    if (!riceProductId) setRiceProductId(findType('RICE'));
    if (!brokenProductId) setBrokenProductId(findType('BROKEN_RICE'));
    if (!branProductId) setBranProductId(findType('BRAN'));
    if (!huskProductId) setHuskProductId(findType('HUSK'));
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, [isOnline, outbox.length]);

  const totalOut =
    Number(riceKg || 0) +
    Number(brokenKg || 0) +
    Number(branKg || 0) +
    Number(huskKg || 0) +
    Number(wasteKg || 0) +
    Number(approvedVarianceKg || 0);
  const unexplained = Number((Number(inputQtyKg || 0) - totalOut).toFixed(2));

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    const payload = {
      startDate: new Date().toISOString().slice(0, 10),
      machineLine,
      warehouseId,
      inputs: [{ lotId, qtyKg: Number(inputQtyKg) }],
      outputs: [
        { productId: riceProductId, outputCategory: 'FINISHED_RICE', qtyKg: Number(riceKg), warehouseId },
        { productId: brokenProductId, outputCategory: 'BROKEN_RICE', qtyKg: Number(brokenKg), warehouseId },
        { productId: branProductId, outputCategory: 'BRAN', qtyKg: Number(branKg), warehouseId },
        { productId: huskProductId, outputCategory: 'HUSK', qtyKg: Number(huskKg), warehouseId },
        { productId: riceProductId, outputCategory: 'WASTE', qtyKg: Number(wasteKg), warehouseId },
      ],
      approvedVarianceKg: Number(approvedVarianceKg || 0),
      varianceReason,
      approveVariance,
      completeNow: true,
    };
    const saveOfflineProd = async () => {
      await queueOfflineOp('PRODUCTION_DRAFT', 'CREATE_PRODUCTION_OFFLINE', payload);
      setMsg('Production batch saved OFFLINE. Will auto-sync & post stock/accounts when Wi-Fi returns.');
      setShowCreate(false);
      await loadData();
    };
    try {
      if (!isOnline) {
        await saveOfflineProd();
        return;
      }
      const created = await apiFetch('/production', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setMsg(`Production batch ${created.batch_number} completed & posted to stock/accounts.`);
      setShowCreate(false);
      await loadData();
    } catch (err: any) {
      if (isNetworkError(err)) await saveOfflineProd();
      else setError(err.message);
    }
  };

  const handlePackBags = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packBatch) return;
    setError('');
    try {
      const bags = await apiFetch<any[]>('/bags/bulk', {
        method: 'POST',
        body: JSON.stringify({
          sourceType: 'PRODUCTION',
          productionBatchId: packBatch.id,
          productId: packProductId || riceProductId,
          warehouseId: packBatch.warehouse_id,
          batchLotRef: packBatch.batch_number,
          mode: 'FIXED',
          count: Number(packCount),
          fixedNetWeightKg: Number(packWeight),
          fixedTareWeightKg: 0.2,
        }),
      });
      setMsg(`Packed ${bags.length} output bags from ${packBatch.batch_number} with unique QR codes.`);
      setPackBatch(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Production & Milling Batches</h1>
          <p className="text-sm text-stone-600">Paddy input to rice, broken rice, bran, husk & mass-balance verification.</p>
        </div>
        {hasPerm('production.manage') && (
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            <Plus className="w-5 h-5" /> New Milling Batch
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="card p-4 sm:p-5 space-y-4">
          <h2 className="font-bold text-lg text-[#1B4D3E] flex items-center gap-2">
            <Factory className="w-5 h-5" /> Milling Run & Mass Balance
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-600">Input Lot *</label>
              <select value={lotId} onChange={(e) => setLotId(e.target.value)} className="input-field" required>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>{l.lot_number} ({l.product_name})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Input Qty (kg) *</label>
              <input type="number" step="0.1" value={inputQtyKg} onChange={(e) => setInputQtyKg(e.target.value)} className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Output Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input-field" required>
                {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Machine / Line</label>
              <input value={machineLine} onChange={(e) => setMachineLine(e.target.value)} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-600">Finished Rice (kg)</label>
              <input type="number" step="0.1" value={riceKg} onChange={(e) => setRiceKg(e.target.value)} className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Broken Rice (kg)</label>
              <input type="number" step="0.1" value={brokenKg} onChange={(e) => setBrokenKg(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Rice Bran (kg)</label>
              <input type="number" step="0.1" value={branKg} onChange={(e) => setBranKg(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Rice Husk (kg)</label>
              <input type="number" step="0.1" value={huskKg} onChange={(e) => setHuskKg(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Waste / Dust (kg)</label>
              <input type="number" step="0.1" value={wasteKg} onChange={(e) => setWasteKg(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Approved Var (kg)</label>
              <input type="number" step="0.1" value={approvedVarianceKg} onChange={(e) => setApprovedVarianceKg(e.target.value)} className="input-field" />
            </div>
          </div>

          {Number(approvedVarianceKg) !== 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50 p-3 rounded-xl border border-amber-300">
              <input value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Variance approval reason..." className="input-field" required />
              <label className="flex items-center gap-2 text-sm font-bold text-amber-950">
                <input type="checkbox" checked={approveVariance} onChange={(e) => setApproveVariance(e.target.checked)} className="w-4 h-4" />
                Approve Milling Variance
              </label>
            </div>
          )}

          <div className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 ${Math.abs(unexplained) <= 0.5 ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-400'}`}>
            <div className="text-sm font-semibold">
              Mass Balance: Input <strong>{inputQtyKg} kg</strong> = Accounted <strong>{totalOut.toFixed(1)} kg</strong> • Unexplained Variance: <strong>{unexplained} kg</strong>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Complete & Post Batch</button>
            </div>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {batches.map((b) => (
          <div key={b.id} className="card p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-lg text-[#1B4D3E]">{b.batch_number}</div>
                <div className="text-xs text-stone-600">{b.start_date} • {b.machine_line} • {b.warehouse_name}</div>
              </div>
              <StatusBadge status={b.status} />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-[#FAF7F0] p-2 rounded-lg"><div>Input Paddy</div><strong>{b.total_input_kg} kg</strong></div>
              <div className="bg-emerald-50 p-2 rounded-lg"><div>Finished Rice</div><strong>{b.finished_rice_kg} kg</strong></div>
              <div className="bg-[#FAF7F0] p-2 rounded-lg"><div>Broken Rice</div><strong>{b.broken_rice_kg} kg</strong></div>
              <div className="bg-[#FAF7F0] p-2 rounded-lg"><div>Bran</div><strong>{b.bran_kg} kg</strong></div>
              <div className="bg-[#FAF7F0] p-2 rounded-lg"><div>Husk</div><strong>{b.husk_kg} kg</strong></div>
              <div className="bg-[#FAF7F0] p-2 rounded-lg"><div>Waste / Var</div><strong>{b.waste_loss_kg + b.approved_variance_kg} kg</strong></div>
            </div>
            {hasPerm('bags.create') && b.status === 'Completed' && (
              <button
                onClick={() => {
                  setPackBatch(b);
                  setPackProductId(riceProductId);
                }}
                className="btn-secondary !min-h-[40px] !py-1.5 text-xs"
              >
                <PackagePlus className="w-4 h-4 text-[#1B4D3E]" /> Pack Output into QR Bags
              </button>
            )}
          </div>
        ))}
      </div>

      {packBatch && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handlePackBags} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3">
            <h3 className="font-bold text-lg">Pack Bags from {packBatch.batch_number}</h3>
            <div>
              <label className="text-xs font-bold text-stone-600">Output Product</label>
              <select value={packProductId} onChange={(e) => setPackProductId(e.target.value)} className="input-field">
                {catalog.products.filter((p: any) => p.material_type !== 'PADDY').map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-stone-600">Bag Count</label>
                <input type="number" min="1" value={packCount} onChange={(e) => setPackCount(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-600">Net Weight / Bag (kg)</label>
                <input type="number" step="0.1" value={packWeight} onChange={(e) => setPackWeight(e.target.value)} className="input-field" required />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPackBatch(null)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Create QR Bags</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
