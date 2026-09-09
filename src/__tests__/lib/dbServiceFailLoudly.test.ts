/**
 * A write that fails must FAIL — reject the promise and put the cache back.
 *
 * The old write path caught every error, rethrew only permission denials, and
 * turned the rest (invalid-argument, unavailable, a dropped connection
 * mid-commit) into a console.warn nobody read. The optimistic cache had
 * already been updated and the promise resolved as though the write had
 * landed. The screen said one thing; the database said another. `delete` did
 * not even rethrow denials, so a delete the rules refused looked exactly like
 * one that worked until the next reload brought the row back.
 *
 * These tests pin both halves of the fix for create / update / delete:
 *   1. the promise rejects with the SDK's error, whatever its code;
 *   2. the cache — and every subscriber — is back on the pre-write state
 *      before the rejection is observed, so no screen keeps showing a state
 *      the database refused.
 *
 * `firebase/firestore` is mocked; the cache and rollback are entirely
 * client-side, which is the thing under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const setDocMock = vi.fn();
const deleteDocMock = vi.fn();
let snapshotCb: ((snap: any) => void) | null = null;

vi.mock('../../lib/firebase', () => ({ db: {}, storage: {}, auth: {} }));

vi.mock('firebase/firestore', () => {
  const noop = () => ({});
  return {
    collection: noop,
    doc: (_db: unknown, col: string, id: string) => ({ col, id }),
    setDoc: (...args: any[]) => setDocMock(...args),
    deleteDoc: (...args: any[]) => deleteDocMock(...args),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    onSnapshot: (_ref: unknown, next: (snap: any) => void) => { snapshotCb = next; return () => {}; },
    query: noop,
    where: noop,
    orderBy: noop,
    serverTimestamp: noop,
    deleteField: noop,
    runTransaction: vi.fn(),
    Timestamp: { fromDate: (d: Date) => d },
    QuerySnapshot: class {},
    DocumentData: class {},
    writeBatch: () => ({ set: () => {}, delete: () => {}, commit: async () => {} }),
  };
});

const COL = 'inventoryUnits';
const seed = [{ id: 'u1', imei: '1', status: 'available', ownerId: 'shared' }];

/** Hydrate the module cache with `seed` through a fake server snapshot and
 *  return the latest list every subscriber has been handed. */
async function hydrated() {
  const { dbService } = await import('../../lib/dbService');
  const seen: any[][] = [];
  dbService.subscribeToCollection(COL, rows => seen.push(rows));
  snapshotCb!({ docs: seed.map(d => ({ id: d.id, data: () => d })), metadata: { fromCache: false } });
  return { dbService, latest: () => seen[seen.length - 1] };
}

beforeEach(() => {
  vi.resetModules();
  setDocMock.mockReset();
  deleteDocMock.mockReset();
  snapshotCb = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('dbService — a failed write rejects and rolls the cache back', () => {
  it('update: a non-permission error is thrown, not swallowed, and the row reverts', async () => {
    const { dbService, latest } = await hydrated();
    const err = Object.assign(new Error('Deadline exceeded'), { code: 'unavailable' });
    setDocMock.mockRejectedValueOnce(err);

    await expect(dbService.update(COL, 'u1', { status: 'sold' })).rejects.toBe(err);

    const row = latest().find((r: any) => r.id === 'u1');
    expect(row.status).toBe('available');
    expect((await dbService.readAll(COL)).find((r: any) => r.id === 'u1').status).toBe('available');
  });

  it('delete: a permission denial is thrown and the row comes straight back', async () => {
    const { dbService, latest } = await hydrated();
    const err = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    deleteDocMock.mockRejectedValueOnce(err);

    await expect(dbService.delete(COL, 'u1')).rejects.toBe(err);

    expect(latest().map((r: any) => r.id)).toEqual(['u1']);
  });

  it('create: a failed create leaves no phantom row behind', async () => {
    const { dbService, latest } = await hydrated();
    const err = Object.assign(new Error('Invalid data'), { code: 'invalid-argument' });
    setDocMock.mockRejectedValueOnce(err);

    await expect(dbService.create(COL, 'u2', { imei: '2', status: 'available' })).rejects.toBe(err);

    expect(latest().map((r: any) => r.id)).toEqual(['u1']);
  });

  it('a successful write keeps its optimistic state', async () => {
    const { dbService, latest } = await hydrated();
    setDocMock.mockResolvedValueOnce(undefined);

    await dbService.update(COL, 'u1', { status: 'sold' });

    expect(latest().find((r: any) => r.id === 'u1').status).toBe('sold');
  });
});
