import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, KeyRound, Lock, LogOut, Smartphone } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { saveOfflinePin, hasOfflinePin } from '../offline/db';

export function SecurityPage() {
  const { user, logout, refreshSession } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [setupData, setSetupData] = useState<{ secret: string; qrUrl: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');

  // Change password
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');

  // Offline PIN
  const [pin, setPin] = useState('');
  const [pinConfigured, setPinConfigured] = useState(false);

  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const loadStatus = async () => {
    setPinConfigured(await hasOfflinePin());
    if (navigator.onLine) {
      const s = await apiFetch('/auth/security-status');
      setStatus(s);
    }
  };

  useEffect(() => {
    loadStatus().catch(() => {});
  }, []);

  const start2FASetup = async () => {
    setError('');
    setMsg('');
    const res = await apiFetch<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', { method: 'POST' });
    const qrUrl = await QRCode.toDataURL(res.otpauthUri, { width: 220, margin: 1 });
    setSetupData({ secret: res.secret, qrUrl });
    setBackupCodes(null);
  };

  const confirm2FAEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiFetch<{ enabled: boolean; backupCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode }),
      });
      setBackupCodes(res.backupCodes);
      setSetupData(null);
      setVerifyCode('');
      setMsg('Two-Step Verification (2FA) is now ENABLED. Save your backup codes safely!');
      await loadStatus();
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: disablePassword, code: disableCode }),
      });
      setDisablePassword('');
      setDisableCode('');
      setMsg('Two-Step Verification disabled.');
      await loadStatus();
      await refreshSession();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
      });
      setCurPass('');
      setNewPass('');
      setMsg('Password updated & all other sessions signed out.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin.trim())) {
      setError('Offline PIN must be 4 to 6 digits.');
      return;
    }
    await saveOfflinePin(pin.trim());
    setPin('');
    setPinConfigured(true);
    setMsg('Offline Unlock PIN saved on this device.');
  };

  const handleRevokeAll = async () => {
    if (!confirm('Sign out ALL phones and computers for your account?')) return;
    await apiFetch('/auth/sessions/revoke-all', { method: 'POST' });
    await logout();
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#1F2937] flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-[#1B4D3E]" /> Account Security & Two-Step Verification
        </h1>
        <p className="text-sm text-stone-600">
          Protect <strong>{user?.fullName}</strong> (@{user?.username}) with TOTP 2FA (works offline on Authenticator app), Offline PIN lock, and Google Sign-In linking.
        </p>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {/* Single-Source Email OTP Verification Banner */}
      <div className="card p-5 space-y-2 border-l-4 border-l-[#1B4D3E]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-base text-[#1B4D3E]">
            Email OTP Two-Step Verification
          </h2>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold ${
              status?.emailOtpEnabled ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {status?.emailOtpEnabled ? 'EMAIL OTP ACTIVE' : 'CONFIGURE IN ADMIN SETTINGS'}
          </span>
        </div>
        <p className="text-xs text-stone-700">
          Registered Verification Email: <strong>{status?.otpEmail || 'Not set (Admin can assign in Users & Roles)'}</strong>
        </p>
        <p className="text-xs text-stone-600">
          When active, every new device or logged-out sign-in requires both your password AND a 1-time 6-digit OTP sent exclusively to this email. Already signed-in devices stay logged in until you click Sign Out.
        </p>
      </div>

      {/* 2FA Card */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold text-lg text-[#1B4D3E] flex items-center gap-2">
              <KeyRound className="w-5 h-5" /> Authenticator App Backup (Locked Single Device)
            </h2>
            <p className="text-xs text-stone-600">
              Locked once enabled so another phone cannot overwrite or add a second authenticator.
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${status?.totpEnabled ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-100 text-stone-700'}`}>
            {status?.totpEnabled ? 'LOCKED & ENABLED' : status?.emailOtpEnabled ? 'DISABLED (EMAIL OTP USED)' : 'OFF'}
          </span>
        </div>

        {!status?.totpEnabled && !status?.emailOtpEnabled && !setupData && (
          <button onClick={start2FASetup} className="btn-primary">
            Enable Authenticator 2FA
          </button>
        )}

        {setupData && (
          <form onSubmit={confirm2FAEnable} className="bg-[#FAF7F0] border border-stone-300 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold">
              1. Scan this QR code in Google Authenticator / Microsoft Authenticator / Authy:
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <img src={setupData.qrUrl} alt="2FA QR Code" className="w-44 h-44 bg-white p-2 rounded-xl border" />
              <div className="text-xs space-y-2 max-w-xs">
                <div className="font-semibold">Or enter setup key manually:</div>
                <div className="font-mono bg-white p-2 rounded-lg border break-all font-bold">{setupData.secret}</div>
                <div className="text-stone-600">2. Enter the 6-digit code shown in the app below to activate:</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="6-digit code"
                  className="input-field font-mono text-center text-lg tracking-widest"
                  required
                />
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary flex-1">Verify & Activate</button>
                  <button type="button" onClick={() => setSetupData(null)} className="btn-secondary">Cancel</button>
                </div>
              </div>
            </div>
          </form>
        )}

        {backupCodes && (
          <div className="bg-amber-50 border border-amber-400 rounded-xl p-4 space-y-2">
            <div className="font-bold text-amber-950 text-sm">
              Save These Single-Use Recovery Backup Codes (Shown Once!):
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
              {backupCodes.map((c) => (
                <div key={c} className="bg-white p-2 rounded-lg border text-center font-bold">{c}</div>
              ))}
            </div>
          </div>
        )}

        {status?.totpEnabled && (
          <form onSubmit={handleDisable2FA} className="pt-3 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="Current Password" className="input-field" required />
            <input type="text" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="6-digit 2FA Code" className="input-field" required />
            <button type="submit" className="btn-danger">Disable 2FA</button>
          </form>
        )}
      </div>

      {/* Offline PIN Card */}
      <div className="card p-5 space-y-3">
        <h2 className="font-bold text-base text-[#1B4D3E] flex items-center gap-2">
          <Smartphone className="w-5 h-5" /> Device Offline Unlock PIN ({pinConfigured ? 'Active' : 'Not Set'})
        </h2>
        <p className="text-xs text-stone-600">
          Requires a 4–6 digit PIN before anyone can unlock your cached offline session on this phone without internet.
        </p>
        <form onSubmit={handleSetPin} className="flex gap-2 max-w-sm">
          <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4–6 digit PIN" className="input-field" required />
          <button type="submit" className="btn-primary shrink-0">Save PIN</button>
        </form>
      </div>

      {/* Password & Sessions Card */}
      <div className="card p-5 space-y-4">
        <h2 className="font-bold text-base text-[#1B4D3E] flex items-center gap-2">
          <Lock className="w-5 h-5" /> Change Password & Active Sessions ({status?.activeSessionsCount ?? 1})
        </h2>
        <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} placeholder="Current Password" className="input-field" required />
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New Strong Password (8+ chars, A-z, 0-9)" className="input-field" required />
          <button type="submit" className="btn-primary">Update Password</button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-stone-200 text-xs">
          <span>Linked Google Account: <strong>{status?.googleEmail || 'Not linked (Admin can link in Users & Roles)'}</strong></span>
          <button onClick={handleRevokeAll} className="btn-danger !min-h-[38px] !py-1.5 text-xs">
            <LogOut className="w-4 h-4" /> Sign Out All Devices
          </button>
        </div>
      </div>
    </div>
  );
}
