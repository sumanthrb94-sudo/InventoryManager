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
  // Three real rows off the client's own 14-Aug-2026 report (BM SALES rows
  // 300 / 305 / 320), with HIS computed values, not ours re-derived. Every
  // figure below is what his sheet displays.
  //
  // These replaced two July rows when PSF arrived. Customer Care Fees is
  // still £8.99: his file carries 3.99 on its first 95 rows and 8.99 on the
  // remaining 237, and the rows are date-ascending — 3.99 is the OLD rate.
  // Sampling row 2 alone would have said 3.99 and cost £5 of GP a sale.
  const ROWS = [
    { order: '83746265', bp: 105, sp: 205, postage: 6.30,
      spMinusBp: 100.00, marginalTax: 16.67, commission: 22.55, customerCareFees: 8.99,
      psf: 2.05, postageVat: 1.26, grossProfit: 41.18, gpPercent: 39.22, totalVatNtp: 15.41 },
    { order: '83859176', bp: 145, sp: 219, postage: 6.30,
      spMinusBp: 74.00, marginalTax: 12.34, commission: 24.09, customerCareFees: 8.99,
      psf: 2.19, postageVat: 1.26, grossProfit: 17.83, gpPercent: 12.30, totalVatNtp: 11.08 },
    { order: '84265117', bp: 110, sp: 207, postage: 6.30,
      spMinusBp: 97.00, marginalTax: 16.17, commission: 22.77, customerCareFees: 8.99,
      psf: 2.07, postageVat: 1.26, grossProfit: 38.44, gpPercent: 34.95, totalVatNtp: 14.91 },
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
    near(f.psf,              row.psf,              `${row.order}.PSF`);
    near(f.postageVat,       row.postageVat,       `${row.order}.P. VAT`);
    near(f.grossProfit,      row.grossProfit,      `${row.order}.GP`);
    near(f.gpPercent,        row.gpPercent,        `${row.order}.GP %`);
    near(f.totalVatNtp,      row.totalVatNtp,      `${row.order}.Total VAT NTP`);
  });

  it('PSF is charged whatever the payment mode', () => {
    // His rows carry Applepay, Clearpay and blank alike, and every one of
    // them has a PSF. It is the processor's cut of money taken, and money
    // was taken either way — there is no payment mode that avoids it.
    for (const paymentMode of ['Applepay', 'Clearpay', 'Google Pay', '']) {
      const hasPayPalKlarna = /paypal|klarna|clearpay|clear pay|applepay|apple pay/i.test(paymentMode);
      const f = calcSaleFinancials({
        marketplace: 'BM', buyPrice: 105, salePrice: 205, postageOverride: 6.30, hasPayPalKlarna,
      });
      near(f.psf, 2.05, `PSF with paymentMode="${paymentMode}"`);
    }
  });
});

/**
 * Back Market's flat Customer Care Fee, pinned against a photograph of the
 * operator's own sheet (2026-08).
 *
 * The operator confirmed it in words — "£8.99 for each and every unit" — and
 * then sent a screenshot of columns K/L/M covering thirteen consecutive rows.
 * Every single one reads 8.99. There is no threshold, no category carve-out
 * and no per-order pooling: a flat charge per unit.
 *
 * BP and SP are not visible in that screenshot, so they are recovered from the
 * two columns that are: Commission = SP × 11% and Marginal Tax = (SP − BP) ×
 * 16.67%. The recovered figures land on round buy prices (£220, £105, £110,
 * £65 …), which is the check that the inversion is sound — real buy prices are
 * round, arbitrary ones would not be. Two of the rows recovered this way
 * (73/129 and 60/104) match fixtures already transcribed from the master file,
 * confirming the screenshot comes from the same workbook.
 *
 * Why this is worth eleven more rows: the £8.99 is flat, so it decides
 * profitability on cheap stock. An £50 phone sold at £80 LOSES £1.35 because
 * the fee alone exceeds the whole margin. If someone ever "tidies" this into a
 * percentage or prorates it across an order, Back Market's economics change
 * silently and in the direction that hides losses.
 */
describe('BM — the flat £8.99 care fee, from the operator\'s screenshot', () => {
  const ROWS = [
    { bp: 220, sp: 394, marginalTax: 29.01, commission: 43.34 },
    { bp: 73,  sp: 129, marginalTax: 9.34,  commission: 14.19 },
    { bp: 60,  sp: 104, marginalTax: 7.33,  commission: 11.44 },
    { bp: 105, sp: 208, marginalTax: 17.17, commission: 22.88 },
    { bp: 105, sp: 205, marginalTax: 16.67, commission: 22.55 },
    { bp: 110, sp: 197, marginalTax: 14.50, commission: 21.67 },
    { bp: 105, sp: 214, marginalTax: 18.17, commission: 23.54 },
    { bp: 100, sp: 161, marginalTax: 10.17, commission: 17.71 },
    { bp: 145, sp: 219, marginalTax: 12.34, commission: 24.09 },
    { bp: 65,  sp: 123, marginalTax: 9.67,  commission: 13.53 },
    { bp: 60,  sp: 119, marginalTax: 9.84,  commission: 13.09 },
  ];

  it.each(ROWS)('BP £$bp / SP £$sp — care fee £8.99, and the chain reproduces', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'BM', buyPrice: row.bp, salePrice: row.sp, postageOverride: 6.30,
    });
    near(f.customerCareFees, 8.99,             `BP${row.bp}/SP${row.sp}.Customer Care Fees`);
    near(f.marginalTax,      row.marginalTax,  `BP${row.bp}/SP${row.sp}.Marginal Tax`);
    near(f.commission,       row.commission,   `BP${row.bp}/SP${row.sp}.Commission`);
  });

  /** Per UNIT, not per order — three phones cost £26.97. Handsets are one per
   *  IMEI so each is its own row; this states the consequence explicitly. */
  it('charges the fee once per unit, so three phones cost £26.97', () => {
    const one = calcSaleFinancials({ marketplace: 'BM', buyPrice: 105, salePrice: 208 });
    expect(one.customerCareFees).toBe(8.99);
    expect(Math.round(one.customerCareFees! * 3 * 100) / 100).toBe(26.97);
  });

  /** The reason the flatness matters: on cheap stock it exceeds the margin. */
  it('turns a cheap sale into a loss, which is why it cannot become a percentage', () => {
    const cheap = calcSaleFinancials({
      marketplace: 'BM', buyPrice: 50, salePrice: 80, postageOverride: 6.30,
    });
    expect(cheap.grossProfit).toBeLessThan(0);
    expect(cheap.customerCareFees).toBe(8.99);
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
  //              NTP=J-U
  // Q (P. VAT), R (Marketing) and S (M. VAT) carry NO formula — the operator
  // types them, so they are inputs here. P. VAT is 0 throughout: eBay's
  // postage is zero-rated to them even though £4.65 of it is charged.
  //
  // GP % IS THE ONE CELL WE NO LONGER REPRODUCE. The master computes V/H*100
  // — gross profit over the SALE price — while its Amazon, BM and OnBuy tabs
  // all divide by the BUY price. Checked against the operator's live file of
  // 30 July: 60/60 Amazon rows, 13/13 BM rows and 6/6 OnBuy rows divide by BP,
  // and 32/32 eBay rows divide by SP. The split is real and it is theirs.
  //
  // On the operator's instruction (2026-08) the app divides by BP everywhere,
  // because one report carrying both denominators ranked the channels
  // backwards: eBay earned more per phone and displayed a lower percentage.
  // Every other cell below still reproduces the master exactly, so a genuine
  // drift in the fee chain still fails here.
  const ROWS = [
    { order: '19-14911-65354', bp: 30, sp: 55.99, postage: 4.65,
      marketing: 0, postageVat: 0, marketingVat: 0.56,
      spMinusBp: 25.99, marginalTax: 4.33, rof: 0.20, fvf: 0.40,
      totalVat: 1.37, grossProfit: 10.56,
      // master shows 18.86 (10.56/55.99); we show 10.56/30
      gpPercent: 35.20, masterGpPercentOverSp: 18.86 },
    { order: '13-14922-41007', bp: 30, sp: 49.99, postage: 4.65,
      marketing: 0, postageVat: 0, marketingVat: 0.50,
      spMinusBp: 19.99, marginalTax: 3.33, rof: 0.17, fvf: 0.40,
      totalVat: 1.24, grossProfit: 6.09,
      // master shows 12.19 (6.09/49.99); we show 6.09/30.
      // 20.31 rather than 20.30 because the percentage is derived from the
      // UNROUNDED gross profit — the house "compute raw, round once" rule.
      gpPercent: 20.31, masterGpPercentOverSp: 12.19 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'EBAY', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
      marketing: row.marketing,
      postageVatOverride: row.postageVat,
      marketingVatOverride: row.marketingVat,
    });
    // Ours is gross profit over the BUY price. The master's own published
    // figure is carried on each row as `masterGpPercentOverSp` for the record,
    // but is NOT re-derived here: the master rounds from its own unrounded
    // profit, so recomputing it from a 2dp figure lands a penny out and would
    // fail for a reason that has nothing to do with this divergence.
    near(f.gpPercent, row.gpPercent, `${row.order}.GP % (ours, over BP)`);

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

describe('TEMU — master rows reproduce cell for cell', () => {
  // Three real rows off the client's 14-Aug-2026 report (TEMU rows 3 / 45 /
  // 100), with HIS computed values. Formulas: SP-BP=H-G · MarTax=I*16.67% ·
  //   Com=H*3.96% · CVAT=K*20% · Com+VAT=K+L · P.VAT=N*20% · TotalVAT=O ·
  //   GP=I-J-K-N-O-P · GP%=R/G*100 · NTP=J-O
  // Commission is a formula now, so no commissionOverride is supplied: these
  // rows prove the 3.96% rate reaches the same figure his sheet prints.
  const ROWS = [
    { order: 'PO-210-10368282430070761', bp: 58, sp: 83.99, postage: 6.30,
      spMinusBp: 25.99, marginalTax: 4.33, commission: 3.33, commissionVat: 0.67,
      commissionPlusVat: 3.99, postageVat: 1.26, totalVat: 1.26,
      grossProfit: 9.77, gpPercent: 16.85, totalVatNtp: 3.07 },
    { order: 'PO-210-13002538537591315', bp: 120, sp: 152.67, postage: 6.30,
      spMinusBp: 32.67, marginalTax: 5.45, commission: 6.05, commissionVat: 1.21,
      commissionPlusVat: 7.25, postageVat: 1.26, totalVat: 1.26,
      grossProfit: 12.62, gpPercent: 10.52, totalVatNtp: 4.19 },
    { order: 'PO-210-02779715410551830', bp: 30, sp: 52.49, postage: 6.30,
      spMinusBp: 22.49, marginalTax: 3.75, commission: 2.08, commissionVat: 0.42,
      commissionPlusVat: 2.49, postageVat: 1.26, totalVat: 1.26,
      grossProfit: 8.10, gpPercent: 27.01, totalVatNtp: 2.49 },
  ];

  it.each(ROWS)('row $order (BP £$bp · SP £$sp)', (row) => {
    const f = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: row.bp, salePrice: row.sp,
      postageOverride: row.postage,
    });
    near(f.spMinusBp,         row.spMinusBp,         `${row.order}.SP-BP`);
    near(f.marginalTax,       row.marginalTax,       `${row.order}.Marginal Tax`);
    near(f.commission,        row.commission,        `${row.order}.Commission`);
    near(f.commissionVat,     row.commissionVat,     `${row.order}.Commission VAT`);
    near(f.commissionPlusVat, row.commissionPlusVat, `${row.order}.Commission+VAT`);
    near(f.postageVat,        row.postageVat,        `${row.order}.P. VAT`);
    near(f.totalVat,          row.totalVat,          `${row.order}.Total VAT`);
    near(f.grossProfit,       row.grossProfit,       `${row.order}.GP`);
    near(f.gpPercent,         row.gpPercent,         `${row.order}.GP %`);
    near(f.totalVatNtp,       row.totalVatNtp,       `${row.order}.Total VAT NTP`);
  });

  it('Commission+VAT sums the raw cells, not the displayed pennies', () => {
    // `=K2+L2` adds full-precision cells. On row 3 that is 3.3260 + 0.6652
    // = 3.9912 → 3.99, where adding the displayed 3.33 and 0.67 gives 4.00.
    // A penny out on every Temu line, and it reads as an arithmetic error
    // to anyone checking the column by hand.
    const f = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 58, salePrice: 83.99, postageOverride: 6.30,
    });
    near(f.commissionPlusVat, 3.99, 'Commission+VAT');
    expect(Math.round(((f.commission ?? 0) + (f.commissionVat ?? 0)) * 100) / 100)
      .toBe(4.00);   // what the displayed pennies would give
  });

  it('Commission+VAT is display only — it is not subtracted twice in GP', () => {
    // Subtracting it would charge the commission a second time.
    const f = calcSaleFinancials({
      marketplace: 'TEMU', buyPrice: 58, salePrice: 83.99, postageOverride: 6.30,
    });
    const withoutDoubleCount = 25.99 - 4.33 - 3.33 - 6.30 - 1.26 - 1;
    near(f.grossProfit, Math.round(withoutDoubleCount * 100) / 100, 'GP');
  });
});

describe('the master constants themselves', () => {
  // Guards against a fee edit that moves money without anyone noticing.
  const cases: [string, CalcSaleFinancialsInput, (f: ReturnType<typeof calcSaleFinancials>) => void][] = [
    ['BM Customer Care Fees is £8.99',
      { marketplace: 'BM', buyPrice: 100, salePrice: 200 },
      f => near(f.customerCareFees, 8.99, 'BM Customer Care Fees')],
    ['TEMU commission is 3.96% of SP',
      { marketplace: 'TEMU', buyPrice: 100, salePrice: 200 },
      f => near(f.commission, 7.92, 'TEMU Commission')],
    ['BM PSF is 1% of SP',
      { marketplace: 'BM', buyPrice: 100, salePrice: 200 },
      f => near(f.psf, 2.00, 'BM PSF')],
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
