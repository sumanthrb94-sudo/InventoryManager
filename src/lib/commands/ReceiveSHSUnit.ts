import { Command } from './Command';
import { dbService } from '../dbService';
import type { InventoryUnit } from '../../types';

/**
 * Converts a pending SHS unit into one or more received units. The
 * caller has already produced the received unit records (with real
 * IMEIs). This command:
 *   1. Writes the received unit(s).
 *   2. Hard-deletes the original pending placeholder.
 *
 * Hard-delete (not soft) because this is a state transition, not a
 * user-initiated removal — the placeholder should not show up in the
 * Recently Removed recovery list.
 */
export class ReceiveSHSUnit implements Command<void> {
  readonly type = 'ReceiveSHSUnit';
  constructor(
    public readonly pendingUnitId: string,
    public readonly receivedUnits: InventoryUnit[],
  ) {}
  payload() {
    return {
      pendingUnitId:     this.pendingUnitId,
      receivedUnitIds:   this.receivedUnits.map(u => u.id),
      receivedUnitCount: this.receivedUnits.length,
    };
  }
  async execute() {
    for (const u of this.receivedUnits) {
      await dbService.create('inventoryUnits', u.id, u);
    }
    await dbService.hardDelete('inventoryUnits', this.pendingUnitId);
  }
}
