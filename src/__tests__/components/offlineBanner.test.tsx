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
  it('renders on the sync flag, not on some derived guess', () => {
    expect(APP).toMatch(/\{!syncConnected && loaded && \(/);
  });

  it('says the zeros are a read failure, not missing data', () => {
    const banner = APP.slice(APP.indexOf('{!syncConnected && loaded && ('));
    expect(banner).toMatch(/Can’t reach the database/);
    expect(banner).toMatch(/because nothing could be/);
  });

  /** The load-bearing half. Naming the danger is what stops the reader
   *  reaching for the two controls that make it unrecoverable. */
  it('tells the operator not to wipe or import while it is showing', () => {
    const banner = APP.slice(APP.indexOf('{!syncConnected && loaded && ('));
    expect(banner).toMatch(/Do not wipe and do not import/);
  });

  it('sits above the stale-bundle banner so the two cannot cover each other', () => {
    const offline = APP.indexOf('z-[110]');
    const stale = APP.indexOf('z-[100]');
    expect(offline).toBeGreaterThan(-1);
    expect(stale).toBeGreaterThan(-1);
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
});
