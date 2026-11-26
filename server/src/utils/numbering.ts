import { queryOne } from '../db/connection.js';

export function nextSequenceNumber(
  businessId: string,
  table: string,
  column: string,
  prefix: string,
  padLength = 5
): string {
  const row = queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM ${table} WHERE business_id = ?`,
    [businessId]
  );
  let seq = (row?.cnt ?? 0) + 1;
  const yearTag = new Date().getFullYear().toString().slice(-2);
  while (true) {
    const candidate = `${prefix}-${yearTag}-${String(seq).padStart(padLength, '0')}`;
    const exists = queryOne(
      `SELECT 1 FROM ${table} WHERE business_id = ? AND ${column} = ?`,
      [businessId, candidate]
    );
    if (!exists) return candidate;
    seq += 1;
  }
}
