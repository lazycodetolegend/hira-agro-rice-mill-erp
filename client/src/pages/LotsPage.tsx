import React, { useEffect, useState } from 'react';
import { Truck, Plus, CheckCircle, AlertTriangle, Calculator } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { StatusBadge } from '../components/StatusBadge';
import { NumericKeypad } from '../components/NumericKeypad';

export function LotsPage({ onCreateBagsForLot }: { onCreateBagsForLot?: (lot: any) => void }) {
  const { hasPerm } = useAuth();
  const { isOnline, snapshot, queueOfflineOp } = useSync();

  const [lots, setLots] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], warehouses: [], taxes: [] });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedLot, setSelectedLot] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [keypadField, setKeypadField] = useState<'gross' | 'tare' | 'rate' | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Form fields
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [materialType, setMaterialType] = useState('PADDY');
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [unit, setUnit] = useState('ton');
  const [grossWeight, setGrossWeight] = useState('14.2');
  const [tareWeight, setTareWeight] = useState('4.2');
  const [moisturePercent, setMoisturePercent] = useState('14.0');
  const [foreignMatterPercent, setForeignMatterPercent] = useState('1.0');
  const [ratePerUnit, setRatePerUnit] = useState('22');
  const [rateUnit, setRateUnit] = useState('kg');
  const [freightCharges, setFreightCharges] = useState('0');
  const [notes, setNotes] = useState('');

  // Wastage adjustment modal
  const [wastageModalLot, setWastageModalLot] = useState<any | null>(null);
  const [wastageKg, setWastageKg] = useState('');
  const [wastageReason, setWastageReason] = useState('');

  const loadData = async () => {
    if (isOnline) {
      const [l, cat, sups] = await Promise.all([
        apiFetch<any[]>('/lots'),
        apiFetch<any>('/masters/catalog'),
        apiFetch<any[]>('/masters/suppliers'),
      ]);
      setLots(l);
      setCatalog(cat);
      setSuppliers(sups);
      if (!productId && cat.products.length) setProductId(cat.products[0].id);
      if (!warehouseId && cat.warehouses.length) setWarehouseId(cat.warehouses[0].id);
      if (!supplierId && sups.length) setSupplierId(sups[0].id);
    } else if (snapshot) {
      setLots(snapshot.lots || []);
      setCatalog({ products: snapshot.products || [], warehouses: snapshot.warehouses || [] });
      setSuppliers(snapshot.suppliers || []);
    }
  };

  useEffect(() => {
    loadData();
  }, [isOnline]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    const payload = {
      truckNumber,
      driverName,
      driverPhone,
      supplierId: supplierId || null,
      supplierInvoiceNo,
      materialType,
      productId,
      warehouseId,
      unit,
      weighbridgeGross: Number(grossWeight),
      tareWeight: Number(tareWeight),
      moisturePercent: moisturePercent ? Number(moisturePercent) : undefined,
      foreignMatterPercent: foreignMatterPercent ? Number(foreignMatterPercent) : undefined,
      ratePerUnit: Number(ratePerUnit || 0),
      rateUnit,
      freightCharges: Number(freightCharges || 0),
      notes,
      status: isOnline ? 'Received' : 'Draft',
    };

    try {
      if (isOnline) {
        const created = await apiFetch('/lots', { method: 'POST', body: JSON.stringify(payload) });
        setMsg(`Truck & Lot ${created.lot_number} created (${created.received_qty_kg} kg).`);
        setShowCreate(false);
        setTruckNumber('');
        await loadData();
      } else {
        await queueOfflineOp('LOT_DRAFT', 'CREATE_LOT_DRAFT', payload);
        setMsg('Saved offline as Draft Receiving entry. Will sync when online.');
        setShowCreate(false);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wastageModalLot) return;
    setError('');
    try {
      const updated = await apiFetch(`/lots/${wastageModalLot.id}/wastage`, {
        method: 'POST',
        body: JSON.stringify({ adjustmentKg: Number(wastageKg), reason: wastageReason }),
      });
      setWastageModalLot(null);
      setWastageKg('');
      setWastageReason('');
      setSelectedLot(updated);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCompleteLot = async (lot: any) => {
    setError('');
    try {
      const updated = await apiFetch(`/lots/${lot.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Completed' }),
      });
      setSelectedLot(updated);
      await loadData();
      setMsg(`Lot ${lot.lot_number} marked Completed.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const computedNetPreview = Math.max(0, Number(grossWeight || 0) - Number(tareWeight || 0));
  const unitFactor = unit === 'ton' ? 1000 : unit === 'quintal' ? 100 : unit === 'g' ? 0.001 : unit === 'bag' ? 50 : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Truck Receiving & Inbound Lots</h1>
          <p className="text-sm text-stone-600">Weighbridge intake normalized to kg with lot mass-balance tracking.</p>
        </div>
        {hasPerm('lots.manage') && (
          <button onClick={() => setShowCreate(!showCreate)} className="btn-primary">
            <Plus className="w-5 h-5" /> Receive New Truck
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="card p-4 sm:p-6 space-y-4">
          <h2 className="font-bold text-lg text-[#1B4D3E] flex items-center gap-2">
            <Truck className="w-5 h-5" /> New Truck Weighbridge Receipt
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-600">Truck Number *</label>
              <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} placeholder="MH-35-AG-1234" className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Supplier</label>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input-field">
                <option value="">-- Select Supplier --</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Supplier Challan / Invoice</label>
              <input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Material Type</label>
              <select value={materialType} onChange={(e) => setMaterialType(e.target.value)} className="input-field">
                <option value="PADDY">Paddy</option>
                <option value="RICE">Rice</option>
                <option value="BROKEN_RICE">Broken Rice</option>
                <option value="BRAN">Bran</option>
                <option value="HUSK">Husk</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Product / Variety *</label>
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

            <div>
              <label className="text-xs font-bold text-stone-600">Weight Unit</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="input-field">
                <option value="ton">Metric Ton (1,000 kg)</option>
                <option value="quintal">Quintal (100 kg)</option>
                <option value="kg">Kilogram (kg)</option>
                <option value="g">Gram (g)</option>
                <option value="bag">Bag (50 kg)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Weighbridge Gross ({unit})</label>
              <div className="flex gap-1">
                <input type="number" step="0.001" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} className="input-field" required />
                <button type="button" onClick={() => setKeypadField('gross')} className="btn-secondary !px-3"><Calculator className="w-4 h-4" /></button>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Tare Weight ({unit})</label>
              <div className="flex gap-1">
                <input type="number" step="0.001" value={tareWeight} onChange={(e) => setTareWeight(e.target.value)} className="input-field" required />
                <button type="button" onClick={() => setKeypadField('tare')} className="btn-secondary !px-3"><Calculator className="w-4 h-4" /></button>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-stone-600">Rate (₹ per {rateUnit})</label>
              <div className="flex gap-1">
                <input type="number" step="0.01" value={ratePerUnit} onChange={(e) => setRatePerUnit(e.target.value)} className="input-field" />
                <select value={rateUnit} onChange={(e) => setRateUnit(e.target.value)} className="input-field !w-24">
                  <option value="kg">/kg</option>
                  <option value="quintal">/qtl</option>
                  <option value="ton">/ton</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Freight & Other Charges (₹)</label>
              <input type="number" step="0.01" value={freightCharges} onChange={(e) => setFreightCharges(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Moisture % / Foreign Matter %</label>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.1" value={moisturePercent} onChange={(e) => setMoisturePercent(e.target.value)} placeholder="Moist %" className="input-field" />
                <input type="number" step="0.1" value={foreignMatterPercent} onChange={(e) => setForeignMatterPercent(e.target.value)} placeholder="FM %" className="input-field" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Driver Name</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Driver Phone</label>
              <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field" />
            </div>
          </div>

          <div className="bg-[#FAF7F0] border border-emerald-300 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-sm">
              Calculated Net Weight: <strong className="text-[#1B4D3E]">{computedNetPreview} {unit} = {(computedNetPreview * unitFactor).toLocaleString('en-IN')} kg</strong>
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save Truck & Lot</button>
            </div>
          </div>
        </form>
      )}

      {/* Lot List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {lots.map((lot) => {
          const sum = lot.summary || {};
          return (
            <div key={lot.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold text-lg text-[#1B4D3E]">{lot.lot_number}</div>
                  <div className="text-xs text-stone-600">
                    Truck: <strong>{lot.truck_number}</strong> • {lot.receiving_number} • {lot.supplier_name || 'Direct'}
                  </div>
                </div>
                <StatusBadge status={lot.status} />
              </div>

              <div className="text-sm font-semibold">{lot.product_name} ({lot.warehouse_name})</div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-[#FAF7F0] p-2 rounded-lg">
                  <div className="text-stone-500">Received</div>
                  <div className="font-bold text-sm">{Number(lot.received_qty_kg).toLocaleString('en-IN')} kg</div>
                </div>
                <div className="bg-[#FAF7F0] p-2 rounded-lg">
                  <div className="text-stone-500">Bagged ({sum.bag_count || 0})</div>
                  <div className="font-bold text-sm">{Number(sum.total_assigned_to_bags_kg || 0).toLocaleString('en-IN')} kg</div>
                </div>
                <div className="bg-[#FAF7F0] p-2 rounded-lg">
                  <div className="text-stone-500">Sealed</div>
                  <div className="font-bold text-sm">{Number(sum.total_sealed_kg || 0).toLocaleString('en-IN')} kg</div>
                </div>
                <div className="bg-[#FAF7F0] p-2 rounded-lg">
                  <div className="text-stone-500">Milled</div>
                  <div className="font-bold text-sm">{Number(sum.total_consumed_in_production_kg || 0).toLocaleString('en-IN')} kg</div>
                </div>
                <div className="bg-[#FAF7F0] p-2 rounded-lg">
                  <div className="text-stone-500">Wastage Adj</div>
                  <div className="font-bold text-sm">{Number(sum.total_wastage_adjustment_kg || 0).toLocaleString('en-IN')} kg</div>
                </div>
                <div className={`p-2 rounded-lg ${Math.abs(sum.remaining_qty_kg || 0) > 0.5 ? 'bg-amber-50 border border-amber-300' : 'bg-emerald-50'}`}>
                  <div className="text-stone-600">Remaining</div>
                  <div className="font-bold text-sm">{Number(sum.remaining_qty_kg ?? lot.received_qty_kg).toLocaleString('en-IN')} kg</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-stone-200">
                {onCreateBagsForLot && hasPerm('bags.create') && lot.status !== 'Completed' && lot.status !== 'Cancelled' && (
                  <button onClick={() => onCreateBagsForLot(lot)} className="btn-primary !min-h-[40px] !py-1.5 text-xs">
                    Create Bags & QR
                  </button>
                )}
                {hasPerm('lots.manage') && lot.status !== 'Completed' && lot.status !== 'Cancelled' && (
                  <>
                    <button onClick={() => setWastageModalLot(lot)} className="btn-secondary !min-h-[40px] !py-1.5 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" /> Record Wastage/Adj
                    </button>
                    <button onClick={() => handleCompleteLot(lot)} className="btn-secondary !min-h-[40px] !py-1.5 text-xs">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-700" /> Mark Completed
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Wastage Modal */}
      {wastageModalLot && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={handleWastage} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4">
            <h3 className="font-bold text-lg">Wastage / Moisture Loss — {wastageModalLot.lot_number}</h3>
            <p className="text-xs text-stone-600">
              Remaining unexplained quantity: <strong>{wastageModalLot.summary?.remaining_qty_kg} kg</strong>
            </p>
            <div>
              <label className="text-xs font-bold text-stone-600">Adjustment Quantity (kg)</label>
              <input type="number" step="0.01" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Approved Reason *</label>
              <input value={wastageReason} onChange={(e) => setWastageReason(e.target.value)} placeholder="Moisture dry loss / cleaning dust" className="input-field" required />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setWastageModalLot(null)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Approve & Record</button>
            </div>
          </form>
        </div>
      )}

      {keypadField && (
        <NumericKeypad
          label={keypadField === 'gross' ? 'Weighbridge Gross' : 'Tare Weight'}
          initialValue={keypadField === 'gross' ? grossWeight : tareWeight}
          unit={unit}
          onConfirm={(v) => {
            if (keypadField === 'gross') setGrossWeight(String(v));
            if (keypadField === 'tare') setTareWeight(String(v));
            setKeypadField(null);
          }}
          onClose={() => setKeypadField(null)}
        />
      )}

      {selectedLot && null}
    </div>
  );
}
