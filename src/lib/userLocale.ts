// Timezone-aware date display helpers, parameterised by the user's region.
//
// Currency stays GBP everywhere — the master file is GBP and both regions
// transact in £. Only date/time presentation is region-aware. Underlying
// storage stays ISO/UTC; we only shift on render.

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, userRegion, type UserRegion } from './firebase';

/** Resolve an IANA timezone for the given region. */
export function userTimeZone(region: UserRegion): string {
  switch (region) {
    case 'uk':    return 'Europe/London';
    case 'india': return 'Asia/Kolkata';
    case 'admin': return 'Europe/London'; // admin runs the master UK view
    default:      return 'Europe/London';
  }
}

/**
 * Format an ISO date string ("2026-05-16" or full timestamp) as `DD MMM YYYY`
 * in the user's timezone. Empty / falsy input returns ''.
 */
export function fmtDateForUser(iso: string, region: UserRegion): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: userTimeZone(region),
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(d);
}

/**
 * Parse any saleDate / dateIn / returnDate value into a sortable epoch-ms
 * number. Handles every format any writer in the app might produce:
 *   - ISO yyyy-mm-dd strings (the canonical form)
 *   - DMY strings like "29-Mar-2026" or "29 Mar 2026"
 *   - MDY strings like "3/29/2026"
 *   - JS Date objects
 *   - Firestore Timestamp objects (duck-typed via .toDate())
 *   - Excel serial numbers
 *   - null / undefined / empty (returns -Infinity so they cluster correctly)
 *
 * Why this exists: a `localeCompare` on saleDate strings sorts
 * lexicographically — fine for ISO ('2026-03-29' < '2026-04-01' ✓) but
 * wrong for DMY/word formats ('29 Mar' > '1 Apr' because '2' > '1').
 * That bug surfaced when sales rendered with March 29 above April 1
 * in a descending sort. Routing all sort sites through this helper
 * collapses to a single chronological axis regardless of input shape.
 */
export function parseSaleDate(v: unknown): number {
  if (v == null || v === '') return -Infinity;
  // Firestore Timestamp duck-type — survives client-side reads in this
  // app without losing data even though our types.ts declares the field
  // as `string`. Defensive: real strings won't have .toDate().
  if (typeof v === 'object') {
    const td = (v as { toDate?: () => Date }).toDate;
    if (typeof td === 'function') {
      const d = td.call(v);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
    }
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
    return -Infinity;
  }
  if (typeof v === 'number') {
    // Excel-serial heuristic: small positive integers are days-since-1900;
    // anything else is treated as a raw epoch-ms timestamp.
    if (v > 20000 && v < 80000) {
      // Excel 1900-leap-bug adjusted: 25569 = 1970-01-01 in Excel's frame.
      const ms = (v - 25569) * 86400000;
      if (Number.isFinite(ms)) return ms;
    }
    return Number.isFinite(v) ? v : -Infinity;
  }
  const s = String(v).trim();
  if (!s) return -Infinity;
  // Try ISO first (fast path — most sale docs land here).
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const ms = Date.UTC(+y, +m - 1, +d);
    if (Number.isFinite(ms)) return ms;
  }
  // DMY with named month: "29-Mar-2026", "29 Mar 2026", "29/Mar/2026",
  // "29-March-2026", etc.
  const dmyNamed = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/.exec(s);
  if (dmyNamed) {
    const [, d, mon, y] = dmyNamed;
    const m = monthFromName(mon);
    if (m >= 0) return Date.UTC(+y, m, +d);
  }
  // DMY all-numeric: "29-03-2026" / "29/03/2026" — UK convention.
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return Date.UTC(+y, +m - 1, +d);
  }
  // Final fallback — JS Date constructor (covers RFC 2822, "Mar 29 2026", etc).
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  return -Infinity;
}

function monthFromName(name: string): number {
  const k = name.slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return map[k] ?? -1;
}

/**
 * Format an ISO timestamp / Date as `DD MMM YYYY, HH:MM` in the user's
 * timezone. Accepts either an ISO string or a Date — null/empty returns ''.
 */
export function fmtDateTimeForUser(
  iso: string | Date | null | undefined,
  region: UserRegion,
): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: userTimeZone(region),
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/**
 * React hook returning the current signed-in user's region. Re-renders when
 * auth state changes (sign-in / sign-out). Falls back to 'both' before auth
 * resolves and for any user that isn't on the UK/India allowlists.
 */
export function useUserRegion(): UserRegion {
  const [region, setRegion] = useState<UserRegion>(() => userRegion(auth.currentUser));
  useEffect(() => onAuthStateChanged(auth, (u: User | null) => setRegion(userRegion(u))), []);
  return region;
}
