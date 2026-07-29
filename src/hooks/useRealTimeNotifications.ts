import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

// Track units created in current session to avoid duplicate notifications
// when StockIntakeFlow's own notification is already batched
const sessionCreatedUnits = new Set<string>();
// Same idea for units a bulk write is about to flip to 'sold'. The grouped
// "sold" notification below already batches everything from ONE render into
// a single toast per model, but a large write (a big Sales Report import)
// lands across several Firestore-shim/network batches, and each batch's
// store update is its own render — so a several-hundred-unit import can
// still produce a handful of "sold" toasts per distinct model PER BATCH,
// which is still enough to pin the toast banner on screen for a while.
// Callers that already know they're about to bulk-flip units register them
// here first so this hook skips them entirely rather than re-deriving the
// same information from a diff.
const sessionSoldUnits = new Set<string>();

// durationMs is a safety-net backstop, not the primary clear mechanism — a
// caller writing hundreds/thousands of docs (a bulk import) can take far
// longer than the original 3s to actually land in the store, so a fixed
// short timer let those late-arriving units slip past the dedup set and
// spam one toast each. Callers doing large writes should pass a generous
// duration AND call the returned unregister() once their write settles.
function registerSessionUnits(set: Set<string>, unitIds: string[], durationMs: number): () => void {
  unitIds.forEach(id => set.add(id));
  const timer = setTimeout(() => {
    unitIds.forEach(id => set.delete(id));
  }, durationMs);
  return () => {
    clearTimeout(timer);
    unitIds.forEach(id => set.delete(id));
  };
}

export function registerSessionCreatedUnits(unitIds: string[], durationMs = 3000): () => void {
  return registerSessionUnits(sessionCreatedUnits, unitIds, durationMs);
}

export function registerSessionSoldUnits(unitIds: string[], durationMs = 3000): () => void {
  return registerSessionUnits(sessionSoldUnits, unitIds, durationMs);
}

export function useRealTimeNotifications() {
  const { units, loaded } = useInventoryStore();
  const prevMap     = useRef<Map<string, InventoryUnit>>(new Map());
  const initialised = useRef(false);

  useEffect(() => {
    // Don't start watching until the store has fully loaded its initial dataset.
    // Without this guard, the first delivery (localStorage cache) always appears
    // as "new units" because prevMap is empty on mount — triggering spurious
    // notifications on every page reload.
    if (!loaded || units.length === 0) return;

    if (!initialised.current) {
      // First stable snapshot — record as baseline, never fire notifications here
      prevMap.current = new Map(units.map(u => [u.id, u]));
      initialised.current = true;
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const prev  = prevMap.current;

    // Units that flipped to sold in THIS update. A sales-report import
    // flips a hundred at once; emitting one notification each buried the
    // bell under ~94 near-identical toasts. Collect first, group after.
    const newlySold: InventoryUnit[] = [];

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        // New unit — only notify if it arrived today (ignore historical data)
        const isToday = unit.dateIn === today || String(unit.createdAt || '').startsWith(today);
        const isSessionUnit = sessionCreatedUnits.has(unit.id);

        if (isToday && !isSessionUnit) {
          console.log('[Notification] Creating real-time notification for:', unit.id, unit.model);
          notificationService.addNotification('new_stock', unit);
        } else if (isToday && isSessionUnit) {
          console.log('[Notification] SKIPPED (session dedup):', unit.id, unit.model);
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        if (!sessionSoldUnits.has(unit.id)) newlySold.push(unit);
      }
    }

    // One notification per model, carrying the group's unit count and its
    // summed profit. A single sale still reads exactly as it did before.
    if (newlySold.length > 0) {
      const groups = new Map<string, InventoryUnit[]>();
      for (const u of newlySold) {
        const key = `${u.model || ''}__${u.storage || ''}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(u); else groups.set(key, [u]);
      }
      for (const bucket of groups.values()) {
        const profit = bucket.reduce(
          (sum, u) => sum + ((u.salePrice ?? 0) - (u.buyPrice ?? 0)),
          0,
        );
        // Passing an explicit count bypasses the batch buffer, so delivery
        // stays synchronous — a sold notification shouldn't wait on a timer.
        notificationService.addNotification('sold', bucket[0], profit, bucket.length);
      }
    }

    prevMap.current = new Map(units.map(u => [u.id, u]));
  }, [units, loaded]);
}
