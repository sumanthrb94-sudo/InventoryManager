/**
 * What a return actually costs.
 *
 * WHY THIS EXISTS
 *
 * Until now the only cost a return recorded was carriage: `postageLossFor`
 * charges (postage + P.VAT) × legs and nothing else. The operator's returns
 * policy makes clear that carriage is the SMALLEST of the four costs:
 *
 *   route         carriage        the cost that was missing
 *   ─────────────────────────────────────────────────────────────────────
 *   refund        2 legs          (none — the unit comes back saleable)
 *   repair        2 legs          the repair invoice
 *   replacement   3 legs          a whole second handset
 *   to supplier   2 legs          offset by the credit that comes back
 *
 * On a £300 handset a replacement was recording ~£24 of loss against a real
 * ~£324. That is the single biggest error in the returns economics, and it is
 * why a returned unit could still read as profitable.
 *
 * RECORDED ZERO IS NOT THE SAME AS NOT RECORDED
 *
 * Every one of the new costs is entered by a human after the fact — the repair
 * invoice arrives days later, the supplier credit lands separately. So this
 * module distinguishes "£0" from "nobody has told us yet" and reports the
 * second as a `gaps` entry. A total that silently treats an un-invoiced repair
 * as free is exactly the class of error this whole exercise is correcting;
 * callers should surface `gaps` rather than present `total` as final.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *   - It does not discount a replacement by the resale value of the faulty
 *     unit that came back. The operator's ruling is that a replacement costs
 *     a whole second handset; the recovery arrives later as that returned
 *     unit's own sale, which the app already counts. Netting it here would
 *     count the recovery twice.
 *   - It does not touch marketplace commission. Whether a refund credits the
 *     fees back is still open with the operator ("mostly yes, will follow
 *     up"), and per channel. Until that is settled, fees are out of scope
 *     here rather than guessed at.
 *   - It does not decide which accounting PERIOD the cost falls in. The
 *     operator wants costs in the period the item was RETURNED; that is a
 *     reporting concern and belongs to the caller that has the period.
 */

import type { InventoryUnit, Sale } from '../types';

/** A cost this return should carry that nobody has recorded yet. */
export type ReturnCostGap = 'repair_invoice' | 'replacement_handset' | 'supplier_credit';

export interface ReturnCostBreakdown {
  /** Carriage: (postage + P.VAT) × legs. Same figure `postageLossFor` gives. */
  postage: number;
  /** Repair invoice for this cycle, £. 0 when not a repair or not yet entered. */
  repair: number;
  /** Purchase price of the second handset shipped as a replacement, £. */
  replacementHandset: number;
  /** Money (or value in kind) recovered from the supplier, £. Reduces the total. */
  supplierCredit: number;
  /** postage + repair + replacementHandset − supplierCredit. */
  total: number;
  /** Costs that apply to this return but have not been entered. When this is
   *  non-empty, `total` is a floor, not the answer. */
  gaps: ReturnCostGap[];
}

/** The customer-facing route, resolved from the most trustworthy signal available.
 *
 *  Sale.voidOutcome wins: it is snapshotted on the immutable sale doc at void
 *  time, whereas the unit's returnType is mutable and gets overwritten when a
 *  repaired unit goes back on the shelf (it flips to 'returned_to_inventory',
 *  silently re-classifying a historical repair as a refund — BUG-RP-002). */
export function returnRouteFor(
  unit: Pick<InventoryUnit, 'returnType' | 'returnOutcome' | 'repairedAt'> | null | undefined,
  sale?: Pick<Sale, 'voidedAt' | 'voidOutcome'> | null,
): 'refund' | 'replacement' | 'repair' | null {
  if (sale?.voidedAt && sale.voidOutcome) return sale.voidOutcome;
  if (!unit) return null;
  if (unit.returnType === 'repair' || unit.repairedAt) return 'repair';
  if (unit.returnOutcome) return unit.returnOutcome;
  return unit.returnType ? 'refund' : null;
}

/** Cost of one carriage leg (postage + P.VAT), from the snapshot the return
 *  took, falling back to the live sale and then to the unit's own postage. */
function legCostFor(unit: InventoryUnit, sale?: Sale | null): number {
  if (typeof unit.returnLegCost === 'number') return unit.returnLegCost;
  if (sale) {
    const postage = Number(sale.postage) || 0;
    const pVat = sale.postageVatExempt ? 0 : (Number(sale.postageVat) || postage * 0.2);
    return postage + pVat;
  }
  if (unit.postageCost) return unit.postageCost * 1.2;
  return 0;
}

/** The three non-carriage costs, for a route the caller has already resolved.
 *
 *  Split out because the Returns page resolves the route itself — it carries
 *  legacy detection (repairedAt, the 'repaired_unit' flag) for cycles written
 *  before voidOutcome was stamped, which `returnRouteFor` cannot see from a
 *  single unit. Both callers must apply the SAME absent-vs-zero rule, so the
 *  rule lives here once rather than being written twice and drifting. */
export function extraCostsFor(
  unit: InventoryUnit,
  route: 'refund' | 'replacement' | 'repair' | null,
): { repair: number; replacementHandset: number; supplierCredit: number; gaps: ReturnCostGap[] } {
  const gaps: ReturnCostGap[] = [];

  let repair = 0;
  if (route === 'repair') {
    if (typeof unit.repairCost === 'number') repair = unit.repairCost;
    else gaps.push('repair_invoice');
  }

  let replacementHandset = 0;
  if (route === 'replacement') {
    if (typeof unit.replacementUnitCost === 'number') replacementHandset = unit.replacementUnitCost;
    else gaps.push('replacement_handset');
  }

  // The supplier credit is a recovery, not a cost, and only a unit actually
  // sent back to the supplier can have one. It is recorded when the credit
  // lands — same day, per the operator — so an outstanding one is a gap.
  let supplierCredit = 0;
  if (unit.returnType === 'returned_to_supplier') {
    if (typeof unit.supplierCreditAmount === 'number') supplierCredit = unit.supplierCreditAmount;
    else gaps.push('supplier_credit');
  }

  return { repair, replacementHandset, supplierCredit, gaps };
}

/** Full cost of a return, with the un-entered figures named rather than
 *  quietly counted as zero. Returns an all-zero breakdown for a unit that has
 *  not been returned. */
export function returnCostFor(unit: InventoryUnit, sale?: Sale | null): ReturnCostBreakdown {
  const route = returnRouteFor(unit, sale);
  if (!route) {
    return { postage: 0, repair: 0, replacementHandset: 0, supplierCredit: 0, total: 0, gaps: [] };
  }

  const postage = legCostFor(unit, sale) * (route === 'replacement' ? 3 : 2);
  const { repair, replacementHandset, supplierCredit, gaps } = extraCostsFor(unit, route);
  const total = postage + repair + replacementHandset - supplierCredit;
  return { postage, repair, replacementHandset, supplierCredit, total, gaps };
}

/** Sum a set of returns, carrying the gap count so a caller can say
 *  "£4,120 across 38 returns, 6 still missing a repair invoice" rather than
 *  presenting an understated total as complete. */
export function totalReturnCost(
  rows: Array<{ unit: InventoryUnit; sale?: Sale | null }>,
): { total: number; postage: number; repair: number; replacementHandset: number; supplierCredit: number; gapCount: number } {
  const acc = { total: 0, postage: 0, repair: 0, replacementHandset: 0, supplierCredit: 0, gapCount: 0 };
  for (const { unit, sale } of rows) {
    const c = returnCostFor(unit, sale);
    acc.total += c.total;
    acc.postage += c.postage;
    acc.repair += c.repair;
    acc.replacementHandset += c.replacementHandset;
    acc.supplierCredit += c.supplierCredit;
    acc.gapCount += c.gaps.length;
  }
  return acc;
}
