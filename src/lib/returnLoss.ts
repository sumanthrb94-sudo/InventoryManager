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
 *   - Marketplace fees ARE now in scope — feeLossOnRefund below. The open
 *     question this section used to park ("does a refund credit the fees
 *     back?") was settled by the operator with real statements, one per
 *     channel, and the per-channel policies are documented on that function.
 *   - It does not decide which accounting PERIOD the cost falls in. The
 *     operator wants costs in the period the item was RETURNED; that is a
 *     reporting concern and belongs to the caller that has the period.
 */

import type { InventoryUnit, Sale } from '../types';
import { getMarketplaceFee } from './platforms';

/** A cost this return should carry that nobody has recorded yet. */
export type ReturnCostGap = 'repair_invoice' | 'supplier_credit';

export interface ReturnCostBreakdown {
  /** Carriage: (postage + P.VAT) × legs. Same figure `postageLossFor` gives. */
  postage: number;
  /** Repair invoice for this cycle, £. 0 when not a repair or not yet entered. */
  repair: number;
  /** Money (or value in kind) recovered from the supplier, £. Reduces the total. */
  supplierCredit: number;
  /** Marketplace fees the channel KEPT when the sale was refunded, £.
   *  See feeLossOnRefund for the per-channel policy and its evidence. */
  fees: number;
  /** postage + repair + fees − supplierCredit. */
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

/** The VAT a sale's postage ACTUALLY carried — for costing carriage legs.
 *
 *  `postageVat` is a stored fact, and zero is a real value: eBay's shipping
 *  is zero-rated to this operator (the master's P. VAT column reads 0 on
 *  every row beside £4.65 of postage). The old `postageVat || postage × 20%`
 *  fallback treated that stored 0 as "not recorded" and invented £0.93 of
 *  VAT per leg — £1.86 too much on every 2-leg eBay refund. Only a sale that
 *  PREDATES the field (postageVat absent) derives the historic 20%.
 *
 *  Every leg-cost computation in the app must go through this one function;
 *  the copies it replaced had already drifted into nine call sites. */
export function postageVatOf(
  sale: Pick<Sale, 'postage' | 'postageVat' | 'postageVatExempt'>,
): number {
  if (sale.postageVatExempt) return 0;
  if (sale.postageVat != null) return Number(sale.postageVat) || 0;
  return (Number(sale.postage) || 0) * 0.2;
}

/** Cost of one carriage leg (postage + P.VAT), from the snapshot the return
 *  took, falling back to the live sale and then to the unit's own postage. */
function legCostFor(unit: InventoryUnit, sale?: Sale | null): number {
  if (typeof unit.returnLegCost === 'number') return unit.returnLegCost;
  if (sale) {
    return (Number(sale.postage) || 0) + postageVatOf(sale);
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

/**
 * The marketplace fees a refund does NOT get back.
 *
 * Voiding a sale removes it from every revenue and GP surface, which silently
 * models the refund as if the channel returned every fee it charged. The
 * operator pulled the real statements, one per channel, and only Amazon comes
 * close to that:
 *
 *   AMAZON   refunds the fees minus a "refund administration fee":
 *            the lesser of 20% of the order-related fee amount or £5.00,
 *            plus 20% VAT on it. Verified against order 203-5323406-8518721:
 *            SP £308 → commission £21.56 → 20% = £4.31, under the £5 cap,
 *            +£0.86 VAT = £5.17 kept. (Sale netted +£281.60, refund netted
 *            −£286.77; the £5.17 difference is exactly this fee.)
 *
 *   EBAY     refunds the variable final value fee and the regulatory
 *            operating fee, with their VAT — but keeps the FIXED £0.40
 *            per-order fee and its VAT. Verified against order
 *            11-14953-45167: fees on sale £7.18, credited on refund £6.70,
 *            kept £0.48 = £0.40 × 1.2. (This settles the parked "eBay £0.40
 *            FVF" question: the fee is real, and it is the one part eBay
 *            never gives back.)
 *
 *   BM       refunds nothing. Commission, the £8.99 customer-care fee, the
 *   ONBUY    PSF, the payment fee — all kept. Operator: "DOES NOT REFUND".
 *   TEMU     Same: the commission and its VAT are a dead loss.
 *
 * A sale that KEPT its revenue (replacement, out-of-warranty repair) charges
 * nothing here: no buyer refund happened, so no fee credit and no admin fee —
 * the fees stand against a sale whose GP also stands and already subtracts
 * them. Charging them again would double-count.
 *
 * Reads the fee figures the sale itself carries — the same numbers the report
 * printed — rather than recomputing from the schedule, so a sale imported
 * under an old fee schedule loses what it was actually charged, not what
 * today's rates say it would have been. Only Amazon's admin-fee CAP and
 * eBay's fixed fee come from the (dated) schedule, because neither is stored
 * per sale.
 */
export function feeLossOnRefund(
  sale:
    | Pick<Sale,
        'marketplace' | 'saleDate' | 'voidedAt' | 'voidOutcome' | 'gpBasis'
        | 'customerRefunded'
        | 'commission' | 'commissionVat' | 'vat20' | 'customerCareFees' | 'psf'
        | 'payPalKlarnaCom'>
    | null
    | undefined,
): number {
  if (!sale?.voidedAt) return 0;
  if (saleKeptItsRevenue(sale)) return 0;
  // A replacement never charges fees, WHATEVER its era. saleKeptItsRevenue
  // only recognises returns stamped gpBasis='returns_v2' (the operator's
  // from-today-onward cutoff for the revenue treatment), so a legacy
  // replacement fell through to the refund branches and was billed fees for
  // a refund that never reached the marketplace. The outcome field knows
  // better regardless of the stamp: no refund transaction, no fee kept.
  // Operator, 2026-08-29: "keep only return and refunds … not for any
  // replacement".
  if (sale.voidOutcome === 'replacement') return 0;

  const n = (v: unknown) => Number(v) || 0;
  const commission = n(sale.commission);
  const fee = getMarketplaceFee(sale.marketplace as Sale['marketplace'], sale.saleDate);
  const vat = 1 + (fee.vatPct ?? 20) / 100;

  switch (sale.marketplace) {
    case 'AMAZON': {
      // min(20% of the order-related fee amount, £5.00), plus VAT. Amazon's
      // own explainer names the commission base as the "order-related fee
      // amount" — the DSF is not part of it (£21.56 on the real statement,
      // with the £0.43 DSF excluded).
      const adminBase = Math.min(0.20 * commission, 5.00);
      return adminBase * vat;
    }
    case 'EBAY':
      // Everything comes back except the fixed per-order fee and its VAT.
      return (fee.fixedFee ?? 0.40) * vat;
    case 'BM':
      return commission + n(sale.customerCareFees) + n(sale.psf) + n(sale.payPalKlarnaCom);
    case 'ONBUY':
      return commission + n(sale.vat20);
    case 'TEMU':
      return commission + n(sale.commissionVat);
    default:
      return 0;
  }
}

/** Full cost of a return, with the un-entered figures named rather than
 *  quietly counted as zero. Returns an all-zero breakdown for a unit that has
 *  not been returned. */
export function returnCostFor(unit: InventoryUnit, sale?: Sale | null): ReturnCostBreakdown {
  const route = returnRouteFor(unit, sale);
  if (!route) {
    return { postage: 0, repair: 0, supplierCredit: 0, fees: 0, total: 0, gaps: [] };
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
  const fees = feeLossOnRefund(sale);
  const total = postage + repair + fees - supplierCredit;
  return { postage, repair, supplierCredit, fees, total, gaps };
}

/** Sum a set of returns, carrying the gap count so a caller can say
 *  "£4,120 across 38 returns, 6 still missing a repair invoice" rather than
 *  presenting an understated total as complete. */
export function totalReturnCost(
  rows: Array<{ unit: InventoryUnit; sale?: Sale | null }>,
): { total: number; postage: number; repair: number; supplierCredit: number; fees: number; gapCount: number } {
  const acc = { total: 0, postage: 0, repair: 0, supplierCredit: 0, fees: 0, gapCount: 0 };
  for (const { unit, sale } of rows) {
    const c = returnCostFor(unit, sale);
    acc.total += c.total;
    acc.postage += c.postage;
    acc.repair += c.repair;
    acc.supplierCredit += c.supplierCredit;
    acc.fees += c.fees;
    acc.gapCount += c.gaps.length;
  }
  return acc;
}
