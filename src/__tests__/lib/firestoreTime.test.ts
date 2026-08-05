/**
 * The shape bug that made "Sold Today" read 0 on the Buy screen while the
 * Sell screen read 2 off the same database.
 *
 * `updatedAt` is written with serverTimestamp(). Once a doc has round-tripped
 * through Firestore it comes back as a Timestamp OBJECT with .toDate(). In the
 * E2E shim, and on a doc whose write has not settled, the same field is a
 * plain ISO STRING.
 *
 * `new Date(timestampObject)` returns Invalid Date. It does not throw. Its
 * getTime() is NaN, and `NaN >= cutoff` is false. So the rolling-window filter
 * did not error on real data — it matched nothing, every time, and the tile
 * read 0 permanently.
 *
 * EVERY TEST IN THIS REPO PASSED THROUGH THAT. The E2E shim stores ISO
 * strings, so the whole suite only ever exercised the shape that works. A test
 * that feeds strings alone reproduces the blind spot rather than catching it,
 * which is why every case below is run against BOTH shapes.
 */
import { describe, it, expect } from 'vitest';
import { toMillis, withinLastHours } from '../../lib/firestoreTime';

/** What Firestore actually hands back for a serverTimestamp() field. */
const timestamp = (d: Date) => ({ toDate: () => d });

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

describe('reading a timestamp field, whatever shape it arrives in', () => {
  it('reads a Firestore Timestamp object', () => {
    const d = hoursAgo(1);
    expect(toMillis(timestamp(d))).toBe(d.getTime());
  });

  it('reads an ISO string', () => {
    expect(toMillis('2026-08-05T14:42:00.000Z'))
      .toBe(new Date('2026-08-05T14:42:00.000Z').getTime());
  });

  it('reads a Date and epoch millis', () => {
    const d = hoursAgo(3);
    expect(toMillis(d)).toBe(d.getTime());
    expect(toMillis(d.getTime())).toBe(d.getTime());
  });

  it('puts a bare yyyy-mm-dd at midday, not midnight UTC', () => {
    // The operator works in IST. A date-only value bucketed at 00:00Z lands on
    // the previous day for them, which is how evening sales used to fall out
    // of "today".
    expect(toMillis('2026-08-05')).toBe(new Date('2026-08-05T12:00:00').getTime());
  });

  it('returns NaN — not 0 — for nothing usable', () => {
    // 0 would be 1 January 1970, which sits inside any window reaching far
    // enough back, so a missing timestamp would silently count as recent.
    for (const v of [null, undefined, '', '   ', 'not a date', {}, { toDate: 'nope' }]) {
      expect(Number.isNaN(toMillis(v)), `${JSON.stringify(v)} should be NaN`).toBe(true);
    }
  });

  it('returns NaN when a Timestamp throws instead of converting', () => {
    expect(Number.isNaN(toMillis({ toDate: () => { throw new Error('bad'); } }))).toBe(true);
  });
});

describe('the rolling window agrees across both shapes', () => {
  it.each([
    ['Firestore Timestamp', (d: Date) => timestamp(d) as unknown],
    ['ISO string', (d: Date) => d.toISOString() as unknown],
    ['Date', (d: Date) => d as unknown],
  ])('a sale 1 hour ago is inside 24h — as a %s', (_label, shape) => {
    expect(withinLastHours(24, shape(hoursAgo(1)))).toBe(true);
  });

  it.each([
    ['Firestore Timestamp', (d: Date) => timestamp(d) as unknown],
    ['ISO string', (d: Date) => d.toISOString() as unknown],
  ])('a sale 30 hours ago is outside 24h — as a %s', (_label, shape) => {
    expect(withinLastHours(24, shape(hoursAgo(30)))).toBe(false);
  });

  it('THE REGRESSION: a Timestamp inside the window counts', () => {
    // This is the exact assertion the old code failed. It read the Timestamp
    // as Invalid Date and answered false for a sale made an hour ago.
    const soldAnHourAgo = timestamp(hoursAgo(1));
    expect(withinLastHours(24, soldAnHourAgo), 'sold an hour ago is "today"').toBe(true);

    // And the old expression, kept here to show what it actually did.
    const old = new Date(soldAnHourAgo as unknown as string).getTime();
    expect(Number.isNaN(old), 'the old code produced NaN').toBe(true);
    expect(old >= Date.now() - 24 * 60 * 60 * 1000, 'which compared false').toBe(false);
  });
});

describe('falling through to the next candidate', () => {
  it('uses saleDate when updatedAt is unreadable', () => {
    // `a ?? b` stopped at the truthy-but-unusable Timestamp and threw away a
    // perfectly good date sitting behind it. Falling through is the fix.
    const brokenStamp = { toDate: () => { throw new Error('bad'); } };
    const today = new Date().toISOString().slice(0, 10);
    expect(withinLastHours(24, brokenStamp, today)).toBe(true);
  });

  it('uses saleDate when updatedAt is missing entirely', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(withinLastHours(24, undefined, today)).toBe(true);
  });

  it('does NOT fall through past a readable value that says "old"', () => {
    // A unit legitimately updated 30 hours ago must not be rescued by a
    // saleDate that happens to be today — the first usable answer wins.
    const today = new Date().toISOString().slice(0, 10);
    expect(withinLastHours(24, timestamp(hoursAgo(30)), today)).toBe(false);
  });

  it('is false when nothing at all is readable', () => {
    expect(withinLastHours(24, null, undefined, '')).toBe(false);
  });
});

describe('what the two screens now agree on', () => {
  /** Buy counts UNITS flipped to sold; the shape of updatedAt decides. */
  const buySoldToday = (units: Array<{ status: string; updatedAt?: unknown; saleDate?: string }>) =>
    units.filter(u => u.status === 'sold' && withinLastHours(24, u.updatedAt, u.saleDate));

  /** Sell counts SALE docs by their own saleDate — always a plain string. */
  const sellSoldToday = (sales: Array<{ saleDate: string; voidedAt?: string }>) => {
    const today = new Date().toISOString().slice(0, 10);
    return sales.filter(s => !s.voidedAt && s.saleDate === today);
  };

  it('two sales today are two on BOTH screens, with a Firestore-shaped unit', () => {
    // Before the fix this was 0 and 2 — the operator's screenshots exactly.
    const today = new Date().toISOString().slice(0, 10);
    const units = [
      { status: 'sold', updatedAt: timestamp(hoursAgo(2)), saleDate: today },
      { status: 'sold', updatedAt: timestamp(hoursAgo(3)), saleDate: today },
      { status: 'available', updatedAt: timestamp(hoursAgo(1)) },
    ];
    const sales = [{ saleDate: today }, { saleDate: today }];

    expect(buySoldToday(units)).toHaveLength(2);
    expect(sellSoldToday(sales)).toHaveLength(2);
    expect(buySoldToday(units).length).toBe(sellSoldToday(sales).length);
  });
});
