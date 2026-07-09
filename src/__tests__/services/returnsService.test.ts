import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryUnit, Sale } from '../../types';

// Hoisted shared state so it is visible inside vi.mock factories.
const hoisted = vi.hoisted(() => {
  const store: Record<string, Record<string, any>> = {};
  const fakeDb = { app: { name: '[DEFAULT]' } } as any;
  return { store, fakeDb };
});

function getCol(name: string) { return (hoisted.store[name] ??= {}); }
function clearAll() {
  for (const k of Object.keys(hoisted.store)) delete hoisted.store[k];
}

vi.mock('firebase/firestore', () => ({
  doc: (_db: any, collectionName: string, id: string) => ({
    path: `${collectionName}/${id}`,
    id,
    parent: { path: collectionName },
  }),
  runTransaction: async (_db: any, fn: (tx: any) => Promise<any>) => {
    const tx = {
      get: async (ref: any) => {
        const [colName, id] = ref.path.split('/');
        const data = getCol(colName)[id];
        return {
          exists: () => !!data,
          data: () => data,
        };
      },
      update: async (ref: any, data: Record<string, any>) => {
        const [colName, id] = ref.path.split('/');
        const existing = getCol(colName)[id] || {};
        getCol(colName)[id] = { ...existing, ...data, id };
      },
    };
    return fn(tx);
  },
  serverTimestamp: () => '__SERVER_TIMESTAMP__',
}));

vi.mock('../../lib/firebase', () => ({ db: hoisted.fakeDb }));

vi.mock('../../lib/inventoryEvents', () => ({
  logInventoryEvent: vi.fn(async () => {}),
}));

vi.mock('../../lib/dbService', () => ({
  dbService: {
    async create(collectionName: string, id: string, data: any) {
      getCol(collectionName)[id] = { ...data, id };
    },
    async update(collectionName: string, id: string, data: any) {
      const existing = getCol(collectionName)[id] || {};
      getCol(collectionName)[id] = { ...existing, ...data, id };
    },
    async readAll(collectionName: string) {
      return Object.values(getCol(collectionName));
    },
    async querySalesByUnitId(unitId: string) {
      return Object.values(getCol('sales'))
        .filter((s: any) => s.unitId === unitId)
        .sort((a: any, b: any) => (b.saleDate || '').localeCompare(a.saleDate || ''));
    },
    async querySalesByImei(imei: string) {
      const key = imei.trim().toUpperCase();
      return Object.values(getCol('sales'))
        .filter((s: any) => (s.imei || '').trim().toUpperCase() === key)
        .sort((a: any, b: any) => (b.saleDate || '').localeCompare(a.saleDate || ''));
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const { runTransaction } = await import('firebase/firestore');
      return runTransaction(hoisted.fakeDb, fn);
    },
    applyCacheItem(collectionName: string, id: string, data: any) {
      const existing = getCol(collectionName)[id] || {};
      getCol(collectionName)[id] = { ...existing, ...data, id };
    },
  },
}));

import {
  recordReturnQc,
  processReturn,
  quickRepair,
  completeRepair,
} from '../../services/returnsService';

function makeUnit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'u1',
    imei: '12345678901234',
    model: 'iPhone 14 128GB',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Black',
    storage: '128GB',
    buyPrice: 500,
    dateIn: '2026-01-01',
    supplierId: 's1',
    status: 'sold',
    flags: [],
    notes: '',
    platformListed: false,
    salePrice: 700,
    saleDate: '2026-02-01',
    salePlatform: 'AMAZON',
    saleOrderId: 'ORDER-1',
    postageCost: 8,
    ownerId: 'shared',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as InventoryUnit;
}

function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 's1',
    marketplace: 'AMAZON',
    orderNumber: 'ORDER-1',
    imei: '12345678901234',
    unitId: 'u1',
    model: 'iPhone 14 128GB',
    saleDate: '2026-02-01',
    salePrice: 700,
    buyPrice: 500,
    postage: 8,
    postageVat: 1.6,
    postageVatExempt: false,
    quantity: 1,
    supplierId: 's1',
    supplierName: 'Supplier A',
    ownerId: 'shared',
    createdAt: '2026-02-01T00:00:00Z',
    ...overrides,
  } as Sale;
}

/** Seed a doc into the shared transaction + dbService store. */
function seed(collectionName: string, id: string, data: any) {
  getCol(collectionName)[id] = { ...data, id };
}

beforeEach(() => {
  clearAll();
});

describe('recordReturnQc', () => {
  it('records QC intake on a sold unit', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    const res = await recordReturnQc({
      unit: makeUnit(),
      returnDate: '2026-03-01',
      customerComments: 'Screen flicker',
      technicianComments: 'Confirmed display fault',
    });
    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.pendingCrmReview).toBe(true);
    expect(u.customerComments).toBe('Screen flicker');
    expect(u.technicianComments).toBe('Confirmed display fault');
    expect(u.returnDate).toBe('2026-03-01');
  });

  it('rejects missing return date', async () => {
    const res = await recordReturnQc({
      unit: makeUnit(),
      returnDate: '',
      customerComments: 'Screen flicker',
      technicianComments: 'Confirmed display fault',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_date');
  });
});

describe('processReturn', () => {
  it('refund back to inventory clears sale fields and voids the linked sale', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('sales', 's1', makeSale());

    const res = await processReturn({
      unit: makeUnit(),
      returnType: 'returned_to_inventory',
      returnDate: '2026-03-01',
      reason: 'Customer returned — faulty screen',
      outcome: 'refund',
      customerComments: 'Screen flicker',
      technicianComments: 'Confirmed fault',
    });
    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.status).toBe('available');
    expect(u.returnType).toBe('returned_to_inventory');
    expect(u.returnOutcome).toBe('refund');
    expect(u.salePrice).toBeNull();
    expect(u.saleOrderId).toBeNull();
    expect(u.returnLegCost).toBeCloseTo(9.6, 2); // 8 + 1.6 VAT

    const s = getCol('sales').s1;
    expect(s.voidedAt).toBe('2026-03-01');
    expect(s.voidOutcome).toBe('refund');
  });

  it('replacement flips the replacement unit to sold and cross-links', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('inventoryUnits', 'u2', makeUnit({ id: 'u2', imei: '99999999999999', status: 'available', salePrice: undefined, saleDate: undefined, salePlatform: undefined, saleOrderId: undefined, postageCost: undefined }));
    seed('sales', 's1', makeSale());

    const replacementUnit = getCol('inventoryUnits').u2;
    const res = await processReturn({
      unit: makeUnit(),
      returnType: 'returned_to_inventory',
      returnDate: '2026-03-01',
      reason: 'Dead pixel — replacement sent',
      outcome: 'replacement',
      replacementUnit,
    });

    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.replacedByUnitId).toBe('u2');

    const r = getCol('inventoryUnits').u2;
    expect(r.status).toBe('sold');
    expect(r.replacementForUnitId).toBe('u1');
    expect(r.salePrice).toBe(700);

    const s = getCol('sales').s1;
    expect(s.voidOutcome).toBe('replacement');
  });

  it('repair route stamps voidOutcome=repair on the linked sale', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('sales', 's1', makeSale());

    const res = await processReturn({
      unit: makeUnit(),
      returnType: 'repair',
      returnDate: '2026-03-01',
      reason: 'Needs repair',
      outcome: 'refund', // ignored for repair
    });

    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.status).toBe('returned');
    expect(u.returnType).toBe('repair');
    expect(u.returnOutcome).toBeNull();

    const s = getCol('sales').s1;
    expect(s.voidOutcome).toBe('repair');
  });

  it('rejects when the unit is no longer sold', async () => {
    seed('inventoryUnits', 'u1', makeUnit({ status: 'available' }));
    const res = await processReturn({
      unit: makeUnit({ status: 'available' }),
      returnType: 'returned_to_inventory',
      returnDate: '2026-03-01',
      reason: 'Test',
      outcome: 'refund',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unit_not_sold');
  });

  it('rejects when replacement unit is no longer available', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('inventoryUnits', 'u2', makeUnit({ id: 'u2', imei: '99999999999999', status: 'sold' }));
    seed('sales', 's1', makeSale());

    const res = await processReturn({
      unit: makeUnit(),
      returnType: 'returned_to_inventory',
      returnDate: '2026-03-01',
      reason: 'Test',
      outcome: 'replacement',
      replacementUnit: getCol('inventoryUnits').u2,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('replacement_not_available');
  });

  it('finds linked sale by IMEI when unitId is missing', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('sales', 's1', makeSale({ unitId: '', imei: '12345678901234' }));

    const res = await processReturn({
      unit: makeUnit(),
      returnType: 'returned_to_inventory',
      returnDate: '2026-03-01',
      reason: 'Returned',
      outcome: 'refund',
    });

    expect(res.ok).toBe(true);
    const s = getCol('sales').s1;
    expect(s.voidedAt).toBe('2026-03-01');
  });
});

describe('quickRepair', () => {
  it('voids the linked sale and sets unit to repair', async () => {
    seed('inventoryUnits', 'u1', makeUnit());
    seed('sales', 's1', makeSale());

    const res = await quickRepair({ unit: makeUnit(), returnDate: '2026-03-01' });

    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.status).toBe('returned');
    expect(u.returnType).toBe('repair');

    const s = getCol('sales').s1;
    expect(s.voidOutcome).toBe('repair');
  });
});

describe('completeRepair', () => {
  it('flips repaired unit back to available and adds repaired_unit flag', async () => {
    seed('inventoryUnits', 'u1', makeUnit({ status: 'returned', returnType: 'repair' }));

    const res = await completeRepair({ unit: makeUnit({ status: 'returned', returnType: 'repair' }) });

    expect(res.ok).toBe(true);
    const u = getCol('inventoryUnits').u1;
    expect(u.status).toBe('available');
    expect(u.returnType).toBe('returned_to_inventory');
    expect(u.flags).toContain('repaired_unit');
  });
});
