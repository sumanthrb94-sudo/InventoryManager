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
}

export interface ProcessReturnSalePatch {
  voidedAt: string;
  voidReason: string;
  voidOutcome: 'refund' | 'replacement' | 'repair';
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
  };
}
