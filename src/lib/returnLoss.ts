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
 *   replacement   2 legs          (none — see extraCostsFor)
 *   to supplier   2 legs          offset by the credit that comes back
 *
 * A replacement physically ships THREE times and is still billed two legs
 * here, because the outbound one is already inside the sale's own Postage —
 * see returnCostFor, which sets out all five cases.
 *
 * A replacement is the case that looks like it should cost a handset and does
 * not: the faulty unit comes back and a like-for-like one goes out, so net
 * stock is unchanged and only the three carriage legs are consumed. See
 * extraCostsFor for the full arithmetic — an earlier version of this module
 * charged the second handset and understated every replacement by a unit cost.
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
export type ReturnCostGap = 'repair_invoice' | 'supplier_credit';

export interface ReturnCostBreakdown {
  /** Carriage: (postage + P.VAT) × legs. Same figure `postageLossFor` gives. */
  postage: number;
  /** Repair invoice for this cycle, £. 0 when not a repair or not yet entered. */
  repair: number;
  /** Money (or value in kind) recovered from the supplier, £. Reduces the total. */
  supplierCredit: number;
  /** postage + repair − supplierCredit. */
  total: number;
  /** Costs that apply to this return but have not been entered. When this is
   *  non-empty, `total` is a floor, not the answer. */
  gaps: ReturnCostGap[];
}

/** Did this sale keep the money the customer paid?
 *
 *  Voiding a sale hides it from every revenue and GP surface, which was the
 *  only behaviour available before the operator's returns policy was written
 *  down. Two routes leave the payment with the business:
 *
 *    - a replacement — "the customer keeps what they paid", and receives a
 *      handset for it, so the revenue stood and a second handset went out
 *    - a repair after the warranty refund window — free repair, no refund
 *
 *  On those, hiding the sale deletes revenue that is really in the bank.
 *
 *  Only returns stamped `gpBasis: 'returns_v2'` are re-read this way. Returns
 *  already in the database keep the old treatment, which is what applying the
 *  correction "from today onward" means — the cutoff is a property of each
 *  return, not of when a deploy happened. */
export function saleKeptItsRevenue(
  sale: Pick<Sale, 'voidedAt' | 'gpBasis' | 'customerRefunded'> | null | undefined,
): boolean {
  if (!sale) return false;
  if (!sale.voidedAt) return true;
  return sale.gpBasis === 'returns_v2' && sale.customerRefunded === false;
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
): { repair: number; supplierCredit: number; gaps: ReturnCostGap[] } {
  const gaps: ReturnCostGap[] = [];

  let repair = 0;
  if (route === 'repair') {
    if (typeof unit.repairCost === 'number') repair = unit.repairCost;
    else gaps.push('repair_invoice');
  }

  // A REPLACEMENT COSTS THE CARRIAGE, NOT A HANDSET.
  //
  // The first version of this charged the replacement unit's full purchase
  // price, on the reading that "a replacement costs a whole second handset".
  // That double-counts, and the arithmetic is worth spelling out because the
  // intuition is so persuasive:
  //
  //   two handsets bought                        -600
  //   customer pays, keeps the replacement       +400   GP on sale 1 = +100
  //   faulty unit comes back, is resold later    +400   GP on sale 2 = +100
  //   -------------------------------------------------------------------
  //   real outcome: +200 of GP, less 3 carriage legs
  //
  // Both handsets' purchase prices are already inside those two sales' gross
  // profit. Charging the second handset here is a THIRD charge for stock that
  // was only ever bought twice, and it understated every replacement by a
  // full unit cost.
  //
  // The stock position says the same thing more directly: one unit ships out,
  // the faulty one comes back in. Net inventory is unchanged, so nothing was
  // consumed except the postage on three legs.
  //
  // replacementUnitCost is still snapshotted on the unit — it records WHICH
  // handset went out and what it had cost, which is real audit value — but it
  // is not a loss. It would only become one if the returning unit were
  // written off rather than resold, and that is not a route this business
  // runs (it repairs and resells, or returns to the supplier for credit).

  // The supplier credit is a recovery, not a cost, and only a unit actually
  // sent back to the supplier can have one. It is recorded when the credit
  // lands — same day, per the operator — so an outstanding one is a gap.
  let supplierCredit = 0;
  if (unit.returnType === 'returned_to_supplier') {
    if (typeof unit.supplierCreditAmount === 'number') supplierCredit = unit.supplierCreditAmount;
    else gaps.push('supplier_credit');
  }

  return { repair, supplierCredit, gaps };
}

/** Full cost of a return, with the un-entered figures named rather than
 *  quietly counted as zero. Returns an all-zero breakdown for a unit that has
 *  not been returned. */
export function returnCostFor(unit: InventoryUnit, sale?: Sale | null): ReturnCostBreakdown {
  const route = returnRouteFor(unit, sale);
  if (!route) {
    return { postage: 0, repair: 0, supplierCredit: 0, total: 0, gaps: [] };
  }

  // BILL THE JOURNEYS THAT NOBODY ELSE IS PAYING FOR.
  //
  // A replacement moves the parcel three times: out to the customer, the
  // faulty unit back to us, the replacement out. But the FIRST of those was
  // paid at SALE time and recorded as that sale's own Postage, which its
  // gross profit subtracts. A replacement keeps its revenue, so that GP
  // stands and the outbound leg is already charged — billing three more here
  // charged FOUR legs for three journeys, on every replacement ever
  // processed.
  //
  // So the leg count is not a property of the route alone. It is the
  // journeys this return caused, less the one the sale is still paying for:
  //
  //   route                     GP        journeys   already paid   billed
  //   ──────────────────────────────────────────────────────────────────────
  //   refund                    zeroed        2            0           2
  //   repair, in warranty       zeroed        2            0           2
  //   repair, out of warranty   stands        3            1           2
  //   replacement               stands        3            1           2
  //   accessory replacement     zeroed        3            0           3
  //
  // The accessory row is why this is not just a constant 2: accessory returns
  // void the revenue outright rather than stamping customerRefunded, so their
  // outbound leg is charged nowhere else and all three journeys are billed
  // here. saleKeptItsRevenue is the single switch that decides which half
  // pays, which is what makes double-counting impossible either way.
  //
  // clientReport's postageLossFor applies the identical rule for the Postage
  // Loss column; the two must agree.
  const keptRevenue = saleKeptItsRevenue(sale);
  const journeys = (route === 'replacement' || (route === 'repair' && keptRevenue)) ? 3 : 2;
  const postage = legCostFor(unit, sale) * (journeys - (keptRevenue ? 1 : 0));
  const { repair, supplierCredit, gaps } = extraCostsFor(unit, route);
  const total = postage + repair - supplierCredit;
  return { postage, repair, supplierCredit, total, gaps };
}

/** Sum a set of returns, carrying the gap count so a caller can say
 *  "£4,120 across 38 returns, 6 still missing a repair invoice" rather than
 *  presenting an understated total as complete. */
export function totalReturnCost(
  rows: Array<{ unit: InventoryUnit; sale?: Sale | null }>,
): { total: number; postage: number; repair: number; supplierCredit: number; gapCount: number } {
  const acc = { total: 0, postage: 0, repair: 0, supplierCredit: 0, gapCount: 0 };
  for (const { unit, sale } of rows) {
    const c = returnCostFor(unit, sale);
    acc.total += c.total;
    acc.postage += c.postage;
    acc.repair += c.repair;
    acc.supplierCredit += c.supplierCredit;
    acc.gapCount += c.gaps.length;
  }
  return acc;
}
