import { Command } from './Command';
import { dbService } from '../dbService';
import type { InventoryUnit, ReturnCategory } from '../../types';

/**
 * Applies a return decision to a unit:
 *   - returned_to_inventory  -> status: 'available', sale fields cleared
 *   - repair                 -> status: 'returned'
 *   - returned_to_supplier   -> SOFT delete the unit (48 h recovery)
 */
export class ProcessReturn implements Command<void> {
  readonly type = 'ProcessReturn';
  constructor(
    public readonly unitId: string,
    public readonly returnType: ReturnCategory,
    public readonly returnDate: string,
    public readonly reason: string,
  ) {}
  payload() {
    return {
      unitId:     this.unitId,
      returnType: this.returnType,
      returnDate: this.returnDate,
    };
  }
  async execute() {
    if (this.returnType === 'returned_to_supplier') {
      await dbService.delete('inventoryUnits', this.unitId);
      return;
    }
    const newStatus: InventoryUnit['status'] =
      this.returnType === 'returned_to_inventory' ? 'available' : 'returned';
    await dbService.update('inventoryUnits', this.unitId, {
      status:         newStatus,
      returnType:     this.returnType,
      returnDate:     this.returnDate,
      returnReason:   this.reason.trim(),
      // Always clear sale data on any return — prevents ghost sale records.
      salePrice:    null,
      saleDate:     null,
      salePlatform: null,
      saleOrderId:  null,
      postageCost:  null,
      ...(this.returnType === 'returned_to_inventory'
        ? { platformListed: false, listingSites: [] }
        : {}),
    });
  }
}
