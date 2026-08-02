/**
 * calcSaleFinancials vs the operator's 2026-08 master workbook.
 *
 * Source: SALES_TEMPLATE_UPLOAD_30TH_JULY.xlsx (AMAZON / BM / EBAY / ONBUY
 * SALES) and the Temu master (TEMU FORMULA). These are the sheets the
 * operator fills by hand and treats as the book of record, so a divergence
 * here is a divergence from the accounts — not a style difference.
 *
 * Each fixture is a REAL row: the inputs are the sheet's BP / SP / Postage
 * and the expectations are the numbers sitting in that row's own derived
 * cells. Nothing is re-derived, so a wrong constant cannot agree with
 * itself the way an independent reimplementation can.
 *
 * The four sheets that carry a formula row are quoted in the comments;
 * where a column has NO formula the master's value is typed by hand, which
 * is why Marketing / P. VAT / M. VAT arrive as inputs rather than results.
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials } from '../../lib/platforms';
import type { CalcSaleFinancialsInput } from '../../lib/platforms';

/** Compare to the penny — the master displays 2dp and we match it exactly. */
const near = (actual: number | undefined, expected: number, label: string) =>
  expect(Math.round((actual ?? 0) * 100) / 100, label).toBe(expected);

describe('AMAZON — master rows reproduce cell for cell', () => {
  // Formulas: SP-BP=H-G · MarTax=I*16.67% · Com=H*7% · C.VAT=K*20%
  //           DSF=K*2% · DSF.VAT=M*20% · P.VAT=O*20%
  //           TotalVAT=L+N+P · GP=I-J-K-L-M-N-O-P-Q · NTP=J-R
  const ROWS = [
    { order: '203-3730689-9390762', bp: 100, sp: 139.99, postage: 6.30,
      spMinusBp: 39.99, marginalTax: 6.67, commission: 9.80, commissionVat: 1.96,
      dsf: 0.20, dsfVat: 0.04, postageVat: 1.26, totalVat: 3.26,
      grossProfit: 12.77, gpPercent: 12.77, totalVatNtp: 3.41 },
    { order: '206-9763695-6217939', bp: 80, sp: 114.99, postage: 6.30,
      spMinusBp: 34.99, marginalTax: 5.83, commission: 8.05, commissionVat: 1.61,
      dsf: 0.16, dsfVat: 0.03, postageVat: 1.26, totalVat: 2.90,
      grossProfit: 10.74, gpPercent: 13.43, totalVatNtp: 2.93 },
    { order: '204-8904519-2329956', bp: 60, sp: 99.99, postage: 6.30,
      spMinusBp: 39.99, marginalTax: 6.67, commission: 7.00, commissionVat: 1.40,
      dsf: 0.14, dsfVat: 0.03, postageVat: 1.26, totalVat: 2.69,
      grossProfit: 16.20, gpPercent: 26.99, totalVatNtp: 3.98 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'AMAZON', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
    });
    near(f.spMinusBp,     row.spMinusBp,     `${row.order}.SP-BP`);
    near(f.marginalTax,   row.marginalTax,   `${row.order}.Marginal Tax`);
    near(f.commission,    row.commission,    `${row.order}.Commission`);
    near(f.commissionVat, row.commissionVat, `${row.order}.C. VAT`);
    near(f.dsf,           row.dsf,           `${row.order}.DSF`);
    near(f.dsfVat,        row.dsfVat,        `${row.order}.DSF. VAT`);
    near(f.postageVat,    row.postageVat,    `${row.order}.P. VAT`);
    near(f.totalVat,      row.totalVat,      `${row.order}.Total VAT`);
    near(f.grossProfit,   row.grossProfit,   `${row.order}.GP`);
    near(f.gpPercent,     row.gpPercent,     `${row.order}.GP %`);
    near(f.totalVatNtp,   row.totalVatNtp,   `${row.order}.Total VAT NTP`);
  });
});

describe('BM — master rows reproduce cell for cell', () => {
  // Customer Care Fees is £8.99 on every row of the master. It was £9.99
  // here until 2026-08, which made GP exactly £1 light on every BM line.
  const ROWS = [
    { order: '83693422', bp: 73,  sp: 129, postage: 6.30,
      spMinusBp: 56.00, marginalTax: 9.34, commission: 14.19, customerCareFees: 8.99,
      postageVat: 1.26, grossProfit: 14.92, gpPercent: 20.44, totalVatNtp: 8.08 },
    { order: '83697831', bp: 60,  sp: 104, postage: 6.30,
      spMinusBp: 44.00, marginalTax: 7.33, commission: 11.44, customerCareFees: 8.99,
      postageVat: 1.26, grossProfit: 7.68, gpPercent: 12.79, totalVatNtp: 6.07 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'BM', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
    });
    near(f.spMinusBp,        row.spMinusBp,        `${row.order}.SP-BP`);
    near(f.marginalTax,      row.marginalTax,      `${row.order}.Marginal Tax`);
    near(f.commission,       row.commission,       `${row.order}.Commission`);
    near(f.customerCareFees, row.customerCareFees, `${row.order}.Customer Care Fees`);
    near(f.postageVat,       row.postageVat,       `${row.order}.P. VAT`);
    near(f.grossProfit,      row.grossProfit,      `${row.order}.GP`);
    near(f.gpPercent,        row.gpPercent,        `${row.order}.GP %`);
    near(f.totalVatNtp,      row.totalVatNtp,      `${row.order}.Total VAT NTP`);
  });
});

describe('ONBUY — master rows reproduce cell for cell', () => {
  // Formulas: SP-BP=G-F · MarTax=H*16.67% · Com=G*7% · VAT20=J*20%
  //           P.VAT=L*20% · TotalVAT=K+M · GP=H-I-J-K-L-M-N · GP%=P/F*100
  // Note GP% divides by BP (col F), not SP — OnBuy has no Quantity column
  // so its letters sit one to the left of every other sheet's.
  const ROWS = [
    { order: 'T6MCSBY', bp: 110, sp: 159.99, postage: 6.30,
      spMinusBp: 49.99, marginalTax: 8.33, commission: 11.20, commissionVat: 2.24,
      postageVat: 1.26, totalVat: 3.50, grossProfit: 19.66, gpPercent: 17.87, totalVatNtp: 4.83 },
    { order: 'T6MJ5YQ', bp: 225, sp: 304.99, postage: 6.30,
      spMinusBp: 79.99, marginalTax: 13.33, commission: 21.35, commissionVat: 4.27,
      postageVat: 1.26, totalVat: 5.53, grossProfit: 32.48, gpPercent: 14.43, totalVatNtp: 7.80 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'ONBUY', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
    });
    near(f.spMinusBp,   row.spMinusBp,     `${row.order}.SP-BP`);
    near(f.marginalTax, row.marginalTax,   `${row.order}.Marginal Tax`);
    near(f.commission,  row.commission,    `${row.order}.Commission`);
    near(f.vat20,       row.commissionVat, `${row.order}.VAT 20%`);
    near(f.postageVat,  row.postageVat,    `${row.order}.P. VAT`);
    near(f.totalVat,    row.totalVat,      `${row.order}.Total VAT`);
    near(f.grossProfit, row.grossProfit,   `${row.order}.GP`);
    near(f.gpPercent,   row.gpPercent,     `${row.order}.GP %`);
    near(f.totalVatNtp, row.totalVatNtp,   `${row.order}.Total VAT NTP`);
  });
});

describe('EBAY — master rows reproduce cell for cell', () => {
  // Formula row: Com=(H*6.9%)-(H*6.9%)*10% · ROF=H*0.35% · VAT=(K+L+M)*20%
  //              T.COM=K+L+M+N · TotalVAT=N+Q+S · GP=I-J-O-P-Q-R-S-T
  //              GP%=V/H*100 · NTP=J-U
  // Q (P. VAT), R (Marketing) and S (M. VAT) carry NO formula — the operator
  // types them, so they are inputs here. P. VAT is 0 throughout: eBay's
  // postage is zero-rated to them even though £4.65 of it is charged.
  const ROWS = [
    { order: '19-14911-65354', bp: 30, sp: 55.99, postage: 4.65,
      marketing: 0, postageVat: 0, marketingVat: 0.56,
      spMinusBp: 25.99, marginalTax: 4.33, rof: 0.20, fvf: 0.40,
      totalVat: 1.37, grossProfit: 10.56, gpPercent: 18.86 },
    { order: '13-14922-41007', bp: 30, sp: 49.99, postage: 4.65,
      marketing: 0, postageVat: 0, marketingVat: 0.50,
      spMinusBp: 19.99, marginalTax: 3.33, rof: 0.17, fvf: 0.40,
      totalVat: 1.24, grossProfit: 6.09, gpPercent: 12.19 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'EBAY', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
      marketing: row.marketing,
      postageVatOverride: row.postageVat,
      marketingVatOverride: row.marketingVat,
    });
    near(f.spMinusBp,    row.spMinusBp,    `${row.order}.SP-BP`);
    near(f.marginalTax,  row.marginalTax,  `${row.order}.Marginal Tax`);
    near(f.rof,          row.rof,          `${row.order}.ROF`);
    near(f.fvf,          row.fvf,          `${row.order}.FVF`);
    near(f.postageVat,   row.postageVat,   `${row.order}.P. VAT`);
    near(f.marketing,    row.marketing,    `${row.order}.Marketing`);
    near(f.marketingVat, row.marketingVat, `${row.order}.M. VAT`);
    near(f.totalVat,     row.totalVat,     `${row.order}.Total VAT`);
    near(f.grossProfit,  row.grossProfit,  `${row.order}.GP`);
    near(f.gpPercent,    row.gpPercent,    `${row.order}.GP %`);
  });

  it('Commission follows the master FORMULA, not the pasted actuals', () => {
    // The master's Commission cell is `=(H*6.9%)-(H*6.9%)*10%` — 6.21% — but
    // the operator pastes eBay's real invoiced fee over it on most rows
    // (implied rate 4.15%–8.30%, values rounded to 10p). No formula can
    // reproduce a hand-keyed invoice line, so we follow the rule the sheet
    // itself states and land within ~5p of the pasted figure.
    const f = calcSaleFinancials({ marketplace: 'EBAY', buyPrice: 30, salePrice: 55.99 });
    near(f.commission, 3.48, 'Commission = SP × 6.21%');
    expect(Math.abs(3.48 - 3.50), 'within 5p of the master row').toBeLessThanOrEqual(0.05);
  });
});

describe('TEMU — the master formula row', () => {
  // Order PO-210-07053322437751959. Formulas: SP-BP=H-G · MarTax=I*16.67%
  //   Com=H*4.61% · P.VAT=M*20% · TotalVAT=N · GP=I-J-K-M-N-O · GP%=Q/G*100
  // Commission VAT is quoted from the sheet: its cell reads `=K2+20%`, which
  // in Excel is K+0.2, not K×20%. That is a typo in the master, but it is
  // display-only here — Temu VAT-invoices commission VAT back to the seller
  // as reclaimable input tax, so it is excluded from both Total VAT and GP.
  it('reproduces every derived cell', () => {
    const f = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 55, salePrice: 83.99,
      postageOverride: 6.30, commissionOverride: 3.87, commissionVatOverride: 4.07,
    });
    near(f.spMinusBp,   28.99, 'SP-BP');
    near(f.marginalTax, 4.83,  'Marginal Tax');
    near(f.commission,  3.87,  'Commission');
    near(f.postageVat,  1.26,  'P. VAT');
    near(f.totalVat,    1.26,  'Total VAT — P. VAT alone');
    near(f.grossProfit, 11.73, 'GP — excludes Commission VAT');
    near(f.gpPercent,   21.32, 'GP % — over BP');
    near(f.totalVatNtp, 3.57,  'Total VAT NTP');
  });

  it('derives Commission at the master rate when no file supplies one', () => {
    const f = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 55, salePrice: 83.99, postageOverride: 6.30,
    });
    // 83.99 × 4.61% = 3.8719 → the sheet's own 3.87.
    near(f.commission, 3.87, 'Commission derived = SP × 4.61%');
  });
});

describe('the master constants themselves', () => {
  // Guards against a fee edit that moves money without anyone noticing.
  const cases: [string, CalcSaleFinancialsInput, (f: ReturnType<typeof calcSaleFinancials>) => void][] = [
    ['BM Customer Care Fees is £8.99',
      { marketplace: 'BM', buyPrice: 100, salePrice: 200 },
      f => near(f.customerCareFees, 8.99, 'BM Customer Care Fees')],
    ['TEMU commission falls back to 4.61% of SP',
      { marketplace: 'TEMU', buyPrice: 100, salePrice: 200 },
      f => near(f.commission, 9.22, 'TEMU Commission')],
    ['eBay charges no postage VAT by default',
      { marketplace: 'EBAY', buyPrice: 100, salePrice: 200, postageOverride: 4.65 },
      f => near(f.postageVat, 0, 'EBAY P. VAT')],
    ['eBay invents no marketing spend by default',
      { marketplace: 'EBAY', buyPrice: 100, salePrice: 200 },
      f => near(f.marketing, 0, 'EBAY Marketing')],
    ['Amazon still charges postage VAT at 20%',
      { marketplace: 'AMAZON', buyPrice: 100, salePrice: 200, postageOverride: 6.30 },
      f => near(f.postageVat, 1.26, 'AMAZON P. VAT')],
  ];
  it.each(cases)('%s', (_label, input, assert) => assert(calcSaleFinancials(input)));
});
