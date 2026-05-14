import { Command } from './Command';
import { dedupeInventoryUnitsByImei } from '../inventoryMaintenance';

/**
 * Removes duplicate inventory units by IMEI, keeping the newest. Hard-
 * deletes (real duplicates aren't recoverable data) — this is delegated
 * to inventoryMaintenance.dedupeInventoryUnitsByImei which already does
 * exactly that.
 */
export class DedupeUnits implements Command<{ removed: number }> {
  readonly type = 'DedupeUnits';
  payload() { return {}; }
  execute() { return dedupeInventoryUnitsByImei(); }
}
