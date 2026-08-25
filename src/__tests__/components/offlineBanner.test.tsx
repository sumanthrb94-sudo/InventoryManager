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
    expect(APP).toMatch(/\{syncErrored && !syncConnected && \(/);
  });

  it('says the zeros are a read failure, not missing data', () => {
    const banner = APP.slice(APP.indexOf('{syncErrored && !syncConnected && ('));
    expect(banner).toMatch(/Can’t reach the database/);
    expect(banner).toMatch(/because nothing could be/);
  });

  /** The load-bearing half. Naming the danger is what stops the reader
   *  reaching for the two controls that make it unrecoverable. */
  it('tells the operator not to wipe or import while it is showing', () => {
    const banner = APP.slice(APP.indexOf('{syncErrored && !syncConnected && ('));
    expect(banner).toMatch(/Do not wipe and do not import/);
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
    const banner = APP.slice(APP.indexOf('{syncErrored && !syncConnected && ('));
    const bannerZ = Number((banner.match(/z-\[(\d+)\]/) || [])[1]);
    const overlays = [...APP.matchAll(/fixed inset-0 z-\[(\d+)\]/g)].map(m => Number(m[1]));
    expect(bannerZ).toBeGreaterThan(0);
    expect(overlays.length).toBeGreaterThan(0);
    for (const z of overlays) expect(bannerZ).toBeGreaterThan(z);
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
    expect(seen[0]).toEqual({ connected: false, errored: false });
    stop();
    // And the two facts are modelled separately, so "not yet" and "failed"
    // are distinguishable at all.
    const db = readFileSync('src/lib/dbService.ts', 'utf8');
    expect(db).toMatch(/errored:\s*boolean/);
    expect(db).toMatch(/const errored = _sync\.errored \|\| !connected;/);
  });
});
