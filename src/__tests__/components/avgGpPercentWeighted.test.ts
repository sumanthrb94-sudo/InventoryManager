/**
 * Avg GP % showed −23.2% next to £60,110 of gross profit.
 *
 * The tile averaged each sale's own GP% and divided by the count. Every sale
 * carries postage (£6.30 + VAT) and a £1 accessories fee regardless of what it
 * is, and an accessory's buy price is pennies — so a SIM pin bought at 15p,
 * posted for £6.30 and sold for 18p scores −11,693% on its own. A few hundred
 * cheap lines drag the mean below zero while the business is making money.
 *
 * On a month of real volume (1,470 unit sales + 233 accessory lines) the two
 * statistics disagree completely:
 *
 *   mean of per-sale GP%      −135.1%
 *   total GP / total BP        +10.7%
 *
 * The weighted figure is the one the P&L recognises: every pound of cost
 * counts once, and no single cheap line can move it more than its size.
 *
 * These tests work the arithmetic by hand rather than importing the
 * component's own reducer — a test that recomputes it the same way would agree
 * with the bug.
 */
import { describe, it, expect } from 'vitest';

interface Line { grossProfit: number; buyPrice: number }

/** What the tile does now. */
const weightedGpPct = (sales: Line[]): number => {
  const gp = sales.reduce((t, s) => t + (s.grossProfit ?? 0), 0);
  const bp = sales.reduce((t, s) => t + (s.buyPrice ?? 0), 0);
  return bp > 0 ? (gp / bp) * 100 : 0;
};

/** What it used to do, kept so the difference is visible rather than asserted. */
const meanOfPercentages = (sales: Line[]): number =>
  sales.reduce((t, s) => t + (s.buyPrice > 0 ? (s.grossProfit / s.buyPrice) * 100 : 0), 0) / sales.length;

describe('Avg GP % is weighted by money', () => {
  it('is the ratio of total GP to total buy price', () => {
    const sales: Line[] = [
      { grossProfit: 60, buyPrice: 300 },
      { grossProfit: 40, buyPrice: 200 },
    ];
    // 100 / 500
    expect(weightedGpPct(sales)).toBeCloseTo(20, 6);
  });

  it('THE REGRESSION: one cheap loss-making line cannot flip a profitable book', () => {
    // Ninety-nine healthy handsets and a single SIM pin posted at a loss.
    const handsets: Line[] = Array.from({ length: 99 }, () => ({ grossProfit: 45, buyPrice: 300 }));
    const simPin: Line = { grossProfit: -17.54, buyPrice: 0.15 };
    const book = [...handsets, simPin];

    // The book made £4,437 on £29,700 of stock. That is a profit.
    const gp = book.reduce((t, s) => t + s.grossProfit, 0);
    expect(gp).toBeGreaterThan(4000);

    expect(weightedGpPct(book), 'weighted stays close to the handsets').toBeCloseTo(14.9, 1);
    expect(meanOfPercentages(book), 'the old mean reads catastrophic')
      .toBeLessThan(-100);
  });

  it('agrees with the mean when every line is the same size', () => {
    // The two only diverge when the lines differ in cost — which is exactly
    // why the bug hid until accessories were sold alongside handsets.
    const sales: Line[] = [
      { grossProfit: 30, buyPrice: 200 },
      { grossProfit: 20, buyPrice: 200 },
      { grossProfit: 40, buyPrice: 200 },
    ];
    expect(weightedGpPct(sales)).toBeCloseTo(meanOfPercentages(sales), 6);
  });

  it('reports a genuine loss as a loss', () => {
    // The fix must not simply make the number positive.
    const sales: Line[] = [
      { grossProfit: -20, buyPrice: 100 },
      { grossProfit: -10, buyPrice: 100 },
    ];
    expect(weightedGpPct(sales)).toBeCloseTo(-15, 6);
  });

  it('is zero, not NaN, before anything has sold', () => {
    expect(weightedGpPct([])).toBe(0);
    expect(weightedGpPct([{ grossProfit: 5, buyPrice: 0 }])).toBe(0);
  });
});

describe('the tile as SellSheet computes it', () => {
  it('uses total GP over total BP, not a mean of per-sale percentages', () => {
    // Reading the source is deliberate: this is the one line that decides the
    // headline margin figure the operator reads every morning, and the old
    // form (`gpPctSum / allCount`) looks perfectly reasonable in review.
    const src = require('node:fs').readFileSync(
      require('node:path').resolve(process.cwd(), 'src/components/SellSheet.tsx'), 'utf8');
    expect(src, 'avgGpPct should divide summed GP by summed BP')
      .toMatch(/avgGpPct:\s*allBP\s*>\s*0\s*\?\s*\(allGP\s*\/\s*allBP\)\s*\*\s*100/);
    // Ban the SHAPE, not the word — the comment above that line names the old
    // form on purpose, and a test that forbids mentioning a bug forbids
    // explaining it.
    expect(src, 'nothing should accumulate per-sale percentages any more')
      .not.toMatch(/gpPctSum\s*\+=/);
    expect(src, 'and nothing should divide that sum by the sale count')
      .not.toMatch(/gpPctSum\s*\/\s*allCount/);
  });
});
