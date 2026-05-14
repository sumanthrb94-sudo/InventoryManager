import { Command } from './Command';
import { dbService } from '../dbService';

/**
 * Hard-deletes a unit. Use only for state transitions (e.g. converting a
 * pending SHS to received) and admin/reset flows — user-initiated deletes
 * should go through SoftDeleteUnit so the 48 h recovery list catches them.
 */
export class HardDeleteUnit implements Command<void> {
  readonly type = 'HardDeleteUnit';
  constructor(
    public readonly unitId: string,
    public readonly reason: string,
  ) {}
  payload() { return { unitId: this.unitId, reason: this.reason }; }
  execute() { return dbService.hardDelete('inventoryUnits', this.unitId); }
}
