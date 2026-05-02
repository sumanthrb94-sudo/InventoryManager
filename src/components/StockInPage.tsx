import React, { useState, useEffect, useMemo } from 'react';
import { PackagePlus, Search, ChevronRight, Plus, FileSpreadsheet, CheckCircle2, Clock } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';
import CopyImei from './CopyImei';

interface Props {
  onOpenBatch: () => void;
  onOpenImport: () => void;
}

export default function StockInPage({ onOpenBatch, onOpenImport }: Props) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const today = new Date().toISOString().split('T')[0];

  const recentIn = useMemo(() => {
    return [...units]
      .filter(u => u.dateIn)
      .sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime())
      .slice(0, 50);
  }, [units]);

  const filtered = useMemo(() => {
    if (!search.trim()) return recentIn;
    const q = search.toLowerCase();
    return recentIn.filter(u =>
      u.model.toLowerCase().includes(q) ||
      u.imei.includes(q) ||
      (u.buyPrice + '').includes(q)
    );
  }, [recentIn, search]);

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

      {/* Recent stock in list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Recent Stock In</p>
          <span className="text-[9px] font-mono text-gray-400">{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <PackagePlus size={32} />
            <p className="text-xs font-mono">No stock records yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${u.dateIn === today ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                  {u.dateIn === today
                    ? <CheckCircle2 size={14} className="text-emerald-600" />
                    : <Clock size={14} className="text-gray-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <CopyImei imei={u.imei} truncate={10} />
                    <span className="text-[9px] text-gray-300">·</span>
                    <span className="text-[9px] text-gray-400 font-mono">{supplierMap[u.supplierId] || 'Unknown supplier'}</span>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold">£{u.buyPrice.toLocaleString()}</p>
                  <p className="text-[8px] text-gray-400 font-mono">{u.dateIn}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
