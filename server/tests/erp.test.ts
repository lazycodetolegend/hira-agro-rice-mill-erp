import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Use isolated temp SQLite DB for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ricemill-test-'));
process.env.RICE_MILL_DATA_DIR = tmpDir;
process.env.RICE_MILL_DB_PATH = path.join(tmpDir, 'test.sqlite');

const { createApp } = await import('../dist/index.js');
const { generateTotpCode } = await import('../dist/utils/totp.js');
const { setGoogleTokenVerifierForTest } = await import('../dist/routes/auth.js');
const app = createApp();
const server = app.listen(0);
const address = server.address() as { port: number };
const BASE = `http://127.0.0.1:${address.port}/api`;

async function api(url: string, opts: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${url}`, { ...opts, headers });
  const json = await res.json();
  return { status: res.status, json };
}

test('Rice Mill ERP End-to-End Acceptance Criteria', async (t) => {
  let adminToken = '';
  let operatorToken = '';
  let catalog: any;
  let suppliers: any[];
  let customers: any[];
  let lotId = '';
  let createdBags: any[] = [];

  await t.test('1. Login as Admin and Manager + RBAC verification', async () => {
    const res = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'kalpesh1976', password: 'Kalpesh@#1976', deviceKey: 'test-admin-dev', deviceName: 'Test Admin' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.token);
    adminToken = res.json.token;

    const mgrRes = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'Manager', password: 'Manager@#1289', deviceKey: 'test-mgr-dev', deviceName: 'Floor Phone' }),
    });
    assert.equal(mgrRes.status, 200);
    operatorToken = mgrRes.json.token;

    // Verify only 2 users are seeded initially
    const usersList = await api('/auth/users', {}, adminToken);
    assert.equal(usersList.status, 200);
    assert.equal(usersList.json.length, 2);

    // Manager cannot access financial reports
    const denied = await api('/accounting/reports/trial-balance', {}, operatorToken);
    assert.equal(denied.status, 403);
  });

  await t.test('2. Admin can create roles and users', async () => {
    const rolesRes = await api('/auth/roles', {}, adminToken);
    assert.equal(rolesRes.status, 200);
    const storeRole = rolesRes.json.find((r: any) => r.code === 'STORE_MANAGER');
    assert.ok(storeRole);

    const userRes = await api('/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        username: 'store2',
        fullName: 'Second Store Clerk',
        password: 'Password@1',
        roleId: storeRole.id,
      }),
    }, adminToken);
    assert.equal(userRes.status, 201);
  });

  await t.test('3. Verify default Godown 1-3, Products, Taxes & 10-ton (10,000 kg) truck receipt', async () => {
    catalog = (await api('/masters/catalog', {}, adminToken)).json;
    const whNames = catalog.warehouses.map((w: any) => w.name);
    assert.ok(whNames.includes('Godown No. 1'));
    assert.ok(whNames.includes('Godown No. 2'));
    assert.ok(whNames.includes('Godown No. 3'));
    assert.ok(catalog.products.length >= 5);
    assert.ok(catalog.taxes.length >= 2);

    const sup = (await api('/masters/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Test Paddy Trader', phone: '9800000001' }) }, adminToken)).json;
    const cust = (await api('/masters/customers', { method: 'POST', body: JSON.stringify({ name: 'Test Grain Buyer', phone: '9800000002' }) }, adminToken)).json;
    assert.ok(sup.id && cust.id);

    suppliers = (await api('/masters/suppliers', {}, adminToken)).json;
    customers = (await api('/masters/customers', {}, adminToken)).json;

    const paddy = catalog.products.find((p: any) => p.material_type === 'PADDY');
    const wh = catalog.warehouses[0];

    const lotRes = await api('/lots', {
      method: 'POST',
      body: JSON.stringify({
        truckNumber: 'MH-35-TEST-10T',
        supplierId: suppliers[0].id,
        materialType: 'PADDY',
        productId: paddy.id,
        warehouseId: wh.id,
        unit: 'ton',
        weighbridgeGross: 15.5,
        tareWeight: 5.5,
        ratePerUnit: 23,
        rateUnit: 'kg',
        freightCharges: 3000,
      }),
    }, adminToken);
    assert.equal(lotRes.status, 201);
    assert.equal(lotRes.json.received_qty_kg, 10000);
    lotId = lotRes.json.id;
  });

  await t.test('4. Create bulk bags with opaque non-sequential QR tokens & overage guard', async () => {
    const paddy = catalog.products.find((p: any) => p.material_type === 'PADDY');
    const wh = catalog.warehouses[0];

    // Exceeding 10,000 kg must fail
    const overRes = await api('/bags/bulk', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'LOT',
        lotId,
        productId: paddy.id,
        warehouseId: wh.id,
        mode: 'FIXED',
        count: 201,
        fixedNetWeightKg: 50,
      }),
    }, operatorToken);
    assert.equal(overRes.status, 400);

    // Valid 10 bags x 50 kg = 500 kg
    const bagRes = await api('/bags/bulk', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'LOT',
        lotId,
        productId: paddy.id,
        warehouseId: wh.id,
        mode: 'FIXED',
        count: 10,
        fixedNetWeightKg: 50,
      }),
    }, operatorToken);
    assert.equal(bagRes.status, 201);
    assert.equal(bagRes.json.length, 10);
    createdBags = bagRes.json;

    // QR tokens must be opaque, unique, and contain no supplier/price/ID info
    const tokens = new Set(createdBags.map((b: any) => b.qr_token));
    assert.equal(tokens.size, 10);
    for (const tok of tokens) {
      assert.ok(tok.startsWith('RM1-'));
      assert.ok(!tok.includes('23') && !tok.includes(suppliers[0].name));
    }
  });

  await t.test('5. Print job audit log + QR scan + RBAC cost hiding + Seal & duplicate-seal prevention', async () => {
    const printRes = await api('/bags/print-jobs', {
      method: 'POST',
      body: JSON.stringify({
        printerType: 'A4_HP',
        layoutConfig: { rows: 6, cols: 4, labelWidthMm: 42, labelHeightMm: 42 },
        bagIds: createdBags.map((b: any) => b.id),
      }),
    }, operatorToken);
    assert.equal(printRes.status, 201);

    // Operator scans bag -> cost_rate_per_kg must be stripped
    const scanOp = await api('/bags/lookup-qr', {
      method: 'POST',
      body: JSON.stringify({ token: createdBags[0].qr_token }),
    }, operatorToken);
    assert.equal(scanOp.status, 200);
    assert.equal(scanOp.json.validity, 'VALID');
    assert.equal(scanOp.json.bag.cost_rate_per_kg, undefined);

    // Unknown QR returns UNKNOWN
    const unknownScan = await api('/bags/lookup-qr', {
      method: 'POST',
      body: JSON.stringify({ token: 'RM1-NONEXISTENT' }),
    }, operatorToken);
    assert.equal(unknownScan.json.validity, 'UNKNOWN');

    // Seal bag
    const seal1 = await api(`/bags/${createdBags[0].id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ newStatus: 'Sealed', scanMode: 'SEAL', note: 'Filled and stitched' }),
    }, operatorToken);
    assert.equal(seal1.status, 200);
    assert.equal(seal1.json.newStatus, 'Sealed');

    // Duplicate sealing must be rejected (409)
    const sealDup = await api(`/bags/${createdBags[0].id}/transition`, {
      method: 'POST',
      body: JSON.stringify({ newStatus: 'Sealed', scanMode: 'SEAL' }),
    }, operatorToken);
    assert.equal(sealDup.status, 409);
  });

  await t.test('6. Lot completion blocked while remaining qty exists; production consumes remainder & completes', async () => {
    const badComplete = await api(`/lots/${lotId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Completed' }),
    }, adminToken);
    assert.equal(badComplete.status, 400);

    // Mill the remaining 9,500 kg in production
    const rice = catalog.products.find((p: any) => p.material_type === 'RICE');
    const broken = catalog.products.find((p: any) => p.material_type === 'BROKEN_RICE');
    const bran = catalog.products.find((p: any) => p.material_type === 'BRAN');
    const husk = catalog.products.find((p: any) => p.material_type === 'HUSK');
    const whFg = catalog.warehouses[catalog.warehouses.length - 1];

    const prodRes = await api('/production', {
      method: 'POST',
      body: JSON.stringify({
        startDate: '2026-11-26',
        warehouseId: whFg.id,
        inputs: [{ lotId, qtyKg: 9500 }],
        outputs: [
          { productId: rice.id, outputCategory: 'FINISHED_RICE', qtyKg: 6175, warehouseId: whFg.id },
          { productId: broken.id, outputCategory: 'BROKEN_RICE', qtyKg: 760, warehouseId: whFg.id },
          { productId: bran.id, outputCategory: 'BRAN', qtyKg: 665, warehouseId: whFg.id },
          { productId: husk.id, outputCategory: 'HUSK', qtyKg: 1710, warehouseId: whFg.id },
          { productId: rice.id, outputCategory: 'WASTE', qtyKg: 190, warehouseId: whFg.id },
        ],
        completeNow: true,
      }),
    }, adminToken);
    assert.equal(prodRes.status, 201, `Production failed: ${JSON.stringify(prodRes.json)}`);
    assert.equal(prodRes.json.mass_balance.unexplained_variance_kg, 0);

    const okComplete = await api(`/lots/${lotId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'Completed' }),
    }, adminToken);
    assert.equal(okComplete.status, 200);
    assert.equal(okComplete.json.status, 'Completed');
  });

  await t.test('7. Offline sync idempotency & concurrent sealing conflict detection + Admin resolution', async () => {
    const targetBag = createdBags[1];
    const idempKey1 = 'sync-seal-op-001';
    const idempKey2 = 'sync-seal-op-002';

    const push1 = await api('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            idempotencyKey: idempKey1,
            entityType: 'BAG_TRANSITION',
            action: 'BAG_SEALED',
            offlineCreatedAt: '2026-11-26T10:00:00Z',
            payload: { bagId: targetBag.id, newStatus: 'Sealed', scanMode: 'SEAL' },
          },
        ],
      }),
    }, operatorToken);
    assert.equal(push1.json.results[0].status, 'APPLIED');

    // Retrying same idempotencyKey must return DUPLICATE without error/duplication
    const pushRetry = await api('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            idempotencyKey: idempKey1,
            entityType: 'BAG_TRANSITION',
            action: 'BAG_SEALED',
            offlineCreatedAt: '2026-11-26T10:00:00Z',
            payload: { bagId: targetBag.id, newStatus: 'Sealed', scanMode: 'SEAL' },
          },
        ],
      }),
    }, operatorToken);
    assert.equal(pushRetry.json.results[0].status, 'DUPLICATE');

    // Second user offline sealing the SAME bag produces CONFLICT
    const pushConflict = await api('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            idempotencyKey: idempKey2,
            entityType: 'BAG_TRANSITION',
            action: 'BAG_SEALED',
            offlineCreatedAt: '2026-11-26T10:01:00Z',
            payload: { bagId: targetBag.id, newStatus: 'Sealed', scanMode: 'SEAL' },
          },
        ],
      }),
    }, adminToken);
    assert.equal(pushConflict.json.results[0].status, 'CONFLICT');
    const conflictId = pushConflict.json.results[0].conflictId;

    const resolveRes = await api(`/sync/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'RESOLVED_SERVER', note: 'First operator seal kept' }),
    }, adminToken);
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.json.resolution_status, 'RESOLVED_SERVER');
  });

  await t.test('8. Balanced Accounting Reports (Trial Balance, P&L, Balance Sheet) & Reversal Immutability', async () => {
    const tb = await api('/accounting/reports/trial-balance', {}, adminToken);
    assert.equal(tb.status, 200);
    assert.equal(tb.json.is_balanced, true);

    const bs = await api('/accounting/reports/balance-sheet', {}, adminToken);
    assert.equal(bs.status, 200);
    assert.equal(bs.json.is_balanced, true);

    const pnl = await api('/accounting/reports/profit-loss', {}, adminToken);
    assert.equal(pnl.status, 200);

    // COA account used in posted transactions cannot be deleted
    const coa = await api('/accounting/coa', {}, adminToken);
    const cashAcc = coa.json.find((a: any) => a.code === '1010');
    const delRes = await api(`/accounting/coa/${cashAcc.id}`, { method: 'DELETE' }, adminToken);
    assert.equal(delRes.status, 409);

    // Audit log exists with user & device info
    const audits = await api('/admin/audit-logs', {}, adminToken);
    assert.equal(audits.status, 200);
    assert.ok(audits.json.length > 5);
    assert.ok(audits.json[0].user_id && audits.json[0].device_id && audits.json[0].created_at);
  });

  await t.test('9. Purchase, Bag-Level Sale (Stock reduction + COGS + double-sale guard), Expense, Payment, Receipt & Reversal', async () => {
    const rice = catalog.products.find((p: any) => p.material_type === 'RICE');
    const whFg = catalog.warehouses[catalog.warehouses.length - 1];
    const tax0 = catalog.taxes[0];

    // Create 2 finished rice bags and seal them
    const fgBagsRes = await api('/bags/bulk', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'OPENING',
        productId: rice.id,
        warehouseId: whFg.id,
        costRatePerKg: 35,
        salePricePerKg: 55,
        mode: 'FIXED',
        count: 2,
        fixedNetWeightKg: 50,
      }),
    }, adminToken);
    assert.equal(fgBagsRes.status, 201);
    const bagA = fgBagsRes.json[0];
    const bagB = fgBagsRes.json[1];

    await api(`/bags/${bagA.id}/transition`, { method: 'POST', body: JSON.stringify({ newStatus: 'Sealed', scanMode: 'SEAL' }) }, adminToken);
    await api(`/bags/${bagB.id}/transition`, { method: 'POST', body: JSON.stringify({ newStatus: 'Sealed', scanMode: 'SEAL' }) }, adminToken);

    const stockBefore = (await api('/inventory/balances', {}, adminToken)).json;
    const riceBefore = stockBefore.items.find((i: any) => i.product_id === rice.id && i.warehouse_id === whFg.id)?.qty_kg || 0;

    // Bag-level sale of bagA (50 kg @ ₹55 = ₹2750)
    const saleRes = await api('/sales', {
      method: 'POST',
      body: JSON.stringify({
        docType: 'INVOICE',
        docDate: '2026-11-26',
        customerId: customers[0].id,
        lines: [{ productId: rice.id, warehouseId: whFg.id, bagId: bagA.id, qtyKg: 50, ratePerKg: 55, taxId: tax0.id }],
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(saleRes.status, 201);
    assert.equal(saleRes.json.total_amount, 2750);
    assert.ok(saleRes.json.journal_entry_id);
    assert.ok(saleRes.json.cogs_journal_entry_id);

    // Stock reduced by 50 kg
    const stockAfter = (await api('/inventory/balances', {}, adminToken)).json;
    const riceAfter = stockAfter.items.find((i: any) => i.product_id === rice.id && i.warehouse_id === whFg.id)?.qty_kg || 0;
    assert.equal(Number((riceBefore - riceAfter).toFixed(2)), 50);

    // Prevent selling already-sold bagA again
    const doubleSale = await api('/sales', {
      method: 'POST',
      body: JSON.stringify({
        docType: 'INVOICE',
        docDate: '2026-11-26',
        customerId: customers[0].id,
        lines: [{ productId: rice.id, warehouseId: whFg.id, bagId: bagA.id, qtyKg: 50, ratePerKg: 55, taxId: tax0.id }],
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(doubleSale.status, 400);

    // Purchase Invoice
    const purRes = await api('/purchases', {
      method: 'POST',
      body: JSON.stringify({
        docType: 'INVOICE',
        docDate: '2026-11-26',
        supplierId: suppliers[0].id,
        lines: [{ productId: rice.id, warehouseId: whFg.id, qtyKg: 200, ratePerKg: 40, taxId: tax0.id }],
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(purRes.status, 201);
    assert.equal(purRes.json.total_amount, 8000);

    // Expense, Payment, Receipt
    const coa = (await api('/accounting/coa', {}, adminToken)).json;
    const cashAcc = coa.find((a: any) => a.code === '1010');
    const expAcc = coa.find((a: any) => a.code === '5120');

    const expRes = await api('/expenses', {
      method: 'POST',
      body: JSON.stringify({
        voucherType: 'EXPENSE',
        voucherDate: '2026-11-26',
        accountId: expAcc.id,
        paymentAccountId: cashAcc.id,
        vendorName: 'Labour Union',
        paymentMethod: 'CASH',
        amount: 1200,
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(expRes.status, 201);

    const payRes = await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        voucherType: 'PAYMENT',
        voucherDate: '2026-11-26',
        partyType: 'SUPPLIER',
        partyId: suppliers[0].id,
        paymentAccountId: cashAcc.id,
        paymentMethod: 'CASH',
        amount: 8000,
        linkedDocId: purRes.json.id,
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(payRes.status, 201);

    const rcpRes = await api('/payments', {
      method: 'POST',
      body: JSON.stringify({
        voucherType: 'RECEIPT',
        voucherDate: '2026-11-26',
        partyType: 'CUSTOMER',
        partyId: customers[0].id,
        paymentAccountId: cashAcc.id,
        paymentMethod: 'CASH',
        amount: 2750,
        linkedDocId: saleRes.json.id,
        postImmediately: true,
      }),
    }, adminToken);
    assert.equal(rcpRes.status, 201);

    // Reverse sale via immutable reversal entry
    const revSale = await api(`/sales/${saleRes.json.id}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Customer cancelled order' }),
    }, adminToken);
    assert.equal(revSale.status, 200);
    assert.equal(revSale.json.status, 'Reversed');

    // Final Trial Balance & Balance Sheet remain balanced!
    const tbFinal = (await api('/accounting/reports/trial-balance', {}, adminToken)).json;
    const bsFinal = (await api('/accounting/reports/balance-sheet', {}, adminToken)).json;
    assert.equal(tbFinal.is_balanced, true);
    assert.equal(bsFinal.is_balanced, true);
  });

  await t.test('10. Bag-by-bag weighing + Customer Name/Phone + Auto-Generated GST & Supply-Only Bills', async () => {
    const paddy = catalog.products.find((p: any) => p.material_type === 'PADDY');
    const wh = catalog.warehouses.find((w: any) => w.name === 'Godown No. 2');
    const gst5 = catalog.taxes.find((tx: any) => tx.rate_percent === 5);

    const bagLotRes = await api('/lots', {
      method: 'POST',
      body: JSON.stringify({
        truckNumber: 'MH-48-BM-9999',
        customerName: 'Ramesh Farmer',
        customerPhone: '9876543210',
        materialType: 'PADDY',
        productId: paddy.id,
        warehouseId: wh.id,
        weightMode: 'BAG_BY_BAG',
        unit: 'kg',
        weighbridgeGross: 0,
        tareWeight: 0,
        weighedBags: [{ netWeightKg: 50.5 }, { netWeightKg: 49.5 }],
        ratePerUnit: 25,
        rateUnit: 'kg',
        billType: 'GST',
        taxId: gst5.id,
        autoGenerateBill: true,
      }),
    }, operatorToken);

    assert.equal(bagLotRes.status, 201);
    assert.equal(bagLotRes.json.received_qty_kg, 100);
    assert.equal(bagLotRes.json.customer_name, 'Ramesh Farmer');
    assert.equal(bagLotRes.json.customer_phone, '9876543210');
    assert.equal(bagLotRes.json.summary.bag_count, 2);
    assert.ok(bagLotRes.json.generated_bill);
    assert.equal(bagLotRes.json.generated_bill.bill_type, 'GST');
    assert.equal(bagLotRes.json.generated_bill.subtotal, 2500);
    assert.equal(bagLotRes.json.generated_bill.tax_amount, 125);
    assert.equal(bagLotRes.json.generated_bill.total_amount, 2625);

    // Supply-Only Bill must enforce 0 tax
    const supplyLotRes = await api('/lots', {
      method: 'POST',
      body: JSON.stringify({
        truckNumber: 'MH-48-BM-8888',
        customerName: 'Suresh Farmer',
        customerPhone: '9876500000',
        materialType: 'PADDY',
        productId: paddy.id,
        warehouseId: wh.id,
        weightMode: 'EXACT',
        unit: 'kg',
        weighbridgeGross: 500,
        tareWeight: 0,
        ratePerUnit: 20,
        rateUnit: 'kg',
        billType: 'SUPPLY_ONLY',
        taxId: gst5.id,
        autoGenerateBill: true,
      }),
    }, operatorToken);

    assert.equal(supplyLotRes.status, 201);
    assert.equal(supplyLotRes.json.generated_bill.bill_type, 'SUPPLY_ONLY');
    assert.equal(supplyLotRes.json.generated_bill.tax_amount, 0);
    assert.equal(supplyLotRes.json.generated_bill.total_amount, 10000);
  });

  await t.test('11. Security Hardening: CORS, Security Headers, Lockout, TOTP 2FA + Replay/Backup, Google Sign-In Whitelist & Backup Scrubbing', async () => {
    // 1) Security headers & strict CORS rejection
    const healthRes = await fetch(`${BASE}/health`);
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');

    const badCors = await fetch(`${BASE}/health`, { headers: { Origin: 'https://evil-attacker.example' } });
    assert.equal(badCors.status, 403);

    // 2) Weak password rejected (400)
    const rolesRes = await api('/auth/roles', {}, adminToken);
    const mgrRole = rolesRes.json.find((r: any) => r.code === 'STORE_MANAGER');
    const weakRes = await api('/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'weakuser', fullName: 'Weak', password: 'password', roleId: mgrRole.id }),
    }, adminToken);
    assert.equal(weakRes.status, 400);

    // 3) Create secure test user with linked Google email
    const secUserRes = await api('/auth/users', {
      method: 'POST',
      body: JSON.stringify({
        username: 'secuser',
        fullName: 'Security Test User',
        password: 'StrongPass@2026',
        googleEmail: 'kalpesh.verified@gmail.com',
        roleId: mgrRole.id,
      }),
    }, adminToken);
    assert.equal(secUserRes.status, 201);

    // 4) Account lockout after 5 wrong passwords
    for (let i = 0; i < 4; i++) {
      const fail = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'Wrong@123' }) });
      assert.equal(fail.status, 401);
    }
    const locked = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'Wrong@123' }) });
    assert.equal(locked.status, 423);

    // Admin unlocks account
    await api(`/auth/users/${secUserRes.json.id}`, { method: 'PATCH', body: JSON.stringify({ unlockAccount: true }) }, adminToken);

    // 5) Login & enable TOTP 2FA
    const secLogin = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'StrongPass@2026' }) });
    assert.equal(secLogin.status, 200);
    const secToken = secLogin.json.token;

    const setup2fa = await api('/auth/2fa/setup', { method: 'POST' }, secToken);
    assert.equal(setup2fa.status, 200);
    const stepNow = Math.floor(Date.now() / 1000 / 30);
    const code1 = generateTotpCode(setup2fa.json.secret, stepNow - 1);

    const enable2fa = await api('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code: code1 }) }, secToken);
    assert.equal(enable2fa.status, 200);
    assert.equal(enable2fa.json.backupCodes.length, 8);

    // Replay of already used TOTP step must fail; next step succeeds
    const login2fa = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'StrongPass@2026' }) });
    assert.equal(login2fa.json.requires2FA, true);
    assert.ok(!login2fa.json.token);

    const replayFail = await api('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: login2fa.json.challengeToken, code: code1 }),
    });
    assert.equal(replayFail.status, 401);

    const code2 = generateTotpCode(setup2fa.json.secret, stepNow);
    const verifyOk = await api('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: login2fa.json.challengeToken, code: code2 }),
    });
    assert.equal(verifyOk.status, 200);
    assert.ok(verifyOk.json.token);

    // Backup code works once, then rejected on reuse
    const loginBackup = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'StrongPass@2026' }) });
    const backupOk = await api('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: loginBackup.json.challengeToken, code: enable2fa.json.backupCodes[0] }),
    });
    assert.equal(backupOk.status, 200);

    const loginBackup2 = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'secuser', password: 'StrongPass@2026' }) });
    const backupReuseFail = await api('/auth/verify-2fa', {
      method: 'POST',
      body: JSON.stringify({ challengeToken: loginBackup2.json.challengeToken, code: enable2fa.json.backupCodes[0] }),
    });
    assert.equal(backupReuseFail.status, 401);

    // 6) Google Sign-In Whitelist + 2FA enforcement
    await api('/business', { method: 'PATCH', body: JSON.stringify({ google_client_id: 'test-google-client-id' }) }, adminToken);

    setGoogleTokenVerifierForTest(async (tok) => {
      if (tok === 'intruder-token') {
        return { sub: 'g-999', email: 'stranger@gmail.com', emailVerified: true, aud: 'test-google-client-id' };
      }
      return { sub: 'g-123', email: 'kalpesh.verified@gmail.com', emailVerified: true, aud: 'test-google-client-id' };
    });

    const intruderRes = await api('/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'intruder-token' }) });
    assert.equal(intruderRes.status, 403);

    const validGoogleRes = await api('/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'valid-token' }) });
    assert.equal(validGoogleRes.status, 200);
    assert.equal(validGoogleRes.json.requires2FA, true);
    setGoogleTokenVerifierForTest(null);

    // 7) Backup export must scrub password_hash and totp_secret_enc
    const backupRes = await api('/admin/backup', {}, adminToken);
    assert.equal(backupRes.status, 200);
    for (const u of backupRes.json.tables.users) {
      assert.equal(u.password_hash, undefined);
      assert.equal(u.totp_secret_enc, undefined);
      assert.equal(u.totp_backup_codes_json, undefined);
    }
  });

  await t.test('12. Full Offline Sync Engine: Pull taxes + Push Sale/Purchase/Expense/Payment + RBAC guard', async () => {
    const snap = await api('/sync/pull', {}, adminToken);
    assert.equal(snap.status, 200);
    assert.ok(Array.isArray(snap.json.taxes));

    const rice = catalog.products.find((p: any) => p.material_type === 'RICE');
    const whFg = catalog.warehouses[catalog.warehouses.length - 1];
    const tax0 = catalog.taxes[0];
    const coa = (await api('/accounting/coa', {}, adminToken)).json;
    const cashAcc = coa.find((a: any) => a.code === '1010');
    const expAcc = coa.find((a: any) => a.code === '5120');

    const opPrefix = 'off-test-' + Date.now();
    const ops = [
      {
        idempotencyKey: opPrefix + '-pur',
        entityType: 'PURCHASE_DRAFT',
        action: 'CREATE_PURCHASE_OFFLINE',
        offlineCreatedAt: '2026-11-27T10:00:00Z',
        payload: {
          docType: 'INVOICE',
          billType: 'SUPPLY_ONLY',
          docDate: '2026-11-27',
          supplierId: suppliers[0].id,
          lines: [{ productId: rice.id, warehouseId: whFg.id, qtyKg: 100, ratePerKg: 30, taxId: null }],
          postImmediately: true,
        },
      },
      {
        idempotencyKey: opPrefix + '-sal',
        entityType: 'SALE_DRAFT',
        action: 'CREATE_SALE_OFFLINE',
        offlineCreatedAt: '2026-11-27T10:05:00Z',
        payload: {
          docType: 'INVOICE',
          billType: 'SUPPLY_ONLY',
          docDate: '2026-11-27',
          customerId: customers[0].id,
          lines: [{ productId: rice.id, warehouseId: whFg.id, qtyKg: 40, ratePerKg: 50, taxId: tax0?.id || null }],
          postImmediately: true,
        },
      },
      {
        idempotencyKey: opPrefix + '-exp',
        entityType: 'EXPENSE_DRAFT',
        action: 'CREATE_EXPENSE_OFFLINE',
        offlineCreatedAt: '2026-11-27T10:10:00Z',
        payload: {
          voucherType: 'EXPENSE',
          voucherDate: '2026-11-27',
          accountId: expAcc.id,
          paymentAccountId: cashAcc.id,
          vendorName: 'Offline Mill Labour',
          paymentMethod: 'CASH',
          amount: 500,
          postImmediately: true,
        },
      },
      {
        idempotencyKey: opPrefix + '-pay',
        entityType: 'PAYMENT_DRAFT',
        action: 'CREATE_PAYMENT_OFFLINE',
        offlineCreatedAt: '2026-11-27T10:15:00Z',
        payload: {
          voucherType: 'RECEIPT',
          voucherDate: '2026-11-27',
          partyType: 'CUSTOMER',
          partyId: customers[0].id,
          paymentAccountId: cashAcc.id,
          paymentMethod: 'CASH',
          amount: 1000,
          postImmediately: true,
        },
      },
    ];

    const push1 = await api('/sync/push', { method: 'POST', body: JSON.stringify({ operations: ops }) }, adminToken);
    assert.equal(push1.status, 200);
    assert.equal(push1.json.results.filter((r: any) => r.status === 'APPLIED').length, 4);

    // Sending identical keys again must return DUPLICATE
    const push2 = await api('/sync/push', { method: 'POST', body: JSON.stringify({ operations: ops }) }, adminToken);
    assert.equal(push2.status, 200);
    assert.equal(push2.json.results.filter((r: any) => r.status === 'DUPLICATE').length, 4);

    // Operator/Auditor without sales.manage cannot smuggle SALE_DRAFT via /sync/push
    const opPush = await api('/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        operations: [
          {
            idempotencyKey: opPrefix + '-unauth',
            entityType: 'SALE_DRAFT',
            action: 'CREATE_SALE_OFFLINE',
            offlineCreatedAt: '2026-11-27T10:20:00Z',
            payload: ops[1].payload,
          },
        ],
      }),
    }, operatorToken);
    assert.equal(opPush.status, 200);
    assert.equal(opPush.json.results[0].status, 'REJECTED');
  });

  server.close();
});
