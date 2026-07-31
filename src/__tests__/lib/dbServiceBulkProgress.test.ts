/**
 * bulkCreate's progress callback is the ONLY feedback the operator gets while
 * a large import writes, and it fires once per committed batch.
 *
 * With the old 400-doc batch size a 494-sale import was two commits, so the
 * first callback landed only after 400 docs had been acknowledged by the
 * server. Until then the import modal sat on "Writing 0 / 494 sales…" — a
 * spinner, a zero, and a bar at 0% for the whole of one round trip. On a phone
 * with a weak connection that is indistinguishable from a hung app, and it was
 * reported as exactly that ("forever loading").
 *
 * These tests pin the property that matters — a realistically-sized import
 * reports progress SEVERAL times, and always finishes on done === total — so
 * the constant can't be quietly raised back to a value that starves the UI.
 * They mock `firebase/firestore` rather than exercise a real backend; the
 * batching/chunking arithmetic is entirely client-side, which is the thing
 * under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const committed: number[] = [];

vi.mock('../../lib/firebase', () => ({ db: {}, storage: {}, auth: {} }));

vi.mock('firebase/firestore', () => {
  const noop = () => ({});
  return {
    collection: noop,
    doc: (_db: unknown, col: string, id: string) => ({ col, id }),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
    query: noop,
    where: noop,
    orderBy: noop,
    serverTimestamp: noop,
    deleteField: noop,
    runTransaction: vi.fn(),
    Timestamp: { fromDate: (d: Date) => d },
    QuerySnapshot: class {},
    DocumentData: class {},
    writeBatch: () => {
      let n = 0;
      return {
        set: () => { n++; },
        commit: async () => { committed.push(n); },
      };
    },
  };
});

const entriesFor = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    collection: 'sales',
    id: `sale-${i}`,
    data: { imei: `imei-${i}`, ownerId: 'shared' },
  }));

beforeEach(() => { committed.length = 0; });

describe('bulkCreate — progress must move during a realistic import', () => {
  it('reports progress several times for a 494-sale import, not once at the end', async () => {
    const { dbService } = await import('../../lib/dbService');
    const ticks: Array<[number, number]> = [];

    await dbService.bulkCreate(entriesFor(494), (done, total) => ticks.push([done, total]));

    // The regression this guards: a single mid-write tick (or none) means the
    // bar sits at 0 for the entire write.
    const midWrite = ticks.filter(([done, total]) => done > 0 && done < total);
    expect(midWrite.length).toBeGreaterThanOrEqual(3);
  });

  it('every batch stays under Firestore’s 500-operation limit', async () => {
    const { dbService } = await import('../../lib/dbService');
    await dbService.bulkCreate(entriesFor(494));

    expect(committed.length).toBeGreaterThan(1);
    for (const size of committed) expect(size).toBeLessThanOrEqual(500);
    expect(committed.reduce((a, b) => a + b, 0)).toBe(494);
  });

  it('progress is monotonic and ends on done === total', async () => {
    const { dbService } = await import('../../lib/dbService');
    const ticks: Array<[number, number]> = [];

    await dbService.bulkCreate(entriesFor(494), (done, total) => ticks.push([done, total]));

    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i][0]).toBeGreaterThanOrEqual(ticks[i - 1][0]);
    expect(ticks[ticks.length - 1]).toEqual([494, 494]);
  });

  it('a write smaller than one batch still reports completion', async () => {
    const { dbService } = await import('../../lib/dbService');
    const ticks: Array<[number, number]> = [];

    await dbService.bulkCreate(entriesFor(7), (done, total) => ticks.push([done, total]));

    expect(committed).toEqual([7]);
    expect(ticks[ticks.length - 1]).toEqual([7, 7]);
  });

  it('an empty write commits nothing and still settles', async () => {
    const { dbService } = await import('../../lib/dbService');
    const ticks: Array<[number, number]> = [];

    await dbService.bulkCreate([], (done, total) => ticks.push([done, total]));

    expect(committed).toEqual([]);
    expect(ticks).toEqual([[0, 0]]);
  });
});
