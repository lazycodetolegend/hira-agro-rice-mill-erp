import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'rice_mill_offline_v1';
const DB_VERSION = 2;

export interface OutboxOp {
  idempotencyKey: string;
  entityType: 'LOT_DRAFT' | 'BAGS_CREATE' | 'BAG_TRANSITION' | 'STOCK_COUNT' | 'PRODUCTION_DRAFT';
  action: string;
  offlineCreatedAt: string;
  payload: any;
  syncStatus: 'Local' | 'Syncing' | 'Synced' | 'Conflict' | 'Rejected';
  retryCount: number;
  lastError?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache');
        }
        if (!db.objectStoreNames.contains('bags')) {
          const bagStore = db.createObjectStore('bags', { keyPath: 'id' });
          bagStore.createIndex('qr_token', 'qr_token', { unique: false });
          bagStore.createIndex('bag_number', 'bag_number', { unique: false });
        }
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'idempotencyKey' });
        }
        if (oldVersion > 0 && oldVersion < 2) {
          transaction.objectStore('kv').clear();
          transaction.objectStore('cache').clear();
          transaction.objectStore('bags').clear();
        }
      },
    });
  }
  return dbPromise;
}

// WebCrypto AES-GCM local encryption helper for sensitive cached session data
async function deriveDeviceKey(secretSeed: string): Promise<CryptoKey | null> {
  if (!globalThis.crypto?.subtle) return null;
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secretSeed), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('ricemill-local-salt'), iterations: 10000, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function saveEncryptedSession(sessionObj: any) {
  const db = await getOfflineDb();
  const key = await deriveDeviceKey(navigator.userAgent + 'ricemill');
  if (key && globalThis.crypto?.subtle) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(sessionObj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    await db.put('kv', { encrypted: true, iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) }, 'session');
  } else {
    await db.put('kv', { encrypted: false, data: sessionObj }, 'session');
  }
}

export async function loadEncryptedSession(): Promise<any | null> {
  const db = await getOfflineDb();
  const rec = await db.get('kv', 'session');
  if (!rec) return null;
  if (!rec.encrypted) return rec.data;
  try {
    const key = await deriveDeviceKey(navigator.userAgent + 'ricemill');
    if (!key) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(rec.iv) },
      key,
      new Uint8Array(rec.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function clearOfflineSession() {
  const db = await getOfflineDb();
  await db.delete('kv', 'session');
}

export async function cacheSnapshot(snapshot: any) {
  const db = await getOfflineDb();
  await db.put('cache', snapshot, 'master_snapshot');
  if (Array.isArray(snapshot.bags)) {
    const tx = db.transaction('bags', 'readwrite');
    await tx.store.clear();
    for (const b of snapshot.bags) {
      await tx.store.put(b);
    }
    await tx.done;
  }
}

export async function getCachedSnapshot(): Promise<any | null> {
  const db = await getOfflineDb();
  return (await db.get('cache', 'master_snapshot')) || null;
}

export async function getOfflineBagByQrOrNumber(query: string): Promise<any | null> {
  let token = query.trim();
  if (token.includes('t=')) {
    const m = token.match(/[?&]t=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  const db = await getOfflineDb();
  const all = await db.getAll('bags');
  return all.find((b) => b.qr_token === token || b.bag_number.toLowerCase() === token.toLowerCase()) || null;
}

export async function putOfflineBag(bag: any) {
  const db = await getOfflineDb();
  await db.put('bags', bag);
}

export async function listOfflineBags(): Promise<any[]> {
  const db = await getOfflineDb();
  const all = await db.getAll('bags');
  return all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function enqueueOutboxOp(op: Omit<OutboxOp, 'syncStatus' | 'retryCount'>) {
  const db = await getOfflineDb();
  const full: OutboxOp = {
    ...op,
    syncStatus: 'Local',
    retryCount: 0,
  };
  await db.put('outbox', full);
  return full;
}

export async function listOutboxOps(): Promise<OutboxOp[]> {
  const db = await getOfflineDb();
  const all = await db.getAll('outbox');
  return all.sort((a, b) => a.offlineCreatedAt.localeCompare(b.offlineCreatedAt));
}

export async function updateOutboxOp(op: OutboxOp) {
  const db = await getOfflineDb();
  await db.put('outbox', op);
}

export async function removeSyncedOutboxOps() {
  const db = await getOfflineDb();
  const all = await db.getAll('outbox');
  for (const op of all) {
    if (op.syncStatus === 'Synced') {
      await db.delete('outbox', op.idempotencyKey);
    }
  }
}

/**
 * Generates an opaque, cryptographically random, non-sequential QR token offline.
 * Contains zero PII, DB IDs, or price info.
 */
export function generateClientQrToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `RM1-${b64}`;
}
