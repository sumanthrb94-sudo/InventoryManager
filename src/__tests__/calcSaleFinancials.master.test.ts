/**
 * calcSaleFinancials parity tests vs. the operator's master SALES_REPORT.
 *
 * These tests lock the runtime calculator (calcSaleFinancials) to the
 * EXACT per-cell formulas living in the live SALES_REPORT_2026.xlsx
 * (extracted from xl/worksheets/sheet{1..5}.xml). Each test case computes
 * the master formula in plain algebra here, then asserts our code produces
 * the same outputs within £0.02 (1p rounding-order drift max — Excel's
 * cell formulas use full-precision intermediates while r2() inside our
 * calculator uses rounded ones; the gap is bounded to 1p per derived
 * field on the operations the master sheet performs).
 *
 * Inputs are drawn from real rows of the operator's uploaded master file:
 *   AMAZON row 2:  BP=88,   SP=111,    Postage=8
 *   BM     row 2:  BP=850,  SP=1300,   Postage=10, Pay='Google Pay' (no PPK)
 *   BM     row 3:  BP=105,  SP=154,    Postage=10, Pay='Klarna'     (PPK fires)
 *   EBAY   row 2:  BP=240,  SP=249.99, Shipping=£8 tier, FVF=£0.40
 *   ONBUY  row 2:  BP=150,  SP=189.99, Ship=8
 *   PROJECT row 2: BP=115,  SP=149.79, Postage=5.9
 *
 * Per-marketplace master formulas (verified against
 * xl/worksheets/sheet{1..5}.xml of SALES_REPORT_2026.xlsx):
 *
 *   AMAZON   SP-BP=H-G   MarTax=I/6           Com=H/100*7.14
 *            GP=H-G-J-K-L                     GP%=M/G*100  (denom=BP)
 *
 *   BM       SP-BP=H-G   MarTax=J/6           PPK=H/100*2.5   Com=H/100*12
 *            GP=H-G-K-M-N-L                   GP%=O/G*100  (denom=BP)
 *
 *   EBAY     SP-BP=H-G   MarTax=I*16.6%
 *            Com=(H*6.9%)-(H*6.9%)*10%        ROF=H*0.35%   FVF=0.4
 *            VAT=(K+L+M)*20%                  TCom=K+L+M+N
 *            GP=I-J-O-P (P=Shipping)          GP%=Q/H*100  (denom=SP)
 *            NP=Q-H*5%
 *
 *   ONBUY    SP-BP=G-F   MarVat=H/6           Com=G*7%      Vat20=I*20%
 *            GP=G-F-J-K-L-I                   GP%=M/G*100  (denom=SP — col G is SP here)
 *
 *   PROJECT  same shape as AMAZON, postage=5.9.
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import type { Marketplace } from '../types';

// ── Helpers — replicate Excel's r2() display rounding so the manual
// "master answer" we assert against matches the convention our code uses.
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tolerance in £ — rounding-order drift between Excel's full-precision
 *  intermediates and our r2()'d ones can land at most 1p per field on
 *  the typical price ranges the master sheet uses. We assert ≤2p so a
 *  drift in one field plus a downstream cumulative drift still passes. */
const TOL = 0.02;

function expectClose(actual: number, expected: number, label: string) {
  expect(
    Math.abs(actual - expected),
    `${label}: actual=${actual} expected=${expected} diff=${(actual - expected).toFixed(4)}`,
  ).toBeLessThanOrEqual(TOL);
}

// ── Master-formula reference implementations.
// These intentionally re-derive each derived field straight from the
// algebraic formula in the master sheet so the test isn't just calling our
// own code twice. If calcSaleFinancials drifts from the master, ONE of
// these assertions will fire.

function masterAmazon(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 7.14 / 100);
  const grossProfit = r2(sp - bp - marTax - commission - postage);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, postage, grossProfit, gpPercent };
}

function masterBm(bp: number, sp: number, postage: number, hasPPK: boolean) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 12 / 100);
  const ppk        = hasPPK ? r2(sp * 2.5 / 100) : 0;
  const grossProfit = r2(sp - bp - marTax - commission - postage - ppk);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, ppk, postage, grossProfit, gpPercent };
}

function masterEbay(bp: number, sp: number, shipping: 1 | 2 | 8) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.6 / 100);
  const comGross   = sp * 6.9 / 100;
  const commission = r2(comGross - comGross * 10 / 100);
  const rof        = r2(sp * 0.35 / 100);
  const fvf        = 0.4;
  // Master sheet's `=(K+L+M)*20%` references the displayed cells, so use
  // the rounded intermediates here too.
  const twenty     = r2((commission + rof + fvf) * 20 / 100);
  const totalCom   = r2(commission + rof + fvf + twenty);
  const grossProfit = r2(spMinusBp - marTax - totalCom - shipping);
  const gpPercent   = sp > 0 ? r2(grossProfit / sp * 100) : 0;
  const netProfit   = r2(grossProfit - sp * 5 / 100);
  return { spMinusBp, marTax, commission, rof, fvf, twenty, totalCom, postage: shipping, grossProfit, gpPercent, netProfit };
}

function masterOnbuy(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marVat     = r2(spMinusBp / 6);
  const commission = r2(sp * 7 / 100);
  const vat20      = r2(marVat * 20 / 100);
  const grossProfit = r2(sp - bp - commission - postage - marVat - vat20);
  // ONBUY's `=M/G*100` divides by col G — which on this sheet is SP
  // (no Quantity column shifts the layout).
  const gpPercent   = sp > 0 ? r2(grossProfit / sp * 100) : 0;
  return { spMinusBp, marVat, commission, vat20, postage, grossProfit, gpPercent };
}

function masterProject(bp: number, sp: number, postage: number) {
  // Same shape as AMAZON; only postage default differs.
  return masterAmazon(bp, sp, postage);
}

// ── Fixtures — real rows from SALES_REPORT_2026.xlsx ─────────────────────

describe('calcSaleFinancials · AMAZON parity with master', () => {
  it('row 2 from master (BP £88 · SP £111)', () => {
    const m = masterAmazon(88, 111, 8);
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 88, salePrice: 111 });
    expectClose(fin.spMinusBp,    m.spMinusBp,   'spMinusBp');
    expectClose(fin.marginalTax,  m.marTax,      'marginalTax');
    expectClose(fin.commission,   m.commission,  'commission');
    expectClose(fin.postage,      m.postage,     'postage');
    expectClose(fin.grossProfit,  m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,    m.gpPercent,   'gpPercent');
  });

  it('row 941 from master (BP £55 · SP £88)', () => {
    const m = masterAmazon(55, 88, 8);
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 55, salePrice: 88 });
    expectClose(fin.grossProfit, m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,   m.gpPercent,   'gpPercent');
  });

  it('returns the master postage default (£8) when no override', () => {
    expect(getMarketplaceFee('AMAZON').postage).toBe(8);
  });
});

describe('calcSaleFinancials · BM parity with master', () => {
  it('row 2 (BP £850 · SP £1300 · Google Pay — NO PayPal/Klarna fee)', () => {
    // Google Pay does NOT match the master's PayPal/Klarna/Clear Pay/Apple
    // Pay set; the 2.5% must be £0.
    const m = masterBm(850, 1300, 10, false);
    const fin = calcSaleFinancials({
      marketplace: 'BM',
      buyPrice: 850,
      salePrice: 1300,
      hasPayPalKlarna: false,
    });
    expectClose(fin.spMinusBp,   m.spMinusBp,   'spMinusBp');
    expectClose(fin.marginalTax, m.marTax,      'marginalTax');
    expectClose(fin.commission,  m.commission,  'commission');
    expect(fin.payPalKlarnaCom ?? 0).toBe(0);
    expectClose(fin.grossProfit, m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,   m.gpPercent,   'gpPercent');
  });

  it('row 3 (BP £105 · SP £154 · Klarna — PayPal/Klarna 2.5% fires)', () => {
    const m = masterBm(105, 154, 10, true);
    const fin = calcSaleFinancials({
      marketplace: 'BM',
      buyPrice: 105,
      salePrice: 154,
      hasPayPalKlarna: true,
    });
    expectClose(fin.payPalKlarnaCom ?? 0, m.ppk,         'payPalKlarnaCom');
    expectClose(fin.grossProfit,          m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,            m.gpPercent,   'gpPercent');
  });

  it('GP% denominator is BP per master `=O/G*100`', () => {
    // BP=100, SP=200, no PPK → grossProfit = 200-100-100/6-200*12%-10 = 49.33
    // master GP% = 49.33/100*100 = 49.33   (NOT 49.33/200*100 = 24.67)
    const fin = calcSaleFinancials({ marketplace: 'BM', buyPrice: 100, salePrice: 200 });
    expectClose(fin.gpPercent, 49.33, 'gpPercent /BP not /SP');
  });
});

describe('calcSaleFinancials · EBAY parity with master', () => {
  it('row 2 (BP £240 · SP £249.99 · shipping £8 tier)', () => {
    const m = masterEbay(240, 249.99, 8);
    const fin = calcSaleFinancials({
      marketplace: 'EBAY',
      buyPrice: 240,
      salePrice: 249.99,
      eBayShippingTier: 8,
    });
    expectClose(fin.spMinusBp,             m.spMinusBp,   'spMinusBp');
    expectClose(fin.marginalTax,           m.marTax,      'marginalTax (16.6%)');
    expectClose(fin.commission,            m.commission,  'commission (6.9% - 10%)');
    expectClose(fin.rof ?? 0,              m.rof,         'rof (0.35%)');
    expectClose(fin.fvf ?? 0,              m.fvf,         'fvf (0.40)');
    expectClose(fin.twentyPercent ?? 0,    m.twenty,      '20% VAT bundle');
    expectClose(fin.totalCom ?? 0,         m.totalCom,    'T.COM');
    expectClose(fin.postage,               m.postage,     'shipping');
    expectClose(fin.grossProfit,           m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,             m.gpPercent,   'gpPercent (/SP)');
    expectClose(fin.netProfit ?? 0,        m.netProfit,   'netProfit (incl. 5% promo)');
  });

  it('GP% denominator is SP per master `=Q/H*100`', () => {
    // BP=100, SP=200, tier=8 → GP ≈ 59.18 → GP% = 59.18/200*100 = 29.59
    const fin = calcSaleFinancials({
      marketplace: 'EBAY',
      buyPrice: 100,
      salePrice: 200,
      eBayShippingTier: 8,
    });
    expectClose(fin.gpPercent, 29.59, 'gpPercent /SP not /BP');
  });

  it('shipping tier £1 routes through correctly', () => {
    const m = masterEbay(100, 200, 1);
    const fin = calcSaleFinancials({
      marketplace: 'EBAY',
      buyPrice: 100,
      salePrice: 200,
      eBayShippingTier: 1,
    });
    expectClose(fin.postage,     m.postage,     'shipping=1');
    expectClose(fin.grossProfit, m.grossProfit, 'grossProfit with £1 shipping');
  });
});

describe('calcSaleFinancials · ONBUY parity with master', () => {
  it('row 2 (BP £150 · SP £189.99 · ship £8)', () => {
    const m = masterOnbuy(150, 189.99, 8);
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 150, salePrice: 189.99 });
    expectClose(fin.spMinusBp,     m.spMinusBp,   'spMinusBp');
    expectClose(fin.marVat ?? 0,   m.marVat,      'MAR VAT (/6)');
    expectClose(fin.commission,    m.commission,  'commission (7%)');
    expectClose(fin.vat20 ?? 0,    m.vat20,       'VAT 20%');
    expectClose(fin.postage,       m.postage,     'shipping');
    expectClose(fin.grossProfit,   m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,     m.gpPercent,   'gpPercent (/SP — col G is SP here)');
  });

  it('GP% denominator is SP per master (ONBUY col G = SP, no Qty col)', () => {
    // BP=100, SP=200 → GP=58 → GP%=58/200*100=29
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 200 });
    expectClose(fin.gpPercent, 29, 'gpPercent /SP not /BP');
  });

  it('exposes both marginalTax and marVat (alias on the same value)', () => {
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 200 });
    expect(fin.marginalTax).toBeCloseTo(fin.marVat ?? 0, 2);
  });
});

describe('calcSaleFinancials · PROJECT parity with master', () => {
  it('row 2 (BP £115 · SP £149.79 · postage £5.90)', () => {
    const m = masterProject(115, 149.79, 5.9);
    const fin = calcSaleFinancials({ marketplace: 'PROJECT', buyPrice: 115, salePrice: 149.79 });
    expectClose(fin.spMinusBp,    m.spMinusBp,   'spMinusBp');
    expectClose(fin.marginalTax,  m.marTax,      'marginalTax (/6)');
    expectClose(fin.commission,   m.commission,  'commission (7.14%)');
    expectClose(fin.postage,      m.postage,     'postage (5.90, not 8)');
    expectClose(fin.grossProfit,  m.grossProfit, 'grossProfit');
    expectClose(fin.gpPercent,    m.gpPercent,   'gpPercent (/BP)');
  });

  it('postage defaults to £5.90 not £8', () => {
    expect(getMarketplaceFee('PROJECT').postage).toBe(5.9);
  });
});

// ── Cross-marketplace invariants — protect against future regressions ────

describe('calcSaleFinancials · cross-marketplace invariants', () => {
  it('every marketplace returns finite numbers for a happy-path sale', () => {
    const markets: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'PROJECT'];
    for (const m of markets) {
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

  it('AMAZON / BM / PROJECT divide GP% by BP (margin-over-cost)', () => {
    // GP / BP → expect a value ~2× what /SP would produce on a 2× sale.
    const a = calcSaleFinancials({ marketplace: 'AMAZON',  buyPrice: 100, salePrice: 200 });
    const b = calcSaleFinancials({ marketplace: 'BM',      buyPrice: 100, salePrice: 200 });
    const p = calcSaleFinancials({ marketplace: 'PROJECT', buyPrice: 100, salePrice: 200 });
    // Sanity: ratio of GP%/(GP / BP * 100) must be ~1 — i.e. they actually divide by BP.
    for (const fin of [a, b, p]) {
      const denom = fin.grossProfit / 100 * 100;
      expectClose(fin.gpPercent, denom, '/BP');
    }
  });

  it('EBAY / ONBUY divide GP% by SP (gross-margin-over-revenue)', () => {
    const e = calcSaleFinancials({ marketplace: 'EBAY',  buyPrice: 100, salePrice: 200, eBayShippingTier: 8 });
    const o = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 200 });
    for (const fin of [e, o]) {
      const denom = fin.grossProfit / 200 * 100;
      expectClose(fin.gpPercent, denom, '/SP');
    }
  });

  it('zero GP%-denominator collapses gpPercent to 0 instead of NaN/Infinity', () => {
    // GP% denominator per master: BP on AMAZON/BM/PROJECT, SP on EBAY/ONBUY.
    // Zero the *denominator* for each marketplace and assert the gpPercent
    // safe-fallback fires (no NaN, no Infinity).
    const cases: Array<{ m: Marketplace; bp: number; sp: number }> = [
      { m: 'AMAZON',  bp: 0,   sp: 100 },                     // /BP → 0
      { m: 'BM',      bp: 0,   sp: 100 },                     // /BP → 0
      { m: 'PROJECT', bp: 0,   sp: 100 },                     // /BP → 0
      { m: 'EBAY',    bp: 100, sp: 0   },                     // /SP → 0
      { m: 'ONBUY',   bp: 100, sp: 0   },                     // /SP → 0
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

  it('SP = BP yields spMinusBp = 0 and a negative GP (only fees + postage left)', () => {
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 100, salePrice: 100 });
    expect(fin.spMinusBp).toBe(0);
    // Net loss = MAR TAX 0 + commission (7.14% of 100) + postage 8 = -15.14
    expectClose(fin.grossProfit, -15.14, 'grossProfit on break-even SP');
  });
});
