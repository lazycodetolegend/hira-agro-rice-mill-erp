import { Router } from 'express';
import { z } from 'zod';
import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId, hashPassword, verifyPassword, generateSessionToken } from '../utils/crypto.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { PERMISSIONS } from '../middleware/rbac.js';
import { createRateLimiter } from '../middleware/rateLimit.js';
import { recordAudit } from '../middleware/audit.js';

export const authRouter = Router();

const loginLimiter = createRateLimiter('login', 20, 60_000);

const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  deviceKey: z.string().min(2).max(120).optional(),
  deviceName: z.string().min(1).max(120).optional(),
  platform: z.string().max(60).optional(),
});

authRouter.post('/login', loginLimiter, (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const { username, password, deviceKey, deviceName, platform } = parsed.data;

  const user = queryOne<any>(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.permissions_json
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE LOWER(u.username) = LOWER(?)`,
    [username.trim()]
  );

  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  const now = nowIso();
  const dKey = deviceKey || `web-${req.ip || 'local'}`;
  const dName = deviceName || 'Web / Mobile Browser';

  const result = withTransaction(() => {
    let device = queryOne<any>(
      'SELECT * FROM devices WHERE business_id = ? AND device_key = ?',
      [user.business_id, dKey]
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
        [deviceId, user.business_id, user.id, dKey, dName, platform || 'web', now, now, now]
      );
    } else {
      deviceId = device.id;
      execute('UPDATE devices SET user_id = ?, device_name = ?, last_seen_at = ?, updated_at = ? WHERE id = ?', [
        user.id,
        dName,
        now,
        now,
        deviceId,
      ]);
    }

    const { rawToken, tokenHash } = generateSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    execute(
      `INSERT INTO sessions (id, business_id, user_id, device_id, token_hash, expires_at, is_revoked, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [newId(), user.business_id, user.id, deviceId, tokenHash, expiresAt, now]
    );
    execute('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);

    recordAudit({
      businessId: user.business_id,
      userId: user.id,
      deviceId,
      action: 'USER_LOGIN',
      entityType: 'user',
      entityId: user.id,
      summary: `${user.username} logged in on ${dName}`,
    });

    return { rawToken, deviceId, expiresAt };
  });

  const business = queryOne<any>('SELECT * FROM businesses WHERE id = ?', [user.business_id]);

  res.json({
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
      permissions: JSON.parse(user.permissions_json || '[]'),
    },
    business,
  });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  const rawToken = req.headers.authorization!.slice('Bearer '.length).trim();
  // Revoke session matching current auth
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
  void rawToken;
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const business = queryOne('SELECT * FROM businesses WHERE id = ?', [req.auth!.businessId]);
  res.json({
    user: {
      id: req.auth!.userId,
      username: req.auth!.username,
      fullName: req.auth!.fullName,
      preferredLang: req.auth!.preferredLang,
      roleId: req.auth!.roleId,
      roleCode: req.auth!.roleCode,
      roleName: req.auth!.roleName,
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
    `SELECT u.id, u.username, u.full_name, u.phone, u.email, u.role_id, u.preferred_lang, u.is_active, u.last_login_at, u.created_at,
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
    password: z.string().min(6).max(100),
    roleId: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    preferredLang: z.enum(['en', 'hi', 'mr']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload' });
    return;
  }

  const d = parsed.data;
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
  execute(
    `INSERT INTO users (id, business_id, username, full_name, phone, email, password_hash, role_id, preferred_lang, is_active, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      id,
      req.auth!.businessId,
      d.username.trim().toLowerCase(),
      d.fullName.trim(),
      d.phone ?? null,
      d.email ?? null,
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

  const { fullName, roleId, isActive, password, phone, preferredLang } = req.body;
  const now = nowIso();
  execute(
    `UPDATE users SET
       full_name = COALESCE(?, full_name),
       role_id = COALESCE(?, role_id),
       is_active = COALESCE(?, is_active),
       phone = COALESCE(?, phone),
       preferred_lang = COALESCE(?, preferred_lang),
       password_hash = COALESCE(?, password_hash),
       updated_at = ?, updated_by = ?
     WHERE id = ?`,
    [
      fullName ?? null,
      roleId ?? null,
      isActive !== undefined ? (isActive ? 1 : 0) : null,
      phone ?? null,
      preferredLang ?? null,
      password && String(password).length >= 6 ? hashPassword(String(password)) : null,
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
    summary: `Updated user ${user.username}`,
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
