import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function MastersPage() {
  const { hasPerm } = useAuth();
  const [tab, setTab] = useState<'PRODUCTS' | 'PARTIES' | 'WAREHOUSES' | 'TAX_UNITS'>('PRODUCTS');
  const [catalog, setCatalog] = useState<any>({ products: [], varieties: [], grades: [], packagingTypes: [], units: [], taxes: [], warehouses: [], locations: [] });
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [balances, setBalances] = useState<any>({ suppliers: [], customers: [] });
  const [msg, setMsg] = useState('');

  // Quick add forms
  const [prodName, setProdName] = useState('');
  const [prodType, setProdType] = useState('RICE');
  const [prodRate, setProdRate] = useState('50');
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [whName, setWhName] = useState('');
  const [taxName, setTaxName] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [taxRate, setTaxRate] = useState('5');

  const loadAll = async () => {
    const [cat, sups, custs, bals] = await Promise.all([
      apiFetch<any>('/masters/catalog'),
      apiFetch<any[]>('/masters/suppliers'),
      apiFetch<any[]>('/masters/customers'),
      apiFetch<any>('/parties/balances').catch(() => ({ suppliers: [], customers: [] })),
    ]);
    setCatalog(cat);
    setSuppliers(sups);
    setCustomers(custs);
    setBalances(bals);
  };

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  const addProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/masters/products', {
      method: 'POST',
      body: JSON.stringify({ name: prodName, materialType: prodType, defaultSaleRatePerKg: Number(prodRate) }),
    });
    setProdName('');
    setMsg('Product added.');
    await loadAll();
  };

  const addSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/masters/suppliers', { method: 'POST', body: JSON.stringify({ name: supName, phone: supPhone }) });
    setSupName(''); setSupPhone('');
    setMsg('Supplier added.');
    await loadAll();
  };

  const addCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/masters/customers', { method: 'POST', body: JSON.stringify({ name: custName, phone: custPhone }) });
    setCustName(''); setCustPhone('');
    setMsg('Customer added.');
    await loadAll();
  };

  const addWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/masters/warehouses', { method: 'POST', body: JSON.stringify({ name: whName }) });
    setWhName('');
    setMsg('Warehouse added.');
    await loadAll();
  };

  const addTax = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/masters/taxes', { method: 'POST', body: JSON.stringify({ name: taxName, code: taxCode, ratePercent: Number(taxRate) }) });
    setTaxName(''); setTaxCode('');
    setMsg('Tax configuration added.');
    await loadAll();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#1F2937]">Masters & Catalog Configuration</h1>
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      <div className="flex flex-wrap gap-2">
        {(['PRODUCTS', 'PARTIES', 'WAREHOUSES', 'TAX_UNITS'] as const).map((tKey) => (
          <button key={tKey} onClick={() => setTab(tKey)} className={`px-4 py-2 rounded-xl text-sm font-bold border ${tab === tKey ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
            {tKey.replace('_', ' & ')}
          </button>
        ))}
      </div>

      {tab === 'PRODUCTS' && (
        <div className="space-y-4">
          {hasPerm('masters.edit') && (
            <form onSubmit={addProduct} className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="Product Name *" className="input-field" required />
              <select value={prodType} onChange={(e) => setProdType(e.target.value)} className="input-field">
                <option value="PADDY">Paddy</option><option value="RICE">Rice</option><option value="BROKEN_RICE">Broken Rice</option><option value="BRAN">Bran</option><option value="HUSK">Husk</option><option value="PACKAGING">Packaging</option>
              </select>
              <input type="number" step="0.01" value={prodRate} onChange={(e) => setProdRate(e.target.value)} placeholder="Sale Rate ₹/kg" className="input-field" />
              <button type="submit" className="btn-primary">Add Product</button>
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase border-b"><tr><th className="p-3">SKU</th><th className="p-3">Name</th><th className="p-3">Material</th><th className="p-3">Variety / Grade</th><th className="p-3 text-right">Default Sale ₹/kg</th></tr></thead>
              <tbody className="divide-y">
                {catalog.products.map((p: any) => (
                  <tr key={p.id}><td className="p-3 font-mono text-xs">{p.sku}</td><td className="p-3 font-semibold">{p.name}</td><td className="p-3 text-xs">{p.material_type}</td><td className="p-3 text-xs">{p.variety_name || '—'} / {p.grade_name || '—'}</td><td className="p-3 text-right">₹{p.default_sale_rate_per_kg}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'PARTIES' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <h2 className="font-bold text-lg text-[#1B4D3E]">Suppliers</h2>
            {hasPerm('masters.edit') && (
              <form onSubmit={addSupplier} className="flex gap-2">
                <input value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="Supplier Name" className="input-field" required />
                <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} placeholder="Phone" className="input-field w-36" />
                <button type="submit" className="btn-primary shrink-0">Add</button>
              </form>
            )}
            <div className="divide-y text-sm">
              {suppliers.map((s) => {
                const bal = balances.suppliers?.find((b: any) => b.id === s.id);
                return (
                  <div key={s.id} className="py-2 flex justify-between">
                    <div><div className="font-semibold">{s.name}</div><div className="text-xs text-stone-500">{s.code} • {s.phone}</div></div>
                    {bal && <div className="font-bold text-rose-700">Payable: ₹{bal.payable_balance.toLocaleString('en-IN')}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-4 space-y-3">
            <h2 className="font-bold text-lg text-[#1B4D3E]">Customers</h2>
            {hasPerm('masters.edit') && (
              <form onSubmit={addCustomer} className="flex gap-2">
                <input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Customer Name" className="input-field" required />
                <input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} placeholder="Phone" className="input-field w-36" />
                <button type="submit" className="btn-primary shrink-0">Add</button>
              </form>
            )}
            <div className="divide-y text-sm">
              {customers.map((c) => {
                const bal = balances.customers?.find((b: any) => b.id === c.id);
                return (
                  <div key={c.id} className="py-2 flex justify-between">
                    <div><div className="font-semibold">{c.name}</div><div className="text-xs text-stone-500">{c.code} • {c.phone}</div></div>
                    {bal && <div className="font-bold text-emerald-800">Receivable: ₹{bal.receivable_balance.toLocaleString('en-IN')}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'WAREHOUSES' && (
        <div className="card p-4 space-y-3">
          {hasPerm('masters.edit') && (
            <form onSubmit={addWarehouse} className="flex gap-2 max-w-md">
              <input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="New Godown / Warehouse Name" className="input-field" required />
              <button type="submit" className="btn-primary">Add</button>
            </form>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {catalog.warehouses.map((w: any) => (
              <div key={w.id} className="p-3 rounded-xl bg-[#FAF7F0] border border-stone-200">
                <div className="font-bold">{w.name} ({w.code})</div>
                <div className="text-xs text-stone-600">{w.address}</div>
                <div className="text-xs mt-1 text-[#1B4D3E]">
                  Racks/Bays: {catalog.locations.filter((l: any) => l.warehouse_id === w.id).map((l: any) => l.code).join(', ') || 'Default'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'TAX_UNITS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 space-y-3">
            <h2 className="font-bold text-base text-[#1B4D3E]">Configurable Tax Rates (Verify with CA)</h2>
            {hasPerm('business.manage') && (
              <form onSubmit={addTax} className="grid grid-cols-3 gap-2">
                <input value={taxName} onChange={(e) => setTaxName(e.target.value)} placeholder="Tax Label" className="input-field" required />
                <input value={taxCode} onChange={(e) => setTaxCode(e.target.value)} placeholder="Code (GST5)" className="input-field" required />
                <div className="flex gap-1">
                  <input type="number" step="0.1" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="%" className="input-field" required />
                  <button type="submit" className="btn-primary">Add</button>
                </div>
              </form>
            )}
            <div className="divide-y text-sm">
              {catalog.taxes.map((tx: any) => (
                <div key={tx.id} className="py-2 flex justify-between">
                  <div><strong>{tx.code}</strong> — {tx.name}</div>
                  <div className="font-bold">{tx.rate_percent}%</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4 space-y-2">
            <h2 className="font-bold text-base text-[#1B4D3E]">Weight Units & Conversions (Internal Base: kg)</h2>
            <div className="divide-y text-sm">
              {catalog.units.map((u: any) => (
                <div key={u.id} className="py-2 flex justify-between">
                  <span>{u.name} (<code>{u.code}</code>)</span>
                  <strong>1 {u.code} = {u.kg_factor} kg</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
