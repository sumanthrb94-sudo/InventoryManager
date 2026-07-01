/**
 * Tests for the SHS deletion service.
 *
 * Mocks Firestore and Firebase auth so we can verify that:
 *   - only admins can delete SHS units / aggregates
 *   - the underlying docs are removed
 *   - a persistent notice is posted to the notice board
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryAggregate, InventoryUnit } from '../../types';

// ── Hoisted mocks ────────────────────────────────────────────────────────────
// vi.mock is hoisted, so any variable the factory uses must also be hoisted
// via vi.hoisted() to avoid temporal dead-zone errors.

const mockAuth = vi.hoisted(() => ({ currentUser: null as { email: string } | null }));

vi.mock('../../lib/firebase', () => ({
  auth: mockAuth,
  isAdmin: (user: { email: string } | null | undefined) =>
    user?.email?.toLowerCase() === 'admin@test.com',
}));

const mockDb = vi.hoisted(() => {
  const collections = new Map<string, Map<string, any>>();
  const col = (name: string) => {
    if (!collections.has(name)) collections.set(name, new Map());
    return collections.get(name)!;
  };
  return { collections, col };
});
const { collections, col } = mockDb;

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
  };
  return { dbService };
});

// Import the SUT after mocks are registered.
import {
  deleteShsUnit,
  deleteShsAggregate,
} from '../../services/shsService';

function clearAll() {
  for (const c of collections.values()) c.clear();
}

const makeUnit = (over: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'unit_test_1',
  imei: '',
  model: 'iPhone XR',
  storage: '64GB',
  colour: 'Black',
  buyPrice: 200,
  status: 'incoming',
  supplierId: 'sup_existing',
  supplierName: 'MHL',
  dateIn: '2026-06-01',
  ownerId: 'shared',
  ...over,
} as InventoryUnit);

const makeAggregate = (over: Partial<InventoryAggregate> = {}): InventoryAggregate => ({
  id: 'agg_test_1',
  model: 'iPhone XR',
  storage: '64GB',
  buyPrice: 200,
  quantityNum: 5,
  quantityText: 'SHS',
  supplierIds: ['sup_existing'],
  sourceRow: 42,
  ownerId: 'shared',
  createdAt: '2026-06-01',
  updatedAt: '2026-06-01',
  ...over,
});

describe('deleteShsUnit', () => {
  beforeEach(() => {
    clearAll();
    mockAuth.currentUser = { email: 'admin@test.com' };
  });

  it('rejects non-admin users', async () => {
    mockAuth.currentUser = { email: 'ops@test.com' };
    col('inventoryUnits').set('u1', makeUnit({ id: 'u1' }));
    const res = await deleteShsUnit(makeUnit({ id: 'u1' }));
    expect(res.ok).toBe(false);
    expect(col('inventoryUnits').has('u1')).toBe(true);
  });

  it('rejects units that are not incoming', async () => {
    const unit = makeUnit({ id: 'u1', status: 'available' });
    col('inventoryUnits').set('u1', unit);
    const res = await deleteShsUnit(unit);
    expect(res.ok).toBe(false);
    expect(col('inventoryUnits').has('u1')).toBe(true);
  });

  it('deletes the incoming unit and posts a notice', async () => {
    const unit = makeUnit({ id: 'u1' });
    col('inventoryUnits').set('u1', unit);
    const res = await deleteShsUnit(unit);
    expect(res.ok).toBe(true);
    expect(col('inventoryUnits').has('u1')).toBe(false);

    const notices = Array.from(col('notices').values());
    expect(notices.length).toBe(1);
    expect(notices[0].content).toContain('SHS stock deleted');
    expect(notices[0].content).toContain('iPhone XR');
    expect(notices[0].content).toContain('MHL');
    expect(notices[0].content).toContain('supplier has no stock');
    expect(notices[0].ownerId).toBe('shared');
  });
});

describe('deleteShsAggregate', () => {
  beforeEach(() => {
    clearAll();
    mockAuth.currentUser = { email: 'admin@test.com' };
  });

  it('rejects non-admin users', async () => {
    mockAuth.currentUser = { email: 'ops@test.com' };
    const agg = makeAggregate();
    col('inventoryAggregates').set(agg.id, agg);
    const res = await deleteShsAggregate(agg);
    expect(res.ok).toBe(false);
    expect(col('inventoryAggregates').has(agg.id)).toBe(true);
  });

  it('rejects non-SHS aggregates', async () => {
    const agg = makeAggregate({ quantityText: 'NO STOCK' });
    col('inventoryAggregates').set(agg.id, agg);
    const res = await deleteShsAggregate(agg);
    expect(res.ok).toBe(false);
    expect(col('inventoryAggregates').has(agg.id)).toBe(true);
  });

  it('deletes the SHS aggregate, its placeholder unit, and posts a notice', async () => {
    const agg = makeAggregate({ supplierIds: ['MHL'] });
    col('inventoryAggregates').set(agg.id, agg);
    const placeholderId = 'shs_iphone_xr_mhl_42';
    col('inventoryUnits').set(placeholderId, { id: placeholderId, status: 'incoming' });

    const res = await deleteShsAggregate(agg);
    expect(res.ok).toBe(true);
    expect(col('inventoryAggregates').has(agg.id)).toBe(false);
    expect(col('inventoryUnits').has(placeholderId)).toBe(false);

    const notices = Array.from(col('notices').values());
    expect(notices.length).toBe(1);
    expect(notices[0].content).toContain('SHS stock deleted');
    expect(notices[0].content).toContain('iPhone XR');
    expect(notices[0].content).toContain('qty 5');
    expect(notices[0].content).toContain('supplier: MHL');
    expect(notices[0].ownerId).toBe('shared');
  });

  it('succeeds even when the synthetic placeholder unit is already gone', async () => {
    const agg = makeAggregate();
    col('inventoryAggregates').set(agg.id, agg);
    const res = await deleteShsAggregate(agg);
    expect(res.ok).toBe(true);
    expect(col('inventoryAggregates').has(agg.id)).toBe(false);
    expect(Array.from(col('notices').values()).length).toBe(1);
  });
});
