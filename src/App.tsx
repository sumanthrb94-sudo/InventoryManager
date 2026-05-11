import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, signOut } from './lib/firebase';
import {
  PackagePlus, ShoppingCart, RefreshCw, BarChart2,
  LogOut, Plus, FileSpreadsheet, LayoutDashboard,
  TrendingUp, FileText, Users, Settings, Database,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard, { NavAction } from './components/Dashboard';
import NewBatchModal from './components/NewBatchModal';
import ImportModal from './components/ImportModal';
import StockInPage from './components/StockInPage';
import SellPage from './components/SellPage';
import ReturnsPage from './components/ReturnsPage';
import ReportingPage from './components/ReportingPage';
import Suppliers from './components/Suppliers';
import AnalyticsPage from './components/AnalyticsPage';
import { useRealTimeNotifications } from './hooks/useRealTimeNotifications';
import NotificationToast from './components/NotificationToast';
import NotificationBell from './components/NotificationBell';
import StockTickerBoard from './components/StockTickerBoard';
import { notificationService } from './lib/notificationService';
import { subscribeToSyncStatus } from './lib/dbService';
import { InventoryStoreProvider, useInventoryStore } from './lib/inventoryStore';
import DataSeedPage from './components/DataSeedPage';
import LoadMockDataModal from './components/LoadMockDataModal';
import ErrorBoundary from './components/ErrorBoundary';

type Tab        = 'buy' | 'sell' | 'returns' | 'analytics';
type AnalyticsSub = 'overview' | 'insights' | 'reports' | 'suppliers';

const APP_NAME    = 'MOBILEPHONEMARKET';
const APP_TAGLINE = 'Inventory Manager';

export default function App() {
  if (new URLSearchParams(window.location.search).get('seed') === '1') return <DataSeedPage />;
  return <AppWithAuth />;
}

function AppWithAuth() {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); setLoading(false); }), []);

  if (loading) return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-8 h-8 border-2 border-black border-t-transparent rounded-full" />
    </div>
  );
  if (!user) return <LoginPage />;

  return (
    <ErrorBoundary>
      <InventoryStoreProvider>
        <AppShell user={user} />
      </InventoryStoreProvider>
    </ErrorBoundary>
  );
}

function LoadingScreen() {
  return (
    <motion.div initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[300] bg-white flex flex-col items-center justify-center gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
        <p className="text-[9px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-6 h-6 border-2 border-black border-t-transparent rounded-full" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">Loading inventory…</span>
      </div>
    </motion.div>
  );
}

const ANALYTICS_SUBS: { id: AnalyticsSub; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',  label: 'Overview',  icon: <LayoutDashboard size={14} /> },
  { id: 'insights',  label: 'Insights',  icon: <TrendingUp size={14} /> },
  { id: 'reports',   label: 'Reports',   icon: <FileText size={14} /> },
  { id: 'suppliers', label: 'Suppliers', icon: <Users size={14} /> },
];

function AppShell({ user }: { user: User }) {
  const { loaded }                                = useInventoryStore();
  const [activeTab, setActiveTab]                 = useState<Tab>('buy');
  const [analyticsSub, setAnalyticsSub]           = useState<AnalyticsSub>('overview');
  const [isBatchModalOpen, setIsBatchModalOpen]   = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isLoadMockDataOpen, setIsLoadMockDataOpen] = useState(false);
  const [unreadCount, setUnreadCount]             = useState(0);
  const [syncConnected, setSyncConnected]         = useState(false);
  const [isAlertsExpanded, setIsAlertsExpanded]   = useState(false);

  useRealTimeNotifications();
  useEffect(() => { notificationService.setUser(user.uid); }, [user.uid]);
  useEffect(() => notificationService.subscribe(() => setUnreadCount(notificationService.getUnreadCount())), []);
  useEffect(() => subscribeToSyncStatus(setSyncConnected), []);

  const handleNavigate = (action: NavAction) => {
    if (action.tab === 'inventory' || action.tab === 'sales') {
      setActiveTab('analytics');
      setAnalyticsSub('overview');
    } else if (action.tab === 'suppliers') {
      setActiveTab('analytics');
      setAnalyticsSub('suppliers');
    } else if (action.tab === 'calendar') {
      setActiveTab('analytics');
      setAnalyticsSub('insights');
    }
  };

  const NAV_TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'buy',       label: 'Buy',       icon: <PackagePlus size={20} /> },
    { id: 'sell',      label: 'Sell',      icon: <ShoppingCart size={20} /> },
    { id: 'returns',   label: 'Returns',   icon: <RefreshCw size={20} /> },
    { id: 'analytics', label: 'Analytics', icon: <BarChart2 size={20} /> },
  ];

  return (
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex overflow-hidden">

      <AnimatePresence>{!loaded && <LoadingScreen />}</AnimatePresence>

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-56 lg:w-64 flex-shrink-0 bg-white border-r border-slate-200 flex-col overflow-hidden">

        {/* Brand strip — same height as header */}
        <div className="h-16 flex-shrink-0 flex items-center px-5 border-b border-slate-100">
          <button onClick={() => setActiveTab('buy')} className="text-left group active:scale-95 transition-transform">
            <h1 className="text-[13px] font-black tracking-tighter uppercase font-display text-slate-900 leading-none">
              {APP_NAME}
            </h1>
            <p className="text-[7px] text-slate-400 font-mono uppercase tracking-[0.35em] mt-1">{APP_TAGLINE}</p>
          </button>
        </div>

        {/* Nav items */}
        <nav className="p-3 space-y-0.5">
          {NAV_TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all
                ${activeTab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}>
              <span className="flex-shrink-0">{t.icon}</span>
              <span className="text-[11px] font-bold uppercase tracking-widest">{t.label}</span>
            </button>
          ))}

          {activeTab === 'analytics' && (
            <div className="ml-3 mt-1 space-y-0.5 border-l-2 border-slate-100 pl-3">
              {ANALYTICS_SUBS.map(s => (
                <button key={s.id} onClick={() => setAnalyticsSub(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all
                    ${analyticsSub === s.id
                      ? 'text-slate-900 bg-slate-100 font-bold'
                      : 'text-slate-400 hover:text-slate-900 hover:bg-slate-50'}`}>
                  {s.icon}
                  <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Stock Alerts Section - Collapsible */}
        <div className="flex-shrink-0 border-t border-slate-100">
          <button
            onClick={() => setIsAlertsExpanded(!isAlertsExpanded)}
            className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-700">Stock Alerts</p>
            {(() => {
              const units = useInventoryStore().units;
              const seen = new Set<string>();
              let criticalCount = 0;

              const seriesStats: Record<string, { availableCount: number; returnedCount: number }> = {};
              const allSeries = new Set<string>();

              for (const u of units) {
                const series = u.model.split(' ').slice(0, 2).join(' ');
                allSeries.add(series);
                if (!seriesStats[series]) {
                  seriesStats[series] = { availableCount: 0, returnedCount: 0 };
                }
                if (u.status === 'available') {
                  seriesStats[series].availableCount++;
                } else if (u.status === 'returned') {
                  seriesStats[series].returnedCount++;
                }
              }

              for (const series of Array.from(allSeries)) {
                const stats = seriesStats[series];
                const totalUnitsInSeries = units.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;

                if (totalUnitsInSeries > 0 && stats.availableCount === 0) {
                  const alertId = `outofstock-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }

                if (stats.availableCount > 0 && stats.availableCount <= 2) {
                  const alertId = `lowstock-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }

                if (stats.returnedCount > 0) {
                  const alertId = `returned-${series}`;
                  if (!seen.has(alertId)) {
                    seen.add(alertId);
                    criticalCount++;
                  }
                }
              }

              return criticalCount > 0 ? (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold flex items-center justify-center border border-red-200">{criticalCount}</span>
              ) : null;
            })()}
          </button>

          {isAlertsExpanded && (
            <div className="max-h-64 overflow-y-auto border-t border-slate-100 px-2 py-2 space-y-0.5 bg-red-50/40">
              {useInventoryStore().units.length > 0 ? (
                (() => {
                  const units = useInventoryStore().units;
                  const seen = new Set<string>();
                  const alerts: Array<{ id: string; model: string; detail: string }> = [];

                  const seriesStats: Record<string, { availableCount: number; returnedCount: number }> = {};
                  const allSeries = new Set<string>();

                  for (const u of units) {
                    const series = u.model.split(' ').slice(0, 2).join(' ');
                    allSeries.add(series);
                    if (!seriesStats[series]) {
                      seriesStats[series] = { availableCount: 0, returnedCount: 0 };
                    }
                    if (u.status === 'available') {
                      seriesStats[series].availableCount++;
                    } else if (u.status === 'returned') {
                      seriesStats[series].returnedCount++;
                    }
                  }

                  for (const series of Array.from(allSeries).sort()) {
                    const stats = seriesStats[series];
                    const totalUnitsInSeries = units.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;

                    if (totalUnitsInSeries > 0 && stats.availableCount === 0) {
                      const alertId = `outofstock-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: 'Out of Stock' });
                      }
                    }

                    if (stats.availableCount > 0 && stats.availableCount <= 2) {
                      const alertId = `lowstock-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: `Only ${stats.availableCount} left` });
                      }
                    }

                    if (stats.returnedCount > 0) {
                      const alertId = `returned-${series}`;
                      if (!seen.has(alertId)) {
                        seen.add(alertId);
                        alerts.push({ id: alertId, model: series, detail: `${stats.returnedCount} returned` });
                      }
                    }
                  }

                  alerts.sort((a, b) => {
                    const orderA = a.detail.includes('Out of Stock') ? 0 : a.detail.includes('Only') ? 1 : 2;
                    const orderB = b.detail.includes('Out of Stock') ? 0 : b.detail.includes('Only') ? 1 : 2;
                    if (orderA !== orderB) return orderA - orderB;
                    return a.model.localeCompare(b.model);
                  });

                  return alerts.length > 0 ? alerts.map(alert => (
                    <div key={alert.id} className="px-2 py-1.5 border-l-2 border-red-300 bg-white/60 rounded-sm">
                      <p className="text-[11px] font-bold text-slate-900 truncate leading-tight">{alert.model}</p>
                      <p className="text-[10px] text-slate-700 mt-0.5 leading-tight">{alert.detail}</p>
                    </div>
                  )) : (
                    <p className="text-[10px] text-slate-500 text-center py-3">No critical alerts</p>
                  );
                })()
              ) : (
                <p className="text-[10px] text-slate-500 text-center py-3">No data</p>
              )}
            </div>
          )}
        </div>

        {/* User footer */}
        <div className="flex-shrink-0 p-3 border-t border-slate-100 space-y-1">
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50">
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="w-7 h-7 rounded-lg object-cover flex-shrink-0" referrerPolicy="no-referrer" />
              : <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-slate-900 truncate leading-none">{user.displayName || 'User'}</p>
              <p className="text-[9px] text-slate-400 font-mono truncate mt-0.5">{user.email}</p>
            </div>
          </div>
          <button onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all">
            <LogOut size={12} strokeWidth={2.5} /> Sign Out
          </button>
          <button onClick={() => setIsLoadMockDataOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">
            <Database size={12} strokeWidth={2} /> Sample Data
          </button>
        </div>
      </aside>

      {/* ── Right column (header + scrollable content) ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top header */}
        <header className="flex-shrink-0 h-14 md:h-16 bg-white border-b border-slate-200 flex items-center px-4 md:px-6 gap-3 z-20">

          {/* Mobile: brand */}
          <button onClick={() => setActiveTab('buy')} className="md:hidden mr-auto active:scale-95 transition-transform">
            <h1 className="text-base font-black tracking-tighter uppercase font-display text-slate-900 leading-none">{APP_NAME}</h1>
            <p className="text-[7px] text-slate-400 font-mono uppercase tracking-[0.35em] mt-0.5">{APP_TAGLINE}</p>
          </button>

          {/* Desktop: section breadcrumb */}
          <div className="hidden md:flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 truncate">
              {NAV_TABS.find(t => t.id === activeTab)?.label}
            </span>
            {activeTab === 'analytics' && (
              <>
                <span className="text-slate-300 flex-shrink-0">/</span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-600 truncate">
                  {ANALYTICS_SUBS.find(s => s.id === analyticsSub)?.label}
                </span>
              </>
            )}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <div className="flex items-center gap-1.5" title={syncConnected ? 'Live sync' : 'Offline'}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${syncConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              <span className="hidden md:inline text-[9px] font-mono uppercase tracking-widest text-slate-400">
                {syncConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            <NotificationBell unreadCount={unreadCount} />
            <button onClick={() => signOut()}
              className="md:hidden p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all">
              <LogOut size={14} strokeWidth={2.5} />
            </button>
            <button onClick={() => setIsLoadMockDataOpen(true)}
              title="Load mock data"
              className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all">
              <Settings size={14} strokeWidth={2.5} />
            </button>
            <button onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all">
              <FileSpreadsheet size={12} />
              <span className="hidden md:inline">Import</span>
            </button>
          </div>
        </header>

        {/* Stock Ticker Board */}
        <StockTickerBoard />

        {/* Scrollable page content */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-4 md:p-8 pb-24 md:pb-8">

            {/* Mobile analytics sub-nav */}
            {activeTab === 'analytics' && (
              <div className="md:hidden flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
                {ANALYTICS_SUBS.map(s => (
                  <button key={s.id} onClick={() => setAnalyticsSub(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex-shrink-0 transition-all border
                      ${analyticsSub === s.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                    {s.icon}{s.label}
                  </button>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={activeTab === 'analytics' ? `analytics-${analyticsSub}` : activeTab}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                {activeTab === 'buy'     && <StockInPage onOpenBatch={() => setIsBatchModalOpen(true)} onOpenImport={() => setIsImportModalOpen(true)} />}
                {activeTab === 'sell'    && <SellPage />}
                {activeTab === 'returns' && <ReturnsPage />}
                {activeTab === 'analytics' && analyticsSub === 'overview'  && <Dashboard onNavigate={handleNavigate} />}
                {activeTab === 'analytics' && analyticsSub === 'insights'  && <AnalyticsPage />}
                {activeTab === 'analytics' && analyticsSub === 'reports'   && <ReportingPage />}
                {activeTab === 'analytics' && analyticsSub === 'suppliers' && <Suppliers />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 safe-area-bottom flex items-stretch">
        {NAV_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-all
              ${activeTab === t.id ? 'text-slate-900' : 'text-slate-400'}`}>
            <div className={`p-1.5 rounded-xl transition-all ${activeTab === t.id ? 'bg-slate-900 text-white' : ''}`}>
              {t.icon}
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wide">{t.label}</span>
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {isBatchModalOpen  && <NewBatchModal  onClose={() => setIsBatchModalOpen(false)} />}
        {isImportModalOpen && <ImportModal    onClose={() => setIsImportModalOpen(false)} />}
        {isLoadMockDataOpen && <LoadMockDataModal onClose={() => setIsLoadMockDataOpen(false)} />}
      </AnimatePresence>
      <NotificationToast />
    </div>
  );
}


// ── Login Page ────────────────────────────────────────────────────────────────
function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        // user dismissed
      } else if (err?.code === 'auth/unauthorized-domain') {
        setError('Domain not authorised — add it in Firebase Auth → Authorised domains.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setError('Google sign-in is not enabled. Firebase Console → Authentication → Sign-in method → Google → Enable.');
      } else {
        setError(err?.message || 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white flex">
      <div className="hidden lg:flex w-1/2 bg-black flex-col justify-between p-16">
        <div>
          <h1 className="text-5xl font-bold tracking-tighter uppercase text-white font-display">{APP_NAME}</h1>
          <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE} · Admin Portal</p>
        </div>
        <div className="space-y-8">
          {[
            { label: 'Real-time Stock Tracking',  desc: 'IMEI-level visibility for every unit' },
            { label: 'Live Multi-device Sync',     desc: 'Any change is instant everywhere' },
            { label: 'Excel Import',               desc: 'One-click migration from your stock sheet' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-4">
              <div className="w-1 h-1 mt-2 bg-white rounded-full flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-white tracking-tight">{f.label}</p>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-gray-600 font-mono uppercase tracking-widest">Admin access only</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-8">
          <div className="lg:hidden text-center">
            <h1 className="text-4xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sign In</h2>
            <p className="text-sm text-gray-500 mt-1">Use your Google account to continue</p>
          </div>
          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="text-xs text-red-600 font-mono bg-red-50 border border-red-100 px-4 py-2.5 rounded-xl">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <button onClick={handleSignIn} disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-xl py-3.5 px-6 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm">
            {loading
              ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full" />
              : <GoogleIcon />}
            {loading ? 'Signing in…' : 'Continue with Google'}
          </button>
          <p className="text-[9px] text-gray-400 font-mono text-center uppercase tracking-wide">
            Internal tool · MOBILEPHONEMARKET staff only
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
      <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
      <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
      <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
    </svg>
  );
}
