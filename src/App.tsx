/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Smartphone,
  Truck,
  Bell,
  LogOut,
  Plus,
  Search,
  Package,
  FileSpreadsheet,
  ChevronRight,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Suppliers from './components/Suppliers';
import Sales from './components/Sales';
import NewBatchModal from './components/NewBatchModal';
import ImportModal from './components/ImportModal';

type Tab = 'dashboard' | 'inventory' | 'suppliers' | 'sales';

export default function App() {
  const [user, setUser] = useState<any>({ displayName: 'Admin User', email: 'admin@nexus.local', photoURL: '' });
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  useEffect(() => {
    // Auth fully bypassed. Using local storage DB.
    setLoading(false);
  }, []);

  const login = async () => {
    // Bypassed
  };

  const logout = () => {
    // Bypassed
    alert("Running in local mode. Logout disabled.");
  };

  // ── Loading spinner ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center space-y-6">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-2 border-black border-t-transparent rounded-full mx-auto"
          />
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.3em]">Initialising...</p>
        </div>
      </div>
    );
  }

  // ── Login screen ─────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen bg-white flex">
        {/* Left panel — branding */}
        <div className="hidden lg:flex w-1/2 bg-black flex-col justify-between p-16">
          <div>
            <h1 className="text-5xl font-bold tracking-tighter uppercase text-white font-display">Nexus</h1>
            <p className="text-[10px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">Inventory OS</p>
          </div>
          <div className="space-y-8">
            {[
              { label: 'Real-time Stock Tracking', desc: 'IMEI-level visibility across all units' },
              { label: 'Daily Sales Briefing', desc: 'Platform qty updates pushed to the team' },
              { label: 'Excel Import', desc: 'One-click migration from your existing sheets' },
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
          <p className="text-[9px] text-gray-700 font-mono uppercase tracking-widest">
            Secure · Firebase · Real-time
          </p>
        </div>

        {/* Right panel — login form */}
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm space-y-10"
          >
            {/* Mobile logo */}
            <div className="lg:hidden">
              <h1 className="text-4xl font-bold tracking-tighter uppercase font-display">Nexus</h1>
              <p className="text-[10px] text-gray-400 font-mono uppercase tracking-[0.4em] mt-1">Inventory OS</p>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
              <p className="text-sm text-gray-500">Access your inventory dashboard</p>
            </div>

            <div className="space-y-4">
              <button
                onClick={login}
                className="w-full flex items-center justify-center gap-4 bg-black text-white py-4 px-6 font-bold text-sm uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] group"
              >
                {/* Google icon */}
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue as Admin
                <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>

              {loginError && (
                <p className="text-xs text-red-600 font-mono text-center">{loginError}</p>
              )}
            </div>

            <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200">
              <Lock size={12} className="text-gray-400 flex-shrink-0" />
              <p className="text-[9px] text-gray-400 font-mono uppercase tracking-wider leading-relaxed">
                Access is restricted to authorised Google accounts only. Your data is stored securely in Firebase.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Main app shell ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FAFAFA] text-black flex">
      {/* Sidebar */}
      <aside className="w-72 border-r border-gray-200 flex flex-col pt-10 pb-6 bg-gray-50">
        <div className="px-8 mb-16">
          <h1 className="text-3xl font-bold tracking-tighter uppercase font-display leading-none text-black">Nexus</h1>
          <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.4em] mt-2">Inventory OS</p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <NavItem id="dashboard" label="Dashboard" icon={<LayoutDashboard size={18} />}
            active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem id="inventory" label="Inventory" icon={<Smartphone size={18} />}
            active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} />
          <NavItem id="suppliers" label="Suppliers" icon={<Truck size={18} />}
            active={activeTab === 'suppliers'} onClick={() => setActiveTab('suppliers')} />
          <NavItem id="sales" label="Daily Update" icon={<Bell size={18} />}
            active={activeTab === 'sales'} onClick={() => setActiveTab('sales')} />
        </nav>

        {/* User card + logout */}
        <div className="px-4 pt-6 border-t border-gray-200 space-y-3">
          <div className="px-4 py-4 flex items-center gap-3 bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100">
            <div className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50 flex-shrink-0">
              {user.photoURL
                ? <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                : <Package size={16} className="text-gray-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest truncate text-black">
                {user.displayName || 'Admin'}
              </p>
              <p className="text-[9px] text-gray-400 font-mono truncate mt-0.5">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-black hover:bg-gray-200 transition-all"
          >
            <LogOut size={13} strokeWidth={2.5} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-transparent">
        <header className="h-20 border-b border-gray-200 flex items-center justify-between px-10 bg-white/80 backdrop-blur-xl sticky top-0 z-20">
          <div className="flex items-center gap-6 flex-1">
            <div className="relative max-w-lg w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder="Search inventory..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 pl-11 pr-4 text-sm font-light text-black focus:outline-none focus:border-black focus:bg-white transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="border border-gray-200 text-black px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-gray-50 transition-all"
            >
              <FileSpreadsheet size={14} />
              Import Excel
            </button>
            <button
              onClick={() => setIsBatchModalOpen(true)}
              className="bg-black text-white px-8 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-3 hover:bg-gray-800 transition-all active:scale-95"
            >
              <Plus size={16} strokeWidth={3} />
              Ingest Batch
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'inventory' && <Inventory />}
              {activeTab === 'suppliers' && <Suppliers />}
              {activeTab === 'sales' && <Sales />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {isBatchModalOpen && <NewBatchModal onClose={() => setIsBatchModalOpen(false)} />}
        {isImportModalOpen && <ImportModal onClose={() => setIsImportModalOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ id, label, icon, active, onClick }: {
  id: string; label: string; icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-sm transition-all relative group overflow-hidden
        ${active
          ? 'text-black bg-white shadow-md border-0 ring-1 ring-gray-100 border border-gray-200'
          : 'text-gray-500 hover:text-black hover:bg-gray-100 border border-transparent'}
      `}
    >
      <span className="relative z-10">{icon}</span>
      <span className={`relative z-10 font-bold uppercase tracking-widest text-[11px] ${active ? 'opacity-100' : 'opacity-60'}`}>
        {label}
      </span>
      {active && (
        <motion.div
          layoutId="active-nav-indicator"
          className="absolute left-0 w-1 h-full bg-black z-10"
        />
      )}
    </button>
  );
}
