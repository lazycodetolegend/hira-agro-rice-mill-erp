import { useState } from 'react';
import { I18nProvider } from './context/I18nContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SyncProvider } from './context/SyncContext';
import { Layout, type PageId } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ScannerPage } from './pages/ScannerPage';
import { LotsPage } from './pages/LotsPage';
import { BagsPage } from './pages/BagsPage';
import { PrintLabelsPage } from './pages/PrintLabelsPage';
import { ProductionPage } from './pages/ProductionPage';
import { InventoryPage } from './pages/InventoryPage';
import { CommercialPage } from './pages/CommercialPage';
import { AccountingPage } from './pages/AccountingPage';
import { MastersPage } from './pages/MastersPage';
import { SyncConflictsPage } from './pages/SyncConflictsPage';
import { SecurityPage } from './pages/SecurityPage';
import { SettingsAdminPage } from './pages/SettingsAdminPage';
import { HelpDocsPage } from './pages/HelpDocsPage';

function AppShell() {
  const { user, loading } = useAuth();
  const [page, setPage] = useState<PageId>('dashboard');
  const [lotForBagCreate, setLotForBagCreate] = useState<any | null>(null);
  const [bagsToPrint, setBagsToPrint] = useState<any[] | undefined>(undefined);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF7F0] flex items-center justify-center font-bold text-[#1B4D3E]">
        Loading Rice Mill ERP...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const navigate = (next: PageId, _ctx?: any) => {
    if (next !== 'bags') setLotForBagCreate(null);
    if (next !== 'printLabels') setBagsToPrint(undefined);
    setPage(next);
  };

  return (
    <Layout activePage={page} onNavigate={navigate}>
      {page === 'dashboard' && <DashboardPage onNavigate={navigate} />}
      {page === 'scanner' && <ScannerPage />}
      {page === 'lots' && (
        <LotsPage
          onCreateBagsForLot={(lot) => {
            setLotForBagCreate(lot);
            setPage('bags');
          }}
        />
      )}
      {page === 'bags' && (
        <BagsPage
          initialLot={lotForBagCreate}
          onPrintBags={(bags) => {
            setBagsToPrint(bags);
            setPage('printLabels');
          }}
        />
      )}
      {page === 'printLabels' && <PrintLabelsPage preselectedBags={bagsToPrint} />}
      {page === 'production' && <ProductionPage />}
      {page === 'inventory' && <InventoryPage />}
      {page === 'commercial' && <CommercialPage />}
      {page === 'accounting' && <AccountingPage />}
      {page === 'masters' && <MastersPage />}
      {page === 'sync' && <SyncConflictsPage />}
      {page === 'security' && <SecurityPage />}
      {page === 'settings' && <SettingsAdminPage />}
      {page === 'docs' && <HelpDocsPage />}
    </Layout>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <SyncProvider>
          <AppShell />
        </SyncProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
