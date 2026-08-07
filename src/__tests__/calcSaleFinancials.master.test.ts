/**
 * calcSaleFinancials parity tests vs. the operator's master SALES_REPORT.
 *
 * Locks the runtime calculator to the EXACT per-cell formulas living in
 * the live SALES_REPORT_2026.xlsx (extracted from
 * xl/worksheets/sheet{1..5}.xml). Coverage: 12 real rows per platform
 * (48 unit-level cases) drawn straight from the master file, plus
 * cross-platform invariants and edge cases. AMAZON / BM / EBAY / ONBUY
 * are the four legacy platforms; PROJECT is permanently retired. TEMU
 * (added 2026-07) gets its own block below, verified against the single
 * real example row on the operator's Temu formula sheet — there is no
 * 12-row master file for it yet.
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
 *            GP=I-J-O-P                      GP%=Q/G*100  (denom=BP —
 *            the master divides by SP here; see masterEbay for why we do not)
 *            NP=Q-H*5%
 *   ONBUY    MarVat=H/6      Com=G*7%        Vat20=I*20%
 *            GP=G-F-J-K-L-I                  GP%=M/F*100  (denom=BP)
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import { MARKETPLACES } from '../types';
import type { Marketplace } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const TOL = 0.02;
// Round the magnitude before comparing to absorb IEEE-754 noise like
// |−0.31 − −0.29| → 0.020000000000000018 which is strictly > 0.02.
function expectClose(actual: number, expected: number, label: string) {
  const diff = Math.round(Math.abs(actual - expected) * 100) / 100;
  expect(
    diff,
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

// ── Master-formula reference implementations.
//
// These mirror the 2026-05 per-marketplace schema currently in
// src/lib/platforms.ts. Originally the fixture asserted the legacy
// commission rates (Amazon 7.14%, BM 12%, eBay 6.9% gross) and a
// simpler GP formula. The operator's schema moved on (Amazon 7%
// commission + C.VAT + DSF + Accessories chain, BM 11% commission +
// Customer Care Fees, eBay 6.21% effective commission, OnBuy adds
// VAT 20% on Commission and Postage). Updated to assert the new
// shape so the tests serve as regression guards on the current chain.

function masterAmazon(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 7 / 100);
  const commissionVat = r2(commission * 0.2);
  const dsf        = r2(commission * 0.02);
  const dsfVat     = r2(dsf * 0.2);
  const postageVat = r2(postage * 0.2);
  const accessoryFee = 1;
  const totalVat   = r2(commissionVat + dsfVat + postageVat);
  const grossProfit = r2(sp - bp - marTax - commission - commissionVat - dsf - dsfVat - postage - postageVat - accessoryFee);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, postage, grossProfit, gpPercent };
}

function isPPKMode(mode: string): boolean {
  return /paypal|klarna|clearpay|clear pay|applepay|apple pay/i.test(mode);
}

function masterBm(bp: number, sp: number, postage: number, payment: string) {
  // 2026-05 schema dropped PayPal/Klarna commission (the legacy 2.5%
  // line). hasPPK is still returned so the isPPKMode() detector test
  // below can keep asserting the regex; the calc itself ignores it.
  const hasPPK     = isPPKMode(payment);
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 11 / 100);
  // £8.99 per the operator's 2026-08 master (BM SALES charges it on every
  // row). Was 9.99 from the 2026-05 reference sheet.
  const customerCareFees = 8.99;
  const postageVat = r2(postage * 0.2);
  const accessoryFee = 1;
  const grossProfit = r2(sp - bp - marTax - commission - customerCareFees - postage - postageVat - accessoryFee);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  return { spMinusBp, marTax, commission, ppk: 0, postage, grossProfit, gpPercent, hasPPK };
}

function masterEbay(bp: number, sp: number, shipping: 1 | 2 | 8) {
  // 2026-05: effective commission rate 6.21% (6.9% × 90% after the
  // operator's account-level reduction) — confirmed verbatim by the
  // 2026-08 master, whose Commission cell reads =(H*6.9%)-(H*6.9%)*10%.
  //
  // 2026-08: Marketing and P. VAT are NOT derived. Neither cell carries a
  // formula in the master: Marketing is the operator's real promo spend
  // (£0 on most rows) and P. VAT is 0 on all 33 eBay rows despite £4.65 of
  // postage, eBay's shipping being zero-rated to them. Both default to
  // zero here, which is what calcSaleFinancials now produces when no
  // caller supplies them.
  const spMinusBp  = r2(sp - bp);
  const marTax     = r2(spMinusBp / 6);
  const commission = r2(sp * 6.21 / 100);
  const rof        = r2(sp * 0.35 / 100);
  const fvf        = 0.4;
  const twenty     = r2((commission + rof + fvf) * 20 / 100);
  const totalCom   = r2(commission + rof + fvf + twenty);
  const postageVat = 0;
  const marketing  = 0;
  const marketingVat = r2(marketing * 0.2);
  const accessoryFee = 1;
  const grossProfit = r2(spMinusBp - marTax - totalCom - shipping - postageVat - marketing - marketingVat - accessoryFee);
  // GP% IS THE ONE CELL THAT NO LONGER MATCHES THE MASTER SHEET.
  //
  // The operator's eBay tab divides gross profit by the SALE price, while
  // their other four tabs divide by the BUY price. Every other figure in this
  // function is still transcribed from the master and still agrees with it —
  // only this line is a deliberate departure, made on the operator's own
  // instruction (2026-08).
  //
  // The reason: on a £300/£400 phone eBay returns £44.06 against Amazon's
  // £40.50, and the old convention still showed eBay the LOWER percentage
  // (11.0% vs 13.5%), because a bigger denominator makes a smaller number.
  // Read at face value the report recommended the worse channel.
  //
  // If the master sheet is ever the arbiter again, this is the line to argue
  // about — not a bug, a decision.
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
  const netProfit   = grossProfit;
  return { spMinusBp, marTax, commission, rof, fvf, twenty, totalCom, postage: shipping, grossProfit, gpPercent, netProfit };
}

function masterOnbuy(bp: number, sp: number, postage: number) {
  const spMinusBp  = r2(sp - bp);
  const marVat     = r2(spMinusBp / 6);
  const commission = r2(sp * 7 / 100);
  const vat20      = r2(commission * 0.2);
  const postageVat = r2(postage * 0.2);
  const accessoryFee = 1;
  const grossProfit = r2(sp - bp - commission - vat20 - postage - postageVat - accessoryFee - marVat);
  const gpPercent   = bp > 0 ? r2(grossProfit / bp * 100) : 0;
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
      postageOverride: row.postage,
    });
    expectClose(fin.spMinusBp,   m.spMinusBp,   `${row.order}.spMinusBp`);
    expectClose(fin.marginalTax, m.marTax,      `${row.order}.marginalTax`);
    expectClose(fin.commission,  m.commission,  `${row.order}.commission`);
    expectClose(fin.postage,     m.postage,     `${row.order}.postage`);
    expectClose(fin.grossProfit, m.grossProfit, `${row.order}.grossProfit`);
    expectClose(fin.gpPercent,   m.gpPercent,   `${row.order}.gpPercent`);
  });

  it('postage default = 0 per 2026-05 schema (operator-entered per sale)', () => {
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
      hasPayPalKlarna: m.hasPPK,
      postageOverride: row.postage,
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

  it('postage default = 0 per 2026-05 schema (operator-entered per sale)', () => {
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
    // netProfit is optional on the Sale doc — the 2026-05 schema folded
    // the legacy 5%-promo line into the Marketing column the operator
    // enters. calcSaleFinancials leaves it undefined unless the caller
    // supplies one, so coerce to 0 on both sides.
    expectClose(fin.netProfit ?? 0, 0, `${row.order}.netProfit (zero by default)`);
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

  it('postage default = 0 per 2026-05 schema (operator-entered per sale)', () => {
    expect(getMarketplaceFee('ONBUY').postage).toBe(0);
  });
});

// ── TEMU — the client's final, real export row ──────────────────────────
//
// Added 2026-07, corrected 2026-07 against TEMU_FORMULA.csv — the client's
// actual Temu export for order PO-210-07053322437751959. An earlier pass
// used illustrative numbers for this exact same order (BP=100, SP=119.33,
// Commission computed as a flat 7% of SP, zero VAT anywhere) that turned
// out to be wrong; this is the real transaction: BP=55, SP=83.99,
// Postage=6.30, and Temu's own reported Commission=3.87 (a real per-order
// figure — Temu's referral rate varies by category, so it isn't a flat
// percentage the app can derive on its own).
//
// Commission VAT is NOT taken from the sheet. The master's cell reads
// `=K2+20%`, which Excel evaluates as K + 0.2, giving 4.07 where 20% VAT on
// a 3.87 commission is 0.77 — a `+` typed for a `*`. VAT is a rate, not a
// per-order negotiation, so we derive it. Nothing downstream moves: Temu
// VAT-invoices commission VAT back as reclaimable input tax, so it sits
// outside Total VAT and GP either way.
describe('calcSaleFinancials · TEMU · the client\'s real export row', () => {
  it('matches the export exactly when Commission is given', () => {
    const fin = calcSaleFinancials({
      marketplace: 'TEMU',
      buyPrice: 55,
      salePrice: 83.99,
      postageOverride: 6.30,
      commissionOverride: 3.87,
    });
    expectClose(fin.spMinusBp,   28.99, 'TEMU.spMinusBp');
    expectClose(fin.marginalTax, 4.83,  'TEMU.marginalTax');
    expectClose(fin.commission,  3.87,  'TEMU.commission');
    expectClose(fin.commissionVat, 0.77, 'TEMU.commissionVat');  // 3.87 × 20%
    expectClose(fin.postage,     6.30,  'TEMU.postage');
    expectClose(fin.postageVat,  1.26,  'TEMU.postageVat');     // Postage × 20% — NOT zero
    expectClose(fin.totalVat,    1.26,  'TEMU.totalVat');       // = postageVat alone
    expectClose(fin.grossProfit, 11.73, 'TEMU.grossProfit');
    expectClose(fin.gpPercent,   21.32, 'TEMU.gpPercent');
    expectClose(fin.totalVatNtp, 3.57,  'TEMU.totalVatNtp');
  });

  it('excludes Commission VAT from Total VAT and GP — it is informational only', () => {
    // Temu VAT-invoices its own commission to the seller as reclaimable
    // input tax; the export confirms this by construction (Total VAT =
    // P.VAT alone, GP only reconciles when Commission VAT is left out).
    const fin = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 55, salePrice: 83.99, postageOverride: 6.30,
      commissionOverride: 3.87,
    });
    expect(fin.commissionVat).toBe(0.77);
    expect(fin.totalVat).toBe(1.26);        // P. VAT alone
    expect(fin.grossProfit).toBe(11.73);    // unchanged by the VAT line
  });

  it('falls back to commissionPct × SP when the file has no Commission column', () => {
    // 4.61%, the rate in the operator's Temu master (`=H2*4.61%`), not the
    // 7% placeholder used before that file arrived.
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 200 });
    expect(fin.commission).toBe(9.22);      // 200 × 4.61%
    expect(fin.commissionVat).toBe(1.84);   // fallback: commission × 20%
  });

  it('Postage VAT is 20%, same as every other marketplace — no longer a fixed 0', () => {
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 200, postageOverride: 10 });
    expect(fin.postageVat).toBe(2);
    expect(fin.totalVat).toBe(2);
  });

  it('has no DSF line at all — Temu\'s export has no DSF/DSF VAT columns', () => {
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 200 });
    expect(fin.dsf).toBeUndefined();
    expect(fin.dsfVat).toBeUndefined();
  });

  it('still charges the flat £1 accessory fee, same as Amazon', () => {
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 200 });
    expect(fin.accessoryFee).toBe(1);
  });

  it('GP% divides by BP, same convention as Amazon', () => {
    const fin = calcSaleFinancials({ marketplace: 'TEMU', buyPrice: 100, salePrice: 200 });
    expectClose(fin.gpPercent, r2(fin.grossProfit / 100 * 100), 'TEMU GP% denom=BP');
  });

  it('postage default = 0 per schema (operator-entered per sale)', () => {
    expect(getMarketplaceFee('TEMU').postage).toBe(0);
  });
});

// ── Cross-marketplace invariants ────────────────────────────────────────

describe('calcSaleFinancials · cross-marketplace invariants', () => {
  const ALL: Marketplace[] = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];

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

  it('AMAZON / BM / TEMU divide GP% by BP (margin-over-cost)', () => {
    for (const m of ['AMAZON', 'BM', 'TEMU'] as const) {
      const fin = calcSaleFinancials({ marketplace: m, buyPrice: 100, salePrice: 200 });
      const denom = r2(fin.grossProfit / 100 * 100);
      expectClose(fin.gpPercent, denom, `${m} GP% denom=BP`);
    }
  });

  it('EVERY marketplace divides GP% by BP — eBay included', () => {
    // eBay was the last holdout, dividing by SP until 2026-08. One report
    // carrying two different denominators made the channels incomparable, and
    // misleadingly so: eBay earned more per phone and displayed less.
    //
    // Asserted as a single loop over all five rather than as per-marketplace
    // cases, because the property that matters now is that they AGREE. A
    // future marketplace that quietly picked its own denominator would slip
    // past a test written one channel at a time.
    for (const m of MARKETPLACES) {
      const fin = calcSaleFinancials({
        marketplace: m, buyPrice: 100, salePrice: 200,
        eBayShippingTier: m === 'EBAY' ? 8 : undefined,
      });
      expectClose(fin.gpPercent, r2(fin.grossProfit / 100 * 100), `${m} GP% denom=BP`);
    }
  });

  it('zero GP%-denominator collapses gpPercent to 0 (no NaN/Infinity)', () => {
    // Every marketplace divides by BP as of 2026-08, so a zero BUY price is
    // now the single zero-denominator case for all of them.
    const cases: Array<{ m: Marketplace; bp: number; sp: number }> = [
      { m: 'AMAZON', bp: 0, sp: 100 },
      { m: 'BM',     bp: 0, sp: 100 },
      { m: 'ONBUY',  bp: 0, sp: 100 },
      { m: 'EBAY',   bp: 0, sp: 100 },
      { m: 'TEMU',   bp: 0, sp: 100 },
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
    // Per 2026-05 spec: AMAZON GP at SP=BP=100 is -(commission +
    // commissionVat + dsf + dsfVat + accessoryFee) since marTax = 0 and
    // postage defaults to 0. Computed: -(7 + 1.4 + 0.14 + 0.03 + 1) =
    // -9.57. Round-trip via the actual calc keeps the test honest if
    // any of those components moves.
    const fin = calcSaleFinancials({ marketplace: 'AMAZON', buyPrice: 100, salePrice: 100 });
    expect(fin.spMinusBp).toBe(0);
    expectClose(fin.grossProfit, -9.57, 'AMAZON break-even GP');
  });
});
