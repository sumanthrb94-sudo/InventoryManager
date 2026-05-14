import { Command } from './Command';
import { dbService } from '../dbService';

export interface ActiveListingPayload {
  id:           string;
  model:        string;
  platform:     string;
  quantity:     number;
  listingUrl?:  string;
  listingId?:   string;
}

/** Upserts an /activeListings row. Quantity must be > 0; use ZeroOutListing otherwise. */
export class UpdateActiveListing implements Command<void> {
  readonly type = 'UpdateActiveListing';
  constructor(public readonly entry: ActiveListingPayload) {}
  payload() {
    return {
      id:       this.entry.id,
      model:    this.entry.model,
      platform: this.entry.platform,
      quantity: this.entry.quantity,
    };
  }
  execute() {
    return dbService.create('activeListings', this.entry.id, this.entry);
  }
}
