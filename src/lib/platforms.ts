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
    commissionPct: 7.14,
    postage: 8.00,
    marginTaxDivisor: 6,
  },
  BM: {
    marketplace: 'BM',
    commissionPct: 12.00,
    postage: 10.00,
    marginTaxDivisor: 6,
    payPalKlarnaPct: 2.5,
  },
  EBAY: {
    marketplace: 'EBAY',
    commissionPct: 6.90,
    commissionReductionPct: 10,
    fixedFee: 0.40,
    postage: 8.00,
    rofPct: 0.35,
    vatPct: 20,
    promoPct: 5,
  },
  ONBUY: {
    marketplace: 'ONBUY',
    commissionPct: 7.00,
    postage: 8.00,
    marginTaxDivisor: 6,
    vatPct: 20,
  },
};

/**
 * Look up the fee schedule for a marketplace. Today this just returns the
 * baked-in defaults; the Firestore loader will mutate the cache behind this
 * helper so callers do not need to re-import anything when live fees change.
 */
export function getMarketplaceFee(m: Marketplace): MarketplaceFee {
  return DEFAULT_MARKETPLACE_FEES[m];
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
  postage: number;
  grossProfit: number;
  gpPercent: number;
  netProfit?: number;         // eBay incl. promo
}

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  const { marketplace, buyPrice: bp, salePrice: sp, postageOverride, eBayShippingTier, hasPayPalKlarna } = input;
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
      const marginalTax = r2(spMinusBp / (fee.marginTaxDivisor ?? 6));
      const commission  = r2(sp * fee.commissionPct / 100);
      const grossProfit = r2(sp - bp - marginalTax - commission - postage);
      const gpPercent   = gpPctByBp(grossProfit);
      return { spMinusBp, marginalTax, commission, postage, grossProfit, gpPercent };
    }

    case 'BM': {
      const marginalTax = r2(spMinusBp / (fee.marginTaxDivisor ?? 6));
      const commission  = r2(sp * fee.commissionPct / 100);
      const payPalKlarnaCom = hasPayPalKlarna && fee.payPalKlarnaPct != null
        ? r2(sp * fee.payPalKlarnaPct / 100)
        : undefined;
      const ppk = payPalKlarnaCom ?? 0;
      const grossProfit = r2(sp - bp - marginalTax - commission - postage - ppk);
      const gpPercent   = gpPctByBp(grossProfit);
      return { spMinusBp, marginalTax, commission, payPalKlarnaCom, postage, grossProfit, gpPercent };
    }

    case 'EBAY': {
      // MAR TAX uses the eBay-specific 16.6% rate (= 1/6 expressed as a %).
      // Spec line: `MAR TAX = I*16.6%` where I = SP-BP.
      const marginalTax = r2(spMinusBp * 16.6 / 100);

      const comGross  = sp * fee.commissionPct / 100;            // SP*6.9%
      const reduction = comGross * (fee.commissionReductionPct ?? 0) / 100;
      const commission = r2(comGross - reduction);              // (SP*6.9%) - (SP*6.9%)*10%

      const rof = r2(sp * (fee.rofPct ?? 0) / 100);             // SP*0.35%
      const fvf = r2(fee.fixedFee ?? 0);                        // 0.40

      // `0.2` column (literal numeric header in the workbook) = 20% on the
      // (COM + ROF + FVF) bundle. The master sheet's formula
      // `=(K+L+M)*20%` references the already-displayed (rounded) cells,
      // so we use the rounded intermediates here too — drift would only
      // appear if Excel were configured to use precision-as-displayed off,
      // which the master workbook is not.
      const twentyPercent = r2((commission + rof + fvf) * ((fee.vatPct ?? 20) / 100));
      const totalCom      = r2(commission + rof + fvf + twentyPercent);

      // GP = I - J - O - P  → (SP-BP) - MAR TAX - T.COM - SHIPPING
      const grossProfit = r2(spMinusBp - marginalTax - totalCom - postage);
      // EBAY is the only marketplace whose GP% master formula divides by SP.
      const gpPercent   = gpPctBySp(grossProfit);

      // NP(incl. PROMOTION) = GP - SP*5%
      const netProfit = r2(grossProfit - sp * (fee.promoPct ?? 0) / 100);

      return {
        spMinusBp, marginalTax, commission,
        rof, fvf, twentyPercent, totalCom,
        vat20: twentyPercent,
        postage, grossProfit, gpPercent, netProfit,
      };
    }

    case 'ONBUY': {
      const marVat   = r2(spMinusBp / (fee.marginTaxDivisor ?? 6));   // MAR VAT = (SP-BP)/6
      const commission = r2(sp * fee.commissionPct / 100);            // COM 7% = SP*7%
      const vat20    = r2(marVat * (fee.vatPct ?? 20) / 100);         // VAT 20% = MAR VAT * 20%
      const grossProfit = r2(sp - bp - commission - postage - marVat - vat20);
      // ONBUY's master formula `=M/G*100` uses col G which is SP on this
      // sheet (no Quantity column shifts the layout). Divide by SP, not BP.
      const gpPercent   = gpPctBySp(grossProfit);
      return {
        spMinusBp,
        marginalTax: marVat,   // populate the generic field too
        marVat,
        commission,
        vat20,
        postage,
        grossProfit,
        gpPercent,
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
      // Headers: ... G=BP, H=SP, I=SP-BP, J=Marginal Tax, K=Commission, L=Postage, M=GP, N=GP%
      return {
        spMinusBp:   `H${r}-G${r}`,
        marginalTax: `I${r}/${fee.marginTaxDivisor ?? 6}`,
        commission:  `H${r}/100*${fee.commissionPct}`,
        postage:     `${fee.postage}`,
        grossProfit: `H${r}-G${r}-J${r}-K${r}-L${r}`,
        gpPercent:   `M${r}/G${r}*100`,
      };
    }
    case 'BM': {
      // Headers: ... G=BP, H=SP, I=Payment Mode, J=SP-BP, K=Marginal Tax,
      //          L=PayPal/Klarna Com, M=Commission, N=Postage, O=GP, P=GP%
      return {
        spMinusBp:        `H${r}-G${r}`,
        marginalTax:      `J${r}/${fee.marginTaxDivisor ?? 6}`,
        payPalKlarnaCom:  `H${r}/100*${fee.payPalKlarnaPct ?? 2.5}`,
        commission:       `H${r}/100*${fee.commissionPct}`,
        postage:          `${fee.postage}`,
        grossProfit:      `H${r}-G${r}-K${r}-M${r}-N${r}-L${r}`,
        gpPercent:        `O${r}/G${r}*100`,
      };
    }
    case 'EBAY': {
      // Headers: ... G=BP, H=SP, I=SP-BP, J=MAR TAX, K=COM, L=ROF, M=FVF,
      //          N=0.2 (20% bundle), O=T.COM, P=SHIPPING, Q=GP, R=GP%, S=NP
      return {
        spMinusBp:     `H${r}-G${r}`,
        marTax:        `I${r}*16.6%`,
        commission:    `(H${r}*${fee.commissionPct}%)-(H${r}*${fee.commissionPct}%)*${fee.commissionReductionPct ?? 10}%`,
        rof:           `H${r}*${fee.rofPct ?? 0.35}%`,
        fvf:           `${fee.fixedFee ?? 0.4}`,
        twentyPercent: `(K${r}+L${r}+M${r})*${fee.vatPct ?? 20}%`,
        totalCom:      `K${r}+L${r}+M${r}+N${r}`,
        grossProfit:   `I${r}-J${r}-O${r}-P${r}`,
        gpPercent:     `Q${r}/H${r}*100`,
        netProfit:     `Q${r}-H${r}*${fee.promoPct ?? 5}%`,
      };
    }
    case 'ONBUY': {
      // Headers: ... F=BP, G=SP, H=SP-BP, I=MAR VAT, J=COM 7%, K=VAT 20%, L=SHIP, M=GP, N=GP%
      return {
        spMinusBp:   `G${r}-F${r}`,
        marVat:      `H${r}/${fee.marginTaxDivisor ?? 6}`,
        commission:  `G${r}*${fee.commissionPct}%`,
        vat20:       `I${r}*${fee.vatPct ?? 20}%`,
        postage:     `${fee.postage}`,
        grossProfit: `G${r}-F${r}-J${r}-K${r}-L${r}-I${r}`,
        gpPercent:   `M${r}/G${r}*100`,
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
