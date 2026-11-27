import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Trash2 } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../context/SyncContext';
import { removeSyncedOutboxOps } from '../offline/db';
import { StatusBadge } from '../components/StatusBadge';

export function SyncConflictsPage() {
  const { hasPerm } = useAuth();
  const { isOnline, isSyncing, outbox, lastSyncedAt, syncNow, refreshSnapshot } = useSync();
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [preloading, setPreloading] = useState(false);

  const loadConflicts = async () => {
    if (!isOnline) return;
    const res = await apiFetch<any[]>('/sync/conflicts').catch(() => []);
    setConflicts(res);
  };

  useEffect(() => {
    loadConflicts();
  }, [isOnline, outbox.length]);

  const resolve = async (id: string, decision: 'RESOLVED_SERVER' | 'RESOLVED_CLIENT' | 'DISMISSED') => {
    await apiFetch(`/sync/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision, note: note || decision }),
    });
    setNote('');
    setMsg(`Conflict marked ${decision}.`);
    await loadConflicts();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Offline Sync & Conflict Resolution</h1>
          <p className="text-sm text-stone-600">
            Last Sync: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('en-IN') : 'Never'} • Status: {isOnline ? 'Online' : 'Offline'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              setPreloading(true);
              await refreshSnapshot();
              setPreloading(false);
              setMsg('All master data, bags, lots, bills & accounts downloaded for offline use!');
            }}
            disabled={!isOnline || preloading}
            className="btn-secondary"
          >
            {preloading ? 'Saving...' : 'Preload Offline Cache'}
          </button>
          <button onClick={syncNow} disabled={!isOnline || isSyncing} className="btn-primary">
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} /> Sync Now
          </button>
          <button
            onClick={async () => {
              await removeSyncedOutboxOps();
              window.location.reload();
            }}
            className="btn-secondary"
          >
            <Trash2 className="w-4 h-4" /> Clear Synced
          </button>
        </div>
      </div>

      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {/* Device Outbox */}
      <div className="card p-4 space-y-3">
        <h2 className="font-bold text-base text-[#1B4D3E]">Device Offline Outbox ({outbox.length})</h2>
        {!outbox.length ? (
          <p className="text-sm text-stone-500">All local operations are synced.</p>
        ) : (
          <div className="space-y-2">
            {outbox.map((op) => (
              <div key={op.idempotencyKey} className="p-3 rounded-xl bg-[#FAF7F0] border border-stone-200 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div>
                  <div className="font-bold">{op.entityType} • {op.action}</div>
                  <div className="text-stone-500">Created offline: {new Date(op.offlineCreatedAt).toLocaleString('en-IN')} • Key: {op.idempotencyKey.slice(0, 8)}</div>
                  {op.lastError && <div className="text-red-700 font-semibold mt-0.5">{op.lastError}</div>}
                </div>
                <StatusBadge status={op.syncStatus} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Server Conflict Queue */}
      <div className="card p-4 space-y-3">
        <h2 className="font-bold text-base text-[#1B4D3E] flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-[#D97706]" /> Sync Conflicts Queue
        </h2>
        {!conflicts.length ? (
          <div className="flex items-center gap-2 text-sm text-emerald-800 font-semibold">
            <CheckCircle className="w-4 h-4" /> Zero conflicts pending review.
          </div>
        ) : (
          <div className="space-y-3">
            {conflicts.map((c) => (
              <div key={c.id} className="p-3 rounded-xl border border-amber-300 bg-amber-50/50 space-y-2 text-xs">
                <div className="flex justify-between font-bold text-sm">
                  <span className="text-amber-950">{c.conflict_type}</span>
                  <span className="px-2 py-0.5 rounded bg-white border">{c.resolution_status}</span>
                </div>
                <div className="text-stone-800 font-medium">{c.description}</div>
                <div className="text-stone-500">
                  User: {c.user_name || c.user_id} • Device: {c.device_id} • {new Date(c.created_at).toLocaleString('en-IN')}
                </div>
                {c.resolution_status === 'PENDING' && hasPerm('sync.resolve') && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-amber-200">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note..." className="input-field !min-h-[36px] text-xs flex-1" />
                    <button onClick={() => resolve(c.id, 'RESOLVED_SERVER')} className="btn-secondary !min-h-[36px] !py-1 text-xs">Keep Server State</button>
                    <button onClick={() => resolve(c.id, 'RESOLVED_CLIENT')} className="btn-amber !min-h-[36px] !py-1 text-xs">Accept Offline Override</button>
                    <button onClick={() => resolve(c.id, 'DISMISSED')} className="btn-secondary !min-h-[36px] !py-1 text-xs">Dismiss</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
