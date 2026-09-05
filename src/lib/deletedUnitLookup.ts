/**
 * "Has this handset been removed from inventory before?"
 *
 * Asked on the intake screens, where an operator is typing IMEIs one after
 * another and a phone that failed QC and was scrapped must not quietly come
 * back into stock.
 *
 * THE READ COST IS THE WHOLE DESIGN. This runs per IMEI on Add Stock and per
 * scan on Bulk Order, and the answer for almost every IMEI is "no". So:
 *
 *   - it is a POINT QUERY, never a subscription — the archive grows without
 *     bound and mirroring it into every session that opens Add Stock is the
 *     cost LazyCollection exists to avoid;
 *   - MISSES ARE CACHED. Caching only the hits would leave the common case
 *     billing a read every single time, which is how a quota gets burned
 *     through in an afternoon — this app has already lost two days to exactly
 *     that failure;
 *   - concurrent asks for the same IMEI share one in-flight promise, so
 *     pasting forty rows that repeat an IMEI issues one query, not forty.
 *
 * The cache is per session and never invalidated: a deletion recorded after
 * the page loaded is not visible until reload. That is the right trade here —
 * the archive is append-only and a deletion made in another tab seconds ago is
 * not what these screens are guarding against.
 */
import { dbService } from './dbService';
import { normaliseImeiKey } from './imeiValidation';
import type { DeletedUnitRecord } from '../types';

/** null = looked up, definitively never deleted. Distinct from "not looked up". */
const cache = new Map<string, DeletedUnitRecord | null>();
const inFlight = new Map<string, Promise<DeletedUnitRecord | null>>();

/**
 * The most recent NON-VOID deletion of this IMEI, or null.
 *
 * Void records are skipped, not returned: a voided record is one whose archive
 * write landed but whose delete then failed, so the unit is still in stock.
 * Warning about it would be a lie, and a permanent one — the collection is
 * append-only, so the record never goes away.
 *
 * Never throws. A lookup failure must not block stock intake; the worst case
 * of a missed warning is today's behaviour, while a thrown error would break
 * the form outright.
 */
export async function lookupDeletedUnit(
  rawImei: string | undefined | null,
): Promise<DeletedUnitRecord | null> {
  const key = normaliseImeiKey(rawImei);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = (async () => {
    try {
      const rows = (await dbService.queryDeletedUnitsByImei(key)) as DeletedUnitRecord[];
      const live = (rows || [])
        .filter(r => !r.voided)
        // The service orders by deletedAt, but a cache hit is sorted client-side
        // and a record written without deletedAt would sort unpredictably. Sort
        // here too so "the newest deletion" means the same thing either way.
        .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
      const found = live[0] ?? null;
      cache.set(key, found);
      return found;
    } catch (err: any) {
      // Deliberately NOT cached: a network blip must not turn into a
      // session-long "never deleted" answer for this IMEI.
      console.warn('[deletedUnitLookup] lookup failed', key, err?.message);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

/** Look several IMEIs up at once — one shared round of the same cache. */
export async function lookupDeletedUnits(
  imeis: Array<string | undefined | null>,
): Promise<Map<string, DeletedUnitRecord>> {
  const keys = Array.from(new Set(imeis.map(normaliseImeiKey).filter(Boolean)));
  const out = new Map<string, DeletedUnitRecord>();
  const found = await Promise.all(keys.map(k => lookupDeletedUnit(k)));
  keys.forEach((k, i) => { const r = found[i]; if (r) out.set(k, r); });
  return out;
}

/**
 * The warning line, as the operator reads it.
 *
 * The reason is stored verbatim, junk included — 139 existing deletions carry
 * a reason like "." — so a blank or punctuation-only reason renders as
 * "no reason recorded" rather than as a dangling separator that reads like a
 * rendering bug.
 */
export function describeDeletion(rec: DeletedUnitRecord): string {
  const reason = (rec.reason || '').trim();
  const meaningful = /[a-z0-9]/i.test(reason) ? reason : '(no reason recorded)';
  const parts = [
    'Previously removed from inventory',
    meaningful,
    formatDeletionDate(rec.deletedAt),
    rec.deletedBy ? `by ${rec.deletedBy}` : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

/** `2026-09-05T…` → `5 Sept 2026`; anything unparseable is passed through. */
export function formatDeletionDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Test seam, and the reset a full data wipe needs. */
export function resetDeletedUnitLookupCache(): void {
  cache.clear();
  inFlight.clear();
}
