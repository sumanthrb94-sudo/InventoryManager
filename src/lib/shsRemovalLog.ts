// Append-only audit log for SHS-pending units that get delisted.
//
// Why this exists:
//   - The unit row itself is hard-deleted from `inventoryUnits` when an
//     operator removes a pending SHS line, so there's no surviving
//     evidence after the fact.
//   - The notification stream caps at 24 hours and is per-user state
//     (localStorage), so it can't be the source of truth for the
//     "last 48h removals" tape on a fresh device or new login.
//
// This module is the source of truth for the StockTickerBoard. Writers
// call `logSHSRemoval` after a successful delete; readers subscribe
// via `subscribeRecentRemovals` to get a live, server-backed feed
// trimmed to the requested window.

import {
  query, where, orderBy, onSnapshot, collection, Timestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { dbService } from './dbService';

export interface SHSRemovalLogEntry {
  id:         string;
  model:      string;
  quantity:   number;
  colour?:    string;
  storage?:   string;
  supplierId?: string;
  removedAt:  string;   // ISO
  removedBy?: string;   // uid (best-effort)
}

const COLLECTION = 'shsRemovals';

/** Records a single delisting action. Quantity is the number of units in the group. */
export async function logSHSRemoval(entry: Omit<SHSRemovalLogEntry, 'id' | 'removedAt' | 'removedBy'> & {
  removedAt?: string;
}) {
  const id = `shsrm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const removedAt = entry.removedAt || new Date().toISOString();
  const removedBy = auth.currentUser?.uid;
  const payload: SHSRemovalLogEntry = {
    id,
    model:      entry.model,
    quantity:   Math.max(1, Math.floor(entry.quantity || 1)),
    colour:     entry.colour,
    storage:    entry.storage,
    supplierId: entry.supplierId,
    removedAt,
    removedBy,
  };
  // Reuse dbService.create so the in-memory cache stays consistent and
  // any other surface that might subscribe to this collection wakes up.
  await dbService.create(COLLECTION, id, payload);
  return payload;
}

/**
 * Live subscription to recent removals.
 * - hoursWindow defaults to 48
 * - Sorted newest-first
 * - Returns an unsubscribe function
 *
 * Uses a server-side `where(removedAt >= cutoff)` so the wire payload is
 * already trimmed; the tape doesn't pull the full historical log on
 * every page load.
 */
export function subscribeRecentRemovals(
  callback: (entries: SHSRemovalLogEntry[]) => void,
  hoursWindow: number = 48,
): () => void {
  const cutoff = new Date(Date.now() - hoursWindow * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  const q = query(
    collection(db, COLLECTION),
    where('removedAt', '>=', cutoffIso),
    orderBy('removedAt', 'desc'),
  );

  return onSnapshot(
    q,
    snap => {
      const items: SHSRemovalLogEntry[] = snap.docs.map(d => {
        const data = d.data() as any;
        // Tolerate Timestamp values in case a writer used serverTimestamp().
        const ra = data.removedAt instanceof Timestamp
          ? data.removedAt.toDate().toISOString()
          : (typeof data.removedAt === 'string' ? data.removedAt : new Date().toISOString());
        return {
          id:         d.id,
          model:      data.model || 'Unknown model',
          quantity:   typeof data.quantity === 'number' && data.quantity > 0 ? data.quantity : 1,
          colour:     data.colour,
          storage:    data.storage,
          supplierId: data.supplierId,
          removedAt:  ra,
          removedBy:  data.removedBy,
        };
      });
      callback(items);
    },
    err => {
      console.warn('[shsRemovalLog] snapshot error:', err.message);
      callback([]);
    },
  );
}
