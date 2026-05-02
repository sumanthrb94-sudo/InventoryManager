
import { useEffect, useRef } from 'react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';

export function useRealTimeNotifications() {
  const prevUnitsRef = useRef<InventoryUnit[]>([]);
  const isInitialLoad = useRef(true);

  useEffect(() => {
    const unsub = dbService.subscribeToCollection('inventoryUnits', (units) => {
      if (isInitialLoad.current) {
        prevUnitsRef.current = units;
        isInitialLoad.current = false;
        return;
      }

      const prevUnits = prevUnitsRef.current;
      const today = new Date().toISOString().split('T')[0];

      // Detect New Stock
      units.forEach(unit => {
        const isNew = !prevUnits.some(p => p.id === unit.id);
        // Only notify for units added today to avoid old data noise
        const wasAddedToday = unit.dateIn === today || unit.createdAt?.startsWith(today);
        
        if (isNew && wasAddedToday) {
          notificationService.addNotification('new_stock', unit);
        }
      });

      // Detect Sold
      units.forEach(unit => {
        const prevUnit = prevUnits.find(p => p.id === unit.id);
        if (prevUnit && prevUnit.status !== 'sold' && unit.status === 'sold') {
          notificationService.addNotification('sold', unit);
        }
      });

      prevUnitsRef.current = units;
    });

    return unsub;
  }, []);
}
