/**
 * The stock importer reads EVERY sheet, not just the first.
 *
 * The Inventory Report downloads as two sheets — Office Stock and SHS Stock.
 * The importer read `SheetNames[0]` only, so a report downloaded from the app
 * and re-uploaded silently lost every supplier-held row: 120 rows out, 110
 * back in, no warning. That breaks the loop the templates README promises —
 * export → edit in Excel → re-import → same data, no loss.
 *
 * These tests drive the real workbook shapes: the two-sheet report, a
 * single-sheet file (the old shape, which must keep working), and a workbook
 * carrying a non-stock tab that must be skipped rather than parsed into a
 * pile of invalid rows.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseStockWorkbook, looksLikeStockSheet, parseSheet } from '../../lib/inventoryImportParse';

const HEADER = [
  'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
  'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
];

/** One valid stock row. IMEIs are generated so each is unique and 15 digits. */
function row(n: number, stockType: 'OFFICE' | 'SHS') {
  return [
    '2026-01-15', 'IPHONE 13 PRO', String(350100000000000 + n), 'A', '128GB',
    'Physical SIM', 'Graphite', 'MOBILE WHOLESALE LTD', 300, stockType, '',
  ];
}

function workbook(sheets: Array<{ name: string; rows: any[][] }>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  return wb;
}

describe('looksLikeStockSheet', () => {
  it('accepts a sheet whose header names Model and IMEI', () => {
    expect(looksLikeStockSheet([HEADER])).toBe(true);
  });

  it('rejects a Summary tab', () => {
    expect(looksLikeStockSheet([['Marketplace', 'Sales', 'Revenue']])).toBe(false);
  });

  it('rejects a sheet with an IMEI column but no Model', () => {
    // Half a schema is worse than none — the rows would parse with an empty
    // model and land in the invalid bucket, which reads as a data problem
    // rather than "you pointed at the wrong sheet".
    expect(looksLikeStockSheet([['IMEI', 'Notes']])).toBe(false);
  });

  it('rejects an empty sheet', () => {
    expect(looksLikeStockSheet([])).toBe(false);
  });
});

describe('parseStockWorkbook — the two-sheet Inventory Report', () => {
  const wb = workbook([
    { name: 'Office Stock', rows: [HEADER, ...Array.from({ length: 5 }, (_, i) => row(i, 'OFFICE'))] },
    { name: 'SHS Stock',    rows: [HEADER, ...Array.from({ length: 3 }, (_, i) => row(100 + i, 'SHS'))] },
  ]);

  it('reads rows from BOTH sheets', () => {
    const { rows } = parseStockWorkbook(wb);
    expect(rows).toHaveLength(8);
  });

  it('keeps each sheet\'s stock type', () => {
    const { rows } = parseStockWorkbook(wb);
    expect(rows.filter(r => r.stockType === 'office')).toHaveLength(5);
    expect(rows.filter(r => r.stockType === 'shs')).toHaveLength(3);
  });

  it('every row is valid — nothing is lost to a parse error', () => {
    const { rows } = parseStockWorkbook(wb);
    expect(rows.filter(r => r.errors.length > 0)).toEqual([]);
  });

  it('numbers rows continuously across sheets, so no two rows collide', () => {
    // Row numbers drive the duplicate report and the invalid-row list. Two
    // sheets each restarting at row 2 would make "row 2" ambiguous.
    const { rows } = parseStockWorkbook(wb);
    expect(new Set(rows.map(r => r.rowNum)).size).toBe(rows.length);
  });

  it('skips nothing when every sheet is a stock sheet', () => {
    expect(parseStockWorkbook(wb).skippedSheets).toEqual([]);
  });
});

describe('parseStockWorkbook — other workbook shapes', () => {
  it('still reads a single-sheet file, the shape operators had before', () => {
    const wb = workbook([
      { name: 'INVENTORY', rows: [HEADER, row(1, 'OFFICE'), row(2, 'SHS')] },
    ]);
    const { rows, skippedSheets } = parseStockWorkbook(wb);
    expect(rows).toHaveLength(2);
    expect(skippedSheets).toEqual([]);
  });

  it('skips a Summary tab instead of parsing it into invalid rows', () => {
    const wb = workbook([
      { name: 'Summary',      rows: [['Metric', 'Value'], ['Total units', 8]] },
      { name: 'Office Stock', rows: [HEADER, row(1, 'OFFICE')] },
    ]);
    const { rows, skippedSheets } = parseStockWorkbook(wb);
    expect(rows).toHaveLength(1);
    expect(skippedSheets).toEqual(['Summary']);
  });

  it('reports every skipped sheet when nothing parses, so the error can name them', () => {
    const wb = workbook([
      { name: 'Summary', rows: [['Metric', 'Value']] },
      { name: 'Notes',   rows: [['Comment']] },
    ]);
    const { rows, skippedSheets } = parseStockWorkbook(wb);
    expect(rows).toEqual([]);
    expect(skippedSheets).toEqual(['Summary', 'Notes']);
  });
});

describe('the exported report survives a full round trip', () => {
  it('re-reads exactly what a two-sheet download contained', () => {
    // The columns and sheet names below are the ones BuySheet writes.
    const office = Array.from({ length: 110 }, (_, i) => row(i, 'OFFICE'));
    const shs = Array.from({ length: 10 }, (_, i) => row(1000 + i, 'SHS'));
    const wb = workbook([
      { name: 'Office Stock', rows: [HEADER, ...office] },
      { name: 'SHS Stock',    rows: [HEADER, ...shs] },
    ]);

    const { rows } = parseStockWorkbook(wb);
    expect(rows).toHaveLength(120);
    expect(rows.filter(r => r.stockType === 'shs')).toHaveLength(10);

    // Every IMEI comes back, and none is duplicated across the two sheets.
    const imeis = new Set(rows.map(r => r.imei));
    expect(imeis.size).toBe(120);
    for (const r of [...office, ...shs]) expect(imeis.has(String(r[2]))).toBe(true);
  });
});

/**
 * SHS has no IMEI — that is the whole point of it.
 *
 * Supplier-held stock has not shipped. There is no handset in anyone's hand,
 * so there is no IMEI to read off it. The importer demanded one anyway, which
 * made the SHS template unusable for its own purpose: either you could not
 * import at all, or you invented numbers that would never match a real phone.
 *
 * The in-app Add Stock screen always had this right — it says "IMEI optional ·
 * supplier-held" and writes a `manual_shs_*` id with a blank IMEI. Only the
 * importer disagreed.
 */
describe('SHS rows without an IMEI', () => {
  const shsRow = (model: string, imei = '') => [
    '2026-07-20', model, imei, 'A', '256GB',
    'Physical SIM', 'GRAPHITE', 'CELLHUB TRADING', 520, 'SHS', 'awaiting delivery',
  ];
  const officeRow = (model: string, imei = '') => [
    '2026-07-20', model, imei, 'A', '256GB',
    'Physical SIM', 'GRAPHITE', 'CELLHUB TRADING', 520, 'OFFICE', '',
  ];

  it('imports cleanly with the IMEI column blank', () => {
    const [row] = parseSheet([HEADER, shsRow('IPHONE 13 PRO')]);
    expect(row.errors).toEqual([]);
    expect(row.stockType).toBe('shs');
    expect(row.imei).toBe('');
  });

  it('still rejects an OFFICE row with no IMEI', () => {
    // Office stock is on the shelf — if nobody can read an IMEI off it,
    // something is wrong with the row, not with the rule.
    const [row] = parseSheet([HEADER, officeRow('IPHONE 13 PRO')]);
    expect(row.errors).toContain('IMEI is required for office stock');
  });

  it('validates an IMEI the supplier HAS sent', () => {
    // Optional does not mean unchecked. A typo is a typo either way.
    const [row] = parseSheet([HEADER, shsRow('IPHONE 13 PRO', '12345')]);
    expect(row.errors.join(' ')).toMatch(/IMEI not valid/);
  });

  it('accepts a real IMEI on an SHS row when there is one', () => {
    const [row] = parseSheet([HEADER, shsRow('IPHONE 13 PRO', '350100000000001')]);
    expect(row.errors).toEqual([]);
    expect(row.imei).toBe('350100000000001');
  });

  it('treats several identical SHS rows as several phones on order', () => {
    // Ten of the same model from one supplier is an ordinary holding line.
    // Blank IMEIs must not read as duplicates of each other.
    const rows = parseSheet([HEADER, ...Array.from({ length: 5 }, () => shsRow('IPHONE 14'))]);
    expect(rows).toHaveLength(5);
    expect(rows.every(r => r.errors.length === 0)).toBe(true);
  });

  it('still applies every other rule to an SHS row', () => {
    const missing = parseSheet([HEADER, [
      '2026-07-20', '', '', 'A', '256GB', 'Physical SIM', 'GRAPHITE', '', 0, 'SHS', '',
    ]])[0];
    expect(missing.errors).toContain('Model is required');
    expect(missing.errors).toContain('Supplier is required');
    expect(missing.errors).toContain('BP must be greater than 0');
    expect(missing.errors).not.toContain('IMEI is required for office stock');
  });
});
