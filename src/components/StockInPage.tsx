import React, { useState, useMemo } from 'react';
import {
  PackagePlus, Search, Plus, CheckCircle2, Clock,
  ChevronDown, ChevronUp, Truck, PackageCheck, AlertCircle, MoreVertical, Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { notificationService } from '../lib/notificationService';
import { InventoryUnit, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import CopyImei from './CopyImei';
import CollapsibleSection from './CollapsibleSection';
import ReceiveSHSModal from './ReceiveSHSModal';
import AddSHSModal from './AddSHSModal';
import AddDeliveryModal from './AddDeliveryModal';
import ScanInModal from './ScanInModal';
import { groupIdenticalUnits } from '../lib/unitGroups';
import ColourBreakdown from './ColourBreakdown';
import IntelligencePanel from './IntelligencePanel';
import TodayIntakeModal from './TodayIntakeModal';
import { StockIntakeFlow } from './StockIntakeFlow';

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
  const [showStockIntakeFlow, setShowStockIntakeFlow] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const handleDeletePendingSHSGroup = async (groupUnits: InventoryUnit[]) => {
    const sample = groupUnits[0];
    const qty = groupUnits.length;
    const label = qty === 1 ? `"${sample.model}"` : `${qty} × "${sample.model}"`;
    if (!window.confirm(`Delete ${label} from database? This action cannot be undone.`)) {
      return;
    }
    try {
      await Promise.all(groupUnits.map(u => dbService.delete('inventoryUnits', u.id)));
      notificationService.addNotification('shs_removed', sample, undefined, qty);
      setOpenMenuId(null);
    } catch (err) {
      console.error('Failed to delete pending SHS group:', err);
    }
  };

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

  // Group identical pending SHS units to avoid sequential duplicate rows
  const pendingSHSGroups = useMemo(() => {
    const map = new Map<string, InventoryUnit[]>();
    for (const u of pendingSHS) {
      const key = [
        u.model,
        u.colour || '',
        (u as any).storage || '',
        u.supplierId || '',
        u.batchId || '',
        u.buyPrice,
        u.dateIn,
        u.notes || '',
      ].join('|');
      const arr = map.get(key);
      if (arr) arr.push(u);
      else map.set(key, [u]);
    }
    return Array.from(map.values());
  }, [pendingSHS]);

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
        <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <PackagePlus size={16} className="text-emerald-700" />
          </span>
          Stock In
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Record incoming stock · Model · IMEI · Buy Price
        </p>
      </div>

      {/* Compact dashboard */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 bg-gradient-to-r from-gray-50 to-white border border-gray-100 rounded-xl p-4">
        {/* KPI Row (responsive) */}
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {/* Today's Intake */}
          <button
            onClick={() => setShowTodayIntake(true)}
            disabled={todayIn.length === 0}
            className="flex items-center gap-3 px-5 py-3 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-100 transition-all disabled:opacity-50 disabled:cursor-default flex-shrink-0"
          >
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">Intake</p>
              <p className="text-2xl font-bold text-emerald-700 leading-tight">{todayIn.length}</p>
            </div>
          </button>

          {/* Today's Spend */}
          <div className="flex items-center gap-3 px-5 py-3 bg-blue-50 border border-blue-100 rounded-lg flex-shrink-0">
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-blue-600">Spend</p>
              <p className="text-xl font-bold text-blue-700 leading-tight">£{totalBP.toLocaleString()}</p>
            </div>
          </div>

          {/* Pending SHS */}
          <div className="flex items-center gap-3 px-5 py-3 bg-amber-50 border border-amber-100 rounded-lg flex-shrink-0">
            <div className="text-center">
              <p className="text-[8px] font-mono uppercase tracking-widest text-amber-600">SHS</p>
              <p className="text-2xl font-bold text-amber-700 leading-tight">{pendingSHS.length}</p>
            </div>
          </div>
        </div>

        {/* Divider (hidden on mobile) */}
        <div className="hidden md:block w-px h-12 bg-gray-200 mx-2 flex-shrink-0" />

        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          {/* Add Stock (New Flow) */}
          <button
            onClick={() => setShowStockIntakeFlow(true)}
            className="flex items-center justify-center sm:justify-start gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all active:scale-95 shadow-md whitespace-nowrap"
          >
            <Plus size={16} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Add Stock (New)</span>
          </button>

          {/* Log SHS Order */}
          <button
            onClick={() => setShowAddSHS(true)}
            className="flex items-center justify-center sm:justify-start gap-2 px-4 py-3 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-all active:scale-95 whitespace-nowrap"
          >
            <Truck size={16} />
            <span className="text-[9px] font-bold uppercase tracking-widest">SHS Order</span>
          </button>
        </div>
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
            {pendingSHSGroups.map(group => {
              const u = group[0];
              const qty = group.length;
              return (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 transition-all">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <Truck size={14} className="text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      {qty > 1 && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          ×{qty}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                      {u.colour && u.colour !== 'Unknown' ? `${u.colour} · ` : ''}
                      {supplierMap[u.supplierId] || '—'} · {u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')} · {u.dateIn}
                    </p>
                    {u.notes && (
                      <p className="text-[8px] text-amber-600 font-mono mt-0.5 truncate">{u.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm font-bold">
                      £{u.buyPrice}
                      {qty > 1 && <span className="text-[9px] text-gray-400 font-mono ml-1">/ £{(u.buyPrice * qty).toLocaleString()}</span>}
                    </span>
                    <button
                      onClick={() => setReceivingUnit(u)}
                      className="px-3 py-1.5 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-amber-600 transition-all flex items-center gap-1"
                    >
                      <PackageCheck size={11} /> Receive
                    </button>

                    {/* Options Menu */}
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-all text-gray-500"
                        title="More options"
                      >
                        <MoreVertical size={14} />
                      </button>

                      {/* Dropdown Menu */}
                      {openMenuId === u.id && (
                        <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                          <button
                            onClick={() => handleDeletePendingSHSGroup(group)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-all rounded-lg m-1"
                          >
                            <Trash2 size={14} /> Delete {qty > 1 ? `all ${qty}` : 'from DB'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
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
            {groupIdenticalUnits(filtered).map(g => {
              const u = g.representative;
              const isOpen = expandedId === g.key;
              const isSHS = u.batchId?.startsWith('shs_') || u.notes?.includes('SHS');
              return (
                <div key={g.key}>
                  <div className={`flex items-center gap-3 px-4 py-3 transition-all ${
                    isSHS
                      ? 'bg-orange-50/60 hover:bg-orange-50'
                      : 'hover:bg-gray-50'
                  }`}>
                    <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${u.dateIn === today ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                      {u.dateIn === today
                        ? <CheckCircle2 size={14} className="text-emerald-600" />
                        : <Clock size={14} className="text-gray-400" />
                      }
                      {g.count > 1 && (
                        <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-900 text-white text-[9px] font-bold flex items-center justify-center">
                          ×{g.count}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">
                        {u.model}
                        {g.count > 1 && <span className="ml-1.5 text-slate-500 font-mono text-[10px]">× {g.count}</span>}
                      </p>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                        {g.count > 1
                          ? <>{g.colours.length === 1 ? g.representative.colour : `${g.colours.length} colours`} · {u.dateIn}</>
                          : <><CopyImei imei={u.imei} truncate={10} /> · {u.dateIn}</>}
                      </p>
                      <ColourBreakdown colours={g.colours} />
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{u.buyPrice}</span>
                      <button
                        onClick={() => setExpandedId(isOpen ? null : g.key)}
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
                        {g.count > 1 && (
                          <div className="px-5 pb-3 -mt-1">
                            <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest mb-1.5">
                              IMEIs in this group ({g.count})
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5 max-h-44 overflow-y-auto">
                              {g.units.map(individual => (
                                <p key={individual.id} className="text-[10px] font-mono text-gray-600 truncate">
                                  <CopyImei imei={individual.imei} truncate={18} />
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
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
      <AnimatePresence>
        {showStockIntakeFlow && (
          <StockIntakeFlow onClose={() => setShowStockIntakeFlow(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
