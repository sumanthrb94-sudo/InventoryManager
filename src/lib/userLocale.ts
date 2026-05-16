// Timezone-aware date display helpers, parameterised by the user's region.
//
// Currency stays GBP everywhere — the master file is GBP and both regions
// transact in £. Only date/time presentation is region-aware. Underlying
// storage stays ISO/UTC; we only shift on render.

import type { UserRegion } from './firebase';

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
