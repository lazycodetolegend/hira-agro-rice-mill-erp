import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, ApiError, setAuthToken, getAuthToken, getOrCreateDeviceKey } from '../api/client';
import { saveEncryptedSession, loadEncryptedSession, clearOfflineSession } from '../offline/db';
import { useI18n } from './I18nContext';

export interface UserInfo {
  id: string;
  username: string;
  fullName: string;
  preferredLang: 'en' | 'hi' | 'mr';
  roleId: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
}

interface AuthCtx {
  user: UserInfo | null;
  business: any | null;
  deviceId: string | null;
  loading: boolean;
  offlineUnlocked: boolean;
  hasCachedSession: boolean;
  login: (username: string, password: string, deviceName?: string) => Promise<void>;
  unlockOffline: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hasPerm: (perm: string) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setLang } = useI18n();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [business, setBusiness] = useState<any | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineUnlocked, setOfflineUnlocked] = useState(false);
  const [hasCachedSession, setHasCachedSession] = useState(false);

  const refreshSession = useCallback(async () => {
    const token = getAuthToken();
    const cached = await loadEncryptedSession();
    setHasCachedSession(Boolean(cached?.user));

    if (!token) {
      setLoading(false);
      return;
    }

    if (navigator.onLine) {
      try {
        const data = await apiFetch('/auth/me');
        setUser(data.user);
        setBusiness(data.business);
        setDeviceId(data.deviceId);
        setOfflineUnlocked(false);
        if (data.user?.preferredLang) setLang(data.user.preferredLang);
        await saveEncryptedSession({ token, user: data.user, business: data.business, deviceId: data.deviceId });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setAuthToken(null);
          await clearOfflineSession();
          setHasCachedSession(false);
          setUser(null);
          setBusiness(null);
          setDeviceId(null);
        } else if (cached?.user) {
          // Fallback to cached session only when server is unreachable
          setUser(cached.user);
          setBusiness(cached.business);
          setDeviceId(cached.deviceId);
          setOfflineUnlocked(true);
        } else {
          setAuthToken(null);
          setUser(null);
        }
      }
    } else if (cached?.user) {
      setUser(cached.user);
      setBusiness(cached.business);
      setDeviceId(cached.deviceId);
      setOfflineUnlocked(true);
    }
    setLoading(false);
  }, [setLang]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = async (username: string, password: string, deviceName?: string) => {
    const deviceKey = getOrCreateDeviceKey();
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        deviceKey,
        deviceName: deviceName || navigator.userAgent.slice(0, 40),
        platform: navigator.platform || 'web',
      }),
    });
    setAuthToken(data.token);
    setUser(data.user);
    setBusiness(data.business);
    setDeviceId(data.deviceId);
    setOfflineUnlocked(false);
    if (data.user?.preferredLang) setLang(data.user.preferredLang);
    await saveEncryptedSession({
      token: data.token,
      user: data.user,
      business: data.business,
      deviceId: data.deviceId,
    });
    setHasCachedSession(true);
  };

  const unlockOffline = async (): Promise<boolean> => {
    const cached = await loadEncryptedSession();
    if (cached?.user) {
      if (cached.token) setAuthToken(cached.token);
      setUser(cached.user);
      setBusiness(cached.business);
      setDeviceId(cached.deviceId);
      setOfflineUnlocked(true);
      return true;
    }
    return false;
  };

  const logout = async () => {
    if (navigator.onLine && getAuthToken()) {
      await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    }
    setAuthToken(null);
    await clearOfflineSession();
    setHasCachedSession(false);
    setUser(null);
    setBusiness(null);
    setDeviceId(null);
  };

  const hasPerm = (perm: string) => {
    if (!user) return false;
    return user.roleCode === 'OWNER_ADMIN' || user.permissions.includes(perm);
  };

  return (
    <Ctx.Provider
      value={{
        user,
        business,
        deviceId,
        loading,
        offlineUnlocked,
        hasCachedSession,
        login,
        unlockOffline,
        logout,
        refreshSession,
        hasPerm,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
