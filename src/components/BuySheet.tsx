/**
 * BuySheet — dashboard for the Buy tab.
 *
 * Per the client's whiteboard (17-May), this page has exactly:
 *   - 4 clickable KPI tiles (each opens an Excel-style overlay):
 *       1. Stock Added Today
 *       2. All Office Stock
 *       3. SHS Stock
 *       4. Sold Today
 *   - Action row: Add Stock · Add SHS · Schema · Export CSV · Wipe DB
 *   - Filter panel (search + status pills + supplier chips)
 *
 * Listing / marketplace is NOT a Buy concern — that gets captured on
 * the Sell flow. So the schema everywhere on this page is strictly:
 *   Stock In Date · Model · IMEI · Grade · Storage · Colour · Supplier · BP · Notes
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, Plus, Truck, ChevronDown, ChevronUp, ChevronsUpDown,
  Filter, X, Download, AlertCircle, Trash2, Info, Sparkles, Eye,
  PackageX, TrendingDown, AlertTriangle, ChevronRight, Layers, List,
  FileSpreadsheet,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, InventoryAggregate, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { shsAggregatesFrom } from '../lib/shsCount';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { auth, isAdmin } from '../lib/firebase';
import CopyImei from './CopyImei';
import IntelligencePanel from './IntelligencePanel';
import AddStockManualModal from './AddStockManualModal';
import ResetDataModal from './ResetDataModal';

// ── Types ────────────────────────────────────────────────────────────────────

type KpiId = 'today' | 'office' | 'shs' | 'sold_today';
type StatusFilter = 'all' | 'available' | 'sold' | 'incoming' | 'returned';
type SortKey = 'dateIn' | 'model' | 'storage' | 'colour' | 'buyPrice' | 'supplier' | 'grade';
type SortDir = 'asc' | 'desc';

interface Props {
  onOpenBatch?: () => void;
  onOpenImport?: () => void;
}

const STATUS_TONE: Record<string, { bg: string; text: string; dot: string }> = {
  available: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  sold:      { bg: 'bg-slate-100 border-slate-200',   text: 'text-slate-600',   dot: 'bg-slate-400'  },
  incoming:  { bg: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',   dot: 'bg-amber-500'  },
  returned:  { bg: 'bg-rose-50 border-rose-200',      text: 'text-rose-700',    dot: 'bg-rose-500'   },
};

// Standard storage capacities used across Add Stock + inline edit. The unit
// parser already returns values in this exact format (e.g. "128GB", "1TB").
const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'];

/** Return the standard options plus an empty entry plus the unit's current
 *  storage if it's non-standard (so we never drop a legacy value). */
function storageOptionsWith(current: string | undefined): string[] {
  const out = [''];
  if (current && !STORAGE_OPTIONS.includes(current)) out.push(current);
  out.push(...STORAGE_OPTIONS);
  return out;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function BuySheet(_props: Props) {
  const { units, suppliers, aggregates } = useInventoryStore();
  const region = useUserRegion();
  const userIsAdmin = isAdmin(auth.currentUser);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'dateIn', dir: 'desc' });

  // Which KPI's overlay is open (null = no overlay).
  const [overlay, setOverlay] = useState<KpiId | null>(null);

  // Modals
  const [addStockMode, setAddStockMode] = useState<'office' | 'shs' | null>(null);
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);
  const [showResetData, setShowResetData] = useState(false);

  // ── Derived sets per KPI ──────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  // "Stock Added Today" — every unit (office + SHS) added today. Both manual
  // and import paths stamp `dateIn`; we only exclude parser-synth placeholders
  // (they get a dateIn of the import date which would inflate the today count
  // after every re-import). isManualShsUnit + status='available' covers the
  // real adds.
  const todayUnits = useMemo(
    () => units.filter(u =>
      u.dateIn === today &&
      !((u.id || '').startsWith('shs_') && u.status === 'incoming') // skip synth placeholders
    ),
    [units, today],
  );

  // "All Office Stock" — status='available' (anywhere, any colour). Plus any
  // master-rollup quantity not yet IMEI-tracked is reflected in the count
  // (see kpiCounts below) but doesn't add visible rows.
  const officeUnits = useMemo(() => units.filter(u => u.status === 'available'), [units]);

  // "SHS Stock" — every unit with status='incoming'. This is robust to the
  // id-prefix bug that previously caused fresh SHS adds with 'shs_manual_'
  // ids to be misclassified as parser placeholders and hidden from the KPI.
  // After a master-file import this still counts 1 per aggregate (each
  // creates exactly one placeholder unit), so the math holds in both worlds.
  const shsUnits = useMemo(() => units.filter(u => u.status === 'incoming'), [units]);
  const shsAggs = useMemo(() => shsAggregatesFrom(aggregates), [aggregates]);
  // Master-file rollups that count toward office stock (qty > 0, not flagged
  // SHS). These have no IMEIs yet — the import only captured a row-level total
  // — but they belong in the All Office Stock overlay so the visible row count
  // matches the KPI tile.
  const officeAggs = useMemo(
    () => aggregates.filter(a =>
      (a.quantityText || '').toUpperCase() !== 'SHS'
      && typeof a.quantityNum === 'number'
      && a.quantityNum > 0
    ),
    [aggregates],
  );

  // "Sold Today" — status='sold' with saleDate = today (falls back to updatedAt).
  const soldToday = useMemo(
    () => units.filter(u => {
      if (u.status !== 'sold') return false;
      const d = u.saleDate || (u.updatedAt ? String(u.updatedAt).slice(0, 10) : '');
      return d === today;
    }),
    [units, today],
  );

  // ── KPI counts ────────────────────────────────────────────────────────────
  const kpiCounts = useMemo(() => {
    // Office count = aggregate rollup + unmapped available units, so a wiped
    // DB with 1 manual office unit reads as "1".
    let aggOffice = 0;
    for (const a of aggregates) {
      if ((a.quantityText || '').toUpperCase() === 'SHS') continue;
      const q = a.quantityNum;
      if (typeof q === 'number' && q > 0) aggOffice += q;
    }
    // SHS count = all incoming units (covers manual + import placeholders).
    // Aggregates are NOT added on top — every import creates one placeholder
    // per aggregate, so they're already represented in shsUnits.
    const shsCount = shsUnits.length;
    // Office tile shows max(aggregate count, IMEI count) — works for both
    // master-imported and manually-entered scenarios.
    return {
      today: todayUnits.length,
      office: Math.max(aggOffice, officeUnits.length),
      shs: shsCount,
      soldToday: soldToday.length,
    };
  }, [aggregates, todayUnits.length, officeUnits.length, shsAggs.length, shsUnits.length, soldToday.length]);

  // ── Supplier options for the filter chip drawer ───────────────────────────
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of units) {
      const sname = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
      set.add(sname);
    }
    return Array.from(set).sort();
  }, [units, supplierMap]);

  // ── Rows passed into the overlay (depends on which KPI is active) ─────────
  // Shared filter — applied to both the inline table AND the overlay scope.
  // `base` swaps depending on whether a KPI tile is opened (overlay) or we're
  // viewing the always-on inline table (no overlay).
  const applyPanelFilters = (base: InventoryUnit[]): InventoryUnit[] => {
    const q = search.trim().toLowerCase();
    return base.filter(u => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (supplierFilter.size > 0) {
        const sname = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
        if (!supplierFilter.has(sname)) return false;
      }
      if (q) {
        const hay = [
          u.imei, u.model, u.storage, u.colour, u.grade,
          supplierMap[u.supplierId] || u.supplierName, u.notes, String(u.buyPrice ?? ''),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  // Rows scoped to a KPI tile when the overlay is open.
  const overlayRows = useMemo<InventoryUnit[]>(() => {
    if (!overlay) return [];
    let base: InventoryUnit[];
    switch (overlay) {
      case 'today':      base = todayUnits; break;
      case 'office':     base = officeUnits; break;
      case 'shs':        base = shsUnits; break;
      case 'sold_today': base = soldToday; break;
      default:           base = units;
    }
    return applyPanelFilters(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, todayUnits, officeUnits, shsUnits, soldToday, units, search, statusFilter, supplierFilter, supplierMap]);

  // Rows for the always-on inline table (every unit, panel-filtered).
  const inlineRows = useMemo<InventoryUnit[]>(
    () => sortUnits(applyPanelFilters(units), sort, supplierMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, search, statusFilter, supplierFilter, supplierMap, sort],
  );

  // Sort the overlay rows.
  const sortedRows = useMemo(() => sortUnits(overlayRows, sort, supplierMap), [overlayRows, sort, supplierMap]);

  // ── CSV export — exports whatever's currently filtered ────────────────────
  const handleExportCsv = () => {
    // No KPI = export all units that match the filter panel.
    const base = overlay
      ? sortedRows
      : sortUnits(
          units.filter(u => {
            if (statusFilter !== 'all' && u.status !== statusFilter) return false;
            if (supplierFilter.size > 0) {
              const sname = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
              if (!supplierFilter.has(sname)) return false;
            }
            if (search.trim()) {
              const q = search.trim().toLowerCase();
              const hay = [
                u.imei, u.model, u.storage, u.colour, u.grade,
                supplierMap[u.supplierId] || u.supplierName, u.notes, String(u.buyPrice ?? ''),
              ].filter(Boolean).join(' ').toLowerCase();
              if (!hay.includes(q)) return false;
            }
            return true;
          }),
          sort,
          supplierMap,
        );
    const rows = base.map(u => ({
      'Stock In Date': u.dateIn || '',
      'Model':         u.model || '',
      'IMEI':          u.imei || '',
      'Grade':         u.grade || '',
      'Storage':       u.storage || '',
      'Colour':        u.colour || '',
      'Supplier':      supplierMap[u.supplierId] || u.supplierName || '',
      'BP':            u.buyPrice ?? '',
      'Notes':         u.notes || '',
    }));
    downloadCsv('buy_stock.csv', rows);
  };

  // ── Inventory report — timestamped snapshot of the FULL buy inventory ─────
  // Distinct from Export CSV (which respects the active filter panel and uses
  // a static filename): this is the operator's daily report. Columns mirror
  // the 9-column buy schema exactly — no listing / marketplace / sale fields
  // here because those are captured in the Sell flow. The filename carries
  // YYYY-MM-DD_HHMM so multiple pulls in the same day don't clobber each
  // other and the file sorts chronologically in a folder.
  const handleInventoryReport = () => {
    const all = sortUnits(units, sort, supplierMap);
    const rows = all.map(u => ({
      'Stock In Date': u.dateIn || '',
      'Model':         u.model || '',
      'IMEI':          u.imei || '',
      'Grade':         u.grade || '',
      'Storage':       u.storage || '',
      'Colour':        u.colour || '',
      'Supplier':      supplierMap[u.supplierId] || u.supplierName || '',
      'BP':            u.buyPrice ?? '',
      'Notes':         u.notes || '',
    }));
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    downloadCsv(`inventory-report-${stamp}.csv`, rows);
  };

  // ── Inline cell save ──────────────────────────────────────────────────────
  // Patches the unit doc directly. For 'supplierId' it pair-updates
  // supplierName from the matching supplier doc so downstream reads
  // (Excel report, Sales view) don't show a stale name.
  const saveCell = async (u: InventoryUnit, field: string, value: any) => {
    const patch: Record<string, any> = { [field]: value };
    if (field === 'supplierId') {
      const sup = suppliers.find(s => s.id === value);
      patch.supplierName = sup?.name || '';
    }
    try { await dbService.update('inventoryUnits', u.id, patch); } catch (err) { console.error(err); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header card: action row + KPI tiles ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap justify-end mb-4">
          <button
            onClick={() => setAddStockMode('office')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
          >
            <Plus size={12} /> Add Stock
          </button>
          <button
            onClick={() => setAddStockMode('shs')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all"
          >
            <Truck size={12} /> Add SHS
          </button>
          <button
            onClick={() => setShowSchemaHelp(s => !s)}
            title="Show required fields"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
              showSchemaHelp ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            <Info size={12} /> Schema
          </button>
          <button
            onClick={handleInventoryReport}
            title="Download a timestamped CSV of every unit (buy schema only)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all"
          >
            <FileSpreadsheet size={12} /> Inventory Report
          </button>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
          >
            <Download size={12} /> Export CSV
          </button>
          {userIsAdmin && (
            <button
              onClick={() => setShowResetData(true)}
              title="Wipe every collection · DANGER"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-400"
            >
              <Trash2 size={12} /> Wipe DB
            </button>
          )}
        </div>

        {/* 4 clickable KPI tiles — each opens the Excel overlay scoped to that KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <BigKpiTile
            label="Stock Added Today"
            value={kpiCounts.today}
            tone="emerald"
            onClick={() => setOverlay('today')}
          />
          <BigKpiTile
            label="All Office Stock"
            value={kpiCounts.office}
            tone="blue"
            onClick={() => setOverlay('office')}
          />
          <BigKpiTile
            label="SHS Stock"
            value={kpiCounts.shs}
            tone="amber"
            onClick={() => setOverlay('shs')}
          />
          <BigKpiTile
            label="Sold Today"
            value={kpiCounts.soldToday}
            tone="slate"
            onClick={() => setOverlay('sold_today')}
          />
        </div>
      </div>

      {/* ── Stock Alerts — main intelligence component on Buy.
          Shows models that are sold out (had sales, now 0 available) and
          models with low stock (1–3 available). Drives the operator's
          reorder + clearance decisions. */}
      <StockAlerts units={units} supplierMap={supplierMap} />

      {/* ── Buy Intelligence panel — Fast Movers / Profit Drivers /
          Old Stock Alerts / This Week Trending Sold ──────────────────────── */}
      <IntelligencePanel units={units} mode="buy" />

      {/* ── Schema help card (toggled by the Schema button) ──────────────── */}
      <AnimatePresence>
        {showSchemaHelp && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <SchemaHelpCard onClose={() => setShowSchemaHelp(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filter panel (always visible) ─────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 p-3">
          {/* Search + filter drawer trigger */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IMEI, model, supplier, notes…"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              />
            </div>
            <button
              onClick={() => setShowFilterDrawer(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border
                ${supplierFilter.size > 0
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}
            >
              <Filter size={12} /> Filters
              {supplierFilter.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px]">
                  {supplierFilter.size}
                </span>
              )}
            </button>
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {([
              ['all',       'All',       units.length],
              ['available', 'In Stock',  officeUnits.length],
              ['sold',      'Sold',      units.filter(u => u.status === 'sold').length],
              ['incoming',  'Incoming',  units.filter(u => u.status === 'incoming').length],
              ['returned',  'Returned',  units.filter(u => u.status === 'returned').length],
            ] as Array<[StatusFilter, string, number]>).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all flex-shrink-0
                  ${statusFilter === id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {label}
                <span className={`text-[9px] font-mono px-1 rounded ${statusFilter === id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                  {n}
                </span>
              </button>
            ))}
            {(statusFilter !== 'all' || supplierFilter.size > 0 || search) && (
              <button
                onClick={() => { setStatusFilter('all'); setSupplierFilter(new Set()); setSearch(''); }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 transition-all flex-shrink-0"
              >
                <X size={11} /> Reset
              </button>
            )}
          </div>

          {/* Filter drawer — supplier multi-select */}
          <AnimatePresence>
            {showFilterDrawer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-2 pb-1 border-t border-slate-100">
                  <FilterChipsGroup
                    label="Supplier"
                    options={supplierOptions}
                    selected={supplierFilter}
                    onToggle={name => {
                      const next = new Set(supplierFilter);
                      if (next.has(name)) next.delete(name); else next.add(name);
                      setSupplierFilter(next);
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>
            Showing <span className="text-slate-900 font-bold">{inlineRows.length.toLocaleString()}</span> of {units.length.toLocaleString()} units
          </span>
          <span className="hidden sm:inline">
            Sort: <span className="text-slate-900 font-bold">{sort.key}</span> {sort.dir === 'asc' ? '↑' : '↓'}
          </span>
        </div>
      </div>

      {/* ── Inline Excel sheet ─────────────────────────────────────────────
          Always-on table below the filter panel. Shows every unit that
          matches the panel state with sortable columns + inline edit. KPI
          tiles open a full-screen overlay scoped to that subset; this is the
          default reading view. */}
      <InlineSheet
        rows={inlineRows}
        aggregates={[...officeAggs, ...shsAggs]}
        supplierMap={supplierMap}
        region={region}
      />

      {/* ── Excel overlay modal — opens when a KPI tile is clicked ────────── */}
      <AnimatePresence>
        {overlay && (
          <BuyExcelOverlay
            title={titleFor(overlay)}
            rows={sortedRows}
            sort={sort}
            onSort={setSort}
            supplierMap={supplierMap}
            aggregates={
              overlay === 'shs'    ? shsAggs    :
              overlay === 'office' ? officeAggs :
              []
            }
            region={region}
            onClose={() => setOverlay(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showResetData && <ResetDataModal onClose={() => setShowResetData(false)} />}
        {addStockMode  && <AddStockManualModal initialMode={addStockMode} onClose={() => setAddStockMode(null)} />}
      </AnimatePresence>
    </div>
  );
}

// ── Stock Alerts ────────────────────────────────────────────────────────────
// The headline operational dashboard for Buy. Groups inventoryUnits by SKU
// (brand + model + storage) and surfaces two action queues:
//   - SOLD OUT: SKUs that have ever sold a unit, but currently have 0
//     available. Action: re-order from supplier.
//   - LOW STOCK: SKUs with 1–3 available units. Action: re-order soon.
// Both lists are model-level so the operator sees the SKU once even when
// it spans multiple colours. Latest sale date is surfaced for context.
function StockAlerts({
  units, supplierMap,
}: {
  units: InventoryUnit[];
  supplierMap: Record<string, string>;
}) {
  type Bucket = {
    key: string;
    label: string;
    suppliers: Set<string>;
    available: number;
    sold: number;
    lastSold: string;     // ISO date of latest sale (for context)
    latestBp: number;     // most recent buy price seen (rough cost guide)
  };

  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const u of units) {
      const brand = (u.brand || '').trim();
      const model = (u.model || '').trim();
      const storage = (u.storage || '').trim();
      const key = `${brand}|${model}|${storage}`.toLowerCase();
      if (!key.trim()) continue;
      let b = map.get(key);
      if (!b) {
        b = {
          key,
          label: [brand, model, storage].filter(Boolean).join(' '),
          suppliers: new Set<string>(),
          available: 0, sold: 0, lastSold: '',
          latestBp: u.buyPrice || 0,
        };
        map.set(key, b);
      }
      const sname = supplierMap[u.supplierId] || u.supplierName || '';
      if (sname) b.suppliers.add(sname);
      if (u.status === 'available') b.available++;
      else if (u.status === 'sold') {
        b.sold++;
        const d = (u.saleDate || '').split('T')[0];
        if (d && d > b.lastSold) b.lastSold = d;
      }
      if (u.buyPrice && u.buyPrice > 0) b.latestBp = u.buyPrice;
    }
    return Array.from(map.values());
  }, [units, supplierMap]);

  const soldOut = useMemo(
    () => buckets
      .filter(b => b.available === 0 && b.sold > 0)
      .sort((a, b) => (b.lastSold || '').localeCompare(a.lastSold || ''))
      .slice(0, 12),
    [buckets],
  );
  const lowStock = useMemo(
    () => buckets
      .filter(b => b.available > 0 && b.available <= 3)
      .sort((a, b) => a.available - b.available)
      .slice(0, 12),
    [buckets],
  );

  const allClear = soldOut.length === 0 && lowStock.length === 0;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center flex-shrink-0">
          <AlertTriangle size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-900">Stock Alerts</p>
          <p className="text-[9px] font-mono text-slate-500 mt-0.5">
            Sold out · Low stock (≤ 3 units remaining)
          </p>
        </div>
        <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
          {soldOut.length + lowStock.length}
        </span>
      </div>

      {allClear ? (
        <div className="py-8 flex flex-col items-center gap-2 text-emerald-600">
          <Sparkles size={22} />
          <p className="text-[11px] font-mono uppercase tracking-widest">All stock levels healthy</p>
          <p className="text-[10px] font-mono text-slate-500">Nothing sold out · no SKU below 3 units</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
          {/* SOLD OUT */}
          <AlertColumn
            tone="rose"
            icon={<PackageX size={12} />}
            title="Sold Out · Reorder"
            hint="Had sales · 0 in office now"
            rows={soldOut.map(b => ({
              key: b.key,
              label: b.label,
              meta: `${b.sold} sold${b.lastSold ? ` · last ${b.lastSold}` : ''}`,
              tail: [...b.suppliers].slice(0, 2).join(' / ') || '—',
              tailRight: b.latestBp ? `£${b.latestBp}` : '',
            }))}
            empty="Nothing fully sold out"
          />
          {/* LOW STOCK */}
          <AlertColumn
            tone="amber"
            icon={<TrendingDown size={12} />}
            title="Running Low · Reorder Soon"
            hint="Available ≤ 3 units"
            rows={lowStock.map(b => ({
              key: b.key,
              label: b.label,
              meta: `${b.available} left${b.sold > 0 ? ` · ${b.sold} sold` : ''}`,
              tail: [...b.suppliers].slice(0, 2).join(' / ') || '—',
              tailRight: b.latestBp ? `£${b.latestBp}` : '',
              warn: b.available === 1, // critical
            }))}
            empty="No SKU below 3 units"
          />
        </div>
      )}
    </div>
  );
}

function AlertColumn({
  tone, icon, title, hint, rows, empty,
}: {
  tone: 'rose' | 'amber';
  icon: React.ReactNode;
  title: string;
  hint: string;
  rows: Array<{ key: string; label: string; meta: string; tail: string; tailRight?: string; warn?: boolean }>;
  empty: string;
}) {
  const headerCls = tone === 'rose'
    ? 'bg-rose-50/60 border-b border-rose-100 text-rose-800'
    : 'bg-amber-50/60 border-b border-amber-100 text-amber-800';
  const rowHover = tone === 'rose' ? 'hover:bg-rose-50/40' : 'hover:bg-amber-50/40';
  const dotTone = tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500';
  return (
    <div className="min-w-0">
      <div className={`px-4 py-2 flex items-center gap-2 ${headerCls}`}>
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest">{title}</p>
          <p className="text-[8px] font-mono opacity-70">{hint}</p>
        </div>
        <span className="text-[9px] font-mono bg-white/70 px-1.5 py-0.5 rounded">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[10px] font-mono text-slate-400">{empty}</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r.key} className={`flex items-center gap-3 px-4 py-2 transition-colors ${rowHover}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.warn ? 'bg-rose-500' : dotTone}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-900 truncate" title={r.label}>{r.label}</p>
                <p className="text-[9px] font-mono text-slate-500 mt-0.5 truncate">
                  {r.meta} · {r.tail}
                </p>
              </div>
              {r.tailRight && (
                <span className="text-[10px] font-mono text-slate-600 flex-shrink-0 tabular-nums">{r.tailRight}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Big KPI tile ─────────────────────────────────────────────────────────────
function BigKpiTile({
  label, value, tone, onClick,
}: {
  label: string;
  value: string | number;
  tone: 'emerald' | 'blue' | 'amber' | 'slate';
  onClick: () => void;
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200 text-emerald-800 hover:from-emerald-100 hover:to-emerald-100',
    blue:    'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200 text-blue-800 hover:from-blue-100 hover:to-blue-100',
    amber:   'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200 text-amber-800 hover:from-amber-100 hover:to-amber-100',
    slate:   'bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-200 text-slate-800 hover:from-slate-100 hover:to-slate-100',
  };
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl border px-4 py-4 transition-all hover:shadow-sm active:scale-[0.98] cursor-pointer group ${tones[tone]}`}
    >
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</p>
        <Eye size={11} className="opacity-30 group-hover:opacity-70 transition-opacity flex-shrink-0" />
      </div>
      <p className="text-3xl font-bold tabular-nums mt-2 leading-tight">{value}</p>
      <p className="text-[9px] font-mono opacity-60 mt-1">Click to view Excel overlay</p>
    </button>
  );
}

// ── Filter chip group ────────────────────────────────────────────────────────
function FilterChipsGroup({
  label, options, selected, onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.length === 0 ? (
          <span className="text-[10px] font-mono text-slate-400">No options</span>
        ) : options.map(o => {
          const on = selected.has(o);
          return (
            <button
              key={o}
              onClick={() => onToggle(o)}
              className={`px-2 py-1 rounded-md text-[10px] font-mono border transition-all
                ${on
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Grouped-model helpers (shared by InlineSheet + BuyExcelOverlay) ─────────
// One row per (model) bucket: total qty, per-colour breakdown, latest BP,
// rolled-up stock value, distinct operator notes. Aggregate rollups are
// folded in as their own pseudo-buckets (since they have no IMEIs) and
// rendered alongside IMEI-tracked groups — both surfaces dedupe so a model
// that has IMEIs doesn't also surface its rollup. The grouping is the
// page's primary "what do we have on hand" lens.

type GroupSortKey = 'model' | 'stockIn' | 'colours' | 'qty' | 'bp' | 'value' | 'notes';
type GroupSortDir = 'asc' | 'desc';
interface GroupSort { key: GroupSortKey; dir: GroupSortDir; }
const DEFAULT_GROUP_SORT: GroupSort = { key: 'qty', dir: 'desc' };

/** Sensible default direction when a header is clicked for the first time.
 *  Most columns are "biggest first" (qty, value, etc.); model is A→Z. */
const GROUP_SORT_DEFAULT_DIR: Record<GroupSortKey, GroupSortDir> = {
  model:   'asc',
  stockIn: 'desc',
  colours: 'desc',
  qty:     'desc',
  bp:      'desc',
  value:   'desc',
  notes:   'desc',
};

type GroupedModel = {
  key: string;
  model: string;
  total: number;
  byColour: Map<string, number>;
  latestBp: number;
  totalValue: number;
  /** Distinct non-empty notes across every unit / aggregate in the group. */
  notes: Set<string>;
  /** True when this bucket originates from a master-file SHS aggregate. */
  shs: boolean;
  /** Most recent dateIn across the units in the group. Aggregate rollups
   *  use their updatedAt timestamp since they don't carry per-unit dates.
   *  Empty string when nothing was captured. */
  latestDateIn: string;
};

function buildGroupedModels(
  rows: InventoryUnit[],
  aggregates: InventoryAggregate[],
): GroupedModel[] {
  const map = new Map<string, GroupedModel>();
  for (const u of rows) {
    const model = (u.model || '').trim() || '—';
    const key = `unit::${model.toLowerCase()}`;
    let g = map.get(key);
    if (!g) g = { key, model, total: 0, byColour: new Map(), latestBp: u.buyPrice || 0, totalValue: 0, notes: new Set(), shs: false, latestDateIn: '' };
    g.total++;
    g.totalValue += u.buyPrice || 0;
    const c = (u.colour || '').trim() || 'Unspecified';
    g.byColour.set(c, (g.byColour.get(c) ?? 0) + 1);
    if (u.buyPrice && u.buyPrice > 0) g.latestBp = u.buyPrice;
    const n = (u.notes || '').trim();
    if (n) g.notes.add(n);
    const d = (u.dateIn || '').trim();
    // dateIn comes in as ISO (YYYY-MM-DD) so a lexicographic max is the
    // most-recent date — no Date parsing needed.
    if (d && d > g.latestDateIn) g.latestDateIn = d;
    map.set(key, g);
  }
  for (const a of aggregates) {
    const model = (a.model || '').trim() || '—';
    const shs = (a.quantityText || '').toUpperCase() === 'SHS';
    const key = `${shs ? 'shs' : 'agg'}::${a.id}`;
    const qty = a.quantityNum ?? 0;
    const bp = a.buyPrice || 0;
    const byColour = new Map<string, number>();
    const colsRaw = (a.coloursRaw || '').trim();
    if (colsRaw) byColour.set(colsRaw, qty);
    else byColour.set('Unspecified', qty);
    const notes = new Set<string>();
    const n = (a.notes || '').trim();
    if (n) notes.add(n);
    // Aggregates don't have a dateIn — fall back to updatedAt (or createdAt)
    // sliced to YYYY-MM-DD so the column shows the rollup's last touch date.
    const stamp = a.updatedAt || a.createdAt;
    const latestDateIn = stamp ? String(stamp).slice(0, 10) : '';
    map.set(key, {
      key,
      model: shs ? `${model} · SHS` : model,
      total: qty,
      byColour,
      latestBp: bp,
      totalValue: qty * bp,
      notes,
      shs,
      latestDateIn,
    });
  }
  return Array.from(map.values());
}

function sortGroupedModels(groups: GroupedModel[], sort: GroupSort): GroupedModel[] {
  const arr = [...groups];
  const mult = sort.dir === 'asc' ? 1 : -1;
  const tieBreak = (a: GroupedModel, b: GroupedModel) => a.model.localeCompare(b.model);
  switch (sort.key) {
    case 'model':
      // Direction applies directly to the alphabetical comparison; no
      // tie-break needed since model names are the primary key.
      arr.sort((a, b) => a.model.localeCompare(b.model) * mult);
      break;
    case 'stockIn':
      // Empty dateIn always sinks to the bottom regardless of direction —
      // an "unknown date" is not the same as "very old" or "very new".
      arr.sort((a, b) => {
        if (!!a.latestDateIn !== !!b.latestDateIn) return a.latestDateIn ? -1 : 1;
        return a.latestDateIn.localeCompare(b.latestDateIn) * mult || tieBreak(a, b);
      });
      break;
    case 'colours':
      arr.sort((a, b) => (a.byColour.size - b.byColour.size) * mult || tieBreak(a, b));
      break;
    case 'bp':
      arr.sort((a, b) => (a.latestBp - b.latestBp) * mult || tieBreak(a, b));
      break;
    case 'value':
      arr.sort((a, b) => (a.totalValue - b.totalValue) * mult || tieBreak(a, b));
      break;
    case 'notes':
      arr.sort((a, b) => (a.notes.size - b.notes.size) * mult || tieBreak(a, b));
      break;
    case 'qty':
    default:
      arr.sort((a, b) => (a.total - b.total) * mult || tieBreak(a, b));
  }
  return arr;
}

/** Clickable column header for the grouped Excel grid. Click cycles
 *  direction on the active column; clicking an inactive column switches
 *  the sort and applies that column's sensible default direction
 *  (qty/value/bp → desc; model → asc; etc.). The arrow icon shows the
 *  current state: solid up/down on the active column, muted double-arrow
 *  on the rest. Mirrors the affordance pattern of the detailed view's
 *  Th component so the operator's muscle memory carries over. */
function GroupTh({
  sortKey, label, align, width, sort, onSort, children,
}: {
  sortKey?: GroupSortKey;
  label?: string;
  align?: 'left' | 'right';
  width?: number | string;
  sort: GroupSort;
  onSort: (next: GroupSort) => void;
  children?: React.ReactNode;
}) {
  const active = sortKey && sort.key === sortKey;
  const wrap = (inner: React.ReactNode) => (
    <th
      className={`px-3 py-2 sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-${align ?? 'left'}`}
      style={{ width, minWidth: typeof width === 'number' ? width : undefined }}
    >
      {inner}
    </th>
  );
  if (!sortKey) {
    return wrap(children ?? label ?? '');
  }
  const handleClick = () => {
    if (active) {
      onSort({ key: sortKey, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSort({ key: sortKey, dir: GROUP_SORT_DEFAULT_DIR[sortKey] });
    }
  };
  return wrap(
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-slate-900' : 'hover:text-slate-900'} ${align === 'right' ? 'flex-row-reverse' : ''}`}
      title={`Sort by ${label?.toLowerCase() ?? sortKey}`}
    >
      <span>{label}</span>
      {active
        ? (sort.dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />)
        : <ChevronsUpDown size={10} className="opacity-40" />
      }
    </button>
  );
}

/** Excel-style grouped table. One <tr> per model with chevron / model /
 *  colours / qty / latest BP / total value / notes. Compact: each row is
 *  a single line of ~32px (no stacked card content) — chosen to save
 *  vertical space so the operator can scan many models at once. Click a
 *  row to insert a second <tr> below it carrying the per-colour breakdown.
 *  Used by both the inline page view and the KPI overlay so the operator
 *  always sees the same affordances. */
function GroupedExcelTable({
  groups, expanded, onToggle, region, sort, onSort,
}: {
  groups: GroupedModel[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  /** Region for the locale-aware Stock In date formatter. */
  region: 'uk' | 'india' | 'admin' | 'both';
  sort: GroupSort;
  onSort: (next: GroupSort) => void;
}) {
  return (
    <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <thead>
        <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
          <GroupTh sort={sort} onSort={onSort} width={28}></GroupTh>
          <GroupTh sort={sort} onSort={onSort} sortKey="model"   label="Model"       width={240} />
          <GroupTh sort={sort} onSort={onSort} sortKey="stockIn" label="Stock In"    width={110} />
          <GroupTh sort={sort} onSort={onSort} sortKey="colours" label="Colours"     width={140} />
          <GroupTh sort={sort} onSort={onSort} sortKey="qty"     label="Qty"         width={70}  align="right" />
          <GroupTh sort={sort} onSort={onSort} sortKey="bp"      label="Latest BP"   width={100} align="right" />
          <GroupTh sort={sort} onSort={onSort} sortKey="value"   label="Total Value" width={110} align="right" />
          <GroupTh sort={sort} onSort={onSort} sortKey="notes"   label="Notes"       width={200} />
        </tr>
      </thead>
      <tbody>
        {groups.map((g, idx) => {
          const open = expanded.has(g.key);
          const colours = Array.from(g.byColour.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
          const rowBg = idx % 2 === 1 ? 'bg-slate-50/40 hover:bg-slate-100/60' : 'bg-white hover:bg-slate-50';
          const tone = g.shs
            ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-900 text-white';
          const noteList = Array.from(g.notes);
          return (
            <React.Fragment key={g.key}>
              <tr
                className={`${rowBg} transition-colors cursor-pointer`}
                onClick={() => onToggle(g.key)}
              >
                <td className="px-2 py-1.5 border-b border-slate-100 align-middle">
                  <span className={`inline-flex w-5 h-5 items-center justify-center rounded-md text-slate-400 transition-transform ${open ? 'rotate-90 text-slate-700' : ''}`}>
                    <ChevronRight size={12} />
                  </span>
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle">
                  <span className="font-bold text-slate-900 truncate block" title={g.model}>{g.model}</span>
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-slate-600">
                  {g.latestDateIn
                    ? <span title={g.latestDateIn}>{fmtDateForUser(g.latestDateIn, region) || g.latestDateIn}</span>
                    : <span className="text-slate-300">—</span>
                  }
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-slate-600">
                  {colours.length === 1
                    ? <span className="truncate block" title={colours[0][0]}>{colours[0][0]}</span>
                    : <span>{colours.length} colours</span>
                  }
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-right">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${tone}`}>
                    × {g.total}
                  </span>
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-right text-slate-700">
                  {g.latestBp > 0 ? `£${g.latestBp.toLocaleString('en-GB', { maximumFractionDigits: 0 })}` : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-right">
                  {g.totalValue > 0
                    ? <span className="font-bold text-emerald-700">£{g.totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                    : <span className="text-slate-300">—</span>
                  }
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle">
                  {noteList.length === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {noteList.slice(0, 2).map(n => (
                        <span
                          key={n}
                          className="inline-flex items-center gap-1 text-[9px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 max-w-[180px] truncate"
                          title={n}
                        >
                          <span className="uppercase tracking-widest text-[8px] font-bold text-amber-600">note</span> {n}
                        </span>
                      ))}
                      {noteList.length > 2 && (
                        <span
                          className="text-[9px] font-mono text-slate-400"
                          title={noteList.slice(2).join(' · ')}
                        >+{noteList.length - 2} more</span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
              {open && (
                <tr className="bg-slate-50/60">
                  <td colSpan={8} className="px-0 py-0 border-b border-slate-100">
                    <ul className="pl-10 pr-4 py-2 divide-y divide-slate-200/70">
                      {colours.map(([colour, qty]) => (
                        <li key={colour} className="flex items-center justify-between py-1.5">
                          <span className="flex items-center gap-2 min-w-0">
                            <ColourDot colour={colour} />
                            <span className="text-[11px] text-slate-700 truncate">{colour}</span>
                          </span>
                          <span className="inline-flex items-center text-[10px] font-mono font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded">
                            × {qty}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Inline grouped view (always-on, below the filter panel) ─────────────────
// The default Buy-page reading surface: one row per model with a qty badge,
// per-colour expansion, rolled-up stock value when qty > 1, and operator
// notes as chips. Per-IMEI editing moves to the KPI overlay's detailed view —
// this surface is for fast inventory scanning, not row-by-row data entry.
function InlineSheet({
  rows, aggregates, supplierMap, region,
}: {
  rows: InventoryUnit[];
  /** Master-file rollups. Already filtered to office/SHS upstream by the
   *  parent; passed through so a fresh import (no IMEIs yet) still shows
   *  rolled-up rows here. */
  aggregates: InventoryAggregate[];
  supplierMap: Record<string, string>;
  region: 'uk' | 'india' | 'admin' | 'both';
}) {
  void supplierMap; // reserved for future per-supplier rollup; keeps prop stable
  const [groupedSort, setGroupedSort] = useState<GroupSort>(DEFAULT_GROUP_SORT);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const grouped = useMemo(
    () => sortGroupedModels(buildGroupedModels(rows, aggregates), groupedSort),
    [rows, aggregates, groupedSort],
  );

  const totalUnits = grouped.reduce((s, g) => s + g.total, 0);
  const totalValue = grouped.reduce((s, g) => s + g.totalValue, 0);

  if (grouped.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        <Sparkles size={28} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No units match this filter</p>
        <p className="text-[10px] font-mono mt-1 text-slate-500">Try clearing the search / status pills, or use Add Stock above</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      {/* Compact toolbar — totals only. Sort lives in the column headers
          to save horizontal space. */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
          Stock by model · {grouped.length} {grouped.length === 1 ? 'model' : 'models'} · {totalUnits.toLocaleString()} {totalUnits === 1 ? 'unit' : 'units'} · £{totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
        </p>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-380px)] custom-scrollbar">
        <GroupedExcelTable
          groups={grouped}
          expanded={expanded}
          onToggle={toggle}
          region={region}
          sort={groupedSort}
          onSort={setGroupedSort}
        />
      </div>
      <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 text-[9px] font-mono uppercase tracking-widest text-slate-500">
        Click a row to see colour breakdown · open a KPI tile above for per-IMEI detail
      </div>
    </div>
  );
}

// ── Excel overlay modal ─────────────────────────────────────────────────────

/** Full unit schema rendered in the overlay's detailed view. Read-only —
 *  matches the SkuOverlayModal style so every "click to view" surface in
 *  the app behaves the same way. Listed in the order the operator scans
 *  during stock review: identity → physical attrs → status → financials
 *  → sale → ops → listing → returns → notes. */
const OVERLAY_COLUMNS: { key: string; label: string; width: number; align?: 'left' | 'right' }[] = [
  { key: 'dateIn',         label: 'Stock In',       width: 100 },
  { key: 'imei',           label: 'IMEI / Serial',  width: 180 },
  { key: 'model',          label: 'Model',          width: 220 },
  { key: 'brand',          label: 'Brand',          width: 90  },
  { key: 'category',       label: 'Category',       width: 100 },
  { key: 'storage',        label: 'Storage',        width: 80  },
  { key: 'colour',         label: 'Colour',         width: 130 },
  { key: 'grade',          label: 'Grade',          width: 70  },
  { key: 'status',         label: 'Status',         width: 100 },
  { key: 'supplierName',   label: 'Supplier',       width: 140 },
  { key: 'buyPrice',       label: 'BP',             width: 80,  align: 'right' },
  { key: 'salePrice',      label: 'Sale Price',     width: 90,  align: 'right' },
  { key: 'saleDate',       label: 'Sale Date',      width: 100 },
  { key: 'marketplace',    label: 'Marketplace',    width: 110 },
  { key: 'customerName',   label: 'Customer',       width: 140 },
  { key: 'saleOrderId',    label: 'Order ID',       width: 130 },
  { key: 'postageCost',    label: 'Postage',        width: 80,  align: 'right' },
  // Notes lives in the middle of the schema so it stays visible without
  // scrolling all the way to the right edge — most office-stock review is
  // about reading the operator's note alongside the basic identity columns.
  { key: 'notes',          label: 'Notes',          width: 240 },
  { key: 'batchNo',        label: 'Batch No',       width: 110 },
  { key: 'stockLocation',  label: 'Location',       width: 110 },
  { key: 'batteryHealth',  label: 'Battery',        width: 80,  align: 'right' },
  { key: 'boxIncluded',    label: 'Box',            width: 60  },
  { key: 'networkLock',    label: 'Net Lock',       width: 90  },
  { key: 'activationLock', label: 'iCloud',         width: 80  },
  { key: 'listingSites',   label: 'Listing Sites',  width: 160 },
  { key: 'listingUrl',     label: 'Listing URL',    width: 180 },
  { key: 'listingDate',    label: 'Listed On',      width: 100 },
  { key: 'platformListed', label: 'Listed?',        width: 70  },
  { key: 'returnType',     label: 'Return Type',    width: 110 },
  { key: 'returnDate',     label: 'Return Date',    width: 100 },
  { key: 'returnReason',   label: 'Return Reason',  width: 200 },
  { key: 'stockOutDate',   label: 'Out On',         width: 100 },
  { key: 'flags',          label: 'Flags',          width: 130 },
  { key: 'sku',            label: 'SKU',            width: 130 },
];

function fmtOverlayCell(
  u: InventoryUnit,
  key: string,
  region: 'uk' | 'india' | 'admin' | 'both',
  supplierMap: Record<string, string>,
): string {
  const v = (u as any)[key];
  if (key === 'supplierName') {
    return supplierMap[u.supplierId] || u.supplierName || '';
  }
  if (['dateIn', 'saleDate', 'returnDate', 'listingDate', 'stockOutDate'].includes(key)) {
    return v ? (fmtDateForUser(String(v), region) || String(v)) : '';
  }
  if (key === 'buyPrice' || key === 'salePrice' || key === 'postageCost') {
    return v != null && v !== '' ? `£${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '';
  }
  if (key === 'status') {
    return v ? String(v).replace(/_/g, ' ').toUpperCase() : '';
  }
  if (key === 'marketplace') {
    return String((u as any).marketplace ?? u.salePlatform ?? '').trim();
  }
  if (key === 'listingSites' || key === 'flags') {
    return Array.isArray(v) ? v.filter(Boolean).join(', ') : (v ? String(v) : '');
  }
  if (key === 'boxIncluded' || key === 'platformListed') {
    return v === true ? 'Yes' : v === false ? 'No' : '';
  }
  if (key === 'batteryHealth') {
    return v != null && v !== '' ? `${Number(v)}%` : '';
  }
  if (v == null || v === '') return '';
  return String(v);
}

/** Aggregate rollups carry only a subset of the full schema — fill what
 *  we have, leave the rest blank, and use the IMEI column to surface the
 *  rollup badge (OFFICE / SHS · qty). */
function fmtAggregateCell(
  a: InventoryAggregate,
  key: string,
  region: 'uk' | 'india' | 'admin' | 'both',
  supplierMap: Record<string, string>,
): string {
  const shs = (a.quantityText || '').toUpperCase() === 'SHS';
  switch (key) {
    case 'model':        return a.model || '';
    case 'storage':      return a.storage || '';
    case 'colour':       return a.coloursRaw || '';
    case 'supplierName': return a.supplierIds?.[0] ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0]) : '';
    case 'buyPrice':     return a.buyPrice != null ? `£${Number(a.buyPrice).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '';
    case 'status':       return shs ? 'INCOMING (SHS)' : 'ROLLUP';
    case 'dateIn':       return a.updatedAt ? (fmtDateForUser(String(a.updatedAt).slice(0, 10), region) || '') : '';
    case 'notes':        return a.notes || '';
    case 'imei':         return `${shs ? 'SHS' : 'OFFICE'} · ${a.quantityNum ?? '?'}`;
    default:             return '';
  }
}

function BuyExcelOverlay({
  title, rows, sort, onSort, supplierMap, aggregates, region, onClose,
}: {
  title: string;
  rows: InventoryUnit[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  /** Master-file rollup rows scoped to the open KPI. Each carries a quantity
   *  but no per-IMEI detail; rendered as pseudo-rows so the overlay total
   *  always agrees with the KPI tile that opened it. */
  aggregates: InventoryAggregate[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
}) {
  const isShsAgg = (a: InventoryAggregate) => (a.quantityText || '').toUpperCase() === 'SHS';
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  /** Free-text search scoped to this overlay only — independent of the
   *  always-on filter panel on the Buy page. Matches any of model, imei,
   *  storage, colour, grade, supplier, notes, buy price. */
  const [overlaySearch, setOverlaySearch] = useState('');

  /** Sort selector for the grouped view. The detailed view already has
   *  clickable column headers so it ignores this state.
   *    qty   — most units first (default; matches the Math.max KPI)
   *    value — highest rolled-up stock value first
   *    model — A→Z by model name
   *    bp    — highest latest BP first
   */
  const [groupedSort, setGroupedSort] = useState<GroupSort>(DEFAULT_GROUP_SORT);

  /** Drop aggregate rollups whose model is already represented by an IMEI
   *  row in `rows`. The KPI tile uses Math.max(rollupQty, imeiCount) — i.e.
   *  the two collections describe the SAME stock at different granularities.
   *  Without this filter the overlay double-counted (50 IMEIs + 50-qty
   *  rollup = a misleading "100 units"). Match is case-insensitive on
   *  model, since SHS aggregates and IMEI units come from different import
   *  paths and may differ in casing. */
  const modelsWithImei = useMemo(
    () => new Set(rows.map(r => (r.model || '').trim().toLowerCase()).filter(Boolean)),
    [rows],
  );
  const dedupedAggregates = useMemo(
    () => aggregates.filter(a => {
      const m = (a.model || '').trim().toLowerCase();
      return !m || !modelsWithImei.has(m);
    }),
    [aggregates, modelsWithImei],
  );

  /** Apply the overlay's free-text search to the unit + aggregate sets.
   *  Empty query passes everything through. Match is case-insensitive
   *  on a joined haystack of every operator-facing field so a search
   *  for "PR STOCK" hits a unit whose note says "PR STOCK", a search
   *  for "MINT" hits the colour, etc. */
  const searchedRows = useMemo(() => {
    const q = overlaySearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(u => {
      const hay = [
        u.model, u.imei, u.storage, u.colour, u.grade,
        supplierMap[u.supplierId] || u.supplierName,
        u.notes, String(u.buyPrice ?? ''), u.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [rows, overlaySearch, supplierMap]);

  const searchedAggregates = useMemo(() => {
    const q = overlaySearch.trim().toLowerCase();
    if (!q) return dedupedAggregates;
    return dedupedAggregates.filter(a => {
      const hay = [
        a.model, a.storage, a.coloursRaw,
        a.supplierIds?.[0] ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0]) : '',
        a.notes, String(a.buyPrice ?? ''), a.quantityText,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [dedupedAggregates, overlaySearch, supplierMap]);

  // Esc closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Two display modes for the overlay table:
   *    grouped  — one row per model with a quantity badge, expandable
   *               to a colour breakdown. The default mobile-friendly
   *               view that collapses the long flat list the client
   *               saw on the whiteboard walkthrough.
   *    detailed — original per-unit Excel grid, kept for the cases
   *               where the operator needs to edit IMEIs / buy prices
   *               row-by-row. */
  const [viewMode, setViewMode] = useState<'grouped' | 'detailed'>('grouped');
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) => setExpandedModels(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  /** Rows grouped by model — shared with InlineSheet via buildGroupedModels.
   *  Aggregate rollups (office + SHS) are folded in as their own pseudo-rows
   *  (one per aggregate doc) since they don't have per-unit colour records
   *  to break down. */
  const grouped = useMemo(
    () => sortGroupedModels(buildGroupedModels(searchedRows, searchedAggregates), groupedSort),
    [searchedRows, searchedAggregates, groupedSort],
  );

  const totalValue = useMemo(
    () => searchedRows.reduce((s, u) => s + (u.buyPrice || 0), 0)
        + searchedAggregates.reduce((s, a) => s + ((a.buyPrice || 0) * (a.quantityNum || 0)), 0),
    [searchedRows, searchedAggregates],
  );
  const totalCount = searchedRows.length
    + searchedAggregates.reduce((s, a) => s + (a.quantityNum || 0), 0);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-6xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight truncate">{title}</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {totalCount.toLocaleString()} {totalCount === 1 ? 'unit' : 'units'} · {grouped.length} {grouped.length === 1 ? 'model' : 'models'} · £{totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-[9px] font-bold uppercase tracking-widest">
              <button
                onClick={() => setViewMode('grouped')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${viewMode === 'grouped' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="Group rows by model"
              >
                <Layers size={10} /> Grouped
              </button>
              <button
                onClick={() => setViewMode('detailed')}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${viewMode === 'detailed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                title="Show one row per unit"
              >
                <List size={10} /> Detailed
              </button>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Search + sort bar — operator's tool for slicing the overlay
            without closing it. Search hits any unit / aggregate field; the
            Sort selector only fires in grouped view (the detailed view has
            clickable column headers already). */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-slate-100 bg-slate-50/60 flex-shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={overlaySearch}
              onChange={e => setOverlaySearch(e.target.value)}
              placeholder="Search model, IMEI, colour, supplier, note…"
              className="w-full pl-8 pr-8 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:border-slate-900 transition-all"
            />
            {overlaySearch && (
              <button
                onClick={() => setOverlaySearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                title="Clear search"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Excel-style table */}
        <div className="flex-1 overflow-auto">
          {searchedRows.length === 0 && searchedAggregates.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <Sparkles size={28} />
              <p className="text-[11px] font-mono uppercase tracking-widest">No rows match the active filter</p>
            </div>
          ) : viewMode === 'grouped' ? (
            <GroupedExcelTable
              groups={grouped}
              expanded={expandedModels}
              onToggle={toggleExpand}
              region={region}
              sort={groupedSort}
              onSort={setGroupedSort}
            />
          ) : (
            // Full-schema read-only Excel grid — every InventoryUnit field
            // the operator might want to scan during stock review. Mirrors
            // the SkuOverlayModal layout so every "click to view" surface in
            // the app feels the same. The first column is sticky so the
            // date stays visible while horizontally scrolling.
            <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
                  {OVERLAY_COLUMNS.map((c, i) => {
                    const sortKey: SortKey | '' = (
                      c.key === 'dateIn'       ? 'dateIn'   :
                      c.key === 'model'        ? 'model'    :
                      c.key === 'storage'      ? 'storage'  :
                      c.key === 'colour'       ? 'colour'   :
                      c.key === 'buyPrice'     ? 'buyPrice' :
                      c.key === 'grade'        ? 'grade'    :
                      c.key === 'supplierName' ? 'supplier' :
                      ''
                    );
                    return (
                      <React.Fragment key={c.key}>
                        <Th
                          k={sortKey}
                          sort={sort}
                          onSort={sortKey ? toggleSort : undefined}
                          width={`${c.width}px`}
                          align={c.align}
                          sticky={i === 0}
                          leftPx={i === 0 ? 0 : undefined}
                        >
                          {c.label}
                        </Th>
                      </React.Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Aggregate rollup rows render at the top. SHS aggregates
                    use the amber badge; office rollups use a blue badge so
                    the operator can tell at a glance which rows still need
                    IMEI capture. */}
                {searchedAggregates.map(a => {
                  const shs = isShsAgg(a);
                  const rowBg     = shs ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'bg-blue-50/40 hover:bg-blue-50/70';
                  const stickyBg  = shs ? 'bg-amber-50/40 border-r border-amber-100' : 'bg-blue-50/40 border-r border-blue-100';
                  const badgeCls  = shs ? 'text-amber-700 bg-amber-100' : 'text-blue-700 bg-blue-100';
                  return (
                    <tr key={`agg-${a.id}`} className={`${rowBg} transition-colors`}>
                      {OVERLAY_COLUMNS.map((c, i) => {
                        if (c.key === 'imei') {
                          return (
                            <React.Fragment key={c.key}>
                              <Td align={c.align}>
                                <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${badgeCls} px-1.5 py-0.5 rounded uppercase tracking-widest`}>
                                  <Truck size={9} /> {shs ? 'SHS' : 'OFFICE'} · {a.quantityNum ?? '?'}
                                </span>
                              </Td>
                            </React.Fragment>
                          );
                        }
                        const val = fmtAggregateCell(a, c.key, region, supplierMap);
                        const sticky = i === 0;
                        return (
                          <React.Fragment key={c.key}>
                            <Td
                              align={c.align}
                              sticky={sticky}
                              leftPx={sticky ? 0 : undefined}
                              className={sticky ? stickyBg : undefined}
                            >
                              <span
                                className={`block truncate ${val ? (c.key === 'model' || c.key === 'buyPrice' ? 'font-bold text-slate-900' : 'text-slate-600') : 'text-slate-300'}`}
                                title={val || ''}
                                style={{ maxWidth: c.width }}
                              >
                                {val || '—'}
                              </span>
                            </Td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
                {searchedRows.map((u, idx) => {
                  const isAlt = idx % 2 === 1;
                  const rowBg = isAlt ? 'bg-slate-50/40 hover:bg-slate-100/60' : 'bg-white hover:bg-slate-50';
                  const apple = isAppleDevice(u.model);
                  const imeiValid = isValidImei(u.imei, { isAppleSerial: apple });
                  const tone = STATUS_TONE[u.status] || STATUS_TONE.available;
                  return (
                    <tr key={u.id} className={`${rowBg} transition-colors group`}>
                      {OVERLAY_COLUMNS.map((c, i) => {
                        const sticky = i === 0;
                        const stickyCls = sticky ? `${rowBg} border-r border-slate-200` : undefined;
                        if (c.key === 'imei') {
                          return (
                            <React.Fragment key={c.key}>
                              <Td align={c.align}>
                                {imeiValid ? <CopyImei imei={u.imei} truncate={20} /> :
                                  u.status === 'incoming' ? <span className="text-[10px] font-mono text-slate-400 italic">Optional for SHS</span> :
                                  <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono">
                                    <AlertCircle size={10} /> {u.imei ? 'invalid' : 'missing'}
                                  </span>
                                }
                              </Td>
                            </React.Fragment>
                          );
                        }
                        if (c.key === 'status') {
                          return (
                            <React.Fragment key={c.key}>
                              <Td align={c.align}>
                                <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                                  {u.status}
                                </span>
                              </Td>
                            </React.Fragment>
                          );
                        }
                        const val = fmtOverlayCell(u, c.key, region, supplierMap);
                        const strongCol = c.key === 'model' || c.key === 'buyPrice' || c.key === 'salePrice';
                        return (
                          <React.Fragment key={c.key}>
                            <Td
                              align={c.align}
                              sticky={sticky}
                              leftPx={sticky ? 0 : undefined}
                              className={stickyCls}
                            >
                              <span
                                className={`block truncate ${val ? (strongCol ? 'font-bold text-slate-900' : 'text-slate-700') : 'text-slate-300'}`}
                                title={val || ''}
                                style={{ maxWidth: c.width }}
                              >
                                {val || '—'}
                              </span>
                            </Td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 flex-shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>Click column headers to sort · ESC to close</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
          >Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Schema help card ─────────────────────────────────────────────────────────
function SchemaHelpCard({ onClose }: { onClose: () => void }) {
  const fields: Array<{ col: string; field: string; required: 'always' | 'shs-optional' | 'optional'; note: string }> = [
    { col: '1', field: 'Stock In Date', required: 'always',       note: 'When the unit was received in the office (batch-level — top of Add Stock).' },
    { col: '2', field: 'Model',         required: 'always',       note: 'e.g. "iPhone 13 128GB". Storage auto-parses out.' },
    { col: '3', field: 'IMEI / Serial', required: 'shs-optional', note: 'Required for Office Stock · optional for SHS. Apple devices accept a 10–12 char serial.' },
    { col: '4', field: 'Grade',         required: 'optional',     note: 'A / B / C / ONU / Brand new.' },
    { col: '5', field: 'Storage',       required: 'optional',     note: 'Auto-parsed from Model; override anytime.' },
    { col: '6', field: 'Colour',        required: 'optional',     note: 'Single colour per row.' },
    { col: '7', field: 'Supplier',      required: 'always',       note: 'Pick from existing list or type a new name.' },
    { col: '8', field: 'BP (£)',        required: 'always',       note: 'Buying Price — must be > 0.' },
    { col: '9', field: 'Notes',         required: 'optional',     note: 'Free text — condition, lock state, etc.' },
  ];
  const toneFor = (r: 'always' | 'shs-optional' | 'optional') =>
    r === 'always'       ? { dot: 'bg-rose-500',  text: 'text-rose-700',  bg: 'bg-rose-50',  label: 'Required' }
    : r === 'shs-optional'? { dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Required (Office)' }
    :                       { dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50', label: 'Optional' };

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-900 flex items-center gap-2">
            <Info size={14} /> Required Fields · Buy Schema
          </p>
          <p className="text-[10px] font-mono text-indigo-700/70 mt-1">
            Every unit added via Add Stock or Add SHS uses these 9 columns. Listing / marketplace is captured on Sell.
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-100 text-indigo-600 transition-all">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {fields.map(f => {
          const t = toneFor(f.required);
          return (
            <div key={f.field} className="flex items-start gap-3 bg-white border border-indigo-100 rounded-xl px-3 py-2.5">
              <span className="text-[10px] font-mono text-indigo-400 w-4 text-center flex-shrink-0">{f.col}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-900 truncate">{f.field}</p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 leading-snug">{f.note}</p>
              </div>
              <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest ${t.text} ${t.bg} px-1.5 py-0.5 rounded border border-current/10 flex-shrink-0`}>
                <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} /> {t.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Small colour swatch for the grouped overlay. Maps the raw colour
 *  string (BLACK / WHITE / PINK / "Space Grey") to a CSS background.
 *  Falls back to a neutral grey for anything we don't recognise so the
 *  layout stays stable even when suppliers spell new colours. */
function ColourDot({ colour }: { colour: string }) {
  const c = (colour || '').trim().toLowerCase();
  const bg =
    /(^|\s)(black|jet|midnight|graphite|carbon)/.test(c) ? '#1f2937' :
    /(^|\s)(white|silver|starlight|chalk)/.test(c)        ? '#e5e7eb' :
    /(^|\s)(gold|yellow|sand)/.test(c)                    ? '#f5d77a' :
    /(^|\s)(pink|rose|coral)/.test(c)                     ? '#f9a8d4' :
    /(^|\s)(red|cardinal|product\s*red)/.test(c)          ? '#dc2626' :
    /(^|\s)(blue|navy|ocean|sierra|cobalt)/.test(c)       ? '#2563eb' :
    /(^|\s)(green|olive|mint|sage|alpine)/.test(c)        ? '#10b981' :
    /(^|\s)(purple|violet|lilac|deep\s*purple|orchid)/.test(c) ? '#7c3aed' :
    /(^|\s)(grey|gray|grafite|space)/.test(c)             ? '#9ca3af' :
    /(^|\s)(orange|amber|copper|sunset)/.test(c)          ? '#f59e0b' :
    '#cbd5e1';
  const ring = bg === '#e5e7eb' ? 'ring-1 ring-slate-300' : '';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${ring}`} style={{ background: bg }} />;
}

// ── Table cells ──────────────────────────────────────────────────────────────
function Th({
  children, k, sort, onSort, sticky, leftPx, width, align,
}: {
  children: React.ReactNode;
  k?: SortKey | '';
  sort: { key: SortKey; dir: SortDir };
  onSort?: (k: SortKey) => void;
  sticky?: boolean;
  leftPx?: number;
  width?: string;
  align?: 'left' | 'right';
}) {
  const active = k && sort.key === k;
  const cls = `text-${align ?? 'left'} px-3 py-2.5 sticky top-0 z-10 bg-slate-50 border-b border-slate-200 font-bold ${
    sticky ? 'z-20 border-r border-slate-200' : ''
  }`;
  const style: React.CSSProperties = {
    minWidth: width, width,
    ...(sticky ? { left: `${leftPx ?? 0}px` } : {}),
  };
  return (
    <th className={cls} style={style}>
      {k && onSort ? (
        <button onClick={() => onSort(k as SortKey)} className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors">
          {children}
          {active ? (sort.dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : <ChevronsUpDown size={10} className="opacity-40" />}
        </button>
      ) : children}
    </th>
  );
}

function Td({
  children, sticky, leftPx, align, className,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  leftPx?: number;
  align?: 'left' | 'right';
  className?: string;
}) {
  const style: React.CSSProperties = sticky ? { left: `${leftPx ?? 0}px`, position: 'sticky' as const, zIndex: 5 } : {};
  return (
    <td
      className={`text-${align ?? 'left'} px-3 py-1.5 border-b border-slate-100 align-middle ${className ?? ''}`}
      style={style}
    >
      {children}
    </td>
  );
}

function InlineEditableCell({
  editing, onActivate, onCommit, onCancel, initialValue, display, align, type,
}: {
  editing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => Promise<void>;
  onCancel: () => void;
  initialValue: string;
  display: React.ReactNode;
  align?: 'left' | 'right';
  type?: 'text' | 'number' | 'date';
}) {
  const [val, setVal] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setVal(initialValue); setTimeout(() => inputRef.current?.focus(), 0); } }, [editing, initialValue]);
  if (!editing) {
    return (
      <button
        onDoubleClick={onActivate}
        className={`block w-full text-${align ?? 'left'} cursor-text hover:bg-slate-100/80 rounded px-1 -mx-1`}
        title="Double-click to edit"
      >{display}</button>
    );
  }
  return (
    <input
      ref={inputRef}
      type={type ?? 'text'}
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={async e => {
        if (e.key === 'Enter') await onCommit(val);
        else if (e.key === 'Escape') onCancel();
      }}
      onBlur={async () => { await onCommit(val); }}
      className={`w-full text-${align ?? 'left'} bg-white border border-indigo-500 rounded px-1.5 py-0.5 text-[11px] focus:outline-none font-mono`}
    />
  );
}

function InlineEditableSelect({
  editing, onActivate, onCommit, onCancel, value, options, display, formatLabel,
}: {
  editing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => Promise<void>;
  onCancel: () => void;
  value: string;
  options: string[];
  display: React.ReactNode;
  formatLabel?: (v: string) => string;
}) {
  if (!editing) {
    return (
      <button
        onDoubleClick={onActivate}
        className="block w-full text-left cursor-pointer hover:bg-slate-100/80 rounded px-1 -mx-1"
        title="Double-click to change"
      >{display}</button>
    );
  }
  return (
    <select
      autoFocus
      defaultValue={value}
      onChange={async e => { await onCommit(e.target.value); }}
      onBlur={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
      className="w-full bg-white border border-indigo-500 rounded px-1 py-0.5 text-[10px] focus:outline-none"
    >
      {options.map(o => <option key={o} value={o}>{formatLabel ? formatLabel(o) : (o || '—')}</option>)}
    </select>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function titleFor(kpi: KpiId): string {
  switch (kpi) {
    case 'today':      return 'Stock Added Today';
    case 'office':     return 'All Office Stock';
    case 'shs':        return 'SHS Stock';
    case 'sold_today': return 'Sold Today';
  }
}

function sortUnits(
  units: InventoryUnit[],
  sort: { key: SortKey; dir: SortDir },
  supplierMap: Record<string, string>,
): InventoryUnit[] {
  const mult = sort.dir === 'asc' ? 1 : -1;
  const get = (u: InventoryUnit): string | number => {
    switch (sort.key) {
      case 'dateIn':   return u.dateIn || '';
      case 'model':    return (u.model || '').toLowerCase();
      case 'storage':  return (u.storage || '').toLowerCase();
      case 'colour':   return (u.colour || '').toLowerCase();
      case 'buyPrice': return u.buyPrice || 0;
      case 'supplier': return (supplierMap[u.supplierId] || u.supplierName || '').toLowerCase();
      case 'grade':    return (u.grade || '').toLowerCase();
      default:         return '';
    }
  };
  return [...units].sort((a, b) => {
    const av = get(a); const bv = get(b);
    if (av < bv) return -1 * mult;
    if (av > bv) return  1 * mult;
    return 0;
  });
}

function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  if (rows.length === 0) {
    const blob = new Blob(['(no rows)\n'], { type: 'text/csv' });
    triggerDownload(filename, blob);
    return;
  }
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename, blob);
}

function triggerDownload(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
