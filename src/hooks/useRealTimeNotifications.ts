import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

// Track units created in current session to avoid duplicate notifications
// when StockIntakeFlow's own notification is already batched
const sessionCreatedUnits = new Set<string>();

export function registerSessionCreatedUnits(unitIds: string[]) {
  unitIds.forEach(id => sessionCreatedUnits.add(id));
  // Auto-clear after 3 seconds to allow real-time notifications for manual additions
  setTimeout(() => {
    unitIds.forEach(id => sessionCreatedUnits.delete(id));
  }, 3000);
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

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        // New unit — only notify if it arrived today (ignore historical data)
        // SKIP if this unit was created in the current session (StockIntakeFlow already batched it)
        if ((unit.dateIn === today || unit.createdAt?.startsWith(today)) && !sessionCreatedUnits.has(unit.id)) {
          notificationService.addNotification('new_stock', unit);
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        notificationService.addNotification('sold', unit);
      }
    }

    prevMap.current = new Map(units.map(u => [u.id, u]));
  }, [units, loaded]);
}
