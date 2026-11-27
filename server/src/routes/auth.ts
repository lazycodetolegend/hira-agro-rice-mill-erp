import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import {
  newId,
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashToken,
  encryptSensitiveText,
  decryptSensitiveText,
  validatePasswordStrength,
} from '../utils/crypto.js';
import {
  generateBase32Secret,
  verifyTotpCode,
  buildOtpAuthUri,
  generateBackupCodes,
  consumeBackupCode,
} from '../utils/totp.js';
import {
  isEmailDeliveryConfigured,
  maskEmail,
  sendLoginOtpEmail,
  sendMailMessage,
} from '../utils/mailer.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { recordAudit } from '../middleware/audit.js';

export const authRouter = Router();

const loginLimiter = createRateLimiter('login', 30, 60_000);
const twoFaLimiter = createRateLimiter('2fa', 25, 60_000);

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export function sanitizeBusiness(biz: any) {
  if (!biz) return biz;
  const { smtp_pass_enc, ...safe } = biz;
  return {
    ...safe,
    smtp_configured: Boolean(smtp_pass_enc) || Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) || Boolean(process.env.RESEND_API_KEY),
    email_otp_active: isEmailOtpActiveForBusiness(biz),
  };
}

export function isEmailOtpActiveForBusiness(biz: any): boolean {
  const envConfigured = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) || Boolean(process.env.RESEND_API_KEY);
  return (Boolean(biz?.email_otp_enabled) || envConfigured) && isEmailDeliveryConfigured(biz);
}

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  aud: string;
  name?: string;
}

type GoogleVerifier = (idToken: string, expectedClientId: string) => Promise<VerifiedGoogleIdentity>;

let customGoogleVerifier: GoogleVerifier | null = null;
export function setGoogleTokenVerifierForTest(fn: GoogleVerifier | null) {
  customGoogleVerifier = fn;
}

async function verifyGoogleIdToken(idToken: string, expectedClientId: string): Promise<VerifiedGoogleIdentity> {
  if (customGoogleVerifier) {
    return customGoogleVerifier(idToken, expectedClientId);
  }
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Google ID token verification failed.');
  }
  const info: any = await res.json();
  const expMs = Number(info.exp || 0) * 1000;
  if (!info.sub || !info.email || info.email_verified !== 'true' || expMs <= Date.now()) {
    throw new Error('Google account email is not verified or token has expired.');
  }
  if (expectedClientId && info.aud !== expectedClientId) {
    throw new Error('Google token audience mismatch.');
  }
  return {
    sub: String(info.sub),
    email: String(info.email).toLowerCase(),
    emailVerified: true,
    aud: String(info.aud),
    name: info.name,
  };
}

function issueAuthenticatedSession(
  user: any,
  deviceKey: string,
  deviceName: string,
  platform: string,
  authMethod: string
) {
  const now = nowIso();
  const result = withTransaction(() => {
    let device = queryOne<any>(
      'SELECT * FROM devices WHERE business_id = ? AND device_key = ?',
      [user.business_id, deviceKey]
    );
    if (device && device.is_revoked) {
      throw new Error('DEVICE_REVOKED');
    }

    let deviceId: string;
    if (!device) {
      deviceId = newId();
      execute(
        `INSERT INTO devices (id, business_id, user_id, device_key, device_name, platform, is_revoked, last_seen_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [deviceId, user.business_id, user.id, deviceKey, deviceName, platform || 'web', now, now, now]
      );
    } else {
      deviceId = device.id;
      execute('UPDATE devices SET user_id = ?, device_name = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', [
        user.id,
        deviceName,
        now,
        now,
        deviceId,
      ]);
    }

    const { rawToken, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    execute(
      `INSERT INTO sessions (id, business_id, user_id, device_id, token_hash, expires_at, is_revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [newId(), user.business_id, user.id, deviceId, tokenHash, expiresAt, now]
    );
    execute(
      'UPDATE users SET last_login_at = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [now, user.id]
    );

    recordAudit({
      businessId: user.business_id,
      userId: user.id,
      deviceId,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.username} logged in (${authMethod}) on ${deviceName}`,
    });

    return { rawToken, deviceId, expiresAt };
  });

  const business = sanitizeBusiness(queryOne<any>('SELECT * FROM businesses WHERE id = ?', [user.business_id]));

  return {
    token: result.rawToken,
    expiresAt: result.expiresAt,
    deviceId: result.deviceId,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      preferredLang: user.preferred_lang,
      roleId: user.role_id,
      roleCode: user.role_code,
      roleName: user.role_name,
      totpEnabled: Boolean(user.totp_enabled),
      email: user.email || user.google_email || null,
      googleEmail: user.google_email || null,
      emailOtpActive: Boolean(business?.email_otp_active),
      permissions: JSON.parse(user.permissions_json || '[]'),
    },
    business,
  };
}

function createTwoFactorChallenge(
  user: any,
  authMethod: string,
  deviceKey: string,
  deviceName: string,
  platform: string
) {
  const { rawToken, tokenHash } = generateSessionToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  execute(
    `INSERT INTO auth_challenges (
      id, business_id, user_id, token_hash, auth_method, two_fa_type, device_key, device_name, platform, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'TOTP', ?, ?, ?, ?, ?)`,
    [newId(), user.business_id, user.id, tokenHash, authMethod, deviceKey, deviceName, platform || 'web', expiresAt, now]
  );
  return {
    requires2FA: true,
    twoFaType: 'TOTP' as const,
    challengeToken: rawToken,
    expiresAt,
    userPreview: { username: user.username, fullName: user.full_name },
  };
}

async function createAndSendEmailOtpChallenge(
  user: any,
  business: any,
  authMethod: string,
  deviceKey: string,
  deviceName: string,
  platform: string
) {
  const targetEmail = (user.email || user.google_email || '').trim().toLowerCase();
  if (!targetEmail) {
    throw new Error('NO_EMAIL_CONFIGURED');
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashToken(otp);
  const { rawToken, tokenHash } = generateSessionToken();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sendLoginOtpEmail({
    business,
    to: targetEmail,
    fullName: user.full_name,
    username: user.username,
    otp,
    deviceName,
  });

  execute(
    `INSERT INTO auth_challenges (
      id, business_id, user_id, token_hash, auth_method, two_fa_type, email_otp_hash, otp_attempts, last_otp_sent_at,
      device_key, device_name, platform, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, 'EMAIL_OTP', ?, 0, ?, ?, ?, ?, ?, ?)`,
    [newId(), user.business_id, user.id, tokenHash, authMethod, otpHash, now, deviceKey, deviceName, platform || 'web', expiresAt, now]
  );

  recordAudit({
    businessId: user.business_id,
    userId: user.id,
    deviceId: deviceKey,
    action: 'EMAIL_OTP_SENT',
    entityType: 'user',
    entityId: user.id,
    summary: `Login OTP sent to ${maskEmail(targetEmail)} for ${deviceName}`,
  });

  return {
    requires2FA: true,
    twoFaType: 'EMAIL_OTP' as const,
    maskedEmail: maskEmail(targetEmail),
    challengeToken: rawToken,
    expiresAt,
    userPreview: { username: user.username, fullName: user.full_name },
  };
}

// Public non-secret auth config (e.g. Google Sign-In Client ID)
authRouter.get('/public-config', (_req, res) => {
  const biz = queryOne<{ google_client_id: string | null }>('SELECT google_client_id FROM businesses LIMIT 1');
  const googleClientId = process.env.GOOGLE_CLIENT_ID || biz?.google_client_id || null;
  res.json({
    googleSignInEnabled: Boolean(googleClientId),
    googleClientId,
  });
});

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceKey: z.string().min(2).max(120).optional(),
  deviceName: z.string().min(1).max(120).optional(),
  platform: z.string().max(60).optional(),
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const { username, password, deviceKey, deviceName, platform } = parsed.data;
  const dKey = deviceKey || `web-${req.ip || 'local'}`;
  const dName = deviceName || 'Web / Mobile Browser';

  const user = queryOne<any>(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions_json
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER(?)`,
    [username.trim()]
  );

  if (!user || !user.is_active) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const nowMs = Date.now();
  if (user.locked_until && new Date(user.locked_until).getTime() > nowMs) {
    const minsLeft = Math.ceil((new Date(user.locked_until).getTime() - nowMs) / 60000);
    res.status(423).json({
      error: `Account temporarily locked after failed attempts. Try again in ${minsLeft} minute(s).`,
    });
    return;
  }

  if (!verifyPassword(password, user.password_hash)) {
    const nextFails = Number(user.failed_login_attempts || 0) + 1;
    const lockedUntil = nextFails >= MAX_FAILED_ATTEMPTS ? new Date(nowMs + LOCK_DURATION_MS).toISOString() : null;
    execute('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [
      nextFails,
      lockedUntil,
      user.id,
    ]);
    recordAudit({
      businessId: user.business_id,
      userId: user.id,
      deviceId: dKey,
      action: lockedUntil ? 'ACCOUNT_LOCKED' : 'USER_LOGIN_FAILED',
      entityType: 'user',
      entityId: user.id,
      summary: `Failed login #${nextFails} from IP ${req.ip}`,
    });
    res.status(lockedUntil ? 423 : 401).json({
      error: lockedUntil
        ? 'Too many failed password attempts. Account locked for 15 minutes.'
        : 'Invalid username or password.',
    });
    return;
  }

  const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [user.business_id]);

  // Primary 2-Step Verification: One-Time OTP sent exclusively to user's registered Email ID
  if (isEmailOtpActiveForBusiness(biz)) {
    try {
      const ch = await createAndSendEmailOtpChallenge(user, biz, 'PASSWORD+EMAIL_OTP', dKey, dName, platform || 'web');
      res.json(ch);
      return;
    } catch (err: any) {
      if (err?.message === 'NO_EMAIL_CONFIGURED') {
        res.status(403).json({
          error: 'No OTP email address is assigned to this account. Ask Admin to set your email in Users & Roles.',
        });
        return;
      }
      res.status(503).json({ error: `Unable to send OTP email: ${err?.message || 'SMTP error'}` });
      return;
    }
  }

  // Legacy Authenticator TOTP fallback if Email OTP is not yet configured
  if (user.totp_enabled) {
    res.json(createTwoFactorChallenge(user, 'PASSWORD+2FA', dKey, dName, platform || 'web'));
    return;
  }

  try {
    res.json(issueAuthenticatedSession(user, dKey, dName, platform || 'web', 'PASSWORD'));
  } catch (err: any) {
    if (err?.message === 'DEVICE_REVOKED') {
      res.status(403).json({ error: 'This device has been revoked by Admin.' });
      return;
    }
    throw err;
  }
});

// Two-Step Verification (Email OTP, TOTP or Single-Use Backup Code)
authRouter.post('/verify-2fa', twoFaLimiter, (req, res) => {
  const { challengeToken, code } = req.body || {};
  if (!challengeToken || !code) {
    res.status(400).json({ error: 'Verification code is required.' });
    return;
  }

  const tokenHash = hashToken(String(challengeToken));
  const challenge = queryOne<any>('SELECT * FROM auth_challenges WHERE token_hash = ?', [tokenHash]);
  if (!challenge || challenge.consumed_at || challenge.expires_at < nowIso()) {
    res.status(401).json({ error: 'OTP expired or invalid. Please sign in again.' });
    return;
  }

  if (Number(challenge.otp_attempts || 0) >= MAX_OTP_ATTEMPTS) {
    execute('UPDATE auth_challenges SET consumed_at = ? WHERE id = ?', [nowIso(), challenge.id]);
    res.status(401).json({ error: 'Too many invalid OTP attempts. Please sign in again.' });
    return;
  }

  const user = queryOne<any>(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions_json
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = ? AND u.business_id = ?`,
    [challenge.user_id, challenge.business_id]
  );
  if (!user || !user.is_active) {
    res.status(401).json({ error: 'User account not active.' });
    return;
  }

  const cleanCode = String(code).trim();
  let verified = false;

  if (challenge.two_fa_type === 'EMAIL_OTP') {
    if (challenge.email_otp_hash && cleanCode.length === 6) {
      const candidateHash = hashToken(cleanCode);
      if (
        candidateHash.length === challenge.email_otp_hash.length &&
        crypto.timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(challenge.email_otp_hash, 'hex'))
      ) {
        verified = true;
      }
    }
  } else {
    if (!user.totp_enabled || !user.totp_secret_enc) {
      res.status(401).json({ error: '2FA not active for this user.' });
      return;
    }
    const secret = decryptSensitiveText(user.totp_secret_enc);
    const totpCheck = verifyTotpCode(secret, cleanCode, Number(user.last_totp_step ?? -1));
    if (totpCheck.valid) {
      verified = true;
      execute('UPDATE users SET last_totp_step = ? WHERE id = ?', [totpCheck.matchedStep, user.id]);
    }
  }

  // Fallback to single-use backup codes if configured
  if (!verified && user.totp_backup_codes_json) {
    const hashedCodes: string[] = JSON.parse(user.totp_backup_codes_json || '[]');
    const backup = consumeBackupCode(cleanCode, hashedCodes);
    if (backup.valid) {
      verified = true;
      execute('UPDATE users SET totp_backup_codes_json = ? WHERE id = ?', [
        JSON.stringify(backup.remainingHashes),
        user.id,
      ]);
      recordAudit({
        businessId: user.business_id,
        userId: user.id,
        deviceId: challenge.device_key,
        action: '2FA_BACKUP_CODE_USED',
        entityType: 'user',
        entityId: user.id,
        summary: `Used backup code (${backup.remainingHashes.length} remaining)`,
      });
    }
  }

  if (!verified) {
    const nextAttempts = Number(challenge.otp_attempts || 0) + 1;
    const exhausted = nextAttempts >= MAX_OTP_ATTEMPTS;
    execute('UPDATE auth_challenges SET otp_attempts = ?, consumed_at = ? WHERE id = ?', [
      nextAttempts,
      exhausted ? nowIso() : null,
      challenge.id,
    ]);
    recordAudit({
      businessId: user.business_id,
      userId: user.id,
      deviceId: challenge.device_key,
      action: '2FA_FAILED',
      entityType: 'user',
      entityId: user.id,
      summary: `Invalid ${challenge.two_fa_type} code attempt #${nextAttempts} from IP ${req.ip}`,
    });
    res.status(401).json({
      error: exhausted
        ? 'Too many incorrect OTP codes. Challenge cancelled — please sign in again.'
        : challenge.two_fa_type === 'EMAIL_OTP'
          ? 'Invalid 6-digit Email OTP.'
          : 'Invalid 6-digit code.',
    });
    return;
  }

  execute('UPDATE auth_challenges SET consumed_at = ? WHERE id = ?', [nowIso(), challenge.id]);

  try {
    res.json(
      issueAuthenticatedSession(
        user,
        challenge.device_key,
        challenge.device_name,
        challenge.platform || 'web',
        challenge.auth_method
      )
    );
  } catch (err: any) {
    if (err?.message === 'DEVICE_REVOKED') {
      res.status(403).json({ error: 'This device has been revoked by Admin.' });
      return;
    }
    throw err;
  }
});

// Resend Email OTP on an active login challenge (30s cooldown)
authRouter.post('/resend-otp', twoFaLimiter, async (req, res) => {
  const { challengeToken } = req.body || {};
  if (!challengeToken) {
    res.status(400).json({ error: 'Challenge token is required.' });
    return;
  }
  const tokenHash = hashToken(String(challengeToken));
  const challenge = queryOne<any>('SELECT * FROM auth_challenges WHERE token_hash = ?', [tokenHash]);
  if (!challenge || challenge.consumed_at || challenge.expires_at < nowIso() || challenge.two_fa_type !== 'EMAIL_OTP') {
    res.status(401).json({ error: 'OTP session expired. Please sign in again.' });
    return;
  }
  if (challenge.last_otp_sent_at && Date.now() - new Date(challenge.last_otp_sent_at).getTime() < 30_000) {
    res.status(429).json({ error: 'Please wait 30 seconds before requesting another OTP email.' });
    return;
  }

  const user = queryOne<any>('SELECT * FROM users WHERE id = ? AND is_active = 1', [challenge.user_id]);
  const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [challenge.business_id]);
  const targetEmail = (user?.email || user?.google_email || '').trim().toLowerCase();
  if (!user || !biz || !targetEmail) {
    res.status(400).json({ error: 'User email not available for OTP.' });
    return;
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sendLoginOtpEmail({
    business: biz,
    to: targetEmail,
    fullName: user.full_name,
    username: user.username,
    otp,
    deviceName: challenge.device_name,
  });

  execute(
    'UPDATE auth_challenges SET email_otp_hash = ?, otp_attempts = 0, last_otp_sent_at = ?, expires_at = ? WHERE id = ?',
    [hashToken(otp), now, expiresAt, challenge.id]
  );

  res.json({ ok: true, maskedEmail: maskEmail(targetEmail) });
});

// Google Sign-In (Whitelisted users only)
authRouter.post('/google', loginLimiter, async (req, res) => {
  try {
    const { idToken, deviceKey, deviceName, platform } = req.body || {};
    if (!idToken) {
      res.status(400).json({ error: 'Google ID token is required.' });
      return;
    }
    const biz = queryOne<{ id: string; google_client_id: string | null }>('SELECT id, google_client_id FROM businesses LIMIT 1');
    const expectedClientId = process.env.GOOGLE_CLIENT_ID || biz?.google_client_id || '';
    if (!expectedClientId) {
      res.status(400).json({ error: 'Google Sign-In is not configured yet by Admin.' });
      return;
    }

    const identity = await verifyGoogleIdToken(String(idToken), expectedClientId);

    const user = queryOne<any>(
      `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions_json
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1 AND (LOWER(u.google_email) = LOWER(?) OR LOWER(u.email) = LOWER(?))`,
      [identity.email, identity.email]
    );

    if (!user) {
      res.status(403).json({
        error: `Google account (${identity.email}) is not authorized for this business. Ask Admin to link this email first.`,
      });
      return;
    }

    // Pin Google sub on first login so email changes on Google cannot hijack another account
    if (user.google_sub && user.google_sub !== identity.sub) {
      res.status(403).json({ error: 'Google account identity mismatch.' });
      return;
    }
    if (!user.google_sub) {
      execute('UPDATE users SET google_sub = ?, google_email = ? WHERE id = ?', [
        identity.sub,
        identity.email,
        user.id,
      ]);
    }

    const dKey = deviceKey || `web-${req.ip || 'local'}`;
    const dName = deviceName || 'Google Sign-In Browser';
    const fullBiz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [user.business_id]);

    if (isEmailOtpActiveForBusiness(fullBiz)) {
      const ch = await createAndSendEmailOtpChallenge(user, fullBiz, 'GOOGLE+EMAIL_OTP', dKey, dName, platform || 'web');
      res.json(ch);
      return;
    }

    if (user.totp_enabled) {
      res.json(createTwoFactorChallenge(user, 'GOOGLE+2FA', dKey, dName, platform || 'web'));
      return;
    }

    res.json(issueAuthenticatedSession(user, dKey, dName, platform || 'web', 'GOOGLE'));
  } catch (err: any) {
    if (err?.message === 'DEVICE_REVOKED') {
      res.status(403).json({ error: 'This device has been revoked by Admin.' });
      return;
    }
    if (err?.message === 'NO_EMAIL_CONFIGURED') {
      res.status(403).json({ error: 'No OTP email address is assigned to this account.' });
      return;
    }
    res.status(401).json({ error: err?.message || 'Google authentication failed.' });
  }
});

// 2FA Setup, Enable & Disable for authenticated users (LOCKED if 2FA or Email OTP is already enabled)
authRouter.get('/security-status', requireAuth, (req, res) => {
  const u = queryOne<any>(
    'SELECT totp_enabled, google_email, email, last_login_at, totp_backup_codes_json FROM users WHERE id = ?',
    [req.auth!.userId]
  );
  const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
  const sessionsCount = queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND is_revoked = 0 AND expires_at > ?',
    [req.auth!.userId, nowIso()]
  );
  const backupRemaining = JSON.parse(u?.totp_backup_codes_json || '[]').length;
  res.json({
    totpEnabled: Boolean(u?.totp_enabled),
    emailOtpEnabled: isEmailOtpActiveForBusiness(biz),
    otpEmail: u?.email || u?.google_email || null,
    googleEmail: u?.google_email || u?.email || null,
    backupCodesRemaining: backupRemaining,
    activeSessionsCount: sessionsCount?.c || 0,
    lastLoginAt: u?.last_login_at || null,
  });
});

// Admin Email OTP / Gmail SMTP configuration
authRouter.get('/email-otp-config', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), (req, res) => {
  const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
  const usingEnvVars = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) || Boolean(process.env.RESEND_API_KEY);
  res.json({
    emailOtpEnabled: Boolean(biz?.email_otp_enabled) || usingEnvVars,
    deliveryConfigured: isEmailDeliveryConfigured(biz),
    usingEnvVars,
    smtpHost: biz?.smtp_host || 'smtp.gmail.com',
    smtpPort: Number(biz?.smtp_port || 465),
    smtpUser: biz?.smtp_user || '',
    smtpFrom: biz?.smtp_from || '',
    hasSavedPassword: Boolean(biz?.smtp_pass_enc),
  });
});

authRouter.post('/email-otp-config', requireAuth, requirePermission(PERMISSIONS.BUSINESS_MANAGE), async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, emailOtpEnabled, testRecipient } = req.body || {};
    const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
    const encPass =
      typeof smtpPass === 'string' && smtpPass.trim().length > 0 ? encryptSensitiveText(smtpPass.trim()) : undefined;

    execute(
      `UPDATE businesses SET
         smtp_host = COALESCE(?, smtp_host),
         smtp_port = COALESCE(?, smtp_port),
         smtp_user = COALESCE(?, smtp_user),
         smtp_pass_enc = COALESCE(?, smtp_pass_enc),
         smtp_from = COALESCE(?, smtp_from),
         updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        smtpHost?.trim() || null,
        smtpPort ? Number(smtpPort) : null,
        smtpUser?.trim() || null,
        encPass ?? null,
        smtpFrom?.trim() || null,
        nowIso(),
        req.auth!.userId,
        req.auth!.businessId,
      ]
    );

    const updatedBiz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);

    if (emailOtpEnabled === true) {
      const adminUser = queryOne<any>('SELECT email, google_email, full_name FROM users WHERE id = ?', [req.auth!.userId]);
      const recipient = (testRecipient || adminUser?.email || adminUser?.google_email || updatedBiz?.smtp_user || '').trim();
      if (!recipient) {
        res.status(400).json({ error: 'Provide a valid Admin email address to test Email OTP delivery.' });
        return;
      }
      await sendMailMessage(updatedBiz, {
        to: recipient,
        subject: `${updatedBiz.name || 'Hira Agro Industry'} — Email OTP Verification Active`,
        text: `Your Email OTP Verification system is now active. Every new device sign-in will send a one-time 6-digit OTP to this email.`,
        html: `<p>Your <strong>${updatedBiz.name || 'Hira Agro Industry'}</strong> Email OTP Two-Step Verification is now <strong>ACTIVE</strong>. Every new device sign-in will require a one-time 6-digit OTP sent to the user's registered email.</p>`,
      });
      execute('UPDATE businesses SET email_otp_enabled = 1, updated_at = ? WHERE id = ?', [
        nowIso(),
        req.auth!.businessId,
      ]);
      recordAudit({
        businessId: req.auth!.businessId,
        userId: req.auth!.userId,
        deviceId: req.auth!.deviceId,
        action: 'EMAIL_OTP_ENABLED',
        entityType: 'business',
        entityId: req.auth!.businessId,
        summary: `Enabled mandatory Email OTP login verification (tested delivery to ${maskEmail(recipient)})`,
      });
      res.json({ ok: true, emailOtpEnabled: true, testedRecipient: maskEmail(recipient) });
      return;
    }

    if (emailOtpEnabled === false) {
      execute('UPDATE businesses SET email_otp_enabled = 0, updated_at = ? WHERE id = ?', [
        nowIso(),
        req.auth!.businessId,
      ]);
    }

    res.json({ ok: true, emailOtpEnabled: Boolean(updatedBiz?.email_otp_enabled) });
  } catch (err: any) {
    res.status(400).json({ error: `Email delivery test failed: ${err?.message || 'Check Gmail App Password'}` });
  }
});

authRouter.post('/2fa/setup', requireAuth, (req, res) => {
  const existing = queryOne<any>('SELECT totp_enabled FROM users WHERE id = ?', [req.auth!.userId]);
  const biz = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
  if (isEmailOtpActiveForBusiness(biz)) {
    res.status(403).json({
      error: 'Email OTP Verification is active. Separate per-device Authenticator setup is disabled to keep one single OTP source.',
    });
    return;
  }
  // Security fix: NEVER allow overwriting an already-active TOTP secret from another logged-in session!
  if (existing?.totp_enabled) {
    res.status(403).json({
      error: 'Two-Step Verification is already locked and active. You cannot overwrite it from another device without disabling or Admin reset.',
    });
    return;
  }

  const secret = generateBase32Secret(20);
  const encryptedSecret = encryptSensitiveText(secret);
  execute('UPDATE users SET totp_secret_enc = ?, updated_at = ? WHERE id = ?', [
    encryptedSecret,
    nowIso(),
    req.auth!.userId,
  ]);
  const otpauthUri = buildOtpAuthUri(req.auth!.username, biz?.name || 'Hira Agro Industry', secret);
  res.json({ secret, otpauthUri });
});

authRouter.post('/2fa/enable', requireAuth, (req, res) => {
  const code = String(req.body?.code || '');
  const u = queryOne<any>('SELECT totp_secret_enc, last_totp_step FROM users WHERE id = ?', [req.auth!.userId]);
  if (!u?.totp_secret_enc) {
    res.status(400).json({ error: 'Run 2FA setup first.' });
    return;
  }
  const secret = decryptSensitiveText(u.totp_secret_enc);
  const check = verifyTotpCode(secret, code, Number(u.last_totp_step ?? -1));
  if (!check.valid) {
    res.status(400).json({ error: 'Invalid 6-digit code from Authenticator app. Check phone clock & retry.' });
    return;
  }
  const { plainCodes, hashedCodes } = generateBackupCodes(8);
  execute(
    'UPDATE users SET totp_enabled = 1, last_totp_step = ?, totp_backup_codes_json = ?, updated_at = ? WHERE id = ?',
    [check.matchedStep, JSON.stringify(hashedCodes), nowIso(), req.auth!.userId]
  );
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: '2FA_ENABLED',
    entityType: 'user',
    entityId: req.auth!.userId,
    summary: `Enabled TOTP 2-Step Verification for ${req.auth!.username}`,
  });
  res.json({ enabled: true, backupCodes: plainCodes });
});

authRouter.post('/2fa/disable', requireAuth, (req, res) => {
  const { password, code } = req.body || {};
  const u = queryOne<any>('SELECT password_hash, totp_secret_enc, totp_enabled FROM users WHERE id = ?', [
    req.auth!.userId,
  ]);
  if (!u?.totp_enabled) {
    res.status(400).json({ error: '2FA is not enabled.' });
    return;
  }
  if (!password || !verifyPassword(String(password), u.password_hash)) {
    res.status(401).json({ error: 'Current password is required to disable 2FA.' });
    return;
  }
  const secret = decryptSensitiveText(u.totp_secret_enc);
  if (!verifyTotpCode(secret, String(code || '')).valid) {
    res.status(401).json({ error: 'Current 6-digit Authenticator code is required.' });
    return;
  }
  execute(
    'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_backup_codes_json = NULL, updated_at = ? WHERE id = ?',
    [nowIso(), req.auth!.userId]
  );
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: '2FA_DISABLED',
    entityType: 'user',
    entityId: req.auth!.userId,
    summary: `Disabled 2FA for ${req.auth!.username}`,
  });
  res.json({ enabled: false });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const u = queryOne<any>('SELECT password_hash FROM users WHERE id = ?', [req.auth!.userId]);
  if (!u || !verifyPassword(String(currentPassword || ''), u.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  const strengthErr = validatePasswordStrength(String(newPassword || ''));
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }
  execute('UPDATE users SET password_hash = ?, updated_at = ?, updated_by = ? WHERE id = ?', [
    hashPassword(String(newPassword)),
    nowIso(),
    req.auth!.userId,
    req.auth!.userId,
  ]);
  // Revoke other active sessions when password changes
  execute('UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND device_id != ?', [
    req.auth!.userId,
    req.auth!.deviceId,
  ]);
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'PASSWORD_CHANGED',
    entityType: 'user',
    entityId: req.auth!.userId,
    summary: `${req.auth!.username} changed password & revoked other sessions`,
  });
  res.json({ ok: true });
});

authRouter.post('/sessions/revoke-all', requireAuth, (req, res) => {
  execute('UPDATE sessions SET is_revoked = 1 WHERE user_id = ?', [req.auth!.userId]);
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'ALL_SESSIONS_REVOKED',
    entityType: 'user',
    entityId: req.auth!.userId,
    summary: `Revoked all active sessions for ${req.auth!.username}`,
  });
  res.json({ ok: true });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  execute(
    'UPDATE sessions SET is_revoked = 1 WHERE user_id = ? AND device_id = ? AND is_revoked = 0',
    [req.auth!.userId, req.auth!.deviceId]
  );
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'USER_LOGOUT',
    entityType: 'user',
    entityId: req.auth!.userId,
    summary: `${req.auth!.username} logged out`,
  });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const business = sanitizeBusiness(queryOne('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]));
  const u = queryOne<{ totp_enabled: number; google_email: string | null; email: string | null }>(
    'SELECT totp_enabled, google_email, email FROM users WHERE id = ?',
    [req.auth!.userId]
  );
  res.json({
    user: {
      id: req.auth!.userId,
      username: req.auth!.username,
      fullName: req.auth!.fullName,
      preferredLang: req.auth!.preferredLang,
      roleId: req.auth!.roleId,
      roleCode: req.auth!.roleCode,
      roleName: req.auth!.roleName,
      totpEnabled: Boolean(u?.totp_enabled),
      email: u?.email || u?.google_email || null,
      googleEmail: u?.google_email || null,
      emailOtpActive: Boolean(business?.email_otp_active),
      permissions: Array.from(req.auth!.permissions),
    },
    deviceId: req.auth!.deviceId,
    business,
  });
});

authRouter.patch('/language', requireAuth, (req, res) => {
  const lang = req.body?.lang;
  if (!['en', 'hi', 'mr'].includes(lang)) {
    res.status(400).json({ error: 'Unsupported language. Use en, hi, or mr.' });
    return;
  }
  execute('UPDATE users SET preferred_lang = ?, updated_at = ? WHERE id = ?', [
    lang,
    nowIso(),
    req.auth!.userId,
  ]);
  res.json({ ok: true, preferredLang: lang });
});

// Users management
authRouter.get('/users', requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
  const users = queryAll(
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.google_email, u.totp_enabled,
            u.failed_login_attempts, u.locked_until, u.role_id, u.preferred_lang, u.is_active,
            u.last_login_at, u.created_at,
            r.name AS role_name, r.code AS role_code
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.business_id = ? ORDER BY u.created_at ASC`,
    [req.auth!.businessId]
  );
  res.json(users);
});

authRouter.post('/users', requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
  const schema = z.object({
    username: z.string().min(2).max(50),
    fullName: z.string().min(2).max(120),
    password: z.string().min(8).max(100),
    roleId: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    googleEmail: z.string().email().optional().or(z.literal('')),
    preferredLang: z.enum(['en', 'hi', 'mr']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload' });
    return;
  }

  const d = parsed.data;
  const strengthErr = validatePasswordStrength(d.password);
  if (strengthErr) {
    res.status(400).json({ error: strengthErr });
    return;
  }

  const dup = queryOne('SELECT id FROM users WHERE business_id = ? AND LOWER(username) = LOWER(?)', [
    req.auth!.businessId,
    d.username.trim(),
  ]);
  if (dup) {
    res.status(409).json({ error: 'Username already exists.' });
    return;
  }

  const role = queryOne('SELECT id FROM roles WHERE id = ? AND business_id = ?', [
    d.roleId,
    req.auth!.businessId,
  ]);
  if (!role) {
    res.status(400).json({ error: 'Role not found.' });
    return;
  }

  const id = newId();
  const now = nowIso();
  const gEmail = d.googleEmail ? d.googleEmail.trim().toLowerCase() : null;
  execute(
    `INSERT INTO users (id, business_id, username, full_name, phone, email, google_email, password_hash, role_id, preferred_lang, is_active, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      d.username.trim().toLowerCase(),
      d.fullName.trim(),
      d.phone ?? null,
      d.email ?? gEmail,
      gEmail,
      hashPassword(d.password),
      d.roleId,
      d.preferredLang || 'en',
      now,
      now,
      req.auth!.userId,
    ]
  );

  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: id,
    summary: `Created user ${d.username} (${d.fullName})`,
  });

  res.status(201).json({ id, username: d.username.trim().toLowerCase(), full_name: d.fullName });
});

authRouter.patch('/users/:id', requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), (req, res) => {
  const user = queryOne<any>('SELECT * FROM users WHERE id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  if (!user) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const { fullName, roleId, isActive, password, phone, email, preferredLang, googleEmail, unlockAccount, reset2FA } = req.body;
  if (password) {
    const strengthErr = validatePasswordStrength(String(password));
    if (strengthErr) {
      res.status(400).json({ error: strengthErr });
      return;
    }
  }

  const now = nowIso();
  execute(
    `UPDATE users SET
       full_name = COALESCE(?, full_name),
       role_id = COALESCE(?, role_id),
       is_active = COALESCE(?, is_active),
       phone = COALESCE(?, phone),
       email = CASE WHEN ? IS NOT NULL THEN NULLIF(LOWER(TRIM(?)), '') ELSE email END,
       preferred_lang = COALESCE(?, preferred_lang),
       google_email = CASE WHEN ? IS NOT NULL THEN NULLIF(LOWER(TRIM(?)), '') ELSE google_email END,
       google_sub = CASE WHEN ? IS NOT NULL AND LOWER(TRIM(?)) != COALESCE(LOWER(google_email), '') THEN NULL ELSE google_sub END,
       password_hash = COALESCE(?, password_hash),
       failed_login_attempts = CASE WHEN ? = 1 THEN 0 ELSE failed_login_attempts END,
       locked_until = CASE WHEN ? = 1 THEN NULL ELSE locked_until END,
       totp_enabled = CASE WHEN ? = 1 THEN 0 ELSE totp_enabled END,
       totp_secret_enc = CASE WHEN ? = 1 THEN NULL ELSE totp_secret_enc END,
       totp_backup_codes_json = CASE WHEN ? = 1 THEN NULL ELSE totp_backup_codes_json END,
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
    [
      fullName ?? null,
      roleId ?? null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      phone ?? null,
      email ?? null,
      email ?? null,
      preferredLang ?? null,
      googleEmail ?? null,
      googleEmail ?? null,
      googleEmail ?? null,
      googleEmail ?? null,
      password ? hashPassword(String(password)) : null,
      unlockAccount ? 1 : 0,
      unlockAccount ? 1 : 0,
      reset2FA ? 1 : 0,
      reset2FA ? 1 : 0,
      reset2FA ? 1 : 0,
      now,
      req.auth!.userId,
      user.id,
    ]
  );

  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'USER_UPDATED',
    entityType: 'user',
    entityId: user.id,
    summary: `Updated user ${user.username}${reset2FA ? ' (2FA reset)' : ''}${unlockAccount ? ' (unlocked)' : ''}`,
  });

  res.json({ ok: true });
});

// Roles management
authRouter.get('/roles', requireAuth, requirePermission(PERMISSIONS.ROLES_MANAGE), (req, res) => {
  const roles = queryAll('SELECT * FROM roles WHERE business_id = ? ORDER BY is_system DESC, name ASC', [
    req.auth!.businessId,
  ]);
  res.json(roles.map((r: any) => ({ ...r, permissions: JSON.parse(r.permissions_json || '[]') })));
});

authRouter.post('/roles', requireAuth, requirePermission(PERMISSIONS.ROLES_MANAGE), (req, res) => {
  const { name, code, description, permissions } = req.body;
  if (!name || !code || !Array.isArray(permissions)) {
    res.status(400).json({ error: 'Role name, code, and permissions array are required.' });
    return;
  }
  const id = newId();
  const now = nowIso();
  execute(
    `INSERT INTO roles (id, business_id, name, code, description, is_system, permissions_json, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      name,
      String(code).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      description ?? null,
      JSON.stringify(permissions),
      now,
      now,
      req.auth!.userId,
    ]
  );
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'ROLE_CREATED',
    entityType: 'role',
    entityId: id,
    summary: `Created role ${name}`,
  });
  res.status(201).json({ id, name, code });
});

authRouter.patch('/roles/:id', requireAuth, requirePermission(PERMISSIONS.ROLES_MANAGE), (req, res) => {
  const role = queryOne<any>('SELECT * FROM roles WHERE id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  if (!role) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }
  const { name, description, permissions } = req.body;
  execute(
    `UPDATE roles SET
       name = COALESCE(?, name),
       description = COALESCE(?, description),
       permissions_json = COALESCE(?, permissions_json),
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
    [
      name ?? null,
      description ?? null,
      Array.isArray(permissions) ? JSON.stringify(permissions) : null,
      nowIso(),
      req.auth!.userId,
      role.id,
    ]
  );
  res.json({ ok: true });
});

// Devices management & revocation
authRouter.get('/devices', requireAuth, requirePermission(PERMISSIONS.DEVICES_MANAGE), (req, res) => {
  const devices = queryAll(
    `SELECT d.*, u.username, u.full_name
     FROM devices d JOIN users u ON u.id = d.user_id
     WHERE d.business_id = ? ORDER BY d.last_seen_at DESC`,
    [req.auth!.businessId]
  );
  res.json(devices);
});

authRouter.post('/devices/:id/revoke', requireAuth, requirePermission(PERMISSIONS.DEVICES_MANAGE), (req, res) => {
  const now = nowIso();
  execute('UPDATE devices SET is_revoked = 1, updated_at = ? WHERE id = ? AND business_id = ?', [
    now,
    req.params.id,
    req.auth!.businessId,
  ]);
  execute('UPDATE sessions SET is_revoked = 1 WHERE device_id = ? AND business_id = ?', [
    req.params.id,
    req.auth!.businessId,
  ]);
  recordAudit({
    businessId: req.auth!.businessId,
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    action: 'DEVICE_REVOKED',
    entityType: 'device',
    entityId: req.params.id as string,
    summary: `Revoked device ${req.params.id}`,
  });
  res.json({ ok: true });
});
