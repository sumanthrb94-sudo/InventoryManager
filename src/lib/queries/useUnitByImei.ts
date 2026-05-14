import { useMemo } from 'react';
import { useInventoryStore } from '../inventoryStore';
import type { InventoryUnit } from '../../types';

/** First live unit matching the given IMEI, or undefined. Ignores soft-deleted. */
export function useUnitByImei(imei: string | undefined): InventoryUnit | undefined {
  const { units } = useInventoryStore();
  return useMemo(
    () => (imei ? units.find(u => u.imei === imei) : undefined),
    [units, imei],
  );
}
