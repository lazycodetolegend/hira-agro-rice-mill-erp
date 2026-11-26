import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { exportToCsv, exportToExcel, exportTableToPdf } from '../print/exports';

export function InventoryPage() {
  const { hasPerm } = useAuth();
  const [valuation, setValuation] = useState<any>({ valuation_method: 'WEIGHTED_AVG', items: [], total_qty_kg: 0, total_value: 0 });
  const [ledger, setLedger] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], warehouses: [] });
  const [tab, setTab] = useState<'BALANCES' | 'LEDGER'>('BALANCES');
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Transfer/Adjust forms
  const [productId, setProductId] = useState('');
  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [qtyKg, setQtyKg] = useState('100');
  const [reason, setReason] = useState('');

  const loadData = async () => {
    const [bal, led, cat] = await Promise.all([
      apiFetch<any>('/inventory/balances'),
      apiFetch<any[]>('/inventory/ledger'),
      apiFetch<any>('/masters/catalog'),
    ]);
    setValuation(bal);
    setLedger(led);
    setCatalog(cat);
    if (!productId && cat.products.length) setProductId(cat.products[0].id);
    if (!fromWh && cat.warehouses.length) setFromWh(cat.warehouses[0].id);
    if (!toWh && cat.warehouses.length > 1) setToWh(cat.warehouses[1].id);
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await apiFetch('/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({ productId, fromWarehouseId: fromWh, toWarehouseId: toWh, qtyKg: Number(qtyKg), note: reason }),
      });
      setMsg(`Warehouse transfer ${res.refNum} recorded (${res.transferQty} kg).`);
      setShowTransfer(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const res = await apiFetch('/inventory/adjustment', {
        method: 'POST',
        body: JSON.stringify({ productId, warehouseId: fromWh, deltaQtyKg: Number(qtyKg), reason, movementType: 'STOCK_COUNT' }),
      });
      setMsg(`Stock adjustment ${res.docNum} recorded & posted.`);
      setShowAdjust(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Inventory & Stock Ledger</h1>
          <p className="text-sm text-stone-600">
            Valuation Method: <strong className="text-[#1B4D3E]">{valuation.valuation_method}</strong> • Total Stock: <strong>{valuation.total_qty_kg.toLocaleString('en-IN')} kg</strong> • Value: <strong>₹{valuation.total_value.toLocaleString('en-IN')}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPerm('inventory.move') && (
            <button onClick={() => { setShowTransfer(!showTransfer); setShowAdjust(false); }} className="btn-secondary !min-h-[42px]">
              <ArrowRightLeft className="w-4 h-4" /> Transfer
            </button>
          )}
          {hasPerm('inventory.adjust') && (
            <button onClick={() => { setShowAdjust(!showAdjust); setShowTransfer(false); }} className="btn-amber !min-h-[42px]">
              <SlidersHorizontal className="w-4 h-4" /> Stock Count / Adj
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {showTransfer && (
        <form onSubmit={handleTransfer} className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input-field">
            {catalog.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={fromWh} onChange={(e) => setFromWh(e.target.value)} className="input-field">
            {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>From: {w.name}</option>)}
          </select>
          <select value={toWh} onChange={(e) => setToWh(e.target.value)} className="input-field">
            {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>To: {w.name}</option>)}
          </select>
          <input type="number" step="0.1" value={qtyKg} onChange={(e) => setQtyKg(e.target.value)} placeholder="Qty kg" className="input-field" required />
          <button type="submit" className="btn-primary">Execute Transfer</button>
        </form>
      )}

      {showAdjust && (
        <form onSubmit={handleAdjust} className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input-field">
            {catalog.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={fromWh} onChange={(e) => setFromWh(e.target.value)} className="input-field">
            {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input type="number" step="0.1" value={qtyKg} onChange={(e) => setQtyKg(e.target.value)} placeholder="Delta kg (+/-)" className="input-field" required />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Approved reason *" className="input-field" required />
          <button type="submit" className="btn-amber">Post Adjustment</button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button onClick={() => setTab('BALANCES')} className={`px-4 py-2 rounded-xl font-bold text-sm border ${tab === 'BALANCES' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
            Stock Balances & Valuation
          </button>
          <button onClick={() => setTab('LEDGER')} className={`px-4 py-2 rounded-xl font-bold text-sm border ${tab === 'LEDGER' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
            Stock Movement Ledger ({ledger.length})
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportToCsv('stock_report.csv', tab === 'BALANCES' ? valuation.items : ledger)} className="btn-secondary !min-h-[38px] !py-1 text-xs">CSV</button>
          <button onClick={() => exportToExcel('stock_report.xlsx', tab, tab === 'BALANCES' ? valuation.items : ledger)} className="btn-secondary !min-h-[38px] !py-1 text-xs">Excel</button>
          <button
            onClick={() =>
              exportTableToPdf(
                'stock_valuation.pdf',
                'Stock Valuation Report',
                `Method: ${valuation.valuation_method}`,
                ['Product', 'Warehouse', 'Qty (kg)', 'Avg Cost', 'Value (INR)'],
                valuation.items.map((i: any) => [i.product_name, i.warehouse_name || '-', i.qty_kg, i.avg_cost_per_kg, i.total_value])
              )
            }
            className="btn-secondary !min-h-[38px] !py-1 text-xs"
          >
            PDF
          </button>
        </div>
      </div>

      {tab === 'BALANCES' ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b border-stone-200">
              <tr>
                <th className="p-3">SKU</th>
                <th className="p-3">Product</th>
                <th className="p-3">Warehouse</th>
                <th className="p-3 text-right">Stock Qty (kg)</th>
                <th className="p-3 text-right">Avg Cost (₹/kg)</th>
                <th className="p-3 text-right">Stock Value (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {valuation.items.map((item: any, i: number) => (
                <tr key={i} className={item.is_low_stock ? 'bg-amber-50/70' : ''}>
                  <td className="p-3 font-mono text-xs">{item.sku}</td>
                  <td className="p-3 font-semibold">{item.product_name}</td>
                  <td className="p-3">{item.warehouse_name || '—'}</td>
                  <td className="p-3 text-right font-bold">{item.qty_kg.toLocaleString('en-IN')}</td>
                  <td className="p-3 text-right">₹{item.avg_cost_per_kg.toLocaleString('en-IN')}</td>
                  <td className="p-3 text-right font-bold text-[#1B4D3E]">₹{item.total_value.toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-[#FAF7F0] uppercase text-stone-600 border-b border-stone-200">
              <tr>
                <th className="p-2.5">Date</th>
                <th className="p-2.5">Type</th>
                <th className="p-2.5">Product</th>
                <th className="p-2.5">Warehouse</th>
                <th className="p-2.5">Ref / Bag / Lot</th>
                <th className="p-2.5 text-right">Qty (kg)</th>
                <th className="p-2.5 text-right">Value (₹)</th>
                <th className="p-2.5">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {ledger.map((m) => (
                <tr key={m.id}>
                  <td className="p-2.5">{new Date(m.occurred_at).toLocaleDateString('en-IN')}</td>
                  <td className="p-2.5 font-semibold">{m.movement_type}</td>
                  <td className="p-2.5">{m.product_name}</td>
                  <td className="p-2.5">{m.warehouse_name}</td>
                  <td className="p-2.5">{m.source_doc_number || m.bag_number || m.lot_number || '—'}</td>
                  <td className={`p-2.5 text-right font-bold ${m.qty_kg < 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                    {m.qty_kg > 0 ? `+${m.qty_kg}` : m.qty_kg}
                  </td>
                  <td className="p-2.5 text-right">₹{Number(m.total_cost || 0).toLocaleString('en-IN')}</td>
                  <td className="p-2.5">{m.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
