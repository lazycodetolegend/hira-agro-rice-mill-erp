import { execute, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';

export interface AuditInput {
  businessId: string;
  userId: string;
  deviceId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
}

export function recordAudit(input: AuditInput) {
  execute(
    `INSERT INTO audit_logs (
      id, business_id, user_id, device_id, action, entity_type, entity_id,
      summary, before_json, after_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      input.businessId,
      input.userId,
      input.deviceId,
      input.action,
      input.entityType,
      input.entityId,
      input.summary ?? null,
      input.before !== undefined ? JSON.stringify(input.before) : null,
      input.after !== undefined ? JSON.stringify(input.after) : null,
      nowIso(),
    ]
  );
}
