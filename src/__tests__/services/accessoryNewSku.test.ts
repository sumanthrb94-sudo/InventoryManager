/**
 * Proves accessories have no model-catalog concept at all: a genuinely
 * brand-new SKU (never seen in `accessoryStock`, and there is no admin
 * `models`-style catalog for accessories to begin with) is created
 * immediately by `upsertAccessoryStock` — no admin gate, no "+Add" step,
 * no interaction with the `models` collection whatsoever. Single unit and
 * bulk (higher quantity on the same pooled doc) behave identically.
 *
 * Contrast with office/SHS device stock (see deviceCatalogGating.test.tsx),
 * where a brand-new model IS gated behind an admin-only catalog-creation
 * step. Accessories bypass that gate entirely, by original design.
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

describe('new accessory SKU — no catalog gate (contrast with office/SHS device stock)', () => {
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
