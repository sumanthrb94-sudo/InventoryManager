/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { adminAuth, ADMIN_EMAIL } from './lib/adminAuth';
import {
  LayoutDashboard, Smartphone, Truck, Bell,
  LogOut, Plus, FileSpreadsheet,
  Eye, EyeOff, Lock, Mail, ShieldCheck,
  ScanLine, CalendarDays,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard, { NavAction } from './components/Dashboard';
import Inventory from './components/Inventory';
import Suppliers from './components/Suppliers';
import Sales from './components/Sales';
import ScanPage from './components/ScanPage';
import CalendarPage from './components/CalendarPage';
import NewBatchModal from './components/NewBatchModal';
import ImportModal from './components/ImportModal';
import { useRealTimeNotifications } from './hooks/useRealTimeNotifications';
import NotificationToast from './components/NotificationToast';
import { notificationService } from './lib/notificationService';

type Tab = 'dashboard' | 'inventory' | 'suppliers' | 'sales' | 'scan' | 'calendar';

interface InventoryFilters { status?: string; search?: string; supplierId?: string; }

const APP_NAME = 'MOBILEPHONEMARKET';
const APP_TAGLINE = 'Inventory Manager';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState<Tab>('dashboard');
  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({});
  const [isBatchModalOpen,  setIsBatchModalOpen]  = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // ── Listen for inventory changes ──
  useRealTimeNotifications();

  // ── Listen for notification count updates ──
  useEffect(() => {
    const unsub = notificationService.subscribe(() => {
      setUnreadCount(notificationService.getUnreadCount());
    });
    return unsub;
  }, []);

  const handleNavigate = (action: NavAction) => {
    setActiveTab(action.tab);
    if (action.tab === 'sales') {
      notificationService.markAllAsRead();
    }
    if (action.tab === 'inventory' && action.filters) {
      setInventoryFilters({
        status:     action.filters.status,
        search:     action.filters.search || action.filters.model,
        supplierId: action.filters.supplierId,
      });
    } else if (action.tab === 'inventory') {
      setInventoryFilters({});
    }
  };

  const openInventory = () => {
    setInventoryFilters({});
    setActiveTab('inventory');
  };

  // ── Restore session on boot ────────────────────────────────────────────────
  useEffect(() => {
    setIsLoggedIn(adminAuth.hasSession());
    setLoading(false);
  }, []);

  const handleLogout = () => {
    adminAuth.clearSession();
    setIsLoggedIn(false);
  };

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

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />;
  }

  // ── Main app shell ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] bg-[#FAFAFA] text-black flex flex-col md:flex-row">

      {/* Desktop Sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-72 border-r border-gray-200 flex-col pt-10 pb-6 bg-gray-50 z-30">
        <button 
          onClick={() => setActiveTab('dashboard')}
          className="px-8 mb-16 text-left group hover:opacity-80 transition-all active:scale-95 origin-left"
        >
          <h1 className="text-3xl font-bold tracking-tighter uppercase font-display leading-none text-black group-hover:text-emerald-600 transition-colors">{APP_NAME}</h1>
          <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE}</p>
        </button>

        <nav className="flex-1 px-4 space-y-2">
          <NavItem id="dashboard" label="Dashboard"    icon={<LayoutDashboard size={18} />} active={activeTab === 'dashboard'}  onClick={() => setActiveTab('dashboard')} />
          <NavItem id="inventory" label="Inventory"    icon={<Smartphone size={18} />}      active={activeTab === 'inventory'}  onClick={openInventory} />
          <NavItem id="scan"      label="Scan & Update" icon={<ScanLine size={18} />}       active={activeTab === 'scan'}       onClick={() => setActiveTab('scan')} />
          <NavItem id="calendar" label="Calendar"     icon={<CalendarDays size={18} />}    active={activeTab === 'calendar'}   onClick={() => setActiveTab('calendar')} />
          <NavItem id="suppliers" label="Suppliers"    icon={<Truck size={18} />}           active={activeTab === 'suppliers'}  onClick={() => setActiveTab('suppliers')} />
          <NavItem 
            id="sales"     
            label="Daily Update" 
            icon={
              <div className="relative">
                <Bell size={18} />
                {unreadCount > 0 && (
                  <motion.span 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold flex items-center justify-center rounded-full border border-white"
                  >
                    {unreadCount}
                  </motion.span>
                )}
              </div>
            }            
            active={activeTab === 'sales'}      
            onClick={() => {
              setActiveTab('sales');
              notificationService.markAllAsRead();
            }} 
          />
        </nav>

        {/* Admin badge + logout */}
        <div className="px-4 pt-6 border-t border-gray-200 space-y-3">
          <div className="px-4 py-4 flex items-center gap-3 bg-white border border-gray-200 shadow-sm rounded-xl">
            <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black">Admin</p>
              <p className="text-[9px] text-gray-400 font-mono truncate mt-0.5">{ADMIN_EMAIL}</p>
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
        {/* Header */}
        <header className="h-16 md:h-20 border-b border-gray-200 flex flex-col justify-center px-4 md:px-10 bg-white/80 backdrop-blur-xl sticky top-0 z-20">
          <div className="flex items-center justify-between gap-4">
            {/* Mobile logo */}
            <button 
              onClick={() => setActiveTab('dashboard')}
              className="md:hidden text-left active:scale-95 transition-transform"
            >
              <h1 className="text-2xl font-bold tracking-tighter uppercase font-display text-black">{APP_NAME}</h1>
            </button>

            {/* Actions */}
            <div className="flex items-center gap-2 md:gap-3 ml-auto">
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
                <span className="hidden md:inline">Ingest Batch</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <Dashboard onNavigate={handleNavigate} />}
              {activeTab === 'inventory' && <Inventory initialFilters={inventoryFilters} />}
              {activeTab === 'scan'      && <ScanPage />}
              {activeTab === 'calendar' && <CalendarPage />}
              {activeTab === 'suppliers' && <Suppliers />}
              {activeTab === 'sales'     && <Sales />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 w-full bg-white border-t border-gray-200 z-30 flex items-center justify-around px-2 py-2 safe-area-bottom">
        <MobileNavItem id="dashboard" icon={<LayoutDashboard size={20} />} label="Dash"     active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
        <MobileNavItem id="inventory" icon={<Smartphone size={20} />}      label="Stock"    active={activeTab === 'inventory'} onClick={openInventory} />
        <MobileNavItem id="scan"      icon={<ScanLine size={22} />}         label="Scan"     active={activeTab === 'scan'}      onClick={() => setActiveTab('scan')} />
        <MobileNavItem id="calendar" icon={<CalendarDays size={20} />}    label="Calendar" active={activeTab === 'calendar'}  onClick={() => setActiveTab('calendar')} />
        <MobileNavItem 
          id="sales"     
          icon={
            <div className="relative">
              <Bell size={20} />
              {unreadCount > 0 && (
                <motion.span 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[8px] font-bold flex items-center justify-center rounded-full border border-white"
                >
                  {unreadCount}
                </motion.span>
              )}
            </div>
          }            
          label="Update"   
          active={activeTab === 'sales'}     
          onClick={() => {
            setActiveTab('sales');
            notificationService.markAllAsRead();
          }} 
        />
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
function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [showPass,  setShowPass]  = useState(false);
  const [error,     setError]     = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    // Small artificial delay so it feels like a real auth call
    await new Promise(r => setTimeout(r, 600));
    if (adminAuth.check(email.trim(), password.trim())) {
      adminAuth.saveSession();
      onLogin();
    } else {
      setError('Invalid email or password. Please try again.');
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-[100dvh] bg-white flex">
      {/* Left brand panel — desktop only */}
      <div className="hidden lg:flex w-1/2 bg-black flex-col justify-between p-16">
        <div>
          <h1 className="text-5xl font-bold tracking-tighter uppercase text-white font-display">{APP_NAME}</h1>
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">{APP_TAGLINE} · Admin Portal</p>
        </div>
        <div className="space-y-8">
          {[
            { label: 'Real-time Stock Tracking',  desc: 'IMEI-level visibility for every unit' },
            { label: 'Daily Sales Briefing',       desc: 'eBay / Amazon / OnBuy / Backmarket qty sync' },
            { label: 'Excel Import',               desc: 'One-click migration from OG STOCK DATA sheet' },
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

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm space-y-8"
        >
          {/* Mobile logo */}
          <div className="lg:hidden text-center">
            <h1 className="text-4xl font-bold tracking-tighter uppercase font-display">{APP_NAME}</h1>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">{APP_TAGLINE}</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold tracking-tight">Admin Sign In</h2>
            <p className="text-sm text-gray-500 mt-1">Enter your credentials to access the dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                 type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@nexusinventory.com"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-4 text-sm text-black placeholder-gray-300 focus:outline-none focus:border-black focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 font-mono">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-10 pr-12 text-sm text-black placeholder-gray-300 focus:outline-none focus:border-black focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black"
                >
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* Error */}
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

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-black text-white py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                <>
                  <ShieldCheck size={16} />
                  Sign In to {APP_NAME}
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl">
            <Lock size={12} className="text-gray-400 flex-shrink-0" />
            <p className="text-[9px] text-gray-400 font-mono leading-relaxed uppercase tracking-wide">
              Admin-only access. Contact your system admin if you need credentials.
            </p>
          </div>
          {/* Credentials hint */}
          <div className="p-4 bg-gray-950 rounded-xl space-y-1.5">
            <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest">Access Info</p>
            <p className="text-[10px] text-gray-300 font-mono leading-relaxed">
              Use the email &amp; password set in your Vercel environment variables
              (<span className="text-white">VITE_ADMIN_EMAIL</span> / <span className="text-white">VITE_ADMIN_PASSWORD</span>).
            </p>
            <p className="text-[9px] text-gray-600 font-mono">Each device logs in independently · session saved per browser.</p>
          </div>
        </motion.div>
      </div>
    </div>
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
