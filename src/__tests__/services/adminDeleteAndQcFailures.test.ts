/**
 * Admin delete + the failure paths of the returns QC flow.
 *
 * Two areas that only ever get exercised when something has gone wrong,
 * which is exactly when a silent bug costs the most: an admin removing a
 * unit from inventory, and a return that cannot proceed (unit already
 * returned, replacement gone, required fields missing, non-admin trying).
 */
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
  const ADMIN_EMAILS = new Set(['admin@inventorymanager.com', 'sumanthbolla97@gmail.com', 'sai@inventorymanager.com']);
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

import { all, clearStore, col, seed } from '../mocks/memoryDb';
import { deleteOfficeUnit } from '../../services/inventoryService';
import { recordReturnQc, processReturn } from '../../services/returnsService';

const EMPLOYEE = { email: 'ops1@inventorymanager.com', uid: 'emp-1' };
const ADMIN = { email: 'admin@inventorymanager.com', uid: 'admin-1' };

function makeUnit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: 'u-1',
    imei: '350100000000000',
    model: 'IPHONE 13',
    storage: '128GB',
    colour: 'MIDNIGHT',
    status: 'available',
    buyPrice: 320,
    supplierName: 'MOBILE WHOLESALE LTD',
    dateIn: '2026-07-01',
    flags: [],
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-07-01',
    ...over,
  } as InventoryUnit;
}

beforeEach(() => {
  clearStore();
  session.currentUser = ADMIN;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('admin deletes a unit from inventory', () => {
  it('removes the unit and leaves an audit trail', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);

    const res = await deleteOfficeUnit(unit, 'Damaged beyond resale');
    expect(res.ok).toBe(true);

    expect(all('inventoryUnits')).toHaveLength(0);
    // A deletion the team can see: a notice carrying who, what and why.
    const notices = all<any>('notices');
    expect(notices).toHaveLength(1);
    expect(notices[0].content).toContain('IPHONE 13');
    expect(notices[0].content).toContain('Damaged beyond resale');
    expect(notices[0].content).toContain('admin@inventorymanager.com');
    expect(notices[0].createdBy).toBe('admin@inventorymanager.com');
    // …and the IMEI, so the notice board can be searched by the one
    // identifier an operator actually has in hand.
    expect(notices[0].content).toContain('350100000000000');

    // A deletion the app can still answer questions about a year later.
    const archive = all<any>('deletedUnits');
    expect(archive).toHaveLength(1);
    expect(archive[0].imei).toBe('350100000000000');
    expect(archive[0].reason).toBe('Damaged beyond resale');
    expect(archive[0].deletedBy).toBe('admin@inventorymanager.com');
    expect(archive[0].source).toBe('office');
    expect(archive[0].voided).toBeUndefined();
    expect(archive[0].snapshot.buyPrice).toBe(320);
  });

  it('writes the archive BEFORE the unit is destroyed', async () => {
    // Order, not just presence. The old code deleted first and wrote the
    // audit trail afterwards, so a crash in between lost the unit with no
    // record at all. This asserts the tombstone already exists at the moment
    // the delete is issued.
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.delete;
    let archiveAtDeleteTime = -1;
    (dbService as any).delete = async (name: string, id: string) => {
      archiveAtDeleteTime = all('deletedUnits').length;
      return original.call(dbService, name, id);
    };

    const res = await deleteOfficeUnit(unit, 'QC failed');
    (dbService as any).delete = original;

    expect(res.ok).toBe(true);
    expect(archiveAtDeleteTime).toBe(1);
  });

  it('does NOT delete the unit when the archive cannot be written', async () => {
    // Fail closed. A deletion that cannot be recorded does not happen —
    // this is the whole point of the archive, and the case that would
    // otherwise fail silently (permission-denied on a rules file that has
    // not been deployed yet).
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.create;
    (dbService as any).create = async (name: string, id: string, data: any) => {
      if (name === 'deletedUnits') {
        const err: any = new Error('Missing or insufficient permissions.');
        err.code = 'permission-denied';
        throw err;
      }
      return original.call(dbService, name, id, data);
    };

    const res = await deleteOfficeUnit(unit, 'QC failed');
    (dbService as any).create = original;

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/NOT deleted/i);
    expect(all('inventoryUnits')).toHaveLength(1);
    expect(all('notices')).toHaveLength(0);
  });

  it('records each removal separately when a unit is deleted, re-added and deleted again', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);
    expect((await deleteOfficeUnit(unit, 'first removal — QC failed')).ok).toBe(true);

    // Same IMEI back in stock, then gone again.
    seed('inventoryUnits', [unit]);
    expect((await deleteOfficeUnit(unit, 'second removal — cracked back')).ok).toBe(true);

    const archive = all<any>('deletedUnits');
    expect(archive).toHaveLength(2);
    expect(archive.map(r => r.reason).sort()).toEqual([
      'first removal — QC failed',
      'second removal — cracked back',
    ]);
  });

  it('refuses a non-admin and leaves the unit untouched', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);
    session.currentUser = EMPLOYEE;

    const res = await deleteOfficeUnit(unit, 'trying it on');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/admin access required/i);
    expect(all('inventoryUnits')).toHaveLength(1);
    expect(all('notices')).toHaveLength(0);
  });

  it('refuses to delete a SOLD unit — the sale must be voided first', async () => {
    const unit = makeUnit({ status: 'sold', salePrice: 425, saleDate: '2026-07-20' });
    seed('inventoryUnits', [unit]);

    const res = await deleteOfficeUnit(unit, 'clearing history');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/cannot delete a sold unit/i);
    expect(all('inventoryUnits')).toHaveLength(1);
  });

  it('deletes an SHS unit that never arrived', async () => {
    const unit = makeUnit({ id: 'u-shs', status: 'incoming', stockSource: 'shs' });
    seed('inventoryUnits', [unit]);

    const res = await deleteOfficeUnit(unit, 'Supplier cancelled the order');
    expect(res.ok).toBe(true);
    expect(all('inventoryUnits')).toHaveLength(0);
  });

  it('deletes a returned unit that failed QC and cannot be resold', async () => {
    const unit = makeUnit({
      status: 'returned', returnType: 'repair', returnDate: '2026-07-22',
      returnReason: 'Board fault', technicianComments: 'Liquid damage, beyond economic repair',
    });
    seed('inventoryUnits', [unit]);

    const res = await deleteOfficeUnit(unit, 'QC failed — liquid damage, scrapped');
    expect(res.ok).toBe(true);
    expect(all('inventoryUnits')).toHaveLength(0);
    expect(all<any>('notices')[0].content).toContain('QC failed');
  });

  it('reports the failure instead of throwing when the write fails', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.delete;
    (dbService as any).delete = async () => { throw new Error('permission-denied'); };

    const res = await deleteOfficeUnit(unit, 'network flake');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/permission-denied/);

    // The archive landed but the delete did not, so the record must not read
    // as a deletion — the unit is still in stock, and the intake screens
    // would otherwise warn about it forever. It is voided, never removed:
    // the collection is append-only.
    const archive = all<any>('deletedUnits');
    expect(archive).toHaveLength(1);
    expect(archive[0].voided).toBe(true);
    expect(archive[0].voidedReason).toMatch(/permission-denied/);
    expect(all('inventoryUnits')).toHaveLength(1);

    (dbService as any).delete = original;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('QC step 1 (Tech intake) failure paths', () => {
  it('refuses a unit with no id', async () => {
    const res = await recordReturnQc({
      unit: { ...makeUnit(), id: '' } as InventoryUnit,
      returnDate: '2026-07-25', customerComments: 'x', technicianComments: 'y',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_unit');
  });

  it('refuses a QC intake with no return date', async () => {
    const res = await recordReturnQc({
      unit: makeUnit({ status: 'sold' }),
      returnDate: '', customerComments: 'x', technicianComments: 'y',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_date');
  });

  it('raises the CRM queue flag without touching the sale or the unit status', async () => {
    const unit = makeUnit({ status: 'sold', salePrice: 425, saleDate: '2026-07-20' });
    seed('inventoryUnits', [unit]);
    seed('sales', [{ id: 's-1', unitId: 'u-1', imei: unit.imei, salePrice: 425, saleDate: '2026-07-20' }]);

    const res = await recordReturnQc({
      unit, returnDate: '2026-07-25',
      customerComments: 'Battery dies by lunchtime',
      technicianComments: 'Battery health 78%',
    });
    expect(res.ok).toBe(true);

    const after = col('inventoryUnits')['u-1'] as InventoryUnit;
    expect(after.pendingCrmReview).toBe(true);
    expect(after.returnQcAt).toBeTruthy();
    // Deliberate: revenue stays counted until CRM decides the outcome.
    expect(after.status).toBe('sold');
    expect(after.returnType).toBeUndefined();
    expect((col('sales')['s-1'] as any).voidedAt).toBeUndefined();
  });

  it('drops blank comments rather than writing empty strings', async () => {
    const unit = makeUnit({ status: 'sold' });
    seed('inventoryUnits', [unit]);
    const res = await recordReturnQc({
      unit, returnDate: '2026-07-25', customerComments: '   ', technicianComments: '',
    });
    expect(res.ok).toBe(true);
    const after = col('inventoryUnits')['u-1'] as InventoryUnit;
    expect(after.customerComments).toBeUndefined();
    expect(after.technicianComments).toBeUndefined();
    // The UI requires both before it will call this — the service stays
    // permissive so a partial QC can be saved and finished later.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('QC step 2 (CRM finalise) failure paths', () => {
  const soldUnit = () => {
    const u = makeUnit({ status: 'sold', salePrice: 425, saleDate: '2026-07-20' });
    seed('inventoryUnits', [u]);
    seed('sales', [{ id: 's-1', unitId: u.id, imei: u.imei, salePrice: 425, saleDate: '2026-07-20' }]);
    return u;
  };

  it('refuses without a reason', async () => {
    const res = await processReturn({
      unit: soldUnit(), returnType: 'returned_to_inventory',
      returnDate: '2026-07-25', reason: '   ', outcome: 'refund',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_reason');
  });

  it('refuses without an outcome on a non-repair route', async () => {
    const res = await processReturn({
      unit: soldUnit(), returnType: 'returned_to_inventory',
      returnDate: '2026-07-25', reason: 'Faulty', outcome: undefined as any,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_outcome');
  });

  it('refuses a replacement with no replacement unit chosen', async () => {
    const res = await processReturn({
      unit: soldUnit(), returnType: 'returned_to_inventory',
      returnDate: '2026-07-25', reason: 'DOA', outcome: 'replacement',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('missing_replacement');
    // Nothing partial was written
    expect((col('sales')['s-1'] as any).voidedAt).toBeUndefined();
  });

  it('refuses when the chosen replacement is no longer available', async () => {
    const unit = soldUnit();
    const spare = makeUnit({ id: 'u-spare', imei: '350100000007919', status: 'sold' });
    seed('inventoryUnits', [spare]);

    const res = await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-25',
      reason: 'DOA', outcome: 'replacement', replacementUnit: { ...spare, status: 'available' },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('replacement_not_available');
    // The transaction rolled back cleanly — the return did not half-apply
    expect((col('inventoryUnits')['u-1'] as InventoryUnit).returnType).toBeUndefined();
    expect((col('sales')['s-1'] as any).voidedAt).toBeUndefined();
  });

  it('refuses a unit that is no longer sold — a double-processed return', async () => {
    const unit = makeUnit({ status: 'available' });
    seed('inventoryUnits', [unit]);

    const res = await processReturn({
      unit, returnType: 'returned_to_inventory', returnDate: '2026-07-25',
      reason: 'Faulty', outcome: 'refund',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('unit_not_sold');
  });

  it('the repair route needs no outcome — QC failure sends it to the bench', async () => {
    const unit = soldUnit();
    const res = await processReturn({
      unit, returnType: 'repair', returnDate: '2026-07-25',
      reason: 'QC failed — screen delaminating', outcome: undefined as any,
    });
    expect(res.ok).toBe(true);

    const after = col('inventoryUnits')['u-1'] as InventoryUnit;
    expect(after.status).toBe('returned');
    expect(after.returnType).toBe('repair');
    // The linked sale is voided as a REPAIR, never silently as a refund —
    // this is the QA round-3 regression the voidOutcome field exists for.
    expect((col('sales')['s-1'] as any).voidOutcome).toBe('repair');
    expect((col('sales')['s-1'] as any).voidReason).toMatch(/^In Repair —/);
  });

  it('a QC-failed unit returned to the supplier keeps its audit row', async () => {
    const unit = soldUnit();
    const res = await processReturn({
      unit, returnType: 'returned_to_supplier', returnDate: '2026-07-25',
      reason: 'QC failed — IMEI mismatch, sent back', outcome: 'refund',
    });
    expect(res.ok).toBe(true);

    const after = col('inventoryUnits')['u-1'] as InventoryUnit;
    // Soft delete: the unit survives so the return stays auditable.
    expect(after.returnType).toBe('returned_to_supplier');
    expect(after.status).toBe('returned');
    expect(all('inventoryUnits')).toHaveLength(1);
  });
});
