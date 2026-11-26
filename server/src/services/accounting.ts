import { queryAll, queryOne, execute, withTransaction, nowIso } from '../db/connection.js';
import { newId } from '../utils/crypto.js';
import { nextSequenceNumber } from '../utils/numbering.js';
import { recordAudit } from '../middleware/audit.js';

export const DEFAULT_COA: Array<{
  code: string;
  name: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  subtype: string;
  mappingKey?: string;
}> = [
  // Assets
  { code: '1010', name: 'Cash in Hand', accountType: 'ASSET', subtype: 'CASH', mappingKey: 'CASH' },
  { code: '1020', name: 'Bank Account (Primary)', accountType: 'ASSET', subtype: 'BANK', mappingKey: 'BANK' },
  { code: '1100', name: 'Accounts Receivable', accountType: 'ASSET', subtype: 'RECEIVABLE', mappingKey: 'ACCOUNTS_RECEIVABLE' },
  { code: '1200', name: 'Raw Material & Paddy Inventory', accountType: 'ASSET', subtype: 'INVENTORY', mappingKey: 'RAW_MATERIAL_INVENTORY' },
  { code: '1210', name: 'Finished Rice & By-Products Inventory', accountType: 'ASSET', subtype: 'INVENTORY', mappingKey: 'FINISHED_GOODS_INVENTORY' },
  { code: '1300', name: 'Supplier Advances', accountType: 'ASSET', subtype: 'ADVANCE', mappingKey: 'SUPPLIER_ADVANCES' },
  { code: '1500', name: 'Mill Machinery & Fixed Assets', accountType: 'ASSET', subtype: 'FIXED_ASSET' },
  { code: '1510', name: 'Accumulated Depreciation', accountType: 'ASSET', subtype: 'CONTRA_ASSET' },

  // Liabilities
  { code: '2010', name: 'Accounts Payable', accountType: 'LIABILITY', subtype: 'PAYABLE', mappingKey: 'ACCOUNTS_PAYABLE' },
  { code: '2100', name: 'Output Tax Payable', accountType: 'LIABILITY', subtype: 'TAX_PAYABLE', mappingKey: 'TAX_PAYABLE' },
  { code: '2110', name: 'Input Tax Credit / Recoverable', accountType: 'ASSET', subtype: 'TAX_RECEIVABLE', mappingKey: 'INPUT_TAX' },
  { code: '2200', name: 'Customer Advances', accountType: 'LIABILITY', subtype: 'ADVANCE', mappingKey: 'CUSTOMER_ADVANCES' },
  { code: '2300', name: 'Loans & Credit Facilities', accountType: 'LIABILITY', subtype: 'LOAN' },

  // Equity
  { code: '3010', name: 'Owner Capital', accountType: 'EQUITY', subtype: 'CAPITAL' },
  { code: '3020', name: 'Owner Drawings', accountType: 'EQUITY', subtype: 'DRAWINGS' },
  { code: '3030', name: 'Retained Earnings', accountType: 'EQUITY', subtype: 'RETAINED_EARNINGS' },

  // Income
  { code: '4010', name: 'Rice Sales', accountType: 'INCOME', subtype: 'SALES', mappingKey: 'RICE_SALES' },
  { code: '4020', name: 'Broken Rice Sales', accountType: 'INCOME', subtype: 'SALES', mappingKey: 'BROKEN_RICE_SALES' },
  { code: '4030', name: 'Bran Sales', accountType: 'INCOME', subtype: 'SALES', mappingKey: 'BRAN_SALES' },
  { code: '4040', name: 'Husk Sales', accountType: 'INCOME', subtype: 'SALES', mappingKey: 'HUSK_SALES' },
  { code: '4090', name: 'Other Income', accountType: 'INCOME', subtype: 'OTHER_INCOME', mappingKey: 'OTHER_INCOME' },
  { code: '4100', name: 'Purchase Discounts & Rebates', accountType: 'INCOME', subtype: 'DISCOUNT', mappingKey: 'PURCHASE_DISCOUNT' },

  // Expenses
  { code: '5010', name: 'Cost of Goods Sold', accountType: 'EXPENSE', subtype: 'COGS', mappingKey: 'COGS' },
  { code: '5020', name: 'Paddy & Rice Purchases Clearing', accountType: 'EXPENSE', subtype: 'PURCHASES' },
  { code: '5100', name: 'Freight & Carriage Inward', accountType: 'EXPENSE', subtype: 'FREIGHT', mappingKey: 'FREIGHT_INWARD' },
  { code: '5110', name: 'Electricity & Mill Power', accountType: 'EXPENSE', subtype: 'UTILITY' },
  { code: '5120', name: 'Mill Labour & Loading Charges', accountType: 'EXPENSE', subtype: 'LABOUR' },
  { code: '5130', name: 'Repairs & Maintenance', accountType: 'EXPENSE', subtype: 'MAINTENANCE' },
  { code: '5140', name: 'Packaging & Gunny/PP Bags', accountType: 'EXPENSE', subtype: 'PACKAGING' },
  { code: '5150', name: 'Godown & Mill Rent', accountType: 'EXPENSE', subtype: 'RENT' },
  { code: '5160', name: 'Staff Salaries', accountType: 'EXPENSE', subtype: 'SALARIES' },
  { code: '5170', name: 'Bank Charges', accountType: 'EXPENSE', subtype: 'BANK_CHARGES' },
  { code: '5180', name: 'Depreciation Expense', accountType: 'EXPENSE', subtype: 'DEPRECIATION', mappingKey: 'DEPRECIATION' },
  { code: '5190', name: 'Stock Loss / Milling Variance', accountType: 'EXPENSE', subtype: 'VARIANCE', mappingKey: 'STOCK_VARIANCE' },
  { code: '5195', name: 'Sales Discounts Allowed', accountType: 'EXPENSE', subtype: 'DISCOUNT', mappingKey: 'SALES_DISCOUNT' },
  { code: '5200', name: 'Other General Expenses', accountType: 'EXPENSE', subtype: 'OTHER_EXPENSE' },
];

export function initializeBusinessAccounting(businessId: string, fyStartMonth = 4, fyStartDay = 1) {
  const now = nowIso();
  const codeToId = new Map<string, string>();

  for (const item of DEFAULT_COA) {
    const existing = queryOne<{ id: string }>(
      'SELECT id FROM chart_of_accounts WHERE business_id = ? AND code = ?',
      [businessId, item.code]
    );
    const id = existing?.id || newId();
    if (!existing) {
      execute(
        `INSERT INTO chart_of_accounts (
          id, business_id, code, name, account_type, subtype, is_system, is_active,
          opening_balance, opening_side, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?)`,
        [
          id,
          businessId,
          item.code,
          item.name,
          item.accountType,
          item.subtype,
          item.accountType === 'ASSET' || item.accountType === 'EXPENSE' ? 'DEBIT' : 'CREDIT',
          now,
          now,
        ]
      );
    }
    codeToId.set(item.code, id);

    if (item.mappingKey) {
      const existingMap = queryOne(
        'SELECT id FROM account_mappings WHERE business_id = ? AND mapping_key = ?',
        [businessId, item.mappingKey]
      );
      if (!existingMap) {
        execute(
          `INSERT INTO account_mappings (id, business_id, mapping_key, account_id, description, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId(), businessId, item.mappingKey, id, `Default mapping for ${item.mappingKey}`, now]
        );
      }
    }
  }

  // Create default active fiscal period based on configured FY start month/day
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const startYear = currentMonth >= fyStartMonth ? currentYear : currentYear - 1;
  const endYear = fyStartMonth === 1 ? startYear : startYear + 1;
  const startStr = `${startYear}-${String(fyStartMonth).padStart(2, '0')}-${String(fyStartDay).padStart(2, '0')}`;
  const endDateObj = new Date(Date.UTC(endYear, fyStartMonth - 1, fyStartDay));
  endDateObj.setUTCDate(endDateObj.getUTCDate() - 1);
  if (fyStartMonth === 1 && fyStartDay === 1) {
    endDateObj.setUTCFullYear(startYear, 11, 31);
  }
  const endStr = endDateObj.toISOString().slice(0, 10);

  const hasPeriod = queryOne('SELECT id FROM fiscal_periods WHERE business_id = ?', [businessId]);
  if (!hasPeriod) {
    execute(
      `INSERT INTO fiscal_periods (id, business_id, name, start_date, end_date, is_closed, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [newId(), businessId, `FY ${startYear}-${String(endYear).slice(-2)}`, startStr, endStr, now]
    );
  }

  return codeToId;
}

export function getMappedAccountId(businessId: string, mappingKey: string): string {
  const row = queryOne<{ account_id: string }>(
    'SELECT account_id FROM account_mappings WHERE business_id = ? AND mapping_key = ?',
    [businessId, mappingKey]
  );
  if (!row) {
    throw new Error(`Account mapping not configured for key: ${mappingKey}`);
  }
  return row.account_id;
}

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  partyType?: 'SUPPLIER' | 'CUSTOMER' | null;
  partyId?: string | null;
  narration?: string;
}

export interface PostJournalInput {
  businessId: string;
  entryDate: string;
  entryType:
    | 'PURCHASE'
    | 'PURCHASE_RETURN'
    | 'SALE'
    | 'SALE_COGS'
    | 'SALE_RETURN'
    | 'PRODUCTION'
    | 'EXPENSE'
    | 'INCOME'
    | 'PAYMENT'
    | 'RECEIPT'
    | 'CONTRA'
    | 'JOURNAL'
    | 'OPENING'
    | 'STOCK_ADJUSTMENT'
    | 'DEPRECIATION'
    | 'REVERSAL';
  sourceDocType?: string;
  sourceDocId?: string;
  sourceDocNumber?: string;
  narration: string;
  lines: JournalLineInput[];
  userId: string;
  deviceId: string;
  status?: 'Draft' | 'Posted';
  reversedEntryId?: string;
  isDemo?: number;
}

export function postJournalEntry(input: PostJournalInput) {
  return withTransaction(() => {
    const cleanLines = input.lines
      .map((l) => ({
        ...l,
        debit: Number((l.debit || 0).toFixed(2)),
        credit: Number((l.credit || 0).toFixed(2)),
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);

    if (cleanLines.length < 2) {
      throw new Error('Journal entry must have at least two non-zero lines.');
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of cleanLines) {
      if (line.debit < 0 || line.credit < 0) {
        throw new Error('Debit and credit amounts cannot be negative.');
      }
      if (line.debit > 0 && line.credit > 0) {
        throw new Error('A single journal line cannot have both debit and credit.');
      }
      const acc = queryOne<{ id: string; is_active: number }>(
        'SELECT id, is_active FROM chart_of_accounts WHERE id = ? AND business_id = ?',
        [line.accountId, input.businessId]
      );
      if (!acc || !acc.is_active) {
        throw new Error(`Invalid or inactive account: ${line.accountId}`);
      }
      totalDebit += line.debit;
      totalCredit += line.credit;
    }

    const diff = Number(Math.abs(totalDebit - totalCredit).toFixed(2));
    if (diff > 0.01) {
      throw new Error(
        `Unbalanced journal entry: Debits (${totalDebit.toFixed(2)}) != Credits (${totalCredit.toFixed(2)})`
      );
    }

    // Check if date falls in a closed fiscal period
    const dateOnly = input.entryDate.slice(0, 10);
    const closedPeriod = queryOne<{ name: string }>(
      `SELECT name FROM fiscal_periods
       WHERE business_id = ? AND is_closed = 1 AND start_date <= ? AND end_date >= ?`,
      [input.businessId, dateOnly, dateOnly]
    );
    if (closedPeriod) {
      throw new Error(`Fiscal period "${closedPeriod.name}" is closed for date ${dateOnly}.`);
    }

    const biz = queryOne<{ journal_prefix: string }>(
      'SELECT journal_prefix FROM businesses WHERE id = ?',
      [input.businessId]
    );
    const entryNumber = nextSequenceNumber(
      input.businessId,
      'journal_entries',
      'entry_number',
      biz?.journal_prefix || 'JRN'
    );
    const entryId = newId();
    const now = nowIso();
    const status = input.status || 'Posted';

    execute(
      `INSERT INTO journal_entries (
        id, business_id, entry_number, entry_date, entry_type,
        source_doc_type, source_doc_id, source_doc_number, narration,
        status, reversed_entry_id, is_demo, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entryId,
        input.businessId,
        entryNumber,
        dateOnly,
        input.entryType,
        input.sourceDocType ?? null,
        input.sourceDocId ?? null,
        input.sourceDocNumber ?? null,
        input.narration,
        status,
        input.reversedEntryId ?? null,
        input.isDemo ?? 0,
        now,
        now,
        input.userId,
      ]
    );

    for (const line of cleanLines) {
      execute(
        `INSERT INTO journal_lines (
          id, business_id, journal_entry_id, account_id, party_type, party_id, debit, credit, narration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          input.businessId,
          entryId,
          line.accountId,
          line.partyType ?? null,
          line.partyId ?? null,
          line.debit,
          line.credit,
          line.narration ?? input.narration,
        ]
      );
    }

    recordAudit({
      businessId: input.businessId,
      userId: input.userId,
      deviceId: input.deviceId,
      action: status === 'Posted' ? 'JOURNAL_POSTED' : 'JOURNAL_DRAFT',
      entityType: 'journal_entry',
      entityId: entryId,
      summary: `${entryNumber} (${input.entryType}) Dr=${totalDebit.toFixed(2)}`,
      after: { entryNumber, entryType: input.entryType, totalDebit, totalCredit },
    });

    return { id: entryId, entryNumber, totalDebit, totalCredit, status };
  });
}

export function reverseJournalEntry(
  businessId: string,
  entryId: string,
  reason: string,
  userId: string,
  deviceId: string
) {
  return withTransaction(() => {
    const orig = queryOne<{
      id: string;
      entry_number: string;
      entry_date: string;
      status: string;
      narration: string;
      source_doc_type: string | null;
      source_doc_id: string | null;
      source_doc_number: string | null;
      is_demo: number;
    }>('SELECT * FROM journal_entries WHERE id = ? AND business_id = ?', [entryId, businessId]);

    if (!orig) throw new Error('Journal entry not found.');
    if (orig.status !== 'Posted') {
      throw new Error('Only posted journal entries can be reversed.');
    }

    const lines = queryAll<{
      account_id: string;
      party_type: 'SUPPLIER' | 'CUSTOMER' | null;
      party_id: string | null;
      debit: number;
      credit: number;
      narration: string | null;
    }>('SELECT * FROM journal_lines WHERE journal_entry_id = ? AND business_id = ?', [
      entryId,
      businessId,
    ]);

    const revResult = postJournalEntry({
      businessId,
      entryDate: nowIso().slice(0, 10),
      entryType: 'REVERSAL',
      sourceDocType: orig.source_doc_type ?? undefined,
      sourceDocId: orig.source_doc_id ?? undefined,
      sourceDocNumber: orig.source_doc_number ?? undefined,
      narration: `REVERSAL of ${orig.entry_number}: ${reason}`,
      lines: lines.map((l) => ({
        accountId: l.account_id,
        debit: l.credit,
        credit: l.debit,
        partyType: l.party_type,
        partyId: l.party_id,
        narration: `Reversal: ${l.narration || orig.narration}`,
      })),
      userId,
      deviceId,
      status: 'Posted',
      reversedEntryId: orig.id,
      isDemo: orig.is_demo,
    });

    execute('UPDATE journal_entries SET status = ?, updated_at = ? WHERE id = ?', [
      'Reversed',
      nowIso(),
      orig.id,
    ]);

    recordAudit({
      businessId,
      userId,
      deviceId,
      action: 'JOURNAL_REVERSED',
      entityType: 'journal_entry',
      entityId: orig.id,
      summary: `Reversed ${orig.entry_number} via ${revResult.entryNumber}: ${reason}`,
    });

    return revResult;
  });
}
