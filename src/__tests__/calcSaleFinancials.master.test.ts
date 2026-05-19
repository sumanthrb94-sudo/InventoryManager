/**
 * calcSaleFinancials parity tests vs. the operator's master SALES_REPORT.
 *
 * Locks the runtime calculator to the EXACT per-cell formulas living in
 * the live SALES_REPORT_2026.xlsx (extracted from
 * xl/worksheets/sheet{1..5}.xml). Coverage: 12 real rows per platform
 * (48 unit-level cases) drawn straight from the master file, plus
 * cross-platform invariants and edge cases. Four platforms only —
 * AMAZON / BM / EBAY / ONBUY. PROJECT is permanently retired.
 *
 * Each fixture row pulls (BP, SP, Postage, [Payment Mode]) from a real
 * sale in the operator's file, evenly sampled across the dataset. For
 * each row we:
 *   1. Re-derive every derived field straight from the master's
 *      algebraic formula in plain JS (independent reimplementation —
 *      NOT a re-call of calcSaleFinancials).
 *   2. Call calcSaleFinancials with the same inputs.
 *   3. Assert outputs match within £0.02 (1p rounding-order drift max).
 *
 * Per-marketplace master formulas (verified against the raw XML):
 *   AMAZON   SP-BP=H-G  MarTax=I/6           Com=H/100*7.14
 *            GP=H-G-J-K-L                    GP%=M/G*100  (denom=BP)
 *   BM       + PPK=H/100*2.5 when payment mode hits PayPal/Klarna set
 *            Com=H/100*12                    GP%=O/G*100  (denom=BP)
 *   EBAY     MarTax=I*16.6%
 *            Com=(H*6.9%)-(H*6.9%)*10%       ROF=H*0.35%  FVF=0.4
 *            VAT=(K+L+M)*20%                 TCom=K+L+M+N
 *            GP=I-J-O-P                      GP%=Q/H*100  (denom=SP)
 *            NP=Q-H*5%
 *   ONBUY    MarVat=H/6      Com=G*7%        Vat20=I*20%
 *            GP=G-F-J-K-L-I                  GP%=M/G*100  (denom=SP)
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import type { Marketplace } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const TOL = 0.02;
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

function masterAmazon(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 7.14 / 100);
  const grossProfit = r2(sp - bp - marTax - commission - postage);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, postage, grossProfit, gpPercent };
}

function isPPKMode(mode: string): boolean {
  return /paypal|klarna|clearpay|clear pay|applepay|apple pay/i.test(mode);
}

function masterBm(bp: number, sp: number, postage: number, payment: string) {
  const hasPPK     = isPPKMode(payment);
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 12 / 100);
  const ppk        = hasPPK ? r2(sp * 2.5 / 100) : 0;
  const grossProfit = r2(sp - bp - marTax - commission - postage - ppk);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, ppk, postage, grossProfit, gpPercent, hasPPK };
}

function masterEbay(bp: number, sp: number, shipping: 1 | 2 | 8) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp * 16.6 / 100);
  const comGross   = sp * 6.9 / 100;
  const commission = r2(comGross - comGross * 10 / 100);
  const rof        = r2(sp * 0.35 / 100);
  const fvf        = 0.4;
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
  const gpPercent   = sp > 0 ? r2(grossProfit / sp * 100) : 0;
  return { spMinusBp, marVat, commission, vat20, postage, grossProfit, gpPercent };
}

// ── AMAZON — 12 rows ────────────────────────────────────────────────────

describe('calcSaleFinancials · AMAZON · 12 master rows', () => {
  it.each(AMAZON_ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const m = masterAmazon(row.bp, row.sp, row.postage);
    const fin = calcSaleFinancials({
      marketplace: 'AMAZON',
      buyPrice: row.bp,
      salePrice: row.sp,
    });
    expectClose(fin.spMinusBp,   m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax, m.marTax,      `${row.order}.marginalTax`);
    expectClose(fin.commission,  m.commission,  `${row.order}.commission`);
    expectClose(fin.postage,     m.postage,     `${row.order}.postage`);
    expectClose(fin.grossProfit, m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,   m.gpPercent,   `${row.order}.gpPercent`);
  });

  it('postage default = £8 per master', () => {
    expect(getMarketplaceFee('AMAZON').postage).toBe(8);
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
      hasPayPalKlarna: m.hasPPK,
    });
    expectClose(fin.spMinusBp,           m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,         m.marTax,      `${row.order}.marginalTax`);
    expectClose(fin.commission,          m.commission,  `${row.order}.commission`);
    expectClose(fin.payPalKlarnaCom ?? 0, m.ppk,         `${row.order}.payPalKlarnaCom`);
    expectClose(fin.postage,             m.postage,     `${row.order}.postage`);
    expectClose(fin.grossProfit,         m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,           m.gpPercent,   `${row.order}.gpPercent`);
  });

  it('PayPal/Klarna 2.5% fires for Klarna / PayPal / Clear Pay / Apple Pay only', () => {
    const ppk = ['Klarna', 'PayPal', 'Paypal', 'Clear Pay', 'Apple Pay', 'ClearPay'];
    const off = ['Google Pay', 'Card', '', 'Cash'];
    for (const mode of ppk) expect(isPPKMode(mode), `PPK fires for "${mode}"`).toBe(true);
    for (const mode of off) expect(isPPKMode(mode), `PPK silent for "${mode}"`).toBe(false);
  });

  it('postage default = £10 per master', () => {
    expect(getMarketplaceFee('BM').postage).toBe(10);
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
    expectClose(fin.spMinusBp,             m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax,           m.marTax,      `${row.order}.marginalTax (16.6%)`);
    expectClose(fin.commission,            m.commission,  `${row.order}.commission`);
    expectClose(fin.rof ?? 0,              m.rof,         `${row.order}.rof`);
    expectClose(fin.fvf ?? 0,              m.fvf,         `${row.order}.fvf`);
    expectClose(fin.twentyPercent ?? 0,    m.twenty,      `${row.order}.20% VAT bundle`);
    expectClose(fin.totalCom ?? 0,         m.totalCom,    `${row.order}.T.COM`);
    expectClose(fin.postage,               m.postage,     `${row.order}.shipping`);
    expectClose(fin.grossProfit,           m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,             m.gpPercent,   `${row.order}.gpPercent (/SP)`);
    expectClose(fin.netProfit ?? 0,        m.netProfit,   `${row.order}.netProfit (5% promo)`);
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
    });
    expectClose(fin.spMinusBp,    m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marVat ?? 0,  m.marVat,      `${row.order}.MAR VAT`);
    expectClose(fin.commission,   m.commission,  `${row.order}.commission (7%)`);
    expectClose(fin.vat20 ?? 0,   m.vat20,       `${row.order}.VAT 20%`);
    expectClose(fin.postage,      m.postage,     `${row.order}.shipping`);
    expectClose(fin.grossProfit,  m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,    m.gpPercent,   `${row.order}.gpPercent (/SP)`);
  });

  it('exposes both marginalTax and marVat (alias on the same value)', () => {
    const fin = calcSaleFinancials({ marketplace: 'ONBUY', buyPrice: 100, salePrice: 200 });
    expect(fin.marginalTax).toBeCloseTo(fin.marVat ?? 0, 2);
  });

  it('postage default = £8 per master', () => {
    expect(getMarketplaceFee('ONBUY').postage).toBe(8);
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

  it('EBAY / ONBUY divide GP% by SP (gross-margin-over-revenue)', () => {
    for (const m of ['EBAY', 'ONBUY'] as const) {
      const fin = calcSaleFinancials({
        marketplace: m,
        buyPrice: 100,
        salePrice: 200,
        eBayShippingTier: m === 'EBAY' ? 8 : undefined,
      });
      const denom = r2(fin.grossProfit / 200 * 100);
      expectClose(fin.gpPercent, denom, `${m} GP% denom=SP`);
    }
  });

  it('zero GP%-denominator collapses gpPercent to 0 (no NaN/Infinity)', () => {
    const cases: Array<{ m: Marketplace; bp: number; sp: number }> = [
      { m: 'AMAZON', bp: 0,   sp: 100 },     // /BP
      { m: 'BM',     bp: 0,   sp: 100 },     // /BP
      { m: 'EBAY',   bp: 100, sp: 0   },     // /SP
      { m: 'ONBUY',  bp: 100, sp: 0   },     // /SP
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
    expectClose(fin.grossProfit, -15.14, 'AMAZON break-even GP = -(7.14 + 8)');
  });
});
