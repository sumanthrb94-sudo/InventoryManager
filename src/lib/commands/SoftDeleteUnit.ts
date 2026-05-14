import { Command } from './Command';
import { dbService } from '../dbService';

/** Soft-deletes a unit (sets deletedAt). 48 h recovery window applies. */
export class SoftDeleteUnit implements Command<void> {
  readonly type = 'SoftDeleteUnit';
  constructor(public readonly unitId: string) {}
  payload() { return { unitId: this.unitId }; }
  execute() { return dbService.delete('inventoryUnits', this.unitId); }
}
