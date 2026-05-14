// Group functionally-identical units for list rendering.
//
// Many list surfaces render one row per InventoryUnit. When the same SKU
// is intake'd in bulk (e.g. 20 iPhone 20 Pro Max · 1TB · Global Tech, all
// SHS), users want a single row with a "× N" count instead of 20 visually
// identical rows. Within a single SKU group, colours typically vary; the
// row exposes a colour breakdown the user can expand inline.

import type { InventoryUnit } from '../types';

export interface ColourBreakdown {
  colour: string;
  count: number;
  units: InventoryUnit[];
}

export interface UnitGroup {
  /** Stable key derived from the grouping fields. */
  key: string;
  /** All units in this group, original objects (no copies). */
  units: InventoryUnit[];
  /** Convenience — same as units.length. */
  count: number;
  /** First unit, used to drive display + as the action target. */
  representative: InventoryUnit;
  /** Sum of buyPrice across all units (e.g. for batch totals). */
  totalBuyPrice: number;
  /** Per-colour roll-up, ordered by count descending. */
  colours: ColourBreakdown[];
}

/**
 * Group key — intentionally excludes `colour`, `batchId`, and `imei` so
 * 20 iPhone 13 · 128GB SHS units across Red and Starlight collapse into
 * one group whose `colours` array shows the breakdown.
 */
function groupKey(u: InventoryUnit): string {
  return [
    (u.brand    || '').trim().toLowerCase(),
    (u.model    || '').trim().toLowerCase(),
    (u.storage  || '').trim().toLowerCase(),
    (u.grade    || '').trim().toLowerCase(),
    (u.supplierId || '').trim().toLowerCase(),
    (u.status   || '').trim().toLowerCase(),
  ].join('|');
}

export function groupIdenticalUnits(units: InventoryUnit[]): UnitGroup[] {
  type Bucket = Omit<UnitGroup, 'colours'> & {
    colourMap: Map<string, InventoryUnit[]>;
  };
  const buckets = new Map<string, Bucket>();

  for (const u of units) {
    const key = groupKey(u);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        units: [],
        count: 0,
        representative: u,
        totalBuyPrice: 0,
        colourMap: new Map(),
      };
      buckets.set(key, bucket);
    }
    bucket.units.push(u);
    bucket.count += 1;
    bucket.totalBuyPrice += u.buyPrice || 0;
    const colour = (u.colour || 'Unknown').trim() || 'Unknown';
    const arr = bucket.colourMap.get(colour);
    if (arr) arr.push(u);
    else bucket.colourMap.set(colour, [u]);
  }

  return Array.from(buckets.values()).map(b => ({
    key: b.key,
    units: b.units,
    count: b.count,
    representative: b.representative,
    totalBuyPrice: b.totalBuyPrice,
    colours: Array.from(b.colourMap.entries())
      .map(([colour, us]) => ({ colour, count: us.length, units: us }))
      .sort((a, b) => b.count - a.count || a.colour.localeCompare(b.colour)),
  }));
}
