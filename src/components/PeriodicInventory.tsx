import React, { useMemo, useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { InventoryUnit } from '../types';
import { parseBrandModelStorage, type Series } from '../lib/modelStorage';
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
const SERIES_GROUPS: ReadonlyArray<SeriesGroupDef> = [
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
  { id: 'Other',         label: 'Other',             color: { bg: '#475569', light: '#f1f5f9', text: '#334155', border: '#cbd5e1' } },
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
  priceRange: { min: number; max: number };
}

// sort 64GB < 128GB < 256GB < 512GB < 1TB
function storageGb(s: string): number {
  const m = s.match(/(\d+)\s*(TB|GB)/i);
  if (!m) return 9999;
  return parseInt(m[1]) * (m[2].toUpperCase() === 'TB' ? 1024 : 1);
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
function shortCode(model: string): string {
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

  // 5. Hard cap at 8 chars to guarantee box fit.
  if (s.length > 8) s = s.slice(0, 8).trim();

  return s || '?';
}

interface PopoverState {
  el: Element;
  color: { bg: string; light: string; text: string; border: string };
  rect: DOMRect;
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
  const { el, color, rect } = state;

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
          {/* Stock counts */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '4px 8px', minWidth: 36 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{el.count}</div>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>in office</div>
            </div>
            {el.shsCount > 0 && (
              <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: '4px 8px', minWidth: 36, border: '1px solid rgba(253,230,138,0.4)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fde68a', lineHeight: 1 }}>{el.shsCount}</div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>supplier</div>
              </div>
            )}
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

      {/* SHS note */}
      {el.shsCount > 0 && (
        <div style={{ margin: '0 12px 6px', padding: '6px 8px', background: 'rgba(253,230,138,0.08)', borderRadius: 12, border: '1px solid rgba(253,230,138,0.15)' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#fde68a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            SHS — Listed with Supplier
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>
            {el.shsCount} unit{el.shsCount > 1 ? 's' : ''} held by supplier · order to fulfil
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
  const available = units.filter(u => u.status === 'available');
  const incoming  = units.filter(u => u.status === 'incoming');

  // Pull supplier list locally so we can render supplier names in the overlay
  // without forcing every PeriodicInventory caller to thread a supplierMap.
  const { suppliers } = useInventoryStore();
  const region = useUserRegion();
  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  const [popover, setPopover] = useState<PopoverState | null>(null);
  /** Excel-style overlay target — set when a block is clicked, null when closed. */
  const [overlay, setOverlay] = useState<{ seriesKey: string; model: string; storage?: string } | null>(null);
  // Refs for the hover grace-period timers
  const closeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Units matching the currently-selected element. Filter contract mirrors
   *  SkuOverlayModal: substring match on model (case-insensitive, bidirectional
   *  to handle both "iPhone 13" stored vs "iPhone 13 Pro" selected and the
   *  reverse), exact match on storage when one is set. Sorted newest-first
   *  by dateIn so the latest stock surfaces at the top of the overlay. */
  const overlayRows = useMemo<InventoryUnit[]>(() => {
    if (!overlay) return [];
    const wantModel   = overlay.model.toLowerCase().trim();
    const wantStorage = (overlay.storage || '').toUpperCase().trim();
    return units.filter(u => {
      const parsed = parseBrandModelStorage(u.model || '');
      const model   = (u as any).model && (parsed.model || u.model);
      const storage = (u.storage || parsed.storage || '').toUpperCase();
      const modelOk = (model || '').toLowerCase().includes(wantModel) ||
                      wantModel.includes((model || '').toLowerCase());
      const storageOk = wantStorage === '' || storage === wantStorage;
      return modelOk && storageOk;
    }).sort((a, b) => {
      const da = new Date(a.dateIn || 0).getTime();
      const db = new Date(b.dateIn || 0).getTime();
      return db - da;
    });
  }, [overlay, units]);

  const today = new Date().toISOString().split('T')[0];
  const todaySold     = units.filter(u => u.status === 'sold' && (u.saleDate || u.dateIn) === today);
  const todayReturned = units.filter(u => u.status === 'returned' && u.returnDate === today);

  const groups = useMemo(() => {
    try {
    // Parse every unit ONCE upfront. Cache the parsed brand/model/storage/tag/series
    // alongside the unit so we can bucket by series and then by model+storage+tag.
    type ParsedUnit = { unit: InventoryUnit; model: string; storage?: string; tag?: string; series: Series };
    const parseUnit = (u: InventoryUnit): ParsedUnit => {
      const p = parseBrandModelStorage(u.model);
      // Prefer the unit's own storage field when present — covers the
      // tablet-RAM-ambiguity case (parser returns 6GB RAM for some tabs) and
      // any docs that already have storage broken out at import time.
      const storage = u.storage || p.storage;
      // Series goes through unitSeries() so legacy docs stamped with the old
      // (buggy) `series='Other'` field get re-derived from the cleaned model
      // string at render time. See unitSeries doc-comment.
      const series: Series = unitSeries(u);
      return { unit: u, model: p.model || u.model, storage, tag: p.tag, series };
    };

    const parsedAvailable = available.map(parseUnit);
    const parsedIncoming  = incoming.map(parseUnit);

    return SERIES_GROUPS.map(group => {
      const groupUnits    = parsedAvailable.filter(p => p.series === group.id);
      const groupIncoming = parsedIncoming.filter(p => p.series === group.id);

      // Key buckets by `model|storage|tag` so 128GB / 256GB / 5G / Wi-Fi
      // variants each produce SEPARATE blocks. A 5G-tagged Galaxy A32 lives
      // next to its non-5G sibling instead of merging into one cell.
      type Bucket = {
        model: string;
        storage?: string;
        tag?: string;
        count: number; shsCount: number; value: number;
        variants: Record<string, number>; storages: Record<string, number>; prices: number[];
      };
      const buckets: Record<string, Bucket> = {};
      const bucketKey = (model: string, storage?: string, tag?: string) =>
        `${model}|${storage ?? ''}|${tag ?? ''}`;

      for (const p of groupUnits) {
        const key = bucketKey(p.model, p.storage, p.tag);
        if (!buckets[key]) {
          buckets[key] = { model: p.model, storage: p.storage, tag: p.tag, count: 0, shsCount: 0, value: 0, variants: {}, storages: {}, prices: [] };
        }
        const b = buckets[key];
        b.count++;
        b.value += p.unit.buyPrice;
        b.prices.push(p.unit.buyPrice);
        const col = p.unit.colour || 'Unknown';
        b.variants[col] = (b.variants[col] || 0) + 1;
        if (p.storage) {
          b.storages[p.storage] = (b.storages[p.storage] || 0) + 1;
        }
      }

      for (const p of groupIncoming) {
        const key = bucketKey(p.model, p.storage, p.tag);
        if (!buckets[key]) {
          buckets[key] = { model: p.model, storage: p.storage, tag: p.tag, count: 0, shsCount: 0, value: 0, variants: {}, storages: {}, prices: [] };
        }
        buckets[key].shsCount++;
      }

      const elements: Element[] = Object.values(buckets)
        .map((d, i) => {
          // Label: full model name + optional storage + tag (5G / Wi-Fi+Cellular
          // / freeform). Tag is appended after storage so a 5G variant reads
          // as "Galaxy A32 64GB · 5G" next to its non-5G sibling. The
          // substring filter downstream (the Excel overlay) still matches by
          // model alone — tag is purely a display refinement here.
          const symbol = shortCode(d.model);
          const seriesKey = [
            d.model,
            d.storage,
            d.tag ? `· ${d.tag}` : '',
          ].filter(Boolean).join(' ');
          return {
            seriesKey,
            model:       d.model,
            storage:     d.storage,
            symbol,
            count:       d.count,
            shsCount:    d.shsCount,
            value:       d.value,
            searchTerm:  d.model,
            ordinal:     i + 1,
            variants: Object.entries(d.variants || {})
              .sort(([, a], [, b]) => b - a)
              .map(([colour, count]) => ({ colour, count })),
            storageVariants: Object.entries(d.storages || {})
              .sort(([a], [b]) => storageGb(a) - storageGb(b))
              .map(([storage, count]) => ({ storage, count })),
            priceRange: d.prices.length
              ? { min: Math.min(...d.prices), max: Math.max(...d.prices) }
              : { min: 0, max: 0 },
          };
        })
        // Sort by model number descending (newest model first), tie-break by
        // storage ascending so a "S22 128GB" sits left of "S22 256GB".
        .sort((a, b) => {
          const na = parseInt(a.model.match(/\d+/)?.[0] || '0');
          const nb = parseInt(b.model.match(/\d+/)?.[0] || '0');
          if (nb !== na) return nb - na;
          return storageGb(a.storage || '') - storageGb(b.storage || '');
        })
        .map((el, i) => ({ ...el, ordinal: i + 1 }));

      return {
        ...group, elements,
        totalCount: groupUnits.length,
        totalValue: groupUnits.reduce((s, p) => s + p.unit.buyPrice, 0),
      };
    }).filter(g => g.elements.length > 0);
    } catch (e) {
      console.error('PeriodicInventory groups error:', e);
      return [];
    }
  }, [available, incoming]);

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
    setPopover({ el, color, rect });
  }, [cancelClose]);

  if (groups.length === 0) return null;

  return (
    <div className="h-full lg:h-auto">
      <div>
        <div style={{ background: '#ffffff', borderRadius: 20, padding: '12px 10px', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 8 : 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#64748b', marginBottom: 2 }}>
                Inventory Periodic Table
              </p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#1f2937', letterSpacing: '-0.03em', textTransform: 'uppercase' }}>
                Stock Visibility
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: typeof window !== 'undefined' && window.innerWidth < 768 ? 9 : 11, fontFamily: 'monospace', color: '#94a3b8' }}>{available.length} units</p>
              <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>
                {incoming.length > 0 ? `+ ${incoming.length} w/ supplier` : 'in office'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: typeof window !== 'undefined' && window.innerWidth < 768 ? 6 : 8, flexWrap: 'wrap' }}>
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

        {/* Periodic rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {groups.map(g => (
            <div key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontFamily: 'system-ui', textTransform: 'capitalize', color: g.color.bg, fontWeight: 800, minWidth: 120, flexShrink: 0, letterSpacing: '-0.02em' }}>
                  {g.label}
                </div>
                <div style={{ flex: 1, height: 1, background: `${g.color.bg}30` }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#475569' }}>£{g.totalValue.toLocaleString()} stock</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.elements.map(el => {
                  const blockKey  = `${el.model}|${el.storage ?? ''}`;
                  const hoverKey  = popover ? `${popover.el.model}|${popover.el.storage ?? ''}` : null;
                  const isHovered = hoverKey === blockKey;
                  const isEmpty   = el.count === 0 && el.shsCount === 0;
                  // Caption: storage if present, otherwise fall back to the full model name.
                  const caption   = el.storage || el.model;
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
                          seriesKey: el.seriesKey,
                          model: el.model,
                          storage: el.storage,
                        });
                      }}
                      title={el.seriesKey}
                      style={{
                        width: 60, height: 60,
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
                      {/* Count (top-right corner) */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                        <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 800, color: isHovered ? '#fff' : g.color.text }}>
                          {el.count}
                        </span>
                        {el.shsCount > 0 && (
                          <span style={{ fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: '#fbbf24', lineHeight: 1 }}>
                            +{el.shsCount}S
                          </span>
                        )}
                      </div>

                      {/* Big symbol (shortCode of the model) — font-size
                          scales down by length so even an 8-char label
                          fits inside the fixed 60px width. */}
                      <div style={{ textAlign: 'center', lineHeight: 1, width: '100%', overflow: 'hidden' }}>
                        <span style={{
                          fontSize:
                            el.symbol.length > 7 ? 9  :
                            el.symbol.length > 6 ? 10 :
                            el.symbol.length > 5 ? 11 :
                            el.symbol.length > 4 ? 13 :
                                                   17,
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

                      {/* Small caption: storage if present, otherwise full model name */}
                      <div style={{ width: '100%', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 6.5, fontFamily: 'monospace',
                          color: isHovered ? 'rgba(255,255,255,0.8)' : g.color.text,
                          opacity: 0.75, lineHeight: 1.2, display: 'block',
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

        {groups.some(g => g.elements.some(el => el.shsCount > 0)) && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#fbbf24', fontFamily: 'monospace', fontWeight: 700 }}>+NS</span>
            <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>= N units listed with supplier (hover for details)</span>
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
