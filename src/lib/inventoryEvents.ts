import { dbService } from './dbService';
import { InventoryEvent } from '../types';

/**
 * Append an audit-trail event.
 *
 * NEVER throws. Every caller invokes this AFTER the write it describes has
 * already succeeded, and every caller returns a `{ ok, error }` result object
 * rather than propagating exceptions. A rejection here therefore escaped the
 * result contract entirely — it flew past `addSoldUnitFromSale`'s and
 * `completeUnitBuyInfo`'s own try/catch (both of which wrap only their
 * dbService writes, not this trailing log) and surfaced as an unhandled
 * exception in the caller's caller.
 *
 * In the sales importer that was the difference between one failed row and a
 * failed import: the per-row loop had no isolation, so a single rejected event
 * write aborted the remaining rows, dropped the operator back on the audit
 * screen, and left those rows genuinely still needing completion on the next
 * upload. The loop is isolated now, but the contract belongs here too — losing
 * a log line must never be able to fail, or undo, the operation it records.
 *
 * The unit/sale write is the system of record; this collection is history. So
 * a failure is reported to the console and swallowed.
 */
export async function logInventoryEvent(event: Omit<InventoryEvent, 'id' | 'createdAt' | 'ownerId'> & { ownerId?: string }) {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await dbService.create('inventoryEvents', id, {
      ...event,
      ownerId: event.ownerId || 'shared',
    });
  } catch (err) {
    console.warn('[inventoryEvents] failed to log event (write it describes still stands):', event.type, err);
  }
}
