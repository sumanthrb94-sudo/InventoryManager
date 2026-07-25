/**
 * What a sales report does to SHS stock.
 *
 * Supplier-held stock is recorded in up to three places, only one of
 * which carries an IMEI:
 *
 *   1. a real unit, status 'incoming'      ← has an IMEI, a sale can match it
 *   2. a parser placeholder `shs_*`        ← no IMEI
 *   3. a master-file aggregate (SHS)       ← no IMEI
 *
 * A sale can only ever match (1). Flipping that unit to sold used to be
 * the whole job, which left (2) and (3) counting stock we no longer have:
 * the SHS tile kept showing phones that shipped weeks ago. These tests
 * pin the full clean-up.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryUnit, Sale } from '../../types';

const session = vi.hoisted(() => ({
  currentUser: { email: 'admin@inventorymanager.com', uid: 'admin-1' } as any,
}));

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('../mocks/memoryDb');
  return firestoreMock;
});
vi.mock('../../lib/firebase', async () => ({
  db: { app: { name: '[DEFAULT]' } },
  auth: { get currentUser() { return session.currentUser; } },
  isAdmin: () => true,
}));
vi.mock('../../lib/dbService', async () => {
  const { memoryDbService } = await import('../mocks/memoryDb');
  return { dbService: memoryDbService };
});
vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));

import { all, clearStore, col, seed } from '../mocks/memoryDb';
import { buildPostImportSyncPatches } from '../../services/salesService';
import { reconcileShsAfterFulfilment } from '../../services/inventoryService';

const unit = (over: Partial<InventoryUnit>): InventoryUnit => ({
  id: 'u1',
  model: 'IPHONE 13 PRO',
  storage: '256GB',
  status: 'available',
  buyPrice: 520,
  supplierName: 'CELLHUB TRADING',
  flags: [],
  platformListed: false,
  ownerId: 'shared',
  createdAt: '2026-07-01',
  ...over,
} as InventoryUnit);

const sale = (over: Partial<Sale>): Sale => ({
  id: 's1',
  marketplace: 'AMAZON',
  orderNumber: 'AMZ-1',
  saleDate: '2026-07-20',
  salePrice: 679,
  buyPrice: 520,
  ownerId: 'shared',
  ...over,
} as Sale);

beforeEach(() => clearStore());

describe('a sale that matches a supplier-held unit', () => {
  it('flips it to sold AND keeps its SHS provenance', () => {
    const units = [unit({ id: 'u-shs', imei: '350100000023757', status: 'incoming' })];
    const { unitPatches } = buildPostImportSyncPatches(
      [sale({ imei: '350100000023757' })], units,
    );
    expect(unitPatches[0].data.status).toBe('sold');
    expect(unitPatches[0].data.stockSource).toBe('shs');
  });

  it('reports it as SHS-fulfilled so the caller can clear the trail', () => {
    const units = [
      unit({ id: 'u-shs', imei: '350100000023757', status: 'incoming' }),
      unit({ id: 'u-shelf', imei: '350100000000000', status: 'available' }),
    ];
    const { shsFulfilled } = buildPostImportSyncPatches(
      [sale({ id: 's1', imei: '350100000023757' }),
       sale({ id: 's2', imei: '350100000000000', orderNumber: 'AMZ-2' })],
      units,
    );
    expect(shsFulfilled).toEqual([
      { unitId: 'u-shs', model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' },
    ]);
  });

  it('leaves a shelf unit stamped office', () => {
    const units = [unit({ id: 'u-shelf', imei: '350100000000000', status: 'available' })];
    const { unitPatches, shsFulfilled } = buildPostImportSyncPatches(
      [sale({ imei: '350100000000000' })], units,
    );
    expect(unitPatches[0].data.stockSource).toBe('office');
    expect(shsFulfilled).toEqual([]);
  });

  it('an explicit stockSource still wins', () => {
    const units = [unit({ id: 'u-x', imei: '350100000000000', status: 'available', stockSource: 'shs' })];
    const { unitPatches } = buildPostImportSyncPatches([sale({ imei: '350100000000000' })], units);
    expect(unitPatches[0].data.stockSource).toBe('shs');
  });
});

describe('reconcileShsAfterFulfilment clears what the sale cannot reach', () => {
  it('decrements the master-file aggregate and removes the placeholder', async () => {
    seed('inventoryUnits', [
      { id: 'shs_placeholder_1', model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING', status: 'incoming' },
    ]);
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 3, supplierIds: ['cellhub-trading'] },
    ]);

    const res = await reconcileShsAfterFulfilment({
      model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING', contextImei: '350100000023757',
    });

    expect(res.placeholdersRemoved).toBe(1);
    expect(res.aggregatesDecremented).toBe(1);
    expect(all('inventoryUnits')).toHaveLength(0);
    expect((col('inventoryAggregates')['agg-1'] as any).quantityNum).toBe(2);
    // Still SHS — two are genuinely still held.
    expect((col('inventoryAggregates')['agg-1'] as any).quantityText).toBe('SHS');
  });

  it('marks the aggregate RECEIVED when the last one ships', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 1, supplierIds: ['cellhub-trading'] },
    ]);
    await reconcileShsAfterFulfilment({ model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' });
    const agg = col('inventoryAggregates')['agg-1'] as any;
    expect(agg.quantityNum).toBe(0);
    // Stops counting as supplier-held — this is what clears the SHS tile.
    expect(agg.quantityText).toBe('RECEIVED');
  });

  it('never goes negative when the aggregate is already exhausted', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 0, supplierIds: ['cellhub-trading'] },
    ]);
    await reconcileShsAfterFulfilment({ model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' });
    expect((col('inventoryAggregates')['agg-1'] as any).quantityNum).toBe(0);
  });

  it('leaves another supplier holding the same model alone', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-ours',  model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 2, supplierIds: ['cellhub-trading'] },
      { id: 'agg-other', model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 5, supplierIds: ['phonebox-direct'] },
    ]);
    await reconcileShsAfterFulfilment({ model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' });
    expect((col('inventoryAggregates')['agg-ours'] as any).quantityNum).toBe(1);
    expect((col('inventoryAggregates')['agg-other'] as any).quantityNum).toBe(5);
  });

  it('leaves a different model alone', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 14', quantityText: 'SHS', quantityNum: 4, supplierIds: ['cellhub-trading'] },
    ]);
    await reconcileShsAfterFulfilment({ model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' });
    expect((col('inventoryAggregates')['agg-1'] as any).quantityNum).toBe(4);
  });

  it('ignores a non-SHS aggregate — office rollups are not supplier-held', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 13 PRO', quantityText: '3', quantityNum: 3, supplierIds: ['cellhub-trading'] },
    ]);
    const res = await reconcileShsAfterFulfilment({ model: 'IPHONE 13 PRO', supplierName: 'CELLHUB TRADING' });
    expect(res.aggregatesDecremented).toBe(0);
    expect((col('inventoryAggregates')['agg-1'] as any).quantityNum).toBe(3);
  });

  it('does nothing without a model rather than guessing', async () => {
    seed('inventoryAggregates', [
      { id: 'agg-1', model: 'IPHONE 13 PRO', quantityText: 'SHS', quantityNum: 3, supplierIds: ['cellhub-trading'] },
    ]);
    const res = await reconcileShsAfterFulfilment({ model: '', supplierName: 'CELLHUB TRADING' });
    expect(res).toEqual({ placeholdersRemoved: 0, aggregatesDecremented: 0 });
    expect((col('inventoryAggregates')['agg-1'] as any).quantityNum).toBe(3);
  });
});
