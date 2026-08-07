/**
 * No matching stock means a refund, and a refund is two legs.
 *
 * THE RULE
 *
 * A replacement can only be offered when a like-for-like handset is on the
 * shelf. With nothing to ship, the customer gets their money back instead —
 * and that return costs two carriage legs, not three, because the third leg
 * (the replacement going out) never happens.
 *
 * WHY IT IS WORTH PINNING
 *
 * The app already enforces this in three places, which is exactly the kind of
 * arrangement that quietly loses a layer during a refactor:
 *
 *   1. the eligibility filter — only `available` units of the same
 *      brand + model + storage are offered
 *   2. the modal — will not finalise a replacement with nothing selected
 *   3. the service — rejects `missing_replacement` before it writes anything
 *
 * Layers 1 and 2 are UI. This file covers layer 3, the one that is load-
 * bearing: if the service ever accepted a replacement with no unit attached,
 * a return would be recorded as a three-leg replacement with no handset
 * behind it, and the customer would be owed either a phone or a refund that
 * the books said had already been settled.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryUnit } from '../../types';

const hoisted = vi.hoisted(() => {
  const store: Record<string, Record<string, any>> = {};
  return { store, fakeDb: { app: { name: '[DEFAULT]' } } as any };
});
function getCol(name: string) { return (hoisted.store[name] ??= {}); }

vi.mock('firebase/firestore', () => ({
  doc: (_db: any, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`, id, parent: { path: collectionName },
  }),
  runTransaction: async (_db: any, fn: (tx: any) => Promise<any>) => fn({
    get: async (ref: any) => {
      const [c, id] = ref.path.split('/');
      const data = getCol(c)[id];
      return { exists: () => !!data, data: () => data };
    },
    update: async (ref: any, data: Record<string, any>) => {
      const [c, id] = ref.path.split('/');
      getCol(c)[id] = { ...(getCol(c)[id] || {}), ...data, id };
    },
  }),
  serverTimestamp: () => '__TS__',
}));
vi.mock('../../lib/firebase', () => ({ db: hoisted.fakeDb }));
vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));
vi.mock('../../lib/dbService', () => ({
  dbService: {
    async update(c: string, id: string, data: any) {
      getCol(c)[id] = { ...(getCol(c)[id] || {}), ...data, id };
    },
    async querySalesByUnitId(unitId: string) {
      return Object.values(getCol('sales')).filter((s: any) => s.unitId === unitId);
    },
    async querySalesByImei(imei: string) {
      const k = imei.trim().toUpperCase();
      return Object.values(getCol('sales')).filter((s: any) => (s.imei || '').trim().toUpperCase() === k);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const { runTransaction } = await import('firebase/firestore');
      return runTransaction(hoisted.fakeDb, fn);
    },
    applyCacheItem(c: string, id: string, data: any) {
      getCol(c)[id] = { ...(getCol(c)[id] || {}), ...data, id };
    },
  },
}));

import { processReturn } from '../../services/returnsService';
import { returnCostFor } from '../../lib/returnLoss';

const SOLD_UNIT: InventoryUnit = {
  id: 'u1', imei: '350000000000001', model: 'iPhone 13', brand: 'Apple',
  category: 'iPhone', colour: 'Black', storage: '128GB', buyPrice: 300,
  dateIn: '2026-06-01', supplierId: 's1', status: 'sold', flags: [], notes: '',
  platformListed: false, salePrice: 400, saleDate: '2026-08-01',
  salePlatform: 'AMAZON', saleOrderId: 'A1', postageCost: 8,
} as InventoryUnit;

beforeEach(() => {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
  getCol('inventoryUnits')['u1'] = { ...SOLD_UNIT };
  getCol('sales')['s1'] = {
    id: 's1', unitId: 'u1', imei: SOLD_UNIT.imei, marketplace: 'AMAZON',
    salePrice: 400, saleDate: '2026-08-01', postage: 8, postageVat: 1.6,
  };
});

const base = {
  unit: SOLD_UNIT,
  returnType: 'returned_to_inventory' as const,
  returnDate: '2026-08-07',
  reason: 'Faulty screen',
};

describe('a replacement with no handset to ship', () => {
  it('is refused rather than recorded', async () => {
    const res = await processReturn({ ...base, outcome: 'replacement' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_replacement');
  });

  it('writes nothing at all — the unit is left for the operator to redo', async () => {
    // A partial write here would be worse than the refusal: the sale voided
    // with the unit still marked sold, or vice versa.
    await processReturn({ ...base, outcome: 'replacement' });
    expect(getCol('inventoryUnits')['u1'].status).toBe('sold');
    expect(getCol('inventoryUnits')['u1'].returnType).toBeUndefined();
    expect(getCol('sales')['s1'].voidedAt).toBeUndefined();
  });
});

describe('taking it as a refund instead', () => {
  it('processes, and reverses the revenue', async () => {
    const res = await processReturn({ ...base, outcome: 'refund' });
    expect(res.ok).toBe(true);
    const sale = getCol('sales')['s1'];
    expect(sale.voidedAt).toBe('2026-08-07');
    expect(sale.voidOutcome).toBe('refund');
    expect(sale.customerRefunded).toBe(true);
  });

  it('costs TWO legs, not three — the replacement leg never happened', async () => {
    await processReturn({ ...base, outcome: 'refund' });
    const returned = getCol('inventoryUnits')['u1'] as InventoryUnit;
    const cost = returnCostFor(returned, getCol('sales')['s1'] as any);

    // Leg = postage 8 + P.VAT 1.60 = 9.60, snapshotted at return time.
    expect(returned.returnLegCost).toBeCloseTo(9.6, 2);
    expect(cost.postage).toBeCloseTo(19.2, 2);
    expect(cost.total).toBeCloseTo(19.2, 2);
    expect(cost.gaps).toEqual([]);
  });

  it('is exactly one leg cheaper than the replacement would have been', async () => {
    await processReturn({ ...base, outcome: 'refund' });
    const returned = getCol('inventoryUnits')['u1'] as InventoryUnit;
    const asRefund = returnCostFor(returned, getCol('sales')['s1'] as any);
    const asReplacement = returnCostFor(
      { ...returned, returnOutcome: 'replacement' } as InventoryUnit,
      { ...getCol('sales')['s1'], voidOutcome: 'replacement' } as any,
    );
    expect(asReplacement.total - asRefund.total).toBeCloseTo(9.6, 2);
  });

  it('puts the unit back on the shelf', async () => {
    await processReturn({ ...base, outcome: 'refund' });
    expect(getCol('inventoryUnits')['u1'].status).toBe('available');
    expect(getCol('inventoryUnits')['u1'].returnOutcome).toBe('refund');
  });

  it('records no replacement link, since none was shipped', async () => {
    await processReturn({ ...base, outcome: 'refund' });
    const u = getCol('inventoryUnits')['u1'];
    expect(u.replacedByUnitId).toBeUndefined();
    expect(u.replacementUnitCost).toBeUndefined();
  });
});
