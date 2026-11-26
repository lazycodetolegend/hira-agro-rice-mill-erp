import crypto from 'node:crypto';

const TOKEN_SECRET = process.env.RICE_MILL_TOKEN_SECRET || 'ricemill-dev-local-hmac-secret-change-in-prod';

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
