import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { StatusBadge } from '../components/StatusBadge';
import { exportToCsv, exportToExcel, exportTableToPdf } from '../print/exports';

type ReportTab = 'TRIAL_BALANCE' | 'PNL' | 'BALANCE_SHEET' | 'LEDGER' | 'CASH_BANK' | 'DAY_BOOK' | 'AGEING' | 'TAX' | 'COA' | 'JOURNALS';

export function AccountingPage() {
  const { hasPerm } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<ReportTab>('TRIAL_BALANCE');

  const [coa, setCoa] = useState<any[]>([]);
  const [tb, setTb] = useState<any>(null);
  const [pnl, setPnl] = useState<any>(null);
  const [bs, setBs] = useState<any>(null);
  const [journals, setJournals] = useState<any[]>([]);
  const [selectedAccId, setSelectedAccId] = useState('');
  const [ledger, setLedger] = useState<any>(null);
  const [cashBankType, setCashBankType] = useState<'CASH' | 'BANK'>('CASH');
  const [cashBankBook, setCashBankBook] = useState<any>(null);
  const [dayBook, setDayBook] = useState<any>(null);
  const [ageingAr, setAgeingAr] = useState<any[]>([]);
  const [ageingAp, setAgeingAp] = useState<any[]>([]);
  const [taxSum, setTaxSum] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // New Account Form
  const [newAccCode, setNewAccCode] = useState('');
  const [newAccName, setNewAccName] = useState('');
  const [newAccType, setNewAccType] = useState<'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'>('EXPENSE');

  // New Manual Journal
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [jNarration, setJNarration] = useState('');
  const [jDrAcc, setJDrAcc] = useState('');
  const [jCrAcc, setJCrAcc] = useState('');
  const [jAmount, setJAmount] = useState('1000');

  const loadAll = async () => {
    const [accounts, tbRes, pnlRes, bsRes, jRes, ar, ap, tx] = await Promise.all([
      apiFetch<any[]>('/accounting/coa'),
      apiFetch('/accounting/reports/trial-balance'),
      apiFetch('/accounting/reports/profit-loss'),
      apiFetch('/accounting/reports/balance-sheet'),
      apiFetch<any[]>('/accounting/journals'),
      apiFetch<any[]>('/accounting/reports/ageing?type=AR'),
      apiFetch<any[]>('/accounting/reports/ageing?type=AP'),
      apiFetch('/accounting/reports/tax-summary'),
    ]);
    setCoa(accounts);
    setTb(tbRes);
    setPnl(pnlRes);
    setBs(bsRes);
    setJournals(jRes);
    setAgeingAr(ar);
    setAgeingAp(ap);
    setTaxSum(tx);
    if (!selectedAccId && accounts.length) setSelectedAccId(accounts[0].id);
    if (!jDrAcc && accounts.length) setJDrAcc(accounts[0].id);
    if (!jCrAcc && accounts.length > 1) setJCrAcc(accounts[1].id);
  };

  useEffect(() => {
    loadAll().catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedAccId) {
      apiFetch(`/accounting/reports/ledger/${selectedAccId}`).then(setLedger).catch(() => {});
    }
  }, [selectedAccId]);

  useEffect(() => {
    apiFetch(`/accounting/reports/cash-bank-book?type=${cashBankType}`).then(setCashBankBook).catch(() => {});
  }, [cashBankType]);

  useEffect(() => {
    apiFetch(`/accounting/reports/day-book?date=${new Date().toISOString().slice(0, 10)}`).then(setDayBook).catch(() => {});
  }, []);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/accounting/coa', {
        method: 'POST',
        body: JSON.stringify({ code: newAccCode, name: newAccName, accountType: newAccType }),
      });
      setNewAccCode('');
      setNewAccName('');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePostManualJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      const amt = Number(jAmount);
      const res = await apiFetch('/accounting/journals', {
        method: 'POST',
        body: JSON.stringify({
          entryDate: new Date().toISOString().slice(0, 10),
          entryType: 'JOURNAL',
          narration: jNarration || 'Manual Journal Voucher',
          lines: [
            { accountId: jDrAcc, debit: amt, credit: 0 },
            { accountId: jCrAcc, debit: 0, credit: amt },
          ],
        }),
      });
      setMsg(`Journal ${res.entryNumber} posted.`);
      setShowJournalForm(false);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReverseJournal = async (id: string) => {
    const reason = prompt('Enter mandatory reversal reason:');
    if (!reason) return;
    try {
      await apiFetch(`/accounting/journals/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) });
      await loadAll();
      setMsg('Journal reversed safely.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-950 font-semibold">
        {t('common.taxDisclaimer')}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['TRIAL_BALANCE', 'Trial Balance'],
            ['PNL', 'Trading & P&L'],
            ['BALANCE_SHEET', 'Balance Sheet'],
            ['LEDGER', 'Account Ledger'],
            ['CASH_BANK', 'Cash / Bank Book'],
            ['DAY_BOOK', 'Day Book'],
            ['AGEING', 'AR / AP Ageing'],
            ['TAX', 'Tax Summary'],
            ['JOURNALS', 'Journal Entries'],
            ['COA', 'Chart of Accounts'],
          ] as Array<[ReportTab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border ${tab === k ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm font-semibold">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm font-semibold">{msg}</div>}

      {/* TRIAL BALANCE */}
      {tab === 'TRIAL_BALANCE' && tb && (
        <div className="card p-4 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <div>
              <h2 className="text-lg font-bold text-[#1B4D3E]">Trial Balance (As of {tb.as_of_date})</h2>
              <span className={`text-xs font-bold ${tb.is_balanced ? 'text-emerald-700' : 'text-red-700'}`}>
                {tb.is_balanced ? 'BALANCED (Debits = Credits)' : 'UNBALANCED'}
              </span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => exportToCsv('trial_balance.csv', tb.rows)} className="btn-secondary !min-h-[36px] !py-1 text-xs">CSV</button>
              <button onClick={() => exportToExcel('trial_balance.xlsx', 'TrialBalance', tb.rows)} className="btn-secondary !min-h-[36px] !py-1 text-xs">Excel</button>
              <button
                onClick={() =>
                  exportTableToPdf(
                    'trial_balance.pdf',
                    'Trial Balance',
                    `As of ${tb.as_of_date}`,
                    ['Code', 'Account', 'Type', 'Debit (INR)', 'Credit (INR)'],
                    tb.rows.map((r: any) => [r.code, r.name, r.account_type, r.closing_debit, r.closing_credit])
                  )
                }
                className="btn-secondary !min-h-[36px] !py-1 text-xs"
              >
                PDF
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#FAF7F0] text-xs uppercase border-b">
                <tr><th className="p-2.5 text-left">Code</th><th className="p-2.5 text-left">Account</th><th className="p-2.5 text-left">Type</th><th className="p-2.5 text-right">Debit</th><th className="p-2.5 text-right">Credit</th></tr>
              </thead>
              <tbody className="divide-y">
                {tb.rows.map((r: any) => (
                  <tr key={r.account_id}>
                    <td className="p-2.5 font-mono text-xs">{r.code}</td>
                    <td className="p-2.5 font-medium">{r.name}</td>
                    <td className="p-2.5 text-xs">{r.account_type}</td>
                    <td className="p-2.5 text-right">{r.closing_debit > 0 ? fmt(r.closing_debit) : '—'}</td>
                    <td className="p-2.5 text-right">{r.closing_credit > 0 ? fmt(r.closing_credit) : '—'}</td>
                  </tr>
                ))}
                <tr className="bg-[#FAF7F0] font-bold border-t-2 border-[#1B4D3E]">
                  <td colSpan={3} className="p-2.5">TOTAL</td>
                  <td className="p-2.5 text-right">{fmt(tb.total_debit)}</td>
                  <td className="p-2.5 text-right">{fmt(tb.total_credit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PROFIT & LOSS */}
      {tab === 'PNL' && pnl && (
        <div className="card p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-bold text-[#1B4D3E]">Trading & Profit and Loss Statement</h2>
            <button
              onClick={() =>
                exportTableToPdf(
                  'profit_and_loss.pdf',
                  'Profit and Loss Statement',
                  'Generated from posted double-entry journals',
                  ['Category', 'Account', 'Amount (INR)'],
                  [
                    ...pnl.income.map((i: any) => ['Income', i.name, i.amount]),
                    ...pnl.cogs_and_direct.map((c: any) => ['Direct / COGS', c.name, c.amount]),
                    ...pnl.operating_expenses.map((e: any) => ['Operating Exp', e.name, e.amount]),
                    ['SUMMARY', 'Net Profit / (Loss)', pnl.net_profit],
                  ]
                )
              }
              className="btn-secondary !min-h-[36px] !py-1 text-xs"
            >
              PDF
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="border rounded-xl p-3 space-y-2">
              <div className="font-bold text-[#1B4D3E] border-b pb-1">Income & Sales</div>
              {pnl.income.map((i: any) => (
                <div key={i.code} className="flex justify-between"><span>{i.code} {i.name}</span><strong>{fmt(i.amount)}</strong></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-bold"><span>Total Income</span><span>{fmt(pnl.total_income)}</span></div>
            </div>
            <div className="border rounded-xl p-3 space-y-2">
              <div className="font-bold text-[#1B4D3E] border-b pb-1">Direct Cost (COGS) & Operating Expenses</div>
              {pnl.cogs_and_direct.map((c: any) => (
                <div key={c.code} className="flex justify-between"><span>{c.code} {c.name}</span><strong>{fmt(c.amount)}</strong></div>
              ))}
              <div className="flex justify-between border-t pt-1 font-bold text-emerald-900"><span>Gross Profit</span><span>{fmt(pnl.gross_profit)}</span></div>
              {pnl.operating_expenses.map((e: any) => (
                <div key={e.code} className="flex justify-between"><span>{e.code} {e.name}</span><strong>{fmt(e.amount)}</strong></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-bold text-lg text-[#1B4D3E]"><span>Net Profit / (Loss)</span><span>{fmt(pnl.net_profit)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* BALANCE SHEET */}
      {tab === 'BALANCE_SHEET' && bs && (
        <div className="card p-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-bold text-[#1B4D3E]">Balance Sheet (As of {bs.as_of_date})</h2>
              <span className={`text-xs font-bold ${bs.is_balanced ? 'text-emerald-700' : 'text-red-700'}`}>
                {bs.is_balanced ? 'Assets = Liabilities + Equity' : 'Out of Balance'}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="border rounded-xl p-3 space-y-2">
              <div className="font-bold text-[#1B4D3E] border-b pb-1">Assets</div>
              {bs.assets.map((a: any) => (
                <div key={a.code} className="flex justify-between"><span>{a.code} {a.name}</span><strong>{fmt(a.amount)}</strong></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-bold text-base"><span>Total Assets</span><span>{fmt(bs.total_assets)}</span></div>
            </div>
            <div className="border rounded-xl p-3 space-y-2">
              <div className="font-bold text-[#1B4D3E] border-b pb-1">Liabilities & Equity</div>
              {bs.liabilities.map((l: any) => (
                <div key={l.code} className="flex justify-between"><span>{l.code} {l.name}</span><strong>{fmt(l.amount)}</strong></div>
              ))}
              {bs.equity.map((eq: any) => (
                <div key={eq.code} className="flex justify-between"><span>{eq.code} {eq.name}</span><strong>{fmt(eq.amount)}</strong></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-bold text-base"><span>Total Liabilities & Equity</span><span>{fmt(bs.total_liabilities_and_equity)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ACCOUNT LEDGER */}
      {tab === 'LEDGER' && (
        <div className="card p-4 space-y-3">
          <select value={selectedAccId} onChange={(e) => setSelectedAccId(e.target.value)} className="input-field max-w-md">
            {coa.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
          {ledger && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-[#FAF7F0] border-b">
                  <tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Entry #</th><th className="p-2 text-left">Narration</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Balance</th></tr>
                </thead>
                <tbody className="divide-y">
                  {ledger.lines.map((l: any) => (
                    <tr key={l.id}>
                      <td className="p-2">{l.entry_date}</td>
                      <td className="p-2 font-bold">{l.entry_number}</td>
                      <td className="p-2">{l.narration}</td>
                      <td className="p-2 text-right">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                      <td className="p-2 text-right">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      <td className="p-2 text-right font-bold">{fmt(Math.abs(l.running_balance))} {l.balance_side}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CASH / BANK BOOK */}
      {tab === 'CASH_BANK' && (
        <div className="card p-4 space-y-3">
          <div className="flex gap-2">
            <button onClick={() => setCashBankType('CASH')} className={`px-4 py-2 rounded-xl text-xs font-bold border ${cashBankType === 'CASH' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>Cash Book</button>
            <button onClick={() => setCashBankType('BANK')} className={`px-4 py-2 rounded-xl text-xs font-bold border ${cashBankType === 'BANK' ? 'bg-[#1B4D3E] text-white' : 'bg-white'}`}>Bank Book</button>
          </div>
          {cashBankBook?.lines && (
            <table className="w-full text-xs">
              <thead className="bg-[#FAF7F0] border-b">
                <tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Voucher</th><th className="p-2 text-left">Narration</th><th className="p-2 text-right">In (Dr)</th><th className="p-2 text-right">Out (Cr)</th><th className="p-2 text-right">Balance</th></tr>
              </thead>
              <tbody className="divide-y">
                {cashBankBook.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td className="p-2">{l.entry_date}</td><td className="p-2 font-bold">{l.entry_number}</td><td className="p-2">{l.narration}</td>
                    <td className="p-2 text-right text-emerald-800">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                    <td className="p-2 text-right text-red-700">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                    <td className="p-2 text-right font-bold">{fmt(Math.abs(l.running_balance))} {l.balance_side}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* DAY BOOK */}
      {tab === 'DAY_BOOK' && dayBook && (
        <div className="card p-4 space-y-3">
          <h2 className="font-bold text-base">Day Book ({dayBook.date})</h2>
          {dayBook.entries.map((je: any) => (
            <div key={je.id} className="border rounded-xl p-3 text-xs space-y-1">
              <div className="font-bold text-[#1B4D3E]">{je.entry_number} • {je.entry_type} • {je.narration}</div>
              {je.lines.map((l: any) => (
                <div key={l.id} className="flex justify-between pl-3">
                  <span>{l.account_code} {l.account_name}</span>
                  <span>{l.debit > 0 ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* AGEING */}
      {tab === 'AGEING' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card p-4 space-y-2">
            <h3 className="font-bold text-[#1B4D3E]">Accounts Receivable Ageing</h3>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="p-2 text-left">Customer</th><th className="p-2 text-right">0-30d</th><th className="p-2 text-right">31-60d</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody>{ageingAr.map((r) => <tr key={r.party_id} className="border-b"><td className="p-2">{r.party_name}</td><td className="p-2 text-right">{fmt(r.current_0_30)}</td><td className="p-2 text-right">{fmt(r.days_31_60)}</td><td className="p-2 text-right font-bold">{fmt(r.total)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="card p-4 space-y-2">
            <h3 className="font-bold text-[#1B4D3E]">Accounts Payable Ageing</h3>
            <table className="w-full text-xs">
              <thead><tr className="border-b"><th className="p-2 text-left">Supplier</th><th className="p-2 text-right">0-30d</th><th className="p-2 text-right">31-60d</th><th className="p-2 text-right">Total</th></tr></thead>
              <tbody>{ageingAp.map((r) => <tr key={r.party_id} className="border-b"><td className="p-2">{r.party_name}</td><td className="p-2 text-right">{fmt(r.current_0_30)}</td><td className="p-2 text-right">{fmt(r.days_31_60)}</td><td className="p-2 text-right font-bold">{fmt(r.total)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAX SUMMARY */}
      {tab === 'TAX' && taxSum && (
        <div className="card p-4 space-y-3 text-sm">
          <h2 className="font-bold text-lg text-[#1B4D3E]">Configurable Tax Summary</h2>
          <p className="text-xs text-amber-900 bg-amber-50 p-2.5 rounded-lg border border-amber-300">{taxSum.disclaimer}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#FAF7F0] p-3 rounded-xl"><div>Output Tax (Sales)</div><strong className="text-lg">{fmt(taxSum.output_tax)}</strong></div>
            <div className="bg-[#FAF7F0] p-3 rounded-xl"><div>Input Tax Credit (Purchases)</div><strong className="text-lg">{fmt(taxSum.input_tax)}</strong></div>
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-300"><div>Net Tax Payable</div><strong className="text-lg text-[#1B4D3E]">{fmt(taxSum.net_tax_payable)}</strong></div>
          </div>
        </div>
      )}

      {/* JOURNALS */}
      {tab === 'JOURNALS' && (
        <div className="space-y-3">
          {hasPerm('accounting.post') && (
            <button onClick={() => setShowJournalForm(!showJournalForm)} className="btn-primary">
              <Plus className="w-5 h-5" /> New Manual Journal Entry
            </button>
          )}
          {showJournalForm && (
            <form onSubmit={handlePostManualJournal} className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
              <select value={jDrAcc} onChange={(e) => setJDrAcc(e.target.value)} className="input-field">
                {coa.map((a) => <option key={a.id} value={a.id}>Dr: {a.code} {a.name}</option>)}
              </select>
              <select value={jCrAcc} onChange={(e) => setJCrAcc(e.target.value)} className="input-field">
                {coa.map((a) => <option key={a.id} value={a.id}>Cr: {a.code} {a.name}</option>)}
              </select>
              <input type="number" step="0.01" value={jAmount} onChange={(e) => setJAmount(e.target.value)} placeholder="Amount ₹" className="input-field" required />
              <input value={jNarration} onChange={(e) => setJNarration(e.target.value)} placeholder="Narration" className="input-field" required />
              <button type="submit" className="btn-primary sm:col-span-4">Post Balanced Journal</button>
            </form>
          )}
          <div className="space-y-2">
            {journals.map((je) => (
              <div key={je.id} className="card p-3 space-y-2 text-xs">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <span className="font-bold text-sm text-[#1B4D3E]">{je.entry_number} • {je.entry_type} • {je.entry_date}</span>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={je.status} />
                    {je.status === 'Posted' && hasPerm('accounting.post') && (
                      <button onClick={() => handleReverseJournal(je.id)} className="btn-secondary !min-h-[30px] !py-0.5 !px-2 text-xs text-red-700">
                        <RotateCcw className="w-3 h-3" /> Reverse
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-stone-600">{je.narration}</div>
                <div className="border-t pt-1.5 space-y-0.5">
                  {je.lines.map((l: any) => (
                    <div key={l.id} className="flex justify-between">
                      <span>{l.account_code} - {l.account_name}</span>
                      <span>{l.debit > 0 ? `Dr ${fmt(l.debit)}` : `Cr ${fmt(l.credit)}`}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CHART OF ACCOUNTS */}
      {tab === 'COA' && (
        <div className="space-y-3">
          {hasPerm('accounting.post') && (
            <form onSubmit={handleAddAccount} className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input value={newAccCode} onChange={(e) => setNewAccCode(e.target.value)} placeholder="Code (e.g. 5210)" className="input-field" required />
              <input value={newAccName} onChange={(e) => setNewAccName(e.target.value)} placeholder="Account Name" className="input-field" required />
              <select value={newAccType} onChange={(e) => setNewAccType(e.target.value as any)} className="input-field">
                <option value="ASSET">Asset</option><option value="LIABILITY">Liability</option><option value="EQUITY">Equity</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option>
              </select>
              <button type="submit" className="btn-primary">Add Account</button>
            </form>
          )}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#FAF7F0] text-xs uppercase border-b">
                <tr><th className="p-3">Code</th><th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Subtype</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody className="divide-y">
                {coa.map((a) => (
                  <tr key={a.id}>
                    <td className="p-3 font-mono font-bold">{a.code}</td>
                    <td className="p-3 font-medium">{a.name}</td>
                    <td className="p-3 text-xs">{a.account_type}</td>
                    <td className="p-3 text-xs">{a.subtype}</td>
                    <td className="p-3">{a.is_active ? 'Active' : 'Inactive'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
