import { useState, useEffect, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronRight, ChevronLeft,
  MapPin, Star, Package, Truck, CheckCircle2, Cpu,
  Filter, ArrowUpDown, Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, OperationalFlag, DeviceCategory, ModelSummary } from '../types';
import UnitDetailDrawer from './UnitDetailDrawer';
import QuickSaleModal from './QuickSaleModal';
import { validateIMEI } from '../lib/imeiUtils';
import { getOnHandValue } from '../lib/inventorySummary';

// ─── Constants ────────────────────────────────────────────────────────────────
const CATEGORY_COLOURS: Record<string, string> = {
  'iPhone':'bg-black text-white','iPad':'bg-gray-800 text-white',
  'Apple Watch':'bg-gray-700 text-white','Tablet':'bg-gray-600 text-white',
  'Samsung S Series':'bg-gray-900 text-white','Samsung A Series':'bg-gray-500 text-white',
  'Other':'bg-gray-300 text-black',
};
const FLAG_CONFIG: Record<OperationalFlag, { label: string; icon: any; style: string }> = {
  top10:           { label:'Top 10',       icon:Star,        style:'bg-yellow-50 text-yellow-800 border-yellow-200' },
  officeOnly:      { label:'Office Only',  icon:MapPin,      style:'bg-blue-50 text-blue-800 border-blue-200' },
  supplierHasStock:{ label:'Supplier Stock',icon:Truck,      style:'bg-green-50 text-green-800 border-green-200' },
  stockSold:       { label:'Sold',          icon:CheckCircle2,style:'bg-gray-50 text-gray-600 border-gray-200' },
};
const STATUS_OPTS = ['All','available','sold','returned','reserved'];
const SORT_OPTS   = [
  { value:'dateIn_desc', label:'Newest First' },
  { value:'dateIn_asc',  label:'Oldest First' },
  { value:'model_asc',   label:'Model A→Z' },
  { value:'model_desc',  label:'Model Z→A' },
  { value:'qty_desc',    label:'Most Stock' },
  { value:'qty_asc',     label:'Least Stock' },
  { value:'value_desc',  label:'Highest Value' },
  { value:'value_asc',   label:'Lowest Value' },
];
const PAGE_SIZE_OPTS = [10, 25, 50, 100];

// ─── Model summary builder ────────────────────────────────────────────────────
function buildSummaries(units: InventoryUnit[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();
  for (const unit of units) {
    const key = `${unit.brand}||${unit.model}`;
    if (!map.has(key)) map.set(key, {
      model:unit.model, brand:unit.brand, category:unit.category,
      variants:[], totalAvailable:0, totalValue:0, flags:[], latestDateIn:unit.dateIn,
    });
    const s = map.get(key)!;
    let v = s.variants.find(x => x.colour === unit.colour);
    if (!v) { v = { colour:unit.colour, availableCount:0, units:[], lowestBuyPrice:unit.buyPrice }; s.variants.push(v); }
    v.units.push(unit);
    if (unit.status === 'available') { v.availableCount++; s.totalAvailable++; }
    if (unit.buyPrice < v.lowestBuyPrice) v.lowestBuyPrice = unit.buyPrice;
    if (unit.status !== 'sold') s.totalValue += unit.buyPrice;
    for (const f of unit.flags) if (!s.flags.includes(f)) s.flags.push(f);
    if (unit.dateIn > s.latestDateIn) s.latestDateIn = unit.dateIn;
  }
  return Array.from(map.values());
}

function applySort(list: ModelSummary[], sort: string): ModelSummary[] {
  const [field, dir] = sort.split('_');
  return [...list].sort((a, b) => {
    let av: any, bv: any;
    if (field === 'dateIn') { av = a.latestDateIn; bv = b.latestDateIn; }
    else if (field === 'model') { av = a.model; bv = b.model; }
    else if (field === 'qty')   { av = a.totalAvailable; bv = b.totalAvailable; }
    else if (field === 'value') { av = a.totalValue; bv = b.totalValue; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
interface InventoryFilters { status?: string; search?: string; supplierId?: string; }

export default function Inventory({ initialFilters = {} }: { initialFilters?: InventoryFilters }) {
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch]       = useState(initialFilters.search || '');
  const [catFilter, setCatFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState(initialFilters.status || 'All');
  const [flagFilter, setFlagFilter]     = useState('All');
  const [supplierFilter, setSupplierFilter] = useState(initialFilters.supplierId || 'All');
  const [sort, setSort]           = useState('dateIn_desc');
  const [expandedModels, setExpanded] = useState<Set<string>>(new Set());
  const [selectedUnit, setSelectedUnit] = useState<InventoryUnit | null>(null);
  const [quickUnit, setQuickUnit] = useState<InventoryUnit | null>(null);
  const [pageSize, setPageSize]   = useState(25);
  const [page, setPage]           = useState(1);
  const [showFilters, setShowFilters] = useState(
    !!(initialFilters.status || initialFilters.supplierId)
  );

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  // Build + filter + sort
  const allSummaries = useMemo(() => buildSummaries(units), [units]);
  const searchDigits = search.replace(/\D/g, '');
  const isImeiSearch = /^\d{6,}$/.test(searchDigits);

  useEffect(() => {
    if (!isImeiSearch) return;

    const matchingKeys = allSummaries
      .filter(summary =>
        summary.variants.some(variant =>
          variant.units.some(unit => unit.imei.includes(searchDigits))
        )
      )
      .map(summary => `${summary.brand}||${summary.model}`);

    if (matchingKeys.length === 0) return;

    setExpanded(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const key of matchingKeys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allSummaries, isImeiSearch, searchDigits]);

  const filtered = useMemo(() => {
    const results = allSummaries.filter(s => {
      if (catFilter !== 'All' && s.category !== catFilter) return false;
      if (flagFilter !== 'All' && !s.flags.includes(flagFilter as OperationalFlag)) return false;
      if (supplierFilter !== 'All') {
        if (!s.variants.some(v => v.units.some(u => u.supplierId === supplierFilter))) return false;
      }
      if (statusFilter !== 'All') {
        if (!s.variants.some(v => v.units.some(u => u.status === statusFilter))) return false;
      }
      if (!search) return true;
      if (isImeiSearch) {
        return s.variants.some(v => v.units.some(u => u.imei.includes(searchDigits)));
      }
      return s.model.toLowerCase().includes(search.toLowerCase()) ||
             s.brand.toLowerCase().includes(search.toLowerCase()) ||
             s.variants.some(v => v.colour.toLowerCase().includes(search.toLowerCase()));
    });
    return applySort(results, sort);
  }, [allSummaries, search, catFilter, statusFilter, flagFilter, supplierFilter, sort, suppliers]);

  useEffect(() => { setPage(1); }, [search, catFilter, statusFilter, flagFilter, supplierFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page-1)*pageSize, page*pageSize);
  const totalAvail = units.filter(u => u.status === 'available').length;
  const totalValue = getOnHandValue(units);

  const toggleExpand = (key: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const activeFilters = [catFilter, statusFilter, flagFilter, supplierFilter].filter(f => f !== 'All').length;

  return (
    <div className="space-y-4 pb-24 md:pb-8 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Inventory</h2>
        <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
          {totalAvail} available · £{totalValue.toLocaleString()} · {units.length} total units
        </p>
      </div>

      {/* Search + controls */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Model, IMEI, colour…"
            className="w-full bg-white border border-gray-200 rounded-xl py-2.5 pl-9 pr-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
          />
        </div>
        {/* Sort */}
        <div className="relative flex-shrink-0">
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="appearance-none bg-white border border-gray-200 rounded-xl pl-3 pr-7 py-2.5 text-[11px] font-mono focus:outline-none focus:border-black">
            {SORT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ArrowUpDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
        {/* Filter toggle */}
        <button onClick={() => setShowFilters(f => !f)}
          className={`relative flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-[11px] font-bold uppercase tracking-widest transition-all flex-shrink-0 ${
            showFilters || activeFilters > 0 ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600'
          }`}>
          <Filter size={13} />
          {activeFilters > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">{activeFilters}</span>
          )}
        </button>
      </div>

      {/* Filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div initial={{ height:0,opacity:0 }} animate={{ height:'auto',opacity:1 }} exit={{ height:0,opacity:0 }} className="overflow-hidden">
            <div className="grid grid-cols-2 gap-2 pb-1">
              {/* Category */}
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black">
                <option value="All">All Categories</option>
                {(['iPhone','iPad','Apple Watch','Samsung S Series','Samsung A Series','Tablet','Other'] as DeviceCategory[]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {/* Status */}
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black">
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
              {/* Supplier */}
              <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black">
                <option value="All">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {/* Flag */}
              <select value={flagFilter} onChange={e => setFlagFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl py-2 px-3 text-xs font-mono focus:outline-none focus:border-black">
                <option value="All">All Flags</option>
                <option value="top10">Top 10</option>
                <option value="officeOnly">Office Only</option>
                <option value="supplierHasStock">Supplier Stock</option>
              </select>
            </div>
            {activeFilters > 0 && (
              <button onClick={() => { setCatFilter('All'); setStatusFilter('All'); setFlagFilter('All'); setSupplierFilter('All'); }}
                className="text-[10px] text-red-600 font-mono font-bold underline">Clear all filters</button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pagination top */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-gray-500 font-mono">{filtered.length} models · pg {page}/{totalPages}</p>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="bg-white border border-gray-200 rounded-xl py-1.5 px-2 text-[11px] font-mono focus:outline-none focus:border-black">
            {PAGE_SIZE_OPTS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
      )}

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl">
          <Package size={40} className="text-gray-300" />
          <p className="text-gray-400 font-mono text-sm text-center px-4">No inventory found.</p>
        </div>
      )}

      {/* Model cards */}
      <div className="space-y-2">
        {paginated.map(summary => {
          const key = `${summary.brand}||${summary.model}`;
          const isExpanded = expandedModels.has(key);
          return (
            <div key={key} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <button onClick={() => toggleExpand(key)}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 transition-all">
                <span className={`text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-lg font-mono flex-shrink-0 ${CATEGORY_COLOURS[summary.category] || 'bg-gray-200 text-black'}`}>
                  {summary.category.replace('Samsung ','S.')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{summary.model}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {summary.flags.slice(0,2).map(f => {
                      const cfg = FLAG_CONFIG[f]; const Icon = cfg.icon;
                      return <span key={f} className={`text-[7px] font-bold px-1.5 py-0.5 border rounded-md font-mono flex items-center gap-0.5 ${cfg.style}`}><Icon size={7}/>{cfg.label}</span>;
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 text-right">
                  <div>
                    <p className="text-[8px] text-gray-400 font-mono uppercase">Qty</p>
                    <p className="text-lg font-bold font-display leading-tight">{summary.totalAvailable}</p>
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-[8px] text-gray-400 font-mono uppercase">Value</p>
                    <p className="text-xs font-bold font-mono">£{summary.totalValue.toLocaleString()}</p>
                  </div>
                  <div className="text-gray-300">{isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}</div>
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height:0,opacity:0 }} animate={{ height:'auto',opacity:1 }} exit={{ height:0,opacity:0 }} transition={{ duration:0.18 }} className="overflow-hidden">
                    {summary.variants.map(variant => (
                      <div key={variant.colour} className="border-t border-gray-100">
                        <div className="px-4 py-2 bg-gray-50 flex items-center gap-2">
                          <span className="text-[9px] font-bold uppercase font-mono text-gray-500 tracking-widest">{variant.colour}</span>
                          <span className="text-[9px] font-mono text-gray-400">{variant.availableCount} avail · {variant.units.length} total</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {variant.units.map(unit => {
                            const supplier = suppliers.find(s => s.id === unit.supplierId);
                            const imeiDigits = unit.imei.replace(/\D/g, '');
                            const imeiOk = imeiDigits.length === 15 ? validateIMEI(unit.imei) : null;
                            return (
                              <div key={unit.id} className={`px-4 py-3 ${unit.status === 'sold' ? 'opacity-50' : ''}`}>
                                <div className="flex items-start justify-between gap-3">
                                  {/* Left: IMEI + meta */}
                                  <button onClick={() => setSelectedUnit(unit)} className="flex items-start gap-2 flex-1 min-w-0 text-left">
                                    <StatusDot status={unit.status} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <Cpu size={10} className="text-gray-400 flex-shrink-0"/>
                                        <span className="font-mono font-bold text-[10px] tracking-wider">{unit.imei ? unit.imei.slice(0,10)+'…':'—'}</span>
                                        {imeiOk !== null ? (
                                          <span className={`text-[7px] px-1 rounded font-mono font-bold ${imeiOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                                            {imeiOk ? '✓' : '!'}
                                          </span>
                                        ) : imeiDigits ? (
                                          <span className="text-[7px] px-1 rounded font-mono font-bold bg-gray-100 text-gray-500">
                                            Serial
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                                        {supplier?.name||'—'} · {new Date(unit.dateIn+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}
                                        {unit.salePlatform && ` · ${unit.salePlatform}`}
                                      </p>
                                    </div>
                                  </button>
                                  {/* Right: price + Update button */}
                                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                    <span className="text-xs font-bold font-mono">£{unit.buyPrice}</span>
                                    <div className="flex items-center gap-1.5">
                                      <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full font-mono ${unit.platformListed?'bg-black text-white':'bg-gray-100 text-gray-500'}`}>
                                        {unit.platformListed?'Listed':'Unlisted'}
                                      </span>
                                      {/* ← KEY FEATURE: inline Update button */}
                                      {unit.status !== 'sold' && (
                                        <button
                                          onClick={e => { e.stopPropagation(); setQuickUnit(unit); }}
                                          className="flex items-center gap-1 bg-black text-white text-[8px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg hover:bg-gray-700 transition-all"
                                          title="Update sale/status"
                                        >
                                          <Edit2 size={9}/> Update
                                        </button>
                                      )}
                                      {unit.status === 'sold' && unit.salePrice && (
                                        <span className="text-[8px] font-bold text-emerald-700 font-mono">£{unit.salePrice}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                {unit.notes && <p className="text-[9px] text-gray-400 italic mt-1.5 truncate">{unit.notes}</p>}
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

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-100 disabled:opacity-30">
            <ChevronLeft size={16}/>
          </button>
          {Array.from({length:totalPages},(_,i)=>i+1)
            .filter(n => n===1||n===totalPages||Math.abs(n-page)<=2)
            .reduce<(number|'...')[]>((acc,n,i,arr)=>{ if(i>0&&n-(arr[i-1] as number)>1)acc.push('...'); acc.push(n); return acc;},[])
            .map((n,i) => n==='...'
              ? <span key={`e${i}`} className="text-gray-400 font-mono text-sm px-1">…</span>
              : <button key={n} onClick={()=>setPage(n as number)}
                  className={`w-9 h-9 rounded-xl text-[11px] font-bold font-mono transition-all ${page===n?'bg-black text-white':'border border-gray-200 hover:bg-gray-100'}`}>{n}</button>
            )}
          <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-100 disabled:opacity-30">
            <ChevronRight size={16}/>
          </button>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {selectedUnit && <UnitDetailDrawer unit={selectedUnit} supplierName={suppliers.find(s=>s.id===selectedUnit.supplierId)?.name||'—'} onClose={()=>setSelectedUnit(null)}/>}
        {quickUnit    && <QuickSaleModal   unit={quickUnit}   onClose={()=>setQuickUnit(null)}/>}
      </AnimatePresence>
    </div>
  );
}

function StatusDot({status}:{status:string}) {
  const c:Record<string,string>={available:'bg-emerald-500',sold:'bg-gray-300',reserved:'bg-amber-400',returned:'bg-orange-400',lost:'bg-red-500'};
  return <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1 ${c[status]||'bg-gray-300'}`} title={status}/>;
}
