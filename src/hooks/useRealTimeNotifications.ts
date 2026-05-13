import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

// Track units created in current session to avoid duplicate notifications
// when StockIntakeFlow's own notification is already batched.
const sessionCreatedUnits = new Set<string>();

export function registerSessionCreatedUnits(unitIds: string[]) {
  console.log('[SessionDedup] Registering units for deduplication:', unitIds);
  unitIds.forEach(id => sessionCreatedUnits.add(id));
  console.log('[SessionDedup] Current set size:', sessionCreatedUnits.size);
  setTimeout(() => {
    console.log('[SessionDedup] Auto-clearing units:', unitIds);
    unitIds.forEach(id => sessionCreatedUnits.delete(id));
    console.log('[SessionDedup] Set size after clear:', sessionCreatedUnits.size);
  }, 3000);
}

/**
 * Watches the inventory store for new units / status transitions and
 * fires notifications. Batches arrivals within a single render tick so
 * an 18-unit SHS push surfaces as ONE "× 18 iPhone 13 added" rather
 * than eighteen separate iPhone 13 entries.
 */
export function useRealTimeNotifications() {
  const { units, loaded } = useInventoryStore();
  const prevMap     = useRef<Map<string, InventoryUnit>>(new Map());
  const initialised = useRef(false);

  useEffect(() => {
    if (!loaded || units.length === 0) return;

    if (!initialised.current) {
      // First stable snapshot — record as baseline, never fire notifications here
      prevMap.current = new Map(units.map(u => [u.id, u]));
      initialised.current = true;
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const prev  = prevMap.current;

    // Accumulators for this tick.
    const newStockBuckets = new Map<string, { rep: InventoryUnit; count: number }>();
    const soldEvents: InventoryUnit[] = [];

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        const isToday = unit.dateIn === today || unit.createdAt?.startsWith(today);
        const isSessionUnit = sessionCreatedUnits.has(unit.id);
        if (isToday && !isSessionUnit) {
          // Group by model + status so "10 Red iPhone 13" and "8 Blue
          // iPhone 13" still merge into one "iPhone 13 × 18" notification.
          // Different models / statuses stay separate.
          const key = `${unit.model || ''}|${unit.status || ''}`;
          const bucket = newStockBuckets.get(key);
          if (bucket) bucket.count++;
          else newStockBuckets.set(key, { rep: unit, count: 1 });
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        soldEvents.push(unit);
      }
    }

    // Emit one notification per (model, status) group with the count.
    for (const { rep, count } of newStockBuckets.values()) {
      console.log(`[Notification] Batched new_stock: ${rep.model} × ${count}`);
      notificationService.addNotification('new_stock', rep, undefined, count);
    }

    // Sales are per-unit by design (each carries its own profit calc),
    // but they're typically not bulk events anyway.
    for (const unit of soldEvents) {
      notificationService.addNotification('sold', unit);
    }

    prevMap.current = new Map(units.map(u => [u.id, u]));
  }, [units, loaded]);
}
