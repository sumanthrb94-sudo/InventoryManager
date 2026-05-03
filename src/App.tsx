/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, signOut } from './lib/firebase';
import {
  LayoutDashboard, PackagePlus, ShoppingCart,
  RefreshCw, BarChart2, Zap,
  LogOut, Plus, FileSpreadsheet,
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

type Tab = 'overview' | 'buystk' | 'sell' | 'returns' | 'reports' | 'suppliers' | 'analytics';

interface SeedProgress { loaded: number; total: number; }

const APP_NAME    = 'MOBILEPHONEMARKET';
const APP_TAGLINE = 'Inventory Manager';

export default function App() {
  const [user, setUser]           = useState<User | null>(null);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isBatchModalOpen,  setIsBatchModalOpen]  = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [seedProgress, setSeedProgress] = useState<SeedProgress | null>(null);

  useRealTimeNotifications();

  useEffect(() => {
    const unsub = notificationService.subscribe(() => {
      setUnreadCount(notificationService.getUnreadCount());
    });
    return unsub;
  }, []);

  // ── Firebase Auth state listener ──────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsub;
  }, []);

  // ── Seed default data once user is authenticated ──────────────────────────
  useEffect(() => {
    if (!user) return;
    import('./lib/seedData').then(({ seedDefaultInventoryData }) => {
      let seedStarted = false;
      seedDefaultInventoryData((loaded, total) => {
        if (!seedStarted) { seedStarted = true; setSeedProgress({ loaded, total }); }
        if (loaded >= total) {
          // Brief pause so final progress bar hits 100% visibly, then dismiss
          setTimeout(() => setSeedProgress(null), 600);
        } else {
          setSeedProgress({ loaded, total });
        }
      });
    });
  }, [user]);

  const handleNavigate = (action: NavAction) => {
    if (action.tab === 'inventory') setActiveTab('overview');
    else if (action.tab === 'suppliers') setActiveTab('suppliers');
    else setActiveTab(action.tab as Tab);
  };

  const handleLogout = () => signOut();

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-black border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  // ── Main app shell ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-[#FAFAFA] text-black flex flex-col md:flex-row">

      {/* ── Seed loading overlay ──────────────────────────────────────────── */}
      <AnimatePresence>
        {seedProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-white flex flex-col items-center justify-center gap-8"
          >
            <div className="text-center">
              <h1 className="text-3xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
              <p className="text-[9px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
            </div>
            <div className="w-72 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono">Loading inventory…</span>
                <span className="text-[10px] font-mono text-gray-400">
                  {Math.round(seedProgress.loaded / seedProgress.total * 100)}%
                </span>
              </div>
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-black rounded-full"
                  animate={{ width: `${Math.round(seedProgress.loaded / seedProgress.total * 100)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-[9px] font-mono text-gray-300 text-center">
                {seedProgress.loaded.toLocaleString()} / {seedProgress.total.toLocaleString()} units
              </p>
            </div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-gray-200 border-t-black rounded-full"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-72 border-r border-gray-200 flex-col pt-10 pb-6 bg-gray-50 z-30">
        <button
          onClick={() => setActiveTab('overview')}
          className="px-8 mb-16 text-left group hover:opacity-80 transition-all active:scale-95 origin-left"
        >
          <h1 className="text-3xl font-bold tracking-tighter uppercase font-display leading-none text-black group-hover:text-emerald-600 transition-colors">{APP_NAME}</h1>
          <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE}</p>
        </button>

        <nav className="flex-1 px-4 space-y-1">
          <NavItem id="overview"   label="Overview"  icon={<LayoutDashboard size={18}/>} active={activeTab==='overview'}   onClick={()=>setActiveTab('overview')} />
          <NavItem id="buystk"    label="Buy Stock"  icon={<PackagePlus size={18}/>}     active={activeTab==='buystk'}    onClick={()=>setActiveTab('buystk')} />
          <NavItem id="sell"      label="Sell"        icon={<ShoppingCart size={18}/>}    active={activeTab==='sell'}      onClick={()=>setActiveTab('sell')} />
          <NavItem id="returns"   label="Returns"     icon={<RefreshCw size={18}/>}       active={activeTab==='returns'}   onClick={()=>setActiveTab('returns')} />
          <NavItem id="analytics" label="Insights"   icon={<Zap size={18}/>}             active={activeTab==='analytics'} onClick={()=>setActiveTab('analytics')} />
          <NavItem id="reports"   label="Reports"     icon={<BarChart2 size={18}/>}       active={activeTab==='reports'}   onClick={()=>setActiveTab('reports')} />
        </nav>

        {/* User identity + logout */}
        <div className="px-4 pt-6 border-t border-gray-200 space-y-3">
          <div className="px-4 py-4 flex items-center gap-3 bg-white border border-gray-200 shadow-sm rounded-xl">
            {user.photoURL ? (
              <img src={user.photoURL} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
                {(user.displayName || user.email || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black truncate">
                {user.displayName || 'User'}
              </p>
              <p className="text-[9px] text-gray-400 font-mono truncate mt-0.5">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-black hover:bg-gray-200 transition-all rounded-xl"
          >
            <LogOut size={13} strokeWidth={2.5} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col h-[100dvh] overflow-hidden bg-transparent pb-16 md:pb-0">
        <header className="h-16 md:h-20 border-b border-gray-200 flex flex-col justify-center px-4 md:px-10 bg-white/80 backdrop-blur-xl sticky top-0 z-20">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className="md:hidden text-left active:scale-95 transition-transform"
            >
              <h1 className="text-2xl font-bold tracking-tighter uppercase font-display text-black">{APP_NAME}</h1>
            </button>
            <div className="flex items-center gap-2 md:gap-3 ml-auto">
              <NotificationBell unreadCount={unreadCount} />
              <button
                onClick={handleLogout}
                className="md:hidden border border-gray-200 text-red-500 hover:bg-red-50 px-3 py-2 md:py-2.5 rounded-xl transition-all"
                title="Sign Out"
              >
                <LogOut size={14} strokeWidth={2.5} />
              </button>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="border border-gray-200 bg-white text-black px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-gray-50 transition-all"
              >
                <FileSpreadsheet size={14} />
                <span className="hidden md:inline">Import Excel</span>
              </button>
              <button
                onClick={() => setIsBatchModalOpen(true)}
                className="bg-black text-white px-3 md:px-8 py-2 md:py-2.5 rounded-xl text-[10px] md:text-xs font-bold uppercase tracking-widest flex items-center gap-2 md:gap-3 hover:bg-gray-800 transition-all active:scale-95"
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden md:inline">Add Supplier Delivery</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'overview'   && <Dashboard onNavigate={handleNavigate} />}
              {activeTab === 'buystk'    && <StockInPage onOpenBatch={()=>setIsBatchModalOpen(true)} onOpenImport={()=>setIsImportModalOpen(true)} />}
              {activeTab === 'sell'      && <SellPage />}
              {activeTab === 'returns'   && <ReturnsPage />}
              {activeTab === 'analytics' && <AnalyticsPage />}
              {activeTab === 'reports'   && <ReportingPage />}
              {activeTab === 'suppliers' && (
                <div>
                  <button
                    onClick={() => setActiveTab('overview')}
                    className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors mb-5"
                  >
                    ← Back to Overview
                  </button>
                  <Suppliers />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 w-full bg-white border-t border-gray-200 z-30 flex items-center justify-around px-1 py-2 safe-area-bottom">
        <MobileNavItem id="overview"   icon={<LayoutDashboard size={20}/>} label="Overview" active={activeTab==='overview'}   onClick={()=>setActiveTab('overview')} />
        <MobileNavItem id="buystk"     icon={<PackagePlus size={20}/>}     label="Buy"      active={activeTab==='buystk'}    onClick={()=>setActiveTab('buystk')} />
        <MobileNavItem id="sell"       icon={<ShoppingCart size={20}/>}    label="Sell"     active={activeTab==='sell'}      onClick={()=>setActiveTab('sell')} />
        <MobileNavItem id="returns"    icon={<RefreshCw size={20}/>}       label="Returns"  active={activeTab==='returns'}   onClick={()=>setActiveTab('returns')} />
        <MobileNavItem id="analytics"  icon={<Zap size={20}/>}             label="Insights" active={activeTab==='analytics'} onClick={()=>setActiveTab('analytics')} />
      </nav>

      <AnimatePresence>
        {isBatchModalOpen  && <NewBatchModal onClose={() => setIsBatchModalOpen(false)} />}
        {isImportModalOpen && <ImportModal   onClose={() => setIsImportModalOpen(false)} />}
      </AnimatePresence>

      <NotificationToast />
    </div>
  );
}

// ── Login Page ─────────────────────────────────────────────────────────────────
function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      // onAuthStateChanged in App will set the user — no manual state needed here
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user' && err?.code !== 'auth/cancelled-popup-request') {
        setError('Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-1/2 bg-black flex-col justify-between p-16">
        <div>
          <h1 className="text-5xl font-bold tracking-tighter uppercase text-white font-display">{APP_NAME}</h1>
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE} · Admin Portal</p>
        </div>
        <div className="space-y-8">
          {[
            { label: 'Real-time Stock Tracking',   desc: 'IMEI-level visibility for every unit' },
            { label: 'Live Multi-device Sync',      desc: 'Any change by anyone is instant everywhere' },
            { label: 'Excel Import',                desc: 'One-click migration from your stock sheet' },
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
        <p className="text-[9px] text-gray-600 font-mono uppercase tracking-widest">Admin access only · MOBILEPHONEMARKET Inventory Manager</p>
      </div>

      {/* Right sign-in panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-8"
        >
          <div className="lg:hidden text-center">
            <h1 className="text-4xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">Sign In</h2>
            <p className="text-sm text-gray-500 mt-1">Use your Google account to access the dashboard</p>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs text-red-600 font-mono bg-red-50 border border-red-100 px-4 py-2.5 rounded-xl"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 rounded-xl py-3.5 px-6 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all active:scale-[0.98] disabled:opacity-50 shadow-sm"
          >
            {loading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full"
              />
            ) : (
              <GoogleIcon />
            )}
            {loading ? 'Signing in…' : 'Continue with Google'}
          </button>

          <p className="text-[9px] text-gray-400 font-mono text-center uppercase tracking-wide leading-relaxed">
            Internal tool · MOBILEPHONEMARKET staff only
          </p>
        </motion.div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
      <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
      <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
      <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
    </svg>
  );
}

// ── NavItem ────────────────────────────────────────────────────────────────────
function NavItem({ id, label, icon, active, onClick }: {
  id: string; label: string; icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm transition-all relative
        ${active
          ? 'text-black bg-white shadow-sm border border-gray-200'
          : 'text-gray-500 hover:text-black hover:bg-gray-100 border border-transparent'}
      `}
    >
      <span>{icon}</span>
      <span className={`font-bold uppercase tracking-widest text-[11px] ${active ? 'opacity-100' : 'opacity-60'}`}>
        {label}
      </span>
      {active && (
        <motion.div
          layoutId="active-nav-indicator"
          className="absolute left-0 w-1 h-6 bg-black rounded-r-full"
        />
      )}
    </button>
  );
}

// ── MobileNavItem ──────────────────────────────────────────────────────────────
function MobileNavItem({ icon, label, active, onClick }: {
  id: string; icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center w-16 py-1.5 gap-1 rounded-xl transition-all ${
        active ? 'text-black' : 'text-gray-400'
      }`}
    >
      <div className={`p-1.5 rounded-full transition-all ${active ? 'bg-black text-white' : 'bg-transparent'}`}>
        {icon}
      </div>
      <span className="text-[9px] uppercase tracking-wider font-mono">{label}</span>
    </button>
  );
}
