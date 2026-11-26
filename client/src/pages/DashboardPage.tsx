import { useEffect, useState } from 'react';
import { QrCode, Truck, PackagePlus, Printer, ReceiptIndianRupee, AlertTriangle, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useSync } from '../context/SyncContext';
import type { PageId } from '../components/Layout';

export function DashboardPage({ onNavigate }: { onNavigate: (p: PageId) => void }) {
  const { hasPerm } = useAuth();
  const { t } = useI18n();
  const { isOnline, pendingCount, conflictCount, snapshot } = useSync();
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    if (isOnline) {
      apiFetch('/dashboard').then(setData).catch(() => {});
    }
  }, [isOnline]);

  const fmtInr = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  const offlineBags = snapshot?.bags || [];
  const offlineLots = snapshot?.lots || [];

  const cards = [
    {
      label: t('dashboard.todayReceived'),
      value: data
        ? `${data.today_received_kg.toLocaleString('en-IN')} kg`
        : isOnline
          ? '0 kg'
          : `${offlineLots.length} lots (cached)`,
      color: 'border-l-[#1B4D3E]',
    },
    {
      label: t('dashboard.todaySealed'),
      value: data
        ? String(data.today_sealed_bags)
        : isOnline
          ? '0'
          : String(offlineBags.filter((b: any) => b.current_status === 'Sealed').length),
      color: 'border-l-emerald-600',
    },
    {
      label: t('dashboard.availableBags'),
      value: data
        ? String(data.available_bag_count)
        : isOnline
          ? '0'
          : String(offlineBags.filter((b: any) => ['Sealed', 'In Stock'].includes(b.current_status)).length),
      color: 'border-l-blue-600',
    },
    {
      label: t('dashboard.unsealedBags'),
      value: data
        ? String(data.unsealed_bag_count)
        : isOnline
          ? '0'
          : String(offlineBags.filter((b: any) => ['Generated', 'Printed'].includes(b.current_status)).length),
      color: 'border-l-[#D97706]',
    },
    {
      label: t('dashboard.pendingLots'),
      value: data
        ? String(data.pending_truck_lots)
        : isOnline
          ? '0'
          : String(offlineLots.filter((l: any) => l.status !== 'Completed').length),
      color: 'border-l-amber-600',
    },
    {
      label: t('dashboard.stockQtyValue'),
      value: data
        ? `${data.current_stock_kg.toLocaleString('en-IN')} kg${data.current_stock_value !== null ? ` • ${fmtInr(data.current_stock_value)}` : ''}`
        : isOnline
          ? '0 kg'
          : 'Cached offline',
      color: 'border-l-[#1B4D3E]',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Quick Mill Floor Actions */}
      <div className="card p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-stone-500 mb-3">
          {t('dashboard.quickActions')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {hasPerm('bags.scan') && (
            <button onClick={() => onNavigate('scanner')} className="btn-primary flex-col h-24 text-center">
              <QrCode className="w-7 h-7" />
              <span className="text-sm">{t('nav.scanner')}</span>
            </button>
          )}
          {hasPerm('lots.manage') && (
            <button onClick={() => onNavigate('lots')} className="btn-secondary flex-col h-24 text-center">
              <Truck className="w-7 h-7 text-[#1B4D3E]" />
              <span className="text-sm">{t('nav.lots')}</span>
            </button>
          )}
          {hasPerm('bags.create') && (
            <button onClick={() => onNavigate('bags')} className="btn-secondary flex-col h-24 text-center">
              <PackagePlus className="w-7 h-7 text-[#1B4D3E]" />
              <span className="text-sm">{t('nav.bags')}</span>
            </button>
          )}
          {hasPerm('bags.print') && (
            <button onClick={() => onNavigate('printLabels')} className="btn-secondary flex-col h-24 text-center">
              <Printer className="w-7 h-7 text-[#1B4D3E]" />
              <span className="text-sm">{t('nav.printLabels')}</span>
            </button>
          )}
          {hasPerm('sales.manage') && (
            <button onClick={() => onNavigate('commercial')} className="btn-secondary flex-col h-24 text-center">
              <ReceiptIndianRupee className="w-7 h-7 text-[#1B4D3E]" />
              <span className="text-sm">{t('nav.commercial')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Sync / Alerts Banner */}
      {(pendingCount > 0 || conflictCount > 0) && (
        <div className="bg-amber-50 border border-amber-400 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-amber-950">
            <RefreshCw className="w-5 h-5 text-[#D97706]" />
            <div>
              <div className="font-bold text-sm">
                {t('dashboard.unsyncedOps')}: {pendingCount} | Conflicts: {conflictCount}
              </div>
              <div className="text-xs">Changes will sync safely without duplicates once online.</div>
            </div>
          </div>
          <button onClick={() => onNavigate('sync')} className="btn-amber !min-h-[40px] !py-2 text-sm">
            Open Sync Center
          </button>
        </div>
      )}

      {/* Operations KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={`card p-4 border-l-4 ${c.color}`}>
            <div className="text-xs font-semibold text-stone-500 uppercase">{c.label}</div>
            <div className="text-2xl font-bold text-[#1F2937] mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Role-aware Financial KPIs */}
      {data?.financial && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-l-emerald-700">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.salesTodayMonth')}</div>
            <div className="text-xl font-bold mt-1">
              {fmtInr(data.financial.sales_today)} / {fmtInr(data.financial.sales_month)}
            </div>
          </div>
          <div className="card p-4 border-l-4 border-l-sky-700">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.purchasesTodayMonth')}</div>
            <div className="text-xl font-bold mt-1">
              {fmtInr(data.financial.purchases_today)} / {fmtInr(data.financial.purchases_month)}
            </div>
          </div>
          <div className="card p-4 border-l-4 border-l-amber-600">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.receivables')}</div>
            <div className="text-xl font-bold mt-1">{fmtInr(data.financial.receivables)}</div>
          </div>
          <div className="card p-4 border-l-4 border-l-rose-700">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.payables')}</div>
            <div className="text-xl font-bold mt-1">{fmtInr(data.financial.payables)}</div>
          </div>
          <div className="card p-4 border-l-4 border-l-[#1B4D3E]">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.cashBank')}</div>
            <div className="text-xl font-bold mt-1">
              {fmtInr(data.financial.cash_balance)} / {fmtInr(data.financial.bank_balance)}
            </div>
          </div>
          <div className="card p-4 border-l-4 border-l-stone-600">
            <div className="text-xs font-semibold text-stone-500 uppercase">{t('dashboard.expensesMonth')}</div>
            <div className="text-xl font-bold mt-1">{fmtInr(data.financial.expenses_month)}</div>
          </div>
        </div>
      )}

      {/* Low Stock Alerts & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-base flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-[#D97706]" />
            {t('dashboard.lowStockAlerts')}
          </h3>
          {!data?.low_stock_alerts?.length ? (
            <p className="text-sm text-stone-500">All products are above configured thresholds.</p>
          ) : (
            <div className="space-y-2">
              {data.low_stock_alerts.map((a: any) => (
                <div key={a.product_id + (a.warehouse_id || '')} className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex justify-between text-sm">
                  <span className="font-semibold">{a.product_name}</span>
                  <span className="font-bold text-amber-900">{a.qty_kg} kg (Min: {a.low_stock_threshold_kg} kg)</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-bold text-base mb-3">{t('dashboard.recentActivity')}</h3>
          {!data?.recent_activity?.length ? (
            <p className="text-sm text-stone-500">{t('common.noRecords')}</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {data.recent_activity.map((act: any) => (
                <div key={act.id} className="p-2.5 rounded-xl bg-[#FAF7F0] border border-stone-200 text-xs">
                  <div className="flex justify-between font-semibold">
                    <span className="text-[#1B4D3E]">{act.action}</span>
                    <span className="text-stone-500">{new Date(act.created_at).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="text-stone-700 mt-0.5">{act.summary}</div>
                  <div className="text-stone-500 mt-0.5">By: {act.user_name || act.user_id}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
