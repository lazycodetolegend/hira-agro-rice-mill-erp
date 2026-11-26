import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { recordInventoryMovement, getValuationCostForOutflow } from './inventory.js';
import { getMappedAccountId, postJournalEntry, reverseJournalEntry } from './accounting.js';
import { transitionBagStatus } from './bags.js';
import { recordAudit } from '../middleware/audit.js';

export interface PurchaseInput {
  businessId: string;
  docType: 'INVOICE' | 'RETURN';
  docDate: string;
  dueDate?: string;
  supplierId: string;
  truckId?: string | null;
  lotId?: string | null;
  originalPurchaseId?: string | null;
  freightAmount?: number;
  discountAmount?: number;
  lines: Array<{
    productId: string;
    warehouseId: string;
    qtyKg: number;
    displayUnit?: string;
    ratePerKg: number;
    discountAmount?: number;
    taxId?: string | null;
    description?: string;
  }>;
  postImmediately?: boolean;
  notes?: string;
  userId: string;
  deviceId: string;
  isDemo?: number;
}

export function createPurchaseDocument(input: PurchaseInput) {
  return withTransaction(() => {
    if (!input.lines.length) throw new Error('Purchase must contain at least one line.');
    const supplier = queryOne('SELECT id, name FROM suppliers WHERE id = ? AND business_id = ?', [
      input.supplierId,
      input.businessId,
    ]);
    if (!supplier) throw new Error('Supplier not found.');

    const biz = queryOne<{ purchase_prefix: string }>(
      'SELECT purchase_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const prefix = input.docType === 'RETURN' ? 'PRN' : biz?.purchase_prefix || 'PUR';
    const docNumber = nextSequenceNumber(input.businessId, 'purchase_documents', 'doc_number', prefix);
    const docId = newId();
    const now = nowIso();

    let subtotal = 0;
    let totalTax = 0;
    let totalLineDiscounts = 0;
    const processedLines: Array<any> = [];

    for (const line of input.lines) {
      if (line.qtyKg <= 0 || line.ratePerKg < 0) {
        throw new Error('Line quantity must be positive and rate non-negative.');
      }
      const prod = queryOne<{ id: string; material_type: string; name: string }>(
        'SELECT id, material_type, name FROM products WHERE id = ? AND business_id = ?',
        [line.productId, input.businessId]
      );
      if (!prod) throw new Error(`Product not found: ${line.productId}`);

      let taxRate = 0;
      if (line.taxId) {
        const tax = queryOne<{ rate_percent: number }>(
          'SELECT rate_percent FROM tax_settings WHERE id = ? AND business_id = ?',
          [line.taxId, input.businessId]
        );
        taxRate = tax?.rate_percent || 0;
      }

      const gross = Number((line.qtyKg * line.ratePerKg).toFixed(2));
      const disc = Number((line.discountAmount || 0).toFixed(2));
      const taxable = Math.max(0, gross - disc);
      const taxAmt = Number(((taxable * taxRate) / 100).toFixed(2));
      const lineTotal = Number((taxable + taxAmt).toFixed(2));

      subtotal += gross;
      totalLineDiscounts += disc;
      totalTax += taxAmt;
      processedLines.push({
        ...line,
        materialType: prod.material_type,
        productName: prod.name,
        taxRate,
        taxAmt,
        lineTotal,
        netTaxable: taxable,
      });
    }

    const freightAmount = Number((input.freightAmount || 0).toFixed(2));
    const docDiscount = Number(((input.discountAmount || 0) + totalLineDiscounts).toFixed(2));
    const totalAmount = Number((subtotal - docDiscount + freightAmount + totalTax).toFixed(2));
    const status = input.postImmediately ? 'Posted' : 'Draft';

    execute(
      `INSERT INTO purchase_documents (
        id, business_id, doc_type, doc_number, doc_date, due_date, supplier_id,
        truck_id, lot_id, original_purchase_id, subtotal, freight_amount, discount_amount,
        tax_amount, total_amount, paid_amount, status, notes, is_demo,
        created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        input.businessId,
        input.docType,
        docNumber,
        input.docDate,
        input.dueDate ?? input.docDate,
        input.supplierId,
        input.truckId ?? null,
        input.lotId ?? null,
        input.originalPurchaseId ?? null,
        subtotal,
        freightAmount,
        docDiscount,
        totalTax,
        totalAmount,
        status,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    for (const pl of processedLines) {
      execute(
        `INSERT INTO purchase_lines (
          id, business_id, purchase_id, product_id, warehouse_id, qty_kg, display_unit,
          rate_per_kg, discount_amount, tax_id, tax_rate_percent, tax_amount, line_total, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          input.businessId,
          docId,
          pl.productId,
          pl.warehouseId,
          pl.qtyKg,
          pl.displayUnit || 'kg',
          pl.ratePerKg,
          pl.discountAmount || 0,
          pl.taxId ?? null,
          pl.taxRate,
          pl.taxAmt,
          pl.lineTotal,
          pl.description ?? pl.productName,
        ]
      );
    }

    if (input.postImmediately) {
      postPurchaseDocument(input.businessId, docId, input.userId, input.deviceId);
    }

    return getPurchaseDocument(input.businessId, docId);
  });
}

export function postPurchaseDocument(businessId: string, docId: string, userId: string, deviceId: string) {
  return withTransaction(() => {
    const doc = queryOne<any>('SELECT * FROM purchase_documents WHERE id = ? AND business_id = ?', [
      docId,
      businessId,
    ]);
    if (!doc) throw new Error('Purchase document not found.');
    if (doc.journal_entry_id) return doc; // already posted

    const lines = queryAll<any>(
      `SELECT pl.*, p.material_type FROM purchase_lines pl
       JOIN products p ON p.id = pl.product_id
       WHERE pl.purchase_id = ? AND pl.business_id = ?`,
      [docId, businessId]
    );

    const rawInvAcc = getMappedAccountId(businessId, 'RAW_MATERIAL_INVENTORY');
    const fgInvAcc = getMappedAccountId(businessId, 'FINISHED_GOODS_INVENTORY');
    const apAcc = getMappedAccountId(businessId, 'ACCOUNTS_PAYABLE');
    const inputTaxAcc = getMappedAccountId(businessId, 'INPUT_TAX');
    const freightAcc = getMappedAccountId(businessId, 'FREIGHT_INWARD');

    const totalQty = lines.reduce((a, l) => a + l.qty_kg, 0) || 1;
    const isReturn = doc.doc_type === 'RETURN';

    // Record stock movements only if not already linked to an inbound lot (lot already recorded GOODS_RECEIVED)
    if (!doc.lot_id) {
      for (const l of lines) {
        const landedUnitCost = l.rate_per_kg + (doc.freight_amount || 0) / totalQty;
        recordInventoryMovement({
          businessId,
          movementType: isReturn ? 'PURCHASE_RETURN' : 'GOODS_RECEIVED',
          productId: l.product_id,
          warehouseId: l.warehouse_id,
          qtyKg: isReturn ? -l.qty_kg : l.qty_kg,
          unitCost: landedUnitCost,
          sourceDocType: isReturn ? 'PURCHASE_RETURN' : 'PURCHASE_INVOICE',
          sourceDocId: doc.id,
          sourceDocNumber: doc.doc_number,
          note: `${doc.doc_type} ${doc.doc_number}`,
          occurredAt: doc.doc_date,
          userId,
          isDemo: doc.is_demo,
        });
      }
    }

    const journalLines: Array<any> = [];
    const goodsNet = Number((doc.subtotal - doc.discount_amount).toFixed(2));
    const hasFinished = lines.some((l) => l.material_type !== 'PADDY' && l.material_type !== 'PACKAGING');
    const invAccount = hasFinished ? fgInvAcc : rawInvAcc;

    if (!isReturn) {
      journalLines.push({
        accountId: invAccount,
        debit: Number((goodsNet + (doc.freight_amount || 0)).toFixed(2)),
        credit: 0,
        narration: `Purchase inventory ${doc.doc_number}`,
      });
      if (doc.tax_amount > 0) {
        journalLines.push({
          accountId: inputTaxAcc,
          debit: doc.tax_amount,
          credit: 0,
          narration: `Input tax on ${doc.doc_number}`,
        });
      }
      journalLines.push({
        accountId: apAcc,
        debit: 0,
        credit: doc.total_amount,
        partyType: 'SUPPLIER',
        partyId: doc.supplier_id,
        narration: `Supplier payable ${doc.doc_number}`,
      });
    } else {
      journalLines.push({
        accountId: apAcc,
        debit: doc.total_amount,
        credit: 0,
        partyType: 'SUPPLIER',
        partyId: doc.supplier_id,
        narration: `Purchase return debit note ${doc.doc_number}`,
      });
      journalLines.push({
        accountId: invAccount,
        debit: 0,
        credit: Number((goodsNet + (doc.freight_amount || 0)).toFixed(2)),
        narration: `Inventory returned ${doc.doc_number}`,
      });
      if (doc.tax_amount > 0) {
        journalLines.push({
          accountId: inputTaxAcc,
          debit: 0,
          credit: doc.tax_amount,
          narration: `Input tax reversal ${doc.doc_number}`,
        });
      }
    }

    // Keep unused freightAcc lint clean if needed for future split
    void freightAcc;

    const je = postJournalEntry({
      businessId,
      entryDate: doc.doc_date,
      entryType: isReturn ? 'PURCHASE_RETURN' : 'PURCHASE',
      sourceDocType: 'PURCHASE_DOCUMENT',
      sourceDocId: doc.id,
      sourceDocNumber: doc.doc_number,
      narration: `${isReturn ? 'Purchase Return' : 'Purchase Invoice'} ${doc.doc_number}`,
      lines: journalLines,
      userId,
      deviceId,
      isDemo: doc.is_demo,
    });

    execute(
      'UPDATE purchase_documents SET status = \'Posted\', journal_entry_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [je.id, nowIso(), userId, doc.id]
    );

    return getPurchaseDocument(businessId, doc.id);
  });
}

export function reversePurchaseDocument(
  businessId: string,
  docId: string,
  reason: string,
  userId: string,
  deviceId: string
) {
  return withTransaction(() => {
    const doc = queryOne<any>('SELECT * FROM purchase_documents WHERE id = ? AND business_id = ?', [
      docId,
      businessId,
    ]);
    if (!doc) throw new Error('Purchase document not found.');
    if (doc.status !== 'Posted') throw new Error('Only posted documents can be reversed.');
    if (!reason || reason.trim().length < 3) throw new Error('Reversal reason is required.');

    let revEntryId: string | null = null;
    if (doc.journal_entry_id) {
      const rev = reverseJournalEntry(businessId, doc.journal_entry_id, reason, userId, deviceId);
      revEntryId = rev.id;
    }

    execute(
      'UPDATE purchase_documents SET status = \'Reversed\', reversed_by_entry_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      [revEntryId, nowIso(), userId, doc.id]
    );

    recordAudit({
      businessId,
      userId,
      deviceId,
      action: 'PURCHASE_REVERSED',
      entityType: 'purchase_document',
      entityId: doc.id,
      summary: `Reversed ${doc.doc_number}: ${reason}`,
    });

    return getPurchaseDocument(businessId, doc.id);
  });
}

export function getPurchaseDocument(businessId: string, docId: string) {
  const doc = queryOne<any>(
    `SELECT pd.*, s.name AS supplier_name, s.phone AS supplier_phone, l.lot_number
     FROM purchase_documents pd
     JOIN suppliers s ON s.id = pd.supplier_id
     LEFT JOIN inbound_lots l ON l.id = pd.lot_id
     WHERE pd.id = ? AND pd.business_id = ?`,
    [docId, businessId]
  );
  if (!doc) return null;
  const lines = queryAll<any>(
    `SELECT pl.*, p.name AS product_name, p.sku, w.name AS warehouse_name
     FROM purchase_lines pl
     JOIN products p ON p.id = pl.product_id
     JOIN warehouses w ON w.id = pl.warehouse_id
     WHERE pl.purchase_id = ? AND pl.business_id = ?`,
    [docId, businessId]
  );
  return { ...doc, lines };
}

export interface SalesInput {
  businessId: string;
  docType: 'QUOTATION' | 'ORDER' | 'INVOICE' | 'RETURN';
  docDate: string;
  dueDate?: string;
  customerId: string;
  originalSalesId?: string | null;
  paymentTerms?: string;
  discountAmount?: number;
  lines: Array<{
    productId: string;
    warehouseId: string;
    bagId?: string | null;
    qtyKg: number;
    displayUnit?: string;
    ratePerKg: number;
    discountAmount?: number;
    taxId?: string | null;
    description?: string;
  }>;
  postImmediately?: boolean;
  notes?: string;
  userId: string;
  deviceId: string;
  isDemo?: number;
}

export function createSalesDocument(input: SalesInput) {
  return withTransaction(() => {
    if (!input.lines.length) throw new Error('Sales document must contain at least one line.');
    const cust = queryOne('SELECT id, name FROM customers WHERE id = ? AND business_id = ?', [
      input.customerId,
      input.businessId,
    ]);
    if (!cust) throw new Error('Customer not found.');

    const biz = queryOne<{ sales_prefix: string }>(
      'SELECT sales_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const prefixMap = {
      QUOTATION: 'QTN',
      ORDER: 'ORD',
      INVOICE: biz?.sales_prefix || 'SAL',
      RETURN: 'SRN',
    };
    const docNumber = nextSequenceNumber(
      input.businessId,
      'sales_documents',
      'doc_number',
      prefixMap[input.docType]
    );
    const docId = newId();
    const now = nowIso();

    let subtotal = 0;
    let totalTax = 0;
    let totalLineDisc = 0;
    const processedLines: Array<any> = [];

    for (const line of input.lines) {
      let qtyKg = line.qtyKg;
      let warehouseId = line.warehouseId;
      let productId = line.productId;

      if (line.bagId) {
        const bag = queryOne<any>('SELECT * FROM bags WHERE id = ? AND business_id = ?', [
          line.bagId,
          input.businessId,
        ]);
        if (!bag) throw new Error(`Bag not found: ${line.bagId}`);
        if (input.docType !== 'RETURN') {
          if (['Cancelled', 'Damaged', 'Sold', 'Delivered', 'Rejected'].includes(bag.current_status)) {
            throw new Error(
              `Bag ${bag.bag_number} cannot be sold because its status is ${bag.current_status}.`
            );
          }
        }
        qtyKg = bag.net_weight_kg;
        warehouseId = bag.warehouse_id;
        productId = bag.product_id;
      }

      if (qtyKg <= 0 || line.ratePerKg < 0) {
        throw new Error('Line quantity must be positive and rate non-negative.');
      }

      const prod = queryOne<{ id: string; material_type: string; name: string }>(
        'SELECT id, material_type, name FROM products WHERE id = ? AND business_id = ?',
        [productId, input.businessId]
      );
      if (!prod) throw new Error(`Product not found: ${productId}`);

      let taxRate = 0;
      if (line.taxId) {
        const tax = queryOne<{ rate_percent: number }>(
          'SELECT rate_percent FROM tax_settings WHERE id = ? AND business_id = ?',
          [line.taxId, input.businessId]
        );
        taxRate = tax?.rate_percent || 0;
      }

      const gross = Number((qtyKg * line.ratePerKg).toFixed(2));
      const disc = Number((line.discountAmount || 0).toFixed(2));
      const taxable = Math.max(0, gross - disc);
      const taxAmt = Number(((taxable * taxRate) / 100).toFixed(2));
      const lineTotal = Number((taxable + taxAmt).toFixed(2));

      subtotal += gross;
      totalLineDisc += disc;
      totalTax += taxAmt;
      processedLines.push({
        ...line,
        productId,
        warehouseId,
        qtyKg,
        materialType: prod.material_type,
        productName: prod.name,
        taxRate,
        taxAmt,
        lineTotal,
        netTaxable: taxable,
      });
    }

    const docDiscount = Number(((input.discountAmount || 0) + totalLineDisc).toFixed(2));
    const totalAmount = Number((subtotal - docDiscount + totalTax).toFixed(2));
    const status = input.postImmediately && (input.docType === 'INVOICE' || input.docType === 'RETURN') ? 'Posted' : 'Draft';

    execute(
      `INSERT INTO sales_documents (
        id, business_id, doc_type, doc_number, doc_date, due_date, customer_id,
        original_sales_id, payment_terms, subtotal, discount_amount, tax_amount,
        total_amount, received_amount, total_cogs, delivery_status, status,
        notes, is_demo, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docId,
        input.businessId,
        input.docType,
        docNumber,
        input.docDate,
        input.dueDate ?? input.docDate,
        input.customerId,
        input.originalSalesId ?? null,
        input.paymentTerms ?? null,
        subtotal,
        docDiscount,
        totalTax,
        totalAmount,
        input.docType === 'RETURN' ? 'Returned' : 'Pending',
        status,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    for (const sl of processedLines) {
      execute(
        `INSERT INTO sales_lines (
          id, business_id, sales_id, product_id, warehouse_id, bag_id, qty_kg, display_unit,
          rate_per_kg, discount_amount, tax_id, tax_rate_percent, tax_amount, line_total, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          input.businessId,
          docId,
          sl.productId,
          sl.warehouseId,
          sl.bagId ?? null,
          sl.qtyKg,
          sl.displayUnit || 'kg',
          sl.ratePerKg,
          sl.discountAmount || 0,
          sl.taxId ?? null,
          sl.taxRate,
          sl.taxAmt,
          sl.lineTotal,
          sl.description ?? sl.productName,
        ]
      );
    }

    if (input.postImmediately && (input.docType === 'INVOICE' || input.docType === 'RETURN')) {
      postSalesDocument(input.businessId, docId, input.userId, input.deviceId);
    }

    return getSalesDocument(input.businessId, docId);
  });
}

export function postSalesDocument(businessId: string, docId: string, userId: string, deviceId: string) {
  return withTransaction(() => {
    const doc = queryOne<any>('SELECT * FROM sales_documents WHERE id = ? AND business_id = ?', [
      docId,
      businessId,
    ]);
    if (!doc) throw new Error('Sales document not found.');
    if (doc.journal_entry_id) return getSalesDocument(businessId, doc.id);
    if (doc.doc_type !== 'INVOICE' && doc.doc_type !== 'RETURN') {
      throw new Error('Only Invoices and Sales Returns can be posted to accounting.');
    }

    const lines = queryAll<any>(
      `SELECT sl.*, p.material_type FROM sales_lines sl
       JOIN products p ON p.id = sl.product_id
       WHERE sl.sales_id = ? AND sl.business_id = ?`,
      [docId, businessId]
    );

    const isReturn = doc.doc_type === 'RETURN';
    const arAcc = getMappedAccountId(businessId, 'ACCOUNTS_RECEIVABLE');
    const taxPayableAcc = getMappedAccountId(businessId, 'TAX_PAYABLE');
    const cogsAcc = getMappedAccountId(businessId, 'COGS');
    const fgInvAcc = getMappedAccountId(businessId, 'FINISHED_GOODS_INVENTORY');

    const salesAccForType = (mat: string) => {
      if (mat === 'BROKEN_RICE') return getMappedAccountId(businessId, 'BROKEN_RICE_SALES');
      if (mat === 'BRAN') return getMappedAccountId(businessId, 'BRAN_SALES');
      if (mat === 'HUSK') return getMappedAccountId(businessId, 'HUSK_SALES');
      return getMappedAccountId(businessId, 'RICE_SALES');
    };

    let totalCogs = 0;
    const revenueByAccount = new Map<string, number>();

    for (const l of lines) {
      const val = getValuationCostForOutflow(businessId, l.product_id, l.warehouse_id, l.qty_kg);
      let unitCost = val.unitCost;
      let lineCogs = val.totalCost;

      if (l.bag_id) {
        const bag = queryOne<any>('SELECT * FROM bags WHERE id = ? AND business_id = ?', [
          l.bag_id,
          businessId,
        ]);
        if (!bag) throw new Error(`Bag not found: ${l.bag_id}`);
        if (!isReturn) {
          if (['Cancelled', 'Damaged', 'Sold', 'Delivered', 'Rejected'].includes(bag.current_status)) {
            throw new Error(`Bag ${bag.bag_number} is already ${bag.current_status} and cannot be sold.`);
          }
          transitionBagStatus({
            businessId,
            bagId: bag.id,
            newStatus: 'Sold',
            scanMode: 'DISPATCH',
            userId,
            deviceId,
            note: `Sold on ${doc.doc_number}`,
          });
          execute('UPDATE bags SET customer_id = ?, sales_document_id = ? WHERE id = ?', [
            doc.customer_id,
            doc.id,
            bag.id,
          ]);
        } else {
          transitionBagStatus({
            businessId,
            bagId: bag.id,
            newStatus: 'Returned',
            scanMode: 'SALE_RETURN',
            userId,
            deviceId,
            note: `Returned on ${doc.doc_number}`,
          });
        }
        if (bag.cost_rate_per_kg > 0) {
          unitCost = bag.cost_rate_per_kg;
          lineCogs = Number((l.qty_kg * unitCost).toFixed(2));
        }
      }

      totalCogs += lineCogs;
      execute('UPDATE sales_lines SET cogs_unit_cost = ?, cogs_total = ? WHERE id = ?', [
        unitCost,
        lineCogs,
        l.id,
      ]);

      recordInventoryMovement({
        businessId,
        movementType: isReturn ? 'SALE_RETURN' : 'SALE',
        productId: l.product_id,
        bagId: l.bag_id,
        warehouseId: l.warehouse_id,
        qtyKg: isReturn ? l.qty_kg : -l.qty_kg,
        unitCost,
        totalCost: isReturn ? lineCogs : -lineCogs,
        sourceDocType: isReturn ? 'SALES_RETURN' : 'SALES_INVOICE',
        sourceDocId: doc.id,
        sourceDocNumber: doc.doc_number,
        note: `${doc.doc_type} ${doc.doc_number}`,
        occurredAt: doc.doc_date,
        userId,
        isDemo: doc.is_demo,
      });

      const sAcc = salesAccForType(l.material_type);
      const lineNetRevenue = Number((l.line_total - l.tax_amount).toFixed(2));
      revenueByAccount.set(sAcc, Number(((revenueByAccount.get(sAcc) || 0) + lineNetRevenue).toFixed(2)));
    }

    // Adjust revenue if document-level extra discount exists
    const sumLineNet = Array.from(revenueByAccount.values()).reduce((a, b) => a + b, 0);
    const expectedNet = Number((doc.total_amount - doc.tax_amount).toFixed(2));
    const docLevelDiscountDiff = Number((sumLineNet - expectedNet).toFixed(2));
    if (Math.abs(docLevelDiscountDiff) > 0.01) {
      const firstKey = Array.from(revenueByAccount.keys())[0];
      if (firstKey) {
        revenueByAccount.set(firstKey, Number(((revenueByAccount.get(firstKey) || 0) - docLevelDiscountDiff).toFixed(2)));
      }
    }

    // 1. Revenue Journal Entry
    const revLines: Array<any> = [];
    if (!isReturn) {
      revLines.push({
        accountId: arAcc,
        debit: doc.total_amount,
        credit: 0,
        partyType: 'CUSTOMER',
        partyId: doc.customer_id,
        narration: `Receivable for ${doc.doc_number}`,
      });
      for (const [accId, amt] of revenueByAccount.entries()) {
        if (amt > 0) {
          revLines.push({ accountId: accId, debit: 0, credit: amt, narration: `Sales ${doc.doc_number}` });
        }
      }
      if (doc.tax_amount > 0) {
        revLines.push({
          accountId: taxPayableAcc,
          debit: 0,
          credit: doc.tax_amount,
          narration: `Output tax ${doc.doc_number}`,
        });
      }
    } else {
      for (const [accId, amt] of revenueByAccount.entries()) {
        if (amt > 0) {
          revLines.push({ accountId: accId, debit: amt, credit: 0, narration: `Sales return ${doc.doc_number}` });
        }
      }
      if (doc.tax_amount > 0) {
        revLines.push({
          accountId: taxPayableAcc,
          debit: doc.tax_amount,
          credit: 0,
          narration: `Output tax reversal ${doc.doc_number}`,
        });
      }
      revLines.push({
        accountId: arAcc,
        debit: 0,
        credit: doc.total_amount,
        partyType: 'CUSTOMER',
        partyId: doc.customer_id,
        narration: `Credit note ${doc.doc_number}`,
      });
    }

    const revJe = postJournalEntry({
      businessId,
      entryDate: doc.doc_date,
      entryType: isReturn ? 'SALE_RETURN' : 'SALE',
      sourceDocType: 'SALES_DOCUMENT',
      sourceDocId: doc.id,
      sourceDocNumber: doc.doc_number,
      narration: `${isReturn ? 'Sales Return' : 'Sales Invoice'} ${doc.doc_number}`,
      lines: revLines,
      userId,
      deviceId,
      isDemo: doc.is_demo,
    });

    // 2. COGS Journal Entry
    let cogsJeId: string | null = null;
    if (totalCogs > 0.01) {
      const cogsJe = postJournalEntry({
        businessId,
        entryDate: doc.doc_date,
        entryType: 'SALE_COGS',
        sourceDocType: 'SALES_DOCUMENT',
        sourceDocId: doc.id,
        sourceDocNumber: doc.doc_number,
        narration: `COGS for ${doc.doc_number}`,
        lines: !isReturn
          ? [
              { accountId: cogsAcc, debit: Number(totalCogs.toFixed(2)), credit: 0, narration: `COGS ${doc.doc_number}` },
              { accountId: fgInvAcc, debit: 0, credit: Number(totalCogs.toFixed(2)), narration: `Stock issued ${doc.doc_number}` },
            ]
          : [
              { accountId: fgInvAcc, debit: Number(totalCogs.toFixed(2)), credit: 0, narration: `Stock returned ${doc.doc_number}` },
              { accountId: cogsAcc, debit: 0, credit: Number(totalCogs.toFixed(2)), narration: `COGS reversed ${doc.doc_number}` },
            ],
        userId,
        deviceId,
        isDemo: doc.is_demo,
      });
      cogsJeId = cogsJe.id;
    }

    execute(
      `UPDATE sales_documents
       SET status = 'Posted', total_cogs = ?, journal_entry_id = ?, cogs_journal_entry_id = ?,
           delivery_status = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
      [
        Number(totalCogs.toFixed(2)),
        revJe.id,
        cogsJeId,
        isReturn ? 'Returned' : 'Dispatched',
        nowIso(),
        userId,
        doc.id,
      ]
    );

    return getSalesDocument(businessId, doc.id);
  });
}

export function reverseSalesDocument(
  businessId: string,
  docId: string,
  reason: string,
  userId: string,
  deviceId: string
) {
  return withTransaction(() => {
    const doc = queryOne<any>('SELECT * FROM sales_documents WHERE id = ? AND business_id = ?', [
      docId,
      businessId,
    ]);
    if (!doc) throw new Error('Sales document not found.');
    if (doc.status !== 'Posted') throw new Error('Only posted sales documents can be reversed.');
    if (!reason || reason.trim().length < 3) throw new Error('Reversal reason is required.');

    if (doc.journal_entry_id) {
      reverseJournalEntry(businessId, doc.journal_entry_id, reason, userId, deviceId);
    }
    if (doc.cogs_journal_entry_id) {
      reverseJournalEntry(businessId, doc.cogs_journal_entry_id, reason, userId, deviceId);
    }

    execute(
      'UPDATE sales_documents SET status = \'Reversed\', updated_at = ?, updated_by = ? WHERE id = ?',
      [nowIso(), userId, doc.id]
    );

    recordAudit({
      businessId,
      userId,
      deviceId,
      action: 'SALES_REVERSED',
      entityType: 'sales_document',
      entityId: doc.id,
      summary: `Reversed ${doc.doc_number}: ${reason}`,
    });

    return getSalesDocument(businessId, doc.id);
  });
}

export function getSalesDocument(businessId: string, docId: string) {
  const doc = queryOne<any>(
    `SELECT sd.*, c.name AS customer_name, c.phone AS customer_phone
     FROM sales_documents sd
     JOIN customers c ON c.id = sd.customer_id
     WHERE sd.id = ? AND sd.business_id = ?`,
    [docId, businessId]
  );
  if (!doc) return null;
  const lines = queryAll<any>(
    `SELECT sl.*, p.name AS product_name, p.sku, w.name AS warehouse_name, b.bag_number
     FROM sales_lines sl
     JOIN products p ON p.id = sl.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     LEFT JOIN bags b ON b.id = sl.bag_id
     WHERE sl.sales_id = ? AND sl.business_id = ?`,
    [docId, businessId]
  );
  return { ...doc, lines };
}

export function createExpenseOrIncome(input: {
  businessId: string;
  voucherType: 'EXPENSE' | 'INCOME';
  voucherDate: string;
  accountId: string;
  paymentAccountId: string;
  vendorName?: string;
  paymentMethod: string;
  referenceNo?: string;
  amount: number;
  taxId?: string | null;
  notes?: string;
  postImmediately?: boolean;
  userId: string;
  deviceId: string;
  isDemo?: number;
}) {
  return withTransaction(() => {
    if (input.amount <= 0) throw new Error('Amount must be positive.');
    const biz = queryOne<{ expense_prefix: string }>(
      'SELECT expense_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const prefix = input.voucherType === 'INCOME' ? 'INC' : biz?.expense_prefix || 'EXP';
    const voucherNumber = nextSequenceNumber(input.businessId, 'expenses', 'voucher_number', prefix);

    let taxRate = 0;
    if (input.taxId) {
      const tax = queryOne<{ rate_percent: number }>(
        'SELECT rate_percent FROM tax_settings WHERE id = ? AND business_id = ?',
        [input.taxId, input.businessId]
      );
      taxRate = tax?.rate_percent || 0;
    }
    const taxAmount = Number(((input.amount * taxRate) / 100).toFixed(2));
    const totalAmount = Number((input.amount + taxAmount).toFixed(2));
    const id = newId();
    const now = nowIso();
    const status = input.postImmediately ? 'Posted' : 'Draft';

    let journalEntryId: string | null = null;
    if (input.postImmediately) {
      const lines: Array<any> = [];
      if (input.voucherType === 'EXPENSE') {
        lines.push({ accountId: input.accountId, debit: input.amount, credit: 0, narration: input.notes || voucherNumber });
        if (taxAmount > 0) {
          lines.push({
            accountId: getMappedAccountId(input.businessId, 'INPUT_TAX'),
            debit: taxAmount,
            credit: 0,
            narration: `Tax on ${voucherNumber}`,
          });
        }
        lines.push({ accountId: input.paymentAccountId, debit: 0, credit: totalAmount, narration: `Paid ${voucherNumber}` });
      } else {
        lines.push({ accountId: input.paymentAccountId, debit: totalAmount, credit: 0, narration: `Received ${voucherNumber}` });
        lines.push({ accountId: input.accountId, debit: 0, credit: input.amount, narration: input.notes || voucherNumber });
        if (taxAmount > 0) {
          lines.push({
            accountId: getMappedAccountId(input.businessId, 'TAX_PAYABLE'),
            debit: 0,
            credit: taxAmount,
            narration: `Tax on ${voucherNumber}`,
          });
        }
      }

      const je = postJournalEntry({
        businessId: input.businessId,
        entryDate: input.voucherDate,
        entryType: input.voucherType,
        sourceDocType: 'EXPENSE_VOUCHER',
        sourceDocId: id,
        sourceDocNumber: voucherNumber,
        narration: `${input.voucherType} ${voucherNumber}${input.vendorName ? ` - ${input.vendorName}` : ''}`,
        lines,
        userId: input.userId,
        deviceId: input.deviceId,
        isDemo: input.isDemo ?? 0,
      });
      journalEntryId = je.id;
    }

    execute(
      `INSERT INTO expenses (
        id, business_id, voucher_type, voucher_number, voucher_date, account_id, payment_account_id,
        vendor_name, payment_method, reference_no, amount, tax_id, tax_amount, total_amount,
        approval_status, status, journal_entry_id, notes, is_demo, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.businessId,
        input.voucherType,
        voucherNumber,
        input.voucherDate,
        input.accountId,
        input.paymentAccountId,
        input.vendorName ?? null,
        input.paymentMethod,
        input.referenceNo ?? null,
        input.amount,
        input.taxId ?? null,
        taxAmount,
        totalAmount,
        status,
        journalEntryId,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    return queryOne('SELECT * FROM expenses WHERE id = ?', [id]);
  });
}

export function createPaymentOrReceipt(input: {
  businessId: string;
  voucherType: 'PAYMENT' | 'RECEIPT' | 'CONTRA';
  voucherDate: string;
  partyType: 'SUPPLIER' | 'CUSTOMER' | 'NONE';
  partyId?: string | null;
  paymentAccountId: string; // Cash or Bank
  targetAccountId?: string | null; // For CONTRA
  paymentMethod: 'CASH' | 'BANK' | 'UPI' | 'CHEQUE' | 'OTHER';
  referenceNo?: string;
  amount: number;
  linkedDocId?: string | null;
  notes?: string;
  postImmediately?: boolean;
  userId: string;
  deviceId: string;
  isDemo?: number;
}) {
  return withTransaction(() => {
    if (input.amount <= 0) throw new Error('Payment/receipt amount must be positive.');

    const biz = queryOne<{ payment_prefix: string; receipt_prefix: string }>(
      'SELECT payment_prefix, receipt_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const prefix =
      input.voucherType === 'PAYMENT'
        ? biz?.payment_prefix || 'PAY'
        : input.voucherType === 'RECEIPT'
          ? biz?.receipt_prefix || 'RCP'
          : 'CNT';
    const voucherNumber = nextSequenceNumber(input.businessId, 'payments_receipts', 'voucher_number', prefix);
    const id = newId();
    const now = nowIso();
    const status = input.postImmediately ? 'Posted' : 'Draft';

    let journalEntryId: string | null = null;
    if (input.postImmediately) {
      const lines: Array<any> = [];
      if (input.voucherType === 'PAYMENT') {
        const apAcc = getMappedAccountId(input.businessId, 'ACCOUNTS_PAYABLE');
        lines.push({
          accountId: apAcc,
          debit: input.amount,
          credit: 0,
          partyType: 'SUPPLIER',
          partyId: input.partyId ?? null,
          narration: `Payment ${voucherNumber}`,
        });
        lines.push({
          accountId: input.paymentAccountId,
          debit: 0,
          credit: input.amount,
          narration: `${input.paymentMethod} payment ${voucherNumber}`,
        });
        if (input.linkedDocId) {
          execute(
            'UPDATE purchase_documents SET paid_amount = paid_amount + ?, updated_at = ? WHERE id = ? AND business_id = ?',
            [input.amount, now, input.linkedDocId, input.businessId]
          );
        }
      } else if (input.voucherType === 'RECEIPT') {
        const arAcc = getMappedAccountId(input.businessId, 'ACCOUNTS_RECEIVABLE');
        lines.push({
          accountId: input.paymentAccountId,
          debit: input.amount,
          credit: 0,
          narration: `${input.paymentMethod} receipt ${voucherNumber}`,
        });
        lines.push({
          accountId: arAcc,
          debit: 0,
          credit: input.amount,
          partyType: 'CUSTOMER',
          partyId: input.partyId ?? null,
          narration: `Receipt ${voucherNumber}`,
        });
        if (input.linkedDocId) {
          execute(
            'UPDATE sales_documents SET received_amount = received_amount + ?, updated_at = ? WHERE id = ? AND business_id = ?',
            [input.amount, now, input.linkedDocId, input.businessId]
          );
        }
      } else {
        if (!input.targetAccountId) throw new Error('Target account is required for Contra voucher.');
        lines.push({
          accountId: input.targetAccountId,
          debit: input.amount,
          credit: 0,
          narration: `Contra transfer ${voucherNumber}`,
        });
        lines.push({
          accountId: input.paymentAccountId,
          debit: 0,
          credit: input.amount,
          narration: `Contra transfer ${voucherNumber}`,
        });
      }

      const je = postJournalEntry({
        businessId: input.businessId,
        entryDate: input.voucherDate,
        entryType: input.voucherType,
        sourceDocType: 'PAYMENT_RECEIPT',
        sourceDocId: id,
        sourceDocNumber: voucherNumber,
        narration: `${input.voucherType} ${voucherNumber} (${input.paymentMethod})`,
        lines,
        userId: input.userId,
        deviceId: input.deviceId,
        isDemo: input.isDemo ?? 0,
      });
      journalEntryId = je.id;
    }

    execute(
      `INSERT INTO payments_receipts (
        id, business_id, voucher_type, voucher_number, voucher_date, party_type, party_id,
        payment_account_id, target_account_id, payment_method, reference_no, amount,
        linked_doc_id, status, journal_entry_id, notes, is_demo, created_at, updated_at, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.businessId,
        input.voucherType,
        voucherNumber,
        input.voucherDate,
        input.partyType,
        input.partyId ?? null,
        input.paymentAccountId,
        input.targetAccountId ?? null,
        input.paymentMethod,
        input.referenceNo ?? null,
        input.amount,
        input.linkedDocId ?? null,
        status,
        journalEntryId,
        input.notes ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
        input.userId,
      ]
    );

    return queryOne('SELECT * FROM payments_receipts WHERE id = ?', [id]);
  });
}
