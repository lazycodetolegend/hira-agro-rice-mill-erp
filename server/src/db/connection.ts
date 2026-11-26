import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.RICE_MILL_DATA_DIR || path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = process.env.RICE_MILL_DB_PATH || path.join(DATA_DIR, 'ricemill.sqlite');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...(params as any[])) as T[];
}

export function queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = db.prepare(sql);
  return stmt.get(...(params as any[])) as T | undefined;
}

export function execute(sql: string, params: unknown[] = []) {
  const stmt = db.prepare(sql);
  return stmt.run(...(params as any[]));
}

let inTransaction = false;

export function withTransaction<T>(fn: () => T): T {
  if (inTransaction) {
    return fn();
  }
  inTransaction = true;
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ignore rollback errors if already rolled back
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
