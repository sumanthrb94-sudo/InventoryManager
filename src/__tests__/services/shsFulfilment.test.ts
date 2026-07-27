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

/**
 * Supplier ships direct, and the holding had no IMEI.
 *
 * This is the ordinary case, not an edge one. SHS is stock the supplier has
 * not shipped — there is no handset in anyone's hand, so the holding carries
 * no IMEI. When the supplier ships straight to the customer, the sale arrives
 * with an IMEI we have never seen.
 *
 * Matching by IMEI therefore finds nothing, and before this the holding sat
 * "on order" forever while the phone was already gone: SHS stock never
 * dropped, and the master row kept counting stock we no longer had.
 */
describe('an IMEI-less holding fulfilled by a direct shipment', () => {
  const holding = (over: Partial<InventoryUnit> = {}) => ({
    id: 'manual_shs_imp_1', imei: '', model: 'IPHONE 14', rawModel: 'IPHONE 14',
    status: 'incoming', buyPrice: 480, supplierName: 'NORTHSIDE STOCK',
    dateIn: '2026-07-20', ...over,
  } as unknown as InventoryUnit);

  const directSale = (over: Partial<Sale> = {}) => ({
    id: 'AMAZON__AMA-SHS-1__350190000007777',
    marketplace: 'AMAZON', orderNumber: 'AMA-SHS-1',
    imei: '350190000007777',            // never seen before
    model: 'IPHONE 14', supplierName: 'NORTHSIDE STOCK',
    saleDate: '2026-07-24', buyPrice: 480, salePrice: 624, postage: 8,
    ...over,
  } as unknown as Sale);

  it('matches the holding on model + supplier when the IMEI is unknown', () => {
    const out = buildPostImportSyncPatches([directSale()], [holding()]);
    expect(out.unitPatches).toHaveLength(1);
    expect(out.unitPatches[0].id).toBe('manual_shs_imp_1');
    expect(out.unitPatches[0].data.status).toBe('sold');
  });

  it('records it as an SHS fulfilment so the master row gets closed', () => {
    const out = buildPostImportSyncPatches([directSale()], [holding()]);
    expect(out.shsFulfilled).toHaveLength(1);
    expect(out.shsFulfilled[0]).toMatchObject({
      model: 'IPHONE 14', supplierName: 'NORTHSIDE STOCK',
    });
  });

  it('keeps the sale tagged as SHS revenue, not office', () => {
    const out = buildPostImportSyncPatches([directSale()], [holding()]);
    expect(out.unitPatches[0].data.stockSource).toBe('shs');
  });

  it('learns the IMEI the supplier actually shipped', () => {
    // The one moment it becomes knowable. Without this the unit stays
    // permanently unidentifiable — no returns, no warranty, no history.
    const out = buildPostImportSyncPatches([directSale()], [holding()]);
    expect(out.unitPatches[0].data.imei).toBe('350190000007777');
  });

  it('consumes ONE holding per sale, not the whole line', () => {
    // Ten of the same model from one supplier is a normal holding line.
    const holdings = Array.from({ length: 3 }, (_, i) => holding({ id: `manual_shs_imp_${i}` }));
    const out = buildPostImportSyncPatches([directSale()], holdings);
    expect(out.unitPatches).toHaveLength(1);
    expect(out.shsFulfilled).toHaveLength(1);
  });

  it('fulfils one holding per sale across several sales', () => {
    const holdings = Array.from({ length: 3 }, (_, i) => holding({ id: `manual_shs_imp_${i}` }));
    const sales = Array.from({ length: 2 }, (_, i) => directSale({
      id: `AMAZON__AMA-SHS-${i}__35019000000777${i}`,
      orderNumber: `AMA-SHS-${i}`,
      imei: `35019000000777${i}`,
    }));
    const out = buildPostImportSyncPatches(sales, holdings);
    expect(out.unitPatches).toHaveLength(2);
    expect(new Set(out.unitPatches.map(p => p.id)).size).toBe(2);
  });

  it('does not let an ordinary office sale consume a holding', () => {
    // IMEI match wins; the fallback only opens when nothing matched.
    const office = {
      id: 'unit-office', imei: '350100000000001', model: 'IPHONE 14',
      rawModel: 'IPHONE 14', status: 'available', buyPrice: 400,
      supplierName: 'NORTHSIDE STOCK', dateIn: '2026-07-01',
    } as unknown as InventoryUnit;
    const out = buildPostImportSyncPatches(
      [directSale({ imei: '350100000000001' })],
      [office, holding()],
    );
    expect(out.unitPatches).toHaveLength(1);
    expect(out.unitPatches[0].id).toBe('unit-office');
    expect(out.shsFulfilled).toEqual([]);
  });

  it('leaves the holding alone when model or supplier differ', () => {
    const out = buildPostImportSyncPatches(
      [directSale({ model: 'IPHONE 15' })],
      [holding()],
    );
    expect(out.unitPatches).toEqual([]);
    expect(out.shsFulfilled).toEqual([]);
  });
});

describe('two sales sharing one IMEI in the same import (barcode typo, or a genuine cross-listing sold twice)', () => {
  it('the CHRONOLOGICALLY LATEST sale decides the unit\'s final sold-state, not whichever sheet the marketplace happens to sort into last', () => {
    const u = unit({ id: 'u-dup', imei: '350190000009999', status: 'available' });
    // TEMU is processed after AMAZON in every combined-workbook import, but
    // its sale happened FIRST — the earlier fixed-order code would have let
    // TEMU (last in array order) win regardless of date.
    const earlierSaleProcessedLast = sale({
      id: 'TEMU__T-1__350190000009999', marketplace: 'TEMU', orderNumber: 'T-1',
      imei: '350190000009999', saleDate: '2026-07-01', salePrice: 500,
    });
    const laterSaleProcessedFirst = sale({
      id: 'AMAZON__A-1__350190000009999', marketplace: 'AMAZON', orderNumber: 'A-1',
      imei: '350190000009999', saleDate: '2026-07-20', salePrice: 679,
    });
    const out = buildPostImportSyncPatches([laterSaleProcessedFirst, earlierSaleProcessedLast], [u]);

    // Both sales are still linked to the unit for audit-trail purposes.
    expect(out.salePatches).toHaveLength(2);
    expect(out.salePatches.every(p => p.data.unitId === 'u-dup')).toBe(true);

    // But only ONE unit patch — the later sale's data — decides the unit.
    expect(out.unitPatches).toHaveLength(1);
    expect(out.unitPatches[0].data.saleDate).toBe('2026-07-20');
    expect(out.unitPatches[0].data.salePrice).toBe(679);
    expect(out.unitPatches[0].data.saleOrderId).toBe('A-1');
  });

  it('order in the input array does not matter — same result either way round', () => {
    const u = unit({ id: 'u-dup2', imei: '350190000008888', status: 'available' });
    const early = sale({ id: 'A__1__350190000008888', orderNumber: '1', imei: '350190000008888', saleDate: '2026-06-01', salePrice: 100 });
    const late = sale({ id: 'A__2__350190000008888', orderNumber: '2', imei: '350190000008888', saleDate: '2026-07-01', salePrice: 200 });

    const forward = buildPostImportSyncPatches([early, late], [u]);
    const reversed = buildPostImportSyncPatches([late, early], [u]);

    expect(forward.unitPatches[0].data.saleOrderId).toBe('2');
    expect(reversed.unitPatches[0].data.saleOrderId).toBe('2');
  });
});
