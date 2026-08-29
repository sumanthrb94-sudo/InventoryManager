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

describe('the cache policy: MEMORY, by the operator’s decision (2026-08-29)', () => {
  /** History in one breath: a persistent IndexedDB cache was added to
   *  survive the free tier's 50k reads/day, then caused three incidents in
   *  a week (stuck multi-tab leader, full-phone QuotaExceededError meltdown,
   *  saved-copy confusion). On Blaze the reads it saved cost pennies, so the
   *  operator chose live-only: "I don't need any local storage … if no
   *  network, ask to refresh." These pins keep that decision from being
   *  silently reverted — re-adding persistence must consult the incident
   *  list in firebase.ts and change these tests knowingly. */
  it('uses the plain memory-cache constructor, no persistence', () => {
    // Call-shaped patterns: the incident HISTORY in the docblock is allowed
    // to name these APIs — invoking them is what these pins forbid.
    expect(FIREBASE).not.toMatch(/persistentLocalCache\(/);
    expect(FIREBASE).not.toMatch(/persistentMultipleTabManager\(\)/);
    expect(FIREBASE).not.toMatch(/initializeFirestore\(/);
    expect(FIREBASE).toMatch(/getFirestore\(app, firebaseConfig\.firestoreDatabaseId\)/);
  });

  it('records WHY, so the pendulum does not swing back blind', () => {
    expect(FIREBASE).toMatch(/MEMORY CACHE, ON PURPOSE/);
    expect(FIREBASE).toMatch(/STUCK LEADER/);
    expect(FIREBASE).toMatch(/FULL-DEVICE MELTDOWN/);
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
