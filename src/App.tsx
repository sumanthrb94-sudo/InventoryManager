import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, signOut } from './lib/firebase';
import {
  PackagePlus, ShoppingCart, RefreshCw, BarChart2,
  LogOut, Plus, FileSpreadsheet, LayoutDashboard,
  TrendingUp, FileText, Users,
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
import { notificationService } from './lib/notificationService';
import { subscribeToSyncStatus } from './lib/dbService';
import { InventoryStoreProvider, useInventoryStore } from './lib/inventoryStore';
import DataSeedPage from './components/DataSeedPage';
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
  const [unreadCount, setUnreadCount]             = useState(0);
  const [syncConnected, setSyncConnected]         = useState(false);

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
    <div className="min-h-[100dvh] bg-[#FAFAFA] text-black flex flex-col md:flex-row">

      <AnimatePresence>{!loaded && <LoadingScreen />}</AnimatePresence>

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-64 border-r border-gray-200 flex-col pt-10 pb-6 bg-white z-30">
        <button onClick={() => setActiveTab('buy')}
          className="px-7 mb-12 text-left group hover:opacity-80 transition-all active:scale-95 origin-left">
          <h1 className="text-2xl font-bold tracking-tighter uppercase font-display leading-none text-black group-hover:text-emerald-600 transition-colors">
            {APP_NAME}
          </h1>
          <p className="text-[8px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1.5">{APP_TAGLINE}</p>
        </button>

        <nav className="flex-1 px-4 space-y-0.5">
          {NAV_TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all relative
                ${activeTab === t.id
                  ? 'text-black bg-gray-100 font-bold'
                  : 'text-gray-500 hover:text-black hover:bg-gray-50'}`}>
              {activeTab === t.id && (
                <motion.div layoutId="sidebar-indicator"
                  className="absolute left-0 w-1 h-5 bg-black rounded-r-full" />
              )}
              <span className={activeTab === t.id ? 'text-black' : 'text-gray-400'}>{t.icon}</span>
              <span className="text-[11px] font-bold uppercase tracking-widest">{t.label}</span>
            </button>
          ))}

          {/* Analytics sub-nav — visible only when analytics tab is active */}
          {activeTab === 'analytics' && (
            <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-gray-100 pl-4">
              {ANALYTICS_SUBS.map(s => (
                <button key={s.id} onClick={() => setAnalyticsSub(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all
                    ${analyticsSub === s.id
                      ? 'text-black bg-gray-100 font-bold'
                      : 'text-gray-400 hover:text-black hover:bg-gray-50'}`}>
                  {s.icon}
                  <span className="text-[10px] font-bold uppercase tracking-widest">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="px-4 pt-6 border-t border-gray-100 space-y-3">
          <div className="px-4 py-3 flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl">
            {user.photoURL
              ? <img src={user.photoURL} alt="" className="w-8 h-8 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
              : <div className="w-8 h-8 rounded-xl bg-black flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black truncate">{user.displayName || 'User'}</p>
              <p className="text-[9px] text-gray-400 font-mono truncate mt-0.5">{user.email}</p>
            </div>
          </div>
          <button onClick={() => signOut()}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-black hover:bg-gray-100 transition-all rounded-xl">
            <LogOut size={13} strokeWidth={2.5} /> Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden pb-16 md:pb-0">
        {/* Header */}
        <header className="h-14 md:h-16 border-b border-gray-200 flex items-center px-4 md:px-8 bg-white/90 backdrop-blur-xl sticky top-0 z-20">
          {/* Mobile: app name */}
          <button onClick={() => setActiveTab('buy')}
            className="md:hidden text-left active:scale-95 transition-transform mr-auto">
            <h1 className="text-xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
          </button>
          {/* Desktop: current tab label */}
          <p className="hidden md:block text-[11px] font-bold uppercase tracking-widest text-gray-400">
            {NAV_TABS.find(t => t.id === activeTab)?.label}
            {activeTab === 'analytics' && ` · ${ANALYTICS_SUBS.find(s => s.id === analyticsSub)?.label}`}
          </p>

          <div className="flex items-center gap-2 ml-auto">
            {/* Sync indicator */}
            <div title={syncConnected ? 'Live sync' : 'Offline'} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${syncConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-amber-400'}`} />
              <span className="hidden md:inline text-[9px] font-mono uppercase tracking-widest text-gray-400">
                {syncConnected ? 'Live' : 'Offline'}
              </span>
            </div>
            <NotificationBell unreadCount={unreadCount} />
            {/* Mobile logout */}
            <button onClick={() => signOut()}
              className="md:hidden border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 p-2 rounded-xl transition-all">
              <LogOut size={14} strokeWidth={2.5} />
            </button>
            {/* Import Excel */}
            <button onClick={() => setIsImportModalOpen(true)}
              className="border border-gray-200 bg-white text-black px-3 md:px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 hover:bg-gray-50 transition-all">
              <FileSpreadsheet size={13} />
              <span className="hidden md:inline">Import</span>
            </button>
            {/* Add Delivery */}
            <button onClick={() => setIsBatchModalOpen(true)}
              className="bg-black text-white px-3 md:px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 hover:bg-gray-800 transition-all active:scale-95">
              <Plus size={14} strokeWidth={3} />
              <span className="hidden md:inline">Add Delivery</span>
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">

          {/* Mobile analytics sub-nav — shown inline when on analytics tab */}
          {activeTab === 'analytics' && (
            <div className="md:hidden flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
              {ANALYTICS_SUBS.map(s => (
                <button key={s.id} onClick={() => setAnalyticsSub(s.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex-shrink-0 transition-all border
                    ${analyticsSub === s.id
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
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

      {/* ── Mobile bottom nav (4 tabs) ── */}
      <nav className="md:hidden fixed bottom-0 w-full bg-white border-t border-gray-100 z-30 flex items-center justify-around px-2 py-1 safe-area-bottom">
        {NAV_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex flex-col items-center justify-center flex-1 py-2 gap-0.5 rounded-xl transition-all ${
              activeTab === t.id ? 'text-black' : 'text-gray-400'}`}>
            <div className={`p-1.5 rounded-xl transition-all ${activeTab === t.id ? 'bg-black text-white' : ''}`}>
              {t.icon}
            </div>
            <span className={`text-[9px] uppercase tracking-wide font-bold ${activeTab === t.id ? 'text-black' : 'text-gray-400'}`}>
              {t.label}
            </span>
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {isBatchModalOpen  && <NewBatchModal  onClose={() => setIsBatchModalOpen(false)} />}
        {isImportModalOpen && <ImportModal    onClose={() => setIsImportModalOpen(false)} />}
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
