import React, { useState } from 'react';
import { QrCode, Lock, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import type { Lang } from '../i18n';

export function LoginPage() {
  const { login, unlockOffline, hasCachedSession } = useAuth();
  const { lang, setLang, t } = useI18n();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('Mill Floor Terminal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password, deviceName);
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleOfflineUnlock = async () => {
    const ok = await unlockOffline();
    if (!ok) setError('No authorized offline session found on this device.');
  };

  return (
    <div className="min-h-screen bg-[#FAF7F0] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md card p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#1B4D3E] text-white flex items-center justify-center">
              <QrCode className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1F2937]">{t('appTitle')}</h1>
              <p className="text-xs text-stone-600">{t('appSubtitle')}</p>
            </div>
          </div>

          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            aria-label={t('language')}
            className="bg-[#FAF7F0] border border-stone-300 rounded-xl px-2.5 py-2 text-sm font-semibold"
          >
            <option value="en">English</option>
            <option value="hi">हिंदी</option>
            <option value="mr">मराठी</option>
          </select>
        </div>

        <h2 className="text-lg font-bold text-[#1B4D3E] border-b border-stone-200 pb-2">
          {t('login.title')}
        </h2>

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-900 rounded-xl p-3 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">{t('login.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t('login.password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">{t('login.deviceName')}</label>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="input-field"
            />
          </div>

          <button type="submit" disabled={busy} className="btn-primary w-full text-base">
            <Lock className="w-5 h-5" /> {busy ? t('common.loading') : t('login.signIn')}
          </button>
        </form>

        {hasCachedSession && (
          <button type="button" onClick={handleOfflineUnlock} className="btn-amber w-full">
            <WifiOff className="w-5 h-5" /> {t('login.offlineUnlock')}
          </button>
        )}
      </div>
    </div>
  );
}
