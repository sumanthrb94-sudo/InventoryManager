/**
 * Restoring void/return state from a re-uploaded Sales Report.
 *
 * Every marketplace tab already writes a trailing Return Date / Outcome /
 * Return Reason / Shipping Legs / Postage Loss block for a voided sale
 * (clientReport.ts writeReturnBlock) — but until this round no importer
 * ever read it back, so restoring from a wiped/backed-up database silently
 * turned every return into a plain active sale. This file pins the read
 * side: parseSalesWorkbook must set voidedAt/voidOutcome/voidReason from
 * those columns when they're filled in, and must leave a sale untouched
 * (no void fields at all) when Return Date is blank.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

const AMAZON_HEADERS = [
  'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
  'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission',
  'C. VAT', 'DSF', 'DSF. VAT', 'Postage', 'P. VAT', 'Accessories',
  'Total VAT', 'GP', 'GP %', 'Total VAT NTP', 'Comments',
  'Return Date', 'Outcome', 'Return Reason', 'Shipping Legs',
  'Postage Loss', 'Net GP £',
];

function workbook(sheetName: string, headers: string[], rows: any[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], `${sheetName}.xlsx`, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** One AMAZON row matching the real 28-col export shape (see SALES_HEADERS.AMAZON). */
function amazonRow(opts: {
  order: string; imei: string; bp: number; sp: number;
  returnDate?: string; outcome?: string; reason?: string;
}): any[] {
  return [
    '2026-07-01', opts.order, 'IP13-128-MID', opts.imei, 'MOBILE WHOLESALE LTD', 1,
    opts.bp, opts.sp, opts.sp - opts.bp, '', '', '', '', '',
    6.30, '', '', '', '', '', '', '',
    opts.returnDate ?? '', opts.outcome ?? '', opts.reason ?? '', '', '', '',
  ];
}

describe('restoring void state from the marketplace tabs\' own return-info block', () => {
  it('a row with Return Date filled in restores voidedAt/voidOutcome/voidReason', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [amazonRow({
      order: 'AMZ-1', imei: '350100000000001', bp: 100, sp: 200,
      returnDate: '2026-07-09', outcome: 'Refund', reason: 'Refund — Cx Change of Mind',
    })]);
    const { sales, errors } = await parseSalesWorkbook(file, 'test.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(errors).toEqual([]);
    expect(sales).toHaveLength(1);
    expect(sales[0].voidedAt).toBe('2026-07-09');
    expect(sales[0].voidOutcome).toBe('refund');
    expect(sales[0].voidReason).toBe('Refund — Cx Change of Mind');
  });

  it('Replacement and In Repair outcomes map to the canonical enum', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [
      amazonRow({ order: 'AMZ-2', imei: '350100000000002', bp: 100, sp: 200,
        returnDate: '2026-07-10', outcome: 'Replacement', reason: 'faulty' }),
      amazonRow({ order: 'AMZ-3', imei: '350100000000003', bp: 100, sp: 200,
        returnDate: '2026-07-11', outcome: 'In Repair', reason: 'screen cracked' }),
    ]);
    const { sales } = await parseSalesWorkbook(file, 'test.xlsx', { onlyMarketplace: 'AMAZON' });
    const byOrder = (o: string) => sales.find(s => s.orderNumber === o)!;
    expect(byOrder('AMZ-2').voidOutcome).toBe('replacement');
    expect(byOrder('AMZ-3').voidOutcome).toBe('repair');
  });

  it('a row with NO Return Date is a plain active sale — no void fields at all', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [amazonRow({
      order: 'AMZ-4', imei: '350100000000004', bp: 100, sp: 200,
    })]);
    const { sales } = await parseSalesWorkbook(file, 'test.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(sales).toHaveLength(1);
    expect(sales[0].voidedAt).toBeUndefined();
    expect(sales[0].voidOutcome).toBeUndefined();
    expect(sales[0].voidReason).toBeUndefined();
  });

  it('a file that predates these columns entirely still parses — no crash, no phantom voids', async () => {
    const legacyHeaders = AMAZON_HEADERS.slice(0, 22); // no return-info block at all
    const legacyRow = amazonRow({ order: 'AMZ-5', imei: '350100000000005', bp: 100, sp: 200 }).slice(0, 22);
    const file = workbook('AMAZON', legacyHeaders, [legacyRow]);
    const { sales, errors } = await parseSalesWorkbook(file, 'test.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(errors).toEqual([]);
    expect(sales).toHaveLength(1);
    expect(sales[0].voidedAt).toBeUndefined();
  });
});

const RETURNS_TAB_HEADERS = [
  'Sale Date', 'Return Date',
  'Marketplace', 'Order Number', 'SKU', 'IMEI', 'Supplier',
  'Outcome', 'Return Type', 'Return Reason', 'Shipping Legs', 'Postage Loss £',
  'BP', 'SP', 'SP-BP', 'Postage', 'Comments',
];

function returnsTabRow(opts: {
  marketplace: string; order: string; imei: string; returnType?: string;
}): any[] {
  return [
    '2026-07-01', '2026-07-09', opts.marketplace, opts.order, 'IP13-128-MID', opts.imei,
    'MOBILE WHOLESALE LTD', 'Refund', opts.returnType ?? '', 'Cx Change of Mind', 2, 12.60,
    100, 200, 100, 6.30, '',
  ];
}

/** Builds a workbook with BOTH an AMAZON tab (so parseSalesWorkbook has at
 *  least one sheet to read) and a Returns tab, matching the real multi-sheet
 *  export shape — parseReturnsTab only fires off the 'Returns' sheet name. */
function workbookWithReturnsTab(returnRows: any[][]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, amazonRow({ order: 'AMZ-1', imei: '350100000000001', bp: 100, sp: 200 })]), 'AMAZON',
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RETURNS_TAB_HEADERS, ...returnRows]), 'Returns');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('parseReturnsTab — reading the cross-marketplace Returns sheet', () => {
  it('reads marketplace/order/imei/returnType per row, mapping every Return Type label', async () => {
    const file = workbookWithReturnsTab([
      returnsTabRow({ marketplace: 'AMAZON', order: 'AMZ-10', imei: '350100000000010', returnType: 'Back to Inventory' }),
      returnsTabRow({ marketplace: 'BM', order: 'BM-11', imei: '350100000000011', returnType: 'In Repair' }),
      returnsTabRow({ marketplace: 'EBAY', order: 'EBAY-12', imei: '350100000000012', returnType: 'To Supplier' }),
      returnsTabRow({ marketplace: 'ONBUY', order: 'OB-13', imei: '350100000000013' }), // blank Return Type
    ]);
    const { returnRows } = await parseSalesWorkbook(file, 'test.xlsx');
    expect(returnRows).toHaveLength(4);
    expect(returnRows.find((r) => r.orderNumber === 'AMZ-10')).toMatchObject({
      marketplace: 'AMAZON', imei: '350100000000010', returnType: 'returned_to_inventory',
    });
    expect(returnRows.find((r) => r.orderNumber === 'BM-11')?.returnType).toBe('repair');
    expect(returnRows.find((r) => r.orderNumber === 'EBAY-12')?.returnType).toBe('returned_to_supplier');
    expect(returnRows.find((r) => r.orderNumber === 'OB-13')?.returnType).toBeUndefined();
  });

  it('skips the TOTAL footer row and any row with no marketplace', async () => {
    const file = workbookWithReturnsTab([
      returnsTabRow({ marketplace: 'AMAZON', order: 'AMZ-20', imei: '350100000000020', returnType: 'Back to Inventory' }),
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TOTAL'],
    ]);
    const { returnRows } = await parseSalesWorkbook(file, 'test.xlsx');
    expect(returnRows).toHaveLength(1);
    expect(returnRows[0].orderNumber).toBe('AMZ-20');
  });

  it('a workbook with no Returns sheet at all yields an empty array, not an error', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [amazonRow({ order: 'AMZ-30', imei: '350100000000030', bp: 100, sp: 200 })]);
    const { returnRows, errors } = await parseSalesWorkbook(file, 'test.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(errors).toEqual([]);
    expect(returnRows).toEqual([]);
  });
});
