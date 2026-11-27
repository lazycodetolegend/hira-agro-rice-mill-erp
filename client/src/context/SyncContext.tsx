import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, safeRandomUUID } from '../api/client';
import {
  listOutboxOps,
  updateOutboxOp,
  enqueueOutboxOp,
  cacheSnapshot,
  getCachedSnapshot,
  type OutboxOp,
} from '../offline/db';
import { useAuth } from './AuthContext';

interface SyncCtx {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictCount: number;
  outbox: OutboxOp[];
  lastSyncedAt: string | null;
  snapshot: any | null;
  syncNow: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  queueOfflineOp: (
    entityType: OutboxOp['entityType'],
    action: string,
    payload: any
  ) => Promise<OutboxOp>;
}

const Ctx = createContext<SyncCtx>(null as any);

const WARM_CACHE_PATHS = [
  '/dashboard',
  '/lots',
  '/bags',
  '/bags/print-jobs',
  '/masters/catalog',
  '/masters/suppliers',
  '/masters/customers',
  '/production',
  '/sales',
  '/purchases',
  '/expenses',
  '/payments',
  '/accounting/coa',
  '/reports/stock-valuation',
];

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [backendReachable, setBackendReachable] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [outbox, setOutbox] = useState<OutboxOp[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => localStorage.getItem('rm_last_sync'));
  const [snapshot, setSnapshot] = useState<any | null>(null);

  const isOnline = browserOnline && backendReachable;

  const reloadOutbox = useCallback(async () => {
    const ops = await listOutboxOps();
    setOutbox(ops);
  }, []);

  const warmOfflineReadCache = useCallback(async () => {
    if (!navigator.onLine) return;
    await Promise.allSettled(WARM_CACHE_PATHS.map((p) => apiFetch(p)));
  }, []);

  const refreshSnapshot = useCallback(async () => {
    const cached = await getCachedSnapshot();
    if (cached) setSnapshot(cached);
    if (!user || !navigator.onLine) return;
    try {
      const snap = await apiFetch('/sync/pull');
      await cacheSnapshot(snap);
      setSnapshot(snap);
      setBackendReachable(true);
      const conflicts = await apiFetch<any[]>('/sync/conflicts').catch(() => []);
      setConflictCount(conflicts.filter((c) => c.resolution_status === 'PENDING').length);
      warmOfflineReadCache();
    } catch {
      // stay on cached snapshot if network fails
    }
  }, [user, warmOfflineReadCache]);

  const syncNow = useCallback(async () => {
    if (!user || !navigator.onLine || isSyncing) return;
    setIsSyncing(true);
    try {
      const ops = await listOutboxOps();
      const toSend = ops.filter((o) => o.syncStatus === 'Local' || o.syncStatus === 'Rejected');
      if (toSend.length > 0) {
        for (const o of toSend) {
          await updateOutboxOp({ ...o, syncStatus: 'Syncing' });
        }
        await reloadOutbox();

        const res = await apiFetch<{ results: any[]; syncedAt: string }>('/sync/push', {
          method: 'POST',
          body: JSON.stringify({
            operations: toSend.map((o) => ({
              idempotencyKey: o.idempotencyKey,
              entityType: o.entityType,
              action: o.action,
              offlineCreatedAt: o.offlineCreatedAt,
              payload: o.payload,
            })),
          }),
        });

        for (const r of res.results || []) {
          const orig = toSend.find((o) => o.idempotencyKey === r.idempotencyKey);
          if (!orig) continue;
          if (r.status === 'APPLIED' || r.status === 'DUPLICATE') {
            await updateOutboxOp({ ...orig, syncStatus: 'Synced' });
          } else if (r.status === 'CONFLICT') {
            await updateOutboxOp({ ...orig, syncStatus: 'Conflict', lastError: r.error || 'Conflict flagged' });
          } else {
            await updateOutboxOp({
              ...orig,
              syncStatus: 'Rejected',
              retryCount: orig.retryCount + 1,
              lastError: r.error,
            });
          }
        }
        localStorage.setItem('rm_last_sync', res.syncedAt);
        setLastSyncedAt(res.syncedAt);
      }
      await reloadOutbox();
      await refreshSnapshot();
    } catch {
      // Revert Syncing -> Local so next attempt retries safely
      const ops = await listOutboxOps();
      for (const o of ops) {
        if (o.syncStatus === 'Syncing') {
          await updateOutboxOp({ ...o, syncStatus: 'Local', retryCount: o.retryCount + 1 });
        }
      }
      await reloadOutbox();
    } finally {
      setIsSyncing(false);
    }
  }, [user, isSyncing, reloadOutbox, refreshSnapshot]);

  const queueOfflineOp = async (
    entityType: OutboxOp['entityType'],
    action: string,
    payload: any
  ) => {
    const op = await enqueueOutboxOp({
      idempotencyKey: safeRandomUUID(),
      entityType,
      action,
      offlineCreatedAt: new Date().toISOString(),
      payload,
    });
    await reloadOutbox();
    return op;
  };

  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true);
      setBackendReachable(true);
      syncNow();
    };
    const onOffline = () => setBrowserOnline(false);
    const onNetStatus = (ev: Event) => {
      const reachable = Boolean((ev as CustomEvent)?.detail?.reachable);
      setBackendReachable(reachable);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('rm:network-status', onNetStatus);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('rm:network-status', onNetStatus);
    };
  }, [syncNow]);

  useEffect(() => {
    reloadOutbox();
    if (user) {
      refreshSnapshot();
      syncNow();
    }
  }, [user, reloadOutbox, refreshSnapshot, syncNow]);

  // Auto-retry pending outbox when mill Wi-Fi recovers even if browser 'online' event already fired
  useEffect(() => {
    if (!user) return;
    const pending = outbox.some((o) => o.syncStatus === 'Local' || o.syncStatus === 'Rejected');
    if (!pending) return;
    const timer = setInterval(() => {
      if (navigator.onLine && !isSyncing) {
        syncNow();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [user, outbox, isSyncing, syncNow]);

  const pendingCount = outbox.filter((o) => o.syncStatus === 'Local' || o.syncStatus === 'Syncing').length;

  return (
    <Ctx.Provider
      value={{
        isOnline,
        isSyncing,
        pendingCount,
        conflictCount,
        outbox,
        lastSyncedAt,
        snapshot,
        syncNow,
        refreshSnapshot,
        queueOfflineOp,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSync() {
  return useContext(Ctx);
}
