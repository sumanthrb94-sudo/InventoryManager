/**
 * returnsLifecycle.ts — pure helpers for the per-IMEI return lifecycle.
 *
 * The `returnEvents` collection stores one dated row per return action, keyed
 * by IMEI (not unitId) so a unit that is sold, returned-to-inventory, sold
 * again and returned again — any number of times — keeps a single continuous,
 * date-ordered history under its IMEI. These functions are the single source
 * of truth for turning that flat event list into per-IMEI timelines; the
 * Returns Report UI and the tests both consume them, so the on-screen story
 * and the verified behaviour can never drift apart.
 *
 * Everything here is pure (no Firestore, no React) and therefore fully unit
 * testable.
 */
import type { ReturnEvent, ReturnEventType } from '../types';

/** Canonical key for an IMEI: trimmed + upper-cased, with a stable sentinel
 *  for missing IMEIs so eventless/serial-less rows still group deterministically. */
export function normalizeImei(imei: string | null | undefined): string {
  const s = (imei ?? '').trim().toUpperCase();
  return s || '(no-imei)';
}

function cmpStr(a: string | undefined | null, b: string | undefined | null): number {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/** Total order, newest-first: date desc, then createdAt desc, then id desc.
 *  The secondary keys keep multiple same-day events deterministically ordered. */
export function compareEventsNewestFirst(a: ReturnEvent, b: ReturnEvent): number {
  return (
    cmpStr(b.date, a.date) ||
    cmpStr(String(b.createdAt ?? ''), String(a.createdAt ?? '')) ||
    cmpStr(b.id, a.id)
  );
}

/**
 * Group events by IMEI. Within each bucket events are newest-first; buckets
 * are returned as [imei, events][] ordered by each bucket's most-recent event
 * date (descending) — exactly what the Returns Report renders.
 */
export function groupReturnEventsByImei(events: ReturnEvent[]): Array<[string, ReturnEvent[]]> {
  const m = new Map<string, ReturnEvent[]>();
  for (const e of events) {
    const k = normalizeImei(e.imei);
    const bucket = m.get(k);
    if (bucket) bucket.push(e); else m.set(k, [e]);
  }
  for (const arr of m.values()) arr.sort(compareEventsNewestFirst);
  return Array.from(m.entries()).sort((a, b) =>
    compareEventsNewestFirst(a[1][0], b[1][0]),
  );
}

/**
 * Chronological (oldest → newest) timeline for a single IMEI — the natural
 * order for telling the unit's story: "sold-then-returned on 2 Jan, restocked
 * 3 Jan, sold-then-returned again 1 Feb …".
 */
export function unitReturnTimeline(events: ReturnEvent[], imei: string): ReturnEvent[] {
  const k = normalizeImei(imei);
  return events
    .filter(e => normalizeImei(e.imei) === k)
    .sort((a, b) => -compareEventsNewestFirst(a, b));
}

/** The most recent event for an IMEI, or null if it has no history. */
export function latestReturnEvent(events: ReturnEvent[], imei: string): ReturnEvent | null {
  const timeline = unitReturnTimeline(events, imei);
  return timeline.length ? timeline[timeline.length - 1] : null;
}

/** Count events of a given lifecycle type for one IMEI. */
export function countEventsOfType(
  events: ReturnEvent[],
  imei: string,
  type: ReturnEventType,
): number {
  const k = normalizeImei(imei);
  return events.filter(e => normalizeImei(e.imei) === k && e.type === type).length;
}

/**
 * How many times a unit has completed the "returned → back to inventory"
 * round trip. A back-to-inventory return logs a `restocked` event, so the
 * restock count IS the number of times the unit was returned-and-resold-ready.
 */
export function backToInventoryCount(events: ReturnEvent[], imei: string): number {
  return countEventsOfType(events, imei, 'restocked');
}

/** Per-type tally for one IMEI, e.g. { restocked: 5, sent_to_supplier: 1 }. */
export function dispositionCounts(
  events: ReturnEvent[],
  imei: string,
): Partial<Record<ReturnEventType, number>> {
  const k = normalizeImei(imei);
  const out: Partial<Record<ReturnEventType, number>> = {};
  for (const e of events) {
    if (normalizeImei(e.imei) !== k) continue;
    out[e.type] = (out[e.type] ?? 0) + 1;
  }
  return out;
}
