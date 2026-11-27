import React, { useEffect, useState } from 'react';
import { Truck, Plus, CheckCircle, AlertTriangle, Calculator, Scale, FileText, Trash2, QrCode } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { StatusBadge } from '../components/StatusBadge';
import { NumericKeypad } from '../components/NumericKeypad';
import { BillPreviewModal, type BillData } from '../components/BillPreviewModal';

export function LotsPage({ onCreateBagsForLot }: { onCreateBagsForLot?: (lot: any) => void }) {
  const { hasPerm, business } = useAuth();
  const { isOnline, snapshot, queueOfflineOp } = useSync();

  const [lots, setLots] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], varieties: [], warehouses: [], taxes: [] });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [keypadField, setKeypadField] = useState<'gross' | 'tare' | 'bagWeight' | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [activeBill, setActiveBill] = useState<BillData | null>(null);

  // Form fields (No Moisture %, No duplicate columns — Customer Name & Customer Phone)
  const [truckNumber, setTruckNumber] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [materialType, setMaterialType] = useState('PADDY');
  const [productId, setProductId] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  // Quick inline variety / product add
  const [newVarietyName, setNewVarietyName] = useState('');
  const [showAddVariety, setShowAddVariety] = useState(false);

  // Weight Mode: EXACT vs BAG_BY_BAG
  const [weightMode, setWeightMode] = useState<'EXACT' | 'BAG_BY_BAG'>('EXACT');
  const [unit, setUnit] = useState('ton');
  const [grossWeight, setGrossWeight] = useState('14.2');
  const [tareWeight, setTareWeight] = useState('4.2');

  // Bag-by-bag weighing state
  const [bagInputKg, setBagInputKg] = useState('50');
  const [bagScanRef, setBagScanRef] = useState('');
  const [weighedBags, setWeighedBags] = useState<Array<{ id: string; netWeightKg: number; tagRef?: string }>>([]);

  // Pricing & Bill System
  const [ratePerUnit, setRatePerUnit] = useState('22');
  const [rateUnit, setRateUnit] = useState('kg');
  const [freightCharges, setFreightCharges] = useState('0');
  const [billType, setBillType] = useState<'SUPPLY_ONLY' | 'GST'>('SUPPLY_ONLY');
  const [taxId, setTaxId] = useState('');
  const [autoGenerateBill, setAutoGenerateBill] = useState(true);
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
      if (!productId && cat.products.length) {
        const match = cat.products.find((p: any) => p.material_type === materialType) || cat.products[0];
        setProductId(match.id);
      }
      if (!varietyId && cat.varieties?.length) setVarietyId(cat.varieties[0].id);
      if (!warehouseId && cat.warehouses.length) setWarehouseId(cat.warehouses[0].id);
      if (!taxId && cat.taxes?.length) {
        const gstTax = cat.taxes.find((tx: any) => tx.rate_percent > 0) || cat.taxes[0];
        setTaxId(gstTax.id);
      }
    } else if (snapshot) {
      setLots(snapshot.lots || []);
      setCatalog({
        products: snapshot.products || [],
        varieties: snapshot.varieties || [],
        warehouses: snapshot.warehouses || [],
        taxes: [],
      });
      setSuppliers(snapshot.suppliers || []);
    }
  };

  useEffect(() => {
    loadData();
  }, [isOnline]);

  // Auto-pick matching product when Material Type changes
  const handleMaterialChange = (mat: string) => {
    setMaterialType(mat);
    const matching = catalog.products.find((p: any) => p.material_type === mat);
    if (matching) setProductId(matching.id);
  };

  const handleQuickAddVariety = async () => {
    if (!newVarietyName.trim()) return;
    try {
      const created = await apiFetch('/masters/varieties', {
        method: 'POST',
        body: JSON.stringify({ name: newVarietyName.trim() }),
      });
      setNewVarietyName('');
      setShowAddVariety(false);
      await loadData();
      if (created?.id) setVarietyId(created.id);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addWeighedBag = (weightVal?: number) => {
    const w = Number(weightVal ?? bagInputKg);
    if (!w || w <= 0) {
      setError('Enter a positive bag weight in kg.');
      return;
    }
    setError('');
    setWeighedBags((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, netWeightKg: Number(w.toFixed(2)), tagRef: bagScanRef.trim() || undefined },
    ]);
    setBagScanRef('');
  };

  const bagByBagTotalKg = Number(weighedBags.reduce((a, b) => a + b.netWeightKg, 0).toFixed(2));
  const unitFactor = unit === 'ton' ? 1000 : unit === 'quintal' ? 100 : unit === 'g' ? 0.001 : unit === 'bag' ? 50 : 1;
  const computedNetPreview = weightMode === 'BAG_BY_BAG' ? bagByBagTotalKg : Math.max(0, Number(grossWeight || 0) - Number(tareWeight || 0));
  const netKgPreview = weightMode === 'BAG_BY_BAG' ? bagByBagTotalKg : computedNetPreview * unitFactor;

  const rateFactor = rateUnit === 'ton' ? 1000 : rateUnit === 'quintal' ? 100 : 1;
  const ratePerKgPreview = Number(ratePerUnit || 0) / rateFactor;
  const selectedTax = catalog.taxes?.find((t: any) => t.id === taxId);
  const taxPercentPreview = billType === 'GST' ? Number(selectedTax?.rate_percent || 0) : 0;
  const goodsSubtotalPreview = netKgPreview * ratePerKgPreview;
  const taxAmtPreview = (goodsSubtotalPreview * taxPercentPreview) / 100;
  const grandTotalPreview = goodsSubtotalPreview + taxAmtPreview + Number(freightCharges || 0);

  const openLotBill = (lot: any) => {
    const gb = lot.generated_bill;
    if (gb) {
      setActiveBill({
        docNumber: gb.doc_number,
        docDate: gb.doc_date,
        billType: (gb.bill_type || lot.bill_type || 'SUPPLY_ONLY') as 'GST' | 'SUPPLY_ONLY',
        partyLabel: 'Customer / Party',
        partyName: lot.customer_name || gb.supplier_name || 'Walk-in Customer',
        partyPhone: lot.customer_phone || gb.supplier_phone || undefined,
        partyGstin: gb.supplier_gstin || undefined,
        truckNumber: lot.truck_number,
        challanNo: lot.supplier_invoice_no || undefined,
        lotNumber: lot.lot_number,
        subtotal: gb.subtotal,
        freightAmount: gb.freight_amount,
        discountAmount: gb.discount_amount,
        taxAmount: gb.tax_amount,
        totalAmount: gb.total_amount,
        lines: (gb.lines || []).map((l: any) => ({
          description: l.description || l.product_name,
          hsnCode: l.hsn_code,
          qtyKg: l.qty_kg,
          ratePerKg: l.rate_per_kg,
          taxRatePercent: l.tax_rate_percent,
          taxAmount: l.tax_amount,
          lineTotal: l.line_total,
        })),
      });
      return;
    }

    // Fallback summary bill view for lots created offline or without linked purchase doc
    const qty = Number(lot.received_qty_kg || 0);
    const rate = Number(lot.rate_per_kg || 0);
    const sub = Number((qty * rate).toFixed(2));
    const freight = Number((lot.freight_charges || 0) + (lot.other_charges || 0));
    setActiveBill({
      docNumber: lot.receiving_number || lot.lot_number,
      docDate: (lot.received_at || lot.created_at || '').slice(0, 10),
      billType: (lot.bill_type || 'SUPPLY_ONLY') as 'GST' | 'SUPPLY_ONLY',
      partyLabel: 'Customer / Party',
      partyName: lot.customer_name || lot.supplier_name || 'Walk-in Customer',
      partyPhone: lot.customer_phone || undefined,
      truckNumber: lot.truck_number,
      challanNo: lot.supplier_invoice_no || undefined,
      lotNumber: lot.lot_number,
      subtotal: sub,
      freightAmount: freight,
      taxAmount: 0,
      totalAmount: Number((sub + freight).toFixed(2)),
      lines: [
        {
          description: lot.product_name,
          hsnCode: lot.hsn_code,
          qtyKg: qty,
          ratePerKg: rate,
          taxRatePercent: 0,
          taxAmount: 0,
          lineTotal: sub,
        },
      ],
    });
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');

    if (weightMode === 'BAG_BY_BAG' && weighedBags.length === 0) {
      setError('Please add at least one bag weight in Bag-by-Bag weighing mode.');
      return;
    }

    const payload = {
      truckNumber,
      supplierId: supplierId || null,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      supplierInvoiceNo,
      materialType,
      productId,
      varietyId: varietyId || null,
      warehouseId,
      weightMode,
      unit: weightMode === 'BAG_BY_BAG' ? 'kg' : unit,
      weighbridgeGross: weightMode === 'BAG_BY_BAG' ? bagByBagTotalKg : Number(grossWeight),
      tareWeight: weightMode === 'BAG_BY_BAG' ? 0 : Number(tareWeight),
      weighedBags: weightMode === 'BAG_BY_BAG' ? weighedBags.map((b) => ({ netWeightKg: b.netWeightKg })) : undefined,
      ratePerUnit: Number(ratePerUnit || 0),
      rateUnit,
      freightCharges: Number(freightCharges || 0),
      billType,
      taxId: billType === 'GST' ? taxId || null : null,
      autoGenerateBill,
      notes,
      status: isOnline ? 'Received' : 'Draft',
    };

    try {
      if (isOnline) {
        const created = await apiFetch('/lots', { method: 'POST', body: JSON.stringify(payload) });
        setMsg(
          `Truck & Lot ${created.lot_number} saved (${created.received_qty_kg} kg)${created.generated_bill ? ` • Bill ${created.generated_bill.doc_number} generated!` : '.'}`
        );
        setShowCreate(false);
        setTruckNumber('');
        setCustomerName('');
        setCustomerPhone('');
        setWeighedBags([]);
        await loadData();
        if (autoGenerateBill) {
          openLotBill(created);
        }
      } else {
        await queueOfflineOp('LOT_DRAFT', 'CREATE_LOT_DRAFT', payload);
        setMsg('Saved offline as Draft Receiving entry. Will sync and generate accounting bill when online.');
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
      await apiFetch(`/lots/${wastageModalLot.id}/wastage`, {
        method: 'POST',
        body: JSON.stringify({ adjustmentKg: Number(wastageKg), reason: wastageReason }),
      });
      setWastageModalLot(null);
      setWastageKg('');
      setWastageReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCompleteLot = async (lot: any) => {
    setError('');
    try {
      await apiFetch(`/lots/${lot.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Completed' }),
      });
      await loadData();
      setMsg(`Lot ${lot.lot_number} marked Completed.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Truck Receiving & Inbound Lots</h1>
          <p className="text-sm text-stone-600">Weighbridge or 1-by-1 bag intake with auto-generated GST / Supply-Only billing.</p>
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
        <form onSubmit={handleCreate} className="card p-4 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-lg text-[#1B4D3E] flex items-center gap-2">
              <Truck className="w-5 h-5" /> New Truck Receipt & Auto Bill
            </h2>
            {/* Bill Type Selector */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBillType('SUPPLY_ONLY')}
                className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                  billType === 'SUPPLY_ONLY' ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]' : 'bg-white border-stone-300'
                }`}
              >
                Supply Only Bill (0%)
              </button>
              <button
                type="button"
                onClick={() => setBillType('GST')}
                className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                  billType === 'GST' ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]' : 'bg-white border-stone-300'
                }`}
              >
                GST Bill (Tax Invoice)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-bold text-stone-600">Truck Number *</label>
              <input value={truckNumber} onChange={(e) => setTruckNumber(e.target.value)} placeholder="MH-48-BM-4291" className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Customer Name *</label>
              <input
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setSupplierId('');
                }}
                list="existing-parties-list"
                placeholder="Enter or select customer/farmer name"
                className="input-field"
                required={!supplierId}
              />
              <datalist id="existing-parties-list">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Customer Phone</label>
              <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Mobile number" className="input-field" />
            </div>

            <div>
              <label className="text-xs font-bold text-stone-600">Challan / Slip No</label>
              <input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Material Type</label>
              <select value={materialType} onChange={(e) => handleMaterialChange(e.target.value)} className="input-field">
                <option value="PADDY">Paddy</option>
                <option value="RICE">Rice</option>
                <option value="BROKEN_RICE">Broken Rice</option>
                <option value="BRAN">Bran</option>
                <option value="HUSK">Husk</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Product *</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input-field" required>
                {catalog.products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-stone-600">Variety</label>
                <button type="button" onClick={() => setShowAddVariety(!showAddVariety)} className="text-[11px] font-bold text-[#1B4D3E] underline">
                  + Add Variety
                </button>
              </div>
              {showAddVariety ? (
                <div className="flex gap-1">
                  <input value={newVarietyName} onChange={(e) => setNewVarietyName(e.target.value)} placeholder="New variety" className="input-field" />
                  <button type="button" onClick={handleQuickAddVariety} className="btn-primary !px-3">Add</button>
                </div>
              ) : (
                <select value={varietyId} onChange={(e) => setVarietyId(e.target.value)} className="input-field">
                  <option value="">-- Select Variety --</option>
                  {(catalog.varieties || []).map((v: any) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="text-xs font-bold text-stone-600">Warehouse (Godown) *</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input-field" required>
                {catalog.warehouses.map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-stone-600">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" className="input-field" />
            </div>
          </div>

          {/* Exact Weight vs 1-by-1 Bag Weighing */}
          <div className="bg-[#FAF7F0] border border-stone-200 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-sm text-[#1B4D3E] flex items-center gap-2">
                <Scale className="w-4 h-4" /> Weight Entry Mode
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWeightMode('EXACT')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                    weightMode === 'EXACT' ? 'bg-[#1B4D3E] text-white' : 'bg-white'
                  }`}
                >
                  Exact Weighbridge Weight
                </button>
                <button
                  type="button"
                  onClick={() => setWeightMode('BAG_BY_BAG')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border ${
                    weightMode === 'BAG_BY_BAG' ? 'bg-[#1B4D3E] text-white' : 'bg-white'
                  }`}
                >
                  Weigh 1-by-1 Bags (Auto Total)
                </button>
              </div>
            </div>

            {weightMode === 'EXACT' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="flex gap-1">
                    <input
                      type="number"
                      step="0.01"
                      value={bagInputKg}
                      onChange={(e) => setBagInputKg(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addWeighedBag();
                        }
                      }}
                      placeholder="Bag weight (kg)"
                      className="input-field"
                    />
                    <button type="button" onClick={() => setKeypadField('bagWeight')} className="btn-secondary !px-3"><Calculator className="w-4 h-4" /></button>
                  </div>
                  <div className="flex gap-1 items-center">
                    <QrCode className="w-4 h-4 text-stone-500 shrink-0" />
                    <input
                      value={bagScanRef}
                      onChange={(e) => setBagScanRef(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addWeighedBag();
                        }
                      }}
                      placeholder="Optional scan/tag ref"
                      className="input-field"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => addWeighedBag()} className="btn-primary flex-1">
                      + Add Bag
                    </button>
                    {[50, 25, 60].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => addWeighedBag(preset)}
                        className="btn-secondary !px-2.5 text-xs"
                      >
                        +{preset}
                      </button>
                    ))}
                  </div>
                </div>

                {weighedBags.length > 0 && (
                  <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-white rounded-xl border border-stone-200">
                    {weighedBags.map((wb, idx) => (
                      <div key={wb.id} className="inline-flex items-center gap-1.5 bg-[#FAF7F0] border border-stone-300 rounded-lg px-2.5 py-1 text-xs font-semibold">
                        <span>#{idx + 1}: <strong>{wb.netWeightKg} kg</strong></span>
                        {wb.tagRef && <span className="text-stone-500">({wb.tagRef})</span>}
                        <button
                          type="button"
                          onClick={() => setWeighedBags((prev) => prev.filter((x) => x.id !== wb.id))}
                          className="text-red-600 hover:text-red-800 ml-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-xs font-semibold text-[#1B4D3E]">
                  Weighed Bags: <strong>{weighedBags.length}</strong> • Total Weight: <strong>{bagByBagTotalKg.toLocaleString('en-IN')} kg</strong> (individual QR bags will be auto-created for this lot)
                </div>
              </div>
            )}
          </div>

          {/* Pricing & Tax Section */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            {billType === 'GST' ? (
              <div>
                <label className="text-xs font-bold text-stone-600">GST Rate</label>
                <select value={taxId} onChange={(e) => setTaxId(e.target.value)} className="input-field">
                  {(catalog.taxes || []).map((tx: any) => (
                    <option key={tx.id} value={tx.id}>{tx.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs font-bold text-[#1B4D3E] cursor-pointer">
                  <input type="checkbox" checked={autoGenerateBill} onChange={(e) => setAutoGenerateBill(e.target.checked)} className="w-4 h-4 accent-[#1B4D3E]" />
                  Auto-Generate Supply Only Bill on Save
                </label>
              </div>
            )}
          </div>

          {billType === 'GST' && (
            <label className="flex items-center gap-2 text-xs font-bold text-[#1B4D3E] cursor-pointer">
              <input type="checkbox" checked={autoGenerateBill} onChange={(e) => setAutoGenerateBill(e.target.checked)} className="w-4 h-4 accent-[#1B4D3E]" />
              Auto-Generate GST Bill on Save
            </label>
          )}

          <div className="bg-[#FAF7F0] border border-emerald-300 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm space-y-0.5">
              <div>
                Net Weight: <strong className="text-[#1B4D3E]">{netKgPreview.toLocaleString('en-IN')} kg</strong>
              </div>
              <div className="text-xs text-stone-700">
                Estimated {billType === 'GST' ? `GST Bill (${taxPercentPreview}% tax)` : 'Supply Only Bill (0% tax)'}: <strong>₹{grandTotalPreview.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">Cancel</button>
              <button type="submit" className="btn-primary">Save Truck & Generate Bill</button>
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
                    Truck: <strong>{lot.truck_number}</strong> • {lot.receiving_number} • Customer: <strong>{lot.customer_name || lot.supplier_name || 'Walk-in'}</strong>
                    {lot.customer_phone ? ` (${lot.customer_phone})` : ''}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={lot.status} />
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-stone-100 border">
                    {lot.bill_type === 'GST' ? 'GST BILL' : 'SUPPLY ONLY'}
                  </span>
                </div>
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
                <button onClick={() => openLotBill(lot)} className="btn-amber !min-h-[40px] !py-1.5 text-xs">
                  <FileText className="w-3.5 h-3.5" /> View / Print Bill
                </button>
                {onCreateBagsForLot && hasPerm('bags.create') && lot.status !== 'Completed' && lot.status !== 'Cancelled' && (
                  <button onClick={() => onCreateBagsForLot(lot)} className="btn-primary !min-h-[40px] !py-1.5 text-xs">
                    Create Bags & QR
                  </button>
                )}
                {hasPerm('lots.manage') && lot.status !== 'Completed' && lot.status !== 'Cancelled' && (
                  <>
                    <button onClick={() => setWastageModalLot(lot)} className="btn-secondary !min-h-[40px] !py-1.5 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" /> Wastage/Adj
                    </button>
                    <button onClick={() => handleCompleteLot(lot)} className="btn-secondary !min-h-[40px] !py-1.5 text-xs">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-700" /> Complete
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
            <h3 className="font-bold text-lg">Wastage / Adjustment — {wastageModalLot.lot_number}</h3>
            <p className="text-xs text-stone-600">
              Remaining unexplained quantity: <strong>{wastageModalLot.summary?.remaining_qty_kg} kg</strong>
            </p>
            <div>
              <label className="text-xs font-bold text-stone-600">Adjustment Quantity (kg)</label>
              <input type="number" step="0.01" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} className="input-field" required />
            </div>
            <div>
              <label className="text-xs font-bold text-stone-600">Approved Reason *</label>
              <input value={wastageReason} onChange={(e) => setWastageReason(e.target.value)} placeholder="Dry weight loss / cleaning dust" className="input-field" required />
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
          label={keypadField === 'gross' ? 'Weighbridge Gross' : keypadField === 'tare' ? 'Tare Weight' : 'Single Bag Weight'}
          initialValue={keypadField === 'gross' ? grossWeight : keypadField === 'tare' ? tareWeight : bagInputKg}
          unit={keypadField === 'bagWeight' ? 'kg' : unit}
          onConfirm={(v) => {
            if (keypadField === 'gross') setGrossWeight(String(v));
            else if (keypadField === 'tare') setTareWeight(String(v));
            else setBagInputKg(String(v));
            setKeypadField(null);
          }}
          onClose={() => setKeypadField(null)}
        />
      )}

      {activeBill && (
        <BillPreviewModal bill={activeBill} business={business} onClose={() => setActiveBill(null)} />
      )}
    </div>
  );
}
