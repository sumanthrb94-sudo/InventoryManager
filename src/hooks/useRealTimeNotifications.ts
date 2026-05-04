import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

export function useRealTimeNotifications() {
  const { units }   = useInventoryStore();
  // Store previous state as a Map for O(n) lookup instead of O(n²) forEach+find
  const prevMap     = useRef<Map<string, InventoryUnit>>(new Map());
  const initialLoad = useRef(true);

  useEffect(() => {
    // Skip the first delivery — it's the full initial dataset, not a change
    if (initialLoad.current) {
      prevMap.current = new Map(units.map(u => [u.id, u]));
      initialLoad.current = false;
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const prev  = prevMap.current;

    for (const unit of units) {
      const p = prev.get(unit.id);
      if (!p) {
        // Brand-new unit — only notify if added today (ignore historical seed)
        if (unit.dateIn === today || unit.createdAt?.startsWith(today)) {
          notificationService.addNotification('new_stock', unit);
        }
      } else if (p.status !== 'sold' && unit.status === 'sold') {
        notificationService.addNotification('sold', unit);
      }
    }

    // Rebuild map for next diff
    prevMap.current = new Map(units.map(u => [u.id, u]));
  }, [units]);
}
