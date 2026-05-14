import { Command } from './Command';
import { logSHSRemoval, type SHSRemovalLogEntry } from '../shsRemovalLog';

type SHSRemovalInput = Omit<SHSRemovalLogEntry, 'id' | 'removedAt' | 'removedBy'> & {
  removedAt?: string;
};

/**
 * Writes a /shsRemovals row consumed by StockTickerBoard. Independent
 * from the soft-delete on the inventory unit itself — that's a separate
 * command. The audit trail captures *who* did the removal.
 */
export class LogSHSRemoval implements Command<void> {
  readonly type = 'LogSHSRemoval';
  constructor(public readonly entry: SHSRemovalInput) {}
  payload() {
    return {
      model:      this.entry.model,
      quantity:   this.entry.quantity,
      supplierId: this.entry.supplierId,
    };
  }
  async execute() {
    await logSHSRemoval(this.entry);
  }
}
