/**
 * Reading a timestamp field that arrives in more than one shape.
 *
 * THE BUG THIS EXISTS TO KILL
 *
 * `updatedAt` / `createdAt` are written with serverTimestamp(), so once a doc
 * has round-tripped through Firestore they come back as a Timestamp OBJECT
 * with a .toDate() method. In the E2E shim — and on a freshly-created doc
 * before the write settles — the same field is a plain ISO STRING.
 *
 * `new Date(timestampObject)` does not throw. It returns Invalid Date, whose
 * getTime() is NaN, and a `NaN >= cutoff` comparison is silently false. So a
 * rolling-window filter written against the string shape does not error on
 * real data — it quietly matches NOTHING, and the tile reads 0 forever.
 *
 * That is exactly how "Sold Today" on the Buy screen came to read 0 while the
 * Sell screen read 2 off the same database: Sell counts sale docs by their
 * `saleDate` (a plain string, always fine), Buy counted units by `updatedAt`.
 *
 * It is also why the whole E2E suite passed. The shim stores ISO strings, so
 * every test exercised the one shape that works. Any test for this has to
 * feed BOTH shapes or it reproduces the blind spot instead of catching it.
 */

/** A Firestore Timestamp, without importing the SDK type into every caller. */
interface TimestampLike {
  toDate: () => Date;
}

const isTimestampLike = (v: unknown): v is TimestampLike =>
  !!v && typeof (v as TimestampLike).toDate === 'function';

/**
 * Milliseconds since the epoch for a timestamp field, or NaN when the value
 * carries no usable time.
 *
 * Accepts every shape these fields actually take: a Firestore Timestamp, an
 * ISO string, a Date, or epoch millis. Returns NaN rather than throwing or
 * defaulting to 0 — a caller comparing against a cutoff must be able to tell
 * "no timestamp" apart from "1 January 1970", which would otherwise land
 * inside any window that reaches back far enough.
 */
export function toMillis(value: unknown): number {
  if (value == null) return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value instanceof Date) return value.getTime();
  if (isTimestampLike(value)) {
    try { return value.toDate().getTime(); } catch { return NaN; }
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return NaN;
    // A bare yyyy-mm-dd is midday local, not midnight UTC — the operator
    // works in IST, and a date-only value bucketed at 00:00Z lands on the
    // previous day for them.
    const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

/**
 * True when a timestamp falls inside the last `hours`, reading the first field
 * that carries a usable time.
 *
 * Falls through the candidates rather than taking the first non-null one: a
 * Timestamp that fails to convert should hand over to `saleDate`, not veto the
 * row. The original code used `a ?? b`, which stopped at the truthy-but-
 * unreadable Timestamp object and discarded a perfectly good date behind it.
 */
export function withinLastHours(hours: number, ...candidates: unknown[]): boolean {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  for (const c of candidates) {
    const t = toMillis(c);
    if (Number.isFinite(t)) return t >= cutoff;
  }
  return false;
}

/**
 * The local calendar day ('YYYY-MM-DD') a timestamp falls on, or '' when it
 * carries no usable time.
 *
 * LOCAL, deliberately. toISOString() would bucket by UTC, and the operator
 * works in IST — an evening sale lands on the following UTC day and drops out
 * of "today" for them. Local date parts are what the Sell screen has always
 * used, so this is the rule both screens can share.
 */
export function localDay(value: unknown): string {
  const t = toMillis(value);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today, as the operator's calendar sees it. */
export const localToday = (): string => localDay(Date.now());

/**
 * True when a timestamp falls on the given local day (today by default).
 *
 * Use this — not a rolling window over `updatedAt` — for anything the
 * operator reads as "today". `updatedAt` is the last write to the doc FOR ANY
 * REASON: processing a return, completing a repair, an admin edit. A sold unit
 * touched today is not a unit sold today, and counting it as one made the Buy
 * screen read 5 while the Sell screen read 2 off the same database.
 */
export function isSameLocalDay(value: unknown, day: string = localToday()): boolean {
  const d = localDay(value);
  return !!d && d === day;
}
