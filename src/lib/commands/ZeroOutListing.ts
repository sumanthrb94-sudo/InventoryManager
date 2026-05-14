import { Command } from './Command';
import { dbService } from '../dbService';

/**
 * Removes an /activeListings row when its quantity drops to 0. Hard-delete
 * because the row is a transient counter, not historical data — there's
 * no reason to keep it in the 48 h recovery window.
 */
export class ZeroOutListing implements Command<void> {
  readonly type = 'ZeroOutListing';
  constructor(public readonly listingId: string) {}
  payload() { return { listingId: this.listingId }; }
  execute() { return dbService.hardDelete('activeListings', this.listingId); }
}
