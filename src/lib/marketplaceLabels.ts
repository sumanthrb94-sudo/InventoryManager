/**
 * marketplaceLabels.ts — one place that knows AMAZON is "Amazon" and BM is
 * "Backmarket".
 *
 * Sales are stored under canonical marketplace codes — AMAZON, BM, EBAY,
 * ONBUY — because that is what the marketplace workbooks are named. Screens
 * show friendly labels. The translation between the two was written out by
 * hand in three separate components, and one of them didn't have it at all:
 * the Analytics Platform Scorecard compared `unit.salePlatform` directly
 * against `['eBay', 'Amazon', 'OnBuy', 'Backmarket']`.
 *
 * `salePlatform` is written as `sale.marketplace`, so it holds 'AMAZON', not
 * 'Amazon' — and 'BM', which is not 'Backmarket' under any casing. Nothing
 * ever matched. On a live system with 354 sales the scorecard read zero
 * across all four platforms, and every one of them looked equally idle.
 *
 * Matching is deliberately tolerant here: a `salePlatform` may hold either a
 * canonical code (imported sales) or an already-friendly label (units sold
 * through the in-app flows, which write 'eBay' directly). Both have to
 * resolve, because both are in the live data.
 */
import type { Marketplace } from '../types';
import { MARKETPLACES } from '../types';

/** Canonical code → the label operators recognise. */
export const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  AMAZON: 'Amazon',
  BM: 'Backmarket',
  EBAY: 'eBay',
  ONBUY: 'OnBuy',
  TEMU: 'Temu',
};

/** Display labels, in the canonical marketplace order. */
export const MARKETPLACE_LABELS: string[] = MARKETPLACES.map(m => MARKETPLACE_LABEL[m]);

/** Every spelling a stored value might use for each marketplace. */
const ALIASES: Record<Marketplace, string[]> = {
  AMAZON: ['amazon', 'amz', 'fba'],
  BM: ['bm', 'backmarket', 'back market'],
  EBAY: ['ebay', 'e-bay'],
  ONBUY: ['onbuy', 'on buy'],
  TEMU: ['temu'],
};

/**
 * Resolve any stored platform string to its canonical marketplace.
 *
 * Returns null for values that genuinely aren't a marketplace ('R T S',
 * 'Other', ''), so callers can bucket them rather than silently folding
 * them into a real platform's numbers.
 */
export function marketplaceOf(raw: string | undefined | null): Marketplace | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  for (const m of MARKETPLACES) {
    if (ALIASES[m].includes(s)) return m;
  }
  return null;
}

/** True when a stored platform value belongs to the given marketplace. */
export function isMarketplace(raw: string | undefined | null, m: Marketplace): boolean {
  return marketplaceOf(raw) === m;
}

/** Friendly label for a stored platform value; falls back to the raw text so
 *  an unrecognised platform is visible rather than blank. */
export function labelFor(raw: string | undefined | null): string {
  const m = marketplaceOf(raw);
  return m ? MARKETPLACE_LABEL[m] : (raw ?? '').trim();
}
