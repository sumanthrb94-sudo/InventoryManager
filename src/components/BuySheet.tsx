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
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, InventoryAggregate } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { manualShsUnitsFrom, shsAggregatesFrom } from '../lib/shsCount';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { auth, isAdmin } from '../lib/firebase';
import CopyImei from './CopyImei';
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

  // "SHS Stock" — manually-logged SHS units (status='incoming' not synth) +
  // master-file SHS aggregates. Both appear as rows in the overlay.
  const shsUnits = useMemo(() => manualShsUnitsFrom(units), [units]);
  const shsAggs = useMemo(() => shsAggregatesFrom(aggregates), [aggregates]);

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
    // SHS rollup = aggregate SHS rows summed + manual SHS units.
    const shsCount = shsAggs.length + shsUnits.length;
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
    // Apply panel filters on top
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
  }, [overlay, todayUnits, officeUnits, shsUnits, soldToday, units, search, statusFilter, supplierFilter, supplierMap]);

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

  // ── Inline cell save ──────────────────────────────────────────────────────
  const saveCell = async (u: InventoryUnit, field: string, value: any) => {
    const patch: Record<string, any> = { [field]: value };
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

        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[9px] font-mono uppercase tracking-widest text-slate-500">
          Filter applies to whichever KPI tile you open · click a tile above to view rows
        </div>
      </div>

      {/* ── Excel overlay modal — opens when a KPI tile is clicked ────────── */}
      <AnimatePresence>
        {overlay && (
          <BuyExcelOverlay
            title={titleFor(overlay)}
            rows={sortedRows}
            sort={sort}
            onSort={setSort}
            supplierMap={supplierMap}
            shsAggregates={overlay === 'shs' ? shsAggs : []}
            region={region}
            onClose={() => setOverlay(null)}
            onSaveCell={saveCell}
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

// ── Excel overlay modal ─────────────────────────────────────────────────────
function BuyExcelOverlay({
  title, rows, sort, onSort, supplierMap, shsAggregates, region, onClose, onSaveCell,
}: {
  title: string;
  rows: InventoryUnit[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  shsAggregates: InventoryAggregate[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
  onSaveCell: (u: InventoryUnit, field: string, value: any) => Promise<void>;
}) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  // Esc closes the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalValue = useMemo(
    () => rows.reduce((s, u) => s + (u.buyPrice || 0), 0)
        + shsAggregates.reduce((s, a) => s + ((a.buyPrice || 0) * (a.quantityNum || 0)), 0),
    [rows, shsAggregates],
  );
  const totalCount = rows.length
    + shsAggregates.reduce((s, a) => s + (a.quantityNum || 0), 0);

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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {totalCount.toLocaleString()} {totalCount === 1 ? 'unit' : 'units'} · £{totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        {/* Excel-style table */}
        <div className="flex-1 overflow-auto">
          {rows.length === 0 && shsAggregates.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <Sparkles size={28} />
              <p className="text-[11px] font-mono uppercase tracking-widest">No rows match the active filter</p>
            </div>
          ) : (
            <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              <thead>
                <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
                  <Th k="dateIn"   sort={sort} onSort={toggleSort} width="110px" sticky leftPx={0}>Stock In</Th>
                  <Th k="model"    sort={sort} onSort={toggleSort} width="260px">Model</Th>
                  <Th k=""         sort={sort} onSort={undefined} width="180px">IMEI / Serial</Th>
                  <Th k="grade"    sort={sort} onSort={toggleSort} width="100px">Grade</Th>
                  <Th k="storage"  sort={sort} onSort={toggleSort} width="80px">Storage</Th>
                  <Th k="colour"   sort={sort} onSort={toggleSort} width="120px">Colour</Th>
                  <Th k="supplier" sort={sort} onSort={toggleSort} width="130px">Supplier</Th>
                  <Th k="buyPrice" sort={sort} onSort={toggleSort} width="80px" align="right">BP (£)</Th>
                  <Th k=""         sort={sort} onSort={undefined} width="220px">Notes</Th>
                </tr>
              </thead>
              <tbody>
                {/* SHS aggregate rows render at the top — they don't have IMEIs but
                    do appear in the SHS Stock overlay. */}
                {shsAggregates.map(a => {
                  const supplierName = a.supplierIds?.[0] ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0]) : '—';
                  return (
                    <tr key={`agg-${a.id}`} className="bg-amber-50/40 hover:bg-amber-50/70 transition-colors">
                      <Td sticky leftPx={0} className="bg-amber-50/40 border-r border-amber-100"><span className="text-slate-400">—</span></Td>
                      <Td><span className="font-bold text-slate-900">{a.model}</span></Td>
                      <Td>
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded uppercase tracking-widest">
                          <Truck size={9} /> SHS · {a.quantityNum ?? '?'}
                        </span>
                      </Td>
                      <Td><span className="text-slate-400">—</span></Td>
                      <Td><span className="text-slate-600">{a.storage || '—'}</span></Td>
                      <Td><span className="text-slate-600 truncate">{a.coloursRaw || '—'}</span></Td>
                      <Td><span className="text-slate-700">{supplierName}</span></Td>
                      <Td align="right"><span className="font-bold text-slate-900">£{a.buyPrice ?? '—'}</span></Td>
                      <Td><span className="text-slate-500 truncate" title={a.notes || ''}>{a.notes || ''}</span></Td>
                    </tr>
                  );
                })}
                {rows.map((u, idx) => {
                  const isAlt = idx % 2 === 1;
                  const supplierName = supplierMap[u.supplierId] || u.supplierName || '—';
                  const rowBg = isAlt ? 'bg-slate-50/40 hover:bg-slate-100/60' : 'bg-white hover:bg-slate-50';
                  const apple = isAppleDevice(u.model);
                  const imeiValid = isValidImei(u.imei, { isAppleSerial: apple });
                  const tone = STATUS_TONE[u.status] || STATUS_TONE.available;
                  return (
                    <tr key={u.id} className={`${rowBg} transition-colors group`}>
                      <Td sticky leftPx={0} className={`${rowBg} border-r border-slate-200`}>
                        <span className="text-slate-700">{fmtDateForUser(u.dateIn || '', region) || u.dateIn || '—'}</span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 truncate max-w-[220px]" title={u.model}>{u.model || '—'}</span>
                          <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text} flex-shrink-0`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                            {u.status}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        {imeiValid ? (
                          <CopyImei imei={u.imei} truncate={18} />
                        ) : u.status === 'incoming' ? (
                          <span className="text-[10px] font-mono text-slate-400 italic">Optional for SHS</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono">
                            <AlertCircle size={10} /> {u.imei ? 'invalid' : 'missing'}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <InlineEditableSelect
                          editing={editingCell?.id === u.id && editingCell?.field === 'grade'}
                          onActivate={() => setEditingCell({ id: u.id, field: 'grade' })}
                          onCommit={async v => { await onSaveCell(u, 'grade', v); setEditingCell(null); }}
                          onCancel={() => setEditingCell(null)}
                          value={u.grade || ''}
                          options={['', 'A', 'B', 'C', 'ONU', 'Brand new']}
                          formatLabel={v => v || '—'}
                          display={<span className="text-slate-700">{u.grade || <span className="text-slate-300">—</span>}</span>}
                        />
                      </Td>
                      <Td><span className="text-slate-600">{u.storage || '—'}</span></Td>
                      <Td><span className="text-slate-600 truncate">{u.colour || '—'}</span></Td>
                      <Td><span className="text-slate-700 truncate" title={supplierName}>{supplierName}</span></Td>
                      <Td align="right">
                        <InlineEditableCell
                          editing={editingCell?.id === u.id && editingCell?.field === 'buyPrice'}
                          onActivate={() => setEditingCell({ id: u.id, field: 'buyPrice' })}
                          onCommit={async v => { await onSaveCell(u, 'buyPrice', Number(v) || 0); setEditingCell(null); }}
                          onCancel={() => setEditingCell(null)}
                          initialValue={String(u.buyPrice ?? 0)}
                          display={<span className="font-bold text-slate-900">£{u.buyPrice ?? 0}</span>}
                          align="right"
                          type="number"
                        />
                      </Td>
                      <Td>
                        <InlineEditableCell
                          editing={editingCell?.id === u.id && editingCell?.field === 'notes'}
                          onActivate={() => setEditingCell({ id: u.id, field: 'notes' })}
                          onCommit={async v => { await onSaveCell(u, 'notes', v); setEditingCell(null); }}
                          onCancel={() => setEditingCell(null)}
                          initialValue={u.notes || ''}
                          display={<span className="text-slate-500 truncate" title={u.notes || ''}>{u.notes || ''}</span>}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 flex-shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>Double-click any cell to edit · ESC to close</span>
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
  type?: 'text' | 'number';
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
