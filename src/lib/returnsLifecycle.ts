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
import type { InventoryUnit, ReturnEvent, ReturnEventType, Sale } from '../types';

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

/** Where a unit stands right now, distilled to one of a few stable states.
 *  Drives the Returns Report's life-status badge. */
export type LifeState = 'sold' | 'available' | 'in_repair' | 'to_supplier' | 'unknown';

export interface UnitLifeSummary {
  /** Current resting state of the unit. */
  state: LifeState;
  /** ISO date the unit was (most recently) sold, when state === 'sold'. */
  soldDate?: string;
  /** Sale price of the current/most-recent active sale, when sold. */
  salePrice?: number;
  /** Buy price carried on the unit — the cost side for later P&L. */
  buyPrice?: number;
  /** Outbound postage on the active sale, when sold. */
  postageCost?: number;
  /** Active (non-voided) sale margin = sale − buy − postage. Only when sold;
   *  this is the seed for the eventual returns P&L, not a final figure. */
  grossMargin?: number;
  /** How many times this unit has been SOLD overall (active + voided sales).
   *  A unit returned 10× then sold the 11th time reads timesSold = 11. */
  timesSold: number;
  /** How many of those sales were later returned (voided). */
  timesReturned: number;
}

/** Derive a unit's current life summary from its inventory doc plus the sale
 *  rows linked to it. A returned sale is kept but flagged `voidedAt`, so the
 *  voided count IS the number of completed sell→return round-trips, and an
 *  active (non-voided) sale means the unit is currently sold.
 *
 *  Pure + side-effect free so the Returns Report and tests share one source
 *  of truth for the "is it available or sold, and when" question. */
export function summarizeUnitLife(
  unit: InventoryUnit | null | undefined,
  salesForUnit: Sale[] = [],
): UnitLifeSummary {
  const active = salesForUnit.filter(s => !s.voidedAt);
  const voided = salesForUnit.filter(s => !!s.voidedAt);
  // Most recent active sale (by saleDate) drives the "sold" figures.
  const latestActive = active
    .slice()
    .sort((a, b) => cmpStr(b.saleDate, a.saleDate))[0];

  const buyPrice = unit?.buyPrice ?? latestActive?.buyPrice;

  let state: LifeState;
  if (unit?.status === 'sold' || latestActive) state = 'sold';
  else if (unit?.returnType === 'returned_to_supplier') state = 'to_supplier';
  else if (unit?.returnType === 'repair' || unit?.status === 'returned') state = 'in_repair';
  else if (unit?.status === 'available') state = 'available';
  else state = unit ? 'unknown' : 'to_supplier'; // no unit doc ⇒ soft-deleted to supplier

  const soldDate = state === 'sold' ? (unit?.saleDate ?? latestActive?.saleDate) : undefined;
  const salePrice = state === 'sold' ? (unit?.salePrice ?? latestActive?.salePrice) : undefined;
  const postageCost = state === 'sold' ? (unit?.postageCost ?? undefined) : undefined;
  const grossMargin =
    state === 'sold' && salePrice != null && buyPrice != null
      ? salePrice - buyPrice - (postageCost ?? 0)
      : undefined;

  return {
    state,
    soldDate,
    salePrice,
    buyPrice,
    postageCost,
    grossMargin,
    timesSold: active.length + voided.length,
    timesReturned: voided.length,
  };
}
