import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, BookOpen } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatusBadge } from '../components/StatusBadge';

export function CommercialPage() {
  const { hasPerm } = useAuth();
  const [tab, setTab] = useState<'SALES' | 'PURCHASES' | 'EXPENSES' | 'PAYMENTS'>('SALES');

  const [sales, setSales] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any>({ products: [], warehouses: [], taxes: [] });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [sealedBags, setSealedBags] = useState<any[]>([]);
  const [coa, setCoa] = useState<any[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const [journalModal, setJournalModal] = useState<any[] | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Sales form
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleDocType, setSaleDocType] = useState<'INVOICE' | 'ORDER' | 'QUOTATION' | 'RETURN'>('INVOICE');
  const [customerId, setCustomerId] = useState('');
  const [saleMode, setSaleMode] = useState<'BAG' | 'QTY'>('BAG');
  const [selectedBagIds, setSelectedBagIds] = useState<Set<string>>(new Set());
  const [bagScanInput, setBagScanInput] = useState('');
  const [saleProductId, setSaleProductId] = useState('');
  const [saleWarehouseId, setSaleWarehouseId] = useState('');
  const [saleQtyKg, setSaleQtyKg] = useState('100');
  const [saleRate, setSaleRate] = useState('52');
  const [saleTaxId, setSaleTaxId] = useState('');

  // Purchase form
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purDocType, setPurDocType] = useState<'INVOICE' | 'RETURN'>('INVOICE');
  const [supplierId, setSupplierId] = useState('');
  const [purLotId, setPurLotId] = useState('');
  const [purProductId, setPurProductId] = useState('');
  const [purWarehouseId, setPurWarehouseId] = useState('');
  const [purQtyKg, setPurQtyKg] = useState('1000');
  const [purRate, setPurRate] = useState('22');
  const [purFreight, setPurFreight] = useState('0');
  const [purTaxId, setPurTaxId] = useState('');

  // Expense form
  const [showExpForm, setShowExpForm] = useState(false);
  const [expType, setExpType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [expAccId, setExpAccId] = useState('');
  const [expPayAccId, setExpPayAccId] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expAmount, setExpAmount] = useState('2500');
  const [expNotes, setExpNotes] = useState('');

  // Payment/Receipt form
  const [showPayForm, setShowPayForm] = useState(false);
  const [payType, setPayType] = useState<'RECEIPT' | 'PAYMENT' | 'CONTRA'>('RECEIPT');
  const [payPartyId, setPayPartyId] = useState('');
  const [payAccId, setPayAccId] = useState('');
  const [payTargetAccId, setPayTargetAccId] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'BANK' | 'UPI' | 'CHEQUE'>('UPI');
  const [payRef, setPayRef] = useState('');
  const [payAmount, setPayAmount] = useState('5000');

  const loadData = async () => {
    const [cat, sups, custs, bagsRes, lotsRes] = await Promise.all([
      apiFetch<any>('/masters/catalog'),
      apiFetch<any[]>('/masters/suppliers'),
      apiFetch<any[]>('/masters/customers'),
      apiFetch<any[]>('/bags'),
      apiFetch<any[]>('/lots'),
    ]);
    setCatalog(cat);
    setSuppliers(sups);
    setCustomers(custs);
    setSealedBags(bagsRes.filter((b) => ['Sealed', 'In Stock', 'Generated', 'Printed'].includes(b.current_status)));
    setLots(lotsRes);

    if (hasPerm('sales.view')) setSales(await apiFetch('/sales'));
    if (hasPerm('purchases.view')) setPurchases(await apiFetch('/purchases'));
    if (hasPerm('expenses.view')) setExpenses(await apiFetch('/expenses'));
    if (hasPerm('payments.view')) setPayments(await apiFetch('/payments'));
    if (hasPerm('accounting.view')) {
      const accounts = await apiFetch<any[]>('/accounting/coa');
      setCoa(accounts);
      const cashOrBank = accounts.filter((a) => a.subtype === 'CASH' || a.subtype === 'BANK');
      const expAccs = accounts.filter((a) => a.account_type === 'EXPENSE');
      if (!expAccId && expAccs.length) setExpAccId(expAccs[expAccs.length - 1].id);
      if (!expPayAccId && cashOrBank.length) setExpPayAccId(cashOrBank[0].id);
      if (!payAccId && cashOrBank.length) setPayAccId(cashOrBank[0].id);
      if (!payTargetAccId && cashOrBank.length > 1) setPayTargetAccId(cashOrBank[1].id);
    }

    if (!customerId && custs.length) setCustomerId(custs[0].id);
    if (!supplierId && sups.length) setSupplierId(sups[0].id);
    if (!saleProductId && cat.products.length) setSaleProductId(cat.products[1]?.id || cat.products[0].id);
    if (!purProductId && cat.products.length) setPurProductId(cat.products[0].id);
    if (!saleWarehouseId && cat.warehouses.length) setSaleWarehouseId(cat.warehouses[cat.warehouses.length - 1].id);
    if (!purWarehouseId && cat.warehouses.length) setPurWarehouseId(cat.warehouses[0].id);
    if (!saleTaxId && cat.taxes.length) setSaleTaxId(cat.taxes[0].id);
    if (!purTaxId && cat.taxes.length) setPurTaxId(cat.taxes[0].id);
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  const addBagByQrOrNumber = async () => {
    const q = bagScanInput.trim();
    if (!q) return;
    setError('');
    try {
      const res = await apiFetch('/bags/lookup-qr', { method: 'POST', body: JSON.stringify({ token: q }) });
      const found = res.bag || sealedBags.find((b) => b.bag_number.toLowerCase() === q.toLowerCase());
      if (!found) {
        setError('Bag not found for scanned QR / Bag number.');
        return;
      }
      if (['Cancelled', 'Damaged', 'Sold', 'Delivered'].includes(found.current_status)) {
        setError(`Cannot select bag ${found.bag_number}: status is ${found.current_status}.`);
        return;
      }
      setSelectedBagIds((prev) => new Set(prev).add(found.id));
      setBagScanInput('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const lines =
        saleMode === 'BAG'
          ? sealedBags
              .filter((b) => selectedBagIds.has(b.id))
              .map((b) => ({
                productId: b.product_id,
                warehouseId: b.warehouse_id,
                bagId: b.id,
                qtyKg: b.net_weight_kg,
                ratePerKg: Number(saleRate || b.sale_price_per_kg || 52),
                taxId: saleTaxId || null,
              }))
          : [
              {
                productId: saleProductId,
                warehouseId: saleWarehouseId,
                qtyKg: Number(saleQtyKg),
                ratePerKg: Number(saleRate),
                taxId: saleTaxId || null,
              },
            ];

      const doc = await apiFetch('/sales', {
        method: 'POST',
        body: JSON.stringify({
          docType: saleDocType,
          docDate: new Date().toISOString().slice(0, 10),
          customerId,
          lines,
          postImmediately: saleDocType === 'INVOICE' || saleDocType === 'RETURN',
        }),
      });
      setMsg(`Sales ${doc.doc_type} ${doc.doc_number} saved (₹${doc.total_amount}).`);
      setShowSaleForm(false);
      setSelectedBagIds(new Set());
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const doc = await apiFetch('/purchases', {
        method: 'POST',
        body: JSON.stringify({
          docType: purDocType,
          docDate: new Date().toISOString().slice(0, 10),
          supplierId,
          lotId: purLotId || null,
          freightAmount: Number(purFreight || 0),
          lines: [
            {
              productId: purProductId,
              warehouseId: purWarehouseId,
              qtyKg: Number(purQtyKg),
              ratePerKg: Number(purRate),
              taxId: purTaxId || null,
            },
          ],
          postImmediately: true,
        }),
      });
      setMsg(`Purchase ${doc.doc_number} posted (₹${doc.total_amount}) with balanced accounting entry.`);
      setShowPurchaseForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const doc = await apiFetch('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          voucherType: expType,
          voucherDate: new Date().toISOString().slice(0, 10),
          accountId: expAccId,
          paymentAccountId: expPayAccId,
          vendorName: expVendor,
          paymentMethod: 'CASH',
          amount: Number(expAmount),
          notes: expNotes,
          postImmediately: true,
        }),
      });
      setMsg(`${doc.voucher_type} ${doc.voucher_number} posted (₹${doc.total_amount}).`);
      setShowExpForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const doc = await apiFetch('/payments', {
        method: 'POST',
        body: JSON.stringify({
          voucherType: payType,
          voucherDate: new Date().toISOString().slice(0, 10),
          partyType: payType === 'RECEIPT' ? 'CUSTOMER' : payType === 'PAYMENT' ? 'SUPPLIER' : 'NONE',
          partyId: payType === 'CONTRA' ? null : payPartyId || (payType === 'RECEIPT' ? customers[0]?.id : suppliers[0]?.id),
          paymentAccountId: payAccId,
          targetAccountId: payType === 'CONTRA' ? payTargetAccId : null,
          paymentMethod: payMethod,
          referenceNo: payRef,
          amount: Number(payAmount),
          postImmediately: true,
        }),
      });
      setMsg(`${doc.voucher_type} ${doc.voucher_number} posted (₹${doc.amount}).`);
      setShowPayForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const inspectJournals = async (docId: string) => {
    const entries = await apiFetch<any[]>(`/accounting/journals?sourceDocId=${encodeURIComponent(docId)}`);
    setJournalModal(entries);
  };

  const reverseDoc = async (kind: 'sales' | 'purchases', id: string) => {
    const reason = prompt('Enter mandatory reversal reason (posted documents cannot be deleted):');
    if (!reason) return;
    try {
      await apiFetch(`/${kind}/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
      await loadData();
      setMsg('Document reversed via immutable reversal journal entry.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['SALES', 'PURCHASES', 'EXPENSES', 'PAYMENTS'] as const).map((tKey) => (
          <button
            key={tKey}
            onClick={() => setTab(tKey)}
            className={`px-4 py-2.5 rounded-xl font-bold text-sm border ${tab === tKey ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}
          >
            {tKey}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {/* SALES TAB */}
      {tab === 'SALES' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Sales Invoices, Quotations, Orders & Returns</h2>
            {hasPerm('sales.manage') && (
              <button onClick={() => setShowSaleForm(!showSaleForm)} className="btn-primary">
                <Plus className="w-5 h-5" /> New Sale
              </button>
            )}
          </div>

          {showSaleForm && (
            <form onSubmit={handleCreateSale} className="card p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <select value={saleDocType} onChange={(e) => setSaleDocType(e.target.value as any)} className="input-field">
                  <option value="INVOICE">Sales Invoice</option>
                  <option value="ORDER">Sales Order</option>
                  <option value="QUOTATION">Quotation</option>
                  <option value="RETURN">Sales Return / Credit Note</option>
                </select>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="input-field" required>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input type="number" step="0.01" value={saleRate} onChange={(e) => setSaleRate(e.target.value)} placeholder="Rate ₹/kg" className="input-field" required />
                <select value={saleTaxId} onChange={(e) => setSaleTaxId(e.target.value)} className="input-field">
                  {catalog.taxes.map((tx: any) => <option key={tx.id} value={tx.id}>{tx.name} ({tx.rate_percent}%)</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => setSaleMode('BAG')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${saleMode === 'BAG' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
                  Select / Scan Individual QR Bags
                </button>
                <button type="button" onClick={() => setSaleMode('QTY')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${saleMode === 'QTY' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
                  Quantity Sale (kg)
                </button>
              </div>

              {saleMode === 'BAG' ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input value={bagScanInput} onChange={(e) => setBagScanInput(e.target.value)} placeholder="Scan QR token or type bag number..." className="input-field flex-1" />
                    <button type="button" onClick={addBagByQrOrNumber} className="btn-secondary">Add Bag</button>
                  </div>
                  <div className="max-h-44 overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-200">
                    {sealedBags.map((b) => (
                      <label key={b.id} className="flex items-center justify-between p-2 text-xs cursor-pointer hover:bg-stone-50">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedBagIds.has(b.id)}
                            onChange={() => {
                              const next = new Set(selectedBagIds);
                              if (next.has(b.id)) next.delete(b.id);
                              else next.add(b.id);
                              setSelectedBagIds(next);
                            }}
                          />
                          <strong>{b.bag_number}</strong> • {b.product_name} ({b.net_weight_kg} kg)
                        </span>
                        <StatusBadge status={b.current_status} />
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <select value={saleProductId} onChange={(e) => setSaleProductId(e.target.value)} className="input-field">
                    {catalog.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={saleWarehouseId} onChange={(e) => setSaleWarehouseId(e.target.value)} className="input-field">
                    {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <input type="number" step="0.1" value={saleQtyKg} onChange={(e) => setSaleQtyKg(e.target.value)} placeholder="Qty kg" className="input-field" required />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowSaleForm(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">Save & Post Sale</button>
              </div>
            </form>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b">
                <tr>
                  <th className="p-3">Doc #</th><th className="p-3">Date</th><th className="p-3">Customer</th>
                  <th className="p-3 text-right">Total (₹)</th><th className="p-3 text-right">COGS (₹)</th>
                  <th className="p-3">Status</th><th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sales.map((s) => (
                  <tr key={s.id}>
                    <td className="p-3 font-bold text-[#1B4D3E]">{s.doc_number}</td>
                    <td className="p-3">{s.doc_date}</td>
                    <td className="p-3">{s.customer_name}</td>
                    <td className="p-3 text-right font-bold">₹{Number(s.total_amount).toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right text-stone-600">₹{Number(s.total_cogs || 0).toLocaleString('en-IN')}</td>
                    <td className="p-3"><StatusBadge status={s.status} /></td>
                    <td className="p-3 flex gap-1">
                      {hasPerm('accounting.view') && (
                        <button onClick={() => inspectJournals(s.id)} className="btn-secondary !min-h-[32px] !py-1 !px-2 text-xs">
                          <BookOpen className="w-3.5 h-3.5" /> Journal
                        </button>
                      )}
                      {s.status === 'Posted' && hasPerm('accounting.post') && (
                        <button onClick={() => reverseDoc('sales', s.id)} className="btn-secondary !min-h-[32px] !py-1 !px-2 text-xs text-red-700">
                          <RotateCcw className="w-3.5 h-3.5" /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PURCHASES TAB */}
      {tab === 'PURCHASES' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Purchase Bills & Purchase Returns</h2>
            {hasPerm('purchases.manage') && (
              <button onClick={() => setShowPurchaseForm(!showPurchaseForm)} className="btn-primary">
                <Plus className="w-5 h-5" /> New Purchase
              </button>
            )}
          </div>

          {showPurchaseForm && (
            <form onSubmit={handleCreatePurchase} className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <select value={purDocType} onChange={(e) => setPurDocType(e.target.value as any)} className="input-field">
                <option value="INVOICE">Purchase Invoice</option>
                <option value="RETURN">Purchase Return</option>
              </select>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input-field">
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={purLotId} onChange={(e) => setPurLotId(e.target.value)} className="input-field">
                <option value="">-- Optional Linked Lot --</option>
                {lots.map((l) => <option key={l.id} value={l.id}>{l.lot_number} ({l.received_qty_kg} kg)</option>)}
              </select>
              <select value={purProductId} onChange={(e) => setPurProductId(e.target.value)} className="input-field">
                {catalog.products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={purWarehouseId} onChange={(e) => setPurWarehouseId(e.target.value)} className="input-field">
                {catalog.warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <input type="number" step="0.1" value={purQtyKg} onChange={(e) => setPurQtyKg(e.target.value)} placeholder="Qty kg" className="input-field" required />
              <input type="number" step="0.01" value={purRate} onChange={(e) => setPurRate(e.target.value)} placeholder="Rate ₹/kg" className="input-field" required />
              <input type="number" step="0.01" value={purFreight} onChange={(e) => setPurFreight(e.target.value)} placeholder="Freight ₹" className="input-field" />
              <select value={purTaxId} onChange={(e) => setPurTaxId(e.target.value)} className="input-field">
                {catalog.taxes.map((tx: any) => <option key={tx.id} value={tx.id}>{tx.name}</option>)}
              </select>
              <button type="submit" className="btn-primary lg:col-span-3">Save & Post Purchase</button>
            </form>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b">
                <tr>
                  <th className="p-3">Doc #</th><th className="p-3">Date</th><th className="p-3">Supplier</th>
                  <th className="p-3">Lot</th><th className="p-3 text-right">Total (₹)</th>
                  <th className="p-3">Status</th><th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 font-bold text-[#1B4D3E]">{p.doc_number}</td>
                    <td className="p-3">{p.doc_date}</td>
                    <td className="p-3">{p.supplier_name}</td>
                    <td className="p-3 text-xs">{p.lot_number || '—'}</td>
                    <td className="p-3 text-right font-bold">₹{Number(p.total_amount).toLocaleString('en-IN')}</td>
                    <td className="p-3"><StatusBadge status={p.status} /></td>
                    <td className="p-3 flex gap-1">
                      {hasPerm('accounting.view') && (
                        <button onClick={() => inspectJournals(p.id)} className="btn-secondary !min-h-[32px] !py-1 !px-2 text-xs">
                          <BookOpen className="w-3.5 h-3.5" /> Journal
                        </button>
                      )}
                      {p.status === 'Posted' && hasPerm('accounting.post') && (
                        <button onClick={() => reverseDoc('purchases', p.id)} className="btn-secondary !min-h-[32px] !py-1 !px-2 text-xs text-red-700">
                          <RotateCcw className="w-3.5 h-3.5" /> Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EXPENSES TAB */}
      {tab === 'EXPENSES' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Expenses & Other Income Vouchers</h2>
            {hasPerm('expenses.manage') && (
              <button onClick={() => setShowExpForm(!showExpForm)} className="btn-primary">
                <Plus className="w-5 h-5" /> New Voucher
              </button>
            )}
          </div>
          {showExpForm && (
            <form onSubmit={handleCreateExpense} className="card p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select value={expType} onChange={(e) => setExpType(e.target.value as any)} className="input-field">
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Other Income</option>
              </select>
              <select value={expAccId} onChange={(e) => setExpAccId(e.target.value)} className="input-field">
                {coa.filter((a) => a.account_type === (expType === 'EXPENSE' ? 'EXPENSE' : 'INCOME')).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
              <select value={expPayAccId} onChange={(e) => setExpPayAccId(e.target.value)} className="input-field">
                {coa.filter((a) => a.subtype === 'CASH' || a.subtype === 'BANK').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              <input value={expVendor} onChange={(e) => setExpVendor(e.target.value)} placeholder="Vendor / Payee" className="input-field" />
              <input type="number" step="0.01" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="Amount ₹" className="input-field" required />
              <input value={expNotes} onChange={(e) => setExpNotes(e.target.value)} placeholder="Notes" className="input-field" />
              <button type="submit" className="btn-primary sm:col-span-3">Post Voucher</button>
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b">
                <tr><th className="p-3">Voucher #</th><th className="p-3">Date</th><th className="p-3">Category</th><th className="p-3">Vendor</th><th className="p-3 text-right">Amount (₹)</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody className="divide-y">
                {expenses.map((ex) => (
                  <tr key={ex.id}>
                    <td className="p-3 font-bold text-[#1B4D3E]">{ex.voucher_number}</td>
                    <td className="p-3">{ex.voucher_date}</td>
                    <td className="p-3">{ex.account_name}</td>
                    <td className="p-3">{ex.vendor_name || '—'}</td>
                    <td className="p-3 text-right font-bold">₹{Number(ex.total_amount).toLocaleString('en-IN')}</td>
                    <td className="p-3"><StatusBadge status={ex.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAYMENTS TAB */}
      {tab === 'PAYMENTS' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Payments, Customer Receipts & Contra</h2>
            {hasPerm('payments.manage') && (
              <button onClick={() => setShowPayForm(!showPayForm)} className="btn-primary">
                <Plus className="w-5 h-5" /> Record Payment / Receipt
              </button>
            )}
          </div>
          {showPayForm && (
            <form onSubmit={handleCreatePayment} className="card p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select value={payType} onChange={(e) => setPayType(e.target.value as any)} className="input-field">
                <option value="RECEIPT">Receipt from Customer</option>
                <option value="PAYMENT">Payment to Supplier</option>
                <option value="CONTRA">Contra (Cash ↔ Bank)</option>
              </select>
              {payType !== 'CONTRA' && (
                <select value={payPartyId} onChange={(e) => setPayPartyId(e.target.value)} className="input-field">
                  {(payType === 'RECEIPT' ? customers : suppliers).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <select value={payAccId} onChange={(e) => setPayAccId(e.target.value)} className="input-field">
                {coa.filter((a) => a.subtype === 'CASH' || a.subtype === 'BANK').map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {payType === 'CONTRA' && (
                <select value={payTargetAccId} onChange={(e) => setPayTargetAccId(e.target.value)} className="input-field">
                  {coa.filter((a) => a.subtype === 'CASH' || a.subtype === 'BANK').map((a) => (
                    <option key={a.id} value={a.id}>To: {a.name}</option>
                  ))}
                </select>
              )}
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)} className="input-field">
                <option value="UPI">UPI</option><option value="CASH">Cash</option><option value="BANK">NEFT/RTGS</option><option value="CHEQUE">Cheque</option>
              </select>
              <input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="UPI/Cheque Reference" className="input-field" />
              <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount ₹" className="input-field" required />
              <button type="submit" className="btn-primary sm:col-span-3">Post Voucher</button>
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase text-stone-600 border-b">
                <tr><th className="p-3">Voucher #</th><th className="p-3">Type</th><th className="p-3">Date</th><th className="p-3">Party</th><th className="p-3">Mode / Ref</th><th className="p-3 text-right">Amount (₹)</th></tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((pr) => (
                  <tr key={pr.id}>
                    <td className="p-3 font-bold text-[#1B4D3E]">{pr.voucher_number}</td>
                    <td className="p-3 font-semibold">{pr.voucher_type}</td>
                    <td className="p-3">{pr.voucher_date}</td>
                    <td className="p-3">{pr.party_name || pr.target_account_name || '—'}</td>
                    <td className="p-3 text-xs">{pr.payment_method} {pr.reference_no ? `(${pr.reference_no})` : ''}</td>
                    <td className="p-3 text-right font-bold">₹{Number(pr.amount).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {journalModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-5 max-h-[80vh] overflow-y-auto space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-[#1B4D3E]">Generated Double-Entry Journal</h3>
              <button onClick={() => setJournalModal(null)} className="btn-secondary !min-h-[36px] !py-1">Close</button>
            </div>
            {journalModal.map((je) => (
              <div key={je.id} className="border border-stone-200 rounded-xl p-3 space-y-2">
                <div className="flex justify-between text-sm font-bold">
                  <span>{je.entry_number} ({je.entry_type})</span>
                  <span>{je.entry_date} • {je.status}</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-[#FAF7F0]"><tr><th className="p-1.5 text-left">Account</th><th className="p-1.5 text-right">Debit</th><th className="p-1.5 text-right">Credit</th></tr></thead>
                  <tbody>
                    {je.lines.map((l: any) => (
                      <tr key={l.id} className="border-t">
                        <td className="p-1.5">{l.account_code} - {l.account_name}</td>
                        <td className="p-1.5 text-right">{l.debit > 0 ? `₹${l.debit.toLocaleString('en-IN')}` : ''}</td>
                        <td className="p-1.5 text-right">{l.credit > 0 ? `₹${l.credit.toLocaleString('en-IN')}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
