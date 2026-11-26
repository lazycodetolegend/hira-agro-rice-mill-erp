import React, { useEffect, useState } from 'react';
import { PackagePlus, Printer, QrCode, Eye, Calculator } from 'lucide-react';
import { apiFetch, safeRandomUUID } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { generateClientQrToken, listOfflineBags, putOfflineBag } from '../offline/db';
import { StatusBadge } from '../components/StatusBadge';
import { NumericKeypad } from '../components/NumericKeypad';
import { exportToCsv, exportToExcel } from '../print/exports';

export function BagsPage({
  initialLot,
  onPrintBags,
}: {
  initialLot?: any;
  onPrintBags: (bags: any[]) => void;
}) {
  const { hasPerm } = useAuth();
  const { isOnline, snapshot, queueOfflineOp } = useSync();

  const [bags, setBags] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(Boolean(initialLot));
  const [detailBag, setDetailBag] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Create form
  const [lots, setLots] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], warehouses: [] });
  const [sourceType, setSourceType] = useState<'LOT' | 'PRODUCTION' | 'OPENING'>(initialLot ? 'LOT' : 'LOT');
  const [lotId, setLotId] = useState(initialLot?.id || '');
  const [productId, setProductId] = useState(initialLot?.product_id || '');
  const [warehouseId, setWarehouseId] = useState(initialLot?.warehouse_id || '');
  const [mode, setMode] = useState<'FIXED' | 'VARIABLE'>('FIXED');
  const [count, setCount] = useState('10');
  const [fixedNetKg, setFixedNetKg] = useState('50');
  const [fixedTareKg, setFixedTareKg] = useState('0.2');
  const [variableWeights, setVariableWeights] = useState<string[]>(['50', '49.8', '50.2']);
  const [keypadIdx, setKeypadIdx] = useState<number | 'fixed' | null>(null);

  const loadData = async () => {
    if (isOnline) {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (search) qs.set('search', search);
      const [bList, lList, cat] = await Promise.all([
        apiFetch<any[]>(`/bags?${qs.toString()}`),
        apiFetch<any[]>('/lots'),
        apiFetch<any>('/masters/catalog'),
      ]);
      setBags(bList);
      setLots(lList);
      setCatalog(cat);
      if (!lotId && lList.length) setLotId(lList[0].id);
      if (!productId && cat.products.length) setProductId(cat.products[0].id);
      if (!warehouseId && cat.warehouses.length) setWarehouseId(cat.warehouses[0].id);
    } else {
      const offBags = await listOfflineBags();
      setBags(offBags);
      if (snapshot) {
        setLots(snapshot.lots || []);
        setCatalog({ products: snapshot.products || [], warehouses: snapshot.warehouses || [] });
      }
    }
  };

  useEffect(() => {
    loadData();
  }, [isOnline, statusFilter]);

  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');

    try {
      if (isOnline) {
        const created = await apiFetch<any[]>('/bags/bulk', {
          method: 'POST',
          body: JSON.stringify({
            sourceType,
            lotId: sourceType === 'LOT' ? lotId : null,
            productId,
            warehouseId,
            mode,
            count: mode === 'FIXED' ? Number(count) : undefined,
            fixedNetWeightKg: mode === 'FIXED' ? Number(fixedNetKg) : undefined,
            fixedTareWeightKg: Number(fixedTareKg),
            variableBags:
              mode === 'VARIABLE'
                ? variableWeights.map((w) => ({ netWeightKg: Number(w), tareWeightKg: Number(fixedTareKg) }))
                : undefined,
          }),
        });
        setMsg(`Created ${created.length} bags with unique QR codes.`);
        setShowCreate(false);
        await loadData();
      } else {
        // Offline bulk bag creation with CSPRNG QR tokens!
        const bagCount = mode === 'FIXED' ? Number(count) : variableWeights.length;
        const prod = catalog.products.find((p: any) => p.id === productId);
        const wh = catalog.warehouses.find((w: any) => w.id === warehouseId);
        const now = new Date().toISOString();
        const clientBags: any[] = [];
        for (let i = 0; i < bagCount; i++) {
          const net = mode === 'FIXED' ? Number(fixedNetKg) : Number(variableWeights[i]);
          const tare = Number(fixedTareKg);
          const id = safeRandomUUID();
          const qrToken = generateClientQrToken();
          const bagNum = `BAG-OFF-${Date.now().toString().slice(-5)}-${String(i + 1).padStart(3, '0')}`;
          const localBag = {
            id,
            bag_number: bagNum,
            qr_token: qrToken,
            source_type: sourceType,
            lot_id: sourceType === 'LOT' ? lotId : null,
            product_id: productId,
            product_name: prod?.name || 'Rice/Paddy',
            warehouse_id: warehouseId,
            warehouse_name: wh?.name || 'Godown',
            net_weight_kg: net,
            tare_weight_kg: tare,
            gross_weight_kg: net + tare,
            packing_date: now.slice(0, 10),
            current_status: 'Generated',
            sync_status: 'Local',
            created_at: now,
          };
          await putOfflineBag(localBag);
          clientBags.push({ id, bagNumber: bagNum, qrToken, netWeightKg: net, tareWeightKg: tare });
        }
        await queueOfflineOp('BAGS_CREATE', 'BULK_CREATE_OFFLINE', {
          sourceType,
          lotId: sourceType === 'LOT' ? lotId : null,
          productId,
          warehouseId,
          mode,
          fixedTareWeightKg: Number(fixedTareKg),
          clientBags,
        });
        setMsg(`Created ${clientBags.length} bags offline with QR codes (queued for sync).`);
        setShowCreate(false);
        await loadData();
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const openBagDetail = async (bag: any) => {
    if (isOnline) {
      try {
        const full = await apiFetch(`/bags/${bag.id}`);
        setDetailBag(full);
        return;
      } catch {
        // fallback
      }
    }
    setDetailBag(bag);
  };

  const selectedBags = bags.filter((b) => selectedIds.has(b.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Bag Master & QR Generation</h1>
          <p className="text-sm text-stone-600">Bulk fixed or variable weight bags with cryptographically random QR tokens.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selectedBags.length > 0 && hasPerm('bags.print') && (
            <button onClick={() => onPrintBags(selectedBags)} className="btn-amber">
              <Printer className="w-5 h-5" /> Print {selectedBags.length} QR Labels
            </button>
          )}
          {hasPerm('bags.create') && (
            <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
              <PackagePlus className="w-5 h-5" /> Create Bags
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {showCreate && (
        <form onSubmit={handleBulkCreate} className="card p-4 sm:p-5 space-y-4">
          <h2 className="font-bold text-lg text-[#1B4D3E]">Create Individual / Bulk Bags</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-600">Source</label>
              <select value={sourceType} onChange={(e) => setSourceType(e.target.value as any)} className="input-field">
                <option value="LOT">Inbound Truck Lot</option>
                <option value="OPENING">Opening / Direct Stock</option>
              </select>
            </div>
            {sourceType === 'LOT' && (
              <div>
                <label className="text-xs font-bold text-stone-600">Inbound Lot *</label>
                <select
                  value={lotId}
                  onChange={(e) => {
                    setLotId(e.target.value);
                    const found = lots.find((l) => l.id === e.target.value);
                    if (found) {
                      setProductId(found.product_id);
                      setWarehouseId(found.warehouse_id);
                    }
                  }}
                  className="input-field"
                  required
                >
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.lot_number} ({l.summary?.remaining_qty_kg ?? l.received_qty_kg} kg left)
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-xs font-bold text-stone-600">Product *</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input-field" required>
                {catalog.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Warehouse *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input-field" required>
                {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('FIXED')}
              className={`px-4 py-2 rounded-xl font-bold text-sm border ${mode === 'FIXED' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}
            >
              Fixed-Weight Bulk Bags
            </button>
            <button
              type="button"
              onClick={() => setMode('VARIABLE')}
              className={`px-4 py-2 rounded-xl font-bold text-sm border ${mode === 'VARIABLE' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}
            >
              Variable-Weight Bags
            </button>
          </div>

          {mode === 'FIXED' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-stone-600">Number of Bags (1 - 1000)</label>
                <input type="number" min="1" max="1000" value={count} onChange={(e) => setCount(e.target.value)} className="input-field" required />
              </div>
              <div>
                <label className="text-xs font-bold text-stone-600">Net Weight per Bag (kg)</label>
                <div className="flex gap-1">
                  <input type="number" step="0.01" value={fixedNetKg} onChange={(e) => setFixedNetKg(e.target.value)} className="input-field" required />
                  <button type="button" onClick={() => setKeypadIdx('fixed')} className="btn-secondary !px-3"><Calculator className="w-4 h-4" /></button>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-stone-600">Tare / Empty Bag Weight (kg)</label>
                <input type="number" step="0.01" value={fixedTareKg} onChange={(e) => setFixedTareKg(e.target.value)} className="input-field" required />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-600">Individual Bag Weights (kg)</span>
                <button
                  type="button"
                  onClick={() => setVariableWeights([...variableWeights, '50'])}
                  className="btn-secondary !min-h-[36px] !py-1 text-xs"
                >
                  + Add Bag Row
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {variableWeights.map((w, idx) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <span className="text-xs font-bold w-6">#{idx + 1}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={w}
                      onChange={(e) => {
                        const copy = [...variableWeights];
                        copy[idx] = e.target.value;
                        setVariableWeights(copy);
                      }}
                      className="input-field !min-h-[40px]"
                    />
                    <button type="button" onClick={() => setKeypadIdx(idx)} className="btn-secondary !min-h-[40px] !px-2"><Calculator className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary">Generate Bags & QR Tokens</button>
          </div>
        </form>
      )}

      {/* Filters & Export */}
      <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadData()}
            placeholder="Filter by bag number or QR..."
            className="input-field !w-56 !min-h-[40px] text-sm"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field !w-44 !min-h-[40px] text-sm">
            <option value="">All Statuses</option>
            {['Generated', 'Printed', 'Sealed', 'In Stock', 'Sold', 'Damaged', 'Cancelled'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={loadData} className="btn-secondary !min-h-[40px] !py-1.5 text-sm">Filter</button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToCsv('bags_export.csv', bags)}
            className="btn-secondary !min-h-[40px] !py-1.5 text-xs"
          >
            CSV
          </button>
          <button
            onClick={() => exportToExcel('bags_export.xlsx', 'Bags', bags)}
            className="btn-secondary !min-h-[40px] !py-1.5 text-xs"
          >
            Excel
          </button>
        </div>
      </div>

      {/* Bag Table */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b border-stone-200">
            <tr>
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={bags.length > 0 && selectedIds.size === bags.length}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedIds(new Set(bags.map((b) => b.id)));
                    else setSelectedIds(new Set());
                  }}
                  className="w-4 h-4 accent-[#1B4D3E]"
                />
              </th>
              <th className="p-3">Bag Number</th>
              <th className="p-3">Product</th>
              <th className="p-3">Net Wt</th>
              <th className="p-3">Lot / Batch</th>
              <th className="p-3">Warehouse</th>
              <th className="p-3">Status</th>
              <th className="p-3">QR Token (Opaque)</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {bags.map((b) => (
              <tr key={b.id} className="hover:bg-stone-50">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(b.id)}
                    onChange={() => toggleSelect(b.id)}
                    className="w-4 h-4 accent-[#1B4D3E]"
                  />
                </td>
                <td className="p-3 font-bold text-[#1B4D3E]">{b.bag_number}</td>
                <td className="p-3">{b.product_name}</td>
                <td className="p-3 font-semibold">{b.net_weight_kg} kg</td>
                <td className="p-3 text-xs">{b.lot_number || b.production_batch_number || b.batch_lot_ref || '—'}</td>
                <td className="p-3 text-xs">{b.warehouse_name}</td>
                <td className="p-3">
                  <div className="flex items-center gap-1">
                    <StatusBadge status={b.current_status} />
                    {b.sync_status === 'Local' && <StatusBadge status="Local" />}
                  </div>
                </td>
                <td className="p-3 font-mono text-xs text-stone-500">
                  <span className="inline-flex items-center gap-1"><QrCode className="w-3.5 h-3.5" /> {b.qr_token.slice(0, 12)}…</span>
                </td>
                <td className="p-3">
                  <button onClick={() => openBagDetail(b)} className="btn-secondary !min-h-[34px] !py-1 !px-2.5 text-xs">
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bag Detail Modal */}
      {detailBag && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold text-[#1B4D3E]">{detailBag.bag_number}</h3>
                <div className="text-xs font-mono text-stone-500">QR Token: {detailBag.qr_token}</div>
              </div>
              <StatusBadge status={detailBag.current_status} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Product:</strong> {detailBag.product_name}</div>
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Net Weight:</strong> {detailBag.net_weight_kg} kg</div>
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Lot / Batch:</strong> {detailBag.lot_number || detailBag.production_batch_number || '—'}</div>
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Warehouse:</strong> {detailBag.warehouse_name}</div>
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Packing Date:</strong> {detailBag.packing_date}</div>
              <div className="bg-[#FAF7F0] p-2.5 rounded-xl"><strong>Print Count:</strong> {detailBag.print_count || 0}</div>
            </div>
            {Array.isArray(detailBag.events) && (
              <div>
                <div className="text-xs font-bold uppercase text-stone-500 mb-1.5">Immutable Event History</div>
                <div className="space-y-1.5">
                  {detailBag.events.map((ev: any) => (
                    <div key={ev.id} className="text-xs p-2 rounded-lg bg-[#FAF7F0] border border-stone-200 flex justify-between">
                      <span><strong>{ev.previous_status ? `${ev.previous_status} → ` : ''}{ev.new_status}</strong> {ev.note ? `(${ev.note})` : ''}</span>
                      <span className="text-stone-500">{new Date(ev.occurred_at).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              {hasPerm('bags.print') && (
                <button onClick={() => { onPrintBags([detailBag]); setDetailBag(null); }} className="btn-amber">
                  <Printer className="w-4 h-4" /> Print Label
                </button>
              )}
              <button onClick={() => setDetailBag(null)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {keypadIdx !== null && (
        <NumericKeypad
          label={keypadIdx === 'fixed' ? 'Net Weight per Bag' : `Bag #${Number(keypadIdx) + 1} Weight`}
          initialValue={keypadIdx === 'fixed' ? fixedNetKg : variableWeights[Number(keypadIdx)]}
          unit="kg"
          onConfirm={(v) => {
            if (keypadIdx === 'fixed') setFixedNetKg(String(v));
            else {
              const copy = [...variableWeights];
              copy[Number(keypadIdx)] = String(v);
              setVariableWeights(copy);
            }
            setKeypadIdx(null);
          }}
          onClose={() => setKeypadIdx(null)}
        />
      )}
    </div>
  );
}
