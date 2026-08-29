/**
 * An empty read must never render as an empty business.
 *
 * dbService flips the sync flag false on exactly one condition: a Firestore
 * snapshot returned an error. Every collection then serves an empty cache and
 * the whole app renders zeros — All Office Stock 0, Sold Today 0, Stock Alerts
 * 0, "All stock levels healthy". That is pixel-identical to a wiped database.
 *
 * The operator hit this for real, read the screen as "my data is gone", and
 * the two controls nearest to hand were Wipe and re-import — one destructive,
 * the other a route to duplicates. The only thing telling the two states apart
 * was a 1.5px dot with a hover tooltip, which a phone cannot show or hover.
 *
 * This pins the banner's presence and, more importantly, its INSTRUCTION. A
 * warning that says "offline" and stops there still leaves the reader to guess
 * what it means for the zeros underneath it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const APP = readFileSync('src/App.tsx', 'utf8');

describe('the cannot-read banner', () => {
  it('renders on the ERROR, not on "not connected yet"', () => {
    // Gating it on `loaded` was wrong and the E2E caught it: on this exact
    // failure no collection ever emits, so `loaded` waits out its 15-second
    // fallback before flipping — the operator stares at a spinner, then gets
    // unexplained zeros, and the warning arrives last.
    expect(APP).toMatch(/const cannotRead\s*=\s*\(syncErrored && !syncConnected\)/);
    expect(APP).toMatch(/\{cannotRead && \(/);
  });

  /** THE SECOND ROAD IN. A quota-blocked database raises NO error — the SDK
   *  retries resource-exhausted silently forever — so the error condition
   *  alone missed it: the operator's phone showed confident zeros on the
   *  fixed build with no banner in sight. A server that has never answered
   *  (no snapshot with fromCache === false), past the start-up grace, on a
   *  device with nothing cached, must reach the same rose banner. */
  it('also renders when the server never answers and there is no cached data', () => {
    expect(APP).toMatch(/const serverSilent = serverGraceUp && !syncServerSynced && !syncErrored;/);
    expect(APP).toMatch(/cannotRead\s*=\s*\(syncErrored && !syncConnected\) \|\| \(serverSilent && units\.length === 0\)/);
  });

  it('says the zeros are a read failure, not missing data', () => {
    const banner = APP.slice(APP.indexOf('{cannotRead && ('));
    expect(banner).toMatch(/Can’t reach the database/);
    expect(banner).toMatch(/because nothing could be/);
  });

  /** The load-bearing half. Naming the danger is what stops the reader
   *  reaching for the two controls that make it unrecoverable. */
  it('tells the operator not to wipe or import while it is showing', () => {
    const banner = APP.slice(APP.indexOf('{cannotRead && ('));
    expect(banner).toMatch(/Do not wipe and do not import/);
  });

  /** The silent-server hint changed with the cache policy (2026-08-29): on
   *  Blaze there is no read quota to blame, so the banner asks the one
   *  question that remains — is this device online? — and hands the reader
   *  the two actions that resolve it: Refresh, and the diagnostics panel. */
  it('tells the reader to check their connection and offers Refresh + diagnostics', () => {
    const banner = APP.slice(APP.indexOf('{cannotRead && ('));
    expect(banner).toMatch(/internet connection, then refresh/i);
    expect(banner).toMatch(/window\.location\.reload\(\)/);
    expect(banner).toMatch(/open-diagnostics/);
  });

  /** THE OCCLUSION BUG.
   *
   *  The first version sat at z-[110] — below the z-[300] loading overlay that
   *  covers the whole screen until `loaded` flips. Every assertion here passed
   *  and the E2E's isVisible() passed too, because the element WAS rendered
   *  with a real box; it was simply painted over. Only the screenshot showed
   *  a spinner and nothing else.
   *
   *  So the rule is not "has a z-index" but "outranks every full-screen
   *  overlay in this file". */
  it('outranks the loading overlay it would otherwise hide behind', () => {
    const banner = APP.slice(APP.indexOf('{cannotRead && ('));
    const bannerZ = Number((banner.match(/z-\[(\d+)\]/) || [])[1]);
    const overlays = [...APP.matchAll(/fixed inset-0 z-\[(\d+)\]/g)].map(m => Number(m[1]));
    expect(bannerZ).toBeGreaterThan(0);
    expect(overlays.length).toBeGreaterThan(0);
    for (const z of overlays) expect(bannerZ).toBeGreaterThan(z);
  });
});

describe('the saved-copy strip (silent server, cached data on screen)', () => {
  /** The desktop half of the same outage: real figures from the on-disk
   *  cache, a green-looking app, and a server that has not confirmed any of
   *  it. Hiding the data would be wrong — it IS the operator's data — but
   *  presenting it as live while another device shows zeros is how the two
   *  screens came to flatly contradict each other. */
  it('shows when the server is silent but this device has data', () => {
    expect(APP).toMatch(/\{serverSilent && units\.length > 0 && \(/);
    const strip = APP.slice(APP.indexOf('{serverSilent && units.length > 0 && ('));
    expect(strip).toMatch(/saved copy/i);
    expect(strip).toMatch(/last successful sync/i);
  });

  it('never fires on a healthy start-up — only after the grace period', () => {
    expect(APP).toMatch(/setTimeout\(\(\) => setServerGraceUp\(true\), SYNC_SERVER_GRACE_MS\)/);
    // And the grace default is long enough that a slow connection cannot
    // trip it — this warning crying wolf on every hotel wifi would get the
    // banner ignored the one morning it matters.
    expect(APP).toMatch(/return 15000;/);
  });
});

describe('the condition it is reporting', () => {
  it('sync goes false ONLY on a snapshot error — nothing else may clear it', () => {
    // If a future change starts flipping this flag for "still loading" or
    // "user signed out", the banner becomes a liar and gets ignored.
    const db = readFileSync('src/lib/dbService.ts', 'utf8');
    const falses = db.match(/setSyncStatus\(false\)/g) || [];
    expect(falses).toHaveLength(1);
    const at = db.indexOf('setSyncStatus(false)');
    expect(db.slice(at - 200, at)).toMatch(/err\s*=>/);
  });

  /** The bug underneath the bug. `connected` starts false, and the setter
   *  deduped on it — so a run whose FIRST snapshot errored wrote false over
   *  false, returned early, and never notified a listener. The UI could not
   *  learn about the one failure that matters most: a cold start against a
   *  database it cannot read, which is precisely what the operator hit. */
  it('a first-snapshot failure still notifies, despite starting disconnected', async () => {
    const { subscribeToSyncStatus } = await import('../../lib/dbService');
    const seen: any[] = [];
    const stop = subscribeToSyncStatus(s => seen.push({ ...s }));
    expect(seen[0]).toEqual({ connected: false, errored: false, serverSynced: false });
    stop();
    // And the two facts are modelled separately, so "not yet" and "failed"
    // are distinguishable at all.
    const db = readFileSync('src/lib/dbService.ts', 'utf8');
    expect(db).toMatch(/errored:\s*boolean/);
    expect(db).toMatch(/const errored = _sync\.errored \|\| !connected;/);
  });

  /** A cache-only snapshot must NOT count as the server answering. That is
   *  the exact confusion that made a quota-blocked desktop look healthy:
   *  snapshots were arriving, so `connected` went true — but every one of
   *  them was the device reading its own disk. Only fromCache === false is
   *  the server's voice; the flag latches because one confirmed answer means
   *  the outage this exists to catch is not happening. */
  it('serverSynced trips only on a snapshot the SERVER actually delivered', () => {
    const db = readFileSync('src/lib/dbService.ts', 'utf8');
    expect(db).toMatch(/serverSynced:\s*boolean/);
    expect(db).toMatch(/const serverSynced = _sync\.serverSynced \|\| serverAck;/);
    expect(db).toMatch(/setSyncStatus\(true, snap\?\.metadata \? !snap\.metadata\.fromCache : true\)/);
  });
});
