import React, { useState, useMemo } from 'react';
import {
  PackagePlus, Search, Plus, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Truck, PackageCheck, AlertCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';
import CollapsibleSection from './CollapsibleSection';
import ReceiveSHSModal from './ReceiveSHSModal';
import AddSHSModal from './AddSHSModal';
import AddDeliveryModal from './AddDeliveryModal';
import ScanInModal from './ScanInModal';
import IntelligencePanel from './IntelligencePanel';
import TodayIntakeModal from './TodayIntakeModal';

interface Props {
  onOpenBatch: () => void;
}

export default function StockInPage({ onOpenBatch }: Props) {
  const { units, suppliers }        = useInventoryStore();
  const [search, setSearch]         = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receivingUnit, setReceivingUnit] = useState<InventoryUnit | null>(null);
  const [showAddSHS, setShowAddSHS]       = useState(false);
  const [showAddDelivery, setShowAddDelivery] = useState(false);
  const [showScanUnit, setShowScanUnit] = useState(false);
  const [showTodayIntake, setShowTodayIntake] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // Pending SHS — incoming units, sorted by dateIn desc
  const pendingSHS = useMemo(() =>
    [...units]
      .filter(u => u.status === 'incoming')
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime()),
    [units],
  );

  // Regular stock list (non-incoming), sorted newest first
  const allSorted = useMemo(() =>
    [...units]
      .filter(u => u.dateIn && u.status !== 'incoming')
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime()),
    [units],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allSorted.slice(0, 50);
    const q = search.toLowerCase();
    return allSorted.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      (u.buyPrice + '').includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q),
    );
  }, [allSorted, search, supplierMap]);

  const todayIn  = units.filter(u => u.dateIn === today && u.status !== 'incoming');
  const totalBP  = todayIn.reduce((s, u) => s + u.buyPrice, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <PackagePlus size={16} className="text-emerald-700" />
          </span>
          Stock In
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Record incoming stock · Model · IMEI · Buy Price
        </p>
      </div>

      {/* Compact dashboard */}
      <div className="flex items-center gap-2 bg-gradient-to-r from-gray-50 to-white border border-gray-100 rounded-xl p-3">
        {/* Today's Intake */}
        <button
          onClick={() => setShowTodayIntake(true)}
          disabled={todayIn.length === 0}
          className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-100 transition-all disabled:opacity-50 disabled:cursor-default flex-shrink-0"
        >
          <div className="text-center">
            <p className="text-[7px] font-mono uppercase tracking-widest text-emerald-600">Intake</p>
            <p className="text-lg font-bold text-emerald-700 leading-tight">{todayIn.length}</p>
          </div>
        </button>

        {/* Today's Spend */}
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg flex-shrink-0">
          <div className="text-center">
            <p className="text-[7px] font-mono uppercase tracking-widest text-blue-600">Spend</p>
            <p className="text-sm font-bold text-blue-700 leading-tight">£{totalBP.toLocaleString()}</p>
          </div>
        </div>

        {/* Pending SHS */}
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg flex-shrink-0">
          <div className="text-center">
            <p className="text-[7px] font-mono uppercase tracking-widest text-amber-600">SHS</p>
            <p className="text-lg font-bold text-amber-700 leading-tight">{pendingSHS.length}</p>
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-8 bg-gray-200 mx-1" />

        {/* Add Delivery */}
        <button
          onClick={() => setShowAddDelivery(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-black text-white rounded-lg hover:bg-gray-800 transition-all active:scale-95 flex-shrink-0 whitespace-nowrap"
        >
          <Plus size={14} />
          <span className="text-[8px] font-bold uppercase tracking-widest">Delivery</span>
        </button>

        {/* Log SHS Order */}
        <button
          onClick={() => setShowAddSHS(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all active:scale-95 flex-shrink-0 whitespace-nowrap"
        >
          <Truck size={14} />
          <span className="text-[8px] font-bold uppercase tracking-widest">SHS Order</span>
        </button>
      </div>

      {/* Intelligence panel */}
      <IntelligencePanel units={units} mode="buy" />

      {/* Pending SHS section */}
      {pendingSHS.length > 0 && (
        <CollapsibleSection
          title="Pending SHS — Awaiting Delivery"
          count={pendingSHS.length}
          accent="border-l-amber-500"
          defaultOpen={false}
        >
          <div className="divide-y divide-amber-50">
            {pendingSHS.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 transition-all">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Truck size={14} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                    {u.colour && u.colour !== 'Unknown' ? `${u.colour} · ` : ''}
                    {supplierMap[u.supplierId] || '—'} · {u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')} · {u.dateIn}
                  </p>
                  {u.notes && (
                    <p className="text-[8px] text-amber-600 font-mono mt-0.5 truncate">{u.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-bold">£{u.buyPrice}</span>
                  <button
                    onClick={() => setReceivingUnit(u)}
                    className="px-3 py-1.5 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-amber-600 transition-all flex items-center gap-1"
                  >
                    <PackageCheck size={11} /> Receive
                  </button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI or buy price…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all"
        />
      </div>

      {/* Recent stock (non-SHS) */}
      <CollapsibleSection
        title="Recent Stock In"
        count={filtered.length}
        accent="border-l-emerald-500"
        defaultOpen={false}
      >
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <PackagePlus size={32} />
            <p className="text-xs font-mono">No stock records yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => {
              const isOpen = expandedId === u.id;
              const isSHS = u.batchId?.startsWith('shs_') || u.notes?.includes('SHS');
              return (
                <div key={u.id}>
                  <div className={`flex items-center gap-3 px-4 py-3 transition-all ${
                    isSHS
                      ? 'bg-orange-50/60 hover:bg-orange-50'
                      : 'hover:bg-gray-50'
                  }`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${u.dateIn === today ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                      {u.dateIn === today
                        ? <CheckCircle2 size={14} className="text-emerald-600" />
                        : <Clock size={14} className="text-gray-400" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                        <CopyImei imei={u.imei} truncate={10} /> · {u.dateIn}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{u.buyPrice}</span>
                      <button
                        onClick={() => setExpandedId(isOpen ? null : u.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400"
                      >
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100"
                      >
                        <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Supplier', value: supplierMap[u.supplierId] || '—' },
                            { label: 'Batch', value: u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default') },
                            { label: 'Colour',   value: u.colour || '—' },
                            { label: 'Storage',  value: (u as any).storage || '—' },
                          ].map(f => (
                            <div key={f.label}>
                              <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">{f.label}</p>
                              <p className="text-xs font-bold mt-0.5">{f.value}</p>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* Modals */}
      <AnimatePresence>
        {showAddDelivery && (
          <AddDeliveryModal
            onSelectSingle={() => {
              setShowAddDelivery(false);
              setShowScanUnit(true);
            }}
            onSelectBatch={() => {
              setShowAddDelivery(false);
              onOpenBatch();
            }}
            onClose={() => setShowAddDelivery(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showScanUnit && <ScanInModal onClose={() => setShowScanUnit(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showAddSHS && <AddSHSModal onClose={() => setShowAddSHS(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {receivingUnit && (
          <ReceiveSHSModal unit={receivingUnit} onClose={() => setReceivingUnit(null)} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showTodayIntake && (
          <TodayIntakeModal units={todayIn} onClose={() => setShowTodayIntake(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
