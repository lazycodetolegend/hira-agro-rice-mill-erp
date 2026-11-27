import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './crypto.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32ToBuffer(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpCode(secretBase32: string, stepCounter: number): string {
  const key = base32ToBuffer(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(stepCounter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 1_000_000).padStart(6, '0');
}

/**
 * Verifies a 6-digit RFC 6238 TOTP code within ±1 30s window,
 * enforcing replay protection via lastUsedStep.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  lastUsedStep = -1,
  nowMs = Date.now()
): { valid: boolean; matchedStep: number } {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return { valid: false, matchedStep: -1 };

  const currentStep = Math.floor(nowMs / 1000 / 30);
  for (let delta = -1; delta <= 1; delta++) {
    const step = currentStep + delta;
    if (step <= lastUsedStep) continue; // prevent replay of already-used TOTP code
    const expected = generateTotpCode(secretBase32, step);
    if (crypto.timingSafeEqual(Buffer.from(clean), Buffer.from(expected))) {
      return { valid: true, matchedStep: step };
    }
  }
  return { valid: false, matchedStep: -1 };
}

export function buildOtpAuthUri(accountLabel: string, issuer: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateBackupCodes(count = 8): { plainCodes: string[]; hashedCodes: string[] } {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    plainCodes.push(formatted);
    hashedCodes.push(hashPassword(formatted));
  }
  return { plainCodes, hashedCodes };
}

export function consumeBackupCode(
  candidate: string,
  hashedCodes: string[]
): { valid: boolean; remainingHashes: string[] } {
  const normalized = candidate.trim().toUpperCase();
  const idx = hashedCodes.findIndex((h) => verifyPassword(normalized, h));
  if (idx === -1) return { valid: false, remainingHashes: hashedCodes };
  const remainingHashes = [...hashedCodes];
  remainingHashes.splice(idx, 1);
  return { valid: true, remainingHashes };
}
