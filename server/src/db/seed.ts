import { queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId, hashPassword } from '../utils/crypto.js';
import { DEFAULT_ROLE_PRESETS } from '../middleware/rbac.js';
import { initializeBusinessAccounting } from '../services/accounting.js';

export function ensureDefaultCatalog(businessId: string) {
  const now = nowIso();

  // 1. Warehouses: Godown No. 1, Godown No. 2, Godown No. 3
  const whCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM warehouses WHERE business_id = ?', [businessId]);
  if ((whCount?.c || 0) === 0) {
    const godowns = [
      { code: 'GDN-1', name: 'Godown No. 1', address: 'Main Mill Yard' },
      { code: 'GDN-2', name: 'Godown No. 2', address: 'Storage Bay 2' },
      { code: 'GDN-3', name: 'Godown No. 3', address: 'Dispatch Bay 3' },
    ];
    for (const g of godowns) {
      const whId = newId();
      execute(
        `INSERT INTO warehouses (id, business_id, code, name, address, is_active, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
        [whId, businessId, g.code, g.name, g.address, now, now]
      );
      execute(
        `INSERT INTO warehouse_locations (id, business_id, warehouse_id, code, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 'BAY-1', ?, 1, ?, ?)`,
        [newId(), businessId, whId, `${g.name} Main Stack`, now, now]
      );
    }
  }

  // 2. Varieties & Grades
  const varCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM product_varieties WHERE business_id = ?', [businessId]);
  let defaultVarId: string | null = null;
  if ((varCount?.c || 0) === 0) {
    const vars = ['Sona Masoori', 'HMT Kolam', 'Basmati', 'Swarna', 'IR-64'];
    for (const v of vars) {
      const vId = newId();
      if (!defaultVarId) defaultVarId = vId;
      execute(
        `INSERT INTO product_varieties (id, business_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [vId, businessId, v, now, now]
      );
    }
  } else {
    defaultVarId = queryOne<{ id: string }>('SELECT id FROM product_varieties WHERE business_id = ? LIMIT 1', [businessId])?.id ?? null;
  }

  const gradeCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM product_grades WHERE business_id = ?', [businessId]);
  let defaultGradeId: string | null = null;
  if ((gradeCount?.c || 0) === 0) {
    for (const g of ['Standard', 'Grade A (Sortex)', 'Steam']) {
      const gId = newId();
      if (!defaultGradeId) defaultGradeId = gId;
      execute(
        `INSERT INTO product_grades (id, business_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
        [gId, businessId, g, now, now]
      );
    }
  } else {
    defaultGradeId = queryOne<{ id: string }>('SELECT id FROM product_grades WHERE business_id = ? LIMIT 1', [businessId])?.id ?? null;
  }

  // 3. Packaging Types
  const pkgCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM packaging_types WHERE business_id = ?', [businessId]);
  let defaultPkgId: string | null = null;
  if ((pkgCount?.c || 0) === 0) {
    const pkg50 = newId();
    defaultPkgId = pkg50;
    execute(
      `INSERT INTO packaging_types (id, business_id, name, standard_net_kg, tare_kg, is_active, created_at, updated_at)
       VALUES (?, ?, '50 kg Bag', 50, 0.2, 1, ?, ?)`,
      [pkg50, businessId, now, now]
    );
    execute(
      `INSERT INTO packaging_types (id, business_id, name, standard_net_kg, tare_kg, is_active, created_at, updated_at)
       VALUES (?, ?, '25 kg Bag', 25, 0.15, 1, ?, ?)`,
      [newId(), businessId, now, now]
    );
  } else {
    defaultPkgId = queryOne<{ id: string }>('SELECT id FROM packaging_types WHERE business_id = ? LIMIT 1', [businessId])?.id ?? null;
  }

  // 4. Configurable Tax Settings (Supply Only 0% + GST options)
  const taxCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM tax_settings WHERE business_id = ?', [businessId]);
  let supplyTaxId: string | null = null;
  if ((taxCount?.c || 0) === 0) {
    supplyTaxId = newId();
    const taxes = [
      { id: supplyTaxId, name: 'Supply Only / Exempt (0%)', code: 'SUPPLY0', rate: 0, cgst: 0, sgst: 0, igst: 0 },
      { id: newId(), name: 'GST 5% (2.5% + 2.5%)', code: 'GST5', rate: 5, cgst: 2.5, sgst: 2.5, igst: 5 },
      { id: newId(), name: 'GST 12% (6% + 6%)', code: 'GST12', rate: 12, cgst: 6, sgst: 6, igst: 12 },
      { id: newId(), name: 'GST 18% (9% + 9%)', code: 'GST18', rate: 18, cgst: 9, sgst: 9, igst: 18 },
    ];
    for (const tx of taxes) {
      execute(
        `INSERT INTO tax_settings (id, business_id, name, code, rate_percent, cgst_percent, sgst_percent, igst_percent, is_active, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'Verify applicable GST rates with your accountant.', ?, ?)`,
        [tx.id, businessId, tx.name, tx.code, tx.rate, tx.cgst, tx.sgst, tx.igst, now, now]
      );
    }
  } else {
    supplyTaxId = queryOne<{ id: string }>('SELECT id FROM tax_settings WHERE business_id = ? ORDER BY rate_percent ASC LIMIT 1', [businessId])?.id ?? null;
  }

  // 5. Default Products across all Material Types so dropdowns are always ready
  const prodCount = queryOne<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE business_id = ?', [businessId]);
  if ((prodCount?.c || 0) === 0) {
    const products = [
      { sku: 'PAD-001', name: 'Paddy (Dhan)', type: 'PADDY', hsn: '1006', rate: 24 },
      { sku: 'RICE-001', name: 'Steam Rice', type: 'RICE', hsn: '1006', rate: 52 },
      { sku: 'BRK-001', name: 'Broken Rice (Kanki)', type: 'BROKEN_RICE', hsn: '1006', rate: 28 },
      { sku: 'BRAN-001', name: 'Rice Bran (Konda)', type: 'BRAN', hsn: '2302', rate: 18 },
      { sku: 'HUSK-001', name: 'Rice Husk (Bhusa)', type: 'HUSK', hsn: '1213', rate: 6 },
      { sku: 'OTH-001', name: 'Other Grain / Material', type: 'OTHER', hsn: '1006', rate: 20 },
    ];
    for (const p of products) {
      execute(
        `INSERT INTO products (
          id, business_id, sku, name, material_type, variety_id, grade_id, default_packaging_id,
          default_unit, low_stock_threshold_kg, default_sale_rate_per_kg, default_tax_id, hsn_code,
          is_active, is_demo, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'kg', 500, ?, ?, ?, 1, 0, ?, ?)`,
        [newId(), businessId, p.sku, p.name, p.type, defaultVarId, defaultGradeId, defaultPkgId, p.rate, supplyTaxId, p.hsn, now, now]
      );
    }
  }
}

export function seedInitialDemoBusiness() {
  const existing = queryOne<{ id: string }>('SELECT id FROM businesses LIMIT 1');
  if (existing) {
    ensureDefaultCatalog(existing.id);
    return existing.id;
  }

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

    // 5. Default Godowns (1, 2, 3), Products, Varieties, Grades & Configurable Tax Slabs
    ensureDefaultCatalog(businessId);

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
