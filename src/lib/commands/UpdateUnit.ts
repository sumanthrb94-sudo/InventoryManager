import { Command } from './Command';
import { dbService } from '../dbService';
import type { InventoryUnit } from '../../types';

/** Partial update on an existing inventory unit. */
export class UpdateUnit implements Command<void> {
  readonly type = 'UpdateUnit';
  constructor(
    public readonly unitId: string,
    public readonly patch: Partial<InventoryUnit>,
  ) {}
  payload() {
    return { unitId: this.unitId, fields: Object.keys(this.patch) };
  }
  execute() {
    return dbService.update('inventoryUnits', this.unitId, this.patch);
  }
}
