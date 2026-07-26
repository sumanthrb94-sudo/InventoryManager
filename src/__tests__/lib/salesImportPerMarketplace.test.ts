/**
 * Per-marketplace sales upload.
 *
 * Marketplaces send their reports separately, so the common case is one
 * file per channel — not one workbook with four sheets. Uploading an
 * Amazon-only export used to produce three "sheet missing" errors, and a
 * file whose sheet was named "Sheet1" produced four.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

const AMAZON_HEADERS = [
  'Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity',
  'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments',
];
/** The header Amazon files carried before the schema was normalised. Years of
 *  operator files still say this, so it has to keep working forever. */
const AMAZON_HEADERS_LEGACY_NW = ['nw', ...AMAZON_HEADERS.slice(1)];
const ONBUY_HEADERS = [
  'DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier',
  'BP', 'SP', 'SP-BP', 'MAR VAT', 'COM 7%', 'VAT 20%', 'SHIP', 'GP', 'GP%', 'Comments',
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

const onbuyRow = (order: string, imei: string, bp: number, sp: number) =>
  ['2026-07-21', order, 'PIX7-128-BLK', imei, 'NORTHSIDE STOCK', bp, sp, sp - bp, '', '', '', 8, '', '', ''];

// Same 15-column layout as AMAZON — see platforms.ts DEFAULT_MARKETPLACE_FEES.TEMU.
const TEMU_HEADERS = AMAZON_HEADERS;
const temuRow = (order: string, imei: string, bp: number, sp: number) =>
  ['2026-07-24', order, 'SG-A17-128GB-OB', imei, 'MHL', 1, bp, sp, sp - bp, '', '', 6.30, '', '', ''];

describe('single-marketplace upload', () => {
  it('parses an AMAZON-only file with no "missing sheet" noise', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [
      amazonRow('AMZ-5001', '350100000000000', 320, 425),
      amazonRow('AMZ-5002', '350100000007919', 318, 419),
    ]);

    const parsed = await parseSalesWorkbook(file, 'amazon.xlsx', { onlyMarketplace: 'AMAZON' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.sales).toHaveLength(2);
    expect(parsed.sales.every(s => s.marketplace === 'AMAZON')).toBe(true);
    expect(parsed.perSheetCounts.AMAZON).toBe(2);
    expect(parsed.perSheetCounts.BM + parsed.perSheetCounts.EBAY + parsed.perSheetCounts.ONBUY).toBe(0);
  });

  it('still accepts the legacy "nw" date header on an Amazon file', async () => {
    // `nw` was a typo in the original operator workbook that became the
    // schema by accident. Templates now emit `Date`, but every file already
    // on disk says `nw` — rejecting those would strand years of history.
    const file = workbook('AMAZON', AMAZON_HEADERS_LEGACY_NW, [
      amazonRow('AMZ-5101', '350100000000000', 320, 425),
    ]);

    const parsed = await parseSalesWorkbook(file, 'legacy-amazon.xlsx', { onlyMarketplace: 'AMAZON' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.sales).toHaveLength(1);
    // The date has to actually parse — a dropped date header would leave the
    // row valid-looking but undated, and undated sales fall out of every
    // period figure on every screen.
    expect(parsed.sales[0].saleDate).toBe('2026-07-20');
  });

  it('reads both header spellings to the same record id', async () => {
    // Same order, one file each way. If the ids differed, an operator with a
    // mix of old and new files would silently double-count every sale.
    const mk = (headers: string[]) =>
      workbook('AMAZON', headers, [amazonRow('AMZ-5202', '350100000007919', 300, 400)]);

    const modern = await parseSalesWorkbook(mk(AMAZON_HEADERS), 'new.xlsx', { onlyMarketplace: 'AMAZON' });
    const legacy = await parseSalesWorkbook(mk(AMAZON_HEADERS_LEGACY_NW), 'old.xlsx', { onlyMarketplace: 'AMAZON' });

    expect(legacy.sales[0].id).toBe(modern.sales[0].id);
    expect(legacy.sales[0].saleDate).toBe(modern.sales[0].saleDate);
    expect(legacy.sales[0].salePrice).toBe(modern.sales[0].salePrice);
  });

  it('uses the first sheet when it is not named after the marketplace', async () => {
    // What a raw channel export actually looks like.
    const file = workbook('Sheet1', AMAZON_HEADERS, [amazonRow('AMZ-6001', '350100000015838', 300, 400)]);

    const parsed = await parseSalesWorkbook(file, 'export.xlsx', { onlyMarketplace: 'AMAZON' });

    expect(parsed.errors.filter(e => /missing from workbook/.test(e.message))).toEqual([]);
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].marketplace).toBe('AMAZON');
  });

  it('applies the chosen marketplace layout, not a guess from the sheet name', async () => {
    // OnBuy has no Quantity column, so BP/SP sit one position left. Parsed
    // as OnBuy the money is right; the layout comes from the operator's
    // choice, which is the whole point of picking a channel.
    const file = workbook('Sheet1', ONBUY_HEADERS, [onbuyRow('OB-9001', '350100000023757', 275, 359)]);

    const parsed = await parseSalesWorkbook(file, 'onbuy.xlsx', { onlyMarketplace: 'ONBUY' });

    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].marketplace).toBe('ONBUY');
    expect(parsed.sales[0].buyPrice).toBe(275);
    expect(parsed.sales[0].salePrice).toBe(359);
  });

  it('still recomputes derived financials for a single-channel upload', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [amazonRow('AMZ-7001', '350100000031676', 200, 320)]);
    const parsed = await parseSalesWorkbook(file, 'amazon.xlsx', { onlyMarketplace: 'AMAZON' });
    const sale = parsed.sales[0];
    expect(sale.commission).toBeGreaterThan(0);
    expect(sale.grossProfit).toBeLessThan(sale.salePrice - sale.buyPrice);
  });

  it('produces IDs identical to the combined-workbook path, so re-uploads dedupe', async () => {
    const single = workbook('AMAZON', AMAZON_HEADERS, [amazonRow('AMZ-8001', '350100000039595', 210, 330)]);
    const fromSingle = await parseSalesWorkbook(single, 'a.xlsx', { onlyMarketplace: 'AMAZON' });

    const combined = workbook('AMAZON', AMAZON_HEADERS, [amazonRow('AMZ-8001', '350100000039595', 210, 330)]);
    const fromCombined = await parseSalesWorkbook(combined, 'a.xlsx');

    expect(fromSingle.sales[0].id).toBe(fromCombined.sales[0].id);
    // Uploading the Amazon file today and the combined file tomorrow must
    // update the same record, not create a second one.
    expect(fromSingle.sales[0].id).toBe('AMAZON__AMZ-8001__350100000039595');
  });

  it('reports a row error rather than silently dropping a bad row', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [
      amazonRow('AMZ-9001', '350100000047514', 200, 300),
      ['2026-07-20', '', 'SKU', '', 'SUP', 1, 200, 300, '', '', '', 8, '', '', ''],  // no order, no IMEI
    ]);
    const parsed = await parseSalesWorkbook(file, 'amazon.xlsx', { onlyMarketplace: 'AMAZON' });
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.errors.some(e => e.row > 0)).toBe(true);
  });

  it('parses a TEMU-only file with no "missing sheet" noise', async () => {
    const file = workbook('TEMU', TEMU_HEADERS, [
      temuRow('PO-210-07053322437751959', '350901801557294', 100, 119.33),
    ]);
    const parsed = await parseSalesWorkbook(file, 'temu.xlsx', { onlyMarketplace: 'TEMU' });

    expect(parsed.errors).toEqual([]);
    expect(parsed.sales).toHaveLength(1);
    expect(parsed.sales[0].marketplace).toBe('TEMU');
    expect(parsed.sales[0].buyPrice).toBe(100);
    expect(parsed.sales[0].salePrice).toBe(119.33);
    expect(parsed.perSheetCounts.TEMU).toBe(1);
    expect(parsed.perSheetCounts.AMAZON + parsed.perSheetCounts.BM
      + parsed.perSheetCounts.EBAY + parsed.perSheetCounts.ONBUY).toBe(0);
  });

  it('recomputes TEMU financials to the sheet-verified numbers on import', async () => {
    const file = workbook('TEMU', TEMU_HEADERS, [
      temuRow('PO-210-07053322437751959', '350901801557294', 100, 119.33),
    ]);
    const parsed = await parseSalesWorkbook(file, 'temu.xlsx', { onlyMarketplace: 'TEMU' });
    const sale = parsed.sales[0];
    expect(sale.commission).toBeCloseTo(8.3531, 2);
    expect(sale.grossProfit).toBeCloseTo(0.4546, 1);
    // The fixed Temu rule — no VAT on commission or postage, no DSF.
    expect(sale.commissionVat ?? 0).toBe(0);
    expect(sale.dsf ?? 0).toBe(0);
    expect(sale.postageVat ?? 0).toBe(0);
  });
});

describe('combined workbook is unchanged', () => {
  it('still reports the marketplaces a combined file is missing', async () => {
    const file = workbook('AMAZON', AMAZON_HEADERS, [amazonRow('AMZ-1', '350100000055433', 200, 300)]);
    const parsed = await parseSalesWorkbook(file, 'combined.xlsx');
    const missing = parsed.errors.filter(e => /missing from workbook/.test(e.message)).map(e => e.sheet);
    expect(missing.sort()).toEqual(['BM', 'EBAY', 'ONBUY', 'TEMU']);
  });
});
