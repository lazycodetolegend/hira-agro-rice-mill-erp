import React, { useState } from 'react';
import {
  LayoutDashboard,
  QrCode,
  Truck,
  Package,
  Printer,
  Factory,
  Boxes,
  ReceiptIndianRupee,
  BookOpenCheck,
  Database,
  RefreshCw,
  Settings,
  HelpCircle,
  LogOut,
  Menu,
  X,
  Search,
  Wifi,
  WifiOff,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { useSync } from '../context/SyncContext';
import { apiFetch } from '../api/client';
import type { Lang } from '../i18n';

export type PageId =
  | 'dashboard'
  | 'scanner'
  | 'lots'
  | 'bags'
  | 'printLabels'
  | 'production'
  | 'inventory'
  | 'commercial'
  | 'accounting'
  | 'masters'
  | 'sync'
  | 'security'
  | 'settings'
  | 'docs';

interface Props {
  activePage: PageId;
  onNavigate: (page: PageId, context?: any) => void;
  children: React.ReactNode;
}

export function Layout({ activePage, onNavigate, children }: Props) {
  const { user, business, logout, hasPerm } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { isOnline, isSyncing, pendingCount, conflictCount, syncNow } = useSync();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any | null>(null);

  const allNavItems: Array<{ id: PageId; label: string; icon: any; show: boolean }> = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, show: true },
    { id: 'scanner', label: t('nav.scanner'), icon: QrCode, show: hasPerm('bags.scan') },
    { id: 'lots', label: t('nav.lots'), icon: Truck, show: hasPerm('lots.view') },
    { id: 'bags', label: t('nav.bags'), icon: Package, show: hasPerm('bags.view') },
    { id: 'printLabels', label: t('nav.printLabels'), icon: Printer, show: hasPerm('bags.print') },
    { id: 'production', label: t('nav.production'), icon: Factory, show: hasPerm('production.view') },
    { id: 'inventory', label: t('nav.inventory'), icon: Boxes, show: hasPerm('inventory.view') },
    {
      id: 'commercial',
      label: t('nav.commercial'),
      icon: ReceiptIndianRupee,
      show: hasPerm('purchases.view') || hasPerm('sales.view') || hasPerm('expenses.view') || hasPerm('payments.view'),
    },
    {
      id: 'accounting',
      label: t('nav.accounting'),
      icon: BookOpenCheck,
      show: hasPerm('accounting.view') || hasPerm('reports.financial.view'),
    },
    { id: 'masters', label: t('nav.masters'), icon: Database, show: hasPerm('masters.view') },
    { id: 'sync', label: t('nav.sync'), icon: RefreshCw, show: true },
    { id: 'security', label: 'Security & 2FA', icon: ShieldCheck, show: true },
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: Settings,
      show: hasPerm('business.manage') || hasPerm('users.manage') || hasPerm('audit.view'),
    },
    { id: 'docs', label: t('nav.docs'), icon: HelpCircle, show: true },
  ];
  const navItems = allNavItems.filter((i) => i.show);

  const handleSearch = async (val: string) => {
    setSearchQuery(val);
    if (val.trim().length < 2 || !navigator.onLine) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await apiFetch(`/search?q=${encodeURIComponent(val.trim())}`);
      setSearchResults(res);
    } catch {
      setSearchResults(null);
    }
  };

  const renderNavLinks = (isMobile = false) => (
    <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = activePage === item.id;
        return (
          <button
            key={item.id}
            onClick={() => {
              onNavigate(item.id);
              if (isMobile) setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-left font-medium transition min-h-[46px] ${
              active
                ? 'bg-[#1B4D3E] text-white shadow-sm'
                : 'text-[#1F2937] hover:bg-stone-200/70'
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-sm">{item.label}</span>
            </span>
            {item.id === 'sync' && (pendingCount > 0 || conflictCount > 0) && (
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-[#D97706] text-white">
                {pendingCount + conflictCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAF7F0]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-stone-200 no-print">
        <div className="p-4 border-b border-stone-200 bg-[#1B4D3E] text-white">
          <div className="font-bold text-lg leading-tight">{business?.name || t('appTitle')}</div>
          <div className="text-xs text-emerald-100 mt-0.5">{t('appSubtitle')}</div>
        </div>
        {renderNavLinks(false)}
        <div className="p-3 border-t border-stone-200 space-y-2">
          <div className="px-2 text-xs text-stone-600">
            <div className="font-semibold text-[#1F2937]">{user?.fullName}</div>
            <div>{user?.roleName}</div>
          </div>
          <button onClick={logout} className="btn-secondary w-full !min-h-[40px] !py-2 text-sm text-red-700">
            <LogOut className="w-4 h-4" /> {t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-white h-full flex flex-col z-10">
            <div className="p-4 bg-[#1B4D3E] text-white flex items-center justify-between">
              <div>
                <div className="font-bold text-base">{business?.name || t('appTitle')}</div>
                <div className="text-xs text-emerald-100">{user?.fullName} ({user?.roleName})</div>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="p-1.5 rounded-lg bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNavLinks(true)}
            <div className="p-3 border-t border-stone-200">
              <button onClick={logout} className="btn-secondary w-full text-red-700">
                <LogOut className="w-4 h-4" /> {t('nav.logout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen pb-20 lg:pb-6">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200 px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
            <div className="relative w-48 sm:w-72 md:w-80">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={t('common.search')}
                className="w-full pl-9 pr-3 py-2 bg-[#FAF7F0] border border-stone-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
              />
              {searchResults && (
                <div className="absolute left-0 right-0 mt-1 bg-white border border-stone-300 rounded-xl shadow-xl max-h-80 overflow-y-auto z-50 p-2 text-xs space-y-2">
                  <div className="flex justify-between items-center px-1 text-stone-500">
                    <span>Search Results</span>
                    <button onClick={() => setSearchResults(null)} className="text-red-600 font-semibold">
                      Close
                    </button>
                  </div>
                  {searchResults.bags?.map((b: any) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setSearchResults(null);
                        onNavigate('bags', { bagId: b.id });
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-stone-100 flex justify-between"
                    >
                      <span className="font-semibold">Bag {b.bag_number} ({b.product_name})</span>
                      <span>{b.net_weight_kg} kg • {b.current_status}</span>
                    </button>
                  ))}
                  {searchResults.lots?.map((l: any) => (
                    <button
                      key={l.id}
                      onClick={() => {
                        setSearchResults(null);
                        onNavigate('lots', { lotId: l.id });
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-stone-100 flex justify-between"
                    >
                      <span className="font-semibold">Lot {l.lot_number} • Truck {l.truck_number}</span>
                      <span>{l.received_qty_kg} kg</span>
                    </button>
                  ))}
                  {searchResults.sales?.map((s: any) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSearchResults(null);
                        onNavigate('commercial');
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-stone-100 flex justify-between"
                    >
                      <span className="font-semibold">Sale {s.doc_number}</span>
                      <span>₹{s.total_amount}</span>
                    </button>
                  ))}
                  {searchResults.purchases?.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSearchResults(null);
                        onNavigate('commercial');
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-stone-100 flex justify-between"
                    >
                      <span className="font-semibold">Purchase {p.doc_number}</span>
                      <span>₹{p.total_amount}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Sync / Online Pill */}
            <button
              onClick={() => (pendingCount > 0 ? syncNow() : onNavigate('sync'))}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border ${
                !isOnline
                  ? 'bg-amber-100 text-amber-900 border-amber-400'
                  : pendingCount > 0 || conflictCount > 0
                    ? 'bg-amber-50 text-amber-900 border-amber-300'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-300'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isOnline ? t('common.online') : t('common.offline')}</span>
              {pendingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-[#D97706] text-white rounded-full">
                  {isSyncing ? '...' : `${pendingCount} ${t('common.pending')}`}
                </span>
              )}
              {conflictCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-red-600 text-white rounded-full">
                  {conflictCount}!
                </span>
              )}
            </button>

            {/* Language Selector */}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              aria-label={t('language')}
              className="bg-white border border-stone-300 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#1B4D3E]"
            >
              <option value="en">EN</option>
              <option value="hi">हिंदी</option>
              <option value="mr">मराठी</option>
            </select>
          </div>
        </header>

        <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>

      {/* Mobile Bottom Quick Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-stone-200 grid grid-cols-4 h-16 no-print">
        <button
          onClick={() => onNavigate('dashboard')}
          className={`flex flex-col items-center justify-center text-xs font-semibold ${
            activePage === 'dashboard' ? 'text-[#1B4D3E]' : 'text-stone-500'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>{t('nav.dashboard')}</span>
        </button>
        <button
          onClick={() => onNavigate('scanner')}
          className={`flex flex-col items-center justify-center text-xs font-semibold ${
            activePage === 'scanner' ? 'text-[#1B4D3E]' : 'text-stone-500'
          }`}
        >
          <QrCode className="w-5 h-5" />
          <span>{t('nav.scanner')}</span>
        </button>
        <button
          onClick={() => onNavigate('lots')}
          className={`flex flex-col items-center justify-center text-xs font-semibold ${
            activePage === 'lots' ? 'text-[#1B4D3E]' : 'text-stone-500'
          }`}
        >
          <Truck className="w-5 h-5" />
          <span>{t('nav.lots')}</span>
        </button>
        <button
          onClick={() => onNavigate('bags')}
          className={`flex flex-col items-center justify-center text-xs font-semibold ${
            activePage === 'bags' ? 'text-[#1B4D3E]' : 'text-stone-500'
          }`}
        >
          <Package className="w-5 h-5" />
          <span>{t('nav.bags')}</span>
        </button>
      </nav>
    </div>
  );
}
