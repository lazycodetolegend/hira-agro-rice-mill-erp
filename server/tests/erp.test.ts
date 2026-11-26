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

  await t.test('3. Create masters (warehouse, supplier, customer, products, tax) & 10-ton (10,000 kg) truck receipt', async () => {
    // Create blank-mill masters via API
    const wh1 = (await api('/masters/warehouses', { method: 'POST', body: JSON.stringify({ code: 'WH-1', name: 'Raw Paddy Godown' }) }, adminToken)).json;
    const wh2 = (await api('/masters/warehouses', { method: 'POST', body: JSON.stringify({ code: 'WH-2', name: 'Finished Rice Godown' }) }, adminToken)).json;
    assert.ok(wh1.id && wh2.id);

    const sup = (await api('/masters/suppliers', { method: 'POST', body: JSON.stringify({ name: 'Test Paddy Trader', phone: '9800000001' }) }, adminToken)).json;
    const cust = (await api('/masters/customers', { method: 'POST', body: JSON.stringify({ name: 'Test Grain Buyer', phone: '9800000002' }) }, adminToken)).json;
    assert.ok(sup.id && cust.id);

    await api('/masters/taxes', { method: 'POST', body: JSON.stringify({ name: 'Exempt 0%', code: 'GST0', ratePercent: 0 }) }, adminToken);

    await api('/masters/products', { method: 'POST', body: JSON.stringify({ sku: 'PAD-1', name: 'Sona Paddy', materialType: 'PADDY', defaultSaleRatePerKg: 24 }) }, adminToken);
    await api('/masters/products', { method: 'POST', body: JSON.stringify({ sku: 'RICE-1', name: 'Sona Rice', materialType: 'RICE', defaultSaleRatePerKg: 52 }) }, adminToken);
    await api('/masters/products', { method: 'POST', body: JSON.stringify({ sku: 'BRK-1', name: 'Broken Rice', materialType: 'BROKEN_RICE', defaultSaleRatePerKg: 28 }) }, adminToken);
    await api('/masters/products', { method: 'POST', body: JSON.stringify({ sku: 'BRAN-1', name: 'Rice Bran', materialType: 'BRAN', defaultSaleRatePerKg: 18 }) }, adminToken);
    await api('/masters/products', { method: 'POST', body: JSON.stringify({ sku: 'HUSK-1', name: 'Rice Husk', materialType: 'HUSK', defaultSaleRatePerKg: 6 }) }, adminToken);

    catalog = (await api('/masters/catalog', {}, adminToken)).json;
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

  server.close();
});
