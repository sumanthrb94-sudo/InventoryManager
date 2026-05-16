/**
 * skuListings.ts — runtime derivation of SKU-level listing state.
 *
 * The user's mental model: ONE listing per marketplace per SKU. If we have 50
 * iPhone 17 Pro Max 256GB Black units, we don't list 50 copies on Amazon — we
 * post a single Amazon listing and decrement the quantity as units sell.
 *
 * Persistence-wise the per-unit `listingSites` field stays as-is (it lets a
 * unit physically leave the SHS/awaiting-listing queue). The SKU's marketplace
 * presence is derived at runtime as the UNION of `listingSites` across all
 * AVAILABLE units in the SKU — so once any unit is flagged "on Amazon", the
 * SKU is shown as listed on Amazon. The bulk editor (see
 * `dbService.setSkuListingSites`) writes the same set to every available unit
 * in the group, keeping the derived state consistent.
 */
import type { InventoryUnit, ListingSite } from '../types';

/** Stable key for a SKU group — matches the grouping used in StockInPage,
 *  SellPage and ReturnsPage. */
export function skuKey(brand: string, model: string, storage?: string, colour?: string): string {
  return `${brand}|${model}|${storage ?? ''}|${colour ?? ''}`;
}

export interface SkuListingState {
  /** Sites where ANY available unit in this SKU is currently flagged listed.
   *  Derived: union of listingSites across all available units. */
  listedOn: ListingSite[];
  /** Number of available units in this SKU. */
  availableCount: number;
}

export function deriveSkuListing(units: InventoryUnit[]): SkuListingState {
  const sites = new Set<ListingSite>();
  let count = 0;
  for (const u of units) {
    if (u.status !== 'available') continue;
    count++;
    for (const s of u.listingSites ?? []) sites.add(s);
  }
  return { listedOn: [...sites], availableCount: count };
}
