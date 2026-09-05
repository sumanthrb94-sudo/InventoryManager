/**
 * The deletion tombstone.
 *
 * Every test here pins a specific way this could fail SILENTLY, because a
 * silent failure in this module is the one outcome that matters: the archive
 * exists so a deleted handset can still be identified months later, and an
 * archive that quietly does not write is worse than no archive at all — the
 * delete still happens, and everyone believes there is a record.
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

vi.mock('../../lib/firebase', () => ({
  db: { app: { name: '[DEFAULT]' } },
  auth: { get currentUser() { return session.currentUser; } },
  isAdmin: () => true,
}));

vi.mock('../../lib/dbService', async () => {
  const { memoryDbService } = await import('../mocks/memoryDb');
  return { dbService: memoryDbService };
});

import { all, clearStore } from '../mocks/memoryDb';
import {
  sanitizeSnapshot,
  buildDeletedUnitRecord,
  archiveDeletedUnit,
  voidArchiveRecord,
} from '../../services/deletedUnitArchive';

function makeUnit(over: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    id: '350100000000000',
    imei: '350100000000000',
    model: 'IPHONE 13',
    storage: '128GB',
    colour: 'MIDNIGHT',
    grade: 'A',
    status: 'available',
    buyPrice: 320,
    supplierName: 'MOBILE WHOLESALE LTD',
    supplierId: 'sup-1',
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
  session.currentUser = { email: 'admin@inventorymanager.com', uid: 'admin-1' };
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sanitizeSnapshot', () => {
  it('strips nested undefined — the shallow-clean trap', () => {
    // cleanForFirestore only drops TOP-LEVEL undefined. A nested one makes
    // Firestore reject the whole write with invalid-argument, and
    // rethrowIfDenied swallows everything that is not a permission error, so
    // the archive would never write and nobody would be told.
    const out = sanitizeSnapshot({
      a: 1,
      nested: { keep: 'yes', gone: undefined, deeper: { alsoGone: undefined, kept: 0 } },
    }) as any;
    expect(out).toEqual({ a: 1, nested: { keep: 'yes', deeper: { kept: 0 } } });
    expect('gone' in out.nested).toBe(false);
    expect('alsoGone' in out.nested.deeper).toBe(false);
  });

  it('keeps null, false, 0 and empty string — only undefined is a problem', () => {
    expect(sanitizeSnapshot({ a: null, b: false, c: 0, d: '' })).toEqual({
      a: null, b: false, c: 0, d: '',
    });
  });

  it('drops undefined holes inside arrays instead of poisoning the document', () => {
    expect(sanitizeSnapshot(['a', undefined, 'b'])).toEqual(['a', 'b']);
    expect(sanitizeSnapshot([{ x: 1, y: undefined }])).toEqual([{ x: 1 }]);
  });

  it('drops functions and symbols', () => {
    const out = sanitizeSnapshot({ fn: () => 1, sym: Symbol('s'), keep: 'yes' }) as any;
    expect(out).toEqual({ keep: 'yes' });
  });

  it('leaves non-plain objects intact — a Timestamp must not be rebuilt', () => {
    // importedAt arrives from the snapshot listener as a Firestore Timestamp.
    // Walking it as a plain object would rewrite it into { seconds, nanoseconds }
    // and lose the type. A Date stands in for it here: same constructor test.
    const when = new Date('2026-07-01T00:00:00.000Z');
    const out = sanitizeSnapshot({ importedAt: when }) as any;
    expect(out.importedAt).toBe(when);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildDeletedUnitRecord', () => {
  it('captures who, what and when', () => {
    const rec = buildDeletedUnitRecord({ unit: makeUnit(), reason: 'QC failed — liquid damage' });
    expect(rec.imei).toBe('350100000000000');
    expect(rec.unitId).toBe('350100000000000');
    expect(rec.source).toBe('office');
    expect(rec.reason).toBe('QC failed — liquid damage');
    expect(rec.deletedBy).toBe('admin@inventorymanager.com');
    expect(rec.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rec.ownerId).toBe('shared');
    // Denormalised so the table, the CSV and the intake warning can render
    // without unpacking the snapshot.
    expect(rec.model).toBe('IPHONE 13');
    expect(rec.storage).toBe('128GB');
    expect(rec.colour).toBe('MIDNIGHT');
    expect(rec.grade).toBe('A');
    expect(rec.supplierName).toBe('MOBILE WHOLESALE LTD');
    expect(rec.buyPrice).toBe(320);
    expect(rec.status).toBe('available');
    expect(rec.dateIn).toBe('2026-07-01');
  });

  it('stores the reason verbatim — the archive records, it does not improve', () => {
    // 139 existing deletions carry a reason like "." — renderers decide how to
    // present that; rewriting it here would falsify the record.
    expect(buildDeletedUnitRecord({ unit: makeUnit(), reason: '  .  ' }).reason).toBe('.');
    expect(buildDeletedUnitRecord({ unit: makeUnit(), reason: '' }).reason).toBe('');
  });

  it('normalises the IMEI key — zero-width passengers must not split a handset in two', () => {
    const rec = buildDeletedUnitRecord({
      unit: makeUnit({ imei: '\u200B350100000000000\u00A0 ' }),
      reason: 'x',
    });
    expect(rec.imei).toBe('350100000000000');
  });

  it('falls back to the doc id, then to NOIMEI, when there is no IMEI', () => {
    const fromId = buildDeletedUnitRecord({ unit: makeUnit({ imei: undefined, id: 'shs_abc123' }), reason: 'x' });
    expect(fromId.imei).toBe('SHS_ABC123');

    const neither = buildDeletedUnitRecord({ unit: makeUnit({ imei: '', id: '' }), reason: 'x' });
    expect(neither.imei).toBe('');
    expect(neither.id).toContain('NOIMEI');
  });

  it('never collides inside the same millisecond', () => {
    // dbService.create writes with setDoc(merge:true), so a colliding id
    // MERGES one deletion over another rather than erroring — a double-clicked
    // delete button would silently lose a record.
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_764_500_000_000);
    const ids = new Set(
      Array.from({ length: 500 }, () => buildDeletedUnitRecord({ unit: makeUnit(), reason: 'x' }).id),
    );
    expect(ids.size).toBe(500);
    now.mockRestore();
  });

  it('carries the whole unit as a forensic snapshot, free of undefined', () => {
    const rec = buildDeletedUnitRecord({
      unit: makeUnit({ returnComments: undefined, technicianComments: undefined }),
      reason: 'x',
    });
    expect(rec.snapshot.model).toBe('IPHONE 13');
    expect(JSON.stringify(rec.snapshot)).not.toContain('undefined');
    expect(Object.values(rec.snapshot).some(v => v === undefined)).toBe(false);
  });

  it('records an unknown actor rather than throwing when nobody is signed in', () => {
    session.currentUser = null;
    expect(buildDeletedUnitRecord({ unit: makeUnit(), reason: 'x' }).deletedBy).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('archiveDeletedUnit', () => {
  it('writes the tombstone and reports its id', async () => {
    const res = await archiveDeletedUnit({ unit: makeUnit(), reason: 'QC failed' });
    expect(res.ok).toBe(true);

    const rows = all<any>('deletedUnits');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.id);
    expect(rows[0].imei).toBe('350100000000000');
    expect(rows[0].reason).toBe('QC failed');
  });

  it('keeps one record per deletion — delete, re-add, delete again', async () => {
    await archiveDeletedUnit({ unit: makeUnit(), reason: 'first removal' });
    await archiveDeletedUnit({ unit: makeUnit(), reason: 'second removal' });

    const rows = all<any>('deletedUnits');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.reason).sort()).toEqual(['first removal', 'second removal']);
    // Newest wins when the lookup layer sorts by deletedAt.
    const newest = [...rows].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''))[0];
    expect(['first removal', 'second removal']).toContain(newest.reason);
  });

  it('names undeployed rules when the write is denied — that is the likely cause', async () => {
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.create;
    (dbService as any).create = async () => {
      const err: any = new Error('Missing or insufficient permissions.');
      err.code = 'permission-denied';
      throw err;
    };

    const res = await archiveDeletedUnit({ unit: makeUnit(), reason: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('archive_denied');
    expect(res.message).toMatch(/firestore\.rules/i);
    expect(res.message).toMatch(/NOT deleted/i);

    (dbService as any).create = original;
  });

  it('resolves not-ok rather than throwing on any other write failure', async () => {
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.create;
    (dbService as any).create = async () => { throw new Error('network unreachable'); };

    const res = await archiveDeletedUnit({ unit: makeUnit(), reason: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('archive_failed');
    expect(res.message).toMatch(/network unreachable/);
    expect(all('deletedUnits')).toHaveLength(0);

    (dbService as any).create = original;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('voidArchiveRecord', () => {
  it('marks the record void without removing it — the collection is append-only', async () => {
    const res = await archiveDeletedUnit({ unit: makeUnit(), reason: 'x' });
    await voidArchiveRecord(res.id!, 'unit delete failed');

    const rows = all<any>('deletedUnits');
    expect(rows).toHaveLength(1);
    expect(rows[0].voided).toBe(true);
    expect(rows[0].voidedReason).toBe('unit delete failed');
    // Everything that identifies the deletion survives the void.
    expect(rows[0].imei).toBe('350100000000000');
    expect(rows[0].deletedBy).toBe('admin@inventorymanager.com');
  });

  it('never throws — it runs on a path that has already failed', async () => {
    const { dbService } = await import('../../lib/dbService');
    const original = dbService.update;
    (dbService as any).update = async () => { throw new Error('offline'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(voidArchiveRecord('del_missing', 'because')).resolves.toBeUndefined();

    warn.mockRestore();
    (dbService as any).update = original;
  });
});
