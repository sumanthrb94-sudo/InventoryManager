import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

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

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        // New unit — only notify if it arrived today (ignore historical data)
        if (unit.dateIn === today || unit.createdAt?.startsWith(today)) {
          notificationService.addNotification('new_stock', unit);
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        notificationService.addNotification('sold', unit);
      }
    }

    prevMap.current = new Map(units.map(u => [u.id, u]));
  }, [units, loaded]);
}
