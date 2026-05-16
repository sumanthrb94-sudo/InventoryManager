/**
 * shsCount — single source of truth for "Supplier Holdings (SHS)" counts
 * across every surface. Buy/Sell/Dashboard MUST agree on what an SHS is.
 *
 * Two data shapes both represent "supplier holds stock for us, no IMEI yet":
 *
 *   1. master-file aggregates (inventoryAggregates with
 *      quantityText === 'SHS') — one row per (model, supplier) combo from
 *      the INVENTORY sheet QUANTITY="SHS" tag.
 *
 *   2. synthetic placeholder units (inventoryUnits with status='incoming'
 *      AND id starting with 'shs_') — the parser creates one per master
 *      aggregate so the legacy "Pending SHS" UI lights up.
 *
 *   3. manual SHS orders (inventoryUnits with status='incoming' but
 *      id NOT starting with 'shs_') — added via the AddSHSModal flow.
 *
 * Counting (1) AND (2) double-counts the same thing. Pre-fix the BUY tab
 * showed 69 because it summed all three; the SELL tab showed 23 because
 * it only counted aggregates. Neither matched reality.
 *
 * The canonical count is: aggregates (1) + manual SHS orders (3).
 * The synthetic placeholders (2) are display-only aliases of (1).
 */

import type { InventoryUnit, InventoryAggregate } from '../types';

/** True if the unit is a parser-synthesised SHS placeholder for an aggregate. */
export function isShsPlaceholder(u: InventoryUnit): boolean {
  return u.status === 'incoming' && (u.id || '').startsWith('shs_');
}

/** True if the unit is a manually-logged SHS order (not synthetic). */
export function isManualShsUnit(u: InventoryUnit): boolean {
  return u.status === 'incoming' && !(u.id || '').startsWith('shs_');
}

/** All master-file SHS aggregate rows (one per Model × Supplier). */
export function shsAggregatesFrom(aggregates: InventoryAggregate[]): InventoryAggregate[] {
  return aggregates.filter(a => (a.quantityText || '').toUpperCase() === 'SHS');
}

/** All manually-logged SHS units, sorted newest first. */
export function manualShsUnitsFrom(units: InventoryUnit[]): InventoryUnit[] {
  return units
    .filter(isManualShsUnit)
    .sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || ''));
}

/**
 * Total SHS records the supplier holds for us — sum of aggregates + manual
 * orders. Synthetic placeholders are excluded to prevent double counting.
 * This is the number every "SHS" KPI in the app should display.
 */
export function totalShsRecords(
  units: InventoryUnit[],
  aggregates: InventoryAggregate[],
): number {
  return shsAggregatesFrom(aggregates).length + manualShsUnitsFrom(units).length;
}

/**
 * Sum of physical units the supplier holds. Aggregates with a numeric
 * quantityNum count those many units; aggregates with bare "SHS" text
 * count as 1 (qty unknown). Manual SHS orders count 1 each.
 * Useful for "X units expected" headlines vs the record count above.
 */
export function totalShsQuantity(
  units: InventoryUnit[],
  aggregates: InventoryAggregate[],
): number {
  const fromAgg = shsAggregatesFrom(aggregates)
    .reduce((s, a) => s + (a.quantityNum && a.quantityNum > 0 ? a.quantityNum : 1), 0);
  return fromAgg + manualShsUnitsFrom(units).length;
}
