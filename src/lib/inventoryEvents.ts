import { dbService } from './dbService';
import { InventoryEvent } from '../types';

export async function logInventoryEvent(event: Omit<InventoryEvent, 'id' | 'createdAt' | 'ownerId'> & { ownerId?: string }) {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await dbService.create('inventoryEvents', id, {
    ...event,
    ownerId: event.ownerId || 'shared',
  });
}
