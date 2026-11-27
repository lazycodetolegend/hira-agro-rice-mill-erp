import crypto from 'node:crypto';

const TOKEN_SECRET = process.env.RICE_MILL_TOKEN_SECRET || 'ricemill-dev-local-hmac-secret-change-in-prod';

if (process.env.NODE_ENV === 'production' && !process.env.RICE_MILL_TOKEN_SECRET) {
  console.warn('[SECURITY WARNING] RICE_MILL_TOKEN_SECRET is not set in environment; set a strong secret in production.');
}

function getFieldEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(`field-enc:${TOKEN_SECRET}`).digest();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, original] = stored.split(':');
  if (!salt || !original) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const origBuf = Buffer.from(original, 'hex');
  if (derived.length !== origBuf.length) return false;
  return crypto.timingSafeEqual(derived, origBuf);
}

export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, and at least one number.';
  }
  return null;
}

export function encryptSensitiveText(plain: string): string {
  const iv = crypto.randomBytes(12);
  const key = getFieldEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSensitiveText(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted payload');
  const key = getFieldEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return plain.toString('utf8');
}

/**
 * Generates an opaque, cryptographically random, non-sequential QR token.
 * Contains ZERO business IDs, database IDs, cost, supplier, or personal data.
 * Format: RM1-<22 char base64url> (128+ bits of entropy)
 */
export function generateOpaqueQrToken(): string {
  const bytes = crypto.randomBytes(16);
  const encoded = bytes.toString('base64url');
  return `RM1-${encoded}`;
}

export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashToken(rawToken: string): string {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(rawToken).digest('hex');
}
