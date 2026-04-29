/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  auth 
} from './lib/firebase';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged,
  signOut,
  User
} from 'firebase/auth';
import { 
  LayoutDashboard, 
  Smartphone, 
  Truck, 
  ShoppingCart, 
  LogOut, 
  Plus, 
  Search,
  ChevronRight,
  TrendingUp,
  Package,
  CircleDollarSign,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Suppliers from './components/Suppliers';
import Sales from './components/Sales';
import NewBatchModal from './components/NewBatchModal';

type Tab = 'dashboard' | 'inventory' | 'suppliers' | 'sales';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-white border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0B0B0B] text-white flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <h1 className="text-6xl font-bold tracking-tighter text-white uppercase font-display">Nexus</h1>
            <p className="text-gray-500 font-mono text-[10px] uppercase tracking-[0.3em]">Precision Inventory Systems</p>
          </div>
          
          <button 
            onClick={login}
            className="w-full bg-white text-black py-5 rounded-none font-bold text-sm uppercase tracking-widest hover:bg-gray-200 transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
          >
            Authenticate via Google
            <ChevronRight size={18} />
          </button>

          <p className="text-xs text-gray-500 font-mono">
            SECURE ACCESS FOR AUTHORIZED ACCOUNTS ONLY
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-white flex">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/5 flex flex-col pt-10 pb-6 bg-black">
        <div className="px-8 mb-16">
          <h1 className="text-3xl font-bold tracking-tighter uppercase font-display leading-none">Nexus</h1>
          <p className="text-[9px] text-gray-600 font-mono uppercase tracking-[0.4em] mt-2">Inventory OS</p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          <NavItem 
            id="dashboard" 
            label="Dashboard" 
            icon={<LayoutDashboard size={18} />} 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <NavItem 
            id="inventory" 
            label="Inventory" 
            icon={<Smartphone size={18} />} 
            active={activeTab === 'inventory'} 
            onClick={() => setActiveTab('inventory')} 
          />
          <NavItem 
            id="suppliers" 
            label="Suppliers" 
            icon={<Truck size={18} />} 
            active={activeTab === 'suppliers'} 
            onClick={() => setActiveTab('suppliers')} 
          />
          <NavItem 
            id="sales" 
            label="Sales & Portal" 
            icon={<ShoppingCart size={18} />} 
            active={activeTab === 'sales'} 
            onClick={() => setActiveTab('sales')} 
          />
        </nav>

        <div className="px-4 pt-6 border-t border-white/5 space-y-4">
          <div className="px-4 py-4 flex items-center gap-4 bg-white/[0.02]">
            <div className="w-10 h-10 rounded-none border border-white/10 flex items-center justify-center overflow-hidden bg-black">
              {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : <Package size={18} className="text-gray-700" />}
            </div>
            <div className="flex-1 truncate">
              <p className="text-[10px] font-bold uppercase tracking-widest truncate">{user.displayName}</p>
              <p className="text-[9px] text-gray-700 font-mono truncate uppercase mt-1">Verified Node</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-4 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-700 hover:text-white hover:bg-white/[0.03] transition-all"
          >
            <LogOut size={14} strokeWidth={3} />
            Termination
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#050505]">
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-10 bg-black/80 backdrop-blur-xl sticky top-0 z-20">
          <div className="flex items-center gap-6 flex-1">
            <div className="relative max-w-lg w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600" size={18} />
              <input 
                type="text" 
                placeholder="Search repository..."
                className="w-full bg-white/[0.03] border border-white/10 rounded-none py-2.5 pl-12 pr-4 text-sm font-light focus:outline-none focus:border-white/40 focus:bg-white/[0.05] transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <button 
              onClick={() => setIsBatchModalOpen(true)}
              className="bg-white text-black px-8 py-2.5 rounded-none text-xs font-bold uppercase tracking-widest flex items-center gap-3 hover:bg-gray-200 transition-all active:scale-95 shadow-2xl shadow-white/5"
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
      </AnimatePresence>
    </div>
  );
}

function NavItem({ id, label, icon, active, onClick }: { 
  id: string, label: string, icon: React.ReactNode, active: boolean, onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-4 px-4 py-3.5 rounded-none text-sm transition-all relative group
        ${active ? 'text-white' : 'text-gray-500 hover:text-white hover:bg-white/[0.03]'}
      `}
    >
      <span className="relative z-10">{icon}</span>
      <span className={`relative z-10 font-bold uppercase tracking-widest text-[11px] ${active ? 'opacity-100' : 'opacity-60'}`}>
        {label}
      </span>
      {active && (
        <motion.div 
          layoutId="active-nav-indicator"
          className="absolute right-0 w-1 h-6 bg-white z-10"
        />
      )}
    </button>
  );
}
