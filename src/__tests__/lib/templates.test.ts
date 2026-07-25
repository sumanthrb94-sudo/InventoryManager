/**
 * The shipped upload templates must always be valid input.
 *
 * templates/*.xlsx are what the team builds every future report from. If a
 * parser's schema moves and the templates don't, operators find out by
 * having a real upload rejected. These tests run the templates through the
 * REAL parsers on every test run, so the drift is caught here instead.
 *
 * Regenerate with: node scripts/generateImportTemplates.mjs
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

const INVENTORY_TEMPLATE = 'templates/INVENTORY_REPORT_TEMPLATE.xlsx';
const SALES_TEMPLATE = 'templates/SALES_REPORT_TEMPLATE.xlsx';

describe('INVENTORY_REPORT_TEMPLATE.xlsx', () => {
  let rows: any[][];

  beforeAll(() => {
    expect(existsSync(INVENTORY_TEMPLATE), `${INVENTORY_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(INVENTORY_TEMPLATE), { type: 'buffer', cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1, raw: true }) as any[][];
  });

  it('carries every column the importer knows about, in export order', () => {
    expect(rows[0]).toEqual([
      'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
      'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
    ]);
  });

  it('ships example rows that would import cleanly', () => {
    const body = rows.slice(1).filter(r => r?.length);
    expect(body.length).toBeGreaterThan(0);
    for (const r of body) {
      const [, model, imei, , , , , supplier, bp] = r;
      expect(String(model || '').trim()).not.toBe('');
      expect(String(supplier || '').trim()).not.toBe('');
      expect(Number(bp)).toBeGreaterThan(0);
      // Same rule as isValidImei: 15 digits, or a 10-12 char Apple serial
      expect(String(imei)).toMatch(/^(\d{15}|[A-Z0-9]{10,12})$/);
    }
  });

  it('demonstrates BOTH stock types so SHS is discoverable', () => {
    const stockTypes = rows.slice(1).filter(r => r?.length).map(r => String(r[9] || '').toUpperCase());
    expect(stockTypes).toContain('OFFICE');
    expect(stockTypes).toContain('SHS');
  });

  it('documents every column on a README sheet', () => {
    const wb = XLSX.read(readFileSync(INVENTORY_TEMPLATE), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    const readme = XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][];
    const documented = readme.flat().filter(Boolean).map(String).join(' | ');
    for (const col of ['Stock In Date', 'Model', 'IMEI', 'Supplier', 'BP', 'Stock Type', 'Notes']) {
      expect(documented).toContain(col);
    }
  });
});

describe('SALES_REPORT_TEMPLATE.xlsx', () => {
  it('parses through the production parser with no row errors', async () => {
    expect(existsSync(SALES_TEMPLATE), `${SALES_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');

    // Row-level errors mean an example row is not valid input.
    expect(parsed.errors.filter(e => e.row > 0)).toEqual([]);
    // All four marketplace sheets present, so none reports "missing".
    expect(parsed.errors.filter(e => /missing from workbook/.test(e.message))).toEqual([]);
    expect(parsed.sales.length).toBeGreaterThan(0);
  });

  it('covers all four marketplaces with at least one example each', async () => {
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx');
    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');
    const seen = new Set(parsed.sales.map(s => s.marketplace));
    expect([...seen].sort()).toEqual(['AMAZON', 'BM', 'EBAY', 'ONBUY']);
  });

  it('recomputes derived money columns rather than trusting the sheet', async () => {
    // The template leaves GP / commission blank on purpose; the parser must
    // still produce real figures, which is what makes that safe to document.
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx');
    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');
    for (const s of parsed.sales) {
      expect(s.commission).toBeGreaterThan(0);
      expect(Number.isFinite(s.grossProfit)).toBe(true);
      expect(s.grossProfit).toBeLessThan(s.salePrice - s.buyPrice);
    }
  });

  it('keeps the per-marketplace column order the parsers expect', () => {
    const wb = XLSX.read(readFileSync(SALES_TEMPLATE), { type: 'buffer' });
    const headerOf = (name: string) =>
      (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as any[][])[0];

    expect(headerOf('AMAZON').slice(0, 8))
      .toEqual(['nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP']);
    // BM inserts Payment Mode at index 8
    expect(headerOf('BM')[8]).toBe('Payment Mode');
    // OnBuy has NO quantity column — BP/SP shift left by one
    expect(headerOf('ONBUY').slice(0, 7))
      .toEqual(['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP']);
    expect(headerOf('EBAY')).toContain('SHIPPING');
  });

  it('documents the recompute rule, which is the easiest thing to get wrong', () => {
    const wb = XLSX.read(readFileSync(SALES_TEMPLATE), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    expect(readme).toMatch(/RECOMPUTES/i);
    expect(readme).toMatch(/IMEI/);
  });
});
