import React, { useEffect, useRef, useState } from 'react';
import { QrCode, Lock, WifiOff, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth, type TwoFactorChallenge } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { apiFetch } from '../api/client';
import type { Lang } from '../i18n';

declare global {
  interface Window {
    google?: any;
  }
}

export function LoginPage() {
  const { login, verify2FA, resendOtp, loginWithGoogle, unlockOffline, hasCachedSession, requiresPinForOffline } = useAuth();
  const { lang, setLang, t } = useI18n();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceName, setDeviceName] = useState('Mill Floor Terminal');
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [offlinePin, setOfflinePin] = useState('');
  const [googleClientId, setGoogleClientId] = useState<string | null>(
    import.meta.env.VITE_GOOGLE_CLIENT_ID || null
  );
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const googleBtnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!navigator.onLine) return;
    apiFetch<{ googleSignInEnabled: boolean; googleClientId: string | null }>('/auth/public-config')
      .then((cfg) => {
        if (cfg.googleClientId) setGoogleClientId(cfg.googleClientId);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!googleClientId || challenge || !navigator.onLine) return;

    const initGoogleButton = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: any) => {
          if (!response?.credential) return;
          setError('');
          setBusy(true);
          try {
            const ch = await loginWithGoogle(response.credential, deviceName);
            if (ch) setChallenge(ch);
          } catch (err: any) {
            setError(err.message || 'Google Sign-In failed');
          } finally {
            setBusy(false);
          }
        },
      });
      googleBtnRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: 340,
        text: 'signin_with',
      });
    };

    if (window.google?.accounts?.id) {
      initGoogleButton();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogleButton;
    document.head.appendChild(script);
  }, [googleClientId, challenge, deviceName, loginWithGoogle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const ch = await login(username, password, deviceName);
      if (ch) {
        setChallenge(ch);
        setTwoFaCode('');
      }
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError('');
    setBusy(true);
    try {
      await verify2FA(challenge.challengeToken, twoFaCode);
    } catch (err: any) {
      setError(err.message || 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const handleOfflineUnlock = async () => {
    setError('');
    const ok = await unlockOffline(offlinePin);
    if (!ok) {
      setError(requiresPinForOffline ? 'Incorrect Offline PIN or no cached session.' : 'No authorized offline session found.');
    }
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
              <h1 className="text-xl font-bold text-[#1F2937]">Hira Agro Industry</h1>
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

        <h2 className="text-lg font-bold text-[#1B4D3E] border-b border-stone-200 pb-2 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          {challenge ? 'Two-Step Verification (2FA)' : t('login.title')}
        </h2>

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-900 rounded-xl p-3 text-sm font-medium">
            {error}
          </div>
        )}
        {infoMsg && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-3 text-sm font-medium">
            {infoMsg}
          </div>
        )}

        {!challenge ? (
          <>
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

            {googleClientId && (
              <div className="space-y-2 pt-2 border-t border-stone-200">
                <div className="text-center text-xs text-stone-500 font-semibold">OR SIGN IN WITH AUTHORIZED GOOGLE ACCOUNT</div>
                <div ref={googleBtnRef} className="flex justify-center" />
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleVerify2FA} className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
              <div>
                Signing in as <strong>{challenge.userPreview.fullName}</strong> (@{challenge.userPreview.username}).
              </div>
              {challenge.twoFaType === 'EMAIL_OTP' ? (
                <div>
                  A one-time 6-digit OTP was sent to <strong>{challenge.maskedEmail}</strong>. Enter it below to authorize this device (stays signed in until logout).
                </div>
              ) : (
                <div>Enter the 6-digit code from your Google Authenticator app (or an 8-character backup code).</div>
              )}
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">
                {challenge.twoFaType === 'EMAIL_OTP' ? '6-Digit Email OTP' : '6-Digit Authenticator / Backup Code'}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value)}
                placeholder={challenge.twoFaType === 'EMAIL_OTP' ? '6-digit Email OTP' : '123456 or ABCD-EF12'}
                className="input-field text-center text-xl tracking-widest font-mono"
                autoFocus
                required
              />
            </div>
            <button type="submit" disabled={busy} className="btn-primary w-full">
              <KeyRound className="w-5 h-5" /> {busy ? 'Verifying...' : 'Verify OTP & Sign In'}
            </button>
            {challenge.twoFaType === 'EMAIL_OTP' && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setError('');
                  setInfoMsg('');
                  setBusy(true);
                  try {
                    const r = await resendOtp(challenge.challengeToken);
                    setInfoMsg(`New OTP email sent to ${r.maskedEmail}.`);
                  } catch (err: any) {
                    setError(err.message);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="btn-secondary w-full text-sm"
              >
                Resend OTP Email
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setError('');
                setInfoMsg('');
              }}
              className="btn-secondary w-full"
            >
              Back to Sign In
            </button>
          </form>
        )}

        {hasCachedSession && !challenge && (
          <div className="space-y-2 pt-2 border-t border-stone-200">
            {requiresPinForOffline && (
              <input
                type="password"
                inputMode="numeric"
                value={offlinePin}
                onChange={(e) => setOfflinePin(e.target.value)}
                placeholder="Enter Offline Unlock PIN"
                className="input-field text-center tracking-widest"
              />
            )}
            <button type="button" onClick={handleOfflineUnlock} className="btn-amber w-full">
              <WifiOff className="w-5 h-5" /> {t('login.offlineUnlock')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
