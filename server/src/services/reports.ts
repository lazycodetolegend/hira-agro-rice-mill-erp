import { queryAll, queryOne } from '../db/connection.js';

export function getTrialBalance(businessId: string, asOfDate?: string) {
  const dateFilter = asOfDate ? 'AND je.entry_date <= ?' : '';
  const params: unknown[] = [businessId];
  if (asOfDate) params.push(asOfDate);

  const accounts = queryAll<any>(
    `SELECT coa.id, coa.code, coa.name, coa.account_type, coa.subtype,
            coa.opening_balance, coa.opening_side,
            COALESCE(SUM(CASE WHEN je.status = 'Posted' ${dateFilter} THEN jl.debit ELSE 0 END), 0) AS period_debit,
            COALESCE(SUM(CASE WHEN je.status = 'Posted' ${dateFilter} THEN jl.credit ELSE 0 END), 0) AS period_credit
     FROM chart_of_accounts coa
     LEFT JOIN journal_lines jl ON jl.account_id = coa.id AND jl.business_id = coa.business_id
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE coa.business_id = ? AND coa.is_active = 1
     GROUP BY coa.id
     ORDER BY coa.code ASC`,
    asOfDate ? [asOfDate, asOfDate, businessId] : [businessId]
  );

  let totalDebit = 0;
  let totalCredit = 0;

  const rows = accounts
    .map((a) => {
      const openDr = a.opening_side === 'DEBIT' ? a.opening_balance : 0;
      const openCr = a.opening_side === 'CREDIT' ? a.opening_balance : 0;
      const net = openDr - openCr + (a.period_debit - a.period_credit);
      const closingDebit = net > 0 ? Number(net.toFixed(2)) : 0;
      const closingCredit = net < 0 ? Number(Math.abs(net).toFixed(2)) : 0;
      totalDebit += closingDebit;
      totalCredit += closingCredit;
      return {
        account_id: a.id,
        code: a.code,
        name: a.name,
        account_type: a.account_type,
        subtype: a.subtype,
        debit_total: Number((openDr + a.period_debit).toFixed(2)),
        credit_total: Number((openCr + a.period_credit).toFixed(2)),
        closing_debit: closingDebit,
        closing_credit: closingCredit,
        net_balance: Number(net.toFixed(2)),
      };
    })
    .filter((r) => r.debit_total !== 0 || r.credit_total !== 0);

  return {
    as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
    rows,
    total_debit: Number(totalDebit.toFixed(2)),
    total_credit: Number(totalCredit.toFixed(2)),
    is_balanced: Math.abs(totalDebit - totalCredit) <= 0.05,
  };
}

export function getProfitAndLoss(businessId: string, fromDate?: string, toDate?: string) {
  const params: unknown[] = [];
  let dateFilter = '';
  if (fromDate) {
    dateFilter += ' AND je.entry_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    dateFilter += ' AND je.entry_date <= ?';
    params.push(toDate);
  }

  const rows = queryAll<any>(
    `SELECT coa.id, coa.code, coa.name, coa.account_type, coa.subtype,
            COALESCE(SUM(jl.debit), 0) AS debit,
            COALESCE(SUM(jl.credit), 0) AS credit
     FROM chart_of_accounts coa
     LEFT JOIN journal_lines jl ON jl.account_id = coa.id AND jl.business_id = coa.business_id
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'Posted' ${dateFilter}
     WHERE coa.business_id = ? AND coa.account_type IN ('INCOME', 'EXPENSE')
     GROUP BY coa.id
     ORDER BY coa.code ASC`,
    [...params, businessId]
  );

  // Filter strictly to posted entries when date filter applied
  const postedRows = queryAll<any>(
    `SELECT coa.id, coa.code, coa.name, coa.account_type, coa.subtype,
            COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit ELSE 0 END), 0) AS debit,
            COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit ELSE 0 END), 0) AS credit
     FROM chart_of_accounts coa
     LEFT JOIN journal_lines jl ON jl.account_id = coa.id AND jl.business_id = coa.business_id
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'Posted' ${dateFilter}
     WHERE coa.business_id = ? AND coa.account_type IN ('INCOME', 'EXPENSE')
     GROUP BY coa.id
     ORDER BY coa.code ASC`,
    [...params, businessId]
  );
  void rows;

  const income: any[] = [];
  const cogsAndDirect: any[] = [];
  const operatingExpenses: any[] = [];

  let totalIncome = 0;
  let totalCogs = 0;
  let totalOperatingExpenses = 0;

  for (const r of postedRows) {
    if (r.account_type === 'INCOME') {
      const amt = Number((r.credit - r.debit).toFixed(2));
      if (amt !== 0) {
        income.push({ code: r.code, name: r.name, subtype: r.subtype, amount: amt });
        totalIncome += amt;
      }
    } else {
      const amt = Number((r.debit - r.credit).toFixed(2));
      if (amt !== 0) {
        if (r.subtype === 'COGS' || r.subtype === 'PURCHASES' || r.subtype === 'FREIGHT') {
          cogsAndDirect.push({ code: r.code, name: r.name, subtype: r.subtype, amount: amt });
          totalCogs += amt;
        } else {
          operatingExpenses.push({ code: r.code, name: r.name, subtype: r.subtype, amount: amt });
          totalOperatingExpenses += amt;
        }
      }
    }
  }

  const grossProfit = Number((totalIncome - totalCogs).toFixed(2));
  const netProfit = Number((grossProfit - totalOperatingExpenses).toFixed(2));

  return {
    from_date: fromDate || null,
    to_date: toDate || null,
    income,
    cogs_and_direct: cogsAndDirect,
    operating_expenses: operatingExpenses,
    total_income: Number(totalIncome.toFixed(2)),
    total_cogs: Number(totalCogs.toFixed(2)),
    gross_profit: grossProfit,
    total_operating_expenses: Number(totalOperatingExpenses.toFixed(2)),
    net_profit: netProfit,
  };
}

export function getBalanceSheet(businessId: string, asOfDate?: string) {
  const tb = getTrialBalance(businessId, asOfDate);
  const pl = getProfitAndLoss(businessId, undefined, asOfDate);

  const assets: any[] = [];
  const liabilities: any[] = [];
  const equity: any[] = [];

  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const row of tb.rows) {
    if (row.account_type === 'ASSET') {
      const amt = Number((row.closing_debit - row.closing_credit).toFixed(2));
      assets.push({ code: row.code, name: row.name, subtype: row.subtype, amount: amt });
      totalAssets += amt;
    } else if (row.account_type === 'LIABILITY') {
      const amt = Number((row.closing_credit - row.closing_debit).toFixed(2));
      liabilities.push({ code: row.code, name: row.name, subtype: row.subtype, amount: amt });
      totalLiabilities += amt;
    } else if (row.account_type === 'EQUITY') {
      const amt = Number((row.closing_credit - row.closing_debit).toFixed(2));
      equity.push({ code: row.code, name: row.name, subtype: row.subtype, amount: amt });
      totalEquity += amt;
    }
  }

  // Add current period Net Profit/Loss into Equity
  equity.push({
    code: 'NET-PL',
    name: 'Current Period Net Profit / (Loss)',
    subtype: 'CURRENT_EARNINGS',
    amount: pl.net_profit,
  });
  totalEquity = Number((totalEquity + pl.net_profit).toFixed(2));

  const totalLiabAndEquity = Number((totalLiabilities + totalEquity).toFixed(2));

  return {
    as_of_date: asOfDate || new Date().toISOString().slice(0, 10),
    assets,
    liabilities,
    equity,
    total_assets: Number(totalAssets.toFixed(2)),
    total_liabilities: Number(totalLiabilities.toFixed(2)),
    total_equity: Number(totalEquity.toFixed(2)),
    total_liabilities_and_equity: totalLiabAndEquity,
    is_balanced: Math.abs(totalAssets - totalLiabAndEquity) <= 0.1,
  };
}

export function getAccountLedger(businessId: string, accountId: string, fromDate?: string, toDate?: string) {
  const account = queryOne<any>(
    'SELECT * FROM chart_of_accounts WHERE id = ? AND business_id = ?',
    [accountId, businessId]
  );
  if (!account) throw new Error('Account not found.');

  let sql = `
    SELECT jl.*, je.entry_number, je.entry_date, je.entry_type, je.source_doc_type, je.source_doc_number, je.narration AS entry_narration
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    WHERE jl.business_id = ? AND jl.account_id = ? AND je.status = 'Posted'
  `;
  const params: unknown[] = [businessId, accountId];
  if (fromDate) {
    sql += ' AND je.entry_date >= ?';
    params.push(fromDate);
  }
  if (toDate) {
    sql += ' AND je.entry_date <= ?';
    params.push(toDate);
  }
  sql += ' ORDER BY je.entry_date ASC, je.created_at ASC';

  const entries = queryAll<any>(sql, params);
  let running =
    account.opening_side === 'DEBIT' ? account.opening_balance : -account.opening_balance;

  const linesWithBalance = entries.map((e) => {
    running += e.debit - e.credit;
    return {
      ...e,
      running_balance: Number(running.toFixed(2)),
      balance_side: running >= 0 ? 'Dr' : 'Cr',
    };
  });

  return {
    account,
    opening_balance: account.opening_balance,
    opening_side: account.opening_side,
    lines: linesWithBalance,
    closing_balance: Number(Math.abs(running).toFixed(2)),
    closing_side: running >= 0 ? 'Dr' : 'Cr',
  };
}

export function getStockValuationReport(businessId: string) {
  const biz = queryOne<{ valuation_method: string }>(
    'SELECT valuation_method FROM businesses WHERE id = ?',
    [businessId]
  );
  const rows = queryAll<any>(
    `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.material_type,
            p.low_stock_threshold_kg,
            w.id AS warehouse_id, w.name AS warehouse_name,
            COALESCE(SUM(im.qty_kg), 0) AS qty_kg,
            COALESCE(SUM(im.total_cost), 0) AS total_value
     FROM products p
     LEFT JOIN inventory_movements im ON im.product_id = p.id AND im.business_id = p.business_id AND im.status = 'ACTIVE'
     LEFT JOIN warehouses w ON w.id = im.warehouse_id
     WHERE p.business_id = ? AND p.is_active = 1
     GROUP BY p.id, w.id
     HAVING ABS(qty_kg) > 0.001 OR w.id IS NULL
     ORDER BY p.name ASC`,
    [businessId]
  );

  const items = rows.map((r) => {
    const qty = Number((r.qty_kg || 0).toFixed(3));
    const val = Math.max(0, Number((r.total_value || 0).toFixed(2)));
    const avgCost = qty > 0 ? Number((val / qty).toFixed(2)) : 0;
    return {
      ...r,
      qty_kg: qty,
      total_value: val,
      avg_cost_per_kg: avgCost,
      is_low_stock: qty < (r.low_stock_threshold_kg || 0),
    };
  });

  const totalQtyKg = items.reduce((a, b) => a + b.qty_kg, 0);
  const totalValue = items.reduce((a, b) => a + b.total_value, 0);

  return {
    valuation_method: biz?.valuation_method || 'WEIGHTED_AVG',
    items,
    total_qty_kg: Number(totalQtyKg.toFixed(3)),
    total_value: Number(totalValue.toFixed(2)),
  };
}

export function getAgeingReport(businessId: string, type: 'AR' | 'AP') {
  const today = new Date();
  if (type === 'AR') {
    const docs = queryAll<any>(
      `SELECT sd.id, sd.doc_number, sd.doc_date, sd.due_date, sd.total_amount, sd.received_amount,
              c.id AS party_id, c.name AS party_name
       FROM sales_documents sd
       JOIN customers c ON c.id = sd.customer_id
       WHERE sd.business_id = ? AND sd.doc_type = 'INVOICE' AND sd.status = 'Posted'
         AND (sd.total_amount - sd.received_amount) > 0.01`,
      [businessId]
    );
    return bucketizeAgeing(docs, 'received_amount', today);
  } else {
    const docs = queryAll<any>(
      `SELECT pd.id, pd.doc_number, pd.doc_date, pd.due_date, pd.total_amount, pd.paid_amount,
              s.id AS party_id, s.name AS party_name
       FROM purchase_documents pd
       JOIN suppliers s ON s.id = pd.supplier_id
       WHERE pd.business_id = ? AND pd.doc_type = 'INVOICE' AND pd.status = 'Posted'
         AND (pd.total_amount - pd.paid_amount) > 0.01`,
      [businessId]
    );
    return bucketizeAgeing(docs, 'paid_amount', today);
  }
}

function bucketizeAgeing(docs: any[], settledField: string, today: Date) {
  const byParty = new Map<string, any>();
  for (const d of docs) {
    const outstanding = Number((d.total_amount - d[settledField]).toFixed(2));
    const refDate = new Date(d.due_date || d.doc_date);
    const days = Math.max(0, Math.floor((today.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24)));

    if (!byParty.has(d.party_id)) {
      byParty.set(d.party_id, {
        party_id: d.party_id,
        party_name: d.party_name,
        current_0_30: 0,
        days_31_60: 0,
        days_61_90: 0,
        over_90: 0,
        total: 0,
      });
    }
    const row = byParty.get(d.party_id);
    if (days <= 30) row.current_0_30 += outstanding;
    else if (days <= 60) row.days_31_60 += outstanding;
    else if (days <= 90) row.days_61_90 += outstanding;
    else row.over_90 += outstanding;
    row.total = Number((row.total + outstanding).toFixed(2));
  }
  return Array.from(byParty.values());
}

export function getTaxSummaryReport(businessId: string, fromDate?: string, toDate?: string) {
  let pFilter = '';
  let sFilter = '';
  const pParams: unknown[] = [businessId];
  const sParams: unknown[] = [businessId];
  if (fromDate) {
    pFilter += ' AND doc_date >= ?';
    sFilter += ' AND doc_date >= ?';
    pParams.push(fromDate);
    sParams.push(fromDate);
  }
  if (toDate) {
    pFilter += ' AND doc_date <= ?';
    sFilter += ' AND doc_date <= ?';
    pParams.push(toDate);
    sParams.push(toDate);
  }

  const outputSales = queryOne<{ taxable: number; tax: number }>(
    `SELECT COALESCE(SUM(subtotal - discount_amount), 0) AS taxable, COALESCE(SUM(tax_amount), 0) AS tax
     FROM sales_documents WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' ${sFilter}`,
    sParams
  );
  const inputPurchases = queryOne<{ taxable: number; tax: number }>(
    `SELECT COALESCE(SUM(subtotal - discount_amount), 0) AS taxable, COALESCE(SUM(tax_amount), 0) AS tax
     FROM purchase_documents WHERE business_id = ? AND doc_type = 'INVOICE' AND status = 'Posted' ${pFilter}`,
    pParams
  );

  const outputTax = Number((outputSales?.tax || 0).toFixed(2));
  const inputTax = Number((inputPurchases?.tax || 0).toFixed(2));

  return {
    disclaimer:
      'Tax summary is based on configured tax rates. Statutory compliance and GST filings must be verified by the business accountant.',
    sales_taxable: Number((outputSales?.taxable || 0).toFixed(2)),
    output_tax: outputTax,
    purchase_taxable: Number((inputPurchases?.taxable || 0).toFixed(2)),
    input_tax: inputTax,
    net_tax_payable: Number((outputTax - inputTax).toFixed(2)),
  };
}
