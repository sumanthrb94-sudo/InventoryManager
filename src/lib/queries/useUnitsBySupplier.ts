import { useMemo } from 'react';
import { useInventoryStore } from '../inventoryStore';
import type { InventoryUnit } from '../../types';

/** All live units (any status) for a given supplier. */
export function useUnitsBySupplier(supplierId: string | undefined): InventoryUnit[] {
  const { units } = useInventoryStore();
  return useMemo(
    () => (supplierId ? units.filter(u => u.supplierId === supplierId) : []),
    [units, supplierId],
  );
}
