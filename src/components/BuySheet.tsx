/**
 * BuySheet — dashboard for the Buy tab.
 *
 * Per the client's whiteboard (17-May), this page has exactly:
 *   - 4 clickable KPI tiles (each opens an Excel-style overlay):
 *       1. Stock Added In Last 72 Hours
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
  Search, Plus, ChevronDown, ChevronUp, ChevronsUpDown,
  Filter, X, Trash2, Info, Sparkles, Eye,
  PackageX, TrendingDown, AlertTriangle,
  FileSpreadsheet, ScanLine,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, InventoryAggregate, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { shsAggregatesFrom } from '../lib/shsCount';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { auth, isAdmin } from '../lib/firebase';
import IntelligencePanel from './IntelligencePanel';
import AddStockManualModal from './AddStockManualModal';
import BulkOrderModal from './BulkOrderModal';
import ResetDataModal from './ResetDataModal';
import StockOverlayModal, {
  buildGroupedModels, sortGroupedModels, GroupedExcelTable,
  DEFAULT_GROUP_SORT, sortUnits,
  type SortKey, type SortDir, type GroupSort, type GroupedModel,
} from './StockOverlayModal';
import PaginationBar, { usePagedRows } from './PaginationBar';
import ReportRangeMenu from './ReportRangeMenu';

// ── Types ────────────────────────────────────────────────────────────────────

type KpiId = 'recent' | 'office' | 'shs' | 'sold_today';
type StatusFilter = 'all' | 'available' | 'sold' | 'incoming' | 'returned';

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
  const { units, suppliers, aggregates, sales } = useInventoryStore();
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
  const [bulkOrderOpen, setBulkOrderOpen] = useState(false);
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);
  const [showResetData, setShowResetData] = useState(false);

  // ── Derived sets per KPI ──────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  /** Re-evaluated every 5 minutes so the 72h rolling window slides without
   *  a page refresh. Cheaper than re-running the filter on every tick and
   *  the operator never notices a 5-minute lag at the boundary. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  /** Coerce a "YYYY-MM-DD" Stock In string to local midnight millis.
   *  Operators think in local days, so we parse in the local TZ rather
   *  than UTC — a unit stocked in on the 6th of June reads as
   *  "06:00 of the 6th" in London during BST, not "07:00 the day
   *  before" the way `new Date('2026-06-06')` would give you. */
  const parseStockInDate = (s: string | undefined): number => {
    if (!s) return 0;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) {
      const t = new Date(s).getTime();
      return Number.isFinite(t) ? t : 0;
    }
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  };

  // "Stock Added In Last 72 Hours" — every unit whose Stock In date
  // falls inside the rolling 72-hour window. We key off `dateIn` (the
  // operator-visible "Stock In" column) so the KPI always reconciles
  // with the row: if you see a unit dated 6 Jun on the sheet, the
  // tile counts it iff that date is < 72h ago. dateIn is a date-only
  // string, so it's interpreted as 00:00 local — that's the most
  // precise window the field can give us, and it matches the
  // operator's mental model better than the Firestore timestamp
  // (which spikes after an import even though no new stock arrived).
  // Parser-synth SHS placeholders stay excluded.
  const cutoffMs = nowMs - 72 * 60 * 60 * 1000;
  const recentUnits = useMemo(
    () => units.filter(u => {
      if ((u.id || '').startsWith('shs_') && u.status === 'incoming') return false;
      const ts = parseStockInDate(u.dateIn);
      return ts > 0 && ts >= cutoffMs;
    }),
    [units, cutoffMs],
  );

  // "All Office Stock" — status='available' (anywhere, any colour). Plus any
  // master-rollup quantity not yet IMEI-tracked is reflected in the count
  // (see kpiCounts below) but doesn't add visible rows.
  // "All Office Stock" — units sellable from the office. Strictly that's
  // status='available', but a unit can get stuck on status='returned' even
  // when ProcessReturn was run as "Back to Inventory" (write race / stale
  // cache). The ProcessReturn flow sets returnType='returned_to_inventory'
  // in the same patch as status='available' — if the second field gets
  // lost in transit, the unit becomes invisible to Sell/Buy surfaces
  // despite the operator marking it back in stock. Defensive: also accept
  // units flagged returned_to_inventory that haven't been re-sold yet,
  // so a stuck status doesn't trap inventory.
  const officeUnits = useMemo(() => units.filter(u =>
    u.status === 'available' ||
    (u.returnType === 'returned_to_inventory' && u.status !== 'sold')
  ), [units]);

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
      recent: recentUnits.length,
      office: Math.max(aggOffice, officeUnits.length),
      shs: shsCount,
      soldToday: soldToday.length,
    };
  }, [aggregates, recentUnits.length, officeUnits.length, shsAggs.length, shsUnits.length, soldToday.length]);

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
      case 'recent':     base = recentUnits; break;
      case 'office':     base = officeUnits; break;
      case 'shs':        base = shsUnits; break;
      case 'sold_today': base = soldToday; break;
      default:           base = units;
    }
    return applyPanelFilters(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, recentUnits, officeUnits, shsUnits, soldToday, units, search, statusFilter, supplierFilter, supplierMap]);

  // Rows for the always-on inline table (every unit, panel-filtered).
  const inlineRows = useMemo<InventoryUnit[]>(
    () => sortUnits(applyPanelFilters(units), sort, supplierMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, search, statusFilter, supplierFilter, supplierMap, sort],
  );

  // Sort the overlay rows.
  const sortedRows = useMemo(() => sortUnits(overlayRows, sort, supplierMap), [overlayRows, sort, supplierMap]);

  // ── Inventory report — timestamped snapshot of the FULL buy inventory ─────
  // Operator's daily report. Columns mirror the 9-column buy schema exactly —
  // no listing / marketplace / sale fields here because those are captured in
  // the Sell flow. The filename carries YYYY-MM-DD_HHMM so multiple pulls in
  // the same day don't clobber each other and the file sorts chronologically
  // in a folder.
  //
  // Sold units are soft-deleted from this report — once a unit ships, it's
  // operator-tracked through the Sales report instead. Returned + incoming
  // (SHS) units stay because they're still our inventory.
  const handleInventoryReport = async (range: { from?: string; to?: string; label: string }) => {
    // Scope by Stock In date when a range is selected; without a range
    // (All Time preset) the report is the full snapshot like before.
    const inStock = units.filter(u => {
      if (u.status === 'sold') return false;
      if (range.from && (u.dateIn || '') < range.from) return false;
      if (range.to && (u.dateIn || '') > range.to) return false;
      return true;
    });
    const all = sortUnits(inStock, sort, supplierMap);
    const MS_PER_DAY = 86_400_000;
    const nowMs = Date.now();
    const rows = all.map(u => {
      // Computed at export time — matches the AGE column on the
      // master Excel IMEI NUMBERS sheet (see clientReport.ts:174).
      // Today minus dateIn, clamped at 0. Blank when dateIn is
      // missing rather than NaN.
      const dt = u.dateIn ? new Date(u.dateIn).getTime() : NaN;
      const age = Number.isFinite(dt)
        ? Math.max(0, Math.floor((nowMs - dt) / MS_PER_DAY))
        : '';
      return {
        'Stock In Date': u.dateIn || '',
        'Model':         u.model || '',
        'IMEI':          u.imei || '',
        'Grade':         u.grade || '',
        'Storage':       u.storage || '',
        'Colour':        u.colour || '',
        'Supplier':      supplierMap[u.supplierId] || u.supplierName || '',
        'BP':            u.buyPrice ?? '',
        'Notes':         u.notes || '',
        // Export-only — the BuySheet CSV is download-only and isn't
        // re-ingested by InventoryReportImport, so adding a column
        // here is purely a presentation change.
        'Age (days)':    age,
      };
    });
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    downloadCsv(`inventory-report-${range.label}-${stamp}.csv`, rows);
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
            onClick={() => setBulkOrderOpen(true)}
            title="Bulk order — set shared metadata, scan IMEIs per colour, review and save"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all"
          >
            <ScanLine size={12} /> Bulk Order
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
          <ReportRangeMenu
            label="Inventory Report"
            icon={<FileSpreadsheet size={12} />}
            tone="emerald"
            onDownload={handleInventoryReport}
          />
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
            label="Stock Added In Last 72 Hours"
            value={kpiCounts.recent}
            tone="emerald"
            onClick={() => setOverlay('recent')}
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
      <IntelligencePanel units={units} sales={sales} mode="buy" />

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
          <StockOverlayModal
            title={titleFor(overlay)}
            rows={sortedRows}
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
        {bulkOrderOpen && <BulkOrderModal onClose={() => setBulkOrderOpen(false)} />}
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
  // Default open so alerts stay visible on first render; the operator
  // can collapse to save vertical space once they've triaged the list.
  const [open, setOpen] = useState(true);
  const headerCls = tone === 'rose'
    ? 'bg-rose-50/60 border-b border-rose-100 text-rose-800 hover:bg-rose-50'
    : 'bg-amber-50/60 border-b border-amber-100 text-amber-800 hover:bg-amber-50';
  const rowHover = tone === 'rose' ? 'hover:bg-rose-50/40' : 'hover:bg-amber-50/40';
  const dotTone = tone === 'rose' ? 'bg-rose-500' : 'bg-amber-500';
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`w-full px-4 py-2 flex items-center gap-2 transition-colors text-left ${headerCls} ${open ? '' : 'border-b-transparent'}`}
      >
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest">{title}</p>
          <p className="text-[8px] font-mono opacity-70">{hint}</p>
        </div>
        <span className="text-[9px] font-mono bg-white/70 px-1.5 py-0.5 rounded">{rows.length}</span>
        <span className="opacity-60 flex-shrink-0">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>
      {open && (
        rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[10px] font-mono text-slate-400">{empty}</p>
        ) : (
          // Cap at ~5 rows visible (each row is ~49px including the
          // divide-y border); anything beyond scrolls internally so
          // SOLD OUT and RUNNING LOW columns stay the same height in
          // the side-by-side layout. Operator screenshot showed
          // RUNNING LOW with ~12 entries vs SOLD OUT with 2 — the
          // page stretched vertically to fit the longer column,
          // pushing the Stock Visibility chart way off screen.
          <div className="max-h-[245px] overflow-y-auto divide-y divide-slate-100">
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
        )
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

  // 100 model-groups per page — big imports can land hundreds of models
  // and the operator's perf rule is "anything over 100 rows pages".
  const { page, setPage, totalPages, paged, total } = usePagedRows<GroupedModel>(grouped);

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
          groups={paged}
          expanded={expanded}
          onToggle={toggle}
          region={region}
          sort={groupedSort}
          onSort={setGroupedSort}
        />
      </div>
      <PaginationBar page={page} totalPages={totalPages} total={total} onPage={setPage} itemLabel="models" />
      <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 text-[9px] font-mono uppercase tracking-widest text-slate-500">
        Click a row to see colour breakdown · open a KPI tile above for per-IMEI detail
      </div>
    </div>
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
    case 'recent':     return 'Stock Added In Last 72 Hours';
    case 'office':     return 'All Office Stock';
    case 'shs':        return 'SHS Stock';
    case 'sold_today': return 'Sold Today';
  }
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
