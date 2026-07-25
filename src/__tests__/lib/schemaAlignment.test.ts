/**
 * Import and export must agree — and the positional fallbacks must agree
 * with the layout they claim to describe.
 *
 * Two separate promises are pinned here.
 *
 * 1. Every positional fallback index points at the column it names, in the
 *    real template. These indices only fire when header matching fails, so a
 *    wrong one is invisible until the day someone uploads a file with a
 *    renamed header — and then it reads the wrong column silently. AMAZON's
 *    `postage` pointed at index 14 (Comments) instead of 11, so a
 *    header-mismatched Amazon file parsed its free-text Comments cell as the
 *    postage cost. parseNumber turns that into 0, overstating GP by exactly
 *    the postage on every row.
 *
 * 2. The inventory EXPORT columns are the import columns, in the same order,
 *    plus derived extras. Matching is by header name so order is not load-
 *    bearing, but an export that can't be read positionally is a trap for
 *    every tool that isn't this importer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { SHEET_LAYOUTS } from '../../lib/salesImport';

const TEMPLATE = resolve('templates/SALES_REPORT_TEMPLATE.xlsx');
const INVENTORY_TEMPLATE = resolve('templates/INVENTORY_REPORT_TEMPLATE.xlsx');

/**
 * What each field's fallback index SHOULD land on in the real template.
 * Checked against the live `SHEET_LAYOUTS` below — the table itself is
 * imported, not copied, so changing an index in salesImport.ts fails here.
 */
const EXPECTED_FALLBACKS: Record<string, Array<[string, number, string]>> = {
  AMAZON: [
    ['date', 0, 'Date'],
    ['orderNumber', 1, 'Order Number'],
    ['sku', 2, 'SKU'],
    ['imei', 3, 'IMEI'],
    ['supplier', 4, 'Supplier'],
    ['quantity', 5, 'Quantity'],
    ['buyPrice', 6, 'BP'],
    ['salePrice', 7, 'SP'],
    ['postage', 11, 'Postage'],
    ['comments', 14, 'Comments'],
  ],
  BM: [
    ['date', 0, 'Date'],
    ['orderNumber', 1, 'Order No'],
    ['sku', 2, 'SKU'],
    ['imei', 3, 'IMEI'],
    ['supplier', 4, 'Supplier'],
    ['quantity', 5, 'Quantity'],
    ['buyPrice', 6, 'BP'],
    ['salePrice', 7, 'SP'],
    ['paymentMode', 8, 'Payment Mode'],
    ['postage', 13, 'Postage'],
    ['comments', 16, 'Comments'],
  ],
  EBAY: [
    ['date', 0, 'DATE'],
    ['orderNumber', 1, 'ORDER NUMBER'],
    ['sku', 2, 'SKU'],
    ['imei', 3, 'IMEI NUMBER'],
    ['supplier', 4, 'SUPPLIER'],
    ['quantity', 5, 'UNITS'],
    ['buyPrice', 6, 'BP'],
    ['salePrice', 7, 'SP'],
    ['shipping', 15, 'SHIPPING'],
    ['netProfit', 18, 'NP(incl. PROMOTION)'],
  ],
  ONBUY: [
    ['date', 0, 'DATE'],
    ['orderNumber', 1, 'Order Number'],
    ['sku', 2, 'SKU'],
    ['imei', 3, 'IMEI'],
    ['supplier', 4, 'Supplier'],
    ['buyPrice', 5, 'BP'],
    ['salePrice', 6, 'SP'],
    ['postage', 11, 'SHIP'],
    ['comments', 14, 'Comments'],
  ],
};

function headerRow(file: string, sheet: string): string[] {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheet], {
    header: 1, raw: false, defval: '',
  });
  return (rows[0] ?? []).map(String);
}

describe.skipIf(!existsSync(TEMPLATE))('sales positional fallbacks point at the right columns', () => {
  for (const [marketplace, fields] of Object.entries(EXPECTED_FALLBACKS)) {
    describe(marketplace, () => {
      const headers = existsSync(TEMPLATE) ? headerRow(TEMPLATE, marketplace) : [];

      const live = SHEET_LAYOUTS[marketplace as keyof typeof SHEET_LAYOUTS].fallback as
        Record<string, number>;

      it.each(fields)('%s falls back to index %i, which is "%s"', (field, index, expected) => {
        // The index the CODE uses, not a copy of it.
        expect(live[field as string]).toBe(index);
        expect(headers[index as number]).toBe(expected);
      });

      it('declares a fallback for every field it can parse', () => {
        expect(Object.keys(live).sort()).toEqual(fields.map(([f]) => f).sort());
      });
    });
  }

  it('no two fields in a layout share a fallback index', () => {
    // AMAZON had postage and comments both on 14. Whichever field is read
    // second silently gets the other one's value.
    for (const [marketplace, layout] of Object.entries(SHEET_LAYOUTS)) {
      const indices = Object.values(layout.fallback as Record<string, number>);
      expect(new Set(indices).size, `${marketplace} has a duplicated fallback index`)
        .toBe(indices.length);
    }
  });

  it('every fallback index is inside its sheet', () => {
    for (const [marketplace, layout] of Object.entries(SHEET_LAYOUTS)) {
      const width = headerRow(TEMPLATE, marketplace).length;
      for (const [field, idx] of Object.entries(layout.fallback as Record<string, number>)) {
        expect(idx, `${marketplace}.${field} points past the last column`).toBeLessThan(width);
      }
    }
  });

  it('ONBUY shifts BP and SP left, because it has no Quantity column', () => {
    const headers = headerRow(TEMPLATE, 'ONBUY');
    expect(headers.map(h => h.toLowerCase())).not.toContain('quantity');
    expect(headers[5]).toBe('BP');
    expect(headers[6]).toBe('SP');
    // Every other marketplace puts BP at 6 — this is the one real trap in
    // the sales schemas, so pin the contrast explicitly.
    expect(headerRow(TEMPLATE, 'AMAZON')[6]).toBe('BP');
  });
});

describe.skipIf(!existsSync(INVENTORY_TEMPLATE))('inventory export mirrors the import schema', () => {
  /** Mirrors INVENTORY_REPORT_COLUMNS in BuySheet.tsx. */
  const EXPORT_COLUMNS = [
    'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour',
    'Supplier', 'BP', 'Stock Type', 'Notes', 'Age (days)',
  ];
  /** Columns the export adds that the importer ignores. */
  const DERIVED_ONLY = ['Age (days)'];

  it('exports every column the import template defines, in the same order', () => {
    const template = headerRow(INVENTORY_TEMPLATE, 'INVENTORY');
    expect(EXPORT_COLUMNS.slice(0, template.length)).toEqual(template);
  });

  it('adds nothing beyond the documented derived columns', () => {
    const template = headerRow(INVENTORY_TEMPLATE, 'INVENTORY');
    const extra = EXPORT_COLUMNS.filter(c => !template.includes(c));
    expect(extra).toEqual(DERIVED_ONLY);
  });

  it('keeps SIM Type before Colour, as the import template does', () => {
    // These were swapped between the two for a while. Nothing broke,
    // because headers are matched by name — but it made the export
    // unreadable positionally, which is how column shifts start.
    expect(EXPORT_COLUMNS.indexOf('SIM Type')).toBeLessThan(EXPORT_COLUMNS.indexOf('Colour'));
    const template = headerRow(INVENTORY_TEMPLATE, 'INVENTORY');
    expect(template.indexOf('SIM Type')).toBeLessThan(template.indexOf('Colour'));
  });
});
