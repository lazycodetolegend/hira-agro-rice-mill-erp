import type { Request, Response, NextFunction } from 'express';
import { queryOne, execute, nowIso } from '../db/connection.js';
import { hashToken } from '../utils/crypto.js';

export interface AuthContext {
  userId: string;
  businessId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  permissions: Set<string>;
  deviceId: string;
  username: string;
  fullName: string;
  preferredLang: 'en' | 'hi' | 'mr';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const rawToken = header.slice('Bearer '.length).trim();
  const tokenHash = hashToken(rawToken);
  const now = nowIso();

  const row = queryOne<{
    session_id: string;
    business_id: string;
    user_id: string;
    device_id: string;
    expires_at: string;
    session_revoked: number;
    device_revoked: number;
    user_active: number;
    username: string;
    full_name: string;
    preferred_lang: 'en' | 'hi' | 'mr';
    role_id: string;
    role_code: string;
    role_name: string;
    permissions_json: string;
  }>(
    `SELECT
       s.id AS session_id, s.business_id, s.user_id, s.device_id, s.expires_at, s.is_revoked AS session_revoked,
       d.is_revoked AS device_revoked,
       u.is_active AS user_active, u.username, u.full_name, u.preferred_lang, u.role_id,
       r.code AS role_code, r.name AS role_name, r.permissions_json
     FROM sessions s
     JOIN devices d ON d.id = s.device_id
     JOIN users u ON u.id = s.user_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ?`,
    [tokenHash]
  );

  if (!row || row.session_revoked || row.device_revoked || !row.user_active || row.expires_at < now) {
    res.status(401).json({ error: 'Session expired or revoked. Please sign in again.' });
    return;
  }

  // Sliding session renewal: logged-in devices remain signed in until explicit logout or Admin revocation
  const renewedExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  execute('UPDATE devices SET last_seen_at = ? WHERE id = ?', [now, row.device_id]);
  execute('UPDATE sessions SET expires_at = ? WHERE id = ?', [renewedExpiry, row.session_id]);

  let perms: string[] = [];
  try {
    perms = JSON.parse(row.permissions_json || '[]');
  } catch {
    perms = [];
  }

  req.auth = {
    userId: row.user_id,
    businessId: row.business_id,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    permissions: new Set(perms),
    deviceId: row.device_id,
    username: row.username,
    fullName: row.full_name,
    preferredLang: row.preferred_lang || 'en',
  };

  next();
}

export function requirePermission(...required: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.auth.roleCode === 'OWNER_ADMIN') {
      next();
      return;
    }
    const ok = required.every((p) => req.auth!.permissions.has(p));
    if (!ok) {
      res.status(403).json({
        error: 'Permission denied',
        required,
      });
      return;
    }
    next();
  };
}

export function hasPermission(auth: AuthContext, permission: string): boolean {
  return auth.roleCode === 'OWNER_ADMIN' || auth.permissions.has(permission);
}
