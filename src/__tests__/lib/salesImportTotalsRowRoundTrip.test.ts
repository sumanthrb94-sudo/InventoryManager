/**
 * Round-tripping the app's own Sales Report export used to fail.
 *
 * clientReport.ts's writeMarketplaceTotalsRow() appends a bold "TOTAL" row
 * to every marketplace sheet — a real, documented export feature (the
 * README sheet advertises it: "Per-marketplace sheets carry a TOTAL row at
 * the bottom"). The literal string "TOTAL" sits in the Date column with
 * every other cell blank.
 *
 * The parser's empty-row gate treats ANY non-blank Date cell as "this row
 * has a date, so it's a real attempt at a sale" — which let the footer
 * through, where it then failed for having neither an orderNumber nor an
 * IMEI. So downloading a Sales Report and re-uploading the same file
 * unmodified produced one false "invalid" row per non-empty marketplace
 * sheet, purely from the app's own footer.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

const AMAZON_HEADERS = [
  'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
  'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments',
];

function workbook(sheetName: string, headers: string[], rows: any[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], `${sheetName}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const amazonRow = (order: string, imei: string, bp: number, sp: number) =>
  ['2026-07-20', order, 'IP13-128-MID', imei, 'MOBILE WHOLESALE LTD', 1, bp, sp, sp - bp, '', '', 8, '', '', ''];

// Exactly what writeMarketplaceTotalsRow() emits: "TOTAL" in column 1
// (Date), every other identifying column blank, SUM formulas elsewhere —
// the formulas aren't reproduced here since the parser never gets that far.
const totalFooterRow = ['TOTAL', null, null, null, null, null, null, null, null, null, null, null, null, null, null];

describe('Sales Report round trip — the export\'s own TOTAL footer row', () => {
  it('a TOTAL footer row is skipped silently, not flagged invalid', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [
      amazonRow('AMZ-5001', '350100000000000', 320, 425),
      amazonRow('AMZ-5002', '350100000007919', 318, 419),
      totalFooterRow,
    ]);

    const parsed = await parseSalesWorkbook(file, 'export.xlsx', { onlyMarketplace: 'AMAZON' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.sales).toHaveLength(2);
    expect(parsed.perSheetCounts.AMAZON).toBe(2);
  });

  it('is case- and whitespace-insensitive (" total ", "Total")', async () => {
    for (const label of [' total ', 'Total', 'TOTAL']) {
      const file = workbook('AMAZON', AMAZON_HEADERS, [
        amazonRow('AMZ-6001', '350100000009999', 200, 260),
        [label, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ]);
      const parsed = await parseSalesWorkbook(file, 'export.xlsx', { onlyMarketplace: 'AMAZON' });
      expect(parsed.errors).toEqual([]);
      expect(parsed.sales).toHaveLength(1);
    }
  });

  it('a genuine row with only a date and no order/IMEI is still a real error', async () => {
    // Guards against over-widening the skip: a data-entry mistake (a real
    // date typed in, nothing else) must still surface, not be swallowed
    // alongside the footer.
    const file = workbook('AMAZON', AMAZON_HEADERS, [
      amazonRow('AMZ-7001', '350100000001111', 300, 400),
      ['2026-07-22', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    ]);
    const parsed = await parseSalesWorkbook(file, 'export.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toMatch(/missing both orderNumber AND imei/);
  });
});
