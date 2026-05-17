/**
 * BuySheet — IMEI-keyed Excel-style spreadsheet view for the Buy tab.
 *
 * Replaces the legacy grouped StockInPage with a single source of truth: one
 * row per IMEI, mirroring the IMEI NUMBERS sheet from the master file but
 * reimagined with sticky header, frozen IMEI column, inline edit, sort, a
 * multi-filter chip bar, CSV export, and a detail panel that surfaces the
 * model rollup (from INVENTORY sheet) and supplier WhatsApp price quotes.
 *
 * The legacy modal flows (Add Stock manual, Log SHS, Receive SHS, backfill
 * Missing IMEIs) are preserved as action buttons + pinned sections so ops
 * keeps every workflow they had.
 */
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search, Plus, Truck, PackageCheck, ChevronDown, ChevronUp, ChevronsUpDown,
  Filter, X, MoreHorizontal, Download, AlertCircle, Save, Clock,
  Eye, Trash2, AlertTriangle, MessageCircle, Sparkles, Layers,
  Upload, Info,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import {
  InventoryUnit, InventoryAggregate, SupplierWhatsappUpdate,
  ListingSite,
} from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { backfillImei } from '../services';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { LISTING_SITES, listingSiteLabel } from '../lib/platforms';
import { shsAggregatesFrom, manualShsUnitsFrom, totalShsRecords } from '../lib/shsCount';
import { mapAllUnits, ORPHAN_MARKER, type MappingResult } from '../lib/inventoryMapping';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import CopyImei from './CopyImei';
import AddStockManualModal from './AddStockManualModal';
import AddSHSModal from './AddSHSModal';
import ReceiveSHSModal from './ReceiveSHSModal';
import ReceiveShsAggregateModal from './ReceiveShsAggregateModal';
import TodayIntakeModal from './TodayIntakeModal';
import MasterDataLinkedImport from './MasterDataLinkedImport';
import ResetDataModal from './ResetDataModal';
import { auth, isAdmin } from '../lib/firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'available' | 'sold' | 'incoming' | 'returned' | 'missing' | 'unmapped';

type SortKey =
  | 'dateIn' | 'model' | 'storage' | 'colour' | 'buyPrice'
  | 'supplier' | 'status' | 'marketplace' | 'dateOut';
type SortDir = 'asc' | 'desc';

interface Props {
  onOpenBatch: () => void;
  onOpenImport?: () => void;
}

// Stable colour palette for marketplace/status chips.
const STATUS_TONE: Record<string, { bg: string; text: string; dot: string }> = {
  available: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  sold:      { bg: 'bg-slate-100 border-slate-200',   text: 'text-slate-600',   dot: 'bg-slate-400'  },
  incoming:  { bg: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',   dot: 'bg-amber-500'  },
  returned:  { bg: 'bg-rose-50 border-rose-200',      text: 'text-rose-700',    dot: 'bg-rose-500'   },
  reserved:  { bg: 'bg-blue-50 border-blue-200',      text: 'text-blue-700',    dot: 'bg-blue-500'   },
  lost:      { bg: 'bg-zinc-50 border-zinc-200',      text: 'text-zinc-600',    dot: 'bg-zinc-400'   },
  ready_to_ship: { bg: 'bg-violet-50 border-violet-200', text: 'text-violet-700', dot: 'bg-violet-500' },
  fba:       { bg: 'bg-orange-50 border-orange-200',  text: 'text-orange-700',  dot: 'bg-orange-500' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function BuySheet(_props: Props) {
  const { units, suppliers, aggregates, whatsappFeed } = useInventoryStore();
  const region = useUserRegion();

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── Filters / sort / search ────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('available');
  const [supplierFilter, setSupplierFilter] = useState<Set<string>>(new Set());
  const [marketplaceFilter, setMarketplaceFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'dateIn', dir: 'desc' });
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  // ── Detail panel + inline edit ─────────────────────────────────────────────
  const [activeUnit, setActiveUnit] = useState<InventoryUnit | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);

  // ── Modals (legacy flows preserved) ────────────────────────────────────────
  const [showAddStockManual, setShowAddStockManual] = useState(false);
  const [showAddSHS, setShowAddSHS] = useState(false);
  const [receivingUnit, setReceivingUnit] = useState<InventoryUnit | null>(null);
  const [receivingAggregate, setReceivingAggregate] = useState<InventoryAggregate | null>(null);
  const [showTodayIntake, setShowTodayIntake] = useState(false);
  const [showMasterImport, setShowMasterImport] = useState(false);
  const [showSchemaHelp, setShowSchemaHelp] = useState(false);
  const [showResetData, setShowResetData] = useState(false);
  // Admin-gated destructive action — non-admins never see the button.
  const userIsAdmin = isAdmin(auth.currentUser);

  // Close any open row menu on outside-click.
  useEffect(() => {
    if (!rowMenuId) return;
    const close = () => setRowMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [rowMenuId]);

  // ── Mapping: per-unit link to its INVENTORY-sheet aggregate ───────────────
  // INVENTORY is the source of truth for the model; IMEI sheet is the mapping
  // table. We auto-match every unit at runtime and stash the result so the
  // sheet can badge each row + the review queue can surface the unmapped ones
  // with suggestions ready to confirm.
  const mappings = useMemo(() => mapAllUnits(units, aggregates), [units, aggregates]);

  // ── Derived rows ───────────────────────────────────────────────────────────
  const sortedUnits = useMemo(() => {
    return sortUnits(units, sort, supplierMap);
  }, [units, sort, supplierMap]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedUnits.filter(u => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'missing') {
          if (isValidImei(u.imei, { isAppleSerial: isAppleDevice(u.model) })) return false;
          if (u.status === 'incoming') return false;
        } else if (statusFilter === 'unmapped') {
          const m = mappings.get(u.id);
          if (!m || (m.status !== 'unmapped' && m.status !== 'orphan')) return false;
        } else {
          if (u.status !== statusFilter) return false;
        }
      }
      // Supplier filter
      if (supplierFilter.size > 0) {
        const sname = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
        if (!supplierFilter.has(sname)) return false;
      }
      // Marketplace filter
      if (marketplaceFilter.size > 0) {
        const mp = (u.marketplace || '').trim() || '—';
        if (!marketplaceFilter.has(mp)) return false;
      }
      // Search
      if (q) {
        const hay = [
          u.imei, u.model, u.storage, u.colour, supplierMap[u.supplierId] || u.supplierName,
          u.marketplace, u.notes, String(u.buyPrice ?? ''),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sortedUnits, search, statusFilter, supplierFilter, marketplaceFilter, supplierMap, mappings]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  // Office Stock + Tied Capital are the INVENTORY-sheet ground truth: sum of
  // quantityNum (and qty × BP) across master aggregates, EXCLUDING any row
  // tagged SHS. Supplier-held stock isn't "in office" until received, so it
  // doesn't count toward either total. Matches the user's TOTAL marker on the
  // source spreadsheet (157 units / £14,719).
  const kpis = useMemo(() => {
    let officeStock = 0;
    let tiedCapital = 0;
    for (const a of aggregates) {
      if ((a.quantityText || '').toUpperCase() === 'SHS') continue;
      const qty = a.quantityNum;
      if (typeof qty !== 'number' || qty <= 0) continue;
      officeStock += qty;
      tiedCapital += qty * (a.buyPrice || 0);
    }

    let availableImeis = 0, sold = 0, incoming = 0, missing = 0, unmapped = 0;
    for (const u of units) {
      if (u.status === 'available') availableImeis++;
      else if (u.status === 'sold') sold++;
      else if (u.status === 'incoming') incoming++;
      const apple = isAppleDevice(u.model);
      if (u.status !== 'incoming' && !isValidImei(u.imei, { isAppleSerial: apple })) missing++;
      const m = mappings.get(u.id);
      if (m && (m.status === 'unmapped' || m.status === 'orphan')) unmapped++;
    }
    const shsTotal = totalShsRecords(units, aggregates);
    return { total: units.length, officeStock, tiedCapital, availableImeis, sold, incoming, missing, unmapped, shsTotal };
  }, [units, aggregates, mappings]);

  // ── Filter chip options ────────────────────────────────────────────────────
  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of units) {
      const sname = supplierMap[u.supplierId] || u.supplierName || 'Unassigned';
      set.add(sname);
    }
    return Array.from(set).sort();
  }, [units, supplierMap]);

  const marketplaceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of units) {
      const mp = (u.marketplace || '').trim();
      if (mp) set.add(mp);
    }
    return Array.from(set).sort();
  }, [units]);

  // ── SHS aggregates section data (master-file IMEI-less rollups) ────────────
  const shsAggs = useMemo(() => shsAggregatesFrom(aggregates), [aggregates]);
  const manualShs = useMemo(() => manualShsUnitsFrom(units), [units]);

  // ── Model rollup index (for chips + detail panel) ─────────────────────────
  // Key: brand+model+storage — links the IMEI row to its INVENTORY-sheet
  // aggregate (qty, value, sales-focus flag). Built once per render.
  const aggIndex = useMemo(() => {
    const m = new Map<string, InventoryAggregate>();
    for (const a of aggregates) {
      const p = parseBrandModelStorage(a.model || '');
      const k = aggKey(p.brand, p.model, p.storage || a.storage);
      m.set(k, a);
    }
    return m;
  }, [aggregates]);

  // ── WhatsApp price quotes index (loose model-substring match) ─────────────
  // Quotes are free-form text so we do a substring match against the SKU.
  const findQuotes = useCallback((u: InventoryUnit): SupplierWhatsappUpdate[] => {
    const needle = `${u.model || ''}`.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (needle.length === 0) return [];
    return whatsappFeed.filter(q => {
      const hay = (q.rawText || '').toLowerCase();
      return needle.some(t => hay.includes(t));
    });
  }, [whatsappFeed]);

  // ── CSV export of the currently-filtered view ─────────────────────────────
  const handleExportCsv = () => {
    const rows = filteredUnits.map(u => ({
      'Stock In Date': u.dateIn || '',
      'Model':         u.model || '',
      'IMEI Number':   u.imei || '',
      'BP':            u.buyPrice ?? '',
      'Colours':       u.colour || '',
      'Supplier':      supplierMap[u.supplierId] || u.supplierName || '',
      'Notes':         u.notes || '',
      'Status':        u.status || '',
      'Marketplace':   u.marketplace || '',
      'Stock Out Date': u.stockOutDate || '',
    }));
    downloadCsv('buy_imei_sheet.csv', rows);
  };

  // ── Inline edit save handler ──────────────────────────────────────────────
  const saveCell = async (u: InventoryUnit, field: string, value: any) => {
    const patch: Record<string, any> = { [field]: value };
    if (field === 'status' && value === 'sold' && !u.stockOutDate) {
      patch.stockOutDate = new Date().toISOString().split('T')[0];
    }
    if (field === 'status' && value !== 'sold' && u.stockOutDate) {
      patch.stockOutDate = '';
    }
    try {
      await dbService.update('inventoryUnits', u.id, patch);
    } catch (err) {
      console.error('Inline cell save failed', err);
    } finally {
      setEditingCell(null);
    }
  };

  const handleDelete = async (u: InventoryUnit) => {
    if (!window.confirm(`Delete IMEI ${u.imei || '(no IMEI)'} for "${u.model}"? This cannot be undone.`)) return;
    try {
      await dbService.delete('inventoryUnits', u.id);
      setActiveUnit(null);
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header strip ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-2">
              <Layers size={20} className="text-slate-700" />
              Buy Sheet
              <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-normal">
                · IMEI-keyed
              </span>
            </h2>
            <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-1">
              One row per IMEI · sortable · inline editable · master rollup + WhatsApp quotes in detail panel
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowMasterImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-sm"
            >
              <Upload size={12} /> Load Master Sheet
            </button>
            <button
              onClick={() => setShowAddStockManual(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
            >
              <Plus size={12} /> Add Stock
            </button>
            <button
              onClick={() => setShowAddSHS(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all"
            >
              <Truck size={12} /> SHS Order
            </button>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all"
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={() => setShowSchemaHelp(s => !s)}
              title="Show required fields"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border ${
                showSchemaHelp
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              <Info size={12} /> Schema
            </button>
            {/* Master delete — admin-gated. Two-step confirm inside the modal:
                checkbox attestation + Delete All Data button. Wipes every
                Firestore collection the app reads from. */}
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
        </div>

        {/* KPI tiles — Office Stock + Tied Capital are the INVENTORY-sheet
            master rollup (ex-SHS). Sold uses per-IMEI status. SHS is the
            supplier-held queue (never counts as office stock). */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          <KpiTile label="Total IMEIs" value={kpis.total} tone="slate" sub={`${kpis.availableImeis} tracked`} />
          <KpiTile
            label="Office Stock"
            value={kpis.officeStock}
            tone="emerald"
            sub="INVENTORY sheet · ex-SHS"
            onClick={() => setStatusFilter('available')}
            active={statusFilter === 'available'}
          />
          <KpiTile
            label="Sold"
            value={kpis.sold}
            tone="slate"
            onClick={() => setStatusFilter('sold')}
            active={statusFilter === 'sold'}
          />
          <KpiTile
            label="SHS · Awaiting"
            value={kpis.shsTotal}
            tone="amber"
            sub={kpis.incoming > 0 ? `${kpis.incoming} manual` : 'Supplier-held'}
          />
          <KpiTile
            label="In-Office Value"
            value={`£${kpis.tiedCapital.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`}
            tone="blue"
            sub="ex-SHS"
          />
        </div>
      </div>

      {/* ── Schema help (column requirements to match the Excel report) ── */}
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

      {/* ── SHS pinned section (master-file aggregates + manual orders) ─── */}
      {(shsAggs.length > 0 || manualShs.length > 0) && (
        <ShsAwaitingSection
          aggregates={shsAggs}
          manualUnits={manualShs}
          supplierMap={supplierMap}
          onReceiveAgg={a => setReceivingAggregate(a)}
          onReceiveUnit={u => setReceivingUnit(u)}
        />
      )}

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search IMEI, model, supplier, marketplace, notes…"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:outline-none focus:border-slate-900 focus:bg-white transition-all"
              />
            </div>
            <button
              onClick={() => setShowFilterDrawer(s => !s)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border
                ${supplierFilter.size + marketplaceFilter.size > 0
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'}`}
            >
              <Filter size={12} /> Filters
              {(supplierFilter.size + marketplaceFilter.size) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px]">
                  {supplierFilter.size + marketplaceFilter.size}
                </span>
              )}
            </button>
          </div>

          {/* Status pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {([
              ['all',       'All',         kpis.total],
              ['available', 'In Stock',    kpis.availableImeis],
              ['sold',      'Sold',        kpis.sold],
              ['incoming',  'Incoming',    kpis.incoming],
              ['returned',  'Returned',    units.filter(u => u.status === 'returned').length],
              ['missing',   'Missing IMEI', kpis.missing],
              ['unmapped',  'Unmapped',    kpis.unmapped],
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

            {/* Reset chip — only if something is active beyond default */}
            {(statusFilter !== 'available' || supplierFilter.size + marketplaceFilter.size > 0 || search) && (
              <button
                onClick={() => {
                  setStatusFilter('available'); setSupplierFilter(new Set()); setMarketplaceFilter(new Set()); setSearch('');
                }}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-rose-600 transition-all flex-shrink-0"
              >
                <X size={11} /> Reset
              </button>
            )}
          </div>

          {/* Filter drawer (collapsible) */}
          <AnimatePresence>
            {showFilterDrawer && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 pb-1 border-t border-slate-100">
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
                  <FilterChipsGroup
                    label="Marketplace"
                    options={marketplaceOptions}
                    selected={marketplaceFilter}
                    onToggle={name => {
                      const next = new Set(marketplaceFilter);
                      if (next.has(name)) next.delete(name); else next.add(name);
                      setMarketplaceFilter(next);
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Row count strip */}
        <div className="px-4 py-1.5 border-t border-slate-100 bg-slate-50/50 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>
            Showing <span className="text-slate-900 font-bold">{filteredUnits.length.toLocaleString()}</span> of {units.length.toLocaleString()} IMEIs
          </span>
          <span className="hidden sm:inline">
            Sort: <span className="text-slate-900 font-bold">{sort.key}</span> {sort.dir === 'asc' ? '↑' : '↓'}
          </span>
        </div>
      </div>

      {/* ── The sheet itself ──────────────────────────────────────────────── */}
      <Sheet
        units={filteredUnits}
        supplierMap={supplierMap}
        aggIndex={aggIndex}
        mappings={mappings}
        sort={sort}
        onSort={setSort}
        activeUnitId={activeUnit?.id ?? null}
        onSelect={u => setActiveUnit(u)}
        editingCell={editingCell}
        onEdit={(id, field) => setEditingCell({ id, field })}
        onCancelEdit={() => setEditingCell(null)}
        onSaveCell={saveCell}
        rowMenuId={rowMenuId}
        setRowMenuId={setRowMenuId}
        onDelete={handleDelete}
        onViewDetail={u => setActiveUnit(u)}
        region={region}
      />

      {/* ── Mapping Review (shown when Unmapped filter is on OR an audit is needed) ── */}
      {statusFilter === 'unmapped' && filteredUnits.length > 0 && (
        <MappingReviewSection
          units={filteredUnits}
          mappings={mappings}
          onConfirm={async (unitId, aggregateId) => {
            await dbService.update('inventoryUnits', unitId, { inventoryAggregateId: aggregateId });
          }}
          onMarkOrphan={async (unitId) => {
            await dbService.update('inventoryUnits', unitId, { inventoryAggregateId: ORPHAN_MARKER });
          }}
        />
      )}

      {/* ── Missing IMEIs · inline backfill (only when that filter is on) ── */}
      {statusFilter === 'missing' && filteredUnits.length > 0 && (
        <MissingImeiBackfill units={filteredUnits} suppliers={supplierMap} />
      )}

      {/* ── Detail Panel (slide-out) ───────────────────────────────────── */}
      <AnimatePresence>
        {activeUnit && (
          <DetailPanel
            unit={activeUnit}
            supplierName={supplierMap[activeUnit.supplierId] || activeUnit.supplierName || '—'}
            agg={aggIndex.get(aggKey(activeUnit.brand, activeUnit.model, activeUnit.storage))}
            quotes={findQuotes(activeUnit)}
            region={region}
            onClose={() => setActiveUnit(null)}
            onPatch={async (patch) => {
              await dbService.update('inventoryUnits', activeUnit.id, patch);
              setActiveUnit(prev => prev ? { ...prev, ...patch } : prev);
            }}
            onDelete={() => handleDelete(activeUnit)}
          />
        )}
      </AnimatePresence>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showResetData      && <ResetDataModal           onClose={() => setShowResetData(false)} />}
        {showMasterImport   && <MasterDataLinkedImport onClose={() => setShowMasterImport(false)} />}
        {showAddStockManual && <AddStockManualModal onClose={() => setShowAddStockManual(false)} />}
        {showAddSHS         && <AddSHSModal         onClose={() => setShowAddSHS(false)} />}
        {receivingUnit      && <ReceiveSHSModal unit={receivingUnit} onClose={() => setReceivingUnit(null)} />}
        {receivingAggregate && <ReceiveShsAggregateModal aggregate={receivingAggregate} onClose={() => setReceivingAggregate(null)} />}
        {showTodayIntake    && (
          <TodayIntakeModal
            units={units.filter(u => u.dateIn === new Date().toISOString().split('T')[0] && u.status !== 'incoming')}
            onClose={() => setShowTodayIntake(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
function KpiTile({
  label, value, sub, tone, active, onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone: 'slate' | 'emerald' | 'amber' | 'blue' | 'rose';
  active?: boolean;
  onClick?: () => void;
}) {
  const tones: Record<string, string> = {
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-700',
  };
  const cls = `text-left rounded-xl border px-3 py-2.5 transition-all ${tones[tone]} ${onClick ? 'hover:shadow-sm cursor-pointer' : 'cursor-default'} ${active ? 'ring-2 ring-slate-900/10 shadow-sm' : ''}`;
  const inner = (
    <>
      <p className="text-[8px] font-mono uppercase tracking-widest opacity-80">{label}</p>
      <p className="text-xl font-bold leading-tight tabular-nums mt-0.5">{value}</p>
      {sub && <p className="text-[9px] font-mono mt-0.5 opacity-70">{sub}</p>}
    </>
  );
  if (onClick) return <button onClick={onClick} className={cls}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
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
        ) : (
          options.map(o => {
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
          })
        )}
      </div>
    </div>
  );
}

// ── Sheet (the spreadsheet table itself) ─────────────────────────────────────
function Sheet({
  units, supplierMap, aggIndex, mappings, sort, onSort,
  activeUnitId, onSelect, editingCell, onEdit, onCancelEdit, onSaveCell,
  rowMenuId, setRowMenuId, onDelete, onViewDetail, region,
}: {
  units: InventoryUnit[];
  supplierMap: Record<string, string>;
  aggIndex: Map<string, InventoryAggregate>;
  mappings: Map<string, MappingResult>;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  activeUnitId: string | null;
  onSelect: (u: InventoryUnit) => void;
  editingCell: { id: string; field: string } | null;
  onEdit: (id: string, field: string) => void;
  onCancelEdit: () => void;
  onSaveCell: (u: InventoryUnit, field: string, value: any) => Promise<void>;
  rowMenuId: string | null;
  setRowMenuId: (id: string | null) => void;
  onDelete: (u: InventoryUnit) => void;
  onViewDetail: (u: InventoryUnit) => void;
  region: 'uk' | 'india' | 'admin' | 'both';
}) {
  const toggleSort = (k: SortKey) => {
    onSort({ key: k, dir: sort.key === k && sort.dir === 'desc' ? 'asc' : 'desc' });
  };

  // Grid template: IMEI (frozen) | Stock In | Model | Storage | Colour | BP | Supplier | Status | Marketplace | Date Out | Notes | Actions
  // We'll use a real table for proper sticky behaviour.

  if (units.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center text-slate-400">
        <Sparkles size={28} className="mx-auto" />
        <p className="text-[11px] font-mono uppercase tracking-widest mt-2">No IMEIs match these filters</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="overflow-auto max-h-[calc(100vh-380px)] custom-scrollbar">
        <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <thead>
            <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
              <Th sticky leftPx={0} width="170px" k="model" sort={sort} onSort={undefined}>
                <span className="text-slate-400">#</span> IMEI
              </Th>
              <Th k="dateIn"      sort={sort} onSort={toggleSort} width="110px">Stock In</Th>
              <Th k="model"       sort={sort} onSort={toggleSort} width="280px">Model</Th>
              <Th k="storage"     sort={sort} onSort={toggleSort} width="80px">Storage</Th>
              <Th k="colour"      sort={sort} onSort={toggleSort} width="130px">Colour</Th>
              <Th k="buyPrice"    sort={sort} onSort={toggleSort} width="80px" align="right">BP</Th>
              <Th k="supplier"    sort={sort} onSort={toggleSort} width="130px">Supplier</Th>
              <Th k="status"      sort={sort} onSort={toggleSort} width="120px">Status</Th>
              <Th k="marketplace" sort={sort} onSort={toggleSort} width="120px">Marketplace</Th>
              <Th k="dateOut"     sort={sort} onSort={toggleSort} width="110px">Stock Out</Th>
              <Th                   sort={sort} onSort={undefined} width="200px">Notes</Th>
              <Th                   sort={sort} onSort={undefined} width="60px"><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {units.map((u, idx) => {
              const isActive = u.id === activeUnitId;
              const isAlt = idx % 2 === 1;
              const supplierName = supplierMap[u.supplierId] || u.supplierName || '—';
              const tone = STATUS_TONE[u.status] || STATUS_TONE.available;
              const apple = isAppleDevice(u.model);
              const imeiValid = isValidImei(u.imei, { isAppleSerial: apple });
              // Mapping result is the source of truth for the linked aggregate
              // (auto-match + operator override + orphan handling); fall back to
              // the legacy key-based lookup only when the mapper returned
              // nothing usable (defensive — should not happen at runtime).
              const mapping = mappings.get(u.id);
              const agg = mapping?.aggregate ?? aggIndex.get(aggKey(u.brand, u.model, u.storage));
              const salesFocus = (agg?.notesFlag || '').toUpperCase().includes('SALES FOCUS');
              const rowBg = isActive
                ? 'bg-indigo-50'
                : isAlt
                  ? 'bg-slate-50/40 hover:bg-slate-100/60'
                  : 'bg-white hover:bg-slate-50';

              return (
                <tr key={u.id} className={`${rowBg} transition-colors cursor-default group`}>
                  {/* Frozen IMEI cell */}
                  <Td sticky leftPx={0} className={`${rowBg} border-r border-slate-200`}>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 text-[9px] tabular-nums w-6 text-right">{idx + 1}</span>
                      {imeiValid ? (
                        <CopyImei imei={u.imei} truncate={15} />
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono">
                          <AlertCircle size={10} /> {u.imei ? 'invalid' : 'missing'}
                        </span>
                      )}
                    </div>
                  </Td>

                  <Td>
                    <span className="text-slate-700">{fmtDateForUser(u.dateIn || '', region) || u.dateIn || '—'}</span>
                  </Td>

                  <Td>
                    <button
                      onClick={() => onSelect(u)}
                      className="text-left font-bold text-slate-900 hover:text-indigo-700 truncate max-w-full inline-flex items-center gap-1.5"
                      title={u.model}
                    >
                      <span className="truncate">{u.model || '—'}</span>
                      <MappingBadge mapping={mapping} />
                      {salesFocus && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0 uppercase tracking-widest">
                          Focus
                        </span>
                      )}
                    </button>
                  </Td>

                  <Td><span className="text-slate-600">{u.storage || '—'}</span></Td>
                  <Td><span className="text-slate-600 truncate">{u.colour || '—'}</span></Td>

                  {/* BP — inline editable */}
                  <Td align="right">
                    <InlineEditableCell
                      editing={editingCell?.id === u.id && editingCell?.field === 'buyPrice'}
                      onActivate={() => onEdit(u.id, 'buyPrice')}
                      onCommit={async (v) => { await onSaveCell(u, 'buyPrice', Number(v) || 0); }}
                      onCancel={onCancelEdit}
                      initialValue={String(u.buyPrice ?? 0)}
                      display={<span className="font-bold text-slate-900">£{u.buyPrice ?? 0}</span>}
                      align="right"
                      type="number"
                    />
                  </Td>

                  <Td><span className="text-slate-700 truncate">{supplierName}</span></Td>

                  {/* Status — inline editable (select) */}
                  <Td>
                    <InlineEditableSelect
                      editing={editingCell?.id === u.id && editingCell?.field === 'status'}
                      onActivate={() => onEdit(u.id, 'status')}
                      onCommit={async (v) => { await onSaveCell(u, 'status', v); }}
                      onCancel={onCancelEdit}
                      value={u.status}
                      options={['available', 'sold', 'incoming', 'returned', 'reserved', 'ready_to_ship', 'fba', 'lost']}
                      display={
                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                          {u.status}
                        </span>
                      }
                    />
                  </Td>

                  {/* Marketplace — inline editable */}
                  <Td>
                    <InlineEditableSelect
                      editing={editingCell?.id === u.id && editingCell?.field === 'marketplace'}
                      onActivate={() => onEdit(u.id, 'marketplace')}
                      onCommit={async (v) => { await onSaveCell(u, 'marketplace', v); }}
                      onCancel={onCancelEdit}
                      value={u.marketplace || ''}
                      options={['', ...LISTING_SITES as ListingSite[]]}
                      formatLabel={v => v ? listingSiteLabel(v) : '—'}
                      display={
                        u.marketplace
                          ? <span className="text-[10px] font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">{listingSiteLabel(u.marketplace)}</span>
                          : <span className="text-slate-300">—</span>
                      }
                    />
                  </Td>

                  <Td><span className="text-slate-600">{u.stockOutDate ? (fmtDateForUser(u.stockOutDate, region) || u.stockOutDate) : '—'}</span></Td>

                  {/* Notes — inline editable */}
                  <Td>
                    <InlineEditableCell
                      editing={editingCell?.id === u.id && editingCell?.field === 'notes'}
                      onActivate={() => onEdit(u.id, 'notes')}
                      onCommit={async (v) => { await onSaveCell(u, 'notes', v); }}
                      onCancel={onCancelEdit}
                      initialValue={u.notes || ''}
                      display={<span className="text-slate-500 truncate" title={u.notes || ''}>{u.notes || ''}</span>}
                    />
                  </Td>

                  {/* Row actions */}
                  <Td>
                    <div className="relative" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setRowMenuId(rowMenuId === u.id ? null : u.id)}
                        className="opacity-30 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 text-slate-600 transition-all"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                      {rowMenuId === u.id && (
                        <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-1">
                          <button
                            onClick={() => { setRowMenuId(null); onViewDetail(u); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                          >
                            <Eye size={11} /> View detail
                          </button>
                          {u.imei && (
                            <button
                              onClick={() => {
                                setRowMenuId(null);
                                try { navigator.clipboard.writeText(u.imei); } catch {}
                              }}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-700 hover:bg-slate-50"
                            >
                              <Sparkles size={11} /> Copy IMEI
                            </button>
                          )}
                          <button
                            onClick={() => { setRowMenuId(null); onDelete(u); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 size={11} /> Delete row
                          </button>
                        </div>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Header cell ──────────────────────────────────────────────────────────────
function Th({
  children, k, sort, onSort, sticky, leftPx, width, align,
}: {
  children: React.ReactNode;
  k?: SortKey;
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
    minWidth: width,
    width,
    ...(sticky ? { left: `${leftPx ?? 0}px` } : {}),
  };
  return (
    <th className={cls} style={style}>
      {k && onSort ? (
        <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-slate-900 transition-colors">
          {children}
          {active ? (sort.dir === 'desc' ? <ChevronDown size={10} /> : <ChevronUp size={10} />) : <ChevronsUpDown size={10} className="opacity-40" />}
        </button>
      ) : children}
    </th>
  );
}

// ── Body cell ────────────────────────────────────────────────────────────────
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

// ── Inline editable text/number cell ────────────────────────────────────────
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
      >
        {display}
      </button>
    );
  }
  return (
    <input
      ref={inputRef}
      type={type ?? 'text'}
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={async e => {
        if (e.key === 'Enter') { await onCommit(val); }
        else if (e.key === 'Escape') { onCancel(); }
      }}
      onBlur={async () => { await onCommit(val); }}
      className={`w-full text-${align ?? 'left'} bg-white border border-indigo-500 rounded px-1.5 py-0.5 text-[11px] focus:outline-none font-mono`}
    />
  );
}

// ── Inline editable select ──────────────────────────────────────────────────
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
      >
        {display}
      </button>
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
      {options.map(o => (
        <option key={o} value={o}>{formatLabel ? formatLabel(o) : (o || '—')}</option>
      ))}
    </select>
  );
}

// ── SHS pinned section ──────────────────────────────────────────────────────
function ShsAwaitingSection({
  aggregates, manualUnits, supplierMap, onReceiveAgg, onReceiveUnit,
}: {
  aggregates: InventoryAggregate[];
  manualUnits: InventoryUnit[];
  supplierMap: Record<string, string>;
  onReceiveAgg: (a: InventoryAggregate) => void;
  onReceiveUnit: (u: InventoryUnit) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = aggregates.length + manualUnits.length;

  return (
    <div className="bg-gradient-to-br from-orange-50/60 to-amber-50/30 border border-orange-100 rounded-3xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-orange-100/40 transition-colors"
      >
        <div className="w-7 h-7 rounded-lg bg-orange-200 text-orange-700 flex items-center justify-center flex-shrink-0">
          <Truck size={14} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-orange-900">Supplier Holdings · Awaiting Receive</p>
          <p className="text-[9px] font-mono text-orange-700/70 mt-0.5">IMEIs don't exist yet · receive into stock when delivered</p>
        </div>
        <span className="text-[10px] font-mono bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">{count}</span>
        {open ? <ChevronUp size={14} className="text-orange-700" /> : <ChevronDown size={14} className="text-orange-700" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white/60 border-t border-orange-100 divide-y divide-orange-50">
              {aggregates.map(a => {
                const sname = a.supplierIds?.[0] ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0]) : '—';
                const qty = a.quantityNum ?? '—';
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-slate-900 truncate">{a.model}</p>
                      <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                        SHS · {sname} {a.coloursRaw ? `· ${a.coloursRaw}` : ''} {typeof qty === 'number' ? `· ×${qty}` : ''}
                      </p>
                    </div>
                    {typeof a.buyPrice === 'number' && <span className="text-sm font-bold text-slate-800">£{a.buyPrice}</span>}
                    <button
                      onClick={() => onReceiveAgg(a)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-orange-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-orange-600 transition-all"
                    >
                      <PackageCheck size={11} /> Receive
                    </button>
                  </div>
                );
              })}
              {manualUnits.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-amber-50/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-slate-900 truncate">{u.model}</p>
                    <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                      Manual SHS · {supplierMap[u.supplierId] || '—'} · {u.dateIn}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-slate-800">£{u.buyPrice}</span>
                  <button
                    onClick={() => onReceiveUnit(u)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-amber-600 transition-all"
                  >
                    <PackageCheck size={11} /> Receive
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Schema help card ─────────────────────────────────────────────────────────
// Documents the required fields every IMEI row needs so the in-app data round-
// trips cleanly into the INVENTORY_REPORT_2026 master spreadsheet. Surfaced
// from the Buy header (Info button) — useful when ops onboards new staff or
// when the importer rejects rows for missing fields.
function SchemaHelpCard({ onClose }: { onClose: () => void }) {
  const fields: Array<{
    col: string;
    field: string;
    required: 'always' | 'on-sale' | 'optional';
    note: string;
  }> = [
    { col: 'A',  field: 'STOCK IN DATE',  required: 'always',   note: 'When the unit arrived in office. ISO date.' },
    { col: 'B',  field: 'MODEL',          required: 'always',   note: 'Full model + storage, e.g. "Apple iPhone 13 128GB".' },
    { col: 'C',  field: 'IMEI NUMBER',    required: 'always',   note: '15-digit IMEI (or 10–12 char serial for Apple). The distinct key.' },
    { col: 'D',  field: 'BP',             required: 'always',   note: 'Buy price in £. Drives Tied Capital + In-Office Value.' },
    { col: 'E',  field: 'COLOURS',        required: 'always',   note: 'Single colour per row (e.g. "Space Grey").' },
    { col: 'F',  field: 'SUPPLIER',       required: 'always',   note: 'Supplier name; resolved to a supplier record on import.' },
    { col: 'G',  field: 'NOTES',          required: 'optional', note: 'Free text — condition, lock state, etc.' },
    { col: 'H',  field: 'STATUS',         required: 'on-sale',  note: 'Blank = available. "SOLD" once sold.' },
    { col: 'I',  field: 'MARKETPLACE',    required: 'on-sale',  note: 'Amazon / eBay / OnBuy / Back Market / Project / FBA / R T S.' },
    { col: 'J',  field: 'STOCK OUT DATE', required: 'on-sale',  note: 'Date sold; auto-stamped when status flips to SOLD.' },
  ];
  const toneFor = (r: typeof fields[number]['required']) =>
    r === 'always'   ? { dot: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    label: 'Required' }
    : r === 'on-sale'? { dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   label: 'When sold' }
    :                  { dot: 'bg-slate-400',   text: 'text-slate-600',   bg: 'bg-slate-50',   label: 'Optional' };

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-900 flex items-center gap-2">
            <Info size={14} /> Required Fields · IMEI NUMBERS sheet
          </p>
          <p className="text-[10px] font-mono text-indigo-700/70 mt-1">
            Every IMEI row needs these columns to round-trip into the INVENTORY_REPORT_2026 workbook.
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

      <p className="text-[9px] font-mono text-indigo-700/70 mt-3 flex items-center gap-1.5">
        <AlertCircle size={10} />
        Rows missing any "Required" column are dropped during import. SHS rows skip IMEI/STATUS/MARKETPLACE — they sync via the SHS section.
      </p>
    </div>
  );
}

// ── Missing IMEI backfill (inline section, surfaced when filter is 'missing') ─
function MissingImeiBackfill({ units, suppliers }: { units: InventoryUnit[]; suppliers: Record<string, string> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const handleSave = async (unit: InventoryUnit) => {
    const next = (drafts[unit.id] || '').trim();
    const apple = isAppleDevice(unit.model);
    if (!isValidImei(next, { isAppleSerial: apple })) {
      setErrs(e => ({ ...e, [unit.id]: apple ? 'Need a valid IMEI or 10–12 char Apple serial' : 'Need a valid 15-digit IMEI' }));
      return;
    }
    setSavingId(unit.id);
    try {
      const res = await backfillImei(unit.id, next);
      if (!res.ok) setErrs(e => ({ ...e, [unit.id]: res.message || res.error || 'Save failed' }));
      else {
        setDrafts(d => { const c = { ...d }; delete c[unit.id]; return c; });
        setErrs(e => { const c = { ...e }; delete c[unit.id]; return c; });
      }
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-rose-50/40 border border-rose-100 rounded-3xl shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-rose-100">
        <AlertTriangle size={14} className="text-rose-600" />
        <p className="text-[11px] font-bold uppercase tracking-widest text-rose-900">Backfill IMEIs</p>
        <span className="text-[10px] font-mono text-rose-600/70">Type the IMEI and Enter; row drops out instantly</span>
      </div>
      <div className="divide-y divide-rose-100/60">
        {units.map(u => {
          const draft = drafts[u.id] ?? '';
          const err = errs[u.id];
          const saving = savingId === u.id;
          const valid = isValidImei(draft, { isAppleSerial: isAppleDevice(u.model) });
          return (
            <div key={u.id} className="flex items-center gap-3 px-4 py-2 hover:bg-rose-50/60 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-900 truncate">{u.model}{u.storage ? ' · ' + u.storage : ''}</p>
                <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                  {u.colour && u.colour !== 'Unknown' ? `${u.colour} · ` : ''}
                  {suppliers[u.supplierId] || u.supplierName || '—'} · {u.dateIn || '—'} · £{u.buyPrice}
                </p>
                {err && <p className="text-[9px] text-rose-600 font-mono mt-1">{err}</p>}
              </div>
              <input
                type="text"
                value={draft}
                onChange={e => setDrafts(d => ({ ...d, [u.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter' && valid && !saving) handleSave(u); }}
                placeholder="IMEI / serial"
                className={`px-2 py-1 border rounded-lg text-[11px] font-mono w-44 focus:outline-none ${
                  draft && !valid ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white focus:border-slate-900'
                }`}
                disabled={saving}
              />
              <button
                onClick={() => handleSave(u)}
                disabled={!valid || saving}
                className="px-3 py-1 bg-rose-600 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-rose-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {saving ? <Clock size={11} className="animate-spin" /> : <Save size={11} />}
                Save
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail Panel (slide-out drawer with master rollup + WhatsApp quotes) ─────
function DetailPanel({
  unit, supplierName, agg, quotes, region,
  onClose, onPatch, onDelete,
}: {
  unit: InventoryUnit;
  supplierName: string;
  agg: InventoryAggregate | undefined;
  quotes: SupplierWhatsappUpdate[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
  onPatch: (patch: Partial<InventoryUnit>) => Promise<void>;
  onDelete: () => void;
}) {
  const tone = STATUS_TONE[unit.status] || STATUS_TONE.available;
  const apple = isAppleDevice(unit.model);
  const imeiValid = isValidImei(unit.imei, { isAppleSerial: apple });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white border-l border-slate-200 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">IMEI</p>
            {imeiValid ? (
              <div className="mt-1"><CopyImei imei={unit.imei} truncate={24} /></div>
            ) : (
              <p className="text-[12px] font-mono text-rose-600 mt-1">⚠ {unit.imei ? 'invalid' : 'missing'}</p>
            )}
            <p className="text-base font-bold tracking-tight text-slate-900 mt-2 leading-snug">{unit.model || '—'}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${tone.bg} ${tone.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                {unit.status}
              </span>
              {unit.marketplace && (
                <span className="text-[9px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded uppercase tracking-widest">
                  {listingSiteLabel(unit.marketplace)}
                </span>
              )}
              {unit.storage && <span className="text-[9px] font-mono text-slate-500">{unit.storage}</span>}
              {unit.colour && <span className="text-[9px] font-mono text-slate-500">{unit.colour}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-900 transition-all flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Buy facts */}
          <DetailSection title="Buy">
            <Field k="Buy Price" v={`£${unit.buyPrice ?? 0}`} />
            <Field k="Stock In"  v={fmtDateForUser(unit.dateIn, region) || unit.dateIn || '—'} />
            <Field k="Stock Out" v={unit.stockOutDate ? (fmtDateForUser(unit.stockOutDate, region) || unit.stockOutDate) : '—'} />
            <Field k="Supplier"  v={supplierName} />
            {unit.batchId && <Field k="Batch" v={unit.batchId === 'master_batch' ? 'Master' : unit.batchId} />}
          </DetailSection>

          {/* Master rollup (INVENTORY sheet) */}
          {agg && (
            <DetailSection
              title="Series Rollup"
              accent="bg-indigo-50 border-indigo-100"
              badge="INVENTORY sheet"
            >
              <Field k="Quantity"   v={agg.quantityNum != null ? String(agg.quantityNum) : (agg.quantityText || '—')} />
              <Field k="Value"      v={agg.buyPrice && agg.quantityNum ? `£${(agg.buyPrice * agg.quantityNum).toLocaleString()}` : '—'} />
              <Field k="Sales Focus" v={agg.notesFlag || '—'} highlight={(agg.notesFlag || '').toUpperCase().includes('SALES FOCUS')} />
              {agg.coloursRaw && <Field k="Colours" v={agg.coloursRaw} />}
              {agg.notes && <Field k="Notes" v={agg.notes} />}
            </DetailSection>
          )}

          {/* Notes — editable */}
          <DetailSection title="Notes">
            <NotesEditor value={unit.notes || ''} onSave={v => onPatch({ notes: v })} />
          </DetailSection>

          {/* Supplier WhatsApp quotes */}
          {quotes.length > 0 && (
            <DetailSection title="Supplier WhatsApp Quotes" badge={`${quotes.length} match${quotes.length === 1 ? '' : 'es'}`}>
              <div className="space-y-2">
                {quotes.slice(0, 8).map(q => (
                  <div key={q.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                    <MessageCircle size={11} className="text-emerald-600 mt-0.5 flex-shrink-0" />
                    <p className="flex-1 text-[10px] font-mono text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                      {q.rawText}
                    </p>
                    {q.priceText && (
                      <span className="text-[11px] font-bold text-emerald-800 flex-shrink-0">{q.priceText}</span>
                    )}
                  </div>
                ))}
              </div>
            </DetailSection>
          )}

          {/* Status & Marketplace quick-set */}
          <DetailSection title="Quick Actions">
            <div className="grid grid-cols-2 gap-2">
              <QuickActionButton
                label="Mark Sold"
                tone="slate"
                disabled={unit.status === 'sold'}
                onClick={() => onPatch({ status: 'sold', stockOutDate: unit.stockOutDate || new Date().toISOString().split('T')[0] })}
              />
              <QuickActionButton
                label="Mark Available"
                tone="emerald"
                disabled={unit.status === 'available'}
                onClick={() => onPatch({ status: 'available', stockOutDate: '' })}
              />
              <QuickActionButton
                label="Return"
                tone="rose"
                disabled={unit.status === 'returned'}
                onClick={() => onPatch({ status: 'returned' })}
              />
              <QuickActionButton
                label="Delete row"
                tone="rose-outline"
                onClick={onDelete}
              />
            </div>
          </DetailSection>
        </div>
      </motion.aside>
    </>
  );
}

function DetailSection({ title, badge, children, accent }: { title: string; badge?: string; children: React.ReactNode; accent?: string }) {
  return (
    <section className={`rounded-2xl p-3.5 border ${accent ?? 'bg-slate-50/60 border-slate-100'}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
        {badge && <span className="text-[8px] font-mono text-slate-400 px-1.5 py-0.5 bg-white border border-slate-100 rounded">{badge}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Field({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-slate-400 font-mono text-[10px] uppercase tracking-widest">{k}</span>
      <span className={`font-medium tabular-nums text-right ${highlight ? 'text-emerald-700 font-bold' : 'text-slate-900'}`}>{v}</span>
    </div>
  );
}

function QuickActionButton({
  label, onClick, tone, disabled,
}: { label: string; onClick: () => void; tone: 'slate' | 'emerald' | 'rose' | 'rose-outline'; disabled?: boolean }) {
  const tones: Record<string, string> = {
    slate:        'bg-slate-900 text-white hover:bg-slate-700',
    emerald:      'bg-emerald-600 text-white hover:bg-emerald-700',
    rose:         'bg-rose-600 text-white hover:bg-rose-700',
    'rose-outline': 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {label}
    </button>
  );
}

function NotesEditor({ value, onSave }: { value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== value;
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={3}
        placeholder="Free-text notes…"
        className="w-full text-[11px] font-mono bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:border-slate-900"
      />
      <div className="flex justify-end mt-1.5">
        <button
          onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
          disabled={!dirty || saving}
          className="px-3 py-1.5 bg-slate-900 text-white text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-slate-700 transition-all disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </div>
  );
}

// ── Mapping badge + review queue ─────────────────────────────────────────────

function MappingBadge({ mapping }: { mapping: MappingResult | undefined }) {
  if (!mapping || mapping.status === 'shs') return null;
  if (mapping.status === 'mapped' || mapping.status === 'manual') {
    const isManual = mapping.status === 'manual';
    return (
      <span
        title={`${isManual ? 'Operator-confirmed' : 'Auto-matched'} to: ${mapping.aggregate?.model ?? ''}`}
        className={`text-[8px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 uppercase tracking-widest ${
          isManual
            ? 'bg-violet-50 text-violet-700 border-violet-200'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}
      >
        {isManual ? 'Mapped ✓' : 'Mapped'}
      </span>
    );
  }
  if (mapping.status === 'orphan') {
    return (
      <span
        title="Operator confirmed: no INVENTORY row for this IMEI"
        className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 flex-shrink-0 uppercase tracking-widest"
      >
        Orphan
      </span>
    );
  }
  return (
    <span
      title="No match in INVENTORY master sheet — review required"
      className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0 uppercase tracking-widest inline-flex items-center gap-0.5"
    >
      <AlertTriangle size={9} /> Unmapped
    </span>
  );
}

function MappingReviewSection({
  units, mappings, onConfirm, onMarkOrphan,
}: {
  units: InventoryUnit[];
  mappings: Map<string, MappingResult>;
  onConfirm: (unitId: string, aggregateId: string) => Promise<void>;
  onMarkOrphan: (unitId: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (units.length === 0) return null;

  return (
    <div className="bg-amber-50/40 border border-amber-100 rounded-3xl shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-amber-100">
        <AlertTriangle size={14} className="text-amber-600" />
        <div className="flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-900">
            Mapping Review · {units.length} IMEI{units.length === 1 ? '' : 's'}
          </p>
          <p className="text-[10px] font-mono text-amber-700/70 mt-0.5">
            Pick the matching INVENTORY model from the suggestions, or mark as Orphan if no master row exists.
          </p>
        </div>
      </div>
      <div className="divide-y divide-amber-100/60">
        {units.map(u => {
          const m = mappings.get(u.id);
          const suggestions = m?.suggestions ?? [];
          const busy = busyId === u.id;
          return (
            <div key={u.id} className="px-4 py-3 hover:bg-amber-50/60 transition-colors">
              <div className="flex items-start gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-slate-900 truncate">
                    {u.model || '—'}
                    {u.storage ? <span className="text-slate-500 font-mono ml-1">{u.storage}</span> : null}
                  </p>
                  <p className="text-[9px] text-slate-500 font-mono mt-0.5 truncate">
                    IMEI {u.imei || '—'} · {u.colour || '—'} · £{u.buyPrice}
                  </p>
                </div>
                <button
                  onClick={async () => { setBusyId(u.id); try { await onMarkOrphan(u.id); } finally { setBusyId(null); } }}
                  disabled={busy}
                  className="px-3 py-1 border border-slate-200 text-slate-600 text-[9px] font-bold uppercase tracking-widest rounded-lg hover:bg-slate-50 transition-all disabled:opacity-40 flex-shrink-0"
                >
                  Mark Orphan
                </button>
              </div>
              {suggestions.length === 0 ? (
                <p className="text-[10px] font-mono text-amber-600/70 pl-1">No close matches — mark as Orphan or update the INVENTORY sheet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map(s => (
                    <button
                      key={s.id}
                      onClick={async () => { setBusyId(u.id); try { await onConfirm(u.id, s.id); } finally { setBusyId(null); } }}
                      disabled={busy}
                      className="text-left bg-white border border-amber-200 hover:border-amber-500 hover:bg-amber-50 rounded-lg px-2.5 py-1.5 transition-all disabled:opacity-40"
                    >
                      <p className="text-[10px] font-bold text-slate-900 truncate max-w-xs">{s.model}</p>
                      <p className="text-[9px] font-mono text-slate-500 mt-0.5">
                        {s.storage || '—'}
                        {typeof s.quantityNum === 'number' ? ` · qty ${s.quantityNum}` : ''}
                        {s.buyPrice ? ` · £${s.buyPrice}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function aggKey(brand: string | undefined, model: string | undefined, storage: string | undefined): string {
  const p = (model && !brand) ? parseBrandModelStorage(model) : { brand: brand || '', model: model || '', storage };
  return `${(p.brand || '').toLowerCase()}|${(p.model || '').toLowerCase()}|${(p.storage || storage || '').toLowerCase()}`;
}

function sortUnits(
  units: InventoryUnit[],
  sort: { key: SortKey; dir: SortDir },
  supplierMap: Record<string, string>,
): InventoryUnit[] {
  const mult = sort.dir === 'asc' ? 1 : -1;
  const get = (u: InventoryUnit): string | number => {
    switch (sort.key) {
      case 'dateIn':      return u.dateIn || '';
      case 'dateOut':     return u.stockOutDate || '';
      case 'model':       return (u.model || '').toLowerCase();
      case 'storage':     return (u.storage || '').toLowerCase();
      case 'colour':      return (u.colour || '').toLowerCase();
      case 'buyPrice':    return u.buyPrice || 0;
      case 'supplier':    return (supplierMap[u.supplierId] || u.supplierName || '').toLowerCase();
      case 'status':      return u.status || '';
      case 'marketplace': return (u.marketplace || '').toLowerCase();
      default:            return '';
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
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
