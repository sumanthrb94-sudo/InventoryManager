/**
 * The record of a unit leaving stock must outlive everyone's ability to
 * remove it — including the admin who removed the unit.
 *
 * WHAT WAS WRONG
 *
 * `deletedUnits` was already indelible (`allow delete: if false`), but it
 * sits behind an admin-only tab. The line the TEAM actually sees was an
 * ordinary notice, and ordinary notices are admin-editable and
 * admin-deletable. So the visible record of a deletion could be reworded to
 * say something else, or removed outright, while the tombstone survived
 * somewhere nobody was looking. A log anyone can quietly edit is not a log.
 *
 * WHAT HOLDS IT SHUT NOW
 *
 *   1. Both deletion paths stamp their notice `kind: 'log'`.
 *   2. firestore.rules refuses every update and delete on a notice carrying
 *      that stamp, admin included, reading the EXISTING doc so the flag
 *      cannot be dropped by the same write that would free the row.
 *   3. The board renders those rows without edit/delete controls.
 *
 * No Firestore emulator is available here, so the rules cannot be executed.
 * Mirroring their logic in a test would prove nothing — a mirror agrees with
 * whatever it copies. The rules assertions below READ firestore.rules and
 * pin the property that has to hold, the same approach as
 * saleIsNotAReturnUpdate.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { InventoryUnit } from '../../types';

const session = vi.hoisted(() => ({
  currentUser: { email: 'admin@inventorymanager.com', uid: 'admin-1' } as { email: string; uid: string } | null,
}));

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('../mocks/memoryDb');
  return firestoreMock;
});

vi.mock('../../lib/firebase', async () => {
  const ADMIN_EMAILS = new Set(['admin@inventorymanager.com']);
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
import { deleteOfficeUnit } from '../../services/inventoryService';

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

describe('a deletion posts a notice that is a log, not a message', () => {
  it('stamps the notice so the rules can refuse to let it be changed', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);

    const res = await deleteOfficeUnit(unit, 'Damaged beyond resale');
    expect(res.ok).toBe(true);

    const notices = all<any>('notices');
    expect(notices).toHaveLength(1);
    expect(notices[0].kind).toBe('log');
  });

  /** Without this the board would report the same deletion twice — once as
   *  the notice, once as the tombstone behind it. */
  it('ties the notice to the archive record it reports', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);

    await deleteOfficeUnit(unit, 'Damaged beyond resale');

    const notice = all<any>('notices')[0];
    const archive = all<any>('deletedUnits');
    expect(archive).toHaveLength(1);
    expect(notice.logRef).toBe(archive[0].id);
  });

  /** The archive is written FIRST and the delete is refused if it fails, so
   *  a deletion that could not be recorded does not happen at all. */
  it('still records the unit in the indelible archive', async () => {
    const unit = makeUnit();
    seed('inventoryUnits', [unit]);

    await deleteOfficeUnit(unit, 'Damaged beyond resale');

    const archive = all<any>('deletedUnits')[0];
    expect(archive.imei).toBe('350100000000000');
    expect(archive.reason).toBe('Damaged beyond resale');
    expect(archive.deletedBy).toBe('admin@inventorymanager.com');
    expect(all('inventoryUnits')).toHaveLength(0);
  });
});

describe('firestore.rules is the boundary, not the hidden buttons', () => {
  const rules = () => readFileSync('firestore.rules', 'utf8');

  it('refuses update and delete on a notice stamped as a log', () => {
    const src = rules();
    const block = /match \/notices\/\{noticeId\} \{[\s\S]*?\n {4}\}/.exec(src)?.[0] ?? '';
    expect(block, 'notices block not found in firestore.rules').not.toBe('');

    // Both write verbs must be gated on the flag. A rule that only guards
    // delete still lets an admin rewrite the log into something else.
    expect(block, 'log notices can still be edited').toMatch(/allow update:[^;]*!isLogNotice\(\)/);
    expect(block, 'log notices can still be deleted').toMatch(/allow delete:[^;]*!isLogNotice\(\)/);
  });

  /** The test must read the STORED doc. Reading `request.resource` would let
   *  a single write drop the flag and free the row in the same breath. */
  it('decides on the existing document, not the incoming one', () => {
    const block = /function isLogNotice\(\) \{[\s\S]*?\n {6}\}/.exec(rules())?.[0] ?? '';
    expect(block, 'isLogNotice() not found').not.toBe('');
    expect(block).toMatch(/resource\.data/);
    expect(block, 'isLogNotice() must not read the incoming write').not.toMatch(/request\.resource/);
  });

  it('keeps the deletion archive itself deletable by nobody', () => {
    const block = /match \/deletedUnits\/\{recordId\} \{[\s\S]*?\n {4}\}/.exec(rules())?.[0] ?? '';
    expect(block, 'deletedUnits block not found').not.toBe('');
    expect(block).toMatch(/allow delete:\s*if false;/);
  });

  /** A reset that erased the record of what was deleted would destroy the
   *  exact history this app keeps in order to answer for itself. */
  it('keeps both log surfaces out of the data reset', () => {
    const src = readFileSync('src/components/ResetDataModal.tsx', 'utf8');
    const protectedList = /PROTECTED_COLLECTIONS\s*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
    expect(protectedList).toContain("'notices'");
    expect(protectedList).toContain("'deletedUnits'");
  });
});
