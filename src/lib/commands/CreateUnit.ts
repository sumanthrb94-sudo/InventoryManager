import { Command } from './Command';
import { dbService } from '../dbService';
import type { InventoryUnit } from '../../types';

/** Creates a new inventory unit. Forces `deletedAt: null` (see dbService.create). */
export class CreateUnit implements Command<void> {
  readonly type = 'CreateUnit';
  constructor(public readonly unit: InventoryUnit) {}
  payload() {
    // Don't log the whole unit — pick the identifying fields.
    return {
      id:         this.unit.id,
      imei:       this.unit.imei,
      model:      this.unit.model,
      status:     this.unit.status,
      supplierId: this.unit.supplierId,
      buyPrice:   this.unit.buyPrice,
    };
  }
  execute() {
    return dbService.create('inventoryUnits', this.unit.id, this.unit);
  }
}
