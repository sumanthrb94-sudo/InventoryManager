/**
 * StockOverlayModal — the Excel-style "stock in view" overlay shared between
 * BuySheet (KPI tiles) and PeriodicInventory (element tiles).
 *
 * Two display modes:
 *   - grouped  — one row per model, expandable colour breakdown
 *   - detailed — full 10-column read-only schema mirroring the master export
 *
 * Self-managing on sort state: the parent passes the rows + aggregates, the
 * overlay owns the column-sort, the grouped-sort, the in-overlay search and
 * the grouped/detailed toggle. Mounted from an <AnimatePresence> by the
 * caller so the enter/exit transition is owned upstream.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronDown, ChevronUp, ChevronsUpDown, X,
  AlertCircle, Truck, ChevronRight, Layers, List, Sparkles,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { InventoryUnit, InventoryAggregate } from '../types';
import { fmtDateForUser } from '../lib/userLocale';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import CopyImei from './CopyImei';
import PaginationBar, { usePagedRows } from './PaginationBar';
import EditableCell from './EditableCell';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { deleteShsUnit, deleteShsAggregate } from '../services/shsService';
import type { DeleteShsResult } from '../services/shsService';
import { deleteOfficeUnit, adminUpdateUnit } from '../services/inventoryService';

// ── Detail-view sort types (used by the 10-column table headers) ────────────
export type SortKey = 'dateIn' | 'model' | 'storage' | 'colour' | 'buyPrice' | 'supplier' | 'grade';
export type SortDir = 'asc' | 'desc';

const STATUS_TONE: Record<string, { bg: string; text: string; dot: string }> = {
  available: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  sold:      { bg: 'bg-slate-100 border-slate-200',   text: 'text-slate-600',   dot: 'bg-slate-400'  },
  incoming:  { bg: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',   dot: 'bg-amber-500'  },
  returned:  { bg: 'bg-rose-50 border-rose-200',      text: 'text-rose-700',    dot: 'bg-rose-500'   },
};

/** Admin-only delete button for SHS rows. Confirms, calls the service, and
 *  surfaces any error via alert() so the operator knows if Firestore rules
 *  rejected the delete. */
function ShsDeleteButton({ onDelete, title }: { onDelete: () => Promise<DeleteShsResult>; title?: string }) {
  const [busy, setBusy] = useState(false);
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(title || 'Delete this SHS stock? The supplier has confirmed no stock.')) return;
    setBusy(true);
    try {
      const res = await onDelete();
      if (!res.ok) alert(res.message || 'Delete failed');
    } catch (err: any) {
      alert(err?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title={title || 'Delete SHS stock'}
      className="p-1 rounded-md text-rose-400 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-40"
    >
      <Trash2 size={14} />
    </button>
  );
}

function OfficeDeleteButton({ unit }: { unit: InventoryUnit }) {
  const [busy, setBusy] = useState(false);
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unit.status === 'sold') {
      alert('Cannot delete a sold unit. Void the sale first.');
      return;
    }
    const reason = window.prompt(`Delete office unit ${unit.model}? Enter reason:`);
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      alert('A reason is required to delete the unit.');
      return;
    }
    setBusy(true);
    try {
      const res = await deleteOfficeUnit(unit, reason.trim());
      if (!res.ok) alert(res.message || 'Delete failed');
    } catch (err: any) {
      alert(err?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={handleClick}
      disabled={busy}
      title="Delete office unit"
      className="p-1 rounded-md text-rose-400 hover:text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-40"
    >
      <Trash2 size={14} />
    </button>
  );
}

// ── Grouped-model helpers (shared with InlineSheet in BuySheet.tsx) ─────────
// One row per (model) bucket: total qty, per-colour breakdown, latest BP,
// rolled-up stock value, distinct operator notes. Aggregate rollups are
// folded in as their own pseudo-buckets (since they have no IMEIs) and
// rendered alongside IMEI-tracked groups — both surfaces dedupe so a model
// that has IMEIs doesn't also surface its rollup. The grouping is the
// page's primary "what do we have on hand" lens.

export type GroupSortKey = 'model' | 'stockIn' | 'age' | 'colours' | 'qty' | 'bp' | 'value' | 'notes' | 'sold' | 'lastSold';
export type GroupSortDir = 'asc' | 'desc';
export interface GroupSort { key: GroupSortKey; dir: GroupSortDir; }
export const DEFAULT_GROUP_SORT: GroupSort = { key: 'stockIn', dir: 'desc' };

/** Sensible default direction when a header is clicked for the first time.
 *  Most columns are "biggest first" (qty, value, etc.); model is A→Z. */
export const GROUP_SORT_DEFAULT_DIR: Record<GroupSortKey, GroupSortDir> = {
  model:   'asc',
  stockIn: 'desc',
  // Age defaults to descending — operator's primary use-case is "find the
  // stalest SKU first", so clicking the Age header puts the oldest groups
  // at the top.
  age:     'desc',
  colours: 'desc',
  qty:     'desc',
  bp:      'desc',
  value:   'desc',
  notes:   'desc',
  sold:    'desc',
  lastSold:'desc',
};

/** Per-colour aggregate within a model group. Same colour can carry
 *  multiple BPs (operator buys the same SKU from different suppliers at
 *  different prices) — track qty + price range + rolled-up value so the
 *  expanded colour row can surface them all. */
export type GroupedColour = {
  qty: number;
  /** Latest BP captured for this colour. */
  latestBp: number;
  /** Lowest BP across units of this colour (0 if no priced units). */
  minBp: number;
  /** Highest BP across units of this colour. */
  maxBp: number;
  /** Σ buyPrice for this colour. */
  totalValue: number;
  /** Per-supplier qty/BP breakdown — surfaces the "two suppliers, same
   *  colour, different prices" case the operator flagged. Keyed by
   *  supplier display name. */
  bySupplier: Map<string, { qty: number; latestBp: number; totalValue: number }>;
};

export type GroupedModel = {
  key: string;
  model: string;
  total: number;
  byColour: Map<string, GroupedColour>;
  /** Per-SIM-type qty breakdown. Keyed by simType value (e.g. 'Physical SIM',
   *  'Dual Physical SIM'). 'Unspecified' catch-all for units added before
   *  the simType field existed or when the operator left it blank. */
  bySimType: Map<string, number>;
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
  /** Earliest dateIn across the units in the group — used to derive the
   *  Age column. When a SKU has units stocked on multiple dates we surface
   *  the LONGEST age (oldest unit) because that's the reorder-stale
   *  signal the operator cares about: "this SKU has stock sitting from
   *  N days ago, not just from yesterday's batch". */
  oldestDateIn: string;
  /** Count of units in the group with status='sold'. Surfaced as the
   *  "Sold" column so an operator scanning the grouped overlay can see
   *  fulfilment volume per SKU without expanding the row. */
  soldCount: number;
  /** Latest saleDate across the sold units in the group (ISO YYYY-MM-DD),
   *  '' if no unit in the group has sold. Surfaced as the "Last Sold"
   *  column. */
  latestSoldDate: string;
};

/** Days between `isoDate` (YYYY-MM-DD or any ISO date string) and today.
 *  Floor — so a unit stocked this morning reads 0, yesterday reads 1.
 *  Empty / unparseable strings return null so callers can show "—". */
export function ageInDays(isoDate: string): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return null;
  const diff = Date.now() - then;
  if (diff < 0) return 0;
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

/** Derive a canonical bucket-key for a unit while preserving the
 *  operator's exact typed model string for display. Two surfaces:
 *
 *   - keyModel/storage/tag: canonical (parser-normalised) so two operators
 *     entering the same SKU in different formats — "iPhone 13 128GB" with
 *     storage inline vs "iPhone 13" + separate storage field — bucket to
 *     the same row.
 *
 *   - label: the raw u.model VERBATIM, only augmented with storage from
 *     the separate Storage field if it's not already in the model string.
 *     The operator types "Apple iPad Pro 10.9 WiFi / Cellular" and that
 *     text shows up unchanged on the grouped row. No silent normalisation,
 *     no stripped brand prefix, no canonicalised tag punctuation.
 */
function canonicalize(u: InventoryUnit): {
  /** Lowercase parser-cleaned model — used in the Map key. */
  keyModel: string;
  /** Effective storage (operator field wins over parsed). */
  storage: string;
  /** Effective tag (5G, WiFi+Cellular, etc.) — for the bucket key only. */
  tag: string;
  /** Display label — operator's raw text, augmented only when storage was
   *  entered separately and not yet in the model name. */
  label: string;
} {
  const raw = (u.model || '').trim();
  const parsed = parseBrandModelStorage(raw);
  const storage = (u.storage || parsed.storage || '').trim();
  const tag = (parsed.tag || '').trim();
  const keyModel = ((parsed.model || raw).trim()).toLowerCase();

  // Show what the operator typed. Only append storage from the separate
  // field if it isn't already inline in the model name. Tag is bucket-only:
  // if the operator wanted the tag to appear in the row label, they should
  // have typed it into the model field — we don't second-guess.
  const rawUpper = raw.toUpperCase();
  const storageAlreadyInRaw = storage && rawUpper.includes(storage.toUpperCase());
  let label = raw || '—';
  if (storage && !storageAlreadyInRaw) label += ' ' + storage;

  return { keyModel, storage, tag, label };
}

export function buildGroupedModels(
  rows: InventoryUnit[],
  aggregates: InventoryAggregate[],
): GroupedModel[] {
  const map = new Map<string, GroupedModel>();
  for (const u of rows) {
    const { keyModel, storage, tag, label } = canonicalize(u);
    const key = `unit::${keyModel}|${storage.toUpperCase()}|${tag.toLowerCase()}`;
    let g = map.get(key);
    if (!g) g = { key, model: label, total: 0, byColour: new Map(), bySimType: new Map(), latestBp: u.buyPrice || 0, totalValue: 0, notes: new Set(), shs: false, latestDateIn: '', oldestDateIn: '', soldCount: 0, latestSoldDate: '' };
    g.total++;
    g.totalValue += u.buyPrice || 0;
    if (u.buyPrice && u.buyPrice > 0) g.latestBp = u.buyPrice;
    if (u.status === 'sold') {
      g.soldCount++;
      const sd = (u.saleDate || '').trim();
      if (sd && sd > g.latestSoldDate) g.latestSoldDate = sd;
    }
    // Per-colour aggregation — track qty + price range + supplier breakdown
    // so the expanded row can surface "BLACK · NANAK 3×£105 · MHL 2×£100"
    // when the same colour comes from multiple suppliers at different BPs.
    const c = (u.colour || '').trim() || 'Unspecified';
    const supplier = (u.supplierName || '').trim() || 'Unknown';
    const bp = u.buyPrice || 0;
    let col = g.byColour.get(c);
    if (!col) {
      col = { qty: 0, latestBp: bp, minBp: bp > 0 ? bp : 0, maxBp: bp, totalValue: 0, bySupplier: new Map() };
      g.byColour.set(c, col);
    }
    col.qty++;
    col.totalValue += bp;
    if (bp > 0) {
      col.latestBp = bp;
      col.minBp = col.minBp > 0 ? Math.min(col.minBp, bp) : bp;
      col.maxBp = Math.max(col.maxBp, bp);
    }
    let sup = col.bySupplier.get(supplier);
    if (!sup) { sup = { qty: 0, latestBp: bp, totalValue: 0 }; col.bySupplier.set(supplier, sup); }
    sup.qty++;
    sup.totalValue += bp;
    if (bp > 0) sup.latestBp = bp;
    // Track SIM type distribution per group
    const simType = (u.simType || '').trim() || 'Unspecified';
    g.bySimType.set(simType, (g.bySimType.get(simType) || 0) + 1);
    const n = (u.notes || '').trim();
    if (n) g.notes.add(n);
    const d = (u.dateIn || '').trim();
    if (d) {
      if (d > g.latestDateIn) g.latestDateIn = d;
      // Earliest dateIn wins: lexicographic comparison works because the
      // strings are ISO YYYY-MM-DD (lower string = older calendar date).
      if (!g.oldestDateIn || d < g.oldestDateIn) g.oldestDateIn = d;
    }
    map.set(key, g);
  }
  for (const a of aggregates) {
    const model = (a.model || '').trim() || '—';
    const shs = (a.quantityText || '').toUpperCase() === 'SHS';
    const key = `${shs ? 'shs' : 'agg'}::${a.id}`;
    const qty = a.quantityNum ?? 0;
    const bp = a.buyPrice || 0;
    const supplier = (a.supplierIds?.[0] || '').trim() || 'Unknown';
    // Aggregate rollups have one rollup BP across however many colours the
    // operator listed in coloursRaw — split the rollup qty evenly and
    // attribute the rollup BP to every colour bucket.
    const colsRaw = (a.coloursRaw || '').trim();
    const byColour = new Map<string, GroupedColour>();
    const makeCol = (q: number): GroupedColour => ({
      qty: q,
      latestBp: bp,
      minBp: bp,
      maxBp: bp,
      totalValue: q * bp,
      bySupplier: new Map([[supplier, { qty: q, latestBp: bp, totalValue: q * bp }]]),
    });
    if (colsRaw) byColour.set(colsRaw, makeCol(qty));
    else byColour.set('Unspecified', makeCol(qty));
    const notes = new Set<string>();
    const n = (a.notes || '').trim();
    if (n) notes.add(n);
    // Aggregates don't have a dateIn — fall back to updatedAt (or createdAt)
    // sliced to YYYY-MM-DD so the column shows the rollup's last touch date.
    const stamp = a.updatedAt || a.createdAt;
    const latestDateIn = stamp ? String(stamp).slice(0, 10) : '';
    // Aggregates don't carry per-unit simType — leave the map empty so the
    // SIM column shows "—" for pure rollup rows (operator fills simType
    // later on the detailed view when IMEIs are captured).
    map.set(key, {
      key,
      model: shs ? `${model} · SHS` : model,
      total: qty,
      byColour,
      bySimType: new Map(),
      latestBp: bp,
      totalValue: qty * bp,
      notes,
      shs,
      latestDateIn,
      // Aggregates collapse to a single timestamp — use it for both
      // bounds so the Age column reads from updatedAt without special-casing.
      oldestDateIn: latestDateIn,
      // Aggregates don't carry per-unit sale state; leave zero.
      soldCount: 0,
      latestSoldDate: '',
    });
  }
  return Array.from(map.values());
}

export function sortGroupedModels(groups: GroupedModel[], sort: GroupSort): GroupedModel[] {
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
    case 'age':
      // Sort by oldestDateIn — the date that drives the Age column.
      // Empty bounds sink to the bottom (same convention as stockIn).
      // desc dir → oldest groups first (which is the most common use:
      // "what's been sitting longest?").
      arr.sort((a, b) => {
        if (!!a.oldestDateIn !== !!b.oldestDateIn) return a.oldestDateIn ? -1 : 1;
        // OLDER date = LONGER age, so for desc (oldest first) we want
        // ascending date order — invert mult here so the header arrow
        // direction matches the operator's expectation.
        return a.oldestDateIn.localeCompare(b.oldestDateIn) * -mult || tieBreak(a, b);
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
    case 'sold':
      arr.sort((a, b) => (a.soldCount - b.soldCount) * mult || tieBreak(a, b));
      break;
    case 'lastSold':
      // Empty latestSoldDate sinks to the bottom regardless of direction —
      // a group with no sold units isn't "older" or "newer" than one
      // that's just had a recent sale.
      arr.sort((a, b) => {
        if (!!a.latestSoldDate !== !!b.latestSoldDate) return a.latestSoldDate ? -1 : 1;
        return a.latestSoldDate.localeCompare(b.latestSoldDate) * mult || tieBreak(a, b);
      });
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
export function GroupedExcelTable({
  groups, expanded, onToggle, region, sort, onSort, showSold = true,
  onDeleteShsGroup,
}: {
  groups: GroupedModel[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  /** Region for the locale-aware Stock In date formatter. */
  region: 'uk' | 'india' | 'admin' | 'both';
  sort: GroupSort;
  onSort: (next: GroupSort) => void;
  /** Render the Sold count + Last Sold date columns. Defaults true.
   *  Set false from Stock Intake — operator's rule: sold info doesn't
   *  belong on the buy-side intake screen. */
  showSold?: boolean;
  /** Optional admin-only SHS delete handler. When provided, SHS rows show
   *  a trash icon so an admin can delete supplier-held stock that the
   *  supplier has confirmed they no longer have. */
  onDeleteShsGroup?: (key: string) => Promise<DeleteShsResult>;
}) {
  return (
    <table className="w-full text-[11px] border-separate border-spacing-0" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
      <thead>
        <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
          <GroupTh sort={sort} onSort={onSort} width={28}></GroupTh>
          <GroupTh sort={sort} onSort={onSort} sortKey="model"   label="Model"       width={220} />
          {/* Colours / Qty / BP / Total grouped on the left so the operator's
              eye lands on the trading numbers together — Stock In + Notes
              pushed to the right since they're context not action. */}
          <GroupTh sort={sort} onSort={onSort} sortKey="colours" label="Colours"     width={120} />
          <GroupTh sort={sort} onSort={onSort} sortKey="qty"     label="Qty"         width={60}  align="right" />
          <GroupTh sort={sort} onSort={onSort} sortKey="bp"      label="Latest BP"   width={90} align="right" />
          <GroupTh sort={sort} onSort={onSort} sortKey="value"   label="Total Value" width={100} align="right" />
          {/* SIM Type column — shows the dominant SIM type for this model
              group so the operator can tell at a glance whether stock is
              Physical SIM, eSIM-capable, or dual-SIM without expanding. */}
          <GroupTh sort={sort} onSort={onSort}                 label="SIM"         width={90} />
          <GroupTh sort={sort} onSort={onSort} sortKey="stockIn"  label="Stock In"  width={100} />
          <GroupTh sort={sort} onSort={onSort} sortKey="age"      label="Age"       width={70}  align="right" />
          {/* Sold count + latest sale date — operator request so a sold
              SKU's fulfilment activity shows up next to its stock numbers
              without expanding the row. Stock Intake hides them via the
              showSold prop. */}
          {showSold && (
            <>
              <GroupTh sort={sort} onSort={onSort} sortKey="sold"     label="Sold"      width={70}  align="right" />
              <GroupTh sort={sort} onSort={onSort} sortKey="lastSold" label="Last Sold" width={100} />
            </>
          )}
          <GroupTh sort={sort} onSort={onSort} sortKey="notes"    label="Notes"     width={180} />
        </tr>
      </thead>
      <tbody>
        {groups.map((g, idx) => {
          const open = expanded.has(g.key);
          // Colour entries sorted by qty desc, name asc — same ordering used
          // in the expanded sub-row so the eye finds the dominant colour first.
          const colours = Array.from(g.byColour.entries()).sort((a, b) => b[1].qty - a[1].qty || a[0].localeCompare(b[0]));
          // Dominant SIM type = the one with the highest count in the group.
          // Aggregates (which have an empty bySimType) show "—".
          const dominantSimType = g.bySimType.size > 0
            ? Array.from(g.bySimType.entries()).sort((a, b) => b[1] - a[1])[0][0]
            : '';
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
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 truncate" title={g.model}>{g.model}</span>
                    {g.shs && onDeleteShsGroup && (
                      <ShsDeleteButton
                        onDelete={() => onDeleteShsGroup(g.key)}
                        title={`Delete SHS stock for ${g.model.replace(' · SHS', '').trim()} — supplier has no stock`}
                      />
                    )}
                  </span>
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
                {/* SIM Type badge — dominant type or "—" for aggregates. */}
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle">
                  {dominantSimType ? (
                    <span
                      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                        dominantSimType === 'Unspecified'
                          ? 'bg-slate-100 border-slate-200 text-slate-500'
                          : 'bg-indigo-50 border-indigo-200 text-indigo-700'
                      }`}
                      title={Array.from(g.bySimType.entries()).map(([st, n]) => `${st}: ${n}`).join(' · ')}
                    >
                      {dominantSimType === 'Unspecified' ? '—' : dominantSimType}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-slate-600">
                  {g.latestDateIn
                    ? <span title={g.latestDateIn}>{fmtDateForUser(g.latestDateIn, region) || g.latestDateIn}</span>
                    : <span className="text-slate-300">—</span>
                  }
                </td>
                <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-right tabular-nums">
                  {/* Age = days since the oldest unit in the group landed.
                      Drives reorder decisions: a SKU with stock from 30
                      days ago is at risk of dust collection even if a
                      fresher batch came in last week. Cell tooltip carries
                      the exact ISO date so the operator can audit. */}
                  {(() => {
                    const days = ageInDays(g.oldestDateIn);
                    if (days === null) return <span className="text-slate-300">—</span>;
                    const tone =
                      days >= 30 ? 'text-rose-600 font-semibold'
                      : days >= 14 ? 'text-amber-700'
                      : 'text-slate-600';
                    return (
                      <span
                        className={`text-[11px] font-mono ${tone}`}
                        title={`Oldest stock-in: ${g.oldestDateIn}${
                          g.latestDateIn && g.latestDateIn !== g.oldestDateIn
                            ? `\nNewest stock-in: ${g.latestDateIn}` : ''
                        }`}
                      >
                        {days === 0 ? 'today' : `${days}d`}
                      </span>
                    );
                  })()}
                </td>
                {/* Sold count + last sold date — only render numbers when
                    the group actually has sold units; otherwise show em-dashes
                    so empty rows don't look like noisy zeros. Mirrored by the
                    showSold prop on the header so Stock Intake renders neither
                    column nor cell. */}
                {showSold && (
                  <>
                    <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-right tabular-nums">
                      {g.soldCount > 0
                        ? <span className="text-[11px] font-mono font-bold text-slate-700">{g.soldCount}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                    <td className="px-3 py-1.5 border-b border-slate-100 align-middle text-slate-600">
                      {g.latestSoldDate
                        ? <span title={g.latestSoldDate}>{fmtDateForUser(g.latestSoldDate, region) || g.latestSoldDate}</span>
                        : <span className="text-slate-300">—</span>
                      }
                    </td>
                  </>
                )}
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
                  {/* colSpan stays in sync with the visible column count
                      above: 10 base columns + 2 (Sold / Last Sold) when
                      showSold is on. */}
                  <td colSpan={showSold ? 12 : 10} className="px-0 py-0 border-b border-slate-100">
                    <ul className="pl-10 pr-4 py-2 divide-y divide-slate-200/70">
                      {colours.map(([colour, c]) => {
                        // Suppliers ordered by qty desc — most-stocked first
                        // so the operator sees "main supplier · count" at the
                        // top, then any smaller alternate-price sources.
                        const suppliers = Array.from(c.bySupplier.entries())
                          .sort((a, b) => b[1].qty - a[1].qty || a[0].localeCompare(b[0]));
                        const priceLabel = c.minBp === c.maxBp
                          ? (c.latestBp > 0 ? `£${c.latestBp}` : '—')
                          : `£${c.minBp}–£${c.maxBp}`;
                        return (
                          <li key={colour} className="py-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                <ColourDot colour={colour} />
                                <span className="text-[11px] text-slate-700 truncate">{colour}</span>
                              </span>
                              <span className="inline-flex items-center text-[10px] font-mono font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded">
                                × {c.qty}
                              </span>
                              <span className="text-[10px] font-mono text-slate-600 w-20 text-right" title={c.minBp === c.maxBp ? '' : `Latest BP £${c.latestBp}`}>
                                {priceLabel}
                              </span>
                              <span className="text-[10px] font-mono font-bold text-emerald-700 w-20 text-right">
                                £{c.totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                            {/* Per-supplier breakdown — only renders when more
                                than one supplier sold this colour (the "same
                                colour, different prices, different sources"
                                case the operator flagged). */}
                            {suppliers.length > 1 && (
                              <ul className="pl-7 mt-1 space-y-0.5">
                                {suppliers.map(([supName, s]) => (
                                  <li key={supName} className="flex items-center justify-between gap-3 text-[10px] font-mono text-slate-500">
                                    <span className="flex-1 truncate">↳ {supName}</span>
                                    <span className="w-12 text-right">× {s.qty}</span>
                                    <span className="w-20 text-right">£{s.latestBp}</span>
                                    <span className="w-20 text-right text-emerald-700">£{s.totalValue.toLocaleString('en-GB', { maximumFractionDigits: 0 })}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
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

// ── Detailed-view (10-column read-only schema) ──────────────────────────────

/** The detailed overlay schema mirrors the master Inventory Report
 *  export (9 columns) plus a Status column so the operator can tell at
 *  a glance whether a unit is available / sold / returned / incoming.
 *  Order matches the master so the on-screen grid round-trips
 *  byte-for-byte with the CSV. */
const OVERLAY_COLUMNS: { key: string; label: string; width: number; align?: 'left' | 'right' }[] = [
  { key: 'dateIn',       label: 'Stock In Date', width: 110 },
  { key: 'model',        label: 'Model',         width: 220 },
  { key: 'imei',         label: 'IMEI',          width: 170 },
  { key: 'grade',        label: 'Grade',         width: 70  },
  { key: 'storage',      label: 'Storage',       width: 80  },
  { key: 'colour',       label: 'Colour',        width: 110 },
  { key: 'simType',      label: 'SIM',           width: 90  },
  { key: 'supplierName', label: 'Supplier',      width: 140 },
  { key: 'buyPrice',     label: 'BP',            width: 80,  align: 'right' },
  { key: 'status',       label: 'Status',        width: 100 },
  // Operator request (2026-06-20): show sale date alongside status in
  // the inventory views so a sold unit's fulfilment timestamp is
  // visible without opening the unit drawer. Blank for non-sold rows.
  { key: 'saleDate',     label: 'Sold Date',     width: 100 },
  { key: 'notes',        label: 'Notes',         width: 240 },
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
  if (key === 'simType') {
    return v ? String(v) : '';
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
    case 'simType':      return ''; // Aggregates don't carry per-unit simType
    case 'supplierName': return a.supplierIds?.[0] ? (supplierMap[a.supplierIds[0]] || a.supplierIds[0]) : '';
    case 'buyPrice':     return a.buyPrice != null ? `£${Number(a.buyPrice).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : '';
    case 'status':       return shs ? 'INCOMING (SHS)' : 'ROLLUP';
    case 'dateIn':       return a.updatedAt ? (fmtDateForUser(String(a.updatedAt).slice(0, 10), region) || '') : '';
    case 'notes':        return a.notes || '';
    case 'imei':         return `${shs ? 'SHS' : 'OFFICE'} · ${a.quantityNum ?? '?'}`;
    default:             return '';
  }
}

// ── Editable column keys (Detailed view) ───────────────────────────────────
// OVERLAY_COLUMNS keys are typed as plain strings, so call sites cast
// `c.key as any` when checking membership. dateIn / imei / status stay
// read-only — they're rendered by dedicated branches above the default.
const EDITABLE_TEXT_KEYS    = ['model', 'grade', 'storage', 'colour', 'simType', 'supplierName', 'notes'] as const;
const EDITABLE_NUMERIC_KEYS = ['buyPrice'] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function StockOverlayModal({
  title, rows, supplierMap, aggregates, region, onClose,
}: {
  title: string;
  rows: InventoryUnit[];
  supplierMap: Record<string, string>;
  /** Master-file rollup rows scoped to the open KPI. Each carries a quantity
   *  but no per-IMEI detail; rendered as pseudo-rows so the overlay total
   *  always agrees with the KPI tile that opened it. Pass `[]` when the
   *  caller has no aggregates (e.g. PeriodicInventory). */
  aggregates: InventoryAggregate[];
  region: 'uk' | 'india' | 'admin' | 'both';
  onClose: () => void;
}) {
  // Detail-view column sort is now self-managed — parents no longer thread it.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'dateIn', dir: 'desc' });
  const toggleSort = (k: SortKey) =>
    setSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));

  const isShsAgg = (a: InventoryAggregate) => (a.quantityText || '').toUpperCase() === 'SHS';
  const userIsAdmin = useIsAdmin();
  // Actions appear whenever the overlay contains SHS stock (incoming units or
  // SHS aggregates) and the current user is an admin. This covers both the
  // SHS KPI tile and any other view that happens to list incoming stock.
  const showActions = userIsAdmin && (
    aggregates.some(isShsAgg) || rows.some(u => u.status === 'incoming')
  );

  // Map grouped SHS keys back to the aggregate doc so the grouped view can
  // delegate deletes to the shared service without threading the whole list.
  const shsAggByKey = useMemo(() => {
    const map = new Map<string, InventoryAggregate>();
    for (const a of aggregates) if (isShsAgg(a)) map.set(`shs::${a.id}`, a);
    return map;
  }, [aggregates]);
  const handleDeleteShsGroup = useCallback(async (key: string): Promise<DeleteShsResult> => {
    const agg = shsAggByKey.get(key);
    if (!agg) return { ok: false, message: 'SHS aggregate not found' };
    return deleteShsAggregate(agg);
  }, [shsAggByKey]);

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

  // Detail-view rows respect the column sort. We sort here so the detail
  // table mirrors whatever the operator clicked in its header row.
  const sortedDetailRows = useMemo(
    () => sortUnits(searchedRows, sort, supplierMap),
    [searchedRows, sort, supplierMap],
  );

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
  // 100-per-page on both views — operator perf rule: any surface that
  // can exceed 100 rows pages instead of rendering the whole set.
  const groupedPager = usePagedRows<GroupedModel>(grouped);
  const detailPager = usePagedRows<InventoryUnit>(sortedDetailRows);

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
              groups={groupedPager.paged}
              expanded={expandedModels}
              onToggle={toggleExpand}
              region={region}
              sort={groupedSort}
              onSort={setGroupedSort}
              onDeleteShsGroup={showActions ? handleDeleteShsGroup : undefined}
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
                                <span className="inline-flex items-center gap-2">
                                  <span className={`inline-flex items-center gap-1 text-[9px] font-bold ${badgeCls} px-1.5 py-0.5 rounded uppercase tracking-widest`}>
                                    <Truck size={9} /> {shs ? 'SHS' : 'OFFICE'} · {a.quantityNum ?? '?'}
                                  </span>
                                  {shs && showActions && (
                                    <ShsDeleteButton
                                      onDelete={() => deleteShsAggregate(a)}
                                      title={`Delete SHS stock for ${a.model || 'this model'} — supplier has no stock`}
                                    />
                                  )}
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
                {detailPager.paged.map((u, idx) => {
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
                                <span className="inline-flex items-center gap-2 w-full">
                                  {userIsAdmin ? (
                                    <EditableCell
                                      value={u.imei ?? ''}
                                      display={
                                        imeiValid ? <CopyImei imei={u.imei} truncate={20} /> :
                                        u.status === 'incoming' ? <span className="text-[10px] font-mono text-slate-400 italic">Optional for SHS</span> :
                                        <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono">
                                          <AlertCircle size={10} /> {u.imei ? 'invalid' : 'missing'}
                                        </span>
                                      }
                                      type="text"
                                      className="block truncate font-mono text-slate-700"
                                      style={{ maxWidth: c.width, display: 'inline-block' }}
                                      onSave={async (next) => {
                                        const res = await adminUpdateUnit(u, { imei: next });
                                        if (!res.ok) alert(res.message || 'Failed to update IMEI');
                                      }}
                                    />
                                  ) : (
                                    imeiValid ? <CopyImei imei={u.imei} truncate={20} /> :
                                    u.status === 'incoming' ? <span className="text-[10px] font-mono text-slate-400 italic">Optional for SHS</span> :
                                    <span className="inline-flex items-center gap-1 text-rose-600 text-[10px] font-mono">
                                      <AlertCircle size={10} /> {u.imei ? 'invalid' : 'missing'}
                                    </span>
                                  )}
                                  {u.status === 'incoming' && showActions && (
                                    <span className="ml-auto">
                                      <ShsDeleteButton
                                        onDelete={() => deleteShsUnit(u)}
                                        title={`Delete SHS unit for ${u.model || 'this unit'} — supplier has no stock`}
                                      />
                                    </span>
                                  )}
                                  {u.status !== 'incoming' && u.status !== 'sold' && userIsAdmin && (
                                    <span className="ml-auto">
                                      <OfficeDeleteButton unit={u} />
                                    </span>
                                  )}
                                </span>
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
                        if (EDITABLE_TEXT_KEYS.includes(c.key as any) || EDITABLE_NUMERIC_KEYS.includes(c.key as any)) {
                          const val = fmtOverlayCell(u, c.key, region, supplierMap);
                          const raw = (u as any)[c.key];
                          const isNum = EDITABLE_NUMERIC_KEYS.includes(c.key as any);
                          return (
                            <React.Fragment key={c.key}>
                              <Td
                                align={c.align}
                                sticky={sticky}
                                leftPx={sticky ? 0 : undefined}
                                className={stickyCls}
                              >
                                <EditableCell
                                  value={raw ?? ''}
                                  display={val || '—'}
                                  type={isNum ? 'number' : 'text'}
                                  className="block truncate font-mono text-slate-700"
                                  style={{ maxWidth: c.width, display: 'inline-block' }}
                                  onSave={async (next) => {
                                    const patch: any = {};
                                    patch[c.key] = isNum ? (next === '' ? null : Number(next)) : next;
                                    await dbService.update('inventoryUnits', u.id, patch);
                                  }}
                                />
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

        {viewMode === 'grouped' ? (
          <PaginationBar
            page={groupedPager.page} totalPages={groupedPager.totalPages}
            total={groupedPager.total} onPage={groupedPager.setPage} itemLabel="models"
          />
        ) : (
          <PaginationBar
            page={detailPager.page} totalPages={detailPager.totalPages}
            total={detailPager.total} onPage={detailPager.setPage} itemLabel="units"
          />
        )}

        <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 flex-shrink-0 text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
          <span>Double-click a cell to edit · Click headers to sort · ESC to close</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
          >Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Shared helpers (also imported by BuySheet for the inline view) ──────────

/** Small colour swatch for the grouped overlay. Maps the raw colour
 *  string (BLACK / WHITE / PINK / "Space Grey") to a CSS background.
 *  Falls back to a neutral grey for anything we don't recognise so the
 *  layout stays stable even when suppliers spell new colours. */
export function ColourDot({ colour }: { colour: string }) {
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
export function Th({
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

export function Td({
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

/** Sort an InventoryUnit[] by the active column. Exported so BuySheet can
 *  share the comparator with its handleExportCsv / inline-table flows. */
export function sortUnits(
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
