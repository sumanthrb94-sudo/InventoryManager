import { useInventoryStore } from '../inventoryStore';
import type { InventoryUnit } from '../../types';

/** Live list of soft-deleted units (within the 48 h retention window). */
export function useDeletedUnits(): InventoryUnit[] {
  return useInventoryStore().deletedUnits;
}
