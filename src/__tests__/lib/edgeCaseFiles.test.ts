/**
 * The edge-case workbooks must behave exactly as their rows claim.
 *
 * Each row in templates/samples/*_EDGE_CASES.xlsx carries its expected
 * outcome in the Notes / Comments cell — "REJECTED — BP must be greater
 * than 0", "BULK — splits into 2 rows", and so on. A file that documents
 * behaviour it doesn't actually produce is worse than no file, so these
 * tests read the labels and check the parsers agree with them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';

const INV_EDGE = 'templates/samples/INVENTORY_EDGE_CASES.xlsx';
const SALES_EDGE = 'templates/samples/SALES_EDGE_CASES.xlsx';

/** Mirrors InventoryReportImport.parseSheet's row validation. */
function inventoryRowErrors(row: any[]): string[] {
  const errors: string[] = [];
  const model = String(row[1] ?? '').trim();
  const imei = String(row[2] ?? '').trim().toUpperCase();
  const supplier = String(row[7] ?? '').trim();
  const bp = Number(row[8] ?? 0);
  if (!model) errors.push('Model is required');
  if (!imei) errors.push('IMEI is required');
  else if (!/^(\d{15}|[A-Z0-9]{10,12})$/.test(imei)) errors.push('IMEI not valid');
  if (!supplier) errors.push('Supplier is required');
  if (!(bp > 0)) errors.push('BP must be greater than 0');
  return errors;
}

describe('INVENTORY_EDGE_CASES.xlsx', () => {
  let rows: any[][];

  it('exists and carries a labelled row per scenario', () => {
    expect(existsSync(INV_EDGE), `${INV_EDGE} missing — run scripts/generateE2EWorkbooks.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(INV_EDGE), { type: 'buffer' });
    rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    expect(rows.length).toBeGreaterThan(8);
    for (const r of rows) expect(String(r[10] ?? '').trim()).not.toBe('');
  });

  it('every row labelled VALID actually passes validation', () => {
    const wb = XLSX.read(readFileSync(INV_EDGE), { type: 'buffer' });
    rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    for (const r of rows) {
      const label = String(r[10]);
      if (!/^VALID/.test(label)) continue;
      expect(inventoryRowErrors(r), `row labelled "${label}" should pass`).toEqual([]);
    }
  });

  it('every row labelled REJECTED actually fails, for the stated reason', () => {
    const wb = XLSX.read(readFileSync(INV_EDGE), { type: 'buffer' });
    rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    const rejected = rows.filter(r => /^REJECTED/.test(String(r[10])));
    expect(rejected.length).toBeGreaterThan(3);
    for (const r of rejected) {
      const label = String(r[10]);
      const errors = inventoryRowErrors(r);
      expect(errors.length, `row labelled "${label}" should fail`).toBeGreaterThan(0);
      // The label names the field; the validator must agree.
      if (/Model/i.test(label)) expect(errors.join(' ')).toMatch(/Model/i);
      if (/Supplier/i.test(label)) expect(errors.join(' ')).toMatch(/Supplier/i);
      if (/BP/i.test(label)) expect(errors.join(' ')).toMatch(/BP/i);
      if (/IMEI/i.test(label)) expect(errors.join(' ')).toMatch(/IMEI/i);
    }
  });

  it('accepts an Apple alphanumeric serial where the label says it should', () => {
    const wb = XLSX.read(readFileSync(INV_EDGE), { type: 'buffer' });
    const row = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).find(r => /Apple alphanumeric serial/i.test(String(r?.[10] ?? '')));
    expect(row).toBeDefined();
    expect(inventoryRowErrors(row!)).toEqual([]);
  });

  it('carries a duplicate IMEI so the preview dupe check has something to catch', () => {
    const wb = XLSX.read(readFileSync(INV_EDGE), { type: 'buffer' });
    const imeis = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).map(r => String(r[2] ?? '').trim()).filter(Boolean);
    expect(imeis.length).toBeGreaterThan(new Set(imeis).size);
  });
});

describe('SALES_EDGE_CASES.xlsx', () => {
  it('parses through the production parser', async () => {
    expect(existsSync(SALES_EDGE), `${SALES_EDGE} missing — run scripts/generateE2EWorkbooks.mjs`).toBe(true);
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    expect(parsed.sales.length).toBeGreaterThan(5);
  });

  it('rejects exactly the rows labelled REJECTED', async () => {
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    const wb = XLSX.read(readFileSync(SALES_EDGE), { type: 'buffer' });
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets['AMAZON'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    const rejectedCount = rows.filter(r => /^REJECTED/.test(String(r[14] ?? ''))).length;

    expect(rejectedCount).toBe(3);   // no order+imei, bad date, missing BP
    expect(parsed.errors.filter(e => e.row > 0).length).toBe(rejectedCount);
  });

  it('splits the bulk multi-IMEI row into one sale per phone, halving BP and SP', async () => {
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    const bulk = parsed.sales.filter(s => s.orderNumber === 'EDGE-4');
    expect(bulk).toHaveLength(2);
    expect(bulk.map(s => s.imei).sort()).toEqual(['350190000000101', '350190000000102']);
    // 960 / 2 and 1300 / 2 — the order total is preserved across the split.
    expect(bulk[0].buyPrice).toBe(480);
    expect(bulk[0].salePrice).toBe(650);
    expect(bulk.reduce((n, s) => n + s.salePrice, 0)).toBe(1300);
  });

  it('collapses the duplicated order to a single record', async () => {
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    const ids = parsed.sales.filter(s => s.orderNumber === 'EDGE-1').map(s => s.id);
    // The parser emits both rows; they share one id, so the write dedupes.
    expect(new Set(ids).size).toBe(1);
  });

  it('keeps the no-IMEI row as a sale that simply cannot match a unit', async () => {
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    const noImei = parsed.sales.find(s => s.orderNumber === 'EDGE-5');
    expect(noImei).toBeDefined();
    expect(noImei!.imei ?? '').toBe('');
  });

  it('accepts a blank postage cell', async () => {
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(SALES_EDGE)], 'SALES_EDGE_CASES.xlsx'),
      'SALES_EDGE_CASES.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    expect(parsed.sales.find(s => s.orderNumber === 'EDGE-10')).toBeDefined();
  });
});
