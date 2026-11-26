import { queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId, hashPassword } from '../utils/crypto.js';
import { DEFAULT_ROLE_PRESETS } from '../middleware/rbac.js';
import { initializeBusinessAccounting } from '../services/accounting.js';

export function seedInitialDemoBusiness() {
  const existing = queryOne<{ id: string }>('SELECT id FROM businesses LIMIT 1');
  if (existing) return existing.id;

  return createCleanBusinessInternal();
}

function createCleanBusinessInternal(): string {
  return withTransaction(() => {
    const businessId = newId();
    const now = nowIso();

    const defaultLabelLayout = {
      paperSize: 'A4',
      rows: 6,
      cols: 4,
      labelWidthMm: 42,
      labelHeightMm: 42,
      marginTopMm: 10,
      marginLeftMm: 12,
      gapXMm: 6,
      gapYMm: 6,
      showBusinessName: true,
      showProduct: true,
      showWeight: true,
      showLotBatch: true,
      showPackingDate: true,
      showSensitivePrice: false,
      instructionText: 'Scan using official app',
    };

    execute(
      `INSERT INTO businesses (
        id, name, currency, fiscal_year_start_month, fiscal_year_start_day, valuation_method,
        label_layout_json, tax_disclaimer_acknowledged, is_demo, created_at, updated_at
      ) VALUES (?, 'Hira Agro Industry', 'INR', 4, 1, 'WEIGHTED_AVG', ?, 0, 0, ?, ?)`,
      [businessId, JSON.stringify(defaultLabelLayout), now, now]
    );

    // 1. Roles
    const roleIds = new Map<string, string>();
    for (const preset of DEFAULT_ROLE_PRESETS) {
      const rId = newId();
      execute(
        `INSERT INTO roles (id, business_id, name, code, description, is_system, permissions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [rId, businessId, preset.name, preset.code, preset.description, JSON.stringify(preset.permissions), now, now]
      );
      roleIds.set(preset.code, rId);
    }

    // 2. Only the two configured users: Admin & Manager
    const adminId = newId();
    const managerId = newId();

    const users = [
      {
        id: adminId,
        username: 'kalpesh1976',
        fullName: 'Kalpesh (Admin)',
        passwordHash: hashPassword('Kalpesh@#1976'),
        role: 'OWNER_ADMIN',
        lang: 'en',
      },
      {
        id: managerId,
        username: 'Manager',
        fullName: 'Mill Manager',
        passwordHash: hashPassword('Manager@#1289'),
        role: 'STORE_MANAGER',
        lang: 'en',
      },
    ];

    for (const u of users) {
      execute(
        `INSERT INTO users (id, business_id, username, full_name, password_hash, role_id, preferred_lang, is_active, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [u.id, businessId, u.username, u.fullName, u.passwordHash, roleIds.get(u.role)!, u.lang, now, now, adminId]
      );
    }

    // 3. Standard weight units (internal base: kg)
    const units = [
      { code: 'kg', name: 'Kilogram (kg)', factor: 1, isBase: 1 },
      { code: 'g', name: 'Gram (g)', factor: 0.001, isBase: 0 },
      { code: 'quintal', name: 'Quintal (100 kg)', factor: 100, isBase: 0 },
      { code: 'ton', name: 'Metric Ton (1000 kg)', factor: 1000, isBase: 0 },
      { code: 'bag', name: 'Standard Bag (50 kg)', factor: 50, isBase: 0 },
    ];
    for (const unit of units) {
      execute(
        `INSERT INTO units (id, business_id, code, name, kg_factor, is_base, is_configurable, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [newId(), businessId, unit.code, unit.name, unit.factor, unit.isBase, now, now]
      );
    }

    // 4. Default Chart of Accounts, Account Mappings & Active Fiscal Period (zero balances)
    initializeBusinessAccounting(businessId, 4, 1);

    return businessId;
  });
}

export function clearDemoTransactions(businessId: string) {
  return withTransaction(() => {
    execute(
      `DELETE FROM journal_lines WHERE business_id = ? AND journal_entry_id IN (SELECT id FROM journal_entries WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute('DELETE FROM journal_entries WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('DELETE FROM payments_receipts WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('DELETE FROM expenses WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute(
      `DELETE FROM sales_lines WHERE business_id = ? AND sales_id IN (SELECT id FROM sales_documents WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute('DELETE FROM sales_documents WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute(
      `DELETE FROM purchase_lines WHERE business_id = ? AND purchase_id IN (SELECT id FROM purchase_documents WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute('DELETE FROM purchase_documents WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('DELETE FROM inventory_movements WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute(
      `DELETE FROM bag_events WHERE business_id = ? AND bag_id IN (SELECT id FROM bags WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute('DELETE FROM bags WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute(
      `DELETE FROM production_inputs WHERE business_id = ? AND batch_id IN (SELECT id FROM production_batches WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute(
      `DELETE FROM production_outputs WHERE business_id = ? AND batch_id IN (SELECT id FROM production_batches WHERE business_id = ? AND is_demo = 1)`,
      [businessId, businessId]
    );
    execute('DELETE FROM production_batches WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('DELETE FROM inbound_lots WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('DELETE FROM trucks WHERE business_id = ? AND is_demo = 1', [businessId]);
    execute('UPDATE businesses SET is_demo = 0, updated_at = ? WHERE id = ?', [nowIso(), businessId]);
  });
}
