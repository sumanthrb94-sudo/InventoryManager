/**
 * The reads that ran out.
 *
 * The operator's database stopped answering with
 *   "Quota exceeded for 'Free daily read units per project (free tier database)'"
 * after a day of importing. Firestore bills per DOCUMENT delivered from the
 * server, and this app subscribes to whole collections, so every page load was
 * re-downloading all of them: ~711 units, ~401 sales, plus aggregates, models
 * and suppliers. On 50,000 reads a day that is roughly 35 loads, shared across
 * every phone, tab and refresh in the business.
 *
 * Two things were wrong, and each is pinned below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FIREBASE = readFileSync('src/lib/firebase.ts', 'utf8');
const DBSERVICE = readFileSync('src/lib/dbService.ts', 'utf8');

describe('the cache that stops re-reading the database on every load', () => {
  /** getFirestore() defaults to a MEMORY cache, which dies with the tab. That
   *  single default is what made every reload cost a full collection scan. */
  it('configures a PERSISTENT cache, not the memory default', () => {
    expect(FIREBASE).toMatch(/persistentLocalCache\(/);
    expect(FIREBASE).toMatch(/initializeFirestore\(/);
  });

  /** The operator works with several tabs open. The single-tab manager leaves
   *  every other tab without persistence, quietly restoring the expensive
   *  behaviour for the person who has the most tabs. */
  it('uses the multi-tab manager', () => {
    expect(FIREBASE).toMatch(/persistentMultipleTabManager\(\)/);
  });

  /** A browser with IndexedDB blocked must still start. An app that refuses to
   *  load is worse than one that costs more reads. */
  it('falls back to the memory cache rather than failing to start', () => {
    expect(FIREBASE).toMatch(/catch\s*\(err\)/);
    expect(FIREBASE).toMatch(/getFirestore\(app, firebaseConfig\.firestoreDatabaseId\)/);
  });

  /** initializeFirestore must win the race — a getFirestore() elsewhere would
   *  bind the default memory cache first and this whole fix would silently do
   *  nothing. */
  it('is the only place that constructs the db', () => {
    const callers = ['src/lib/firebase.ts'];
    // import + init-failure fallback + the meltdown trap's memory-mode path
    // (a device whose browser storage is FULL runs cache-less on purpose —
    // see the persistence-meltdown comment in firebase.ts).
    expect(FIREBASE.match(/getFirestore\(/g) || []).toHaveLength(3);
    expect(callers).toHaveLength(1);
  });
});

describe('read cost is countable before it becomes an outage', () => {
  it('separates what was billed from what came from cache', () => {
    expect(DBSERVICE).toMatch(/metadata\?\.fromCache/);
    expect(DBSERVICE).toMatch(/billed: number/);
    expect(DBSERVICE).toMatch(/cached: number/);
  });

  it('counts documents moved, which is what Firestore actually charges for', () => {
    // Per QUERY would under-report by three orders of magnitude on a
    // whole-collection listener, which is the shape every listener here has.
    expect(DBSERVICE).toMatch(/docChanges\(\)\.length/);
  });

  it('is reachable from a phone console with no build or deploy', () => {
    expect(DBSERVICE).toMatch(/window as any\)\.__readCost = readCost/);
  });

  it('is recorded on the snapshot path every subscription uses', () => {
    const at = DBSERVICE.indexOf('recordSnapshotCost(collectionName, snap)');
    expect(at).toBeGreaterThan(-1);
    // inside subscribeToCollection's onNext, not somewhere decorative
    expect(DBSERVICE.slice(at - 400, at)).toMatch(/subscribeToCollection|onSnapshot/);
  });
});
