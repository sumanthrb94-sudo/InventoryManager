import { useMemo } from 'react';
import { useInventoryStore } from '../inventoryStore';
import { SOFT_DELETE_RETENTION_MS } from '../dbService';
import type { InventoryUnit } from '../../types';

/**
 * Live list of units soft-deleted in the last 48 h (the recovery window).
 * Sorted most-recently-deleted first.
 */
export function useRecentlyRemoved(): InventoryUnit[] {
  const { deletedUnits } = useInventoryStore();
  return useMemo(() => {
    const cutoff = Date.now() - SOFT_DELETE_RETENTION_MS;
    return (deletedUnits || [])
      .filter(u => u.deletedAt && new Date(u.deletedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime());
  }, [deletedUnits]);
}
