/**
 * The quarter simulation's ground truth must agree with the app's calculator.
 *
 * scripts/groundTruthCalc.mjs is a DELIBERATE second implementation of the fee
 * schedule. That independence is the point: the simulation compares the app's
 * aggregated GP against a number derived by different code, so a regression in
 * the app shows up as a mismatch instead of the check trivially agreeing with
 * itself. calcSaleFinancials is never imported there, and should not be.
 *
 * The cost of that independence is drift, and drift is what actually happened.
 * Three fee changes landed in the app — Back Market's care fee £9.99 → £8.99,
 * Temu's commission 7% → 4.61%, eBay's marketing default 5%-of-SP → nothing
 * unless the operator enters it — and the hand-written copy was not updated.
 * The simulation then reported live-versus-truth GP mismatches on exactly
 * those three marketplaces and nowhere else, which reads like a serious
 * calculation defect in the software. It was a stale test fixture. Finding
 * that out cost a twenty-minute browser run.
 *
 * So: keep the second implementation, and pin it here in milliseconds. If the
 * schedule moves again, this fails in CI naming the marketplace and the field,
 * long before anyone waits on a simulation to say something misleading.
 */
import { describe, it, expect } from 'vitest';
import { calcSaleFinancials } from '../../lib/platforms';
import { MARKETPLACES } from '../../types';
import { calcFinancials } from '../../../scripts/groundTruthCalc.mjs';

/** BP / SP / postage triples spanning loss-making, thin and fat margins. */
const CASES: ReadonlyArray<[number, number, number]> = [
  [100, 139.99, 0],
  [55, 83.99, 0],
  [520, 679, 0],
  [240, 329, 0],
  [30, 55.99, 0],
  [300, 280, 0],        // a loss
  [100, 100, 0],        // break-even
  [110, 159.99, 6.30],  // postage, which the simulation's files never carry
  [73, 129, 4.65],
];

describe('the quarter simulation\'s ground truth tracks the app\'s calculator', () => {
  it.each(MARKETPLACES)('%s — GP agrees on every case', (m) => {
    const off: string[] = [];
    for (const [bp, sp, postage] of CASES) {
      const truth = calcFinancials(m, bp, sp, postage);
      const app = calcSaleFinancials({
        marketplace: m, buyPrice: bp, salePrice: sp, postageOverride: postage,
      } as never);
      if (Math.abs(truth.grossProfit - app.grossProfit) > 0.02) {
        off.push(`BP ${bp} SP ${sp} postage ${postage}: `
          + `ground truth ${truth.grossProfit} vs app ${app.grossProfit} `
          + `(off by ${(truth.grossProfit - app.grossProfit).toFixed(2)})`);
      }
    }
    expect(off, `\n${m}\n${off.join('\n')}\n`).toEqual([]);
  });

  it.each(MARKETPLACES)('%s — SP-BP, marginal tax and commission agree too', (m) => {
    const off: string[] = [];
    for (const [bp, sp, postage] of CASES) {
      const truth = calcFinancials(m, bp, sp, postage);
      const app = calcSaleFinancials({
        marketplace: m, buyPrice: bp, salePrice: sp, postageOverride: postage,
      } as never);
      // eBay's "commission" in the ground truth is the T.COM total (commission
      // + ROF + FVF + VAT), which is the column the report shows.
      const appCommission = m === 'EBAY' ? app.totalCom : app.commission;
      for (const [field, a, b] of [
        ['spMinusBp', truth.spMinusBp, app.spMinusBp],
        ['marginalTax', truth.marginalTax, app.marginalTax],
        ['commission', truth.commission, appCommission],
      ] as ReadonlyArray<[string, number, number]>) {
        if (Math.abs(a - b) > 0.02) {
          off.push(`BP ${bp} SP ${sp} postage ${postage} · ${field}: truth ${a} vs app ${b}`);
        }
      }
    }
    expect(off, `\n${m}\n${off.join('\n')}\n`).toEqual([]);
  });
});
