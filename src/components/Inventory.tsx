import { useState, useEffect, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight, MapPin,
  Star, Package, Truck, CheckCircle2, Cpu,
  ChevronLeft, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, OperationalFlag, DeviceCategory, ModelSummary } from '../types';
import UnitDetailDrawer from './UnitDetailDrawer';
import { validateIMEI, formatIMEI } from '../lib/imeiUtils';

const CATEGORY_COLOURS: Record<string, string> = {
  'iPhone': 'bg-black text-white',
  'iPad': 'bg-gray-800 text-white',
  'Apple Watch': 'bg-gray-700 text-white',
  'Tablet': 'bg-gray-600 text-white',
  'Samsung S Series': 'bg-gray-900 text-white',
  'Samsung A Series': 'bg-gray-500 text-white',
  'Other': 'bg-gray-300 text-black',
};

const FLAG_CONFIG: Record<OperationalFlag, { label: string; icon: any; style: string }> = {
  top10:           { label: 'Top 10',        icon: Star,        style: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  officeOnly:      { label: 'Office Only',   icon: MapPin,      style: 'bg-blue-50 text-blue-800 border-blue-200' },
  supplierHasStock:{ label: 'Supplier Stock',icon: Truck,       style: 'bg-green-50 text-green-800 border-green-200' },
  stockSold:       { label: 'Sold',          icon: CheckCircle2,style: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function buildModelSummaries(units: InventoryUnit[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();
  for (const unit of units) {
    const key = `${unit.brand}||${unit.model}`;
    if (!map.has(key)) {
      map.set(key, { model: unit.model, brand: unit.brand, category: unit.category,
        variants: [], totalAvailable: 0, totalValue: 0, flags: [], latestDateIn: unit.dateIn });
    }
    const summary = map.get(key)!;
    let variant = summary.variants.find(v => v.colour === unit.colour);
    if (!variant) {
      variant = { colour: unit.colour, availableCount: 0, units: [], lowestBuyPrice: unit.buyPrice };
      summary.variants.push(variant);
    }
    variant.units.push(unit);
    if (unit.status === 'available') { variant.availableCount++; summary.totalAvailable++; }
    if (unit.buyPrice < variant.lowestBuyPrice) variant.lowestBuyPrice = unit.buyPrice;
    if (unit.status !== 'sold') summary.totalValue += unit.buyPrice;
    for (const flag of unit.flags) { if (!summary.flags.includes(flag)) summary.flags.push(flag); }
    if (unit.dateIn > summary.latestDateIn) summary.latestDateIn = unit.dateIn;
  }
  return Array.from(map.values()).sort((a, b) => b.latestDateIn.localeCompare(a.latestDateIn));
}

export default function Inventory() {
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm]             = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedFlag, setSelectedFlag]         = useState<string>('All');
  const [expandedModels, setExpandedModels]     = useState<Set<string>>(new Set());
  const [selectedUnit, setSelectedUnit]         = useState<InventoryUnit | null>(null);
  const [pageSize, setPageSize]                 = useState(25);
  const [page, setPage]                         = useState(1);
  const [showFilters, setShowFilters]           = useState(false);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const allSummaries = useMemo(() => buildModelSummaries(units), [units]);

  const filtered = useMemo(() => {
    const isImeiSearch = /^\d{6,}$/.test(searchTerm.replace(/\D/g,''));
    const results = allSummaries.filter(s => {
      const matchSearch = !searchTerm ||
        s.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.variants.some(v => v.colour.toLowerCase().includes(searchTerm.toLowerCase())) ||
        s.variants.some(v => v.units.some(u => u.imei.includes(searchTerm.replace(/\D/g,''))));
      if (matchSearch && isImeiSearch) {
        setExpandedModels(prev => new Set([...prev, `${s.brand}||${s.model}`]));
      }
      const matchCat  = selectedCategory === 'All' || s.category === selectedCategory;
      const matchFlag = selectedFlag === 'All' || s.flags.includes(selectedFlag as OperationalFlag);
      return matchSearch && matchCat && matchFlag;
    });
    return results;
  }, [allSummaries, searchTerm, selectedCategory, selectedFlag]);

  // Reset to page 1 on filter change
  useEffect(() => { setPage(1); }, [searchTerm, selectedCategory, selectedFlag]);

  const totalPages   = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated    = filtered.slice((page - 1) * pageSize, page * pageSize);

  const toggleExpand = (key: string) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalValue     = units.filter(u => u.status !== 'sold').reduce((s, u) => s + u.buyPrice, 0);
  const totalAvailable = units.filter(u => u.status === 'available').length;

  return (
    <div className="space-y-4 pb-24 md:pb-8 max-w-full overflow-x-hidden">

      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Inventory</h2>
        <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
          {totalAvailable} available · £{totalValue.toLocaleString()} value
        </p>
      </div>

      {/* Search + Filter toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Model, IMEI, colour…"
            className="w-full bg-white border border-gray-200 rounded-xl py-2.5 pl-9 pr-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
          />
        </div>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest transition-all ${
            showFilters ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600'
          }`}
        >
          <Filter size={13} />
          <span className="hidden sm:inline">Filter</span>
        </button>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 pb-1">
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black"
              >
                <option value="All">All Categories</option>
                {(['iPhone','iPad','Apple Watch','Tablet','Samsung S Series','Samsung A Series','Other'] as DeviceCategory[]).map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={selectedFlag}
                onChange={e => setSelectedFlag(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black"
              >
                <option value="All">All Flags</option>
                <option value="top10">Top 10</option>
                <option value="officeOnly">Office Only</option>
                <option value="supplierHasStock">Supplier Stock</option>
              </select>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pagination controls — top */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-gray-500 font-mono">
            {filtered.length} models · page {page}/{totalPages}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-400 font-mono hidden sm:inline">Show</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="bg-white border border-gray-200 rounded-xl py-1.5 px-2 text-[11px] font-mono focus:outline-none focus:border-black"
            >
              {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl">
          <Package size={40} className="text-gray-300" />
          <p className="text-gray-400 font-mono text-sm text-center px-4">No inventory found. Import Excel to get started.</p>
        </div>
      )}

      {/* Model cards */}
      <div className="space-y-2">
        {paginated.map(summary => {
          const key        = `${summary.brand}||${summary.model}`;
          const isExpanded = expandedModels.has(key);

          return (
            <div key={key} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">

              {/* Model header row */}
              <button
                onClick={() => toggleExpand(key)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 transition-all"
              >
                {/* Category pill */}
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg font-mono flex-shrink-0 ${CATEGORY_COLOURS[summary.category] || 'bg-gray-200 text-black'}`}>
                  {summary.category.replace('Samsung ', 'Sam. ')}
                </span>

                {/* Model info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{summary.model}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {summary.flags.slice(0,2).map(flag => {
                      const cfg = FLAG_CONFIG[flag];
                      const Icon = cfg.icon;
                      return (
                        <span key={flag} className={`text-[8px] font-bold px-1.5 py-0.5 border rounded-md font-mono flex items-center gap-1 ${cfg.style}`}>
                          <Icon size={8} />{cfg.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 flex-shrink-0 text-right">
                  <div>
                    <p className="text-[8px] text-gray-400 font-mono uppercase">Qty</p>
                    <p className="text-lg font-bold font-display leading-tight">{summary.totalAvailable}</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-[8px] text-gray-400 font-mono uppercase">Value</p>
                    <p className="text-xs font-bold font-mono">£{summary.totalValue.toLocaleString()}</p>
                  </div>
                  <div className="text-gray-300">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                </div>
              </button>

              {/* Expanded IMEI units */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    {summary.variants.map(variant => (
                      <div key={variant.colour} className="border-t border-gray-100">
                        {/* Variant header */}
                        <div className="px-4 py-2 bg-gray-50 flex items-center gap-2">
                          <span className="text-[9px] font-bold uppercase font-mono text-gray-500 tracking-widest">{variant.colour}</span>
                          <span className="text-[9px] font-mono text-gray-400">{variant.availableCount} avail · {variant.units.length} total</span>
                        </div>

                        {/* Unit cards — stacked on mobile */}
                        <div className="divide-y divide-gray-50">
                          {variant.units.map(unit => {
                            const supplier = suppliers.find(s => s.id === unit.supplierId);
                            const imeiOk   = unit.imei ? validateIMEI(unit.imei) : null;
                            return (
                              <button
                                key={unit.id}
                                onClick={() => setSelectedUnit(unit)}
                                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-all ${unit.status === 'sold' ? 'opacity-50' : ''}`}
                              >
                                {/* Mobile: 2-column grid */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <StatusDot status={unit.status} compact />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <Cpu size={10} className="text-gray-400 flex-shrink-0" />
                                        <span className="font-mono font-bold text-[10px] tracking-wider truncate">
                                          {unit.imei ? unit.imei.slice(0,8) + '…' : '—'}
                                        </span>
                                        {imeiOk !== null && (
                                          <span className={`text-[7px] px-1 rounded font-mono font-bold flex-shrink-0 ${imeiOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                            {imeiOk ? '✓' : '!'}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                                        {supplier?.name || '—'} · {new Date(unit.dateIn).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                    <span className="text-xs font-bold font-mono">£{unit.buyPrice}</span>
                                    <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full font-mono ${unit.platformListed ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>
                                      {unit.platformListed ? 'Listed' : 'Unlisted'}
                                    </span>
                                    {unit.salePlatform && (
                                      <span className="text-[8px] text-gray-500 font-mono">{unit.salePlatform}</span>
                                    )}
                                  </div>
                                </div>

                                {unit.notes && (
                                  <p className="text-[9px] text-gray-400 italic mt-1.5 truncate">{unit.notes}</p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Pagination — bottom */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2 pb-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-100 disabled:opacity-30 transition-all"
          >
            <ChevronLeft size={16} />
          </button>

          {/* Page numbers — show up to 5 */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
            .reduce<(number | '...')[]>((acc, n, idx, arr) => {
              if (idx > 0 && n - (arr[idx-1] as number) > 1) acc.push('...');
              acc.push(n);
              return acc;
            }, [])
            .map((n, i) => n === '...' ? (
              <span key={`ellipsis-${i}`} className="text-gray-400 font-mono text-sm px-1">…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n as number)}
                className={`w-9 h-9 rounded-xl text-[11px] font-bold font-mono transition-all ${
                  page === n ? 'bg-black text-white' : 'border border-gray-200 hover:bg-gray-100'
                }`}
              >
                {n}
              </button>
            ))}

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-100 disabled:opacity-30 transition-all"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Unit Detail Drawer */}
      <AnimatePresence>
        {selectedUnit && (
          <UnitDetailDrawer
            unit={selectedUnit}
            supplierName={suppliers.find(s => s.id === selectedUnit.supplierId)?.name || '—'}
            onClose={() => setSelectedUnit(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusDot({ status, compact }: { status: string; compact?: boolean }) {
  const styles: Record<string, string> = {
    available: 'bg-emerald-500',
    sold:      'bg-gray-300',
    reserved:  'bg-amber-400',
    returned:  'bg-orange-400',
    lost:      'bg-red-500',
  };
  return (
    <span className={`flex-shrink-0 w-2 h-2 rounded-full ${styles[status] || 'bg-gray-300'}`} title={status} />
  );
}
