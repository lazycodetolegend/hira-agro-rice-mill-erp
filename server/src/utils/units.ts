import { queryOne } from '../db/connection.js';

const DEFAULT_FACTORS: Record<string, number> = {
  kg: 1,
  g: 0.001,
  quintal: 100,
  ton: 1000,
  bag: 50,
};

export function toKg(businessId: string, qty: number, unitCode: string): number {
  const code = (unitCode || 'kg').toLowerCase();
  const row = queryOne<{ kg_factor: number }>(
    'SELECT kg_factor FROM units WHERE business_id = ? AND LOWER(code) = ?',
    [businessId, code]
  );
  const factor = row?.kg_factor ?? DEFAULT_FACTORS[code];
  if (!factor || factor <= 0) {
    throw new Error(`Unsupported or invalid unit: ${unitCode}`);
  }
  return Number((qty * factor).toFixed(4));
}

export function fromKg(businessId: string, qtyKg: number, unitCode: string): number {
  const code = (unitCode || 'kg').toLowerCase();
  const row = queryOne<{ kg_factor: number }>(
    'SELECT kg_factor FROM units WHERE business_id = ? AND LOWER(code) = ?',
    [businessId, code]
  );
  const factor = row?.kg_factor ?? DEFAULT_FACTORS[code];
  if (!factor || factor <= 0) {
    throw new Error(`Unsupported or invalid unit: ${unitCode}`);
  }
  return Number((qtyKg / factor).toFixed(4));
}
