// Group identical units for list rendering.
//
// Many list surfaces in the app render one row per InventoryUnit. When
// the same SKU is intake'd in bulk (e.g. 20 iPhone 20 Pro Max · Titanium
// · 1TB · Global Tech, all SHS), users want a single row with a "× N"
// count instead of 20 visually identical rows. Different colours / specs
// stay on their own row, so a 50-unit batch split across 3 colours still
// renders 3 rows with their respective counts.
//
// Grouping key intentionally omits batchId and IMEI — units that are
// functionally identical for the list reader (same model, colour,
// storage, grade, supplier, status, listing-platform-state) should
// collapse regardless of how they were ingested.

import type { InventoryUnit } from '../types';

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
}

function groupKey(u: InventoryUnit): string {
  return [
    (u.brand    || '').trim().toLowerCase(),
    (u.model    || '').trim().toLowerCase(),
    (u.colour   || '').trim().toLowerCase(),
    (u.storage  || '').trim().toLowerCase(),
    (u.grade    || '').trim().toLowerCase(),
    (u.supplierId || '').trim().toLowerCase(),
    (u.status   || '').trim().toLowerCase(),
  ].join('|');
}

/**
 * Group a list of units by their identifying fields and return one
 * UnitGroup per distinct (brand, model, colour, storage, grade,
 * supplier, status) tuple. Within a group the units are kept in their
 * original order so the representative (used for display + action) is
 * the first one in the list passed in.
 */
export function groupIdenticalUnits(units: InventoryUnit[]): UnitGroup[] {
  const buckets = new Map<string, UnitGroup>();
  for (const u of units) {
    const key = groupKey(u);
    const existing = buckets.get(key);
    if (existing) {
      existing.units.push(u);
      existing.count += 1;
      existing.totalBuyPrice += u.buyPrice || 0;
    } else {
      buckets.set(key, {
        key,
        units: [u],
        count: 1,
        representative: u,
        totalBuyPrice: u.buyPrice || 0,
      });
    }
  }
  return Array.from(buckets.values());
}
