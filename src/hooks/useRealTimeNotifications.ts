import { useEffect, useRef } from 'react';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';
import { useInventoryStore } from '../lib/inventoryStore';

export function useRealTimeNotifications() {
  const { units }     = useInventoryStore();
  const prevRef       = useRef<InventoryUnit[]>([]);
  const initialLoad   = useRef(true);

  useEffect(() => {
    if (initialLoad.current) {
      prevRef.current = units;
      initialLoad.current = false;
      return;
    }

    const prev  = prevRef.current;
    const today = new Date().toISOString().split('T')[0];

    units.forEach(unit => {
      const isNew = !prev.some(p => p.id === unit.id);
      const addedToday = unit.dateIn === today || unit.createdAt?.startsWith(today);
      if (isNew && addedToday) notificationService.addNotification('new_stock', unit);
    });

    units.forEach(unit => {
      const p = prev.find(p => p.id === unit.id);
      if (p && p.status !== 'sold' && unit.status === 'sold') {
        notificationService.addNotification('sold', unit);
      }
    });

    prevRef.current = units;
  }, [units]);
}
