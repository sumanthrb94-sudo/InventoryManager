import { useMemo } from 'react';
import { useInventoryStore } from '../inventoryStore';
import type { InventoryUnit } from '../../types';

/** Live list of units currently sellable (status === 'available', not soft-deleted). */
export function useAvailableUnits(): InventoryUnit[] {
  const { units } = useInventoryStore();
  return useMemo(() => units.filter(u => u.status === 'available'), [units]);
}
