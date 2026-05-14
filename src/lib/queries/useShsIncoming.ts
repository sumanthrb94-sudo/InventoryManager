import { useMemo } from 'react';
import { useInventoryStore } from '../inventoryStore';
import type { InventoryUnit } from '../../types';

/** Pending SHS units (status === 'incoming'), sorted newest dateIn first. */
export function useShsIncoming(): InventoryUnit[] {
  const { units } = useInventoryStore();
  return useMemo(
    () => units
      .filter(u => u.status === 'incoming')
      .sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')),
    [units],
  );
}
