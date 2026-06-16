/**
 * platforms.ts — single source of truth for marketplace fee schedules.
 *
 * Resolves audit blocker B5: previous `PLATFORMS` constants had wrong commission
 * rates and were missing Project, eBay ROF/FVF/VAT/promo and BM PayPal/Klarna.
 *
 * The new authoritative table is `MARKETPLACE_FEES` (keyed by canonical
 * `Marketplace` sheet names: AMAZON / BM / EBAY / ONBUY). It powers:
 *   - `calcSaleFinancials()` — runtime GP/NP calculator for sales documents
 *   - `excelFormulaFor()`   — Excel formula strings for the SALES_REPORT writer
 *   - `getMarketplaceFee()` — Firestore loader hook (returns defaults today)
 *
 * Legacy `PLATFORMS` / `DEFAULT_POSTAGE_COST` / `platform*` helpers are kept as
 * back-compat shims derived from MARKETPLACE_FEES so existing UI callers
 * (SellPage, ReportingPage, Sales, pdfReport, TodaySalesModal, tests) keep
 * compiling. Migrating those call sites to the marketplace-aware API is a
 * separate task.
 */

import type { ListingSite, Marketplace, MarketplaceFee } from '../types';
import { MARKETPLACES } from '../types';

// ---------------------------------------------------------------------------
// Authoritative fee schedule
// ---------------------------------------------------------------------------

/**
 * Seed values, sourced verbatim from MASTER_FILES_AUDIT.md §5 and the per-sheet
 * formulas in MASTER_FILES_SPEC.md. These are the code-side defaults; at boot
 * `getMarketplaceFee()` can be swapped to read from the Firestore
 * `marketplaceFees` collection (doc id = marketplace name).
 */
export const DEFAULT_MARKETPLACE_FEES: Record<Marketplace, MarketplaceFee> = {
  AMAZON: {
    marketplace: 'AMAZON',
    // Operator's 2026-05 schema move: Commission is 7% of SP (standard
    // Amazon marketplace fee on the sale price — was 7.14% × SP before).
    // Every Amazon line carries a VAT/DSF/accessory breakdown derived
    // from Commission, so changing the commission base shifts the whole
    // chain (C.VAT = Com×20%, DSF = Com×2%, DSF VAT = DSF×20%) in lock-step.
    // Postage is operator-entered per sale (.postage below is the fallback
    // when the caller doesn't supply postageOverride).
    commissionPct: 7,
    commissionBase: 'sp',
    postage: 0,
    marginTaxDivisor: 6,
    vatPct: 20,
    dsfPct: 2,
    accessoryFee: 1,
  },
  BM: {
    marketplace: 'BM',
    // 2026-05 operator schema: Commission rate is 11% of SP (was 12% in
    // the legacy code), plus a flat Customer Care Fees line of £9.99 per
    // sale. No PayPal/Klarna commission any more — drop the field. No
    // separate Total VAT column either: BM's only VAT line is P. VAT,
    // so totalVatNtp = MarTax − P. VAT directly. Postage operator-
    // entered; .postage default is just a fallback.
    commissionPct: 11,
    postage: 0,
    marginTaxDivisor: 6,
    vatPct: 20,
    accessoryFee: 1,
    customerCareFees: 9.99,
  },
  EBAY: {
    marketplace: 'EBAY',
    // 2026-05 operator schema: commission is the post-reduction effective
    // rate (6.21% = 6.9% − 10%) baked into a single percentage, and the
    // old promo-as-%-of-SP convention is replaced by an operator-entered
    // Marketing line carried on the Sale doc. Default postage is 0
    // (operator-entered per sale like Amazon).
    commissionPct: 6.21,
    fixedFee: 0.40,
    postage: 0,
    marginTaxDivisor: 6,
    rofPct: 0.35,
    vatPct: 20,
    accessoryFee: 1,
  },
  ONBUY: {
    marketplace: 'ONBUY',
    // 2026-05 operator schema: same per-line VAT shape as Amazon/eBay
    // (line VAT on Commission + Postage VAT + flat Accessories), but no
    // FVF / ROF / Marketing / DSF lines. Postage operator-entered; the
    // .postage default below is just a fallback. GP% divides by BP
    // (same convention as Amazon).
    commissionPct: 7,
    postage: 0,
    marginTaxDivisor: 6,
    vatPct: 20,
    accessoryFee: 1,
  },
};

/**
 * Look up the fee schedule for a marketplace. Today this just returns the
 * baked-in defaults; the Firestore loader will mutate the cache behind this
 * helper so callers do not need to re-import anything when live fees change.
 */
export function getMarketplaceFee(m: Marketplace): MarketplaceFee {
  // Safety net: a Firestore Sale doc with a missing / corrupt / legacy
  // marketplace value (e.g. an old "PROJECT" or empty string) would
  // otherwise return undefined here and crash every downstream `.postage`
  // access. Fall back to AMAZON's fee schedule so the UI degrades
  // gracefully instead of the whole sold-history pane error-bounding out.
  return DEFAULT_MARKETPLACE_FEES[m] ?? DEFAULT_MARKETPLACE_FEES.AMAZON;
}

// ---------------------------------------------------------------------------
// ListingSite <-> Marketplace bridge
// ---------------------------------------------------------------------------

/**
 * Canonical mapping between marketplace sheet names (used by SALES_REPORT and
 * the `Sale` entity) and the user-facing `ListingSite` strings preserved
 * verbatim from the client master file.
 *
 * - 'BM' canonicalises to 'Back Market' (with legacy 'Backmarket' also accepted).
 */
const MARKETPLACE_TO_LISTING_SITE: Record<Marketplace, ListingSite> = {
  AMAZON: 'Amazon',
  BM: 'Back Market',
  EBAY: 'eBay',
  ONBUY: 'OnBuy',
};

const LISTING_SITE_TO_MARKETPLACE: Record<string, Marketplace> = {
  // Pretty / user-facing names
  'Amazon':     'AMAZON',
  'Back Market':'BM',
  'Backmarket': 'BM',   // legacy
  'eBay':       'EBAY',
  'OnBuy':      'ONBUY',
  // Canonical Marketplace enum values — recordSale writes salePlatform in
  // this form ('EBAY' / 'AMAZON' / …) so the reverse lookup also has to
  // accept it; without these entries, every non-eBay sale resolved to the
  // 'EBAY' fallback inside inventoryUnitToSale and double-counted on the
  // Sell screen because the dedupe key `${mp}__${orderNumber}` didn't match.
  'AMAZON':  'AMAZON',
  'BM':      'BM',
  'EBAY':    'EBAY',
  'ONBUY':   'ONBUY',
};

export function listingSiteFromMarketplace(m: Marketplace): ListingSite {
  return MARKETPLACE_TO_LISTING_SITE[m];
}

export function marketplaceFromListingSite(s: ListingSite | string): Marketplace | undefined {
  return LISTING_SITE_TO_MARKETPLACE[s as string];
}

// ---------------------------------------------------------------------------
// Runtime GP / NP calculator
// ---------------------------------------------------------------------------

export interface CalcSaleFinancialsInput {
  marketplace: Marketplace;
  buyPrice: number;
  salePrice: number;
  /** Override the per-marketplace default postage (eBay tiers, free shipping…). */
  postageOverride?: number;
  /** eBay only — explicit shipping tier (£1, £2, £8). Trumps `postageOverride`. */
  eBayShippingTier?: 1 | 2 | 8;
  /** BM only — apply 2.5% PayPal/Klarna commission on top. */
  hasPayPalKlarna?: boolean;
  /** eBay only — operator-entered marketing/promo £ for this sale.
   *  Replaces the old `promoPct × SP` convention; the operator can spend
   *  anything from £0 upwards per line. */
  marketing?: number;
  /** When true the postage VAT on this line is zero-rated regardless of
   *  marketplace. Used for VAT-exempt shipping (zero-rated EU export,
   *  etc). Defaults to false so existing behaviour is unchanged. */
  postageVatExempt?: boolean;
  /** Operator-overridden accessory fee for this line — when supplied,
   *  trumps the per-marketplace `fee.accessoryFee` default. Used when the
   *  client's sheet zero-rates Acc on a row (e.g. generic charger SKU
   *  that doesn't carry the £1 accessory bundle). */
  accessoryFeeOverride?: number;
  /** BM only — operator-overridden Customer Care Fees per line. Live BM
   *  sheet shows £8.99 on some rows where the previous default was £9.99,
   *  so we read the file's literal value rather than baking a constant. */
  customerCareFeesOverride?: number;
}

export interface SaleFinancials {
  spMinusBp: number;
  marginalTax: number;
  commission: number;
  payPalKlarnaCom?: number;   // BM
  rof?: number;               // eBay
  fvf?: number;               // eBay
  twentyPercent?: number;     // eBay 20%-on-fees bundle
  totalCom?: number;          // eBay
  vat20?: number;             // OnBuy / eBay
  marVat?: number;            // OnBuy MAR VAT (alias for marginalTax on OnBuy)
  // Amazon line-level VAT / DSF / accessory breakdown.
  commissionVat?: number;     // Amazon: Commission * vatPct
  dsf?: number;               // Amazon: Commission * dsfPct
  dsfVat?: number;            // Amazon: DSF * vatPct
  postageVat?: number;        // Amazon + eBay: Postage * vatPct
  accessoryFee?: number;      // Amazon + eBay: flat fee.accessoryFee
  totalVat?: number;          // Amazon: CVAT + DSF VAT + P VAT.  eBay: VAT + P VAT + M VAT.
  totalVatNtp?: number;       // Amazon + eBay: Marginal Tax − Total VAT (net tax payable)
  // eBay-only: 2026-05 marketing line + its VAT.
  marketing?: number;         // eBay: operator-entered marketing £
  marketingVat?: number;      // eBay: marketing * vatPct
  // BM-only: flat customer-care charge per sale.
  customerCareFees?: number;  // BM: flat £9.99
  postage: number;
  grossProfit: number;
  gpPercent: number;
  netProfit?: number;         // eBay incl. promo
}

/**
 * 2-decimal round that matches Excel's ROUND(...,2) to 1p across the
 * full range of financial values this app deals with.
 *
 * The JS-native `Math.round(n * 100) / 100` has a documented edge case
 * where IEEE 754 binary representation stores values like 1.005 as
 * 1.00499999999999989… — multiplying by 100 keeps that error
 * (100.49999…) and the round-half-up rule then drops it to 100 instead
 * of bumping to 101. Excel's ROUND(1.005, 2) returns 1.01 because Excel
 * internally nudges these representation errors upward before rounding.
 *
 * We do the same: add a tiny scale-aware epsilon (1e-9, ~1 picopenny on
 * a normal sale price) before the round. The epsilon is large enough to
 * overcome any IEEE 754 representation error on numbers up to several
 * million, and small enough that no legitimate intermediate value gets
 * mis-rounded — `1.0049999 + 1e-9 = 1.0049999001` still rounds down to
 * 1.00, while `1.005 stored as 1.00499999999999989… + 1e-9` becomes
 * 1.005000001… and correctly rounds up to 1.01.
 *
 * Sign-aware so negative values round half-away-from-zero, matching
 * Excel's ROUND() behaviour (e.g. ROUND(-1.005, 2) = -1.01).
 */
const r2 = (n: number): number => {
  const epsilon = n >= 0 ? 1e-9 : -1e-9;
  return Math.round((n + epsilon) * 100) / 100;
};

/**
 * Compute every derived sale field for one marketplace transaction.
 *
 * Formulas mirror MASTER_FILES_SPEC.md per-sheet definitions exactly:
 *   AMAZON  GP = SP - BP - (SP-BP)/6 - SP*7.14% - postage
 *   BM      GP = SP - BP - (SP-BP)/6 - SP*12%   - postage [- SP*2.5% if PayPal/Klarna]
 *   EBAY    COM      = (SP*6.9%) - (SP*6.9%)*10%
 *           ROF      = SP*0.35%
 *           FVF      = 0.40
 *           20%      = (COM + ROF + FVF) * 20%
 *           T.COM    = COM + ROF + FVF + 20%
 *           GP       = (SP-BP)*16.6%-shaped MAR TAX path → I - J - O - P
 *                    where I = SP-BP, J = MAR TAX, O = T.COM, P = SHIPPING
 *           NP(promo)= GP - SP*5%
 *   ONBUY   MAR VAT  = (SP-BP)/6
 *           COM 7%   = SP*7%
 *           VAT 20%  = MAR VAT * 20%
 *           GP       = SP - BP - COM - SHIP - MAR VAT - VAT20
 *   PROJECT same as AMAZON but postage = £5.90
 */
export function calcSaleFinancials(input: CalcSaleFinancialsInput): SaleFinancials {
  const { marketplace, buyPrice: bp, salePrice: sp, postageOverride, eBayShippingTier } = input;
  const fee = getMarketplaceFee(marketplace);

  const spMinusBp = r2(sp - bp);
  const postage = r2(
    eBayShippingTier ?? postageOverride ?? fee.postage,
  );

  // GP% denominator differs by marketplace per the live master SALES_REPORT
  // formulas in /xl/worksheets/sheet{1..5}.xml. Caveat: every marketplace
  // writes the denominator as `G{row}`, but G is BP on AMAZON/BM/PROJECT
  // (col G = BP) and SP on ONBUY (col G = SP — ONBUY has no Quantity column
  // so headers shift one left). EBAY uses an explicit `H{row}` (col H = SP).
  // Net result:
  //   AMAZON / BM / PROJECT     GP% = GP / BP * 100   (margin-over-cost)
  //   EBAY / ONBUY              GP% = GP / SP * 100   (gross-margin-over-revenue)
  // Until 2026-05 the runtime divided by SP for every marketplace, which made
  // the AMAZON/BM/PROJECT in-app GP% read about half what the operator's
  // master file computes on open. Both conventions are valid business
  // metrics — we match the operator's file so the screen + the workbook +
  // reports all agree per-marketplace.
  const gpPctByBp = (gp: number) => bp > 0 ? r2(gp / bp * 100) : 0;
  const gpPctBySp = (gp: number) => sp > 0 ? r2(gp / sp * 100) : 0;

  switch (marketplace) {
    case 'AMAZON': {
      // 2026-05 operator schema: every Amazon line carries an explicit
      // VAT / DSF / accessories breakdown. Formula chain (mirrors the
      // operator's reference sheet):
      //   spMinusBp     = SP − BP
      //   marginalTax   = spMinusBp × (1 / 6)              ≈ 16.67% of margin
      //   commission    = SP × commissionPct / 100         (7% of SP — fee.commissionBase='sp')
      //   commissionVat = commission × vatPct / 100         (20% by default)
      //   dsf           = commission × dsfPct / 100         (2% by default)
      //   dsfVat        = dsf × vatPct / 100                (20%)
      //   postage       = operator-entered, default 0
      //   postageVat    = postage × vatPct / 100            (20%)
      //   accessoryFee  = flat (£1 default)
      //   totalVat      = commissionVat + dsfVat + postageVat
      //   grossProfit   = spMinusBp − marginalTax − commission − commissionVat
      //                   − dsf − dsfVat − postage − postageVat − accessoryFee
      //   totalVatNtp   = marginalTax − totalVat        (net tax payable bucket)
      //   gpPercent     = GP / BP * 100                 (margin-over-cost)
      //
      // CRITICAL: compute every intermediate in full precision and round
      // only at return. Operator's reference sheet uses Excel's default
      // "compute precise, display rounded" model — rounding each step
      // independently (as we did before 2026-05) compounded into a 1p
      // drift on Total VAT / GP / GP% / NTP (e.g. for SP=99/BP=75/post=8
      // we returned 3.02 / 0.91 / 1.21 / 0.98 vs Excel's 3.01 / 0.92 /
      // 1.22 / 0.99). Keep raw values inline; r2 only on the way out.
      const vatPctFrac = (fee.vatPct ?? 20) / 100;
      const dsfPctFrac = (fee.dsfPct ?? 0) / 100;
      const commissionBaseVal = (fee.commissionBase ?? 'spMinusBp') === 'sp' ? sp : spMinusBp;
      const accessoryFeeVal = input.accessoryFeeOverride ?? fee.accessoryFee ?? 0;

      // Marginal Tax uses the literal 16.67% rate (operator's reference
      // sheet writes =C3*16.67% across Amazon / eBay / OnBuy — all three
      // platforms agree on this formula, but the percent is hard-coded
      // rather than 1/6 so the third-decimal drift between the two is
      // preserved 1:1 with Excel).
      const marginalTaxRaw   = spMinusBp * 16.67 / 100;
      const commissionRaw    = commissionBaseVal * fee.commissionPct / 100;
      const commissionVatRaw = commissionRaw * vatPctFrac;
      const dsfRaw           = commissionRaw * dsfPctFrac;
      const dsfVatRaw        = dsfRaw * vatPctFrac;
      const postageVatRaw    = input.postageVatExempt ? 0 : (postage * vatPctFrac);
      const totalVatRaw      = commissionVatRaw + dsfVatRaw + postageVatRaw;
      const grossProfitRaw   = spMinusBp - marginalTaxRaw - commissionRaw - commissionVatRaw
        - dsfRaw - dsfVatRaw - postage - postageVatRaw - accessoryFeeVal;
      const totalVatNtpRaw   = marginalTaxRaw - totalVatRaw;
      const gpPercentRaw     = bp > 0 ? grossProfitRaw / bp * 100 : 0;

      return {
        spMinusBp,
        marginalTax:   r2(marginalTaxRaw),
        commission:    r2(commissionRaw),
        commissionVat: r2(commissionVatRaw),
        dsf:           r2(dsfRaw),
        dsfVat:        r2(dsfVatRaw),
        postageVat:    r2(postageVatRaw),
        accessoryFee:  r2(accessoryFeeVal),
        totalVat:      r2(totalVatRaw),
        totalVatNtp:   r2(totalVatNtpRaw),
        postage,
        grossProfit:   r2(grossProfitRaw),
        gpPercent:     r2(gpPercentRaw),
      };
    }

    case 'BM': {
      // 2026-05 operator schema, verified cell-by-cell against the
      // reference Google Sheet (Formula Sheet-2 Back Market tab).
      // 12 operator cols (BP through Total VAT NTP):
      //
      //   A=BP, B=SP, C=SP-BP, D=Marginal Tax, E=Commission,
      //   F=Customer Care Fees, G=Postage, H=P. VAT, I=Accessories,
      //   J=GP, K=GP %, L=Total VAT NTP
      //
      // Formulas (taken from each cell's formula bar):
      //
      //   spMinusBp       = SP − BP
      //   marginalTax     = (SP − BP) × 16.67%           =C3*16.67%
      //   commission      = SP × 11%                     =B3/100*11
      //                                                 (NOT 12% as in the
      //                                                  legacy code, NOT
      //                                                  on SP-BP)
      //   customerCareFees = 9.99 flat                   (literal in F3)
      //   postage         = operator-entered
      //   postageVat      = postage × 20%                =G3*20%
      //   accessoryFee    = 1 flat
      //   grossProfit     = (SP-BP) − marginalTax − commission − customerCareFees
      //                     − postage − postageVat − accessoryFee
      //                                                  =C3-D3-E3-F3-G3-H3-I3
      //   gpPercent       = GP / BP × 100                =J3/A3*100
      //                                                  (Amazon convention)
      //   totalVatNtp     = marginalTax − P. VAT         =D3-H3
      //                                                  (BM has only ONE VAT
      //                                                  line — postage VAT —
      //                                                  so there's no
      //                                                  separate Total VAT
      //                                                  column; NTP subtracts
      //                                                  postage VAT directly.)
      const vatPctFrac = (fee.vatPct ?? 20) / 100;
      const accessoryFeeVal = input.accessoryFeeOverride ?? fee.accessoryFee ?? 0;
      const customerCareFeesVal = input.customerCareFeesOverride ?? fee.customerCareFees ?? 0;

      const marginalTaxRaw      = spMinusBp * 16.67 / 100;
      const commissionRaw       = sp * fee.commissionPct / 100;
      const postageVatRaw       = input.postageVatExempt ? 0 : (postage * vatPctFrac);
      const grossProfitRaw      = spMinusBp - marginalTaxRaw - commissionRaw - customerCareFeesVal
        - postage - postageVatRaw - accessoryFeeVal;
      const totalVatNtpRaw      = marginalTaxRaw - postageVatRaw;
      const gpPercentRaw        = bp > 0 ? grossProfitRaw / bp * 100 : 0;

      return {
        spMinusBp,
        marginalTax:      r2(marginalTaxRaw),
        commission:       r2(commissionRaw),
        customerCareFees: r2(customerCareFeesVal),
        postage,
        postageVat:       r2(postageVatRaw),
        accessoryFee:     r2(accessoryFeeVal),
        // BM's single VAT line means totalVat = postageVat; expose both so
        // generic consumers that look at `totalVat` see the right number
        // and BM-aware consumers can still pull `postageVat` directly.
        totalVat:         r2(postageVatRaw),
        totalVatNtp:      r2(totalVatNtpRaw),
        grossProfit:      r2(grossProfitRaw),
        gpPercent:        r2(gpPercentRaw),
      };
    }

    case 'EBAY': {
      // 2026-05 operator schema, verified cell-by-cell against the operator's
      // reference Google Sheet (Formula Sheet-2). 18-column master row
      // (preceded by Date / OrderNo / SKU / IMEI / Supplier / Units on the
      // export sheet):
      //
      //   A=BP, B=SP, C=SP-BP, D=Marginal Tax, E=Commission, F=ROF, G=FVF,
      //   H=VAT, I=T.COM, J=Postage, K=P. VAT, L=Marketing, M=M. VAT,
      //   N=Accessories, O=Total VAT, P=GP, Q=GP %, R=Total VAT NTP
      //
      // Formula chain — every intermediate raw, round only at return
      // (same "Excel computes precise, displays rounded" reasoning as the
      // AMAZON case fix):
      //
      //   spMinusBp     = SP − BP
      //   marginalTax   = (SP − BP) × 16.67%           Operator's literal cell:
      //                                                =C3*16.67%  (NOT /6 — the
      //                                                two diverge at the 3rd
      //                                                decimal and that drift
      //                                                propagates into GP / NTP).
      //   commission    = SP × 6.21%                    Operator's literal cell:
      //                                                =(B3*6.9%)-(B3*6.9%)*10%
      //                                                (we collapse to the
      //                                                equivalent 6.21% rate
      //                                                in the calc; the Excel
      //                                                emitter still writes
      //                                                the verbose form so the
      //                                                operator's audit trail
      //                                                shows the reduction).
      //   rof           = SP × 0.35%
      //   fvf           = 0.40                          flat
      //   vat           = (commission + rof + fvf) × 20%
      //   tCom          = commission + rof + fvf + vat
      //   postageVat    = postage × 20%
      //   marketing     = SP × 5%                       Operator's literal cell:
      //                                                =B3*5%  (DERIVED from SP,
      //                                                not operator-entered;
      //                                                callers can still
      //                                                override via
      //                                                input.marketing for the
      //                                                rare hand-set spends).
      //   marketingVat  = marketing × 20%
      //   totalVat      = vat + postageVat + marketingVat
      //   grossProfit   = (SP-BP) − marginalTax − tCom − postage − postageVat
      //                   − marketing − marketingVat − accessoryFee
      //   totalVatNtp   = marginalTax − totalVat
      //   gpPercent     = GP / SP × 100                 Operator's GP cell
      //                                                divides by SP (col H), so
      //                                                this is gross-margin-over-
      //                                                revenue. Distinct from
      //                                                Amazon's GP/BP convention.
      const vatPctFrac = (fee.vatPct ?? 20) / 100;
      const accessoryFeeVal = input.accessoryFeeOverride ?? fee.accessoryFee ?? 0;
      // Marketing defaults to 5% of SP (matches the operator's =B3*5% cell);
      // callers can supply an explicit number to override for the rare
      // hand-set spend.
      const marketingVal = input.marketing ?? (sp * 0.05);

      const marginalTaxRaw   = spMinusBp * 16.67 / 100;
      const commissionRaw    = sp * fee.commissionPct / 100;
      const rofRaw           = sp * (fee.rofPct ?? 0) / 100;
      const fvfRaw           = fee.fixedFee ?? 0;
      const vatRaw           = (commissionRaw + rofRaw + fvfRaw) * vatPctFrac;
      const tComRaw          = commissionRaw + rofRaw + fvfRaw + vatRaw;
      const postageVatRaw    = input.postageVatExempt ? 0 : (postage * vatPctFrac);
      const marketingVatRaw  = marketingVal * vatPctFrac;
      const totalVatRaw      = vatRaw + postageVatRaw + marketingVatRaw;
      const grossProfitRaw   = spMinusBp - marginalTaxRaw - tComRaw - postage - postageVatRaw
        - marketingVal - marketingVatRaw - accessoryFeeVal;
      const totalVatNtpRaw   = marginalTaxRaw - totalVatRaw;
      const gpPercentRaw     = sp > 0 ? grossProfitRaw / sp * 100 : 0;

      const vatRounded = r2(vatRaw);
      return {
        spMinusBp,
        marginalTax:   r2(marginalTaxRaw),
        commission:    r2(commissionRaw),
        rof:           r2(rofRaw),
        fvf:           r2(fvfRaw),
        // The eBay "VAT" column has historically been mirrored under both
        // `vat20` (OnBuy-style alias) and `twentyPercent` (eBay-style alias)
        // — keep both populated so existing UI surfaces don't go dark.
        vat20:         vatRounded,
        twentyPercent: vatRounded,
        totalCom:      r2(tComRaw),
        postage,
        postageVat:    r2(postageVatRaw),
        marketing:     r2(marketingVal),
        marketingVat:  r2(marketingVatRaw),
        accessoryFee:  r2(accessoryFeeVal),
        totalVat:      r2(totalVatRaw),
        totalVatNtp:   r2(totalVatNtpRaw),
        grossProfit:   r2(grossProfitRaw),
        gpPercent:     r2(gpPercentRaw),
      };
    }

    case 'ONBUY': {
      // 2026-05 operator schema, verified cell-by-cell against the
      // reference Google Sheet (Formula Sheet-2 OnBuy tab). 13 operator
      // cols (BP through Total VAT NTP):
      //
      //   A=BP, B=SP, C=SP-BP, D=Marginal Tax, E=Commission, F=VAT 20%,
      //   G=Postage, H=P. VAT, I=Accessories, J=Total VAT, K=GP,
      //   L=GP %, M=Total VAT NTP
      //
      // Formulas (full-precision intermediates, r2 only at return):
      //
      //   spMinusBp     = SP − BP
      //   marginalTax   = (SP − BP) × 16.67%           =C3*16.67%
      //   commission    = SP × 7%                       =B3*7%
      //   vat20         = commission × 20%              =E3*20%
      //                                                (NOTE: this is VAT
      //                                                on the Commission line,
      //                                                NOT on the margin —
      //                                                distinct from the old
      //                                                "MAR VAT × 20%" pattern.)
      //   postage       = operator-entered
      //   postageVat    = postage × 20%                 =G3*20%
      //   accessoryFee  = 1 flat
      //   totalVat      = vat20 + postageVat            =F3+H3
      //   grossProfit   = (SP-BP) − marginalTax − commission − vat20
      //                   − postage − postageVat − accessoryFee
      //                                                =C3-D3-E3-F3-G3-H3-I3
      //   totalVatNtp   = marginalTax − totalVat        =D3-J3
      //   gpPercent     = GP / BP × 100                 =K3/A3*100
      //                                                (Amazon convention,
      //                                                distinct from eBay's
      //                                                GP/SP).
      const vatPctFrac = (fee.vatPct ?? 20) / 100;
      const accessoryFeeVal = input.accessoryFeeOverride ?? fee.accessoryFee ?? 0;

      const marginalTaxRaw  = spMinusBp * 16.67 / 100;
      const commissionRaw   = sp * fee.commissionPct / 100;
      const vat20Raw        = commissionRaw * vatPctFrac;
      const postageVatRaw   = input.postageVatExempt ? 0 : (postage * vatPctFrac);
      const totalVatRaw     = vat20Raw + postageVatRaw;
      const grossProfitRaw  = spMinusBp - marginalTaxRaw - commissionRaw - vat20Raw
        - postage - postageVatRaw - accessoryFeeVal;
      const totalVatNtpRaw  = marginalTaxRaw - totalVatRaw;
      const gpPercentRaw    = bp > 0 ? grossProfitRaw / bp * 100 : 0;

      const marginalTaxRounded = r2(marginalTaxRaw);
      return {
        spMinusBp,
        marginalTax:  marginalTaxRounded,
        marVat:       marginalTaxRounded,     // legacy alias
        commission:   r2(commissionRaw),
        vat20:        r2(vat20Raw),
        postage,
        postageVat:   r2(postageVatRaw),
        accessoryFee: r2(accessoryFeeVal),
        totalVat:     r2(totalVatRaw),
        totalVatNtp:  r2(totalVatNtpRaw),
        grossProfit:  r2(grossProfitRaw),
        gpPercent:    r2(gpPercentRaw),
      };
    }

    default: {
      // Safety net: an unknown / undefined marketplace (e.g. a Firestore doc
      // with a missing or corrupt `marketplace` field) would cause the switch
      // to return `undefined`, crashing every caller that accesses `.postage`.
      // Return a minimal valid SaleFinancials so the UI degrades gracefully.
      const grossProfitRaw = r2(sp - bp - postage);
      return {
        spMinusBp,
        marginalTax:  0,
        commission:   0,
        postage,
        grossProfit:  grossProfitRaw,
        gpPercent:    bp > 0 ? r2(grossProfitRaw / bp * 100) : 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Excel formula emitter — used by the SALES_REPORT writer
// ---------------------------------------------------------------------------

/**
 * Per-marketplace Excel formula generator. `row` is the 1-based spreadsheet row
 * number (typically the loop index + 2 to skip the header row). Returned
 * strings are bare formulas — the caller wraps them as
 * `cell.value = { formula: excelFormulaFor(...).spMinusBp }`.
 *
 * Column letters match the headers in MASTER_FILES_SPEC.md §AMAZON/BM/EBAY/ONBUY/PROJECT.
 */
export function excelFormulaFor(marketplace: Marketplace, row: number): Record<string, string> {
  const fee = getMarketplaceFee(marketplace);
  const r = row;
  switch (marketplace) {
    case 'AMAZON': {
      // 2026-05 schema. Columns (1-indexed):
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier, F=Quantity,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission, L=C. VAT,
      //   M=DSF, N=DSF VAT, O=Postage, P=P. VAT, Q=Accessories,
      //   R=Total VAT, S=GP, T=GP %, U=Total VAT NTP, V=Comments
      const vatPct = fee.vatPct ?? 20;
      const dsfPct = fee.dsfPct ?? 0;
      const commissionBase = (fee.commissionBase ?? 'spMinusBp') === 'sp' ? `H${r}` : `I${r}`;
      return {
        spMinusBp:     `H${r}-G${r}`,
        marginalTax:   `I${r}*16.67%`,
        commission:    `${commissionBase}/100*${fee.commissionPct}`,
        commissionVat: `K${r}*${vatPct}%`,
        dsf:           `K${r}*${dsfPct}%`,
        dsfVat:        `M${r}*${vatPct}%`,
        // Postage is operator-entered per sale — emit a static default so the
        // cell isn't empty on an unedited row; the writer overwrites with the
        // sale's actual postage value before save.
        postage:       `${fee.postage}`,
        postageVat:    `O${r}*${vatPct}%`,
        accessoryFee:  `${fee.accessoryFee ?? 0}`,
        totalVat:      `L${r}+N${r}+P${r}`,
        grossProfit:   `I${r}-J${r}-K${r}-L${r}-M${r}-N${r}-O${r}-P${r}-Q${r}`,
        gpPercent:     `S${r}/G${r}*100`,
        totalVatNtp:   `J${r}-R${r}`,
      };
    }
    case 'BM': {
      // Live BM sheet — 20 cols (Payment Mode at G shifts money cols by +1):
      //   A=Date, B=Order No, C=SKU, D=IMEI, E=Supplier, F=Quantity,
      //   G=Payment Mode, H=BP, I=SP, J=SP-BP, K=Marginal Tax, L=Commission,
      //   M=Customer Care Fees, N=Postage, O=P. VAT, P=Acc,
      //   Q=GP, R=GP %, S=Total VAT NTP, T=Comments
      // No "Total VAT" column on BM — Total VAT NTP subtracts P. VAT
      // (col O) directly from Marginal Tax (col K).
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:        `I${r}-H${r}`,
        marginalTax:      `J${r}*16.67%`,
        commission:       `I${r}/100*${fee.commissionPct}`,
        customerCareFees: `${fee.customerCareFees ?? 0}`,
        postageVat:       `N${r}*${vatPct}%`,
        accessoryFee:     `${fee.accessoryFee ?? 0}`,
        grossProfit:      `J${r}-K${r}-L${r}-M${r}-N${r}-O${r}-P${r}`,
        gpPercent:        `Q${r}/H${r}*100`,
        totalVatNtp:      `K${r}-O${r}`,
      };
    }
    case 'EBAY': {
      // 2026-05 schema, formulas mirror the operator's reference sheet
      // verbatim (Marginal Tax × 16.67%, Commission via the explicit
      // 6.9% − 10% reduction so the audit trail shows the legacy fee
      // structure, Marketing derived from SP × 5%, GP % divides by SP).
      // 25 export columns total. Sale-line columns:
      //   A=Date, B=OrderNo, C=SKU, D=IMEI, E=Supplier, F=Units,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission, L=ROF, M=FVF,
      //   N=VAT, O=T.COM, P=Postage, Q=P. VAT, R=Marketing, S=M. VAT,
      //   T=Accessories, U=Total VAT, V=GP, W=GP %, X=Total VAT NTP, Y=Comments
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:    `H${r}-G${r}`,
        marginalTax:  `I${r}*16.67%`,
        commission:   `(H${r}*6.9%)-(H${r}*6.9%)*10%`,
        rof:          `H${r}*${fee.rofPct ?? 0.35}%`,
        fvf:          `${fee.fixedFee ?? 0.4}`,
        vat20:        `(K${r}+L${r}+M${r})*${vatPct}%`,
        totalCom:     `K${r}+L${r}+M${r}+N${r}`,
        postageVat:   `P${r}*${vatPct}%`,
        marketing:    `H${r}*5%`,
        marketingVat: `R${r}*${vatPct}%`,
        accessoryFee: `${fee.accessoryFee ?? 0}`,
        totalVat:     `N${r}+Q${r}+S${r}`,
        grossProfit:  `I${r}-J${r}-O${r}-P${r}-Q${r}-R${r}-S${r}-T${r}`,
        gpPercent:    `V${r}/H${r}*100`,
        totalVatNtp:  `J${r}-U${r}`,
      };
    }
    case 'ONBUY': {
      // 2026-05 schema. 19 export cols total:
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier,
      //   F=BP, G=SP, H=SP-BP, I=Marginal Tax, J=Commission, K=VAT 20%,
      //   L=Postage, M=P. VAT, N=Accessories, O=Total VAT, P=GP,
      //   Q=GP %, R=Total VAT NTP, S=Comments
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:    `G${r}-F${r}`,
        marginalTax:  `H${r}*16.67%`,
        commission:   `G${r}*${fee.commissionPct}%`,
        vat20:        `J${r}*${vatPct}%`,
        postageVat:   `L${r}*${vatPct}%`,
        accessoryFee: `${fee.accessoryFee ?? 0}`,
        totalVat:     `K${r}+M${r}`,
        grossProfit:  `H${r}-I${r}-J${r}-K${r}-L${r}-M${r}-N${r}`,
        gpPercent:    `P${r}/F${r}*100`,
        totalVatNtp:  `I${r}-O${r}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Listing-site helpers (preserved)
// ---------------------------------------------------------------------------

/**
 * LISTING_SITES — single source of truth for the user-facing platform
 * dropdowns. Includes legacy `Backmarket`, the canonical `Back Market` used by
 * the client master file, plus `FBA`, `Project`, `R T S`, and `Other`.
 */
export const LISTING_SITES: ListingSite[] = [
  'eBay',
  'Amazon',
  'OnBuy',
  'Backmarket',
  'Back Market',
  'FBA',
  'R T S',
  'Other',
];

/**
 * Map a raw `ListingSite` enum value (preserved verbatim from the client master
 * file) to a clean user-facing label.
 *   "Backmarket" -> "Back Market"
 *   "R T S"      -> "Ready To Ship"
 */
export function listingSiteLabel(s: ListingSite | string): string {
  switch (s) {
    case 'Backmarket': return 'Back Market';
    case 'R T S':      return 'Ready To Ship';
    default:           return s as string;
  }
}

// Re-export for convenience so legacy `import { Marketplace } from '../lib/platforms'` keeps working.
export { MARKETPLACES };
export type { Marketplace, MarketplaceFee };

// ---------------------------------------------------------------------------
// Back-compat shims — derived from MARKETPLACE_FEES
// ---------------------------------------------------------------------------
