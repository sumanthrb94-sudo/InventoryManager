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
    commissionPct: 7,           // H/100*7
    postage: 6.30,              // most common; overridable per-row
    marginTaxDivisor: 6,        // unused — superseded by 16.67% literal
  },
  BM: {
    marketplace: 'BM',
    commissionPct: 11,          // I/100*11
    postage: 6.30,
    marginTaxDivisor: 6,
  },
  EBAY: {
    marketplace: 'EBAY',
    commissionPct: 6.90,        // SP * 6.9%
    commissionReductionPct: 10, // less 10% of that
    fixedFee: 0.40,             // FVF
    postage: 6.30,              // overridable per-row (0 / 1.9 / 4.65 / 6.30)
    rofPct: 0.35,
    vatPct: 20,
    promoPct: 5,                // Marketing = SP * 5%
  },
  ONBUY: {
    marketplace: 'ONBUY',
    commissionPct: 7,           // G*7%
    postage: 6.30,
    marginTaxDivisor: 6,
    vatPct: 20,                 // VAT 20% = Commission * 20%
  },
};

// ---------------------------------------------------------------------------
// Literal constants from SALES_REPORT_2026_1.xlsx (verbatim from client cells)
// ---------------------------------------------------------------------------
/** Marginal Tax rate, applied to SP-BP. Literal 16.67% in every sheet. */
const MARGIN_TAX_RATE = 0.1667;
/** P.VAT = Postage * 20% (all sheets). */
const POSTAGE_VAT_RATE = 0.20;
/** Default postage when no per-row override. */
export const DEFAULT_POSTAGE = 6.30;
/** Default accounting fee per order (all sheets except AMAZON which may use 0). */
export const DEFAULT_ACC = 1;
/** AMAZON: C.VAT rate applied to Commission. */
const AMZ_C_VAT_RATE = 0.20;
/** AMAZON: DSF rate applied to Commission. */
const AMZ_DSF_RATE = 0.02;
/** AMAZON: DSF.VAT rate applied to DSF. */
const AMZ_DSF_VAT_RATE = 0.20;
/** BM: literal Customer Care Fees per order. */
const BM_CUSTOMER_CARE_FEES = 8.99;

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
  'Amazon':     'AMAZON',
  'Back Market':'BM',
  'Backmarket': 'BM',   // legacy
  'eBay':       'EBAY',
  'OnBuy':      'ONBUY',
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
  /**
   * Postage actually charged on the order. Defaults to 6.30 (DEFAULT_POSTAGE).
   * AMAZON sometimes uses 5; EBAY varies (0 / 1.9 / 4.65 / 6.30).
   */
  postage?: number;
  /**
   * Accounting fee per order. Defaults to 1 (DEFAULT_ACC). AMAZON sometimes
   * uses 0 (sales where the order was reconciled differently).
   */
  accountingFee?: number;
}

/**
 * Full computed financial breakdown for one sale row, matching the columns of
 * the client's SALES_REPORT_2026_*.xlsx workbook tab-for-tab. Optional fields
 * are present only on the marketplaces where the corresponding column exists.
 *
 * Values are NOT rounded — they preserve full precision so the JS values match
 * Excel's evaluated cell values to within IEEE-754 noise (≤ 1e-9). Callers that
 * render the figures should apply their own display rounding.
 */
export interface SaleFinancials {
  spMinusBp: number;
  marginalTax: number;
  commission: number;
  // AMAZON-only
  cVat?: number;
  dsf?: number;
  dsfVat?: number;
  // BM-only
  customerCareFees?: number;
  // EBAY-only
  rof?: number;
  fvf?: number;
  vat?: number;                // (Comm + ROF + FVF) * 20%
  totalCom?: number;
  marketing?: number;
  mVat?: number;
  // ONBUY-only
  vat20?: number;              // Commission * 20%
  // Common to all four sheets
  postage: number;
  pVat: number;                // Postage * 20%
  accountingFee: number;
  totalVat: number;            // sheet-specific sum of VAT components; BM has no Total VAT col so we return pVat
  grossProfit: number;
  gpPercent: number;           // AMAZON/BM/ONBUY divide by BP; EBAY divides by SP
  totalVatNtp: number;         // MarginalTax - TotalVAT (BM: MarginalTax - P.VAT)
}

/**
 * Compute every derived sale field for one marketplace transaction. Returned
 * values are at full IEEE-754 precision (no rounding) so they match Excel's
 * evaluated cell values verbatim. Formulas are verbatim from the columns of
 * the client SALES_REPORT_2026_1.xlsx workbook — see header comment for the
 * tab-by-tab spec.
 *
 *   AMAZON SALES (21 cols):
 *     I=SP-BP = H-G
 *     J=Marginal Tax = I*16.67%
 *     K=Commission = H/100*7
 *     L=C. VAT = K*20%
 *     M=DSF = K*2%
 *     N=DSF. VAT = M*20%
 *     O=Postage (literal, default 6.30)
 *     P=P. VAT = O*20%
 *     Q=Acc (literal, default 1)
 *     R=Total VAT = L+N+P
 *     S=GP = I-J-K-L-M-N-O-P-Q
 *     T=GP % = S/G*100              ← divide by BP
 *     U=Total VAT NTP = J-R
 *
 *   BM SALES (20 cols, Payment Mode at col G is informational):
 *     J=SP-BP = I-H
 *     K=Marginal Tax = J*16.67%
 *     L=Commission = I/100*11
 *     M=Customer Care Fees (literal 8.99)
 *     N=Postage (literal, default 6.30)
 *     O=P. VAT = N*20%
 *     P=Acc (literal, default 1)
 *     Q=GP = J-K-L-M-N-O-P
 *     R=GP % = Q/H*100              ← divide by BP
 *     S=Total VAT NTP = K-O         ← MarTax - P.VAT (no Total VAT col)
 *
 *   EBAY SALES (24 cols):
 *     I=SP-BP = H-G
 *     J=Marginal Tax = I*16.67%
 *     K=Commission = (H*6.9%) - (H*6.9%)*10%
 *     L=ROF = H*0.35%
 *     M=FVF (literal 0.4)
 *     N=VAT = (K+L+M)*20%
 *     O=T.COM = K+L+M+N
 *     P=Postage (literal, varies)
 *     Q=P. VAT = P*20%
 *     R=Marketing = H*5%
 *     S=M. VAT = R*20%
 *     T=Acc (literal, default 1)
 *     U=Total VAT = N+Q+S
 *     V=GP = I-J-O-P-Q-R-S-T
 *     W=GP% = V/H*100               ← divide by SP (NB: EBAY is the odd one)
 *     X=Total VAT NTP = J-U
 *
 *   ONBUY SALES (18 cols, no Quantity column):
 *     H=SP-BP = G-F
 *     I=Marginal Tax = H*16.67%
 *     J=Commission = G*7%
 *     K=VAT 20% = J*20%             ← on Commission, NOT on MarTax
 *     L=Postage (literal, default 6.30)
 *     M=P. VAT = L*20%
 *     N=Acc (literal, default 1)
 *     O=Total VAT = K+M
 *     P=GP = H-I-J-K-L-M-N
 *     Q=GP% = P/F*100               ← divide by BP
 *     R=Total VAT NTP = I-O
 */
export function calcSaleFinancials(input: CalcSaleFinancialsInput): SaleFinancials {
  const { marketplace, buyPrice: bp, salePrice: sp } = input;
  const postage = input.postage ?? DEFAULT_POSTAGE;
  const accountingFee = input.accountingFee ?? DEFAULT_ACC;
  const fee = getMarketplaceFee(marketplace);

  const spMinusBp = sp - bp;
  const marginalTax = spMinusBp * MARGIN_TAX_RATE;
  const pVat = postage * POSTAGE_VAT_RATE;

  switch (marketplace) {
    case 'AMAZON': {
      const commission = sp / 100 * fee.commissionPct;          // H/100*7
      const cVat = commission * AMZ_C_VAT_RATE;
      const dsf = commission * AMZ_DSF_RATE;
      const dsfVat = dsf * AMZ_DSF_VAT_RATE;
      const totalVat = cVat + dsfVat + pVat;
      const grossProfit =
        spMinusBp - marginalTax - commission - cVat - dsf - dsfVat - postage - pVat - accountingFee;
      const gpPercent = bp > 0 ? grossProfit / bp * 100 : 0;
      const totalVatNtp = marginalTax - totalVat;
      return {
        spMinusBp, marginalTax, commission,
        cVat, dsf, dsfVat,
        postage, pVat, accountingFee, totalVat,
        grossProfit, gpPercent, totalVatNtp,
      };
    }

    case 'BM': {
      const commission = sp / 100 * fee.commissionPct;          // I/100*11
      const customerCareFees = BM_CUSTOMER_CARE_FEES;
      // BM has no Total VAT column — totalVatNtp uses P.VAT alone.
      const totalVat = pVat;
      const grossProfit =
        spMinusBp - marginalTax - commission - customerCareFees - postage - pVat - accountingFee;
      const gpPercent = bp > 0 ? grossProfit / bp * 100 : 0;
      const totalVatNtp = marginalTax - pVat;
      return {
        spMinusBp, marginalTax, commission, customerCareFees,
        postage, pVat, accountingFee, totalVat,
        grossProfit, gpPercent, totalVatNtp,
      };
    }

    case 'EBAY': {
      const comGross = sp * (fee.commissionPct / 100);                  // SP*6.9%
      const reduction = comGross * ((fee.commissionReductionPct ?? 0) / 100);
      const commission = comGross - reduction;                           // (SP*6.9%) - (SP*6.9%)*10%
      const rof = sp * ((fee.rofPct ?? 0) / 100);                        // SP*0.35%
      const fvf = fee.fixedFee ?? 0;                                     // 0.40
      const vat = (commission + rof + fvf) * ((fee.vatPct ?? 20) / 100); // 20% on bundle
      const totalCom = commission + rof + fvf + vat;
      const marketing = sp * ((fee.promoPct ?? 0) / 100);                // SP*5%
      const mVat = marketing * 0.20;
      const totalVat = vat + pVat + mVat;
      const grossProfit =
        spMinusBp - marginalTax - totalCom - postage - pVat - marketing - mVat - accountingFee;
      const gpPercent = sp > 0 ? grossProfit / sp * 100 : 0;             // EBAY uses SP not BP
      const totalVatNtp = marginalTax - totalVat;
      return {
        spMinusBp, marginalTax, commission,
        rof, fvf, vat, totalCom,
        marketing, mVat,
        postage, pVat, accountingFee, totalVat,
        grossProfit, gpPercent, totalVatNtp,
      };
    }

    case 'ONBUY': {
      const commission = sp * (fee.commissionPct / 100);                 // G*7%
      const vat20 = commission * ((fee.vatPct ?? 20) / 100);             // Commission * 20%
      const totalVat = vat20 + pVat;
      const grossProfit =
        spMinusBp - marginalTax - commission - vat20 - postage - pVat - accountingFee;
      const gpPercent = bp > 0 ? grossProfit / bp * 100 : 0;
      const totalVatNtp = marginalTax - totalVat;
      return {
        spMinusBp, marginalTax, commission, vat20,
        postage, pVat, accountingFee, totalVat,
        grossProfit, gpPercent, totalVatNtp,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Excel formula emitter — used by the SALES_REPORT writer
// ---------------------------------------------------------------------------

/**
 * Per-marketplace Excel formula generator. `row` is the 1-based spreadsheet
 * row number (typically `index + 2` to skip the header). Returned strings are
 * bare formulas — the caller wraps them as
 * `cell.value = { formula: excelFormulaFor(...).<field> }`.
 *
 * Formulas are verbatim from the client SALES_REPORT_2026_1.xlsx workbook;
 * column letters are listed in the header comment for `calcSaleFinancials`.
 */
export function excelFormulaFor(marketplace: Marketplace, row: number): Record<string, string> {
  const r = row;
  switch (marketplace) {
    case 'AMAZON': {
      // G=BP, H=SP, I=SP-BP, J=MarTax, K=Comm, L=C.VAT, M=DSF, N=DSF.VAT,
      // O=Postage, P=P.VAT, Q=Acc, R=Total VAT, S=GP, T=GP%, U=Total VAT NTP
      return {
        spMinusBp:   `H${r}-G${r}`,
        marginalTax: `I${r}*16.67%`,
        commission:  `H${r}/100*7`,
        cVat:        `K${r}*20%`,
        dsf:         `K${r}*2%`,
        dsfVat:      `M${r}*20%`,
        pVat:        `O${r}*20%`,
        totalVat:    `L${r}+N${r}+P${r}`,
        grossProfit: `I${r}-J${r}-K${r}-L${r}-M${r}-N${r}-O${r}-P${r}-Q${r}`,
        gpPercent:   `S${r}/G${r}*100`,
        totalVatNtp: `J${r}-R${r}`,
      };
    }
    case 'BM': {
      // G=Payment Mode, H=BP, I=SP, J=SP-BP, K=MarTax, L=Comm,
      // M=Customer Care Fees, N=Postage, O=P.VAT, P=Acc, Q=GP, R=GP%,
      // S=Total VAT NTP, T=Comments
      return {
        spMinusBp:   `I${r}-H${r}`,
        marginalTax: `J${r}*16.67%`,
        commission:  `I${r}/100*11`,
        pVat:        `N${r}*20%`,
        grossProfit: `J${r}-K${r}-L${r}-M${r}-N${r}-O${r}-P${r}`,
        gpPercent:   `Q${r}/H${r}*100`,
        totalVatNtp: `K${r}-O${r}`,
      };
    }
    case 'EBAY': {
      // G=BP, H=SP, I=SP-BP, J=MarTax, K=Comm, L=ROF, M=FVF, N=VAT, O=T.COM,
      // P=Postage, Q=P.VAT, R=Marketing, S=M.VAT, T=Acc, U=Total VAT, V=GP,
      // W=GP%, X=Total VAT NTP
      return {
        spMinusBp:   `H${r}-G${r}`,
        marginalTax: `I${r}*16.67%`,
        commission:  `(H${r}*6.9%)-(H${r}*6.9%)*10%`,
        rof:         `H${r}*0.35%`,
        vat:         `(K${r}+L${r}+M${r})*20%`,
        totalCom:    `K${r}+L${r}+M${r}+N${r}`,
        pVat:        `P${r}*20%`,
        marketing:   `(H${r}*5%)`,
        mVat:        `(H${r}*5%)*20%`,
        totalVat:    `N${r}+Q${r}+S${r}`,
        grossProfit: `I${r}-J${r}-O${r}-P${r}-Q${r}-R${r}-S${r}-T${r}`,
        gpPercent:   `V${r}/H${r}*100`,
        totalVatNtp: `J${r}-U${r}`,
      };
    }
    case 'ONBUY': {
      // F=BP, G=SP, H=SP-BP, I=MarTax, J=Comm, K=VAT 20%, L=Postage, M=P.VAT,
      // N=Acc, O=Total VAT, P=GP, Q=GP%, R=Total VAT NTP
      return {
        spMinusBp:   `G${r}-F${r}`,
        marginalTax: `H${r}*16.67%`,
        commission:  `G${r}*7%`,
        vat20:       `J${r}*20%`,
        pVat:        `L${r}*20%`,
        totalVat:    `K${r}+M${r}`,
        grossProfit: `H${r}-I${r}-J${r}-K${r}-L${r}-M${r}-N${r}`,
        gpPercent:   `P${r}/F${r}*100`,
        totalVatNtp: `I${r}-O${r}`,
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
  'Project',
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
// Existing callers (SellPage, ReportingPage, Sales, pdfReport, TodaySalesModal,
// and the platforms.test.ts unit tests) still import the legacy `PLATFORMS`
// table and `platform*` helpers. Until those call sites are migrated to the
// marketplace-aware API, derive thin shims so they keep compiling. The values
// reflect the OLD (pre-B5) constants used by the legacy UI — DO NOT change
// them here; instead migrate the call sites to `calcSaleFinancials`.

export const PLATFORM_LIST = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'] as const;
export type Platform = typeof PLATFORM_LIST[number];

export interface PlatformConfig {
  name: Platform;
  /** Percentage commission on sale price (legacy — superseded by MARKETPLACE_FEES). */
  commission: number;
  /** Fixed per-order fee in £ (legacy). */
  fixedFee: number;
  badge: string;
  accent: string;
  hex: string;
}

/** Legacy default postage — kept at £8 to avoid breaking existing UI flows. */
export const DEFAULT_POSTAGE_COST = 8;

/**
 * @deprecated Use `MARKETPLACE_FEES` / `calcSaleFinancials` instead. Retained
 * solely as a back-compat shim — values match the pre-B5 constants so the
 * legacy SellPage / ReportingPage / Sales UI keeps rendering. The
 * authoritative fee schedule lives in `DEFAULT_MARKETPLACE_FEES`.
 */
export const PLATFORMS: Record<Platform, PlatformConfig> = {
  eBay: {
    name: 'eBay',
    commission: 12.8,
    fixedFee: 0.30,
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    accent: 'border-yellow-400',
    hex: '#f59e0b',
  },
  Amazon: {
    name: 'Amazon',
    commission: 8.0,
    fixedFee: 0,
    badge: 'bg-orange-100 text-orange-800 border-orange-200',
    accent: 'border-orange-400',
    hex: '#f97316',
  },
  OnBuy: {
    name: 'OnBuy',
    commission: 9.0,
    fixedFee: 0,
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    accent: 'border-blue-400',
    hex: '#3b82f6',
  },
  Backmarket: {
    name: 'Backmarket',
    commission: 10.0,
    fixedFee: 0,
    badge: 'bg-green-100 text-green-800 border-green-200',
    accent: 'border-green-400',
    hex: '#10b981',
  },
};

export function platformBadge(name: string): string {
  return PLATFORMS[name as Platform]?.badge ?? 'bg-gray-100 text-gray-600 border-gray-200';
}

export function platformCommission(name: string): number {
  return PLATFORMS[name as Platform]?.commission ?? 0;
}

export function platformFixedFee(name: string): number {
  return PLATFORMS[name as Platform]?.fixedFee ?? 0;
}

export function platformTotalFee(name: string, salePrice: number): number {
  const pct = PLATFORMS[name as Platform]?.commission ?? 0;
  const fixed = PLATFORMS[name as Platform]?.fixedFee ?? 0;
  return +(salePrice * pct / 100 + fixed).toFixed(2);
}

export function platformCommissionAmt(name: string, salePrice: number): number {
  return +(salePrice * platformCommission(name) / 100).toFixed(2);
}

/**
 * @deprecated Use `calcSaleFinancials({ marketplace, buyPrice, salePrice }).grossProfit`.
 * Legacy net profit: net = SP - BP - platform_fee(%) - fixed_fee - postage.
 */
export function calcNetProfit(
  salePrice: number,
  buyPrice: number,
  platform: string,
  postageCost: number = DEFAULT_POSTAGE_COST,
): number {
  const fee = platformTotalFee(platform, salePrice);
  return +(salePrice - buyPrice - fee - postageCost).toFixed(2);
}
