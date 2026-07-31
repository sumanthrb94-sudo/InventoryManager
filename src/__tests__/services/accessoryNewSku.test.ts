/**
 * Service-layer contract for accessory intake: `upsertAccessoryStock`
 * itself is deliberately ungated — it creates or tops up a pool for any
 * non-empty SKU, and never consults the `models` device catalog.
 *
 * That is the SAME shape as devices: `addUnitManual` doesn't check `models`
 * either. For both, the "you may only pick something that already exists
 * unless you're an admin" gate lives in the UI layer — AccessoryComboBox
 * for accessories (see accessoryIntakeGating.test.tsx), DeviceComboBox for
 * devices (see deviceCatalogGating.test.tsx). These tests pin the service's
 * unconditional behaviour so a future change to that layer is a deliberate
 * decision rather than an accident.
 *
 * Single unit and bulk (higher quantity on the same pooled doc) behave
 * identically here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const collections: Record<string, Map<string, any>> = {};
function col(name: string): Map<string, any> {
  return (collections[name] ??= new Map());
}

vi.mock('../../lib/dbService', () => {
  const dbService = {
    async create(collectionName: string, id: string, data: any) {
      col(collectionName).set(id, { ...data, id });
    },
    async update(collectionName: string, id: string, data: any) {
      const existing = col(collectionName).get(id);
      col(collectionName).set(id, { ...(existing ?? {}), ...data, id });
    },
    async delete(collectionName: string, id: string) {
      col(collectionName).delete(id);
    },
    async readAll(collectionName: string) {
      return Array.from(col(collectionName).values());
    },
    applyCacheItem(collectionName: string, id: string, data: any) {
      const existing = col(collectionName).get(id);
      col(collectionName).set(id, { ...(existing ?? {}), ...data, id });
    },
  };
  return { dbService };
});

import { upsertAccessoryStock } from '../../services/inventoryService';

function clearAll() {
  for (const name of Object.keys(collections)) collections[name].clear();
}

beforeEach(() => {
  clearAll();
});

describe('new accessory SKU — service layer is ungated (the gate lives in AccessoryComboBox)', () => {
  it('single unit: a never-before-seen SKU is created immediately, with zero `models` collection interaction', async () => {
    const r = await upsertAccessoryStock({
      sku: 'NEW-ACC-SKU-1', name: 'Brand New Accessory', quantity: 1, buyPrice: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('new_acc_sku_1');
    expect(r.quantity).toBe(1);

    // No admin catalog exists or is consulted for accessories — the
    // `models` collection (the device catalog) is never touched.
    expect(col('models').size).toBe(0);
    expect(col('accessoryStock').get('new_acc_sku_1')?.sku).toBe('NEW-ACC-SKU-1');
  });

  it('bulk: a never-before-seen SKU added at a high quantity behaves identically — one pooled doc, still zero catalog interaction', async () => {
    const r = await upsertAccessoryStock({
      sku: 'NEW-ACC-SKU-2', name: 'Brand New Accessory (Bulk)', quantity: 25, buyPrice: 5,
    });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(25);

    expect(col('models').size).toBe(0);
    expect(col('accessoryStock').size).toBe(1); // one pooled doc, not 25 individual records
    expect(col('accessoryStock').get('new_acc_sku_2')?.totalReceived).toBe(25);
  });

  it('a further top-up of the same brand-new SKU still never touches the catalog', async () => {
    await upsertAccessoryStock({ sku: 'NEW-ACC-SKU-3', name: 'Brand New Accessory', quantity: 10, buyPrice: 5 });
    const r = await upsertAccessoryStock({ sku: 'NEW-ACC-SKU-3', name: 'Brand New Accessory', quantity: 5, buyPrice: 5 });
    expect(r.ok).toBe(true);
    expect(r.quantity).toBe(15);
    expect(col('models').size).toBe(0);
  });
});
