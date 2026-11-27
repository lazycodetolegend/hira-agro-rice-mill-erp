import { loadApiCache, saveApiCache } from '../offline/db';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

let authToken: string | null = localStorage.getItem('rm_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) localStorage.setItem('rm_token', token);
  else localStorage.removeItem('rm_token');
}

export function getAuthToken() {
  return authToken;
}

export function safeRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getOrCreateDeviceKey(): string {
  let key = localStorage.getItem('rm_device_key');
  if (!key) {
    key = 'dev-' + safeRandomUUID();
    localStorage.setItem('rm_device_key', key);
  }
  return key;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return false;
  if (!navigator.onLine) return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TypeError) return true;
  const msg = String((err as any)?.message || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('abort');
}

function getCacheKey(path: string): string {
  const scope = localStorage.getItem('rm_scope_id') || 'default';
  return `${scope}:${path}`;
}

function isCacheableGet(path: string, method: string): boolean {
  return method.toUpperCase() === 'GET' && !path.startsWith('/auth/') && !path.startsWith('/search');
}

function notifyNetworkReachable(reachable: boolean) {
  window.dispatchEvent(new CustomEvent('rm:network-status', { detail: { reachable } }));
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const cacheable = isCacheableGet(path, method);

  if (cacheable && !navigator.onLine) {
    const cached = await loadApiCache<T>(getCacheKey(path));
    if (cached !== null) return cached;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const controller = !options.signal ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      method,
      headers,
      signal: options.signal ?? controller?.signal,
    });
    if (timer) clearTimeout(timer);

    notifyNetworkReachable(true);

    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }

    if (!res.ok) {
      throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
    }

    if (cacheable) {
      await saveApiCache(getCacheKey(path), data);
    }

    return data as T;
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (isNetworkError(err)) {
      notifyNetworkReachable(false);
      if (cacheable) {
        const cached = await loadApiCache<T>(getCacheKey(path));
        if (cached !== null) return cached;
      }
    }
    throw err;
  }
}
