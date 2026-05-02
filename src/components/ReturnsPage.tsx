import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw, Search, ArrowUpRight, Wrench, PackageCheck,
  ChevronDown, ChevronUp, X, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, ReturnCategory } from '../types';
import CopyImei from './CopyImei';

type FilterTab = 'all' | ReturnCategory;

const RETURN_TYPES: { key: FilterTab; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'all',                   label: 'All Returns',       icon: <RefreshCw size={14} />,    color: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'returned_to_inventory', label: 'Back to Inventory', icon: <PackageCheck size={14} />, color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { key: 'returned_to_supplier',  label: 'To Supplier',       icon: <ArrowUpRight size={14} />, color: 'bg-orange-100 text-orange-700 border-orange-200' },
  { key: 'repair',                label: 'Repair',            icon: <Wrench size={14} />,       color: 'bg-blue-100 text-blue-700 border-blue-200' },
];

const ICON_MAP: Record<FilterTab, React.ReactNode> = {
  all:                   <RefreshCw size={14} className="text-gray-500" />,
  returned_to_inventory: <PackageCheck size={14} className="text-emerald-600" />,
  returned_to_supplier:  <ArrowUpRight size={14} className="text-orange-600" />,
  repair:                <Wrench size={14} className="text-blue-600" />,
};

const BG_MAP: Record<FilterTab, string> = {
  all:                   'bg-gray-100',
  returned_to_inventory: 'bg-emerald-100',
  returned_to_supplier:  'bg-orange-100',
  repair:                'bg-blue-100',
};

// ── Process Return Modal ─────────────────────────────────────────────────────
function ProcessReturnModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnType, setReturnType] = useState<ReturnCategory>('returned_to_inventory');
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!reason.trim()) { setError('Please enter a return reason.'); return; }
    setSaving(true);
    try {
      const newStatus = returnType === 'returned_to_inventory' ? 'available' : 'returned';
      await dbService.update('inventoryUnits', unit.id, {
        status: newStatus,
        returnType,
        returnDate,
        returnReason: reason.trim(),
        // Always clear sale data on any return — prevents ghost sale records
        salePrice: null,
        saleDate: null,
        salePlatform: null,
        saleOrderId: null,
        postageCost: null,
        // Restore listing state if going back to available stock
        ...(returnType === 'returned_to_inventory' ? {
          platformListed: false,
          listingSites: [],
        } : {}),
      });
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const OPTION_LABELS: Record<ReturnCategory, { label: string; desc: string; color: string }> = {
    returned_to_inventory: { label: 'Back to Inventory', desc: 'Unit is resaleable — restore to available stock', color: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    returned_to_supplier:  { label: 'Return to Supplier', desc: 'Faulty or wrong unit — send back to supplier', color: 'border-orange-300 bg-orange-50 text-orange-800' },
    repair:                { label: 'Send for Repair', desc: 'Unit needs repair before resale', color: 'border-blue-300 bg-blue-50 text-blue-800' },
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Process Return</p>
            <h3 className="text-base font-bold truncate mt-0.5 max-w-[280px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        {/* Unit summary */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <CopyImei imei={unit.imei} truncate={12} />
            <span className="text-[9px] text-gray-400 font-mono">·</span>
            <span className="text-[9px] text-gray-500 font-mono">{unit.colour}</span>
            {unit.saleOrderId && (
              <>
                <span className="text-[9px] text-gray-400 font-mono">·</span>
                <span className="text-[9px] font-mono text-gray-500">Order: {unit.saleOrderId}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Return Type */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Return Destination *</label>
            <div className="space-y-2">
              {(Object.keys(OPTION_LABELS) as ReturnCategory[]).map(key => (
                <button key={key} onClick={() => setReturnType(key)}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                    returnType === key ? OPTION_LABELS[key].color + ' border-current' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div>
                    <p className="text-xs font-bold">{OPTION_LABELS[key].label}</p>
                    <p className="text-[9px] font-mono text-gray-500 mt-0.5">{OPTION_LABELS[key].desc}</p>
                  </div>
                  {returnType === key && <CheckCircle2 size={16} />}
                </button>
              ))}
            </div>
          </div>

          {/* Return Date */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Return Date</label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all" />
          </div>

          {/* Reason */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Return Reason *</label>
            <input value={reason} onChange={e => { setReason(e.target.value); setError(''); }}
              placeholder="e.g. Customer changed mind, Faulty screen, Wrong item sent"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all" />
          </div>

          {returnType === 'returned_to_inventory' && (
            <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
              <PackageCheck size={13} className="text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-emerald-700 font-mono leading-relaxed">
                Unit will be restored to <strong>available</strong> stock and sale data cleared. Inspect condition before relisting.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm Return</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ReturnsPage ─────────────────────────────────────────────────────────
export default function ReturnsPage() {
  const [units, setUnits]           = useState<InventoryUnit[]>([]);
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState<InventoryUnit | null>(null);
  const [savedFlag, setSavedFlag]   = useState(false);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return u;
  }, []);

  // Returned = status 'returned' OR units that came back to available via returnType
  const returned = useMemo(() =>
    units.filter(u => u.status === 'returned' || (u.returnType && u.status === 'available')),
    [units]);

  // Sold units eligible to be returned (have a sale record)
  const sold = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  const getCategory = (u: InventoryUnit): ReturnCategory =>
    u.returnType || 'returned_to_inventory';

  const withCategory = useMemo(() =>
    returned.map(u => ({ ...u, returnCategory: getCategory(u) })),
    [returned]);

  const filtered = useMemo(() => {
    let list = filter === 'all' ? withCategory : withCategory.filter(u => u.returnCategory === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.model.toLowerCase().includes(q) ||
        u.imei.includes(q) ||
        (u.returnReason || u.notes || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const da = a.returnDate || a.dateIn;
      const db = b.returnDate || b.dateIn;
      return new Date(db).getTime() - new Date(da).getTime();
    });
  }, [withCategory, filter, search]);

  const counts = useMemo(() => ({
    all:                   returned.length,
    returned_to_inventory: withCategory.filter(u => u.returnCategory === 'returned_to_inventory').length,
    returned_to_supplier:  withCategory.filter(u => u.returnCategory === 'returned_to_supplier').length,
    repair:                withCategory.filter(u => u.returnCategory === 'repair').length,
  }), [withCategory, returned]);

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
          Back to Inventory · Return to Supplier · Repair
        </p>
      </div>

      {savedFlag && (
        <div className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-xl">
          <CheckCircle2 size={16} />
          <p className="text-sm font-bold">Return processed successfully.</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500">Total Returns</p>
          <p className="text-3xl font-bold font-display mt-1">{returned.length}</p>
          <p className="text-[9px] text-gray-400 font-mono">all time</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-blue-600">Repair</p>
          <p className="text-3xl font-bold font-display mt-1 text-blue-700">{counts.repair}</p>
          <p className="text-[9px] text-blue-400 font-mono">units</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
          <p className="text-[9px] font-mono uppercase tracking-widest text-orange-600">To Supplier</p>
          <p className="text-3xl font-bold font-display mt-1 text-orange-700">{counts.returned_to_supplier}</p>
          <p className="text-[9px] text-orange-400 font-mono">units</p>
        </div>
      </div>

      {/* Process a return from sold stock */}
      {sold.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Process New Return</p>
            <span className="text-[9px] font-mono text-gray-400">{sold.length} sold units</span>
          </div>
          <div className="px-4 py-3">
            <SoldUnitPicker units={sold} onSelect={u => setProcessing(u)} />
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {RETURN_TYPES.map(rt => (
          <button key={rt.key} onClick={() => setFilter(rt.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all ${
              filter === rt.key ? 'bg-black text-white border-black' : `${rt.color} hover:opacity-80`
            }`}>
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
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI or return reason…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all" />
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
            {filtered.map(u => {
              const isOpen = expandedId === u.id;
              const cat = u.returnCategory as FilterTab;
              return (
                <div key={u.id}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${BG_MAP[cat]}`}>
                      {ICON_MAP[cat]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <CopyImei imei={u.imei} truncate={10} />
                        <span className="text-[8px] text-gray-400 font-mono">{u.returnDate || u.dateIn}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{u.buyPrice}</span>
                      <button onClick={() => setExpandedId(isOpen ? null : u.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100">
                        <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                          {[
                            { label: 'Buy Price',    value: `£${u.buyPrice}` },
                            { label: 'Sale Price',   value: u.salePrice ? `£${u.salePrice}` : '—' },
                            { label: 'Platform',     value: u.salePlatform || '—' },
                            { label: 'Return Type',  value: (u.returnType || '—').replace(/_/g, ' ') },
                          ].map(f => (
                            <div key={f.label}>
                              <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">{f.label}</p>
                              <p className="text-xs font-bold mt-0.5 capitalize">{f.value}</p>
                            </div>
                          ))}
                          {(u.returnReason || u.notes) && (
                            <div className="col-span-2 md:col-span-4">
                              <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">Return Reason</p>
                              <p className="text-xs mt-0.5 text-gray-700">{u.returnReason || u.notes}</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {processing && (
        <ProcessReturnModal
          unit={processing}
          onClose={() => setProcessing(null)}
          onSaved={() => {
            setProcessing(null);
            setSavedFlag(true);
            setTimeout(() => setSavedFlag(false), 3000);
          }}
        />
      )}
    </div>
  );
}

// ── Sold unit picker (search + select to process return) ─────────────────────
function SoldUnitPicker({ units, onSelect }: { units: InventoryUnit[]; onSelect: (u: InventoryUnit) => void }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return units.filter(u =>
      u.model.toLowerCase().includes(s) ||
      u.imei.includes(s) ||
      (u.saleOrderId || '').toLowerCase().includes(s)
    ).slice(0, 8);
  }, [units, q]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search sold units by model, IMEI or order number…"
          className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-black transition-all" />
      </div>
      {filtered.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-50">
          {filtered.map(u => (
            <button key={u.id} onClick={() => { onSelect(u); setQ(''); }}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-all text-left">
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{u.model}</p>
                <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                  {u.imei.slice(0, 10)}… · {u.salePlatform || '—'} · Order: {u.saleOrderId || '—'}
                </p>
              </div>
              <span className="text-xs font-bold text-orange-600 ml-3 flex-shrink-0">Return →</span>
            </button>
          ))}
        </div>
      )}
      {q.trim() && filtered.length === 0 && (
        <p className="text-[10px] text-gray-400 font-mono text-center py-2">No sold units match "{q}"</p>
      )}
    </div>
  );
}
