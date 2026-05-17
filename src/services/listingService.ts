/**
 * SKU-level listing — exposes one toggle per (brand, model, storage, colour)
 * bucket. Updates every available unit in the group in a single bulk write,
 * then logs the change as an inventoryEvents row.
 *
 * Business rule centralised here:
 *  - Listing-per-SKU (not per-IMEI) — the helper applies the same
 *    `listingSites` value to every available unit in the group so
 *    `deriveSkuListing` collapses back to the exact same set.
 *  - `platformListed` is stamped truthy iff any marketplace is selected
 *    (handled inside dbService.setSkuListingSites).
 */

import { dbService } from '../lib/dbService';
import type { InventoryUnit, ListingSite } from '../types';
import { listingSiteLabel } from '../lib/platforms';
import { logInventoryEvent } from '../lib/inventoryEvents';

export interface SetSkuListingsInput {
  /** The SKU group's units. The helper only writes to status==='available'
   *  ones; the rest are ignored so sold / returned units don't reactivate. */
  units: InventoryUnit[];
  /** New desired set of marketplaces for the SKU. Pass [] to delist. */
  listingSites: ListingSite[];
  /** Optional human-readable label used in the audit log message. */
  skuLabel?: string;
}

export interface SetSkuListingsResult {
  ok: boolean;
  updatedCount: number;
  message?: string;
}

/**
 * Apply a new listing-sites set to every available unit in the SKU group.
 * Wraps dbService.setSkuListingSites so the inventoryEvents audit row is
 * always emitted from one place (matches the consistency pattern other
 * services use).
 */
export async function setSkuListings(input: SetSkuListingsInput): Promise<SetSkuListingsResult> {
  const availableUnits = input.units.filter(u => u.status === 'available');
  if (availableUnits.length === 0) {
    return {
      ok: false,
      updatedCount: 0,
      message: 'No available units in this SKU to update.',
    };
  }

  try {
    await dbService.setSkuListingSites(availableUnits, input.listingSites);
  } catch (err: any) {
    return {
      ok: false,
      updatedCount: 0,
      message: err?.message || 'Listing save failed — please try again.',
    };
  }

  // Audit-log entry (matches the BulkListingModal/notification copy convention).
  const verb = input.listingSites.length === 0 ? 'Delisted' : 'Listed';
  const sitesText = input.listingSites.length === 0
    ? '(no marketplaces)'
    : `on ${input.listingSites.map(listingSiteLabel).join(', ')}`;
  const label = input.skuLabel || 'SKU group';
  await logInventoryEvent({
    type: input.listingSites.length === 0 ? 'delisted' : 'listed',
    message: `${verb} ${label} ${sitesText} (${availableUnits.length} unit${availableUnits.length === 1 ? '' : 's'})`,
  });

  return { ok: true, updatedCount: availableUnits.length };
}
