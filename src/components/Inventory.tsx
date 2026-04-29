import { useState, useEffect, useMemo } from 'react';
import {
  Search, Filter, ChevronDown, ChevronRight, Tag, MapPin,
  Star, Package, Truck, CheckCircle2, XCircle, Edit2,
  Clock, ArrowUpRight, RefreshCw, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, OperationalFlag, DeviceCategory, ModelSummary } from '../types';

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
  top10: { label: 'Top 10', icon: Star, style: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  officeOnly: { label: 'Office Only', icon: MapPin, style: 'bg-blue-50 text-blue-800 border-blue-200' },
  supplierHasStock: { label: 'Supplier Stock', icon: Truck, style: 'bg-green-50 text-green-800 border-green-200' },
  stockSold: { label: 'Sold', icon: CheckCircle2, style: 'bg-gray-50 text-gray-600 border-gray-200' },
};

function buildModelSummaries(units: InventoryUnit[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();

  for (const unit of units) {
    const key = `${unit.brand}||${unit.model}`;
    if (!map.has(key)) {
      map.set(key, {
        model: unit.model,
        brand: unit.brand,
        category: unit.category,
        variants: [],
        totalAvailable: 0,
        totalValue: 0,
        flags: [],
        latestDateIn: unit.dateIn,
      });
    }
    const summary = map.get(key)!;

    // Variant grouping by colour
    let variant = summary.variants.find(v => v.colour === unit.colour);
    if (!variant) {
      variant = { colour: unit.colour, availableCount: 0, units: [], lowestBuyPrice: unit.buyPrice };
      summary.variants.push(variant);
    }
    variant.units.push(unit);
    if (unit.status === 'available') {
      variant.availableCount++;
      summary.totalAvailable++;
    }
    if (unit.buyPrice < variant.lowestBuyPrice) variant.lowestBuyPrice = unit.buyPrice;
    if (unit.status !== 'sold') summary.totalValue += unit.buyPrice;

    // Merge flags
    for (const flag of unit.flags) {
      if (!summary.flags.includes(flag)) summary.flags.push(flag);
    }

    // Latest date
    if (unit.dateIn > summary.latestDateIn) summary.latestDateIn = unit.dateIn;
  }

  return Array.from(map.values()).sort((a, b) => b.latestDateIn.localeCompare(a.latestDateIn));
}

export default function Inventory() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedFlag, setSelectedFlag] = useState<string>('All');
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubUnits = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const unsubSuppliers = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { unsubUnits(); unsubSuppliers(); };
  }, []);

  const allSummaries = useMemo(() => buildModelSummaries(units), [units]);

  const filtered = useMemo(() => {
    return allSummaries.filter(s => {
      const matchSearch = !searchTerm ||
        s.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.variants.some(v => v.colour.toLowerCase().includes(searchTerm.toLowerCase())) ||
        s.variants.some(v => v.units.some(u => u.imei.includes(searchTerm)));
      const matchCat = selectedCategory === 'All' || s.category === selectedCategory;
      const matchFlag = selectedFlag === 'All' || s.flags.includes(selectedFlag as OperationalFlag);
      return matchSearch && matchCat && matchFlag;
    });
  }, [allSummaries, searchTerm, selectedCategory, selectedFlag]);

  const toggleExpand = (key: string) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const totalValue = units.filter(u => u.status !== 'sold').reduce((sum, u) => sum + u.buyPrice, 0);
  const totalAvailable = units.filter(u => u.status === 'available').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tighter uppercase font-display">Inventory</h2>
          <div className="h-px w-16 bg-black mt-2" />
          <p className="text-xs text-gray-500 font-mono mt-2 uppercase tracking-widest">
            {totalAvailable} units available · £{totalValue.toLocaleString()} total value
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search model, IMEI, colour..."
              className="bg-gray-50 border border-gray-200 rounded-none py-2 pl-9 pr-4 text-xs font-mono focus:outline-none focus:border-black transition-all w-64 text-black"
            />
          </div>

          {/* Category filter */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-none py-2 px-3 text-xs font-mono focus:outline-none focus:border-black text-black appearance-none"
          >
            <option value="All">All Categories</option>
            {(['iPhone','iPad','Apple Watch','Tablet','Samsung S Series','Samsung A Series','Other'] as DeviceCategory[]).map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Flag filter */}
          <select
            value={selectedFlag}
            onChange={e => setSelectedFlag(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-none py-2 px-3 text-xs font-mono focus:outline-none focus:border-black text-black appearance-none"
          >
            <option value="All">All Flags</option>
            <option value="top10">Top 10</option>
            <option value="officeOnly">Office Only</option>
            <option value="supplierHasStock">Supplier Stock</option>
          </select>
        </div>
      </div>

      {/* Model Groups */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="py-20 text-center border-2 border-dashed border-gray-200">
            <Package className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-400 font-mono text-sm">No inventory found. Ingest a batch to get started.</p>
          </div>
        )}

        {filtered.map(summary => {
          const key = `${summary.brand}||${summary.model}`;
          const isExpanded = expandedModels.has(key);

          return (
            <div key={key} className="border border-gray-200 bg-white shadow-sm">
              {/* Model Row — summary level */}
              <button
                onClick={() => toggleExpand(key)}
                className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-gray-50 transition-all group"
              >
                {/* Category pill */}
                <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 font-mono flex-shrink-0 ${CATEGORY_COLOURS[summary.category] || 'bg-gray-200 text-black'}`}>
                  {summary.category}
                </span>

                {/* Model name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold uppercase tracking-tight font-display truncate">{summary.model}</span>
                    {/* Flags */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {summary.flags.map(flag => {
                        const cfg = FLAG_CONFIG[flag];
                        const Icon = cfg.icon;
                        return (
                          <span key={flag} className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border font-mono flex items-center gap-1 ${cfg.style}`}>
                            <Icon size={8} />
                            {cfg.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  {/* Variant colour pills */}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {summary.variants.map(v => (
                      <span key={v.colour} className="text-[9px] font-mono text-gray-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                        {v.colour} ×{v.availableCount}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-8 flex-shrink-0 text-right">
                  <div>
                    <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">In Stock</p>
                    <p className="text-xl font-bold font-display tracking-tighter">{summary.totalAvailable}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Value</p>
                    <p className="text-sm font-bold font-mono">£{summary.totalValue.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Date In</p>
                    <p className="text-xs font-mono text-gray-600">{new Date(summary.latestDateIn).toLocaleDateString('en-GB', { day:'2-digit', month:'short' })}</p>
                  </div>
                  <div className="text-gray-400 group-hover:text-black transition-colors">
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
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    {summary.variants.map(variant => (
                      <div key={variant.colour} className="border-t border-gray-100">
                        {/* Colour header */}
                        <div className="px-6 py-2 bg-gray-50 flex items-center gap-3 border-b border-gray-100">
                          <span className="text-[9px] font-bold uppercase font-mono text-gray-500 tracking-widest">{variant.colour}</span>
                          <span className="text-[9px] font-mono text-gray-400">{variant.availableCount} available · {variant.units.length} total</span>
                        </div>

                        {/* Unit rows */}
                        <div className="divide-y divide-gray-50">
                          {variant.units.map(unit => {
                            const supplier = suppliers.find(s => s.id === unit.supplierId);
                            return (
                              <div key={unit.id} className={`px-6 py-3 flex items-center gap-6 text-xs hover:bg-gray-50 transition-all ${unit.status === 'sold' ? 'opacity-40' : ''}`}>
                                {/* Status indicator */}
                                <StatusDot status={unit.status} />

                                {/* IMEI */}
                                <div className="w-44 flex-shrink-0">
                                  <p className="text-[9px] text-gray-400 font-mono uppercase">IMEI/Serial</p>
                                  <p className="font-mono font-bold text-[11px] tracking-wider">{unit.imei || '—'}</p>
                                </div>

                                {/* Buy Price */}
                                <div className="w-20 flex-shrink-0">
                                  <p className="text-[9px] text-gray-400 font-mono uppercase">Buy Price</p>
                                  <p className="font-mono font-bold text-xs">£{unit.buyPrice}</p>
                                </div>

                                {/* Date In */}
                                <div className="w-24 flex-shrink-0">
                                  <p className="text-[9px] text-gray-400 font-mono uppercase">Date In</p>
                                  <p className="font-mono text-xs text-gray-700">{new Date(unit.dateIn).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' })}</p>
                                </div>

                                {/* Supplier */}
                                <div className="w-28 flex-shrink-0">
                                  <p className="text-[9px] text-gray-400 font-mono uppercase">Supplier</p>
                                  <p className="font-mono text-[10px] text-gray-700 truncate">{supplier?.name || '—'}</p>
                                </div>

                                {/* Platform listed */}
                                <div className="w-24 flex-shrink-0">
                                  <p className="text-[9px] text-gray-400 font-mono uppercase">Platform Qty</p>
                                  <span className={`text-[9px] font-bold font-mono px-2 py-0.5 ${unit.platformListed ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>
                                    {unit.platformListed ? 'Listed (1)' : 'Unlisted (0)'}
                                  </span>
                                </div>

                                {/* Notes */}
                                <div className="flex-1 min-w-0">
                                  {unit.notes && (
                                    <span className="text-[10px] text-gray-500 italic truncate block">{unit.notes}</span>
                                  )}
                                </div>

                                {/* Unit Flags */}
                                <div className="flex items-center gap-1.5">
                                  {unit.flags.map(flag => {
                                    const cfg = FLAG_CONFIG[flag];
                                    const Icon = cfg.icon;
                                    return (
                                      <span key={flag} title={cfg.label} className={`text-[8px] p-1 border ${cfg.style}`}>
                                        <Icon size={8} />
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
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
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const styles: Record<string, string> = {
    available: 'bg-black',
    sold: 'bg-gray-300',
    reserved: 'bg-yellow-400',
    returned: 'bg-orange-400',
    lost: 'bg-red-500',
  };
  const labels: Record<string, string> = {
    available: 'Available',
    sold: 'Sold',
    reserved: 'Reserved',
    returned: 'Returned',
    lost: 'Lost',
  };
  return (
    <div className="flex-shrink-0 flex items-center gap-1.5" title={labels[status]}>
      <span className={`w-2 h-2 rounded-full inline-block ${styles[status] || 'bg-gray-300'}`} />
      <span className="text-[9px] font-mono text-gray-500 uppercase">{labels[status] || status}</span>
    </div>
  );
}
