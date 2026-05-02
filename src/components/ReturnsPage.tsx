import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Search, ArrowDownLeft, ArrowUpRight, Wrench, PackageCheck } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import CopyImei from './CopyImei';

type ReturnType = 'all' | 'returned_to_inventory' | 'returned_to_supplier' | 'repair';

const RETURN_TYPES: { key: ReturnType; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all',                   label: 'All Returns',           icon: <RefreshCw size={14} />,     color: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'returned_to_inventory', label: 'Back to Inventory',     icon: <PackageCheck size={14} />,  color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'returned_to_supplier',  label: 'Back to Supplier',      icon: <ArrowUpRight size={14} />,  color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'repair',                label: 'Repair',                icon: <Wrench size={14} />,        color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

function getReturnCategory(u: InventoryUnit): ReturnType {
  const n = (u.notes || '').toLowerCase();
  if (n.includes('supplier') || n.includes('return to supplier')) return 'returned_to_supplier';
  if (n.includes('repair') || n.includes('fix')) return 'repair';
  return 'returned_to_inventory';
}

export default function ReturnsPage() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ReturnType>('all');

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return u;
  }, []);

  const returned = useMemo(() => units.filter(u => u.status === 'returned'), [units]);

  const withCategory = useMemo(() => returned.map(u => ({ ...u, returnCategory: getReturnCategory(u) })), [returned]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? withCategory : withCategory.filter(u => u.returnCategory === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u => u.model.toLowerCase().includes(q) || u.imei.includes(q) || (u.notes || '').toLowerCase().includes(q));
    }
    return list.sort((a, b) => new Date(b.dateIn).getTime() - new Date(a.dateIn).getTime());
  }, [withCategory, filter, search]);

  const counts = useMemo(() => ({
    all:                   returned.length,
    returned_to_inventory: withCategory.filter(u => u.returnCategory === 'returned_to_inventory').length,
    returned_to_supplier:  withCategory.filter(u => u.returnCategory === 'returned_to_supplier').length,
    repair:                withCategory.filter(u => u.returnCategory === 'repair').length,
  }), [withCategory, returned]);

  const ICON_MAP: Record<ReturnType, React.ReactNode> = {
    all:                   <RefreshCw size={14} className="text-gray-500" />,
    returned_to_inventory: <PackageCheck size={14} className="text-emerald-600" />,
    returned_to_supplier:  <ArrowUpRight size={14} className="text-orange-600" />,
    repair:                <Wrench size={14} className="text-blue-600" />,
  };

  const BG_MAP: Record<ReturnType, string> = {
    all:                   'bg-gray-100',
    returned_to_inventory: 'bg-emerald-100',
    returned_to_supplier:  'bg-orange-100',
    repair:                'bg-blue-100',
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
            <RefreshCw size={16} className="text-orange-600" />
          </span>
          Returns
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Return to Stock · Return to Supplier · Repair · Back to Inventory
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Total Returns</p>
          <p className="text-3xl font-bold font-display mt-1">{returned.length}</p>
          <p className="text-[9px] text-gray-400 font-mono">all time</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-blue-600">Awaiting Repair</p>
          <p className="text-3xl font-bold font-display mt-1 text-blue-700">{counts.repair}</p>
          <p className="text-[9px] text-blue-400 font-mono">units</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {RETURN_TYPES.map(rt => (
          <button
            key={rt.key}
            onClick={() => setFilter(rt.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all ${
              filter === rt.key
                ? 'bg-black text-white border-black'
                : `${rt.color} hover:opacity-80`
            }`}
          >
            {rt.icon}
            {rt.label}
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[8px] ${filter === rt.key ? 'bg-white/20 text-white' : 'bg-black/10'}`}>
              {counts[rt.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI or notes…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all"
        />
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {filter === 'all' ? 'All Returns' : RETURN_TYPES.find(r => r.key === filter)?.label}
          </p>
          <span className="text-[9px] font-mono text-gray-400">{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <RefreshCw size={32} />
            <p className="text-xs font-mono">No returns in this category</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${BG_MAP[u.returnCategory]}`}>
                  {ICON_MAP[u.returnCategory]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <CopyImei imei={u.imei} truncate={10} />
                    {u.notes && <span className="text-[9px] text-gray-400 font-mono truncate">{u.notes.slice(0, 30)}</span>}
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
