import React, { useEffect, useState } from 'react';
import { Download, Shield, Users, Smartphone, FileText, Database } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function SettingsAdminPage() {
  const { business, hasPerm, refreshSession } = useAuth();
  const [tab, setTab] = useState<'BUSINESS' | 'USERS_ROLES' | 'DEVICES' | 'MAPPINGS' | 'CUSTOM_FIELDS' | 'AUDIT' | 'BACKUP'>('BUSINESS');
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [coa, setCoa] = useState<any[]>([]);
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Business form
  const [bizName, setBizName] = useState(business?.name || '');
  const [gstin, setGstin] = useState(business?.gstin || '');
  const [phone, setPhone] = useState(business?.phone || '');
  const [address, setAddress] = useState(business?.address || '');
  const [fyMonth, setFyMonth] = useState(String(business?.fiscal_year_start_month || 4));
  const [valuation, setValuation] = useState(business?.valuation_method || 'WEIGHTED_AVG');
  const [bagPrefix, setBagPrefix] = useState(business?.bag_prefix || 'BAG');

  // New User
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRoleId, setNewRoleId] = useState('');

  // New Custom Field
  const [cfEntity, setCfEntity] = useState('BAG');
  const [cfKey, setCfKey] = useState('');
  const [cfLabel, setCfLabel] = useState('');
  const [cfType, setCfType] = useState('TEXT');

  const loadData = async () => {
    if (hasPerm('users.manage')) setUsers(await apiFetch('/auth/users'));
    if (hasPerm('roles.manage')) {
      const r = await apiFetch<any[]>('/auth/roles');
      setRoles(r);
      if (!newRoleId && r.length) setNewRoleId(r[0].id);
    }
    if (hasPerm('devices.manage')) setDevices(await apiFetch('/auth/devices'));
    if (hasPerm('accounting.view')) {
      setMappings(await apiFetch('/accounting/mappings'));
      setCoa(await apiFetch('/accounting/coa'));
    }
    setCustomFields(await apiFetch('/admin/custom-fields'));
    if (hasPerm('audit.view')) setAuditLogs(await apiFetch('/admin/audit-logs'));
  };

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  const saveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    await apiFetch('/business', {
      method: 'PATCH',
      body: JSON.stringify({
        name: bizName,
        gstin,
        phone,
        address,
        fiscal_year_start_month: Number(fyMonth),
        valuation_method: valuation,
        bag_prefix: bagPrefix,
      }),
    });
    await refreshSession();
    setMsg('Business settings saved.');
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/auth/users', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername, fullName: newFullName, password: newPassword, roleId: newRoleId }),
      });
      setNewUsername(''); setNewFullName(''); setNewPassword('');
      setMsg('User created.');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/admin/custom-fields', {
      method: 'POST',
      body: JSON.stringify({ entityType: cfEntity, fieldKey: cfKey, label: cfLabel, fieldType: cfType }),
    });
    setCfKey(''); setCfLabel('');
    setMsg('Custom field created.');
    await loadData();
  };

  const downloadBackup = async () => {
    const data = await apiFetch('/admin/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ricemill-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setMsg('Full JSON backup downloaded.');
  };

  const clearDemo = async () => {
    if (!confirm('Clear all demo transactions so you can start live operations cleanly? Master data & users stay intact.')) return;
    await apiFetch('/admin/demo/clear', { method: 'POST' });
    await refreshSession();
    setMsg('Demo transactions cleared. Ready for live business operations.');
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#1F2937]">Admin Settings, Security & Backups</h1>
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['BUSINESS', 'Business & Valuation'],
            ['USERS_ROLES', 'Users & Roles'],
            ['DEVICES', 'Devices'],
            ['MAPPINGS', 'Account Mappings'],
            ['CUSTOM_FIELDS', 'Custom Fields'],
            ['AUDIT', 'Audit Logs'],
            ['BACKUP', 'Backup & Demo Data'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-xl text-xs font-bold border ${tab === k ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'BUSINESS' && (
        <form onSubmit={saveBusiness} className="card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs font-bold">Mill / Business Name</label><input value={bizName} onChange={(e) => setBizName(e.target.value)} className="input-field" /></div>
          <div><label className="text-xs font-bold">GSTIN / Tax ID</label><input value={gstin} onChange={(e) => setGstin(e.target.value)} className="input-field" /></div>
          <div><label className="text-xs font-bold">Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" /></div>
          <div><label className="text-xs font-bold">Bag Number Prefix</label><input value={bagPrefix} onChange={(e) => setBagPrefix(e.target.value)} className="input-field" /></div>
          <div className="sm:col-span-2"><label className="text-xs font-bold">Address</label><input value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" /></div>
          <div>
            <label className="text-xs font-bold">Financial Year Start Month</label>
            <select value={fyMonth} onChange={(e) => setFyMonth(e.target.value)} className="input-field">
              <option value="4">April (Indian FY Apr–Mar)</option>
              <option value="1">January (Calendar Year)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold">Inventory Valuation Method</label>
            <select value={valuation} onChange={(e) => setValuation(e.target.value)} className="input-field">
              <option value="WEIGHTED_AVG">Weighted Average Cost</option>
              <option value="FIFO">First-In, First-Out (FIFO)</option>
            </select>
          </div>
          <button type="submit" className="btn-primary sm:col-span-2">Save Configuration</button>
        </form>
      )}

      {tab === 'USERS_ROLES' && (
        <div className="space-y-4">
          {hasPerm('users.manage') && (
            <form onSubmit={createUser} className="card p-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="Username" className="input-field" required />
              <input value={newFullName} onChange={(e) => setNewFullName(e.target.value)} placeholder="Full Name" className="input-field" required />
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password (6+)" className="input-field" required />
              <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)} className="input-field">
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button type="submit" className="btn-primary"><Users className="w-4 h-4" /> Add User</button>
            </form>
          )}
          <div className="card p-4">
            <h3 className="font-bold mb-2">Staff Users</h3>
            <div className="divide-y text-sm">
              {users.map((u) => (
                <div key={u.id} className="py-2 flex justify-between">
                  <span><strong>{u.full_name}</strong> (@{u.username})</span>
                  <span className="text-xs font-semibold text-[#1B4D3E]">{u.role_name} • {u.is_active ? 'Active' : 'Disabled'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <h3 className="font-bold mb-2 flex items-center gap-2"><Shield className="w-4 h-4 text-[#1B4D3E]" /> Roles & Permissions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {roles.map((r) => (
                <div key={r.id} className="p-3 rounded-xl bg-[#FAF7F0] border">
                  <div className="font-bold text-sm">{r.name} ({r.code})</div>
                  <div className="text-stone-600 mt-0.5">{r.description}</div>
                  <div className="text-stone-500 mt-1">{r.permissions?.length || 0} permissions</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'DEVICES' && (
        <div className="card p-4 space-y-2">
          <h3 className="font-bold flex items-center gap-2"><Smartphone className="w-4 h-4" /> Registered Devices</h3>
          {devices.map((d) => (
            <div key={d.id} className="p-2.5 rounded-xl bg-[#FAF7F0] border flex justify-between items-center text-xs">
              <div>
                <strong>{d.device_name}</strong> ({d.platform}) • User: {d.full_name}
                <div className="text-stone-500">Last seen: {new Date(d.last_seen_at).toLocaleString('en-IN')}</div>
              </div>
              {!d.is_revoked ? (
                <button
                  onClick={async () => {
                    await apiFetch(`/auth/devices/${d.id}/revoke`, { method: 'POST' });
                    loadData();
                  }}
                  className="btn-danger !min-h-[34px] !py-1 text-xs"
                >
                  Revoke Device
                </button>
              ) : (
                <span className="text-red-700 font-bold">REVOKED</span>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'MAPPINGS' && (
        <div className="card p-4 space-y-2 text-sm">
          <h3 className="font-bold text-[#1B4D3E]">Automatic Accounting Mappings</h3>
          {mappings.map((m) => (
            <div key={m.id} className="flex flex-wrap justify-between items-center py-2 border-b gap-2">
              <span className="font-mono text-xs font-bold">{m.mapping_key}</span>
              <select
                value={m.account_id}
                onChange={async (e) => {
                  await apiFetch('/accounting/mappings', {
                    method: 'PATCH',
                    body: JSON.stringify({ mappingKey: m.mapping_key, accountId: e.target.value }),
                  });
                  loadData();
                }}
                className="input-field !w-72 !min-h-[38px] text-xs"
              >
                {coa.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {tab === 'CUSTOM_FIELDS' && (
        <div className="space-y-3">
          <form onSubmit={addCustomField} className="card p-4 grid grid-cols-1 sm:grid-cols-5 gap-2">
            <select value={cfEntity} onChange={(e) => setCfEntity(e.target.value)} className="input-field">
              <option value="BAG">Bag</option><option value="LOT">Inbound Lot</option><option value="PRODUCT">Product</option><option value="PRODUCTION">Production</option>
            </select>
            <input value={cfKey} onChange={(e) => setCfKey(e.target.value)} placeholder="Field Key (e.g. mill_shift)" className="input-field" required />
            <input value={cfLabel} onChange={(e) => setCfLabel(e.target.value)} placeholder="Label (e.g. Shift)" className="input-field" required />
            <select value={cfType} onChange={(e) => setCfType(e.target.value)} className="input-field">
              <option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="DATE">Date</option>
            </select>
            <button type="submit" className="btn-primary">Add Field</button>
          </form>
          <div className="card p-4 divide-y text-sm">
            {customFields.map((cf) => (
              <div key={cf.id} className="py-2 flex justify-between">
                <span><strong>{cf.label}</strong> (<code>{cf.field_key}</code>)</span>
                <span className="text-xs">{cf.entity_type} • {cf.field_type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'AUDIT' && (
        <div className="card p-4 space-y-2">
          <h3 className="font-bold flex items-center gap-2"><FileText className="w-4 h-4" /> Security & Operations Audit Log</h3>
          <div className="max-h-96 overflow-y-auto divide-y text-xs">
            {auditLogs.map((al) => (
              <div key={al.id} className="py-2">
                <div className="flex justify-between font-bold">
                  <span className="text-[#1B4D3E]">{al.action} ({al.entity_type})</span>
                  <span className="text-stone-500">{new Date(al.created_at).toLocaleString('en-IN')}</span>
                </div>
                <div>{al.summary}</div>
                <div className="text-stone-500">User: {al.user_name || al.user_id} • Device: {al.device_name || al.device_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'BACKUP' && (
        <div className="card p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <button onClick={downloadBackup} className="btn-primary">
              <Download className="w-5 h-5" /> Export Full JSON Backup
            </button>
            <button onClick={clearDemo} className="btn-amber">
              <Database className="w-5 h-5" /> Clear Demo Transactions (Switch to Live)
            </button>
          </div>
          <p className="text-xs text-stone-600">
            SQLite database file is stored persistently on the server under <code>server/data/ricemill.sqlite</code> in WAL mode. Back up both the JSON export and the SQLite file daily.
          </p>
        </div>
      )}
    </div>
  );
}
