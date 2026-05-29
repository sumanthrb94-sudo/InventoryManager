/**
 * Standalone helper to print the actual worst-case error per field across
 * every fixture row. Run with: npx vitest run --reporter=verbose <path>
 */
import { describe, it } from 'vitest';
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
  'C. VAT'?: number;
  DSF?: number;
  'DSF. VAT'?: number;
  'Customer Care Fees'?: number;
  ROF?: number;
  FVF?: number;
  VAT?: number;
  'T.COM'?: number;
  Marketing?: number;
  'M. VAT'?: number;
  'VAT 20%'?: number;
  'Total VAT'?: number;
  'Total VAT '?: number;
  'GP %'?: number;
  'GP%'?: number;
}

describe('accuracy report — 40 client rows × every field', () => {
  it('emit per-field max |computed − Excel| across all rows', () => {
    const worst: Record<string, { diff: number; row: string }> = {};
    const record = (field: string, got: number | undefined, want: number | undefined, rowTag: string) => {
      if (got == null || want == null) return;
      const diff = Math.abs(got - want);
      if (!worst[field] || diff > worst[field].diff) worst[field] = { diff, row: rowTag };
    };

    for (const row of fixtures as FixtureRow[]) {
      const tag = `${row.marketplace}#${row.sourceRow}`;
      const fin = calcSaleFinancials({
        marketplace: row.marketplace as Marketplace,
        buyPrice: row.BP, salePrice: row.SP,
        postage: row.Postage, accessories: row.Acc,
      });
      const tv = row['Total VAT'] ?? row['Total VAT '];
      const gp = row['GP %'] ?? row['GP%'];
      record('SP-BP', fin.spMinusBp, row['SP-BP'], tag);
      record('Marginal Tax', fin.marginalTax, row['Marginal Tax'], tag);
      record('Commission', fin.commission, row.Commission, tag);
      record('Postage', fin.postage, row.Postage, tag);
      record('P.VAT', fin.pVat, row['P. VAT'], tag);
      record('Acc', fin.accessories, row.Acc, tag);
      record('GP', fin.grossProfit, row.GP, tag);
      record('GP%', fin.gpPercent, gp, tag);
      record('Total VAT NTP', fin.totalVatNtp, row['Total VAT NTP'], tag);
      record('C.VAT', fin.cVat, row['C. VAT'], tag);
      record('DSF', fin.dsf, row.DSF, tag);
      record('DSF.VAT', fin.dsfVat, row['DSF. VAT'], tag);
      record('Customer Care Fees', fin.customerCareFees, row['Customer Care Fees'], tag);
      record('ROF', fin.rof, row.ROF, tag);
      record('FVF', fin.fvf, row.FVF, tag);
      record('VAT', fin.vat, row.VAT, tag);
      record('T.COM', fin.totalCom, row['T.COM'], tag);
      record('Marketing', fin.marketing, row.Marketing, tag);
      record('M.VAT', fin.mVat, row['M. VAT'], tag);
      record('VAT 20%', fin.vat20, row['VAT 20%'], tag);
      if (row.marketplace !== 'BM') record('Total VAT', fin.totalVat, tv, tag);
    }

    const lines = Object.entries(worst)
      .sort((a, b) => b[1].diff - a[1].diff)
      .map(([f, { diff, row }]) => `  ${f.padEnd(20)} ${diff.toExponential(3)}  (worst row: ${row})`);
    console.log('\nWORST PER-FIELD ERROR ACROSS 40 ROWS:\n' + lines.join('\n') + '\n');
  });
});
