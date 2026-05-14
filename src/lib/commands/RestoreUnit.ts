import { Command } from './Command';
import { dbService } from '../dbService';

/** Restores a soft-deleted unit by clearing deletedAt. */
export class RestoreUnit implements Command<void> {
  readonly type = 'RestoreUnit';
  constructor(public readonly unitId: string) {}
  payload() { return { unitId: this.unitId }; }
  execute() { return dbService.restore('inventoryUnits', this.unitId); }
}
