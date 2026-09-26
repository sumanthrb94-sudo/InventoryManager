import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryUnit } from '../../types';

const session = vi.hoisted(() => ({
  currentUser: { email: 'admin@inventorymanager.com', uid: 'admin-1' } as { email: string; uid: string } | null,
}));

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('../mocks/memoryDb');
  return firestoreMock;
});

vi.mock('../../lib/firebase', async () => {
  const ADMIN_EMAILS = new Set(['admin@inventorymanager.com', 'sumanthbolla97@gmail.com']);
  return {
    db: { app: { name: '[DEFAULT]' } },
    auth: { get currentUser() { return session.currentUser; } },
    isAdmin: (u: any) => !!u?.email && ADMIN_EMAILS.has(String(u.email).toLowerCase().trim()),
  };
});

vi.mock('../../lib/dbService', async () => {
  const { memoryDbService } = await import('../mocks/memoryDb');
  return { dbService: memoryDbService };
});

vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));

import { all, clearStore, seed } from '../mocks/memoryDb';
import { bulkDeleteUnits } from '../../services/inventoryService';

const EMPLOYEE = { email: 'ops1@inventorymanager.com', uid: 'emp-1' };
const ADMIN = { email: 'admin@inventorymanager.com', uid: 'admin-1' };

function makeUnit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'u-1',
    imei: '350100000000001',
    model: 'IPHONE 13',
    storage: '128GB',
    colour: 'MIDNIGHT',
    status: 'available',
    buyPrice: 300,
    supplierName: 'ABC SUPPLIER',
    dateIn: '2026-07-01',
    flags: [],
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-07-01',
    ...over,
  } as InventoryUnit;
}

describe('bulkDeleteUnits', () => {
  beforeEach(() => {
    clearStore();
    session.currentUser = ADMIN;
  });

  it('rejects non-admin callers without deleting anything', async () => {
    session.currentUser = EMPLOYEE;
    const u1 = makeUnit({ id: 'u-1', imei: '350100000000001' });
    seed('inventoryUnits', [u1]);

    const res = await bulkDeleteUnits([u1], 'RTS');
    expect(res.ok).toBe(false);
    expect(res.deleted).toBe(0);
    expect(all('inventoryUnits')).toHaveLength(1);
    expect(all('deletedUnits')).toHaveLength(0);
  });

  it('successfully deletes multiple available units with reason RTS', async () => {
    const u1 = makeUnit({ id: 'u-1', imei: '350100000000001' });
    const u2 = makeUnit({ id: 'u-2', imei: '350100000000002' });
    seed('inventoryUnits', [u1, u2]);

    const res = await bulkDeleteUnits([u1, u2], 'RTS');
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(2);
    expect(res.failed).toHaveLength(0);

    // Units removed from active inventory
    expect(all('inventoryUnits')).toHaveLength(0);

    // Archived to deletedUnits with reason RTS
    const deleted = all<any>('deletedUnits');
    expect(deleted).toHaveLength(2);
    expect(deleted.map(d => d.reason)).toEqual(['RTS', 'RTS']);
    expect(deleted.map(d => d.source)).toEqual(['office', 'office']);

    // Log notices created
    const notices = all<any>('notices');
    expect(notices).toHaveLength(2);
    expect(notices[0].content).toContain('— RTS');
  });

  it('successfully deletes units with parameter FBA', async () => {
    const u1 = makeUnit({ id: 'u-1', imei: '350100000000001' });
    seed('inventoryUnits', [u1]);

    const res = await bulkDeleteUnits([u1], 'FBA - Shipment 42');
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(1);

    const deleted = all<any>('deletedUnits');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].reason).toBe('FBA - Shipment 42');
  });

  it('handles incoming (SHS) units setting source to shs_unit', async () => {
    const u1 = makeUnit({ id: 'u-shs-1', imei: '350100000000099', status: 'incoming' });
    seed('inventoryUnits', [u1]);

    const res = await bulkDeleteUnits([u1], 'RTS');
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(1);

    const deleted = all<any>('deletedUnits');
    expect(deleted[0].source).toBe('shs_unit');
  });

  it('skips sold units and reports them as failed without modifying them', async () => {
    const u1 = makeUnit({ id: 'u-1', imei: '350100000000001', status: 'available' });
    const u2 = makeUnit({ id: 'u-2', imei: '350100000000002', status: 'sold' });
    seed('inventoryUnits', [u1, u2]);

    const res = await bulkDeleteUnits([u1, u2], 'RTS');
    expect(res.deleted).toBe(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].imei).toBe('350100000000002');
    expect(res.failed[0].error).toContain('Cannot delete sold unit');

    // u1 deleted, u2 remains
    expect(all('inventoryUnits')).toHaveLength(1);
    expect(all('inventoryUnits')[0].id).toBe('u-2');
  });
});
