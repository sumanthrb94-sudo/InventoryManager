import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

// Units already accounted for by an explicit notification at creation
// time (e.g. AddSHSModal, StockIntakeFlow emit their own batched
// shs_received / new_stock). The real-time hook skips these so the
// Firestore echo doesn't add a duplicate notification per unit.
const sessionCreatedUnits = new Set<string>();

export function registerSessionCreatedUnits(unitIds: string[]) {
  console.log('[SessionDedup] Registering units for deduplication:', unitIds);
  unitIds.forEach(id => sessionCreatedUnits.add(id));
  console.log('[SessionDedup] Current set size:', sessionCreatedUnits.size);
  // Auto-clear after 5 seconds so the dedup window is long enough to
  // cover Firestore's batched echoes (snapshot listeners may fire across
  // a few hundred ms) but doesn't permanently suppress new arrivals.
  setTimeout(() => {
    console.log('[SessionDedup] Auto-clearing units:', unitIds);
    unitIds.forEach(id => sessionCreatedUnits.delete(id));
    console.log('[SessionDedup] Set size after clear:', sessionCreatedUnits.size);
  }, 5000);
}

// Cross-tick coalescing buffer.
// Firestore snapshot listeners frequently fire once per document (per
// `dbService.create` call), so when AddSHSModal writes 10 units in a
// loop, the inventoryStore re-renders 10 separate times — each render
// sees 1 new unit and would otherwise fire 1 notification. We buffer
// pending arrivals across renders and flush them on a 700ms quiet
// window so the whole burst lands as a single grouped notification.
const FLUSH_DELAY_MS = 700;
const pendingNewStock = new Map<string, { rep: InventoryUnit; count: number; ids: Set<string> }>();
const pendingSold: InventoryUnit[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // new_stock / shs_received buckets
    for (const { rep, count } of pendingNewStock.values()) {
      const type = rep.status === 'incoming' ? 'shs_received' : 'new_stock';
      console.log(`[Notification] Flushed ${type}: ${rep.model} × ${count}`);
      notificationService.addNotification(type, rep, undefined, count);
    }
    pendingNewStock.clear();
    // sold events stay per-unit (each has its own profit calc)
    for (const u of pendingSold) {
      notificationService.addNotification('sold', u);
    }
    pendingSold.length = 0;
  }, FLUSH_DELAY_MS);
}

/**
 * Watches the inventory store for new units / status transitions and
 * fires notifications. Two layers of de-duplication:
 *   1. sessionCreatedUnits (call registerSessionCreatedUnits before the
 *      Firestore write) — bypasses this hook entirely. Use this when
 *      the caller is going to emit its own batched notification.
 *   2. cross-tick debouncing (FLUSH_DELAY_MS) — coalesces bursts that
 *      slip past session dedup into one notification per (model, status)
 *      bucket. Bulk arrivals always show up as a single "× N" entry.
 */
export function useRealTimeNotifications() {
  const { units, loaded } = useInventoryStore();
  const prevMap     = useRef<Map<string, InventoryUnit>>(new Map());
  const initialised = useRef(false);

  useEffect(() => {
    if (!loaded || units.length === 0) return;

    if (!initialised.current) {
      // First stable snapshot — record as baseline, never fire notifications here.
      prevMap.current = new Map(units.map(u => [u.id, u]));
      initialised.current = true;
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const prev  = prevMap.current;

    let touched = false;

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        const isToday = unit.dateIn === today || unit.createdAt?.startsWith(today);
        const isSessionUnit = sessionCreatedUnits.has(unit.id);
        if (!isToday || isSessionUnit) {
          if (isSessionUnit) console.log('[Notification] SKIPPED (session dedup):', unit.id, unit.model);
          continue;
        }
        // Bucket by model + status so new_stock and shs_received stay
        // separate even for the same model, and so a mixed-colour batch
        // of the same SKU still folds into one notification.
        const key = `${unit.model || ''}|${unit.status || ''}`;
        const bucket = pendingNewStock.get(key);
        if (bucket) {
          if (!bucket.ids.has(unit.id)) {
            bucket.ids.add(unit.id);
            bucket.count++;
            touched = true;
          }
        } else {
          pendingNewStock.set(key, { rep: unit, count: 1, ids: new Set([unit.id]) });
          touched = true;
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        pendingSold.push(unit);
        touched = true;
      }
    }

    prevMap.current = new Map(units.map(u => [u.id, u]));
    if (touched) scheduleFlush();
  }, [units, loaded]);
}
