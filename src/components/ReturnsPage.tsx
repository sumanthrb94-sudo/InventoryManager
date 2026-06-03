/**
 * ReturnsPage — returns dashboard for the Returns tab.
 *
 * Per client spec (17-May whiteboard) returns branch two ways:
 *
 *   1. In our inventory only
 *      a. Back to inventory — unit becomes 'available' again
 *      b. In repair         — being fixed; later flipped to ready-to-ship
 *   2. Sent to supplier      — SOFT delete (the unit doc stays so the row is
 *                              visible in returns history, but it's excluded
 *                              from active office stock surfaces)
 *
 * Page layout mirrors Buy/Sell:
 *   - Action row: Process Return · Schema · Export CSV
 *   - 4 clickable KPI tiles (each opens an Excel overlay):
 *       Back to Inventory · In Repair · Returned to Supplier · All Returns
 *   - Filter panel (search + type pills + supplier chips)
 *   - Always-on inline Excel sheet with the returns schema:
 *       Return Date · IMEI · Model · Storage · Colour · Supplier · BP ·
 *       Type · Reason · Notes
 *   - KPI overlay modal for focused subset views
 *
 * The modal flows that already worked are kept — picker → ProcessReturnModal
 * for new returns, QuickRepairModal to flag a sold unit straight into
 * repair, and ReadyToShipModal to flip a repaired unit back to available.
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, ChevronDown, ChevronUp, ChevronsUpDown, MoreHorizontal,
  Filter, X, Download, AlertCircle, Plus, Info, Sparkles, Eye,
  PackageCheck, ArrowUpRight, Wrench, ShieldAlert, ShieldCheck, CheckCircle2,
  Truck, RefreshCw, RotateCcw,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, ReturnCategory } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import { getWarrantyStatus } from '../lib/warrantyUtils';
import { groupReturnEventsByImei } from '../lib/returnsLifecycle';
import CopyImei from './CopyImei';

// ── Types ────────────────────────────────────────────────────────────────────

type KpiId = 'back_to_inventory' | 'in_repair' | 'to_supplier' | 'all';
type ReturnFilter = 'all' | ReturnCategory;
type SortKey = 'returnDate' | 'model' | 'storage' | 'colour' | 'buyPrice' | 'supplier' | 'returnType';
type SortDir = 'asc' | 'desc';

const TYPE_TONE: Record<ReturnCategory, { bg: string; text: string; dot: string; label: string }> = {
  returned_to_inventory: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'To Inventory' },
  repair:                { bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'In Repair' },
  returned_to_supplier:  { bg: 'bg-amber-50 border-amber-200',     text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'To Supplier' },
};

const todayStr = () => new Date().toISOString().split('T')[0];

// ── Component ────────────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const { units, suppliers, sales } = useInventoryStore();
  const region = useUserRegion();

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── Filters / sort ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ReturnFilter>('all');
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'returnDate', dir: 'desc' });

  // ── Modals + overlay ──────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<KpiId | null>(null);
  const [processingUnit, setProcessingUnit] = useState<InventoryUnit | null>(null);
  const [repairUnit, setRepairUnit] = useState<InventoryUnit | null>(null);
  const [readyShipUnit, setReadyShipUnit] = useState<InventoryUnit | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);

  // ── Indexes ───────────────────────────────────────────────────────────────
  // A "return" is any unit that has been processed through a return — its
  // returnType field is set. Status may now be 'returned' (in repair / to
  // supplier soft-delete) OR 'available' (back to inventory).
  const allReturns = useMemo<InventoryUnit[]>(
    () => units.filter(u => !!u.returnType),
    [units],
  );
  const backToInventory = useMemo(() => allReturns.filter(u => u.returnType === 'returned_to_inventory'), [allReturns]);
  const inRepair        = useMemo(() => allReturns.filter(u => u.returnType === 'repair'), [allReturns]);
  const toSupplier      = useMemo(() => allReturns.filter(u => u.returnType === 'returned_to_supplier'), [allReturns]);

  // Sold units eligible to be returned (have a sale record + still sold)
  const eligibleForReturn = useMemo(
    () => units.filter(u => u.status === 'sold' && !!u.salePrice),
    [units],
  );

  // Every unit that has ever been sold (active OR voided sale), looked up by
  // unitId. Used by the Return History timeline to keep the 'Sold' chip on a
  // unit's journey even after a supplier return cleared the sale fields off
  // the unit doc itself.
  const everSoldUnitIds = useMemo(() => {
    const s = new Set<string>();
    for (const sale of sales) {
      if (sale.unitId) s.add(sale.unitId);
    }
    return s;
  }, [sales]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const today = todayStr();
    const todayCount = allReturns.filter(u => u.returnDate === today).length;
    return {
      backToInventory: backToInventory.length,
      inRepair: inRepair.length,
      toSupplier: toSupplier.length,
      all: allReturns.length,
      todayCount,
    };
  }, [allReturns, backToInventory.length, inRepair.length, toSupplier.length]);

  // ── Filter chip options ───────────────────────────────────────────────────
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of allReturns) {
      const sn = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
      set.add(sn);
    }
    return Array.from(set).sort();
  }, [allReturns, supplierMap]);

  // ── Filter + sort helpers ─────────────────────────────────────────────────
  const applyFilters = (base: InventoryUnit[]): InventoryUnit[] => {
    const q = search.trim().toLowerCase();
    return base.filter(u => {
      if (typeFilter !== 'all' && u.returnType !== typeFilter) return false;
      if (supplierFilter.size > 0) {
        const sn = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
        if (!supplierFilter.has(sn)) return false;
      }
      if (q) {
        const hay = [
          u.imei, u.model, u.storage, u.colour, u.grade,
          supplierMap[u.supplierId] || u.supplierName, u.returnReason, u.notes,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };
  const sortUnits = (list: InventoryUnit[]): InventoryUnit[] => {
    const mult = sort.dir === 'asc' ? 1 : -1;
    const get = (u: InventoryUnit): string | number => {
      switch (sort.key) {
        case 'returnDate': return u.returnDate || '';
        case 'model':      return (u.model || '').toLowerCase();
        case 'storage':    return (u.storage || '').toLowerCase();
        case 'colour':     return (u.colour || '').toLowerCase();
        case 'buyPrice':   return u.buyPrice || 0;
        case 'supplier':   return (supplierMap[u.supplierId] || u.supplierName || '').toLowerCase();
        case 'returnType': return u.returnType || '';
        default:           return '';
      }
    };
    return [...list].sort((a, b) => {
      const av = get(a); const bv = get(b);
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return 0;
    });
  };

  // ── Inline rows (always-on table) ─────────────────────────────────────────
  const inlineRows = useMemo(
    () => sortUnits(applyFilters(allReturns)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allReturns, search, typeFilter, supplierFilter, supplierMap, sort],
  );

  // ── Overlay rows ──────────────────────────────────────────────────────────
  const overlayRows = useMemo<InventoryUnit[]>(() => {
    if (!overlay) return [];
    let base: InventoryUnit[];
    switch (overlay) {
      case 'back_to_inventory': base = backToInventory; break;
      case 'in_repair':         base = inRepair; break;
      case 'to_supplier':       base = toSupplier; break;
      case 'all':               base = allReturns; break;
      default:                  base = [];
    }
    return sortUnits(applyFilters(base));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, allReturns, backToInventory, inRepair, toSupplier, search, typeFilter, supplierFilter, supplierMap, sort]);

  // ── CSV export ────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const source = overlay ? overlayRows : inlineRows;
    const rows = source.map(u => ({
      'Return Date': u.returnDate || '',
      'IMEI':        u.imei || '',
      'Model':       u.model || '',
      'Storage':     u.storage || '',
      'Colour':      u.colour || '',
      'Supplier':    supplierMap[u.supplierId] || u.supplierName || '',
      'BP':          u.buyPrice ?? 0,
      'Type':        TYPE_TONE[u.returnType as ReturnCategory]?.label || u.returnType || '',
      'Reason':      u.returnReason || '',
      'Notes':       u.notes || '',
    }));
    downloadCsv('returns.csv', rows);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header card: action row + KPI tiles ───────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap justify-end mb-4">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
          >
            <Plus size={12} /> Process Return
          </button>
          <button
            onClick={() => setShowSchemaHelp(s => !s)}
            title="Returns schema reference"
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
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <BigKpiTile
            label="Back to Inventory"
            value={kpis.backToInventory}
            sub="Re-stocked · available again"
            tone="emerald"
            onClick={() => setOverlay('back_to_inventory')}
          />
          <BigKpiTile
            label="In Repair"
            value={kpis.inRepair}
            sub="Being fixed · ready to flip"
            tone="blue"
            onClick={() => setOverlay('in_repair')}
          />
          <BigKpiTile
            label="Returned to Supplier"
            value={kpis.toSupplier}
            sub="Soft-deleted · audit only"
            tone="amber"
            onClick={() => setOverlay('to_supplier')}
          />
          <BigKpiTile
            label="All Returns"
            value={kpis.all}
            sub={`${kpis.todayCount} today`}
            tone="slate"
            onClick={() => setOverlay('all')}
          />
        </div>
      </div>

      {/* ── Schema help card ──────────────────────────────────────────────── */}
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

      {/* ── Filter panel ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IMEI, model, supplier, reason…"
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

          {/* Type pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {([
              ['all',                   'All',          kpis.all],
              ['returned_to_inventory', 'To Inventory', kpis.backToInventory],
              ['repair',                'In Repair',    kpis.inRepair],
              ['returned_to_supplier',  'To Supplier',  kpis.toSupplier],
            ] as Array<[ReturnFilter, string, number]>).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setTypeFilter(id)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all flex-shrink-0
                  ${typeFilter === id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {label}
                <span className={`text-[9px] font-mono px-1 rounded ${typeFilter === id ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>
                  {n}
                </span>
              </button>
            ))}
            {(typeFilter !== 'all' || supplierFilter.size > 0 || search) && (
              <button
                onClick={() => { setTypeFilter('all'); setSupplierFilter(new Set()); setSearch(''); }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 transition-all flex-shrink-0"
              >
                <X size={11} /> Reset
              </button>
            )}
          </div>

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
            Showing <span className="text-slate-900 font-bold">{inlineRows.length.toLocaleString()}</span> of {allReturns.length.toLocaleString()} returns
          </span>
          <span className="hidden sm:inline">
            Sort: <span className="text-slate-900 font-bold">{sort.key}</span> {sort.dir === 'asc' ? '↑' : '↓'}
          </span>
        </div>
      </div>

      {/* ── Inline Excel sheet ────────────────────────────────────────────── */}
      <InlineSheet
        rows={inlineRows}
        sort={sort}
        onSort={setSort}
        supplierMap={supplierMap}
        region={region}
        onRepair={u => setRepairUnit(u)}
        onReadyShip={u => setReadyShipUnit(u)}
        onReprocess={u => setProcessingUnit(u)}
      />

      {/* ── Activity history at the bottom ────────────────────────────────
          Visual timeline of return events, grouped by date bucket. Shows
          each unit's journey (Sold → Returned, Returned → Repair → Back to
          Stock, etc.) so the operator can see at a glance which returns
          completed the loop. */}
      <ReturnHistorySection
        units={allReturns}
        everSoldUnitIds={everSoldUnitIds}
        supplierMap={supplierMap}
        region={region}
        onReadyShip={u => setReadyShipUnit(u)}
      />

      {/* ── KPI overlay modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {overlay && (
          <ReturnsExcelOverlay
            title={titleFor(overlay)}
            rows={overlayRows}
            sort={sort}
            onSort={setSort}
            supplierMap={supplierMap}
            region={region}
            onClose={() => setOverlay(null)}
            onRepair={u => setRepairUnit(u)}
            onReadyShip={u => setReadyShipUnit(u)}
            onReprocess={u => setProcessingUnit(u)}
          />
        )}
      </AnimatePresence>

      {/* ── Per-IMEI lifecycle history (Returns Report) ─────────────────── */}
      <ReturnsReport />

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {pickerOpen && (
          <ReturnUnitPicker
            sold={eligibleForReturn}
            supplierMap={supplierMap}
            onClose={() => setPickerOpen(false)}
            onPick={u => { setPickerOpen(false); setProcessingUnit(u); }}
          />
        )}
        {processingUnit && (
          <ProcessReturnModal
            unit={processingUnit}
            onClose={() => setProcessingUnit(null)}
            onSaved={() => setProcessingUnit(null)}
          />
        )}
        {repairUnit && (
          <QuickRepairModal
            unit={repairUnit}
            onClose={() => setRepairUnit(null)}
            onSaved={() => setRepairUnit(null)}
          />
        )}
        {readyShipUnit && (
          <ReadyToShipModal
            unit={readyShipUnit}
            onClose={() => setReadyShipUnit(null)}
            onSaved={() => setReadyShipUnit(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function BigKpiTile({
  label, value, sub, tone, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone: 'emerald' | 'blue' | 'amber' | 'slate' | 'rose';
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    emerald: 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200 text-emerald-800 hover:from-emerald-100',
    blue:    'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200 text-blue-800 hover:from-blue-100',
    amber:   'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200 text-amber-800 hover:from-amber-100',
    slate:   'bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-200 text-slate-800 hover:from-slate-100',
    rose:    'bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-200 text-rose-800 hover:from-rose-100',
  };
  const Inner = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">{label}</p>
        {onClick && <Eye size={11} className="opacity-30 group-hover:opacity-70 transition-opacity flex-shrink-0" />}
      </div>
      <p className="text-3xl font-bold tabular-nums mt-2 leading-tight">{value}</p>
      {sub && <p className="text-[10px] font-mono opacity-70 mt-1">{sub}</p>}
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`text-left rounded-2xl border px-4 py-4 transition-all hover:shadow-sm active:scale-[0.98] cursor-pointer group ${tones[tone]}`}
      >
        {Inner}
      </button>
    );
  }
  return <div className={`text-left rounded-2xl border px-4 py-4 cursor-default group ${tones[tone]}`}>{Inner}</div>;
}

// ── Filter chips ─────────────────────────────────────────────────────────────
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

// ── Inline Excel sheet ──────────────────────────────────────────────────────
function InlineSheet({
  rows, sort, onSort, supplierMap, region, onRepair, onReadyShip, onReprocess,
}: {
  rows: InventoryUnit[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  region: 'uk' | 'india' | 'admin' | 'both';
  onRepair: (u: InventoryUnit) => void;
  onReadyShip: (u: InventoryUnit) => void;
  onReprocess: (u: InventoryUnit) => void;
}) {
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });

  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        <Sparkles size={28} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No returns yet</p>
        <p className="text-[10px] font-mono mt-1 text-slate-500">Use Process Return above to record one</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-440px)] custom-scrollbar">
        <SheetTable
          rows={rows}
          supplierMap={supplierMap}
          region={region}
          sort={sort}
          toggleSort={toggleSort}
          onRepair={onRepair}
          onReadyShip={onReadyShip}
          onReprocess={onReprocess}
        />
      </div>
      <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 text-[9px] font-mono uppercase tracking-widest text-slate-500">
        Click column headers to sort · In Repair rows have a "Ready to Ship" action
      </div>
    </div>
  );
}

// ── KPI overlay modal ───────────────────────────────────────────────────────
function ReturnsExcelOverlay({
  title, rows, sort, onSort, supplierMap, region, onClose, onRepair, onReadyShip, onReprocess,
}: {
  title: string;
  rows: InventoryUnit[];
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  supplierMap: Record<string, string>;
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
  onRepair: (u: InventoryUnit) => void;
  onReadyShip: (u: InventoryUnit) => void;
  onReprocess: (u: InventoryUnit) => void;
}) {
  const toggleSort = (k: SortKey) => onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              {rows.length.toLocaleString()} {rows.length === 1 ? 'unit' : 'units'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
              <Sparkles size={28} />
              <p className="text-[11px] font-mono uppercase tracking-widest">No rows in this view</p>
            </div>
          ) : (
            <SheetTable
              rows={rows}
              supplierMap={supplierMap}
              region={region}
              sort={sort}
              toggleSort={toggleSort}
              onRepair={onRepair}
              onReadyShip={onReadyShip}
              onReprocess={onReprocess}
            />
          )}
        </div>
        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 flex-shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>ESC to close · row actions surface on hover</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
          >Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sheet table (shared) ─────────────────────────────────────────────────────
function SheetTable({
  rows, supplierMap, region, sort, toggleSort, onRepair, onReadyShip, onReprocess,
}: {
  rows: InventoryUnit[];
  supplierMap: Record<string, string>;
  region: 'uk' | 'india' | 'admin' | 'both';
  sort: { key: SortKey; dir: SortDir };
  toggleSort: (k: SortKey) => void;
  onRepair: (u: InventoryUnit) => void;
  onReadyShip: (u: InventoryUnit) => void;
  onReprocess: (u: InventoryUnit) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!menuId) return;
    const close = () => setMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuId]);

  return (
    <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <thead>
        <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
          <Th k="returnDate" sort={sort} onSort={toggleSort} width="110px" sticky leftPx={0}>Return Date</Th>
          <Th k=""           sort={sort} onSort={undefined}  width="170px">IMEI</Th>
          <Th k="model"      sort={sort} onSort={toggleSort} width="240px">Model</Th>
          <Th k="storage"    sort={sort} onSort={toggleSort} width="80px">Storage</Th>
          <Th k="colour"     sort={sort} onSort={toggleSort} width="120px">Colour</Th>
          <Th k="supplier"   sort={sort} onSort={toggleSort} width="120px">Supplier</Th>
          <Th k="buyPrice"   sort={sort} onSort={toggleSort} width="80px" align="right">BP</Th>
          <Th k="returnType" sort={sort} onSort={toggleSort} width="120px">Type</Th>
          <Th k=""           sort={sort} onSort={undefined}  width="200px">Reason</Th>
          <Th k=""           sort={sort} onSort={undefined}  width="180px"><span className="sr-only">Actions</span></Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((u, idx) => {
          const isAlt = idx % 2 === 1;
          const rowBg = isAlt ? 'bg-slate-50/40 hover:bg-slate-100/60' : 'bg-white hover:bg-slate-50';
          const tone = TYPE_TONE[u.returnType as ReturnCategory] || TYPE_TONE.returned_to_inventory;
          const supplierName = supplierMap[u.supplierId] || u.supplierName || '—';
          const inRepair = u.returnType === 'repair';
          return (
            <tr key={u.id} className={`${rowBg} transition-colors group`}>
              <Td sticky leftPx={0} className={`${rowBg} border-r border-slate-200`}>
                <span className="text-slate-700">{fmtDateForUser(u.returnDate || '', region) || u.returnDate || '—'}</span>
              </Td>
              <Td>
                {u.imei
                  ? <CopyImei imei={u.imei} truncate={16} />
                  : <span className="text-[10px] font-mono text-slate-400">—</span>
                }
              </Td>
              <Td>
                <span className="font-bold text-slate-900 truncate max-w-[220px]" title={u.model}>{u.model || '—'}</span>
              </Td>
              <Td><span className="text-slate-600">{u.storage || '—'}</span></Td>
              <Td><span className="text-slate-600 truncate">{u.colour || '—'}</span></Td>
              <Td><span className="text-slate-700 truncate" title={supplierName}>{supplierName}</span></Td>
              <Td align="right"><span className="font-bold text-slate-900">£{u.buyPrice ?? 0}</span></Td>
              <Td>
                <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                  {tone.label}
                </span>
              </Td>
              <Td><span className="text-slate-500 truncate" title={u.returnReason || ''}>{u.returnReason || ''}</span></Td>
              <Td>
                <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
                  {/* In-Repair rows get a primary 'Back to Stock' button
                      surfaced inline so the operator never has to hunt for
                      it. The 3-dot menu below carries secondary actions. */}
                  {inRepair && (
                    <button
                      onClick={() => onReadyShip(u)}
                      title="Mark this repaired unit as available again"
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                    >
                      <Truck size={10} /> Back to Stock
                    </button>
                  )}
                  <div className="relative">
                    <button
                      onClick={() => setMenuId(menuId === u.id ? null : u.id)}
                      className="opacity-40 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 text-slate-600 transition-all"
                      title="More actions"
                    >
                      <MoreHorizontal size={13} />
                    </button>
                    {menuId === u.id && (
                      <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-1">
                        {inRepair && (
                          <button
                            onClick={() => { setMenuId(null); onReadyShip(u); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-emerald-700 hover:bg-emerald-50"
                          >
                            <Truck size={11} /> Ready to Ship · Back to Stock
                          </button>
                        )}
                        <button
                          onClick={() => { setMenuId(null); onRepair(u); }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-blue-700 hover:bg-blue-50"
                        >
                          <Wrench size={11} /> Send to Repair
                      </button>
                      <button
                        onClick={() => { setMenuId(null); onReprocess(u); }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw size={11} /> Re-process return
                      </button>
                      </div>
                    )}
                  </div>
                </div>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Schema help card ────────────────────────────────────────────────────────
// ── Return History timeline ─────────────────────────────────────────────────
// Activity-feed view of every returned unit, grouped by date bucket and
// ordered newest-first within each bucket. Each card shows the unit's
// journey: where the return came from (sale + return event) and where it
// ended up (back to inventory / in repair / soft-deleted to supplier).
// Units that completed the repair-and-return-to-stock loop carry a green
// 'Back to Stock' chip so the operator sees the wins.
function ReturnHistorySection({
  units, everSoldUnitIds, supplierMap, region, onReadyShip,
}: {
  units: InventoryUnit[];
  /** Set of unitIds that have any Sale doc against them (active or voided).
   *  Used to render the 'Sold' chip on the unit's journey even when the
   *  sale fields on the unit doc were cleared during the return flow. */
  everSoldUnitIds: Set<string>;
  supplierMap: Record<string, string>;
  region: 'uk' | 'india' | 'admin' | 'both';
  onReadyShip: (u: InventoryUnit) => void;
}) {
  // The most recent event per unit drives its position in the timeline.
  // repairedAt > returnDate so a flipped-back unit floats above an
  // in-repair unit that came in earlier.
  const events = useMemo(() => {
    return units
      .map(u => {
        const repairedAt = (u as any).repairedAt as string | undefined;
        const eventDate = (repairedAt && u.returnType === 'returned_to_inventory')
          ? repairedAt
          : (u.returnDate || '');
        return { unit: u, eventDate, repairedAt };
      })
      .filter(e => !!e.eventDate)
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  }, [units]);

  const grouped = useMemo(() => bucketByDate(events), [events]);

  if (events.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-10 text-center text-slate-400">
        <Sparkles size={26} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No return history yet</p>
        <p className="text-[10px] font-mono mt-1 text-slate-500">Activity will land here as you process returns</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center flex-shrink-0">
          <RotateCcw size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-900">Return Activity History</p>
          <p className="text-[9px] font-mono text-slate-500 mt-0.5">
            {events.length} event{events.length === 1 ? '' : 's'} · newest first · grouped by date
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {grouped.map(g => (
          <div key={g.label} className="px-5 py-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              {g.label} · {g.events.length}
            </p>
            <div className="space-y-2">
              {g.events.map(({ unit: u, eventDate, repairedAt }) => {
                const tone = TYPE_TONE[u.returnType as ReturnCategory] || TYPE_TONE.returned_to_inventory;
                const supplierName = supplierMap[u.supplierId] || u.supplierName || '—';
                const wasRepaired = !!repairedAt;
                const isSupplierReturn = u.returnType === 'returned_to_supplier';
                // Journey chips — each return tells a small story.
                const journey: Array<{ label: string; cls: string }> = [];
                // 'Sold' chip survives the return flow: the everSoldUnitIds
                // set sees any Sale doc (including voided ones), so a unit
                // returned to supplier — where ProcessReturnModal clears the
                // unit-side sale fields — still shows its original sale
                // origin in the journey rather than appearing out of nowhere.
                if (u.saleOrderId || (u as any).saleDate || repairedAt || everSoldUnitIds.has(u.id)) {
                  journey.push({ label: 'Sold', cls: 'bg-slate-100 text-slate-700' });
                }
                journey.push({ label: 'Returned', cls: 'bg-rose-100 text-rose-700' });
                if (u.returnType === 'repair' && !wasRepaired) {
                  journey.push({ label: 'In Repair', cls: 'bg-blue-100 text-blue-700' });
                }
                if (wasRepaired) {
                  journey.push({ label: 'Repaired', cls: 'bg-blue-100 text-blue-700' });
                }
                if (u.returnType === 'returned_to_inventory') {
                  journey.push({ label: 'Back to Stock', cls: 'bg-emerald-100 text-emerald-700' });
                }
                if (u.returnType === 'returned_to_supplier') {
                  journey.push({ label: 'To Supplier', cls: 'bg-amber-100 text-amber-700' });
                }
                return (
                  <div key={u.id} className="flex items-start gap-3 group">
                    {/* Timeline dot + connector */}
                    <div className="flex flex-col items-center flex-shrink-0 pt-1">
                      <span className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} />
                    </div>
                    {/* Event card */}
                    {/* Supplier returns are soft-deleted from active stock
                        — paint the card amber + dashed border so the
                        operator's eye can sweep the timeline and spot the
                        write-offs vs the back-to-stock wins. */}
                    <div className={`flex-1 min-w-0 border rounded-xl px-3 py-2 transition-colors ${
                      isSupplierReturn
                        ? 'bg-amber-50/60 hover:bg-amber-100/60 border-amber-200 border-dashed'
                        : 'bg-slate-50/50 hover:bg-slate-100/60 border-slate-100'
                    }`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[11px] font-bold text-slate-900 truncate" title={u.model}>{u.model || '—'}</p>
                            {u.storage && <span className="text-[9px] font-mono text-slate-500">{u.storage}</span>}
                            {u.colour && <span className="text-[9px] font-mono text-slate-500">· {u.colour}</span>}
                            <span className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border flex-shrink-0 ${tone.bg} ${tone.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                              {tone.label}
                            </span>
                            {isSupplierReturn && (
                              <span
                                title="Soft-deleted from active inventory; preserved here for audit"
                                className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900 border border-amber-300 flex-shrink-0"
                              >
                                Soft-deleted
                              </span>
                            )}
                          </div>
                          {/* Journey chips */}
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {journey.map((j, i) => (
                              <React.Fragment key={`${j.label}-${i}`}>
                                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${j.cls}`}>
                                  {j.label}
                                </span>
                                {i < journey.length - 1 && (
                                  <span className="text-[10px] text-slate-300">›</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                          <p className="text-[9px] text-slate-500 font-mono mt-1 truncate">
                            {u.imei ? <span className="text-slate-600">{u.imei}</span> : '(no IMEI)'}
                            {' · '}{supplierName}
                            {u.returnReason ? ` · ${u.returnReason}` : ''}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] font-mono text-slate-700 whitespace-nowrap">
                            {fmtDateForUser(eventDate, region) || eventDate}
                          </p>
                          <p className="text-[9px] font-bold text-slate-900 mt-0.5">£{u.buyPrice ?? 0}</p>
                        </div>
                      </div>
                      {/* Quick action for In Repair rows — same flow as the
                          inline Back-to-Stock button up top. */}
                      {u.returnType === 'repair' && !wasRepaired && (
                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => onReadyShip(u)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
                          >
                            <PackageCheck size={10} /> Mark Repaired · Back to Stock
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DateBucket {
  label: string;
  events: Array<{ unit: InventoryUnit; eventDate: string; repairedAt?: string }>;
}
function bucketByDate(events: Array<{ unit: InventoryUnit; eventDate: string; repairedAt?: string }>): DateBucket[] {
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const buckets: Array<{ key: string; label: string; matches: (d: string) => boolean; events: typeof events }> = [
    { key: 'today',     label: 'Today',     matches: d => d === today,                         events: [] },
    { key: 'yesterday', label: 'Yesterday', matches: d => d === yesterday,                     events: [] },
    { key: 'week',      label: 'This Week', matches: d => d >= weekAgo && d < yesterday,       events: [] },
    { key: 'month',     label: 'This Month',matches: d => d >= monthAgo && d < weekAgo,        events: [] },
    { key: 'older',     label: 'Older',     matches: () => true,                               events: [] },
  ];
  for (const e of events) {
    const bucket = buckets.find(b => b.matches(e.eventDate));
    if (bucket) bucket.events.push(e);
  }
  return buckets.filter(b => b.events.length > 0).map(b => ({ label: b.label, events: b.events }));
}

// ── Schema help card ────────────────────────────────────────────────────────
function SchemaHelpCard({ onClose }: { onClose: () => void }) {
  const fields: Array<{ col: string; field: string; note: string; tone: 'edit' | 'derived' | 'core' }> = [
    { col: '1',  field: 'Return Date',  note: 'Set on Process Return',                                                  tone: 'core' },
    { col: '2',  field: 'IMEI',         note: 'From the unit being returned',                                           tone: 'core' },
    { col: '3',  field: 'Model',        note: 'Read-only — from inventory unit',                                        tone: 'core' },
    { col: '4',  field: 'Storage',      note: 'Read-only — from inventory unit',                                        tone: 'core' },
    { col: '5',  field: 'Colour',       note: 'Read-only — from inventory unit',                                        tone: 'core' },
    { col: '6',  field: 'Supplier',     note: 'Read-only — from inventory unit',                                        tone: 'core' },
    { col: '7',  field: 'BP',           note: 'Buy-price snapshot at time of return',                                   tone: 'core' },
    { col: '8',  field: 'Type',         note: 'One of: To Inventory · In Repair · To Supplier (soft-deleted, audit-only)', tone: 'core' },
    { col: '9',  field: 'Reason',       note: 'Free-text · why the unit came back',                                     tone: 'core' },
    { col: '10', field: 'Notes',        note: 'Free-text · condition / next steps',                                     tone: 'core' },
  ];
  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-900 flex items-center gap-2">
            <Info size={14} /> Returns Schema · 10 columns
          </p>
          <p className="text-[10px] font-mono text-indigo-700/70 mt-1">
            Two destinations: kept in our inventory (re-stock / repair) or sent back to supplier (soft-delete · stays in returns history).
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-indigo-100 text-indigo-600 transition-all">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {fields.map(f => (
          <div key={f.field} className="flex items-start gap-3 bg-white border border-indigo-100 rounded-xl px-3 py-2.5">
            <span className="text-[10px] font-mono text-indigo-400 w-5 text-center flex-shrink-0">{f.col}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-slate-900 truncate">{f.field}</p>
              <p className="text-[10px] text-slate-500 font-mono mt-0.5 leading-snug">{f.note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Return-unit picker (sold units eligible to be returned) ──────────────────
function ReturnUnitPicker({
  sold, supplierMap, onClose, onPick,
}: {
  sold: InventoryUnit[];
  supplierMap: Record<string, string>;
  onClose: () => void;
  onPick: (u: InventoryUnit) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = sold.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (u.model || '').toLowerCase().includes(q)
        || (u.imei || '').toLowerCase().includes(q)
        || (u.saleOrderId || '').toLowerCase().includes(q)
        || (supplierMap[u.supplierId] || '').toLowerCase().includes(q);
  }).slice(0, 100);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 32px)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center"><RefreshCw size={16} /></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Pick a sold unit</p>
              <h3 className="text-sm font-bold">Process a return</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by model, IMEI, order #, supplier…"
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-slate-900 focus:bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <p className="p-8 text-center text-[11px] font-mono text-slate-400">No sold units match.</p>
          ) : filtered.map(u => (
            <button key={u.id} onClick={() => onPick(u)}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-slate-900 truncate">{u.model}</p>
                <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                  {u.imei || '(no IMEI)'} · {u.colour}{u.storage ? ` · ${u.storage}` : ''} · {supplierMap[u.supplierId] || '—'}
                  {u.saleOrderId ? ` · ${u.saleOrderId}` : ''}
                </p>
              </div>
              {u.salePrice != null && <span className="text-sm font-bold text-emerald-700 flex-shrink-0">£{u.salePrice}</span>}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ── ProcessReturnModal ───────────────────────────────────────────────────────
function ProcessReturnModal({
  unit, onClose, onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [returnType, setReturnType] = useState<ReturnCategory>('returned_to_inventory');
  const [reason, setReason]         = useState('');
  const [returnDate, setReturnDate] = useState(todayStr());
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const warranty = useMemo(() => getWarrantyStatus(unit.saleDate), [unit.saleDate]);

  const handleSave = async () => {
    if (!reason.trim()) { setError('Please enter a return reason.'); return; }
    setSaving(true);
    try {
      // SOFT-DELETE policy for supplier returns (per client spec): keep the
      // unit doc with status='returned' + returnType='returned_to_supplier'
      // so it stays visible in the returns sheet + audit. Old code did a
      // hard `dbService.delete` here, which made the unit disappear entirely.
      const newStatus = returnType === 'returned_to_inventory' ? 'available' : 'returned';
      await dbService.update('inventoryUnits', unit.id, {
        status: newStatus,
        returnType,
        returnDate,
        returnReason: reason.trim(),
        // Always clear sale data on any return — prevents ghost sale records.
        salePrice: null,
        saleDate: null,
        salePlatform: null,
        saleOrderId: null,
        postageCost: null,
        ...(returnType === 'returned_to_inventory'
          ? { platformListed: false, listingSites: [] }
          : {}),
      });

      // Void the linked Sale doc(s) — a returned sale is treated as if it
      // never happened: zero revenue, zero GP, doesn't count in the Sell
      // dashboard. The Sale doc stays in the collection for audit, just
      // flagged with voidedAt + voidReason. If the unit is re-sold later,
      // recordSale creates a NEW Sale doc and this one stays voided.
      try {
        const all = await dbService.readAll('sales');
        const linked = all.filter((s: any) => s.unitId === unit.id && !s.voidedAt);
        for (const s of linked) {
          await dbService.update('sales', s.id, {
            voidedAt: returnDate,
            voidReason: reason.trim(),
          });
        }
      } catch (err) {
        // Best-effort; if it fails the unit-side returnType + returnDate
        // still drive the Sell dashboard's runtime "is voided" check as a
        // fallback, so accounting stays correct.
        console.warn('Failed to void linked sales for unit', unit.id, err);
      }

      // Lifecycle log — one event per return action so the per-IMEI
      // timeline (and the Returns Report) shows the full chain. Maps
      // the operator's category choice to the lifecycle event type.
      const eventType: import('../types').ReturnEventType =
        returnType === 'returned_to_inventory' ? 'restocked'
        : returnType === 'returned_to_supplier' ? 'sent_to_supplier'
        : 'sent_to_repair';
      if (unit.imei) {
        try {
          await dbService.createReturnEvent({
            imei:         unit.imei,
            unitId:       unit.id,
            type:         eventType,
            date:         returnDate,
            comment:      reason.trim(),
            supplierId:   unit.supplierId,
            supplierName: unit.supplierName,
          });
        } catch (err) {
          // Best-effort — the unit-side returnType still drives every
          // existing view if the event write fails.
          console.warn('Failed to record return event for unit', unit.id, err);
        }
      }

      notificationService.addNotification('return_processed', unit);
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const OPTION_LABELS: Record<ReturnCategory, { label: string; desc: string; color: string }> = {
    returned_to_inventory: { label: 'Back to Inventory', desc: 'Unit is resaleable — restore to available stock',                  color: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
    repair:                { label: 'Send for Repair',   desc: 'Unit needs repair before resale',                                  color: 'border-blue-300 bg-blue-50 text-blue-800' },
    returned_to_supplier:  { label: 'Return to Supplier', desc: 'Removed from office stock · kept in returns history for audit',  color: 'border-amber-300 bg-amber-50 text-amber-800' },
  };
  const order: ReturnCategory[] = ['returned_to_inventory', 'repair', 'returned_to_supplier'];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Process Return</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {unit.saleDate && (
            <div className={`flex items-center gap-2 p-2 rounded-lg border text-[9px] ${warranty.isExpired ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
              {warranty.isExpired ? <ShieldAlert size={14} className="flex-shrink-0" /> : <ShieldCheck size={14} className="flex-shrink-0" />}
              <span className="font-bold">{warranty.isExpired ? 'Warranty Expired' : 'Warranty Active'} • {warranty.isExpired ? `${Math.abs(warranty.daysLeft)}d ago` : `${warranty.daysLeft}d left`}</span>
            </div>
          )}

          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Return Destination *</label>
            <div className="space-y-2">
              {order.map(key => (
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

          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Return Date</label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all" />
          </div>

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
          {returnType === 'repair' && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl p-3">
              <Wrench size={13} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-blue-700 font-mono leading-relaxed">
                Unit moves to <strong>In Repair</strong>. Use 'Ready to Ship · Back to Stock' once repaired to flip it back to available inventory.
              </p>
            </div>
          )}
          {returnType === 'returned_to_supplier' && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <ArrowUpRight size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-[9px] text-amber-700 font-mono leading-relaxed">
                Unit is <strong>soft-deleted</strong> — won't count in office stock but stays in the returns sheet for audit. The doc is preserved (not deleted).
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

// ── QuickRepairModal ─────────────────────────────────────────────────────────
function QuickRepairModal({
  unit, onClose, onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const handleSend = async () => {
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unit.id, {
        status: 'returned',
        returnType: 'repair',
        returnDate: todayStr(),
        returnReason: unit.returnReason || 'Unit sent for repair',
        salePrice: null, saleDate: null, salePlatform: null, saleOrderId: null, postageCost: null,
        platformListed: false, listingSites: [],
      });
      notificationService.addNotification('return_processed', unit);
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Send for Repair</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={16} /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
            <Wrench size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-800 font-mono leading-relaxed">
              Unit moves to <strong>In Repair</strong>. Mark it as <strong>Ready to Ship</strong> later to restore to stock.
            </p>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSend} disabled={saving}
            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><Wrench size={13} /> Send to Repair</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ReadyToShipModal ─────────────────────────────────────────────────────────
function ReadyToShipModal({
  unit, onClose, onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const handleMove = async () => {
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unit.id, {
        status: 'available',
        returnType: 'returned_to_inventory',
        repairedAt: todayStr(),
        flags: [...(unit.flags || []), 'repaired_unit'],
      });
      notificationService.addNotification('unit_repaired', unit);
      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl overflow-hidden w-full max-w-sm shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Ready to Ship</p>
            <h3 className="text-sm font-bold truncate mt-0.5 max-w-[240px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl"><X size={16} /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <Truck size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-emerald-800 font-mono leading-relaxed">
              Unit is repaired. Confirm to restore it to <strong>available</strong> inventory and tag it as <code>repaired_unit</code> for ops visibility.
            </p>
          </div>
          {unit.returnReason && (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[8px] font-mono uppercase tracking-widest text-slate-500">Original return reason</p>
              <p className="text-xs text-slate-700 mt-1">{unit.returnReason}</p>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleMove} disabled={saving}
            className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <><PackageCheck size={13} /> Back to Stock</>}
          </button>
        </div>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function titleFor(kpi: KpiId): string {
  switch (kpi) {
    case 'back_to_inventory': return 'Back to Inventory';
    case 'in_repair':         return 'In Repair';
    case 'to_supplier':       return 'Returned to Supplier';
    case 'all':               return 'All Returns';
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

// ── Returns Report ───────────────────────────────────────────────────────────
//
// Full lifecycle log across every IMEI we've ever processed a return on.
// Subscribes to the `returnEvents` collection live and groups by IMEI so
// the operator sees the round-trip story: returned → sent_to_supplier →
// received_again, with each step's date + comment + actor.
//
// Filters: date range, type, free-text search (IMEI / comment / actor /
// supplier). Download dumps the filtered set to a CSV the operator
// can hand off for accounting or supplier reconciliation.
function ReturnsReport() {
  const [events, setEvents] = useState<import('../types').ReturnEvent[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | import('../types').ReturnEventType>('all');
  const [fromIso, setFromIso] = useState<string>('');
  const [toIso, setToIso] = useState<string>('');
  const [expandedImei, setExpandedImei] = useState<string | null>(null);

  useEffect(() => {
    const unsub = dbService.subscribeToCollection('returnEvents', (rows: any[]) => {
      setEvents(rows as import('../types').ReturnEvent[]);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (fromIso && e.date && e.date < fromIso) return false;
      if (toIso && e.date && e.date > toIso) return false;
      if (q) {
        const hay = [e.imei, e.comment, e.actorEmail, e.supplierName].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, typeFilter, fromIso, toIso, search]);

  // Group filtered events by IMEI for the timeline view. Backed by the pure,
  // unit-tested helper in lib/returnsLifecycle so the on-screen per-IMEI
  // lifecycle (incl. units returned multiple times) matches verified behaviour.
  const byImei = useMemo(() => groupReturnEventsByImei(filtered), [filtered]);

  const TYPE_TONE: Record<string, string> = {
    returned:         'bg-rose-100 text-rose-700 border-rose-200',
    restocked:        'bg-emerald-100 text-emerald-700 border-emerald-200',
    sent_to_supplier: 'bg-amber-100 text-amber-700 border-amber-200',
    sent_to_repair:   'bg-sky-100 text-sky-700 border-sky-200',
    repair_complete:  'bg-emerald-100 text-emerald-700 border-emerald-200',
    refunded:         'bg-violet-100 text-violet-700 border-violet-200',
    received_again:   'bg-orange-100 text-orange-700 border-orange-200',
    note:             'bg-slate-100 text-slate-600 border-slate-200',
  };

  const downloadCsv = () => {
    const header = ['IMEI', 'Type', 'Date', 'Comment', 'Supplier', 'Actor', 'UnitId'];
    const rows = filtered.map(e => [
      e.imei, e.type, e.date, e.comment || '', e.supplierName || '', e.actorEmail, e.unitId || '',
    ]);
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    triggerDownload(`returns-report-${stamp}.csv`, new Blob([csv], { type: 'text/csv' }));
  };

  return (
    <section className="mt-6 bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold tracking-tight">Returns Report · per-IMEI lifecycle</h3>
          <p className="text-[10px] font-mono text-slate-400 mt-0.5">
            {filtered.length.toLocaleString()} event{filtered.length === 1 ? '' : 's'} across {byImei.length.toLocaleString()} IMEI{byImei.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Download CSV
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search IMEI · comment · supplier · actor…"
          className="flex-1 min-w-[180px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[11px] focus:outline-none focus:border-slate-900 focus:bg-white"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as any)}
          className="px-3 py-2 border border-slate-200 rounded-xl text-[10px] font-mono bg-white"
        >
          <option value="all">All types</option>
          <option value="returned">Returned</option>
          <option value="restocked">Restocked</option>
          <option value="sent_to_supplier">Sent to supplier</option>
          <option value="sent_to_repair">Sent to repair</option>
          <option value="repair_complete">Repair complete</option>
          <option value="refunded">Refunded</option>
          <option value="received_again">Received again</option>
          <option value="note">Note</option>
        </select>
        <input
          type="date"
          value={fromIso}
          onChange={e => setFromIso(e.target.value)}
          title="From date"
          className="px-2 py-2 border border-slate-200 rounded-xl text-[10px] font-mono"
        />
        <span className="text-[10px] font-mono text-slate-400">→</span>
        <input
          type="date"
          value={toIso}
          onChange={e => setToIso(e.target.value)}
          title="To date"
          className="px-2 py-2 border border-slate-200 rounded-xl text-[10px] font-mono"
        />
        {(search || typeFilter !== 'all' || fromIso || toIso) && (
          <button
            onClick={() => { setSearch(''); setTypeFilter('all'); setFromIso(''); setToIso(''); }}
            className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900"
          >
            Clear
          </button>
        )}
      </div>

      {byImei.length === 0 ? (
        <p className="text-[11px] font-mono text-slate-400 text-center py-8">
          No return events match the current filters.
        </p>
      ) : (
        <div className="space-y-2 max-h-[480px] overflow-auto custom-scrollbar pr-1">
          {byImei.slice(0, 100).map(([imei, evts]) => {
            const open = expandedImei === imei;
            const latest = evts[0];
            return (
              <div key={imei} className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedImei(open ? null : imei)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-mono font-bold text-slate-900 truncate">{imei}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${TYPE_TONE[latest.type] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {latest.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">{latest.date}</span>
                  </div>
                  <span className="text-[9px] font-mono text-slate-400">
                    {evts.length} event{evts.length === 1 ? '' : 's'} · {open ? '▲' : '▼'}
                  </span>
                </button>
                {open && (
                  <div className="divide-y divide-slate-100">
                    {evts.map(e => (
                      <div key={e.id} className="px-3 py-2 grid grid-cols-[100px_120px_1fr_140px] items-center gap-2 text-[10px] font-mono">
                        <span className="text-slate-500">{e.date}</span>
                        <span className={`text-[9px] font-bold uppercase tracking-widest border rounded px-1.5 py-0.5 ${TYPE_TONE[e.type] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {e.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-slate-700 truncate" title={e.comment || ''}>
                          {e.comment || <span className="text-slate-300">— no comment —</span>}
                        </span>
                        <span className="text-slate-400 truncate text-right" title={`${e.actorEmail} · ${e.supplierName || ''}`}>
                          {e.actorEmail}{e.supplierName ? ` · ${e.supplierName}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {byImei.length > 100 && (
            <p className="text-[10px] font-mono text-slate-400 text-center py-2">
              Showing 100 of {byImei.length.toLocaleString()} — narrow the filters to see more.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
