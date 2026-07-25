/**
 * unifiedSales.ts — one sale, one row.
 *
 * Two things describe the same event. A Sale doc, written by the importer or
 * the in-app sell flow. And a sold InventoryUnit, carrying salePrice /
 * saleDate / salePlatform from when it went out. Screens that list "sales"
 * merge both, because older units predate the sales collection entirely and
 * would otherwise vanish.
 *
 * The merge has to dedupe, and the dedupe is where it went wrong. Admin →
 * Sales History compared the synthetic row's id against the set of Sale doc
 * ids — but a synthetic row's id is the UNIT id, and a Sale doc's id is
 * `marketplace__orderNumber__imei`. Those two id spaces cannot collide, so
 * the guard never fired once. Every imported sale that matched a unit was
 * listed twice: 101 sales and 93 sold units rendered as 194 rows, with the
 * revenue and GP totals inflated to match.
 *
 * SellSheet already did this correctly, checking three keys. That logic now
 * lives here instead of being reimplemented per screen — which is how the
 * two drifted apart in the first place.
 */
import type { InventoryUnit, Sale } from '../types';

/** The three ways a synthetic row can turn out to be a sale we already have. */
export interface SaleDedupeIndex {
  /** Sale doc ids. */
  ids: Set<string>;
  /** Unit ids already claimed by a Sale doc — the check that was missing. */
  unitIds: Set<string>;
  /** `marketplace__orderNumber`, for rows that share an order but not an id. */
  keys: Set<string>;
}

export function buildDedupeIndex(sales: Sale[]): SaleDedupeIndex {
  const ids = new Set<string>();
  const unitIds = new Set<string>();
  const keys = new Set<string>();
  for (const s of sales) {
    ids.add(s.id);
    if (s.unitId) unitIds.add(s.unitId);
    if (s.orderNumber) keys.add(`${s.marketplace}__${s.orderNumber}`);
  }
  return { ids, unitIds, keys };
}

/**
 * True when this synthesised row duplicates a Sale doc we already hold.
 *
 * `row.id` is the unit id — that is what makes the unitIds check the load-
 * bearing one, and why comparing it against sale-doc ids alone did nothing.
 */
export function isDuplicateOfKnownSale(row: Sale, index: SaleDedupeIndex): boolean {
  if (index.ids.has(row.id)) return true;
  if (index.unitIds.has(row.id)) return true;
  if (row.orderNumber && index.keys.has(`${row.marketplace}__${row.orderNumber}`)) return true;
  return false;
}

/**
 * Merge Sale docs with sold units, dropping units already represented.
 *
 * @param sales      Sale docs — always kept, they are the record of truth.
 * @param units      All units; sold ones are considered for synthesis.
 * @param toSale     Converts a sold unit to a Sale-shaped row (`id` = unit id).
 * @param transform  Applied to every surviving row (e.g. recomputeSale).
 */
export function mergeSalesWithSoldUnits(
  sales: Sale[],
  units: InventoryUnit[],
  toSale: (u: InventoryUnit) => Sale,
  transform: (s: Sale) => Sale = (s) => s,
): Sale[] {
  const index = buildDedupeIndex(sales);
  const merged = sales.map(transform);

  for (const u of units) {
    if (u.status !== 'sold') continue;
    // A unit with neither a price nor a date carries no sale to show.
    if (u.salePrice == null && !u.saleDate) continue;
    // Returned units are never sales — the money went back.
    if (u.returnType) continue;
    const row = toSale(u);
    if (isDuplicateOfKnownSale(row, index)) continue;
    // Guard against two units synthesising the same order.
    if (row.orderNumber) index.keys.add(`${row.marketplace}__${row.orderNumber}`);
    index.unitIds.add(row.id);
    merged.push(transform(row));
  }
  return merged;
}
