/**
 * Pure helper for ProcessReturnModal's Sale-doc patch. Extracted from
 * src/components/ReturnsPage.tsx so the write contract is unit-testable
 * (the React modal is impractical to drive in a vitest run).
 *
 * The contract was the root cause of two consecutive QA blockers:
 *   - round 3 BUG-RP-002: post-completion repair re-classified as refund
 *     because the canonical signal lived on the mutable unit doc.
 *   - round 4 BUG-RP-003: same symptom resurfaced on a stale deploy that
 *     was still writing voidOutcome: 'refund' for repair-route voids
 *     (OBS-1's "Refund — …" voidReason prefix proves the deploy was
 *     pre-this-fix).
 *
 * Anything that consumes a voided Sale (Sales/Returns workbooks, in-app
 * Lifecycle table, Excel preview, KPI counters) keys off Sale.voidOutcome.
 * This helper enforces the only correct mapping at the write side.
 */
import type { ReturnCategory } from '../types';

export interface ProcessReturnSalePatchInput {
  /** Destination chosen by the operator (returned_to_inventory / repair /
   *  returned_to_supplier). The Send-for-Repair route is the special case
   *  with no customer outcome. */
  returnType: ReturnCategory;
  /** Customer outcome radio. Defaults to 'refund' in the modal even when
   *  the radio is hidden for the repair route — DO NOT trust it directly,
   *  always gate on returnType first. */
  outcome: 'refund' | 'replacement';
  /** ISO date typed in the modal (YYYY-MM-DD). */
  returnDate: string;
  /** Operator-entered reason, already trimmed by the caller. */
  reason: string;
  /** The sale's own date (YYYY-MM-DD). Needed only for the repair route,
   *  where the warranty clock decides whether the customer got their money
   *  back. Absent falls back to "refunded", which is the behaviour every
   *  return had before this and the safer of the two for the P&L. */
  saleDate?: string;
}

export interface ProcessReturnSalePatch {
  voidedAt: string;
  voidReason: string;
  voidOutcome: 'refund' | 'replacement' | 'repair';
  /** Did the customer actually get their money back?
   *
   *  Voiding a sale removes its revenue from every Sell-side surface, which
   *  is right when the money went back and wrong when it did not. Two routes
   *  keep the revenue:
   *    - a replacement (the customer keeps what they paid, and gets a
   *      handset for it)
   *    - a repair after the warranty refund window (free repair, no refund)
   *  Recorded on the sale rather than derived at read time so a report run
   *  next year cannot re-decide it. */
  customerRefunded: boolean;
  /** Marks a return processed under the corrected profit basis.
   *
   *  Returns already in the database keep the old basis: their rows still
   *  show the original gross profit. Only returns stamped with this are
   *  recalculated, which is what makes "from today onward" a fact about the
   *  data rather than a promise about a deploy date. */
  gpBasis: 'returns_v2';
}

/** Warranty refund window. Inside it the customer is refunded in full;
 *  after it the repair or replacement is free but the money stays paid. */
export const WARRANTY_REFUND_DAYS = 30;

/** Whole days between two ISO dates. Negative if the return predates the
 *  sale, which a bad date entry can produce — treated as inside the window. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Did this return put money back in the customer's pocket?
 *
 *  Exported so the rule is testable on its own — it is the hinge the whole
 *  profit correction swings on, and burying it inside the patch builder
 *  would make the 30-day boundary awkward to pin down in a test. */
export function customerWasRefunded(input: ProcessReturnSalePatchInput): boolean {
  if (input.returnType === 'repair') {
    if (!input.saleDate) return true;
    return daysBetween(input.saleDate, input.returnDate) <= WARRANTY_REFUND_DAYS;
  }
  // Replacement: the customer keeps what they paid and receives a handset.
  return input.outcome !== 'replacement';
}

/** Build the patch applied to every linked Sale doc when a return is
 *  processed. Send-for-Repair always wins over the radio's default. */
export function processReturnSalePatch(input: ProcessReturnSalePatchInput): ProcessReturnSalePatch {
  const voidOutcome: 'refund' | 'replacement' | 'repair' =
    input.returnType === 'repair' ? 'repair' : input.outcome;
  const prefix =
    voidOutcome === 'repair'      ? 'In Repair'
    : voidOutcome === 'replacement' ? 'Replacement'
    :                                 'Refund';
  return {
    voidedAt: input.returnDate,
    voidReason: `${prefix} — ${input.reason}`,
    voidOutcome,
    customerRefunded: customerWasRefunded(input),
    gpBasis: 'returns_v2',
  };
}
