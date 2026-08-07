/**
 * platforms.ts — single source of truth for marketplace fee schedules.
 *
 * Resolves audit blocker B5: previous `PLATFORMS` constants had wrong commission
 * rates and were missing Project, eBay ROF/FVF/VAT/promo and BM PayPal/Klarna.
 *
 * The new authoritative table is `MARKETPLACE_FEES` (keyed by canonical
 * `Marketplace` sheet names: AMAZON / BM / EBAY / ONBUY / TEMU). It powers:
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
 * The live fee schedule. These are the code-side defaults; at boot
 * `getMarketplaceFee()` can be swapped to read from the Firestore
 * `marketplaceFees` collection (doc id = marketplace name).
 *
 * PROVENANCE — read this before citing a document as ground truth.
 * The table was originally seeded from MASTER_FILES_AUDIT.md §5 and the
 * per-sheet formulas in MASTER_FILES_SPEC.md, but it is NO LONGER those
 * values. It has been replaced twice since:
 *
 *   2026-05  operator schema move — Amazon 7.14% -> 7% of SP; BM 12% +
 *            PayPal/Klarna 2.5% -> 11% + flat £9.99 Customer Care Fees;
 *            eBay 6.9%×0.9 -> 6.21% baked in, promo-as-%-of-SP -> an
 *            operator-entered Marketing line; marginal tax `SP-BP / 6` ->
 *            a literal 16.67%; Amazon gains C. VAT / DSF / DSF. VAT /
 *            Accessories. OnBuy's 7% is the only rate that survived.
 *   2026-07  TEMU added, corrected against the client's TEMU_FORMULA.csv.
 *
 * So MASTER_FILES_SPEC.md / MASTER_FILES_AUDIT.md are HISTORICAL for fees —
 * both now carry a notice saying so. THIS FILE is the source of truth; the
 * written explanation of every formula is SALES_SCHEMA_AND_CALCULATIONS.md,
 * and the report column contract is templates/REPORT_SCHEMAS.md.
 *
 * Changing a constant here RESTATES HISTORY: the Sales Report writes live
 * Excel formulas via `excelFormulaFor()`, and `recomputeSale()` ignores the
 * figures stored on a Sale doc, so past rows recompute at the new rate.
 * That is intended for a formula correction and unwanted for a rate change.
 * Per-marketplace comments below carry the current provenance for each rate.
 */
export const DEFAULT_MARKETPLACE_FEES: Record<Marketplace, MarketplaceFee> = {
  AMAZON: {
    marketplace: 'AMAZON',
    // Operator's 2026-05 schema move: Commission is 7% of SP (standard
    // Amazon marketplace fee on the sale price — was 7.14% × SP before).
    // Every Amazon line carries a VAT/DSF/accessory breakdown derived
    // from Commission, so changing the commission base shifts the whole
    // chain (C.VAT = Com×20%, DSF = Com×2%, DSF VAT = DSF×20%) in lock-step.
    // Postage default 0 — operator-entered per sale. The 6.30 UI
    // autofill lives in SellOrderModal, NOT here, so calcSaleFinancials
    // stays master-aligned (the calcSaleFinancials.master tests assert
    // £8 Amazon / £10 BM postage by spec; moving the default off 0
    // poisoned every imported sale's GP / Total VAT NTP cascade).
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
    // the legacy code), plus a flat Customer Care Fees line per sale (the
    // rate is below, and was corrected in 2026-08). No PayPal/Klarna
    // commission any more — drop the field. No
    // separate Total VAT column either: BM's only VAT line is P. VAT,
    // so totalVatNtp = MarTax − P. VAT directly. Postage default 0 —
    // operator-entered (see AMAZON comment above for why we don't
    // pre-fill at the math layer).
    commissionPct: 11,
    postage: 0,
    marginTaxDivisor: 6,
    vatPct: 20,
    accessoryFee: 1,
    // 2026-08: £8.99, not the £9.99 carried since 2026-05. The operator's
    // master (SALES_TEMPLATE_UPLOAD_30TH_JULY.xlsx, BM SALES) charges 8.99
    // on every row; 9.99 made our GP exactly £1 light on every BM line.
    customerCareFees: 8.99,
  },
  EBAY: {
    marketplace: 'EBAY',
    // 2026-05 operator schema: commission is the post-reduction effective
    // rate (6.21% = 6.9% − 10%) baked into a single percentage, and the
    // old promo-as-%-of-SP convention is replaced by an operator-entered
    // Marketing line carried on the Sale doc. Postage stays 0 here — eBay
    // uses the explicit shipping-tier picker (£1/£2/£8), and any
    // non-tier value flows in via postageOverride. Default tier in the
    // SellOrderModal handles the new-sale case.
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
    // FVF / ROF / Marketing / DSF lines. Postage default 0 —
    // operator-entered, UI autofill lives in SellOrderModal.
    commissionPct: 7,
    postage: 0,
    marginTaxDivisor: 6,
    vatPct: 20,
    accessoryFee: 1,
  },
  TEMU: {
    marketplace: 'TEMU',
    // 2026-07 addition, corrected against the client's actual Temu export
    // (TEMU_FORMULA.csv). First pass assumed vatPct=0 (no VAT on Commission
    // or Postage at all) from a single illustrative row — that rule doesn't
    // hold: a real order shows Postage VAT = Postage×20%, not zero. commissionPct
    // here is a FALLBACK only, used when a file doesn't carry Temu's own
    // Commission column — Temu's real per-order commission varies by
    // category and the export reports the actual figure directly, so the
    // sheet's own value always wins (see calcSaleFinancials' TEMU branch).
    // No dsfPct — Temu's export has no DSF / DSF VAT columns at all.
    //
    // 2026-08: the fallback is 4.61%, not the 7% guessed before the master
    // arrived. The operator's Temu master carries a real formula in the
    // Commission cell — `=H2*4.61%` — so a Temu sale entered in the app
    // (no file to read from) now derives the same figure their sheet does.
    // 7% overstated Temu commission by half as much again.
    commissionPct: 4.61,
    commissionBase: 'sp',
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
  TEMU: 'Temu',
};

const LISTING_SITE_TO_MARKETPLACE: Record<string, Marketplace> = {
  // Pretty / user-facing names
  'Amazon':     'AMAZON',
  'Back Market':'BM',
  'Backmarket': 'BM',   // legacy
  'eBay':       'EBAY',
  'OnBuy':      'ONBUY',
  'Temu':       'TEMU',
  // Canonical Marketplace enum values — recordSale writes salePlatform in
  // this form ('EBAY' / 'AMAZON' / …) so the reverse lookup also has to
  // accept it; without these entries, every non-eBay sale resolved to the
  // 'EBAY' fallback inside inventoryUnitToSale and double-counted on the
  // Sell screen because the dedupe key `${mp}__${orderNumber}` didn't match.
  'AMAZON':  'AMAZON',
  'BM':      'BM',
  'EBAY':    'EBAY',
  'ONBUY':   'ONBUY',
  'TEMU':    'TEMU',
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
  /** Temu only — Temu's own export reports the exact commission it charged
   *  per order (rates vary by category, unlike Amazon's flat referral fee),
   *  so the sheet's own value always wins when present. Falls back to
   *  commissionPct × SP only for a file that doesn't carry the column. */
  commissionOverride?: number;
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
  /** eBay only — the sheet's own P. VAT cell. eBay postage VAT is not
   *  derived (the operator's master has no formula there and reads 0
   *  throughout), so this is the only way a non-zero reaches the calc. */
  postageVatOverride?: number;
  /** eBay only — the sheet's own M. VAT cell. Also a typed cell in the
   *  master, and it does NOT track the Marketing column: rows with £0 of
   *  marketing still carry M. VAT. Without this the imported row's GP
   *  misses that charge. Falls back to `marketing × vatPct`. */
  marketingVatOverride?: number;
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
  customerCareFees?: number;  // BM: flat £8.99 (see DEFAULT_MARKETPLACE_FEES)
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
  const {
    marketplace, buyPrice: bp, salePrice: sp, postageOverride, eBayShippingTier,
    commissionOverride,
  } = input;
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
  //   AMAZON / BM / ONBUY / TEMU  GP% = GP / BP * 100  (margin-over-cost)
  //   EBAY                        GP% = GP / SP * 100  (margin-over-revenue)
  // ONBUY sat in the wrong list here until 2026-08. The code was always
  // right — only this comment was wrong. The operator's master settles it:
  // ONBUY's GP % cell reads `=P2/F2*100`, and F is BP on that sheet.
  // EBAY's reads `=V2/H2*100`, and H is SP.
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
      const accessoryFeeVal = fee.accessoryFee ?? 0;

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

    case 'TEMU': {
      // 2026-07: reused the AMAZON branch verbatim at first (vatPct=0,
      // dsfPct=0 — see the fee schedule's history). That matched the one
      // illustrative example available then, but broke against the
      // client's actual Temu export (TEMU_FORMULA.csv): real orders show
      // real Postage VAT (Postage×20%), and Commission is NOT a flat % of
      // SP — Temu's referral rate varies by category, so its report gives
      // the operator the real commission it charged, per order, directly.
      //
      // Corrected formula chain (verified against the client's export,
      // order PO-210-07053322437751959: BP=55 SP=83.99 Postage=6.30 →
      // Commission=3.87 CommissionVAT=4.07 → MarginalTax=4.83 P.VAT=1.26
      // TotalVAT=1.26 GP=11.73 GP%=21.32 TotalVATNTP=3.57):
      //   spMinusBp     = SP − BP
      //   marginalTax   = spMinusBp × 16.67%
      //   commission    = the sheet's own Commission cell; falls back to
      //                   SP × commissionPct (4.61%) only when the file
      //                   doesn't carry the column
      //   commissionVat = commission × vatPct — DERIVED, never read from
      //                   the sheet. The master's Commission VAT cell reads
      //                   `=K2+20%`, which Excel evaluates as K + 0.2, not
      //                   K × 20%: on the reference order that is
      //                   3.87 + 0.2 = 4.07 where 20% VAT is 0.77. A `+`
      //                   typed for a `*`. The rate is not negotiable per
      //                   order the way Temu's referral rate is — VAT on a
      //                   commission is 20% of it — so there is nothing to
      //                   read from the file and we compute it.
      //                   Tracked for the record only: Temu VAT-invoices
      //                   this to the seller as reclaimable input tax, so
      //                   unlike Amazon it is NOT part of totalVat or
      //                   grossProfit. Confirmed by the export: Total VAT
      //                   (1.26) = P.VAT alone, and GP (11.73) only
      //                   reconciles when Commission VAT is left out of
      //                   the subtraction chain — which is also why fixing
      //                   the typo moves no money.
      //   postageVat    = postage × vatPct (20%) — no longer zero
      //   totalVat      = postageVat                    (Commission VAT excluded)
      //   grossProfit   = spMinusBp − marginalTax − commission − postage
      //                   − postageVat − accessoryFee    (Commission VAT excluded)
      //   totalVatNtp   = marginalTax − totalVat
      //   gpPercent     = GP / BP × 100
      // No DSF line at all — Temu's export has no DSF/DSF VAT columns.
      const vatPctFrac = (fee.vatPct ?? 20) / 100;
      const accessoryFeeVal = fee.accessoryFee ?? 0;

      const marginalTaxRaw   = spMinusBp * 16.67 / 100;
      const commissionRaw    = commissionOverride ?? (sp * fee.commissionPct / 100);
      const commissionVatRaw = commissionRaw * vatPctFrac;
      const postageVatRaw    = input.postageVatExempt ? 0 : (postage * vatPctFrac);
      const totalVatRaw      = postageVatRaw;
      const grossProfitRaw   = spMinusBp - marginalTaxRaw - commissionRaw
        - postage - postageVatRaw - accessoryFeeVal;
      const totalVatNtpRaw   = marginalTaxRaw - totalVatRaw;
      const gpPercentRaw     = bp > 0 ? grossProfitRaw / bp * 100 : 0;

      return {
        spMinusBp,
        marginalTax:   r2(marginalTaxRaw),
        commission:    r2(commissionRaw),
        commissionVat: r2(commissionVatRaw),
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
      //   customerCareFees = 8.99 flat                   (literal in F3)
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
      const accessoryFeeVal = fee.accessoryFee ?? 0;
      const customerCareFeesVal = fee.customerCareFees ?? 0;

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
      //   postageVat    = 0 unless the file carries one. eBay's shipping is
      //                   zero-rated to this operator — see the note at the
      //                   assignment below.
      //   marketing     = 0 unless the operator enters one. The master's
      //                   Marketing cell carries no formula; it is typed, and
      //                   is £0 on most rows. Both lines used to be derived
      //                   (postage×20%, SP×5%) and that invented spend flowed
      //                   straight through GP.
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
      const accessoryFeeVal = fee.accessoryFee ?? 0;
      // 2026-08, from the operator's master (SALES_TEMPLATE_UPLOAD_30TH_JULY
      // .xlsx, EBAY SALES). Marketing carries NO formula in that sheet — the
      // cell is typed by hand and is £0 on most rows (£8 / £9 / £9.60 on a
      // few). The old `sp * 5%` default therefore invented a marketing spend
      // that never happened, ~£2.80 on a £56 sale, and it flowed straight
      // through GP. Default to zero and let the caller supply the real spend.
      const marketingVal = input.marketing ?? 0;

      const marginalTaxRaw   = spMinusBp * 16.67 / 100;
      const commissionRaw    = sp * fee.commissionPct / 100;
      const rofRaw           = sp * (fee.rofPct ?? 0) / 100;
      const fvfRaw           = fee.fixedFee ?? 0;
      const vatRaw           = (commissionRaw + rofRaw + fvfRaw) * vatPctFrac;
      const tComRaw          = commissionRaw + rofRaw + fvfRaw + vatRaw;
      // eBay is the one marketplace that does NOT derive postage VAT. The
      // master's P. VAT column has no formula and reads 0 on all 33 rows
      // despite £4.65 of postage, so eBay's shipping is zero-rated to the
      // operator. Charging 20% here cost £0.93 of GP on every eBay line.
      // `postageVatOverride` lets an import carry a non-zero back in.
      const postageVatRaw    = input.postageVatExempt ? 0 : (input.postageVatOverride ?? 0);
      const marketingVatRaw  = input.marketingVatOverride ?? (marketingVal * vatPctFrac);
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
      const accessoryFeeVal = fee.accessoryFee ?? 0;

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
  // Column letters are resolved from SALES_HEADERS by NAME. They used to be
  // written literally (`H${r}-G${r}`), which is what made the column order
  // append-only: moving a column silently repointed the arithmetic at its
  // neighbour, with no error and no test failure — just a wrong money column.
  const C = (name: string) => salesColLetter(marketplace, name);
  switch (marketplace) {
    case 'AMAZON': {
      // 2026-05 schema. Columns (1-indexed):
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier, F=Quantity,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission, L=C. VAT,
      //   M=DSF, N=DSF VAT, O=Postage, P=P. VAT, Q=Accessories,
      //   R=Total VAT, S=GP, T=GP %, U=Total VAT NTP, V=Comments, W=Model,
      //   X=Return Date, Y=Outcome, Z=Return Reason, AA=Shipping Legs,
      //   AB=Postage Loss (voided sales only — refund=2 legs, replacement=3).
      // GP % is NET: subtracts the Postage Loss cell from GP so a refunded
      // or replaced unit reads as actually lost margin. Active rows leave
      // Postage Loss blank, which Excel coerces to 0 — formula collapses to
      // the original GP/BP*100 in that case.
      const vatPct = fee.vatPct ?? 20;
      const dsfPct = fee.dsfPct ?? 0;
      const commissionBase = (fee.commissionBase ?? 'spMinusBp') === 'sp' ? `${C('SP')}${r}` : `${C('SP-BP')}${r}`;
      return {
        spMinusBp:     `${C('SP')}${r}-${C('BP')}${r}`,
        marginalTax:   `${C('SP-BP')}${r}*16.67%`,
        commission:    `${commissionBase}/100*${fee.commissionPct}`,
        commissionVat: `${C('Commission')}${r}*${vatPct}%`,
        dsf:           `${C('Commission')}${r}*${dsfPct}%`,
        dsfVat:        `${C('DSF')}${r}*${vatPct}%`,
        // Postage is operator-entered per sale — emit a static default so the
        // cell isn't empty on an unedited row; the writer overwrites with the
        // sale's actual postage value before save.
        postage:       `${fee.postage}`,
        postageVat:    `${C('Postage')}${r}*${vatPct}%`,
        accessoryFee:  `${fee.accessoryFee ?? 0}`,
        totalVat:      `${C('C. VAT')}${r}+${C('DSF. VAT')}${r}+${C('P. VAT')}${r}`,
        grossProfit:   `${C('SP-BP')}${r}-${C('Marginal Tax')}${r}-${C('Commission')}${r}-${C('C. VAT')}${r}-${C('DSF')}${r}-${C('DSF. VAT')}${r}-${C('Postage')}${r}-${C('P. VAT')}${r}-${C('Accessories')}${r}`,
        gpPercent:     `(${C('GP')}${r}-${C('Postage Loss')}${r})/${C('BP')}${r}*100`,
        totalVatNtp:   `${C('Marginal Tax')}${r}-${C('Total VAT')}${r}`,
      };
    }

    case 'TEMU': {
      // 2026-07, corrected against the client's final Temu export
      // (TEMU_FORMULA.csv) — own 20-column layout (see SALES_HEADERS.TEMU
      // / clientReport.ts writeSaleRow), not Amazon's. Columns (1-indexed):
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier, F=Quantity,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission (literal),
      //   L=Commission VAT (literal), M=Postage, N=P. VAT, O=Accessories,
      //   P=Total VAT, Q=GP, R=GP %, S=Total VAT NTP, T=Comments, U=Model,
      //   V=Return Date, W=Outcome, X=Return Reason, Y=Shipping Legs,
      //   Z=Postage Loss.
      // No DSF/DSF VAT — Temu's export doesn't have the fee. Commission and
      // Commission VAT are literal cells, not formulas: Temu's per-order
      // commission varies by category, so the export gives the real figure
      // charged rather than a percentage the operator could derive. Total
      // VAT and GP both deliberately EXCLUDE Commission VAT (L) — Temu
      // VAT-invoices it to the seller as reclaimable input tax, confirmed
      // by the export (Total VAT = P.VAT alone; GP only reconciles to the
      // sheet's number when Commission VAT is left out of the subtraction).
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:    `${C('SP')}${r}-${C('BP')}${r}`,
        marginalTax:  `${C('SP-BP')}${r}*16.67%`,
        // Commission (K) has no formula — Temu's per-order referral rate
        // varies by category, so the writer sets it from the sale. Commission
        // VAT (L) IS a formula: it is 20% of K, and the master's own
        // `=K2+20%` is a typo for `=K2*20%` that we do not reproduce.
        commissionVat: `${C('Commission')}${r}*${vatPct}%`,
        postageVat:   `${C('Postage')}${r}*${vatPct}%`,
        accessoryFee: `${fee.accessoryFee ?? 0}`,
        totalVat:     `${C('P. VAT')}${r}`,
        grossProfit:  `${C('SP-BP')}${r}-${C('Marginal Tax')}${r}-${C('Commission')}${r}-${C('Postage')}${r}-${C('P. VAT')}${r}-${C('Accessories')}${r}`,
        gpPercent:    `(${C('GP')}${r}-${C('Postage Loss')}${r})/${C('BP')}${r}*100`,
        totalVatNtp:  `${C('Marginal Tax')}${r}-${C('Total VAT')}${r}`,
      };
    }

    case 'BM': {
      // 2026-05 schema. 19 sale cols + return-info block + Postage Loss:
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier, F=Quantity,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission,
      //   L=Customer Care Fees, M=Postage, N=P. VAT, O=Accessories,
      //   P=GP, Q=GP %, R=Total VAT NTP, S=Comments, T=Model,
      //   U=Return Date, V=Outcome, W=Return Reason, X=Shipping Legs,
      //   Y=Postage Loss
      // No "Total VAT" column on BM — only one VAT line (P. VAT), so
      // Total VAT NTP subtracts P. VAT (col N) directly from Marginal Tax.
      // GP % is NET of Postage Loss (col Y) — see AMAZON case for rationale.
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:        `${C('SP')}${r}-${C('BP')}${r}`,
        marginalTax:      `${C('SP-BP')}${r}*16.67%`,
        commission:       `${C('SP')}${r}/100*${fee.commissionPct}`,
        customerCareFees: `${fee.customerCareFees ?? 0}`,
        postageVat:       `${C('Postage')}${r}*${vatPct}%`,
        accessoryFee:     `${fee.accessoryFee ?? 0}`,
        grossProfit:      `${C('SP-BP')}${r}-${C('Marginal Tax')}${r}-${C('Commission')}${r}-${C('Customer Care Fees')}${r}-${C('Postage')}${r}-${C('P. VAT')}${r}-${C('Accessories')}${r}`,
        gpPercent:        `(${C('GP')}${r}-${C('Postage Loss')}${r})/${C('BP')}${r}*100`,
        totalVatNtp:      `${C('Marginal Tax')}${r}-${C('P. VAT')}${r}`,
      };
    }
    case 'EBAY': {
      // 2026-05 schema, formulas mirror the operator's reference sheet
      // verbatim (Marginal Tax × 16.67%, Commission via the explicit
      // 6.9% − 10% reduction so the audit trail shows the legacy fee
      // structure, Marketing derived from SP × 5%, GP % divides by SP).
      // 25 sale cols + return-info block + Postage Loss = 30 cols total:
      //   A=Date, B=OrderNo, C=SKU, D=IMEI, E=Supplier, F=Units,
      //   G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission, L=ROF, M=FVF,
      //   N=VAT, O=T.COM, P=Postage, Q=P. VAT, R=Marketing, S=M. VAT,
      //   T=Accessories, U=Total VAT, V=GP, W=GP %, X=Total VAT NTP,
      //   Y=Comments, Z=Model,
      //   AA=Return Date, AB=Outcome, AC=Return Reason, AD=Shipping Legs,
      //   AE=Postage Loss
      // GP % is NET of Postage Loss (col AE) — see AMAZON for rationale.
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:    `${C('SP')}${r}-${C('BP')}${r}`,
        marginalTax:  `${C('SP-BP')}${r}*16.67%`,
        commission:   `(${C('SP')}${r}*6.9%)-(${C('SP')}${r}*6.9%)*10%`,
        rof:          `${C('SP')}${r}*${fee.rofPct ?? 0.35}%`,
        fvf:          `${fee.fixedFee ?? 0.4}`,
        vat20:        `(${C('Commission')}${r}+${C('ROF')}${r}+${C('FVF')}${r})*${vatPct}%`,
        totalCom:     `${C('Commission')}${r}+${C('ROF')}${r}+${C('FVF')}${r}+${C('VAT')}${r}`,
        // P. VAT and Marketing carry NO formula — they are typed cells in
        // the operator's master, so the writer sets Q/R from the sale's own
        // postageVat / marketing. Emitting `P*20%` and `H*5%` here made a
        // re-opened workbook re-invent both. M. VAT keeps its formula: it
        // derives off the Marketing cell, so it follows whatever is typed.
        marketingVat: `${C('Marketing')}${r}*${vatPct}%`,
        accessoryFee: `${fee.accessoryFee ?? 0}`,
        totalVat:     `${C('VAT')}${r}+${C('P. VAT')}${r}+${C('M. VAT')}${r}`,
        grossProfit:  `${C('SP-BP')}${r}-${C('Marginal Tax')}${r}-${C('T.COM')}${r}-${C('Postage')}${r}-${C('P. VAT')}${r}-${C('Marketing')}${r}-${C('M. VAT')}${r}-${C('Accessories')}${r}`,
        gpPercent:    `(${C('GP')}${r}-${C('Postage Loss')}${r})/${C('SP')}${r}*100`,
        totalVatNtp:  `${C('Marginal Tax')}${r}-${C('Total VAT')}${r}`,
      };
    }
    case 'ONBUY': {
      // 2026-05 schema. 19 sale cols + return-info block + Postage Loss:
      //   A=Date, B=Order Number, C=SKU, D=IMEI, E=Supplier,
      //   F=BP, G=SP, H=SP-BP, I=Marginal Tax, J=Commission, K=VAT 20%,
      //   L=Postage, M=P. VAT, N=Accessories, O=Total VAT, P=GP,
      //   Q=GP %, R=Total VAT NTP, S=Comments, T=Model,
      //   U=Return Date, V=Outcome, W=Return Reason, X=Shipping Legs,
      //   Y=Postage Loss
      // GP % is NET of Postage Loss (col Y) — see AMAZON for rationale.
      const vatPct = fee.vatPct ?? 20;
      return {
        spMinusBp:    `${C('SP')}${r}-${C('BP')}${r}`,
        marginalTax:  `${C('SP-BP')}${r}*16.67%`,
        commission:   `${C('SP')}${r}*${fee.commissionPct}%`,
        vat20:        `${C('Commission')}${r}*${vatPct}%`,
        postageVat:   `${C('Postage')}${r}*${vatPct}%`,
        accessoryFee: `${fee.accessoryFee ?? 0}`,
        totalVat:     `${C('VAT 20%')}${r}+${C('P. VAT')}${r}`,
        grossProfit:  `${C('SP-BP')}${r}-${C('Marginal Tax')}${r}-${C('Commission')}${r}-${C('VAT 20%')}${r}-${C('Postage')}${r}-${C('P. VAT')}${r}-${C('Accessories')}${r}`,
        gpPercent:    `(${C('GP')}${r}-${C('Postage Loss')}${r})/${C('BP')}${r}*100`,
        totalVatNtp:  `${C('Marginal Tax')}${r}-${C('Total VAT')}${r}`,
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
  'Temu',
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


// ---------------------------------------------------------------------------
// SALES_REPORT column layout
// ---------------------------------------------------------------------------

export type SalesHeaderRow = Array<string | number>;

/** Exported so the Mark Multiple Sold grid can be asserted against the sheet
 *  each of its rows will land on — see bulkSaleColumns.ts. Read-only: the
 *  column order here is append-only, because every GP / GP % / TOTAL formula
 *  on these tabs references hard column letters. */
export const SALES_HEADERS: Record<Marketplace, SalesHeaderRow> = {
  // Layout, 2026-08, at the operator's request: what the handset IS, then the
  // money left-to-right in calculation order, then the return block, ending
  // with comments.
  //
  // This order is now free to change. Every formula in excelFormulaFor and
  // every cell write in writeSaleRow resolves its column through salesCol /
  // salesColLetter BY NAME, so nothing silently repoints when a column moves.
  // Before that, Model / Storage / Colour had to be appended last however
  // wrong that read, because the arithmetic addressed cells by letter.
  //
  // The importer resolves columns by header name too, so files exported
  // under the previous order still import unchanged.
  AMAZON: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
    'Storage', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP',
    'Marginal Tax', 'Commission', 'C. VAT', 'DSF', 'DSF. VAT', 'Postage',
    'P. VAT', 'Accessories', 'Total VAT', 'GP', 'GP %', 'Total VAT NTP',
    'Postage Loss', 'Net GP £', 'Return Date', 'Outcome', 'Shipping Legs', 'Return Reason',
    'Comments',
  ],
  BM: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
    'Storage', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP',
    'Marginal Tax', 'Commission', 'Customer Care Fees', 'Postage', 'P. VAT', 'Accessories',
    'GP', 'GP %', 'Total VAT NTP', 'Postage Loss', 'Net GP £', 'Return Date',
    'Outcome', 'Shipping Legs', 'Return Reason', 'Comments',
  ],
  EBAY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
    'Storage', 'Supplier', 'Units', 'BP', 'SP', 'SP-BP',
    'Marginal Tax', 'Commission', 'ROF', 'FVF', 'VAT', 'T.COM',
    'Postage', 'P. VAT', 'Marketing', 'M. VAT', 'Accessories', 'Total VAT',
    'GP', 'GP %', 'Total VAT NTP', 'Postage Loss', 'Net GP £', 'Return Date',
    'Outcome', 'Shipping Legs', 'Return Reason', 'Comments',
  ],
  ONBUY: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
    'Storage', 'Supplier', 'BP', 'SP', 'SP-BP', 'Marginal Tax',
    'Commission', 'VAT 20%', 'Postage', 'P. VAT', 'Accessories', 'Total VAT',
    'GP', 'GP %', 'Total VAT NTP', 'Postage Loss', 'Net GP £', 'Return Date',
    'Outcome', 'Shipping Legs', 'Return Reason', 'Comments',
  ],
  TEMU: [
    'Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour',
    'Storage', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP',
    'Marginal Tax', 'Commission', 'Commission VAT', 'Postage', 'P. VAT', 'Accessories',
    'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Postage Loss', 'Net GP £',
    'Return Date', 'Outcome', 'Shipping Legs', 'Return Reason', 'Comments',
  ],
};

/** 1-based column index of a header on a marketplace tab.
 *
 *  Every formula and every cell write resolves its position through this, so
 *  the column ORDER above is now free to change. It used to be append-only:
 *  excelFormulaFor hard-coded letters (`H${r}-G${r}`) and writeSaleRow
 *  hard-coded indices, so moving a column silently repointed the arithmetic
 *  at the wrong cell — which is why Model, Storage and Colour were bolted
 *  onto the end rather than sitting with the rest of the handset's identity.
 *
 *  Throws rather than returning -1: a typo'd header name must fail loudly at
 *  build time, not produce a workbook addressing column zero. */
export function salesCol(marketplace: Marketplace, name: string): number {
  const i = (SALES_HEADERS[marketplace] as readonly (string | number)[]).indexOf(name);
  if (i < 0) throw new Error(`SALES_HEADERS[${marketplace}] has no column "${name}"`);
  return i + 1;
}

/** Excel column letter for a header on a marketplace tab (1=A … 27=AA). */
export function salesColLetter(marketplace: Marketplace, name: string): string {
  let n = salesCol(marketplace, name);
  let out = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
