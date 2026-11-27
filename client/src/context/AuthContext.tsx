import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, ApiError, setAuthToken, getAuthToken, getOrCreateDeviceKey } from '../api/client';
import {
  saveEncryptedSession,
  loadEncryptedSession,
  clearOfflineSession,
  clearApiCache,
  hasOfflinePin,
  verifyOfflinePin,
} from '../offline/db';
import { useI18n } from './I18nContext';

export interface UserInfo {
  id: string;
  username: string;
  fullName: string;
  preferredLang: 'en' | 'hi' | 'mr';
  roleId: string;
  roleCode: string;
  roleName: string;
  totpEnabled?: boolean;
  googleEmail?: string | null;
  permissions: string[];
}

export interface TwoFactorChallenge {
  challengeToken: string;
  userPreview: { username: string; fullName: string };
}

interface AuthCtx {
  user: UserInfo | null;
  business: any | null;
  deviceId: string | null;
  loading: boolean;
  offlineUnlocked: boolean;
  hasCachedSession: boolean;
  requiresPinForOffline: boolean;
  login: (username: string, password: string, deviceName?: string) => Promise<TwoFactorChallenge | null>;
  verify2FA: (challengeToken: string, code: string) => Promise<void>;
  loginWithGoogle: (idToken: string, deviceName?: string) => Promise<TwoFactorChallenge | null>;
  unlockOffline: (pin?: string) => Promise<boolean>;
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
  const [requiresPinForOffline, setRequiresPinForOffline] = useState(false);

  const applyAuthenticatedResponse = useCallback(
    async (data: any) => {
      setAuthToken(data.token);
      if (data.business?.id || data.user?.id) {
        localStorage.setItem('rm_scope_id', data.business?.id || data.user?.id);
      }
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
      setRequiresPinForOffline(await hasOfflinePin());
    },
    [setLang]
  );

  const refreshSession = useCallback(async () => {
    const token = getAuthToken();
    const cached = await loadEncryptedSession();
    setHasCachedSession(Boolean(cached?.user));
    setRequiresPinForOffline(await hasOfflinePin());

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
        } else if (cached?.user && !(await hasOfflinePin())) {
          setUser(cached.user);
          setBusiness(cached.business);
          setDeviceId(cached.deviceId);
          setOfflineUnlocked(true);
        } else {
          setAuthToken(null);
          setUser(null);
        }
      }
    } else if (cached?.user && !(await hasOfflinePin())) {
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

  const login = async (username: string, password: string, deviceName?: string): Promise<TwoFactorChallenge | null> => {
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
    if (data.requires2FA) {
      return { challengeToken: data.challengeToken, userPreview: data.userPreview };
    }
    await applyAuthenticatedResponse(data);
    return null;
  };

  const verify2FA = async (challengeToken: string, code: string) => {
    const data = await apiFetch('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken, code }),
    });
    await applyAuthenticatedResponse(data);
  };

  const loginWithGoogle = async (idToken: string, deviceName?: string): Promise<TwoFactorChallenge | null> => {
    const deviceKey = getOrCreateDeviceKey();
    const data = await apiFetch('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        idToken,
        deviceKey,
        deviceName: deviceName || navigator.userAgent.slice(0, 40),
        platform: navigator.platform || 'web',
      }),
    });
    if (data.requires2FA) {
      return { challengeToken: data.challengeToken, userPreview: data.userPreview };
    }
    await applyAuthenticatedResponse(data);
    return null;
  };

  const unlockOffline = async (pin?: string): Promise<boolean> => {
    const pinRequired = await hasOfflinePin();
    if (pinRequired) {
      const ok = await verifyOfflinePin(pin || '');
      if (!ok) return false;
    }
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
    localStorage.removeItem('rm_scope_id');
    await clearOfflineSession();
    await clearApiCache();
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
        requiresPinForOffline,
        login,
        verify2FA,
        loginWithGoogle,
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
