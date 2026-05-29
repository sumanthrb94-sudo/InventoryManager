/**
 * clientReportParity.test.ts — verifies the runtime calculator in
 * `calcSaleFinancials()` produces the SAME numbers as the client's live
 * SALES_REPORT_2026_1.xlsx workbook, field-by-field, to <= 1e-3 accuracy.
 *
 * Ground truth: 20 rows (5 per marketplace) extracted from the client master
 * with `openpyxl(..., data_only=True)` so each cell carries Excel's
 * post-evaluation numeric value (not the formula string).
 *
 * If any assertion fails, the offending field name is included in the
 * diagnostic so the regression is immediately attributable.
 */
import { describe, it, expect } from 'vitest';
import fixtures from '../fixtures/clientSalesReportSamples.json';
import { calcSaleFinancials } from '../../lib/platforms';
import type { Marketplace } from '../../types';

interface FixtureRow {
  marketplace: 'AMAZON' | 'BM' | 'EBAY' | 'ONBUY';
  sourceRow: number;
  BP: number;
  SP: number;
  'SP-BP': number;
  'Marginal Tax': number;
  Commission: number;
  Postage: number;
  'P. VAT': number;
  Acc: number;
  GP: number;
  'Total VAT NTP': number;
  // Sheet-specific columns
  'C. VAT'?: number;             // AMAZON
  DSF?: number;                  // AMAZON
  'DSF. VAT'?: number;           // AMAZON
  'Customer Care Fees'?: number; // BM
  ROF?: number;                  // EBAY
  FVF?: number;                  // EBAY
  VAT?: number;                  // EBAY
  'T.COM'?: number;              // EBAY
  Marketing?: number;            // EBAY
  'M. VAT'?: number;             // EBAY
  'VAT 20%'?: number;            // ONBUY
  'Total VAT'?: number;          // AMAZON (no trailing space)
  'Total VAT '?: number;         // EBAY/ONBUY (trailing space)
  'GP %'?: number;               // AMAZON/BM
  'GP%'?: number;                // EBAY/ONBUY
}

const TOL = 1e-3;

function getTotalVat(row: FixtureRow): number | undefined {
  return row['Total VAT'] ?? row['Total VAT '];
}
function getGpPct(row: FixtureRow): number | undefined {
  return row['GP %'] ?? row['GP%'];
}

describe('SALES_REPORT_2026_1.xlsx parity — calcSaleFinancials matches Excel cells', () => {
  for (const row of fixtures as FixtureRow[]) {
    const tag = `${row.marketplace} row ${row.sourceRow} (BP=${row.BP} SP=${row.SP})`;

    it(tag, () => {
      const fin = calcSaleFinancials({
        marketplace: row.marketplace as Marketplace,
        buyPrice: row.BP,
        salePrice: row.SP,
        postage: row.Postage,
        accountingFee: row.Acc,
      });

      // ── Universal fields ────────────────────────────────────────────────
      expect(fin.spMinusBp).toBeCloseTo(row['SP-BP'], 3);
      expect(fin.marginalTax).toBeCloseTo(row['Marginal Tax'], 3);
      expect(fin.commission).toBeCloseTo(row.Commission, 3);
      expect(fin.postage).toBeCloseTo(row.Postage, 3);
      expect(fin.pVat).toBeCloseTo(row['P. VAT'], 3);
      expect(fin.accountingFee).toBeCloseTo(row.Acc, 3);
      expect(fin.grossProfit).toBeCloseTo(row.GP, 3);
      expect(fin.totalVatNtp).toBeCloseTo(row['Total VAT NTP'], 3);
      const gpPctExpected = getGpPct(row)!;
      expect(fin.gpPercent).toBeCloseTo(gpPctExpected, 3);

      // ── Per-marketplace VAT components ──────────────────────────────────
      switch (row.marketplace) {
        case 'AMAZON':
          expect(fin.cVat!).toBeCloseTo(row['C. VAT']!, 3);
          expect(fin.dsf!).toBeCloseTo(row.DSF!, 3);
          expect(fin.dsfVat!).toBeCloseTo(row['DSF. VAT']!, 3);
          expect(fin.totalVat).toBeCloseTo(getTotalVat(row)!, 3);
          break;
        case 'BM':
          expect(fin.customerCareFees!).toBeCloseTo(row['Customer Care Fees']!, 3);
          // BM has no Total VAT column; calculator returns pVat alone
          expect(fin.totalVat).toBeCloseTo(row['P. VAT'], 3);
          break;
        case 'EBAY':
          expect(fin.rof!).toBeCloseTo(row.ROF!, 3);
          expect(fin.fvf!).toBeCloseTo(row.FVF!, 3);
          expect(fin.vat!).toBeCloseTo(row.VAT!, 3);
          expect(fin.totalCom!).toBeCloseTo(row['T.COM']!, 3);
          expect(fin.marketing!).toBeCloseTo(row.Marketing!, 3);
          expect(fin.mVat!).toBeCloseTo(row['M. VAT']!, 3);
          expect(fin.totalVat).toBeCloseTo(getTotalVat(row)!, 3);
          break;
        case 'ONBUY':
          expect(fin.vat20!).toBeCloseTo(row['VAT 20%']!, 3);
          expect(fin.totalVat).toBeCloseTo(getTotalVat(row)!, 3);
          break;
      }
    });
  }

  it('cross-row sanity: GP signs match across the full fixture', () => {
    const negatives = (fixtures as FixtureRow[]).filter((r) => r.GP < 0).length;
    expect(negatives).toBeGreaterThan(0); // sanity — fixtures should include loss-making sales
    expect(negatives).toBeLessThan(fixtures.length); // and profit-making sales too
  });

  it('absolute worst-case error across every field is <= 1e-3', () => {
    let worst = { field: '', diff: 0, row: '' };
    for (const row of fixtures as FixtureRow[]) {
      const fin = calcSaleFinancials({
        marketplace: row.marketplace as Marketplace,
        buyPrice: row.BP,
        salePrice: row.SP,
        postage: row.Postage,
        accountingFee: row.Acc,
      });
      const check = (name: string, got: number | undefined, want: number | undefined) => {
        if (got == null || want == null) return;
        const diff = Math.abs(got - want);
        if (diff > worst.diff) {
          worst = { field: name, diff, row: `${row.marketplace}#${row.sourceRow}` };
        }
      };
      check('SP-BP', fin.spMinusBp, row['SP-BP']);
      check('Marginal Tax', fin.marginalTax, row['Marginal Tax']);
      check('Commission', fin.commission, row.Commission);
      check('Postage', fin.postage, row.Postage);
      check('P.VAT', fin.pVat, row['P. VAT']);
      check('Acc', fin.accountingFee, row.Acc);
      check('GP', fin.grossProfit, row.GP);
      check('GP%', fin.gpPercent, getGpPct(row));
      check('Total VAT NTP', fin.totalVatNtp, row['Total VAT NTP']);
      check('C.VAT', fin.cVat, row['C. VAT']);
      check('DSF', fin.dsf, row.DSF);
      check('DSF.VAT', fin.dsfVat, row['DSF. VAT']);
      check('Customer Care Fees', fin.customerCareFees, row['Customer Care Fees']);
      check('ROF', fin.rof, row.ROF);
      check('FVF', fin.fvf, row.FVF);
      check('VAT', fin.vat, row.VAT);
      check('T.COM', fin.totalCom, row['T.COM']);
      check('Marketing', fin.marketing, row.Marketing);
      check('M.VAT', fin.mVat, row['M. VAT']);
      check('VAT 20%', fin.vat20, row['VAT 20%']);
      if (row.marketplace !== 'BM') check('Total VAT', fin.totalVat, getTotalVat(row));
    }
    // Surface the worst miss in the failure message — diagnostic gold.
    expect(
      worst.diff,
      `worst miss: ${worst.field} on ${worst.row} = ${worst.diff.toExponential(3)}`,
    ).toBeLessThanOrEqual(TOL);
  });
});
