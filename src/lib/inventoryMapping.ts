/**
 * inventoryMapping — links per-IMEI inventoryUnits to their INVENTORY-sheet
 * master aggregate (one model rollup per row in the user's spreadsheet).
 *
 * Why this exists: the INVENTORY tab is the user's source of truth for what's
 * physically in the office (157 units / £14,719). The IMEI NUMBERS tab is the
 * mapping table — one row per serial that belongs to a model on the master
 * sheet. The two sheets use slightly different model strings ("IPAD 9TH GEN
 * 64GB W/C" vs "iPad 10.2 (2021) 9th gen 64 GB - WiFi + 4G") so we can't
 * compare strings literally. This module fingerprints both sides and matches
 * by (brand, normalised tokens, storage, cellular flag) with a token-overlap
 * fallback for the long-tail.
 *
 * The status returned for each unit:
 *   - 'mapped':   auto-match or operator-confirmed match to an aggregate
 *   - 'manual':   operator explicitly chose the aggregate
 *   - 'orphan':   operator confirmed there's no master row for this IMEI
 *   - 'unmapped': no master match yet — surfaces in the Mapping Review queue
 *   - 'shs':      this is an SHS placeholder unit (skip mapping entirely)
 */

import type { InventoryUnit, InventoryAggregate } from '../types';
import { shsAggregatesFrom } from './shsCount';

export type MappingStatus = 'mapped' | 'manual' | 'orphan' | 'unmapped' | 'shs';

/** Result of mapping a single unit. */
export interface MappingResult {
  status: MappingStatus;
  aggregate?: InventoryAggregate;
  /** Top-N suggestions sorted by score, used by the review queue when unmapped. */
  suggestions?: InventoryAggregate[];
  /** Confidence of the matched aggregate (0..1). 1 = exact fingerprint match. */
  score?: number;
}

const ORPHAN_SENTINEL = '__orphan__';

// ── Fingerprinting ───────────────────────────────────────────────────────────

/**
 * Canonical token form of a model string. Brand is already stripped on import
 * (parseBrandModelStorage), so we work with the trailing model only.
 *
 * Synonyms collapsed:
 *   - "9th gen" / "9TH GEN" / "9 gen"           → "9"
 *   - "W/C" / "WiFi + 4G" / "Wifi + Cellular" / → "cell"
 *   - "WiFi" / "Wi-Fi" / "W " / "WIFI"          → "wifi"
 *   - "(2021)" / "(Mid 2014)" parens            → dropped
 *   - all punctuation                           → space
 */
export function fingerprintModel(model: string | undefined | null): string {
  let s = String(model ?? '').toLowerCase();
  // "9th gen" / "9TH GEN" / "9 gen" → "9"
  s = s.replace(/(\d+)\s*(?:st|nd|rd|th)?\s*gen\b/g, '$1');
  // Cellular indicators FIRST (so "wifi + 4g" doesn't get split into wifi + 4g).
  s = s.replace(/wi[-\s]?fi\s*\+\s*(?:4g|cellular|lte)/g, ' cell ');
  s = s.replace(/\bw\s*\/\s*c\b/g, ' cell ');
  s = s.replace(/\bcellular\b/g, ' cell ');
  s = s.replace(/\b4g\b|\b5g\b|\blte\b/g, ' cell ');
  // Remaining WiFi-only references — bare "WiFi", "Wi-Fi", standalone "W".
  s = s.replace(/wi[-\s]?fi/g, ' wifi ');
  s = s.replace(/\bw\b/g, ' wifi ');
  // Strip parenthetical asides like "(2021)", "(Mid 2014)".
  s = s.replace(/\([^)]*\)/g, ' ');
  // Collapse storage tokens so "64 GB" / "64GB" / "1 TB" become one token.
  s = s.replace(/(\d+)\s*gb\b/g, '$1gb');
  s = s.replace(/(\d+)\s*tb\b/g, '$1tb');
  // Punctuation → space, collapse whitespace.
  s = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Cellular models often carry a leftover "wifi" descriptor (e.g. "Wifi 2019")
  // — drop the contradictory token so the cell variant doesn't accidentally
  // match the wifi-only SKU.
  if (/\bcell\b/.test(s)) {
    s = s.replace(/\bwifi\b/g, '').replace(/\s+/g, ' ').trim();
  }
  return s;
}

/** Set of useful tokens from a fingerprint (length > 0). */
function tokens(fp: string): Set<string> {
  if (!fp) return new Set();
  return new Set(fp.split(' ').filter(t => t.length > 0));
}

/** True when either side mentions cellular. Used as a hard filter to avoid
 *  matching the WiFi variant of a model to the Cellular variant. */
function hasCell(fp: string): boolean { return / cell\b| cell |^cell /.test(' ' + fp + ' '); }

// ── Match scoring ────────────────────────────────────────────────────────────

interface ScoreInput { unitBrand: string; unitFp: string; unitStorage: string }
interface AggIndexEntry {
  agg: InventoryAggregate;
  brand: string;
  fp: string;
  storage: string;
  tokenSet: Set<string>;
  hasCell: boolean;
}

function buildIndexEntry(a: InventoryAggregate): AggIndexEntry {
  const fp = fingerprintModel(a.model);
  return {
    agg: a,
    brand: ((a as any).brand || '').toLowerCase(),
    fp,
    storage: (a.storage || '').toLowerCase(),
    tokenSet: tokens(fp),
    hasCell: hasCell(fp),
  };
}

/** Score from 0..1 for how well an aggregate matches a unit. */
function scoreMatch(u: ScoreInput, e: AggIndexEntry): number {
  // Hard constraints first — brand and storage must align (when both present).
  if (u.unitBrand && e.brand && u.unitBrand !== e.brand) return 0;
  if (u.unitStorage && e.storage && u.unitStorage !== e.storage) return 0;
  // Cellular flag must agree — WiFi-only and Cellular variants are distinct SKUs.
  if (hasCell(u.unitFp) !== e.hasCell) return 0;
  // Exact fingerprint = perfect score.
  if (u.unitFp && u.unitFp === e.fp) return 1;
  const ut = tokens(u.unitFp);
  if (ut.size === 0 || e.tokenSet.size === 0) return 0;
  let common = 0;
  for (const t of ut) if (e.tokenSet.has(t)) common++;
  const minSize = Math.min(ut.size, e.tokenSet.size);
  return common / minSize;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AggregateIndex {
  entries: AggIndexEntry[];
  byId: Map<string, InventoryAggregate>;
}

export function buildAggregateIndex(aggregates: InventoryAggregate[]): AggregateIndex {
  // Exclude SHS aggregates — they don't represent in-office stock and would
  // mis-map an in-office IMEI to a supplier-held row.
  const shsIds = new Set(shsAggregatesFrom(aggregates).map(a => a.id));
  const entries: AggIndexEntry[] = [];
  const byId = new Map<string, InventoryAggregate>();
  for (const a of aggregates) {
    byId.set(a.id, a);
    if (shsIds.has(a.id)) continue;
    entries.push(buildIndexEntry(a));
  }
  return { entries, byId };
}

/**
 * Map one unit. Honours the operator's manual override / orphan marker first,
 * then falls back to fuzzy match. Returns status + matched aggregate (when any)
 * + top-3 suggestions (when unmapped) so the review queue can render choices
 * without recomputing.
 */
export function mapUnit(
  unit: InventoryUnit,
  index: AggregateIndex,
  threshold = 0.6,
): MappingResult {
  // SHS placeholders skip mapping entirely.
  if (unit.status === 'incoming') return { status: 'shs' };

  const override = (unit as any).inventoryAggregateId as string | undefined;
  if (override === ORPHAN_SENTINEL) return { status: 'orphan' };
  if (override) {
    const agg = index.byId.get(override);
    if (agg) return { status: 'manual', aggregate: agg, score: 1 };
    // Override points to a deleted aggregate — fall through to auto-match.
  }

  const input: ScoreInput = {
    unitBrand: ((unit.brand || '') as string).toLowerCase(),
    unitFp: fingerprintModel(unit.model),
    unitStorage: (unit.storage || '').toLowerCase(),
  };
  let best: { entry: AggIndexEntry; score: number } | undefined;
  const ranked: Array<{ entry: AggIndexEntry; score: number }> = [];
  for (const e of index.entries) {
    const s = scoreMatch(input, e);
    if (s <= 0) continue;
    ranked.push({ entry: e, score: s });
    if (!best || s > best.score) best = { entry: e, score: s };
  }
  ranked.sort((a, b) => b.score - a.score);

  if (best && best.score >= threshold) {
    return { status: 'mapped', aggregate: best.entry.agg, score: best.score };
  }
  return {
    status: 'unmapped',
    suggestions: ranked.slice(0, 3).map(r => r.entry.agg),
  };
}

/** Build a Map of unitId → MappingResult for O(1) lookups in the UI. */
export function mapAllUnits(
  units: InventoryUnit[],
  aggregates: InventoryAggregate[],
  threshold = 0.6,
): Map<string, MappingResult> {
  const index = buildAggregateIndex(aggregates);
  const out = new Map<string, MappingResult>();
  for (const u of units) out.set(u.id, mapUnit(u, index, threshold));
  return out;
}

/** Sentinel string written to inventoryUnits.inventoryAggregateId when the
 *  operator confirms no master row exists for this IMEI. Exposed so the
 *  UI can patch the unit cleanly. */
export const ORPHAN_MARKER = ORPHAN_SENTINEL;
