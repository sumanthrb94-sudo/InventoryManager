import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Truck, Plus, ShoppingBag, AlertCircle, Search, ChevronDown, ChevronUp, RotateCcw, Trash2 } from 'lucide-react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService, SOFT_DELETE_RETENTION_MS } from '../lib/dbService';

interface Props {
  units: InventoryUnit[];
  mode: 'buy' | 'sell';
}

function formatRemaining(deletedAt?: string | null): string {
  if (!deletedAt) return '';
  const expires = new Date(deletedAt).getTime() + SOFT_DELETE_RETENTION_MS;
  const ms = expires - Date.now();
  if (ms <= 0) return 'purging…';
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

export default function SHSListingPanel({ units, mode }: Props) {
  const { suppliers, deletedUnits } = useInventoryStore();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [removedExpanded, setRemovedExpanded] = useState(false);

  const shsUnits = useMemo(() => units.filter(u => u.status === 'incoming'), [units]);

  // Recently-removed (last 48h) — shown for recovery while in testing.
  const recentlyRemoved = useMemo(() => {
    const cutoff = Date.now() - SOFT_DELETE_RETENTION_MS;
    return (deletedUnits || [])
      .filter(u => u.deletedAt && new Date(u.deletedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime());
  }, [deletedUnits]);

  const supplierMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of suppliers) map[s.id] = s.name;
    return map;
  }, [suppliers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return shsUnits;
    const q = search.toLowerCase();
    return shsUnits.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q)
    );
  }, [shsUnits, search, supplierMap]);

  const grouped = useMemo(() => {
    const map: Record<string, InventoryUnit[]> = {};
    for (const u of filtered) {
      const series = u.model.split(' ').slice(0, 2).join(' ');
      if (!map[series]) map[series] = [];
      map[series].push(u);
    }
    return Object.entries(map)
      .map(([series, items]) => ({
        series,
        count: items.length,
        value: items.reduce((s, u) => s + u.buyPrice, 0),
        units: items,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  if (shsUnits.length === 0 && recentlyRemoved.length === 0) {
    return null;
  }

  const handleRestore = async (id: string) => {
    await dbService.restore('inventoryUnits', id);
  };

  return (
    <div className="space-y-4">
    {shsUnits.length > 0 && (
    <div className="bg-gradient-to-br from-orange-50 to-orange-50 border-2 border-orange-200 rounded-3xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-orange-500 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Truck size={20} />
          </div>
          <div>
            <h3 className="font-bold text-sm uppercase tracking-tight">Expected Stock (SHS)</h3>
            <p className="text-[10px] font-mono opacity-90">
              {shsUnits.length} units · £{shsUnits.reduce((s, u) => s + u.buyPrice, 0).toLocaleString()}
            </p>
          </div>
        </div>
        {mode === 'sell' && (
          <div className="flex items-center gap-2 bg-orange-600 px-3 py-2 rounded-lg text-[10px] font-bold uppercase">
            <ShoppingBag size={12} />
            List to Sell
          </div>
        )}
        {mode === 'buy' && (
          <div className="flex items-center gap-2 bg-orange-600 px-3 py-2 rounded-lg text-[10px] font-bold uppercase">
            <Plus size={12} />
            Pre-Order
          </div>
        )}
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-orange-200 bg-orange-50">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by model, IMEI, or supplier…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-orange-200 rounded-xl text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
          />
        </div>
      </div>

      {/* Content */}
      <div className="max-h-96 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center">
            <AlertCircle size={32} className="mx-auto text-orange-300 mb-2" />
            <p className="text-sm text-gray-500">No matching items found</p>
          </div>
        ) : (
          <div className="divide-y divide-orange-100">
            {grouped.map(group => (
              <div key={group.series}>
                {/* Series header */}
                <button
                  onClick={() => setExpandedId(expandedId === group.series ? null : group.series)}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-orange-100/50 transition-all"
                >
                  <div className="flex-1 text-left">
                    <h4 className="font-bold text-sm text-gray-900">{group.series}</h4>
                    <p className="text-[9px] text-gray-500 font-mono mt-0.5">
                      {group.count} units · £{group.value.toLocaleString()} total
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="bg-orange-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">
                      {group.count}
                    </span>
                    {expandedId === group.series ? (
                      <ChevronUp size={16} className="text-orange-600" />
                    ) : (
                      <ChevronDown size={16} className="text-orange-400" />
                    )}
                  </div>
                </button>

                {/* Expanded details */}
                <AnimatePresence>
                  {expandedId === group.series && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden bg-orange-50"
                    >
                      <div className="px-6 py-3 space-y-2">
                        {group.units.map(u => (
                          <div
                            key={u.id}
                            className="flex items-start justify-between bg-white rounded-xl p-3 border border-orange-100"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{u.model}</p>
                              <p className="text-[9px] text-gray-500 font-mono mt-1">
                                {u.colour || '—'} · {u.storage || '—'} · Supplier: {supplierMap[u.supplierId] || '—'}
                              </p>
                              <p className="text-[9px] text-orange-600 font-mono font-bold mt-1">
                                ETA: {u.notes?.includes('Expected') ? u.notes.split('Expected')[1]?.trim().split('·')[0] || 'TBD' : 'TBD'}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0 ml-3">
                              <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                              <button
                                title={mode === 'sell' ? 'List this item for sale' : 'Pre-order this item'}
                                className={`mt-2 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${
                                  mode === 'sell'
                                    ? 'bg-orange-500 text-white hover:bg-orange-600'
                                    : 'bg-orange-400 text-white hover:bg-orange-500'
                                }`}
                              >
                                {mode === 'sell' ? 'List' : 'Pre-Order'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-orange-200 bg-orange-50 flex items-center gap-2">
        <AlertCircle size={13} className="text-orange-600 flex-shrink-0" />
        <p className="text-[9px] text-orange-700 font-mono">
          {mode === 'sell'
            ? 'List SHS products to drive sales before stock arrives'
            : 'Pre-order SHS products to expand your catalog without office inventory'}
        </p>
      </div>
    </div>
    )}

    {recentlyRemoved.length > 0 && (
      <div className="bg-slate-50 border-2 border-slate-300 rounded-3xl overflow-hidden shadow-sm">
        <button
          onClick={() => setRemovedExpanded(v => !v)}
          className="w-full bg-slate-700 text-white px-6 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center">
              <Trash2 size={18} />
            </div>
            <div className="text-left">
              <h3 className="font-bold text-sm uppercase tracking-tight">Recently Removed</h3>
              <p className="text-[10px] font-mono opacity-80">
                {recentlyRemoved.length} item{recentlyRemoved.length === 1 ? '' : 's'} · kept 48h for recovery
              </p>
            </div>
          </div>
          {removedExpanded
            ? <ChevronUp size={16} />
            : <ChevronDown size={16} />}
        </button>

        <AnimatePresence>
          {removedExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-200">
                {recentlyRemoved.map(u => (
                  <div key={u.id} className="flex items-start justify-between px-6 py-3 bg-white">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 truncate">{u.model}</p>
                      <p className="text-[9px] text-gray-500 font-mono mt-1">
                        {u.colour || '—'} · {u.storage || '—'} · {u.imei || 'no IMEI'} · {u.status}
                      </p>
                      <p className="text-[9px] text-slate-600 font-mono mt-1">
                        Removed {new Date(u.deletedAt!).toLocaleString()} · {formatRemaining(u.deletedAt)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-3">
                      <p className="text-sm font-bold text-gray-900">£{u.buyPrice}</p>
                      <button
                        onClick={() => handleRestore(u.id)}
                        title="Restore this unit"
                        className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                      >
                        <RotateCcw size={10} /> Restore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-2 border-t border-slate-200 bg-slate-100 flex items-center gap-2">
                <AlertCircle size={12} className="text-slate-600 flex-shrink-0" />
                <p className="text-[9px] text-slate-600 font-mono">
                  Items soft-deleted in testing mode. Permanently removed after 48 hours.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )}
    </div>
  );
}
