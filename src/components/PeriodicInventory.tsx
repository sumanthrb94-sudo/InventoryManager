import React, { useMemo, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { InventoryUnit } from '../types';
import { parseBrandModelStorage, normalizeBucketModel, type Series } from '../lib/modelStorage';
import { canonicaliseModel } from '../lib/modelReconciliation';
import { withinLastHours } from '../lib/firestoreTime';
import { useInventoryStore } from '../lib/inventoryStore';
import { useUserRegion } from '../lib/userLocale';
import StockOverlayModal from './StockOverlayModal';

interface Props {
  units: InventoryUnit[];
  /** Optional — kept for back-compat with callers that wired a page-level
   *  filter. The periodic table no longer drives this on click; the
   *  Excel-style overlay is the new click target. */
  onNavigate?: (search: string) => void;
}

/** Per-series visual theme + display label for the periodic table. */
interface SeriesGroupDef {
  id: Series;
  label: string;
  color: { bg: string; light: string; text: string; border: string };
}

// Order here drives the on-screen row order. Each `id` matches a `Series` value
// returned by parseBrandModelStorage so the grouping is brand-aware.
//
// Per spec: iPhone → iPad → Apple Watch → MacBook → Galaxy S → Galaxy A →
// Galaxy Note → Galaxy Z → Galaxy M → Galaxy XCover → Galaxy Tab → Pixel → Other.
// New Samsung sections use distinct colour families so the legend reads at a
// glance: Note=cyan, Z=purple, M=yellow, XCover=slate (rugged feel).
/** The rows the periodic table renders. Exported so the office-stock
 *  reconciliation test can run against the REAL list — in particular the
 *  'Other' catch-all at the end, which is the only thing stopping a unit
 *  whose model matches no brand pattern from being silently left off the
 *  table the operator counts their shelf against. */
export const SERIES_GROUPS: ReadonlyArray<SeriesGroupDef> = [
  { id: 'iPhone',        label: 'Apple iPhones',     color: { bg: '#1d4ed8', light: '#dbeafe', text: '#1e3a8a', border: '#93c5fd' } },
  { id: 'iPad',          label: 'Apple iPads',       color: { bg: '#7c3aed', light: '#ede9fe', text: '#4c1d95', border: '#c4b5fd' } },
  { id: 'Apple Watch',   label: 'Apple Watch',       color: { bg: '#be185d', light: '#fce7f3', text: '#831843', border: '#f9a8d4' } },
  { id: 'MacBook',       label: 'MacBook',           color: { bg: '#0f766e', light: '#ccfbf1', text: '#134e4a', border: '#5eead4' } },
  { id: 'Galaxy S',      label: 'Samsung Galaxy S',  color: { bg: '#1e3a8a', light: '#dbeafe', text: '#1e3a8a', border: '#93c5fd' } },
  { id: 'Galaxy A',      label: 'Samsung Galaxy A',  color: { bg: '#2563eb', light: '#eff6ff', text: '#1e40af', border: '#bfdbfe' } },
  { id: 'Galaxy Note',   label: 'Samsung Note',      color: { bg: '#0e7490', light: '#cffafe', text: '#164e63', border: '#67e8f9' } },
  { id: 'Galaxy Z',      label: 'Samsung Z (Fold/Flip)', color: { bg: '#6d28d9', light: '#ede9fe', text: '#4c1d95', border: '#c4b5fd' } },
  { id: 'Galaxy M',      label: 'Samsung Galaxy M',  color: { bg: '#b45309', light: '#fef3c7', text: '#78350f', border: '#fcd34d' } },
  { id: 'Galaxy XCover', label: 'Samsung XCover',    color: { bg: '#475569', light: '#e2e8f0', text: '#1e293b', border: '#94a3b8' } },
  { id: 'Galaxy Tab',    label: 'Samsung Tabs',      color: { bg: '#0891b2', light: '#cffafe', text: '#164e63', border: '#67e8f9' } },
  { id: 'Pixel',         label: 'Google Pixel',      color: { bg: '#ea580c', light: '#ffedd5', text: '#7c2d12', border: '#fdba74' } },
  // NOTE: this is NOT the no-IMEI accessory pool (chargers, cables, SIM
  // pins — see AccessoryStock in types.ts). It's the catch-all for
  // InventoryUnit rows (phones/tablets/watches) whose model string didn't
  // match any known brand pattern — a data-quality bucket, not a product
  // category. Real accessory stock renders in its own panel below the
  // periodic table (see AccessoryStockPanel). Labelled "Unclassified" so
  // the two don't read as the same thing.
  { id: 'Other',         label: 'Unclassified',      color: { bg: '#475569', light: '#f1f5f9', text: '#334155', border: '#cbd5e1' } },
];

/**
 * unitSeries — derive the periodic-table bucket for a single inventory unit.
 *
 * Why runtime, not stored: the 354 units currently in Firestore were imported
 * with the OLD parseBrandModelStorage regex, which dumped every bare-coded
 * Samsung model ("S21", "A32 5G", "X COVER 5") into `series='Other'`. Until
 * the operator re-imports the workbook, the stored field is stale and would
 * still mis-bucket those units. Re-parsing the cleaned `model` string at
 * render time picks up the new buckets without a backfill migration.
 *
 * Fallback chain: live detector → stored doc field → 'Other'. The stored
 * field is preferred only when the live detector returns 'Other' so a unit
 * that the live parser CAN classify always wins (the live parser is now
 * strictly more permissive than the import-time one was).
 */
function unitSeries(u: InventoryUnit): Series {
  const live = parseBrandModelStorage(u.model || '').series;
  if (live && live !== 'Other') return live;
  const stored = (u as unknown as { series?: Series }).series;
  return stored || 'Other';
}

interface Element {
  /** Display label for the popover / sidebar — full clean model + optional storage. */
  seriesKey: string;
  /** Model name without storage, used as the sidebar filter substring. */
  model: string;
  /** Storage capacity for this block, or undefined when the model has none. */
  storage?: string;
  /** Big abbreviated label rendered inside the block tile. */
  symbol: string;
  count: number;
  shsCount: number;
  value: number;
  searchTerm: string;
  ordinal: number;
  variants: { colour: string; count: number }[];
  storageVariants: { storage: string; count: number }[];
  /** Connectivity / sim / radio breakdown across this tile's units
   *  ('5G', 'Dual SIM', 'Wi-Fi+Cellular', etc.). Surfaced in the popover
   *  because the tile no longer splits per-tag. */
  tagVariants: { tag: string; count: number }[];
  /** Dominant cellular radio across the bucket's units, or undefined for
   *  WiFi-only / no-tag buckets. Rendered inline with the storage caption
   *  on the tile so the operator can see at a glance whether the SKU has
   *  cellular without opening the popover. Picks "5G" first, then any
   *  4G/LTE/Cellular variant. */
  connectivity?: string;
  priceRange: { min: number; max: number };
  /** The exact bucket key (model|storage) this tile was built from.
   *  Stored here so the overlay can filter by the identical key instead of
   *  re-parsing u.model independently. */
  bucketKey: string;
}

// sort 64GB < 128GB < 256GB < 512GB < 1TB
function storageGb(s: string): number {
  const m = s.match(/(\d+)\s*(TB|GB)/i);
  if (!m) return 9999;
  return parseInt(m[1]) * (m[2].toUpperCase() === 'TB' ? 1024 : 1);
}

/** Minimal tile shape the display comparator needs. */
export interface TileSortShape {
  symbol: string;
  model: string;
  storage?: string;
}

/** The series number an operator reads off a tile. Prefers the digit run in
 *  the DISPLAYED symbol (e.g. "S24U" → 24); falls back to the first digit run
 *  in the underlying model string when the symbol was truncated past its
 *  number (e.g. raw SKU "ASI-SG-S20-128-CN-EX" → symbol "ASI-SG-S", no digit
 *  → model gives 20). Returns -1 when nothing numeric exists, sinking the
 *  tile to the end of its row. */
export function tileSeriesNumber(e: TileSortShape): number {
  const fromSymbol = e.symbol.match(/\d+/);
  if (fromSymbol) return parseInt(fromSymbol[0], 10);
  const fromModel = e.model.match(/\d+/);
  return fromModel ? parseInt(fromModel[0], 10) : -1;
}

/** Display order for periodic-table tiles within a row:
 *    1. series number DESCENDING (S24 before S22 before S20),
 *    2. storage ASCENDING tiebreak (64GB before 128GB; unknown sinks last),
 *    3. symbol alphabetic so equal entries don't reshuffle across renders.
 *  Exported + pure so it's unit-tested in isolation (the visible-order bug
 *  was invisible to the component because it only manifests on real data). */
export function compareTilesDescending(a: TileSortShape, b: TileSortShape): number {
  const na = tileSeriesNumber(a);
  const nb = tileSeriesNumber(b);
  if (nb !== na) return nb - na;
  const sa = storageGb(a.storage || '');
  const sb = storageGb(b.storage || '');
  if (sa !== sb) return sa - sb;
  return a.symbol.localeCompare(b.symbol);
}

/**
 * Build a compact display code for a model name. Strips redundant series
 * prefixes ("iPhone", "Galaxy", "iPad") and applies the standard
 * abbreviations: Pro Max → PM, Ultra → U, Plus → +, Mini → mini.
 *
 *   "iPhone 17 Pro Max" → "17 PM"
 *   "Galaxy S22 Ultra"  → "S22U"
 *   "iPad 7th Gen"      → "iPad 7"
 *   "Tab A9+"           → "A9+"
 */
/**
 * shortCode — compress a full model name into a label that fits inside a
 * 60×60 periodic-table block (max ~7-8 chars rendered). The full model is
 * always shown in the block's `title` attribute on hover.
 *
 * Strategy:
 *   1. Strip parenthetical noise (DUAL PHYSI SIM), (TWO PHY), etc.
 *   2. Strip SIM/network modifier phrases (2 SIM SLOTS, SS No E-Sim,
 *      TWO PHYSICAL SIM, W/C, eSIM, WiFi-only chatter).
 *   3. Drop the brand/series prefix (Galaxy, iPhone, Tab) — section title
 *      already says it.
 *   4. Apply standard abbreviations: Pro Max → PM, Ultra → U, Plus → +,
 *      Mini → mini, FE stays FE.
 *   5. Hard cap at 8 characters; truncate with no ellipsis (ellipsis
 *      itself eats one of the precious 8 characters).
 */
export function shortCode(model: string): string {
  if (!model) return '?';
  let s = model.trim();

  // 1. Drop parenthetical clutter — "(DUAL PHYSI SIM)", "(TWO PHYSICAL)".
  s = s.replace(/\([^)]*\)/g, ' ');

  // 2. Strip noisy SIM / connectivity modifier phrases that overflow boxes.
  //    Order matters: longer multi-word patterns first.
  const noise: RegExp[] = [
    /\bTWO\s+PHYSICAL(?:\s+SIM)?\b/gi,
    /\bDUAL\s+PHYSI(?:CAL)?(?:\s+SIM)?\b/gi,
    /\bSS\s*No\s*E-?Sim\b/gi,
    /\b\d+\s*SIM\s*(?:SLOTS?)?\b/gi,
    /\bWiFi\s*\+\s*(?:4G|5G|Cellular)\b/gi,
    /\bWiFi(?:\s*only)?\b/gi,
    /\bCellular\b/gi,
    /\bUNLOCKED\b/gi,
    /\bW\/C\b/gi,           // "with Cellular" shorthand
    /\beSIM\b/gi,
    /\bREPLACEMENT\b/gi,
  ];
  for (const r of noise) s = s.replace(r, ' ');

  // 3. Drop redundant brand/series prefixes — they're already in the section title.
  s = s.replace(/^iPhone\s+/i, '');
  s = s.replace(/^Galaxy\s+/i, '');
  s = s.replace(/^Samsung\s+/i, '');
  // For iPad we keep the "iPad" prefix ("iPad 7th Gen" → "iPad 7").
  s = s.replace(/(\d+)(st|nd|rd|th)\s*Gen\b/i, '$1');
  s = s.replace(/\((\d+)(st|nd|rd|th)\s*Gen\)/i, '$1');
  s = s.replace(/^Tab\s+/i, ''); // "Tab A9+" → "A9+"
  // XCover variants — compress "X COVER" → "Cover" (one word, no internal
  // space) so the variant suffix surfaces cleanly: "X COVER 5" → "Cover 5",
  // "X COVER PRO 4G" → "Cover Pro 4G". The word "Cover" anchors the label
  // as a model line so a bare digit suffix can't be misread as the unit
  // count. Pairs with the 12-char cap below so "Cover Pro 4G" survives
  // without truncation.
  s = s.replace(/^X\s*COVER\b/i, 'Cover');

  // 4. Standard abbreviations. Order: longer match first.
  s = s.replace(/\bPro Max\b/gi, 'PM');
  s = s.replace(/\bUltra\b/gi, 'U');
  s = s.replace(/\bPlus\b/gi, '+');
  s = s.replace(/\bMini\b/gi, 'mini');

  // Glue single-letter abbreviations onto the preceding alphanumeric token so
  // "S22 U" reads as "S22U" and "17 PM" still reads as "17 PM" (multi-char).
  s = s.replace(/(\w)\s+(U|\+)\b/g, '$1$2');

  // Collapse whitespace + dashes left behind by the strip passes.
  s = s.replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();

  // 5. Hard cap at 12 chars. Raised from 8 to make room for descriptive
  //    variant names like "Cover Pro 4G" (12 chars) that the operator
  //    needs to distinguish XCover variants from one another. The
  //    block-render side scales font-size down with length so longer
  //    labels still fit the 60px tile width.
  if (s.length > 12) s = s.slice(0, 12).trim();

  return s || '?';
}

interface PopoverState {
  el: Element;
  color: { bg: string; light: string; text: string; border: string };
  rect: DOMRect;
  /** Caption under the big count in the popover header — varies by view
   *  ("in office", "on order" for SHS, "sold" for out-of-stock). */
  countLabel: string;
}

// ── Shared SKU bucketing ──────────────────────────────────────────────────────
// All three view modes (office stock / by-supplier / out-of-stock) render the
// same SKU grid; only the GROUPING dimension (brand series vs supplier), the
// unit sets and the value function differ. One generic builder, one call per
// mode — no duplicated bucketing loop.

/** Minimal row-group shape: id + label + colour theme. SERIES_GROUPS satisfies
 *  this structurally (its id is the Series union, a string subtype); supplier
 *  groups are built at runtime from the supplier list. */
interface PtGroupDef {
  id: string;
  label: string;
  color: { bg: string; light: string; text: string; border: string };
}

interface PtGroupVM extends PtGroupDef {
  elements: Element[];
  totalCount: number;
  totalValue: number;
}

/** Periodic-table view modes WITHIN a scope. Each scope (office/shs) gets
 *  its own independent view-mode state so the two side-by-side panels can
 *  show different slices at the same time. */
type ViewMode = 'stock' | 'supplier' | 'outofstock';

const OFFICE_VIEW_TABS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'stock',      label: 'Office Stock' },
  { id: 'supplier',   label: 'By Supplier' },
  { id: 'outofstock', label: 'Out of Stock' },
];

const SHS_VIEW_TABS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'stock',      label: 'SHS Stock' },
  { id: 'supplier',   label: 'By Supplier' },
  { id: 'outofstock', label: 'Out of Stock' },
];

/** Colour palette cycled across supplier rows (the supplier dimension has no
 *  fixed colour like the brand series do). Each entry mirrors the bg/light/
 *  text/border shape the tiles expect. */
const SUPPLIER_PALETTE: ReadonlyArray<PtGroupDef['color']> = [
  { bg: '#1d4ed8', light: '#dbeafe', text: '#1e3a8a', border: '#93c5fd' },
  { bg: '#7c3aed', light: '#ede9fe', text: '#4c1d95', border: '#c4b5fd' },
  { bg: '#0f766e', light: '#ccfbf1', text: '#134e4a', border: '#5eead4' },
  { bg: '#be185d', light: '#fce7f3', text: '#831843', border: '#f9a8d4' },
  { bg: '#b45309', light: '#fef3c7', text: '#78350f', border: '#fcd34d' },
  { bg: '#0891b2', light: '#cffafe', text: '#164e63', border: '#67e8f9' },
  { bg: '#ea580c', light: '#ffedd5', text: '#7c2d12', border: '#fdba74' },
  { bg: '#4338ca', light: '#e0e7ff', text: '#312e81', border: '#a5b4fc' },
  { bg: '#15803d', light: '#dcfce7', text: '#14532d', border: '#86efac' },
  { bg: '#475569', light: '#f1f5f9', text: '#334155', border: '#cbd5e1' },
];

// normalizeBucketModel lives in src/lib/modelStorage.ts since 2026-06-21
// (shared by DeviceComboBox catalog + admin reconciliation + periodic
// table bucket keys). It's imported at the top of this file (line 5).
// No re-export here — earlier `export { normalizeBucketModel };` form
// caused a confusing ReferenceError loop on certain bundler output;
// test imports moved to the canonical modelStorage path instead.
/** Exported so the out-of-stock exclusion can be tested against the same key
 *  the tiles are bucketed by — a test that built its own key would prove the
 *  test's key, not the table's. */
export const bucketKeyOf = (model: string, storage?: string, tag?: string) =>
  `${normalizeBucketModel(model)}|${storage ?? ''}|${tag ?? ''}`;

/**
 * buildGroups — bucket units into the periodic-table grid for an arbitrary
 * grouping dimension.
 *
 *   primary    — units that drive the tile count + value + row totals.
 *   secondary  — units that drive the "+NS" supplier-held badge (office /
 *                by-supplier pass incoming stock; out-of-stock passes []).
 *   groupDefs  — the rows to render (brand series, or runtime supplier list).
 *   assign     — maps a unit to a groupDefs id. Units whose id isn't in
 *                groupDefs are dropped (so a stray supplier doesn't appear).
 *   opts.valueFn     — per-unit £ for tile/row value (default buyPrice;
 *                      out-of-stock passes salePrice to surface revenue).
 *                      NOT named `valueOf` — every plain object literal
 *                      inherits Object.prototype.valueOf, so a caller
 *                      passing options without this key (e.g. just
 *                      `{ catalogIndex }`) would make `opts?.valueOf`
 *                      resolve to the INHERITED method instead of
 *                      `undefined`, defeating both `?? default` and
 *                      `typeof x === 'function'` fallback checks alike.
 *   opts.excludeKeys — model|storage|tag keys to drop. Out-of-stock passes the
 *                      SKUs that still have available stock so only depleted
 *                      ones remain.
 */
export function buildGroups(
  primary: InventoryUnit[],
  secondary: InventoryUnit[],
  groupDefs: ReadonlyArray<PtGroupDef>,
  assign: (u: InventoryUnit) => string,
  opts?: { valueFn?: (u: InventoryUnit) => number; excludeKeys?: Set<string>; catalogIndex?: Map<string, string> },
): PtGroupVM[] {
  const valueOf = opts?.valueFn ?? ((u: InventoryUnit) => u.buyPrice || 0);
  const excludeKeys = opts?.excludeKeys;
  const catalogIndex = opts?.catalogIndex;
  try {
    type ParsedUnit = { unit: InventoryUnit; model: string; storage?: string; tag?: string; groupId: string };
    const parseUnit = (u: InventoryUnit): ParsedUnit => {
      const p = parseBrandModelStorage(u.model);
      const storage = u.storage || p.storage;
      // Admin catalog's canonical spelling wins when one matches, computed
      // BEFORE the bucket key below so seed-matched units of different raw
      // spellings collapse into one tile automatically — same as
      // deviceCatalog.ts already merges seeds with real stock for the
      // autocomplete picker.
      const rawModel = p.model || u.model;
      const model = catalogIndex ? canonicaliseModel(rawModel, u.brand || p.brand, catalogIndex) : rawModel;
      return { unit: u, model, storage, tag: p.tag, groupId: assign(u) };
    };

    const parsedPrimary   = primary.map(parseUnit);
    const parsedSecondary = secondary.map(parseUnit);

    return groupDefs.map(group => {
      const groupUnits     = parsedPrimary.filter(p => p.groupId === group.id);
      const groupSecondary = parsedSecondary.filter(p => p.groupId === group.id);

      type Bucket = {
        model: string; storage?: string; tag?: string;
        count: number; shsCount: number; value: number;
        variants: Record<string, number>; storages: Record<string, number>;
        /** Per-tag count breakdown ('5G', 'Dual SIM', etc.). Lets the
         *  popover surface the connectivity/sim mix without splitting the
         *  visible tile — see why below. */
        tags: Record<string, number>;
        prices: number[];
      };
      const buckets: Record<string, Bucket> = {};
      const ensure = (p: ParsedUnit): Bucket | null => {
        // Bucket by model+storage ONLY (no tag). Operators were seeing
        // visually-identical tiles (`S22 128GB` appearing 2-3 times) because
        // units carry different connectivity/sim tags ('5G', 'Dual SIM',
        // E-SIM, untagged) — the symbol strips those, so the tiles look
        // duplicated even though the bucket key differed. Now same-symbol
        // tiles aggregate; the popover breaks the count down by tag.
        const key = bucketKeyOf(p.model, p.storage);
        if (excludeKeys?.has(key)) return null;
        if (!buckets[key]) {
          buckets[key] = { model: p.model, storage: p.storage, count: 0, shsCount: 0, value: 0, variants: {}, storages: {}, tags: {}, prices: [] };
        }
        return buckets[key];
      };

      for (const p of groupUnits) {
        const b = ensure(p);
        if (!b) continue;
        b.count++;
        b.value += valueOf(p.unit);
        if (p.tag) b.tags[p.tag] = (b.tags[p.tag] || 0) + 1;
        b.prices.push(p.unit.buyPrice || 0);
        const col = p.unit.colour || 'Unknown';
        b.variants[col] = (b.variants[col] || 0) + 1;
        if (p.storage) b.storages[p.storage] = (b.storages[p.storage] || 0) + 1;
      }

      for (const p of groupSecondary) {
        const b = ensure(p);
        if (b) b.shsCount++;
      }

      const elements: Element[] = Object.values(buckets)
        .map((d, i) => {
          const symbol = shortCode(d.model);
          const seriesKey = [d.model, d.storage].filter(Boolean).join(' ');
          // Pick the dominant cellular tag for the tile caption. 5G wins
          // over any 4G/LTE/Cellular variant; pure WiFi tags don't count.
          // Looks at the raw tag keys (e.g. "5G, Dual SIM") so a phone
          // marked "5G, Dual SIM" still surfaces "5G" on the tile.
          const tagKeys = Object.keys(d.tags || {});
          const cellularTag =
            tagKeys.find(t => /\b5G\b/i.test(t)) ? '5G' :
            tagKeys.some(t => /\b(4G|LTE|Cellular)\b/i.test(t)) ? 'Cellular' :
            undefined;
          return {
            seriesKey, model: d.model, storage: d.storage, symbol,
            count: d.count, shsCount: d.shsCount, value: d.value,
            searchTerm: d.model, ordinal: i + 1,
            bucketKey: bucketKeyOf(d.model, d.storage),
            variants: Object.entries(d.variants || {})
              .sort(([, a], [, b]) => b - a).map(([colour, count]) => ({ colour, count })),
            storageVariants: Object.entries(d.storages || {})
              .sort(([a], [b]) => storageGb(a) - storageGb(b)).map(([storage, count]) => ({ storage, count })),
            // Per-tag mix (connectivity / sim / radio). Surfaced in the
            // popover so the operator can still see the breakdown even
            // though the tiles don't split on tag anymore.
            tagVariants: Object.entries(d.tags || {})
              .sort(([, a], [, b]) => b - a).map(([tag, count]) => ({ tag, count })),
            connectivity: cellularTag,
            priceRange: d.prices.length ? { min: Math.min(...d.prices), max: Math.max(...d.prices) } : { min: 0, max: 0 },
          };
        })
        .sort(compareTilesDescending)
        .map((el, i) => ({ ...el, ordinal: i + 1 }));

      return {
        ...group, elements,
        // Roll the legend/header count up from the DISPLAYED tiles, not from
        // the pre-exclusion group set. Out-of-stock drops SKUs that still have
        // available stock via excludeKeys — counting groupUnits there made the
        // legend ("Galaxy S (44)") exceed the sum of visible tiles, which read
        // as "units missing". For office / supplier / shs (no exclusion) this
        // is identical to the old count.
        totalCount: elements.reduce((s, el) => s + el.count, 0),
        totalValue: elements.reduce((s, el) => s + el.value, 0),
      };
    }).filter(g => g.elements.length > 0);
  } catch (e) {
    console.error('PeriodicInventory buildGroups error:', e);
    return [];
  }
}

// accent colour for variant count badge — derived from group light colour
function accentColor(light: string): string {
  if (light === '#dbeafe') return '#3b82f6';
  if (light === '#ede9fe') return '#8b5cf6';
  if (light === '#fef3c7') return '#f59e0b';
  if (light === '#d1fae5') return '#10b981';
  if (light === '#cffafe') return '#06b6d4';
  return '#94a3b8';
}

function Popover({
  state,
  onNavigate,
  onViewAll,
  onMouseEnter,
  onMouseLeave,
}: {
  state: PopoverState;
  onNavigate: (s: string) => void;
  onViewAll: (seriesKey: string, searchTerm: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { el, color, rect, countLabel } = state;

  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove  = spaceBelow < 310;

  const style: React.CSSProperties = {
    position:     'fixed',
    left:         Math.max(8, Math.min(rect.left, window.innerWidth - 264)),
    zIndex:       9999,
    width:        252,
    background:   '#0f172a',
    border:       `1.5px solid ${color.bg}50`,
    borderRadius: 28,
    boxShadow:    `0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px ${color.bg}20`,
    overflow:     'hidden',
    pointerEvents: 'auto',
  };

  if (showAbove) {
    style.bottom = window.innerHeight - rect.top + 8;
  } else {
    style.top = rect.bottom + 8;
  }

  const accent = accentColor(color.light);

  return (
    <div style={style} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {/* Header */}
      <div style={{ background: color.bg, padding: '10px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {el.seriesKey}
            </div>
            {el.count > 0 && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', marginTop: 3, fontFamily: 'monospace' }}>
                Buy £{el.priceRange.min === el.priceRange.max
                  ? el.priceRange.min
                  : `${el.priceRange.min}–${el.priceRange.max}`}
                &nbsp;·&nbsp;£{el.value.toLocaleString()} total
              </div>
            )}
          </div>
          {/* Stock count */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '4px 8px', minWidth: 36 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{el.count}</div>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{countLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Colour variants */}
      {el.variants.length > 0 && (
        <div style={{ padding: '8px 12px 6px' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Colour Variants — {el.variants.reduce((s, v) => s + v.count, 0)} units
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {el.variants.map(v => {
              const pct = Math.round((v.count / el.count) * 100);
              return (
                <div key={v.colour}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace' }}>{v.colour}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: '#f1f5f9' }}>{v.count}</span>
                      <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>{pct}%</span>
                    </div>
                  </div>
                  {/* mini progress bar */}
                  <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Storage variants */}
      {el.storageVariants.length > 0 && (
        <div style={{ padding: '7px 12px 5px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Storage — {el.count} units
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {el.storageVariants.map(v => {
              const pct = Math.round((v.count / el.count) * 100);
              return (
                <div key={v.storage} style={{
                  background: '#1e293b', borderRadius: 12, padding: '4px 8px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  minWidth: 48,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: '#f1f5f9', lineHeight: 1 }}>{v.count}</span>
                  <span style={{ fontSize: 8, fontFamily: 'monospace', color: accent, letterSpacing: '0.04em' }}>{v.storage}</span>
                  <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#475569' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Connectivity / sim / radio tag breakdown — shows the mix that
          used to split tiles (5G, Dual SIM, E-SIM, Wi-Fi+Cellular…) but
          now aggregates into the single tile. Skipped when there's no
          tag info at all. */}
      {el.tagVariants.length > 0 && (
        <div style={{ padding: '7px 12px 5px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Connectivity / SIM — {el.tagVariants.reduce((s, v) => s + v.count, 0)} units
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {el.tagVariants.map(v => {
              const pct = Math.round((v.count / el.count) * 100);
              return (
                <div key={v.tag} style={{
                  background: '#1e293b', borderRadius: 12, padding: '4px 8px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  minWidth: 56,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: '#f1f5f9', lineHeight: 1 }}>{v.count}</span>
                  <span style={{ fontSize: 8, fontFamily: 'monospace', color: accent, letterSpacing: '0.04em', textAlign: 'center' }}>{v.tag}</span>
                  <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#475569' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      {el.count > 0 && (
        <div style={{ padding: '6px 12px 10px' }}>
          <button
            onClick={() => onViewAll(el.seriesKey, el.searchTerm)}
            style={{
              width: '100%', padding: '7px', background: color.bg, border: 'none',
              borderRadius: 12, color: '#fff', fontSize: 10, fontWeight: 700,
              fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            View All {el.count} Units →
          </button>
        </div>
      )}
    </div>
  );
}

export default function PeriodicInventory({ units, onNavigate }: Props) {
  // Sellable inventory — defensive widening matches Buy/Sell screens so a
  // returned-to-inventory unit with a stuck status (write race / stale
  // cache) still shows up on the periodic table for re-sale.
  // Pull supplier list locally so we can render supplier names in the overlay
  // without forcing every PeriodicInventory caller to thread a supplierMap.
  const { suppliers, catalogIndex } = useInventoryStore();
  const region = useUserRegion();
  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);
  // ── Scope toggle (Office Stock vs SHS) ─────────────────────────────────────
  // Top-right selector. Each scope owns its OWN view mode and supplier filter
  // (separate useState below) so flipping between Office and SHS preserves
  // whatever filters the operator had set on each side independently.
  const [scope, setScope] = useState<'office' | 'shs'>('office');
  const isShs = scope === 'shs';
  const VIEW_TABS = isShs ? SHS_VIEW_TABS : OFFICE_VIEW_TABS;

  // ── View controls (per-scope) ───────────────────────────────────────────────
  // Each scope keeps its OWN view-mode + supplier filter so flipping the
  // scope toggle doesn't blow away the operator's filter state on the other
  // side. Reads the current scope's values.
  const [officeViewMode, setOfficeViewMode] = useState<ViewMode>('stock');
  const [shsViewMode, setShsViewMode] = useState<ViewMode>('stock');
  const [officeSupplier, setOfficeSupplier] = useState<string>('all');
  const [shsSupplier, setShsSupplier] = useState<string>('all');
  const viewMode = isShs ? shsViewMode : officeViewMode;
  const setViewMode = isShs ? setShsViewMode : setOfficeViewMode;
  const supplierFilterId = isShs ? shsSupplier : officeSupplier;
  const setSupplierFilterId = isShs ? setShsSupplier : setOfficeSupplier;

  const [popover, setPopover] = useState<PopoverState | null>(null);
  /** Excel-style overlay target — set when a block is clicked, null when closed.
   *  `supplierId` is set only from the By-Supplier view so the overlay scopes
   *  to that supplier's units of the SKU. */
  const [overlay, setOverlay] = useState<{
    seriesKey: string; model: string; storage?: string; supplierId?: string;
    /** Exact bucket key this tile was built with — used by overlayRows for precise matching. */
    bucketKey: string;
  } | null>(null);
  // Refs for the hover grace-period timers
  const closeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** True when a unit belongs to a supplier (primary id or any of supplierIds). */
  const unitHasSupplier = (u: InventoryUnit, sid: string) =>
    u.supplierId === sid || (u.supplierIds?.includes(sid) ?? false);

  // Supplier-scoped unit set — every view reads from this so the supplier
  // dropdown filters the whole table at once. Matches either the primary
  // supplierId or any entry in supplierIds (units imported from a multi-
  // supplier master row carry several).
  const scopedUnits = useMemo(() => {
    if (supplierFilterId === 'all') return units;
    return units.filter(u => unitHasSupplier(u, supplierFilterId));
  }, [units, supplierFilterId]);

  // Suppliers that actually have units attached — drives the filter dropdown
  // AND the By-Supplier view's row definitions.
  const supplierOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const u of units) {
      if (u.supplierId) ids.add(u.supplierId);
      for (const sid of u.supplierIds ?? []) ids.add(sid);
    }
    return Array.from(ids)
      .map(id => ({ id, name: supplierMap[id] || id }))
      .filter(o => o.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [units, supplierMap]);

  const available = useMemo(() => scopedUnits.filter(u =>
    u.status === 'available' ||
    (u.returnType === 'returned_to_inventory' && u.status !== 'sold')
  ), [scopedUnits]);
  const incoming = useMemo(() => scopedUnits.filter(u => u.status === 'incoming'), [scopedUnits]);

  // PRIMARY on-hand set for THIS scope. Office: on-hand stock + reclaimed
  // returns. SHS: supplier-held (incoming) units. The downstream views
  // (stock / by-supplier / out-of-stock) all read from this so the scope
  // switch fans out cleanly.
  const scopePrimary = isShs ? incoming : available;

  // Sold units for this scope — lifetime, used by the out-of-stock view to
  // surface demand. stockSource records WHICH segment fulfilled the sale,
  // so the SHS out-of-stock view only counts sales fulfilled from SHS, and
  // the office one only counts office sales. Sold units without a
  // stockSource (legacy data) fall to office to preserve the old behaviour.
  const soldAll = useMemo(() => scopedUnits.filter(u => {
    if (u.status !== 'sold') return false;
    const src = u.stockSource ?? 'office';
    return isShs ? src === 'shs' : src === 'office';
  }), [scopedUnits, isShs]);

  // Rolling 24-hour windows (NOT UTC-midnight calendar). UTC-bucket
  // comparison was dropping evening-local sales because the operator
  // works in IST and the date string flipped before midnight local.
  // Use updatedAt (timestamp of the status flip) and fall back to
  // saleDate / returnDate when the doc predates updatedAt tracking.
  // updatedAt is a Firestore Timestamp OBJECT on real data and an ISO string
  // in the E2E shim; `new Date(timestampObject)` is Invalid Date and every
  // comparison against it is silently false. withinLastHours reads either
  // shape and falls through to the next candidate when one is unreadable,
  // rather than stopping at a truthy-but-unusable value. See
  // lib/firestoreTime.ts — this is the same defect that made the Buy screen's
  // "Sold Today" read 0 against a database the Sell screen read 2 from.
  //
  // Rolling 24 hours, NOT UTC-midnight calendar: UTC bucketing dropped
  // evening-local sales because the operator works in IST and the date string
  // flipped before their midnight.
  const todaySold     = scopedUnits.filter(u => u.status === 'sold'     && withinLastHours(24, u.updatedAt, u.saleDate || u.dateIn));
  const todayReturned = scopedUnits.filter(u => u.status === 'returned' && withinLastHours(24, u.updatedAt, u.returnDate));

  // ── Per-view groups ─────────────────────────────────────────────────────────
  // 'stock' view = primary on-hand units for this scope (Office=available,
  // SHS=incoming). Clean periodic table with no mixed-signal badges; the
  // two scopes get their own dashboards mounted side-by-side.
  const stockGroups = useMemo(
    () => buildGroups(scopePrimary, [], SERIES_GROUPS, u => unitSeries(u), {
      valueFn: u => u.buyPrice || 0, catalogIndex,
    }),
    [scopePrimary, catalogIndex],
  );

  // Supplier-grouped layout builder — rows are suppliers (built from the live
  // supplier list, scoped to those that actually hold the passed-in unit set),
  // colour-cycled. Each row buckets that supplier's units by SKU. A unit's
  // primary supplierId drives the row; anything unrecognised lands in a
  // synthetic "Unknown supplier" row. Reused by both the By-Supplier office
  // view (primary = available) and the SHS "By Supplier" grouping
  // (primary = incoming).
  const UNKNOWN_SUPPLIER_ID = '__unknown_supplier__';
  const buildSupplierGroups = useCallback((primary: InventoryUnit[]): PtGroupVM[] => {
    const present = new Set<string>();
    let hasUnknown = false;
    for (const u of primary) {
      const sid = u.supplierId && supplierMap[u.supplierId] ? u.supplierId : UNKNOWN_SUPPLIER_ID;
      if (sid === UNKNOWN_SUPPLIER_ID) hasUnknown = true;
      present.add(sid);
    }
    const defs: PtGroupDef[] = supplierOptions
      .filter(o => present.has(o.id))
      .map((o, i) => ({ id: o.id, label: o.name, color: SUPPLIER_PALETTE[i % SUPPLIER_PALETTE.length] }));
    if (hasUnknown) {
      defs.push({ id: UNKNOWN_SUPPLIER_ID, label: 'Unknown supplier', color: SUPPLIER_PALETTE[defs.length % SUPPLIER_PALETTE.length] });
    }
    const assign = (u: InventoryUnit) =>
      (u.supplierId && supplierMap[u.supplierId]) ? u.supplierId : UNKNOWN_SUPPLIER_ID;
    return buildGroups(primary, [], defs, assign, { valueFn: u => u.buyPrice || 0, catalogIndex });
  }, [supplierOptions, supplierMap, catalogIndex]);

  const supplierGroups = useMemo(() => buildSupplierGroups(scopePrimary), [buildSupplierGroups, scopePrimary]);

  const outOfStockGroups = useMemo(() => {
    // Exclude every SKU that still has on-hand stock for THIS scope — only
    // depleted ones (sold lifetime within scope, zero on hand now) survive.
    // Catalog-canonicalise these keys the same way buildGroups does below,
    // so a seed-matched model excludes correctly regardless of which raw
    // spelling the in-stock unit vs. the sold unit happened to carry.
    const inStock = new Set<string>();
    for (const u of scopePrimary) {
      const p = parseBrandModelStorage(u.model);
      const rawModel = p.model || u.model;
      const model = canonicaliseModel(rawModel, u.brand || p.brand, catalogIndex);
      inStock.add(bucketKeyOf(model, u.storage || p.storage));
    }
    // Tile count = units sold lifetime within this scope (demand signal);
    // value = revenue. soldAll is already scope-filtered above.
    return buildGroups(soldAll, [], SERIES_GROUPS, u => unitSeries(u), {
      valueFn: u => u.salePrice || 0, excludeKeys: inStock, catalogIndex,
    });
  }, [scopePrimary, soldAll, catalogIndex]);

  const groups = viewMode === 'supplier' ? supplierGroups
    : viewMode === 'outofstock' ? outOfStockGroups
    : stockGroups;

  // Overlay base set per view, within the scope. Out-of-stock drills into
  // lifetime sold (scope-filtered); stock + by-supplier drill into the
  // scope's on-hand primary set. By-supplier additionally narrows to the
  // clicked supplier via overlay.supplierId below.
  const overlayBase = useMemo<InventoryUnit[]>(() => {
    if (viewMode === 'outofstock') return soldAll;
    return scopePrimary;
  }, [viewMode, soldAll, scopePrimary]);

  /** Units matching the currently-selected element. EXACT match on
   *  parsed.model / storage / tag — same three keys the periodic table buckets
   *  by, so what's-in-the-tile and what's-in-the-overlay stay one-to-one.
   *  When the tile came from the By-Supplier view we also narrow to that
   *  supplier. Sorted newest-first by dateIn. */
  const overlayRows = useMemo<InventoryUnit[]>(() => {
    if (!overlay) return [];
    const wantKey = overlay.bucketKey;
    const wantSup = overlay.supplierId;
    return overlayBase.filter(u => {
      if (wantSup) {
        const ok = wantSup === UNKNOWN_SUPPLIER_ID
          ? !(u.supplierId && supplierMap[u.supplierId])
          : unitHasSupplier(u, wantSup);
        if (!ok) return false;
      }
      const parsed = parseBrandModelStorage(u.model || '');
      // Same computation as parseUnit()'s storage in buildGroups above —
      // no case-folding. A prior .toUpperCase().trim() here made this key
      // diverge from the tile's for any storage whose canonical casing
      // isn't already all-caps (e.g. 'Not Applicable' -> 'NOT APPLICABLE'),
      // so tiles for those units (Apple Watch) always opened to "0 rows".
      const storage = u.storage || parsed.storage;
      // Same catalog canonicalisation buildGroups applies to the tile's
      // bucket key — without this, a seed-merged tile (now labeled by its
      // canonical name) would fail to match any unit whose raw model isn't
      // spelled exactly that way, opening to "0 rows".
      const rawModel = parsed.model || u.model || '';
      const model = canonicaliseModel(rawModel, u.brand || parsed.brand, catalogIndex);
      const unitKey = bucketKeyOf(model, storage);
      return unitKey === wantKey;
    }).sort((a, b) => {
      const da = new Date(a.dateIn || 0).getTime();
      const db = new Date(b.dateIn || 0).getTime();
      return db - da;
    });
  }, [overlay, overlayBase, supplierMap, catalogIndex]);

  // ── Hover handlers with grace-period so cursor can reach the popover ─────────
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPopover(null), 180);
  }, [cancelClose]);

  const handleElementEnter = useCallback((
    el: Element,
    color: { bg: string; light: string; text: string; border: string },
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    cancelClose();
    if (el.count === 0 && el.shsCount === 0) return;
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    const countLabel =
      viewMode === 'outofstock' ? 'sold' :
      isShs ? 'on order' :
      'in office';
    setPopover({ el, color, rect, countLabel });
  }, [cancelClose, viewMode]);

  // Hide the whole component only when there's genuinely no data anywhere —
  // a sub-view (Sales / Out of Stock) with no rows still renders the shell so
  // the operator can switch tabs. An office-only emptiness no longer blanks
  // the panel now that other views may have data.
  if (units.length === 0) return null;

  const scopeTitle = isShs ? 'SHS — Supplier Held Stock' : 'Office Stock Visibility';
  const scopeStockSub = isShs ? 'held by suppliers · order to fulfil' : 'in office';
  const viewTitle =
    viewMode === 'supplier'   ? (isShs ? 'SHS by Supplier' : 'Stock by Supplier') :
    viewMode === 'outofstock' ? (isShs ? 'Out of Stock — SHS' : 'Out of Stock — Office') :
                                scopeTitle;
  const headlineCount =
    viewMode === 'outofstock' ? groups.reduce((s, g) => s + g.elements.length, 0) :
                                scopePrimary.length;
  const headlineLabel =
    viewMode === 'outofstock'
      ? (headlineCount === 1 ? 'SKU' : 'SKUs')
      : (headlineCount === 1 ? 'unit' : 'units');
  const headlineSub =
    viewMode === 'supplier'   ? `${groups.length} supplier${groups.length === 1 ? '' : 's'}` :
    viewMode === 'outofstock' ? `${soldAll.length} sold lifetime` :
                                scopeStockSub;
  // Per-row total suffix: "£X stock" for office + by-supplier, "£X lifetime"
  // for the out-of-stock revenue rollup.
  const rowValueSuffix = viewMode === 'outofstock' ? 'lifetime' : 'stock';

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="h-full lg:h-auto">
      <div>
        <div style={{ background: '#ffffff', borderRadius: 20, padding: '12px 10px', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            <div>
              <p style={{ fontSize: isMobile ? 8 : 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#64748b', marginBottom: 2 }}>
                Inventory Periodic Table
              </p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1f2937', letterSpacing: '-0.03em', textTransform: 'uppercase' }}>
                {viewTitle}
              </p>
              {/* The count belongs under the title it describes, not wedged
                  against the scope toggle on the far right — reading it there
                  meant crossing the whole header and back, and it crowded the
                  control it sat beside. */}
              <p style={{ fontSize: isMobile ? 9 : 11, fontFamily: 'monospace', color: '#475569', marginTop: 2 }}>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>{headlineCount} {headlineLabel}</span>
                <span style={{ color: '#cbd5e1' }}>{'  ·  '}</span>
                {headlineSub}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Scope toggle — Office Stock vs SHS at the top-right. Same
                  level as the view tabs below, but lifted into the header
                  so it's the FIRST decision the operator makes when
                  scanning the panel. */}
              <div style={{ display: 'inline-flex', background: '#0f172a', borderRadius: 10, padding: 3, gap: 2 }}>
                {(['office', 'shs'] as const).map(s => {
                  const active = scope === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setScope(s); setOverlay(null); setPopover(null); }}
                      style={{
                        border: 'none', cursor: 'pointer',
                        padding: isMobile ? '5px 10px' : '6px 14px',
                        borderRadius: 8,
                        fontSize: isMobile ? 10 : 11, fontWeight: 800, fontFamily: 'system-ui',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        background: active ? (s === 'shs' ? '#0d9488' : '#fff') : 'transparent',
                        color: active ? (s === 'shs' ? '#fff' : '#0f172a') : '#94a3b8',
                        transition: 'background 0.12s, color 0.12s',
                      }}
                      title={s === 'shs' ? 'Supplier-held (SHS) stock' : 'Office stock'}
                    >
                      {s === 'shs' ? 'SHS' : 'Office Stock'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* View tabs + supplier filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 8, padding: 2 }}>
              {VIEW_TABS.map(t => {
                const active = viewMode === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setViewMode(t.id); setOverlay(null); setPopover(null); }}
                    style={{
                      border: 'none', cursor: 'pointer',
                      padding: isMobile ? '5px 8px' : '5px 12px',
                      borderRadius: 6,
                      fontSize: isMobile ? 9 : 10, fontWeight: 700, fontFamily: 'system-ui',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      background: active ? '#0f172a' : 'transparent',
                      color: active ? '#fff' : '#64748b',
                      transition: 'background 0.12s, color 0.12s',
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Supplier filter — scopes every view to one supplier. */}
            <select
              value={supplierFilterId}
              onChange={e => { setSupplierFilterId(e.target.value); setOverlay(null); }}
              title="Filter by supplier"
              style={{
                border: '1px solid #e2e8f0', borderRadius: 8,
                padding: isMobile ? '5px 8px' : '6px 10px',
                fontSize: isMobile ? 9 : 10, fontFamily: 'monospace',
                color: '#334155', background: '#fff', cursor: 'pointer',
                maxWidth: 180,
              }}
            >
              <option value="all">All suppliers</option>
              {supplierOptions.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>

          </div>

          <div style={{ display: 'flex', gap: isMobile ? 6 : 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 120, background: '#1e293b', borderRadius: 8, padding: typeof window !== 'undefined' && window.innerWidth < 768 ? '6px 8px' : '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 7 : 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Sold Today</span>
              <span style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 11 : 13, fontWeight: 800, fontFamily: 'monospace', color: '#34d399' }}>{todaySold.length}</span>
            </div>
            <div style={{ flex: 1, minWidth: 140, background: '#1e293b', borderRadius: 8, padding: typeof window !== 'undefined' && window.innerWidth < 768 ? '6px 8px' : '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 7 : 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Returned Today</span>
              <span style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 11 : 13, fontWeight: 800, fontFamily: 'monospace', color: '#fbbf24' }}>{todayReturned.length}</span>
            </div>
          </div>
        </div>

        {/* Group legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {groups.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color.bg }} />
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{g.label}</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#475569' }}>({g.totalCount})</span>
            </div>
          ))}
        </div>

        {/* Per-view empty state — the shell + tabs stay visible so the
            operator can switch back without the panel vanishing. */}
        {groups.length === 0 && (
          <div style={{ padding: '28px 12px', textAlign: 'center' }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>
              {viewMode === 'supplier'
                ? 'No stock attributed to a supplier'
                : viewMode === 'outofstock'
                  ? (isShs
                      ? 'No depleted SHS SKUs — every sold SHS line still has stock on order'
                      : 'Nothing out of stock — every sold SKU still has office units on hand')
                  : (isShs ? 'No supplier-held (SHS) stock on order' : 'No office stock to show')}
              {supplierFilterId !== 'all' && ' for this supplier'}
            </p>
          </div>
        )}

        {/* Periodic rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map(g => (
            <div key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {/* No text-transform. Every label reaching here is already
                    cased the way it should read — supplier names as the
                    supplier writes them (MHL, NIHAL), series labels straight
                    out of SERIES_GROUPS. `capitalize` uppercases the first
                    letter of each word without lowering the rest, so it
                    turned "Apple iPhones" into "Apple IPhones" and
                    "Apple iPads" into "Apple IPads" on the operator's own
                    stock screen. */}
                <div style={{ fontSize: 13, fontFamily: 'system-ui', color: g.color.bg, fontWeight: 800, minWidth: 120, flexShrink: 0, letterSpacing: '-0.02em' }}>
                  {g.label}
                </div>
                <div style={{ flex: 1, height: 1, background: `${g.color.bg}30` }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#475569' }}>£{Math.round(g.totalValue).toLocaleString()} {rowValueSuffix}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.elements.map(el => {
                  const blockKey  = `${el.model}|${el.storage ?? ''}`;
                  const hoverKey  = popover ? `${popover.el.model}|${popover.el.storage ?? ''}` : null;
                  const isHovered = hoverKey === blockKey;
                  const isEmpty   = el.count === 0 && el.shsCount === 0;
                  // Caption: storage if present, otherwise fall back to the full model name.
                  // Append the cellular radio (5G / Cellular) inline so the
                  // operator can see the connectivity at a glance — needed
                  // for tablets (WiFi vs WiFi+Cellular) and useful for
                  // phones (e.g. flagging 5G stock).
                  const baseCaption = el.storage || el.model;
                  const caption   = el.connectivity ? `${baseCaption} · ${el.connectivity}` : baseCaption;
                  return (
                    <button
                      key={blockKey}
                      onMouseEnter={e => handleElementEnter(el, g.color, e)}
                      onMouseLeave={scheduleClose}
                      onClick={() => {
                        // Click opens the Excel-style overlay for this SKU.
                        // Empty blocks (zero stock + zero SHS) are non-actionable.
                        if (el.count === 0 && el.shsCount === 0) return;
                        setOverlay({
                          seriesKey: viewMode === 'supplier' ? `${g.label} · ${el.seriesKey}` : el.seriesKey,
                          model: el.model,
                          storage: el.storage,
                          bucketKey: el.bucketKey,
                          // By-Supplier rows are keyed by supplier id — scope
                          // the overlay to that supplier's units of the SKU.
                          ...(viewMode === 'supplier' ? { supplierId: g.id } : {}),
                        });
                      }}
                      title={el.seriesKey}
                      style={{
                        // Tile +10% (60→66) and child fonts +10% so the
                        // periodic table is readable from across the
                        // warehouse. Storage caption gets a separate +50%
                        // bump with bold weight — it's the field the
                        // employees lean in to read.
                        width: 66, height: 66,
                        background: isEmpty ? '#1e293b' : isHovered ? g.color.bg : g.color.light,
                        border: `1.5px solid ${isEmpty ? '#334155' : isHovered ? g.color.bg : g.color.border}`,
                        borderRadius: 8,
                        padding: '3px 2px',
                        // Hard clip: no label, badge, or caption may bleed
                        // past the block border — guarantees fixed grid.
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'transform 0.1s, box-shadow 0.1s, background 0.1s',
                        transform: isHovered ? 'scale(1.1)' : 'scale(1)',
                        boxShadow: isHovered ? `0 0 0 2px ${isEmpty ? '#fca5a5' : g.color.bg}, 0 4px 12px rgba(0,0,0,0.3)` : 'none',
                        opacity: 1,
                      }}
                    >
                      {/* Count (top-right corner). SHS units are no longer
                          badged here — they live in the dedicated SHS Stock
                          view, so every tile shows a single unambiguous count.
                          In OUT-OF-STOCK mode the corner always reads 0:
                          the lifetime-sold figure (el.count) is the demand
                          signal but operator read it as "current stock"
                          and got confused. Demand info stays available on
                          hover / overlay click. */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                        <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 800, color: isHovered ? '#fff' : g.color.text }}>
                          {viewMode === 'outofstock' ? 0 : el.count}
                        </span>
                      </div>

                      {/* Big symbol (shortCode of the model) — font-size
                          scales down by length so even a 12-char label
                          fits inside the 66px tile width. All sizes are
                          +10% vs the pre-2026-06-20 baseline (60px tile)
                          per operator legibility request. */}
                      <div style={{ textAlign: 'center', lineHeight: 1, width: '100%', overflow: 'hidden' }}>
                        <span style={{
                          fontSize:
                            el.symbol.length > 11 ? 8  :
                            el.symbol.length > 9  ? 9  :
                            el.symbol.length > 7  ? 10 :
                            el.symbol.length > 6  ? 11 :
                            el.symbol.length > 5  ? 12 :
                            el.symbol.length > 4  ? 14 :
                                                    19,
                          fontWeight: 900,
                          color: isHovered ? '#fff' : g.color.text,
                          fontFamily: 'system-ui, sans-serif',
                          letterSpacing: '-0.04em',
                          whiteSpace: 'nowrap',
                          display: 'inline-block',
                          maxWidth: '100%',
                        }}>
                          {el.symbol}
                        </span>
                      </div>

                      {/* Storage caption — +50% size + bold weight per
                          operator request. This is the field employees
                          peep in to read across the floor; bumped from
                          6.5px to 10px with fontWeight 800 + full opacity
                          so it reads from a meter away. */}
                      <div style={{ width: '100%', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 10, fontFamily: 'monospace', fontWeight: 800,
                          color: isHovered ? '#fff' : g.color.text,
                          opacity: 1, lineHeight: 1.2, display: 'block',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {caption}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {isShs && viewMode === 'stock' && groups.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#0d9488', fontFamily: 'monospace', fontWeight: 700 }}>SHS</span>
            <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>= supplier-held stock on order — not yet received into the office</span>
          </div>
        )}
      </div>
      </div>

      {/* Excel-style SKU overlay — same grouped + detailed surface as the
          Buy-page KPI overlays so every "click a tile" surface looks identical.
          Aggregates are empty here because the periodic table is built from
          IMEI-tracked units only; no master-file rollups to fold in. */}
      <AnimatePresence>
        {overlay && (
          <StockOverlayModal
            title={overlay.seriesKey}
            rows={overlayRows}
            aggregates={[]}
            supplierMap={supplierMap}
            region={region}
            onClose={() => setOverlay(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
