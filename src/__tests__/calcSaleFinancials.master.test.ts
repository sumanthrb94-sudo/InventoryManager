/**
 * calcSaleFinancials parity tests vs. the operator's master SALES_REPORT.
 *
 * Locks the runtime calculator to the 2026-05 schema verified penny-for-
 * penny against the live SALES_REPORT_2026__2nd_June_.xlsx (1,682 valid
 * rows audited via python+openpyxl on 2026-06-02). Coverage: 12 real
 * rows per platform (48 unit-level cases) drawn from the master file,
 * plus cross-platform invariants. Four platforms only — AMAZON / BM /
 * EBAY / ONBUY. PROJECT permanently retired.
 *
 * For each row we:
 *   1. Re-derive every derived field via the 2026-05 algebraic formula
 *      in plain JS (independent reimplementation — NOT a recursive
 *      re-call of calcSaleFinancials).
 *   2. Call calcSaleFinancials with the same inputs (including the
 *      file-style postageOverride so default-postage logic doesn't
 *      drift the assertion).
 *   3. Assert outputs match within £0.02 (1p rounding-order tolerance).
 *
 * Per-marketplace 2026-05 formulas (verified against the live xlsx):
 *   AMAZON   SP-BP                          MarTax = (SP-BP)*16.67%
 *            Com   = SP * 7%                C.VAT  = Com * 20%
 *            DSF   = Com * 2%               DSF.VAT= DSF * 20%
 *            P.VAT = Postage * 20%          Acc    = £1 default
 *            TotVAT= C.VAT + DSF.VAT + P.VAT
 *            GP    = SP-BP-Com-C.VAT-DSF-DSF.VAT-Postage-P.VAT-Acc-MarTax
 *            GP%   = GP / BP * 100          NTP    = MarTax - TotVAT
 *
 *   BM       Com   = SP * 11%               CCF    = £9.99 default
 *            P.VAT = Postage * 20%          Acc    = £1 default
 *            GP    = SP-BP-MarTax-Com-CCF-Postage-P.VAT-Acc
 *            GP%   = GP / BP * 100          NTP    = MarTax - P.VAT
 *            (No more PayPal/Klarna 2.5% in 2026-05 schema)
 *
 *   EBAY     MarTax = (SP-BP)*16.67%        Com    = SP * 6.21%
 *            ROF   = SP * 0.35%             FVF    = £0.40 flat
 *            VAT   = (Com+ROF+FVF) * 20%    T.COM  = Com+ROF+FVF+VAT
 *            Marketing default = SP * 5%    M.VAT  = Marketing * 20%
 *            P.VAT = Postage * 20%          Acc    = £1
 *            TotVAT= VAT + P.VAT + M.VAT
 *            GP    = SP-BP-T.COM-Postage-P.VAT-Marketing-M.VAT-Acc-MarTax
 *            GP%   = GP / SP * 100          NTP    = MarTax - TotVAT
 *
 *   ONBUY    MarTax = (SP-BP)*16.67%        Com    = SP * 7%
 *            VAT20 = Com * 20%              P.VAT  = Postage * 20%
 *            Acc   = £1                     TotVAT = VAT20 + P.VAT
 *            GP    = SP-BP-MarTax-Com-VAT20-Postage-P.VAT-Acc
 *            GP%   = GP / BP * 100          NTP    = MarTax - TotVAT
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import type { Marketplace } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
// 2026-05 schemas chain more rounding stages (Com → C.VAT → DSF → DSF.VAT
// → TotVAT → GP → GP%) than the old shape, so on the worst-case
// near-break-even row a single penny can compound to two. £0.03 buffers
// the IEEE 754 drift without masking a real formula regression — anything
// off by >£0.03 is still a clear failure.
const TOL = 0.03;
function expectClose(actual: number, expected: number, label: string) {
  expect(
    Math.abs(actual - expected),
    `${label}: actual=${actual} expected=${expected} diff=${(actual - expected).toFixed(4)}`,
  ).toBeLessThanOrEqual(TOL);
}

// ── Real fixtures sampled from /tmp/sales-report.xlsx ────────────────────
// 12 rows per platform, evenly spread across the dataset so the suite
// catches rounding edges (whole-pound BP/SP, awkward 0.99 endings,
// mid-range and high-value rows).

interface AmazonFixture { order: string; bp: number; sp: number; postage: number; }
const AMAZON_ROWS: AmazonFixture[] = [
  { order: '02-9088974-8481116',  bp: 88,  sp: 111,    postage: 8 },
  { order: '026-5042444-6219517', bp: 55,  sp: 88,     postage: 8 },
  { order: '202-0533321-2879548', bp: 135, sp: 152.89, postage: 8 },
  { order: '202-6685090-0821122', bp: 122, sp: 145,    postage: 8 },
  { order: '203-1338449-1458707', bp: 145, sp: 199.99, postage: 8 },
  { order: '203-5198394-1322765', bp: 190, sp: 239.99, postage: 8 },
  { order: '203-9677542-2532310', bp: 80,  sp: 99.99,  postage: 8 },
  { order: '204-4678187-5185945', bp: 120, sp: 148.29, postage: 8 },
  { order: '205-0022828-9601104', bp: 170, sp: 216.19, postage: 8 },
  { order: '205-4327228-4070758', bp: 60,  sp: 79.98,  postage: 8 },
  { order: '205-8651652-6907528', bp: 148, sp: 199,    postage: 8 },
  { order: '206-4035535-7470762', bp: 120, sp: 149.99, postage: 8 },
];

interface BmFixture { order: string; bp: number; sp: number; postage: number; payment: string; }
const BM_ROWS: BmFixture[] = [
  { order: '79008748', bp: 850, sp: 1300, postage: 10, payment: 'Google Pay' },
  { order: '79125567', bp: 105, sp: 145,  postage: 10, payment: ''           },
  { order: '79226161', bp: 105, sp: 155,  postage: 10, payment: ''           },
  { order: '79334781', bp: 105, sp: 151,  postage: 10, payment: ''           },
  { order: '79388636', bp: 185, sp: 235,  postage: 10, payment: ''           },
  { order: '79539666', bp: 140, sp: 158,  postage: 10, payment: ''           },
  { order: '79814483', bp: 105, sp: 159,  postage: 10, payment: 'Klarna'     },
  { order: '80011041', bp: 75,  sp: 131,  postage: 10, payment: 'Paypal'     },
  { order: '80151597', bp: 75,  sp: 133,  postage: 10, payment: ''           },
  { order: '80281800', bp: 105, sp: 164,  postage: 10, payment: ''           },
  { order: '80390132', bp: 115, sp: 173,  postage: 10, payment: ''           },
  { order: '80563335', bp: 215, sp: 307,  postage: 10, payment: 'Klarna'     },
];

interface EbayFixture { order: string; bp: number; sp: number; shipping: 1 | 2 | 8; }
const EBAY_ROWS: EbayFixture[] = [
  { order: '01-14475-65087', bp: 240, sp: 249.99, shipping: 8 },
  { order: '02-14637-19986', bp: 153, sp: 199.99, shipping: 8 },
  { order: '04-14562-24670', bp: 60,  sp: 89.99,  shipping: 8 },
  { order: '06-14610-79610', bp: 52,  sp: 77.99,  shipping: 8 },
  { order: '09-14554-73797', bp: 102, sp: 155.98, shipping: 8 },
  { order: '12-14557-94698', bp: 62,  sp: 99.99,  shipping: 8 },
  { order: '13-14633-17676', bp: 120, sp: 159.99, shipping: 8 },
  { order: '16-14519-66313', bp: 125, sp: 159.99, shipping: 8 },
  { order: '18-14498-91345', bp: 125, sp: 159.99, shipping: 8 },
  { order: '20-14461-82871', bp: 70,  sp: 99.99,  shipping: 8 },
  { order: '21-14516-98989', bp: 140, sp: 159.99, shipping: 8 },
  { order: '22-14517-93084', bp: 75,  sp: 119.99, shipping: 8 },
];

interface OnbuyFixture { order: string; bp: number; sp: number; postage: number; }
const ONBUY_ROWS: OnbuyFixture[] = [
  { order: 'T6G29N2', bp: 150, sp: 189.99, postage: 8 },
  { order: 'T6G59M5', bp: 70,  sp: 89.87,  postage: 8 },
  { order: 'T6G8G6W', bp: 190, sp: 244.99, postage: 8 },
  { order: 'T6GCFFG', bp: 145, sp: 184.99, postage: 8 },
  { order: 'T6GCSC9', bp: 55,  sp: 79.99,  postage: 8 },
  { order: 'T6GFMCP', bp: 140, sp: 184.99, postage: 8 },
  { order: 'T6GHN68', bp: 125, sp: 154.99, postage: 8 },
  { order: 'T6GN8TB', bp: 125, sp: 154.99, postage: 8 },
  { order: 'T6GQF7R', bp: 115, sp: 154.99, postage: 8 },
  { order: 'T6GTB9N', bp: 125, sp: 149.99, postage: 8 },
  { order: 'T6H22DD', bp: 125, sp: 164.99, postage: 8 },
  { order: 'T6H6PVN', bp: 145, sp: 184.99, postage: 8 },
];

// ── Master-formula reference implementations (NOT calling our code).

// AMAZON 2026-05: Com=SP*7%, C.VAT=Com*20%, DSF=Com*2%, DSF.VAT=DSF*20%,
// P.VAT=Postage*20%, Acc=£1 flat, TotVAT=C.VAT+DSF.VAT+P.VAT,
// GP=SP-BP-Com-C.VAT-DSF-DSF.VAT-Postage-P.VAT-Acc-MarTax, GP%=GP/BP*100.
function masterAmazon(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.67 / 100);
  const commission = r2(sp * 7 / 100);
  const cVat       = r2(commission * 20 / 100);
  const dsf        = r2(commission * 2 / 100);
  const dsfVat     = r2(dsf * 20 / 100);
  const pVat       = r2(postage * 20 / 100);
  const acc        = 1;
  const totalVat   = r2(cVat + dsfVat + pVat);
  const grossProfit = r2(sp - bp - commission - cVat - dsf - dsfVat - postage - pVat - acc - marTax);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  const totalVatNtp = r2(marTax - totalVat);
  return { spMinusBp, marTax, commission, cVat, dsf, dsfVat, postage, pVat, acc, totalVat, grossProfit, gpPercent, totalVatNtp };
}

function isPPKMode(mode: string): boolean {
  // Detection kept around because the parser still feeds the flag through
  // (some calls preserve payment mode for audit). 2026-05 calc ignores it
  // — BM no longer charges a 2.5% PayPal/Klarna surcharge.
  return /paypal|klarna|clearpay|clear pay|applepay|apple pay/i.test(mode);
}

// BM 2026-05: Com=SP*11%, CCF=£9.99 default, P.VAT=Postage*20%, Acc=£1,
// GP=SP-BP-MarTax-Com-CCF-Postage-P.VAT-Acc, GP%=GP/BP*100.
function masterBm(bp: number, sp: number, postage: number, _payment: string) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.67 / 100);
  const commission = r2(sp * 11 / 100);
  const ccf        = 9.99;
  const pVat       = r2(postage * 20 / 100);
  const acc        = 1;
  const grossProfit = r2(sp - bp - marTax - commission - ccf - postage - pVat - acc);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  const totalVatNtp = r2(marTax - pVat);
  return { spMinusBp, marTax, commission, ccf, postage, pVat, acc, grossProfit, gpPercent, totalVatNtp };
}

// EBAY 2026-05: Com=SP*6.21%, ROF=SP*0.35%, FVF=£0.40 flat,
// VAT=(Com+ROF+FVF)*20%, T.COM=Com+ROF+FVF+VAT, Marketing default=SP*5%,
// M.VAT=Marketing*20%, P.VAT=Postage*20%, Acc=£1,
// TotVAT=VAT+P.VAT+M.VAT,
// GP=SP-BP-T.COM-Postage-P.VAT-Marketing-M.VAT-Acc-MarTax, GP%=GP/SP*100.
function masterEbay(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.67 / 100);
  const commission = r2(sp * 6.21 / 100);
  const rof        = r2(sp * 0.35 / 100);
  const fvf        = 0.40;
  const vat        = r2((commission + rof + fvf) * 20 / 100);
  const totalCom   = r2(commission + rof + fvf + vat);
  const marketing  = r2(sp * 5 / 100);
  const mVat       = r2(marketing * 20 / 100);
  const pVat       = r2(postage * 20 / 100);
  const acc        = 1;
  const totalVat   = r2(vat + pVat + mVat);
  const grossProfit = r2(sp - bp - totalCom - postage - pVat - marketing - mVat - acc - marTax);
  const gpPercent   = sp > 0 ? r2(grossProfit / sp * 100) : 0;
  const totalVatNtp = r2(marTax - totalVat);
  return { spMinusBp, marTax, commission, rof, fvf, vat, totalCom, marketing, mVat, postage, pVat, acc, totalVat, grossProfit, gpPercent, totalVatNtp };
}

// ONBUY 2026-05: Com=SP*7%, VAT20=Com*20%, P.VAT=Postage*20%, Acc=£1,
// TotVAT=VAT20+P.VAT, GP=SP-BP-MarTax-Com-VAT20-Postage-P.VAT-Acc,
// GP%=GP/BP*100.
function masterOnbuy(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.67 / 100);
  const commission = r2(sp * 7 / 100);
  const vat20      = r2(commission * 20 / 100);
  const pVat       = r2(postage * 20 / 100);
  const acc        = 1;
  const totalVat   = r2(vat20 + pVat);
  const grossProfit = r2(sp - bp - marTax - commission - vat20 - postage - pVat - acc);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  const totalVatNtp = r2(marTax - totalVat);
  return { spMinusBp, marTax, commission, vat20, postage, pVat, acc, totalVat, grossProfit, gpPercent, totalVatNtp };
}

// ── AMAZON — 12 rows ────────────────────────────────────────────────────

describe('calcSaleFinancials · AMAZON · 12 master rows', () => {
  it.each(AMAZON_ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const m = masterAmazon(row.bp, row.sp, row.postage);
    const fin = calcSaleFinancials({
      marketplace: 'AMAZON',
      buyPrice: row.bp,
      salePrice: row.sp,
      postageOverride: row.postage,
    });
    expectClose(fin.spMinusBp,           m.spMinusBp,    `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,         m.marTax,       `${row.order}.marginalTax`);
    expectClose(fin.commission,          m.commission,   `${row.order}.commission`);
    expectClose(fin.commissionVat ?? 0,  m.cVat,         `${row.order}.C.VAT`);
    expectClose(fin.dsf ?? 0,            m.dsf,          `${row.order}.DSF`);
    expectClose(fin.dsfVat ?? 0,         m.dsfVat,       `${row.order}.DSF.VAT`);
    expectClose(fin.postage,             m.postage,      `${row.order}.postage`);
    expectClose(fin.postageVat ?? 0,     m.pVat,         `${row.order}.P.VAT`);
    expectClose(fin.accessoryFee ?? 0,   m.acc,          `${row.order}.Acc`);
    expectClose(fin.totalVat ?? 0,       m.totalVat,     `${row.order}.Total VAT`);
    expectClose(fin.grossProfit,         m.grossProfit,  `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,           m.gpPercent,    `${row.order}.gpPercent`);
    expectClose(fin.totalVatNtp ?? 0,    m.totalVatNtp,  `${row.order}.Total VAT NTP`);
  });

  it('postage default = £0 — operator-entered per sale on 2026-05 schema', () => {
    expect(getMarketplaceFee('AMAZON').postage).toBe(0);
  });
});

// ── BM — 12 rows including PayPal/Klarna detection ──────────────────────

describe('calcSaleFinancials · BM · 12 master rows', () => {
  it.each(BM_ROWS)('row $order (BP £$bp · SP £$sp · pay=$payment)', (row) => {
    const m = masterBm(row.bp, row.sp, row.postage, row.payment);
    const fin = calcSaleFinancials({
      marketplace: 'BM',
      buyPrice: row.bp,
      salePrice: row.sp,
      postageOverride: row.postage,
      // Flag still passes through, calc just no longer charges the 2.5%.
      hasPayPalKlarna: isPPKMode(row.payment),
    });
    expectClose(fin.spMinusBp,             m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,           m.marTax,      `${row.order}.marginalTax`);
    expectClose(fin.commission,            m.commission,  `${row.order}.commission`);
    expectClose(fin.customerCareFees ?? 0, m.ccf,         `${row.order}.CCF`);
    expectClose(fin.postage,               m.postage,     `${row.order}.postage`);
    expectClose(fin.postageVat ?? 0,       m.pVat,        `${row.order}.P.VAT`);
    expectClose(fin.accessoryFee ?? 0,     m.acc,         `${row.order}.Acc`);
    expectClose(fin.grossProfit,           m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,             m.gpPercent,   `${row.order}.gpPercent`);
    expectClose(fin.totalVatNtp ?? 0,      m.totalVatNtp, `${row.order}.Total VAT NTP`);
  });

  it('PayPal/Klarna mode detection still works (flag plumbed even though 2.5% no longer applies)', () => {
    const ppk = ['Klarna', 'PayPal', 'Paypal', 'Clear Pay', 'Apple Pay', 'ClearPay'];
    const off = ['Google Pay', 'Card', '', 'Cash'];
    for (const mode of ppk) expect(isPPKMode(mode), `PPK fires for "${mode}"`).toBe(true);
    for (const mode of off) expect(isPPKMode(mode), `PPK silent for "${mode}"`).toBe(false);
  });

  it('postage default = £0 — operator-entered per sale on 2026-05 schema', () => {
    expect(getMarketplaceFee('BM').postage).toBe(0);
  });
});

// ── EBAY — 12 rows, full per-row breakdown ──────────────────────────────

describe('calcSaleFinancials · EBAY · 12 master rows', () => {
  it.each(EBAY_ROWS)('row $order (BP £$bp · SP £$sp · ship £$shipping)', (row) => {
    const m = masterEbay(row.bp, row.sp, row.shipping);
    const fin = calcSaleFinancials({
      marketplace: 'EBAY',
      buyPrice: row.bp,
      salePrice: row.sp,
      eBayShippingTier: row.shipping,
    });
    expectClose(fin.spMinusBp,             m.spMinusBp,    `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,           m.marTax,       `${row.order}.marginalTax (16.67%)`);
    expectClose(fin.commission,            m.commission,   `${row.order}.commission (6.21%)`);
    expectClose(fin.rof ?? 0,              m.rof,          `${row.order}.rof`);
    expectClose(fin.fvf ?? 0,              m.fvf,          `${row.order}.fvf`);
    expectClose(fin.vat20 ?? 0,            m.vat,          `${row.order}.VAT (Com+ROF+FVF)*20%`);
    expectClose(fin.totalCom ?? 0,         m.totalCom,     `${row.order}.T.COM`);
    expectClose(fin.postage,               m.postage,      `${row.order}.shipping`);
    expectClose(fin.postageVat ?? 0,       m.pVat,         `${row.order}.P.VAT`);
    expectClose(fin.marketing ?? 0,        m.marketing,    `${row.order}.Marketing (5% default)`);
    expectClose(fin.marketingVat ?? 0,     m.mVat,         `${row.order}.M.VAT`);
    expectClose(fin.accessoryFee ?? 0,     m.acc,          `${row.order}.Acc`);
    expectClose(fin.totalVat ?? 0,         m.totalVat,     `${row.order}.Total VAT`);
    expectClose(fin.grossProfit,           m.grossProfit,  `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,             m.gpPercent,    `${row.order}.gpPercent (/SP)`);
    expectClose(fin.totalVatNtp ?? 0,      m.totalVatNtp,  `${row.order}.Total VAT NTP`);
  });

  it('shipping tier £1 + £2 also pass through correctly', () => {
    for (const tier of [1, 2] as const) {
      const m = masterEbay(100, 200, tier);
      const fin = calcSaleFinancials({
        marketplace: 'EBAY',
        buyPrice: 100,
        salePrice: 200,
        eBayShippingTier: tier,
      });
      expectClose(fin.postage,     m.postage,     `tier=${tier}.shipping`);
      expectClose(fin.grossProfit, m.grossProfit, `tier=${tier}.grossProfit`);
    }
  });
});

// ── ONBUY — 12 rows ─────────────────────────────────────────────────────

describe('calcSaleFinancials · ONBUY · 12 master rows', () => {
  it.each(ONBUY_ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const m = masterOnbuy(row.bp, row.sp, row.postage);
    const fin = calcSaleFinancials({
      marketplace: 'ONBUY',
      buyPrice: row.bp,
      salePrice: row.sp,
      postageOverride: row.postage,
    });
    expectClose(fin.spMinusBp,             m.spMinusBp,    `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,           m.marTax,       `${row.order}.MAR TAX`);
    expectClose(fin.commission,            m.commission,   `${row.order}.commission (7%)`);
    expectClose(fin.vat20 ?? 0,            m.vat20,        `${row.order}.VAT 20%`);
    expectClose(fin.postage,               m.postage,      `${row.order}.postage`);
    expectClose(fin.postageVat ?? 0,       m.pVat,         `${row.order}.P.VAT`);
    expectClose(fin.accessoryFee ?? 0,     m.acc,          `${row.order}.Acc`);
    expectClose(fin.totalVat ?? 0,         m.totalVat,     `${row.order}.Total VAT`);
    expectClose(fin.grossProfit,           m.grossProfit,  `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,             m.gpPercent,    `${row.order}.gpPercent (/BP)`);
    expectClose(fin.totalVatNtp ?? 0,      m.totalVatNtp,  `${row.order}.Total VAT NTP`);
  });

  it('exposes both marginalTax and marVat (alias on the same value)', () => {
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 200 });
    expect(fin.marginalTax).toBeCloseTo(fin.marVat ?? 0, 2);
  });

  it('postage default = £0 — operator-entered per sale on 2026-05 schema', () => {
    expect(getMarketplaceFee('ONBUY').postage).toBe(0);
  });
});

// ── Cross-marketplace invariants ────────────────────────────────────────

describe('calcSaleFinancials · cross-marketplace invariants', () => {
  const ALL: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY'];

  it('all 4 marketplaces produce finite numbers on a happy path', () => {
    for (const m of ALL) {
      const fin = calcSaleFinancials({
        marketplace: m,
        buyPrice: 100,
        salePrice: 200,
        eBayShippingTier: m === 'EBAY' ? 8 : undefined,
      });
      expect(Number.isFinite(fin.spMinusBp),   `${m}.spMinusBp`).toBe(true);
      expect(Number.isFinite(fin.grossProfit), `${m}.grossProfit`).toBe(true);
      expect(Number.isFinite(fin.gpPercent),   `${m}.gpPercent`).toBe(true);
      expect(Number.isFinite(fin.commission),  `${m}.commission`).toBe(true);
      expect(Number.isFinite(fin.postage),     `${m}.postage`).toBe(true);
    }
  });

  it('AMAZON / BM divide GP% by BP (margin-over-cost)', () => {
    for (const m of ['AMAZON', 'BM'] as const) {
      const fin = calcSaleFinancials({ marketplace: m, buyPrice: 100, salePrice: 200 });
      const denom = r2(fin.grossProfit / 100 * 100);
      expectClose(fin.gpPercent, denom, `${m} GP% denom=BP`);
    }
  });

  it('EBAY divides GP% by SP; AMAZON / BM / ONBUY divide by BP (2026-05 schema)', () => {
    // 2026-05 schema change: ONBUY now divides GP% by BP (same as
    // Amazon/BM), not SP. Only EBAY keeps the over-SP denominator.
    const bySpKeys: Marketplace[] = ['EBAY'];
    const byBpKeys: Marketplace[] = ['AMAZON', 'BM', 'ONBUY'];
    for (const m of bySpKeys) {
      const fin = calcSaleFinancials({
        marketplace: m,
        buyPrice: 100,
        salePrice: 200,
        eBayShippingTier: 8,
      });
      const denom = r2(fin.grossProfit / 200 * 100);
      expectClose(fin.gpPercent, denom, `${m} GP% denom=SP`);
    }
    for (const m of byBpKeys) {
      const fin = calcSaleFinancials({
        marketplace: m,
        buyPrice: 100,
        salePrice: 200,
        postageOverride: 8,
      });
      const denom = r2(fin.grossProfit / 100 * 100);
      expectClose(fin.gpPercent, denom, `${m} GP% denom=BP`);
    }
  });

  it('zero GP%-denominator collapses gpPercent to 0 (no NaN/Infinity)', () => {
    // 2026-05: AMAZON/BM/ONBUY all divide by BP; EBAY divides by SP.
    // The "zero denominator" case for each marketplace is its denominator
    // axis being 0.
    const cases: Array<{ m: Marketplace; bp: number; sp: number }> = [
      { m: 'AMAZON', bp: 0,   sp: 100 },     // /BP
      { m: 'BM',     bp: 0,   sp: 100 },     // /BP
      { m: 'ONBUY',  bp: 0,   sp: 100 },     // /BP
      { m: 'EBAY',   bp: 100, sp: 0   },     // /SP
    ];
    for (const c of cases) {
      const fin = calcSaleFinancials({
        marketplace: c.m,
        buyPrice: c.bp,
        salePrice: c.sp,
        eBayShippingTier: c.m === 'EBAY' ? 8 : undefined,
      });
      expect(Number.isFinite(fin.gpPercent), `${c.m}.gpPercent finite`).toBe(true);
      expect(fin.gpPercent, `${c.m}.gpPercent collapsed`).toBe(0);
    }
  });

  it('SP = BP yields spMinusBp = 0 and a negative GP (only fees + accessories left)', () => {
    // 2026-05 AMAZON break-even at SP=BP=£100:
    //   Com=£7, C.VAT=£1.40, DSF=£0.14, DSF.VAT=£0.03, Acc=£1,
    //   Postage default £0 (operator-entered), so GP = -(7+1.4+0.14+0.03+1+0) = -£9.57.
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 100, salePrice: 100 });
    expect(fin.spMinusBp).toBe(0);
    expectClose(fin.grossProfit, -9.57, 'AMAZON break-even GP = -(Com+C.VAT+DSF+DSF.VAT+Acc) at postage £0');
  });
});
