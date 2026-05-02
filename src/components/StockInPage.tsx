import React, { useState, useEffect, useMemo } from 'react';
import { PackagePlus, Search, ChevronRight, Plus, FileSpreadsheet, CheckCircle2, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';
import CopyImei from './CopyImei';
import CollapsibleSection from './CollapsibleSection';

interface Props {
  onOpenBatch: () => void;
  onOpenImport: () => void;
}

export default function StockInPage({ onOpenBatch, onOpenImport }: Props) {
  const [units, setUnits]       = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch]     = useState('');
  const [expandedId, setExpandedId] = useState<string|null>(null);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const today = new Date().toISOString().split('T')[0];

  const allSorted = useMemo(() => {
    return [...units]
      .filter(u => u.dateIn)
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime());
  }, [units]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allSorted.slice(0, 50);
    const q = search.toLowerCase();
    return allSorted.filter(u =>
      u.model.toLowerCase().includes(q) ||
      u.imei.toLowerCase().includes(q) ||
      (u.buyPrice + '').includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q)
    );
  }, [allSorted, search, supplierMap]);

  const todayIn = units.filter(u => u.dateIn === today);
  const totalBP = todayIn.reduce((s, u) => s + u.buyPrice, 0);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  return (
    <div className="space-y-5 pb-24 md:pb-8">
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

      {/* Today's summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-emerald-600">Today's Intake</p>
          <p className="text-3xl font-bold font-display mt-1 text-emerald-700">{todayIn.length}</p>
          <p className="text-[9px] text-emerald-500 font-mono">units received</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-blue-600">Today's Spend</p>
          <p className="text-2xl font-bold font-display mt-1 text-blue-700">£{totalBP.toLocaleString()}</p>
          <p className="text-[9px] text-blue-500 font-mono">total buy price</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={onOpenBatch}
          className="flex flex-col items-center gap-2 p-4 bg-black text-white rounded-2xl hover:bg-gray-800 transition-all active:scale-95"
        >
          <Plus size={20} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Add Supplier Delivery</span>
          <span className="text-[8px] text-gray-400 font-mono">Add multiple units</span>
        </button>
        <button
          onClick={onOpenImport}
          className="flex flex-col items-center gap-2 p-4 bg-white border border-gray-200 rounded-2xl hover:bg-gray-50 transition-all active:scale-95"
        >
          <FileSpreadsheet size={20} className="text-gray-700" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-black">Import Excel</span>
          <span className="text-[8px] text-gray-400 font-mono">Bulk import from sheet</span>
        </button>
      </div>

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

      <CollapsibleSection
        title="Recent Stock In"
        count={filtered.length}
        accent="border-l-emerald-500"
        defaultOpen={true}
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
              return (
                <div key={u.id}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all">
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
                      <button onClick={() => setExpandedId(isOpen ? null : u.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                        {isOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100">
                        <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                          {[
                            {label:'Supplier', value: supplierMap[u.supplierId] || 'Unknown'},
                            {label:'Condition', value: u.conditionGrade ? `Grade ${u.conditionGrade}` : '—'},
                            {label:'Colour', value: u.colour || '—'},
                          ].map(f=>(
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
    </div>
  );
}
