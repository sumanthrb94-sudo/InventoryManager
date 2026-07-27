/**
 * The Accessories sheet — the third sheet the Inventory Report exports when
 * any SKU-quantity pools exist, alongside Office Stock and SHS Stock.
 *
 * Distinct schema from the per-unit stock sheets on purpose: an accessory
 * pool has no IMEI at all (the whole point of tracking it separately), so
 * looksLikeAccessoriesSheet must never be confused with looksLikeStockSheet,
 * in either direction — a workbook can carry both sheet types side by side
 * and each must land in its own bucket.
 */
import { describe, it, expect } from 'vitest';
import {
  looksLikeAccessoriesSheet,
  parseAccessoriesSheet,
  looksLikeStockSheet,
  parseStockWorkbook,
} from '../../lib/inventoryImportParse';
import * as XLSX from 'xlsx';

const ACC_HEADER = ['SKU', 'Name', 'Supplier', 'Total Added', 'BP', 'Notes'];
const STOCK_HEADER = [
  'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
  'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
];

describe('looksLikeAccessoriesSheet', () => {
  it('recognises the exported Accessories header', () => {
    expect(looksLikeAccessoriesSheet([ACC_HEADER])).toBe(true);
  });

  it('is case- and whitespace-tolerant, same as the stock header aliases', () => {
    expect(looksLikeAccessoriesSheet([['  sku  ', 'name', 'supplier', 'TOTAL ADDED', 'bp', 'notes']])).toBe(true);
  });

  it('rejects an ordinary stock sheet — no SKU/Total Added columns', () => {
    expect(looksLikeAccessoriesSheet([STOCK_HEADER])).toBe(false);
  });

  it('rejects an empty sheet', () => {
    expect(looksLikeAccessoriesSheet([])).toBe(false);
  });

  it('a stock sheet never satisfies looksLikeAccessoriesSheet, and vice versa', () => {
    expect(looksLikeStockSheet([ACC_HEADER])).toBe(false);
    expect(looksLikeAccessoriesSheet([STOCK_HEADER])).toBe(false);
  });
});

describe('parseAccessoriesSheet', () => {
  it('parses a well-formed row', () => {
    const rows = parseAccessoriesSheet([
      ACC_HEADER,
      ['USB-C-20W', 'USB-C 20W Charger', 'MOBILE WHOLESALE LTD', 48, 3.5, 'fast charge'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sku: 'USB-C-20W',
      name: 'USB-C 20W Charger',
      supplier: 'MOBILE WHOLESALE LTD',
      totalReceived: 48,
      buyPrice: 3.5,
      notes: 'fast charge',
    });
  });

  it('skips a fully blank row', () => {
    const rows = parseAccessoriesSheet([ACC_HEADER, ['', '', '', '', '', '']]);
    expect(rows).toHaveLength(0);
  });

  it('skips a row with no SKU — nothing to restore against', () => {
    const rows = parseAccessoriesSheet([ACC_HEADER, ['', 'Orphan Name', 'X', 10, 1, '']]);
    expect(rows).toHaveLength(0);
  });

  it('accepts £-formatted BP text, same numeric parsing as the stock sheet', () => {
    const rows = parseAccessoriesSheet([ACC_HEADER, ['SIM-PIN', 'SIM Eject Pin', 'X', 100, '£0.10', '']]);
    expect(rows[0].buyPrice).toBeCloseTo(0.1);
  });

  it('recognises the header alias variants', () => {
    const rows = parseAccessoriesSheet([
      ['Accessory SKU', 'Accessory Name', 'Supplier', 'Total Received', 'Buy Price', 'Note'],
      ['CABLE-1M', 'Lightning Cable 1m', 'X', 20, 1.2, 'bulk'],
    ]);
    expect(rows[0]).toMatchObject({ sku: 'CABLE-1M', name: 'Lightning Cable 1m', totalReceived: 20, buyPrice: 1.2 });
  });
});

describe('parseStockWorkbook — Accessories sheet alongside Office Stock / SHS Stock', () => {
  function buildWorkbook() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      STOCK_HEADER,
      ['2026-07-01', 'IPHONE 14 128GB', '350190000000001', 'A', '128GB', 'Physical SIM', 'BLACK', 'X', 300, 'OFFICE', ''],
    ]), 'Office Stock');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([STOCK_HEADER]), 'SHS Stock');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ACC_HEADER,
      ['USB-C-20W', 'USB-C 20W Charger', 'X', 48, 3.5, ''],
    ]), 'Accessories');
    return wb;
  }

  it('routes unit rows and accessory rows into their own separate buckets', () => {
    const { rows, accessoryRows, skippedSheets } = parseStockWorkbook(buildWorkbook());
    expect(rows).toHaveLength(1);
    expect(rows[0].imei).toBe('350190000000001');
    expect(accessoryRows).toHaveLength(1);
    expect(accessoryRows[0]).toMatchObject({ sku: 'USB-C-20W', totalReceived: 48 });
    // The Accessories sheet must NOT show up as "skipped" — it was read, just
    // into its own bucket, not silently dropped and reported as unreadable.
    expect(skippedSheets).not.toContain('Accessories');
  });

  it('a workbook with only an Accessories sheet still parses (no unit rows required)', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ACC_HEADER,
      ['SIM-PIN', 'SIM Eject Pin', 'X', 100, 0.1, ''],
    ]), 'Accessories');
    const { rows, accessoryRows } = parseStockWorkbook(wb);
    expect(rows).toHaveLength(0);
    expect(accessoryRows).toHaveLength(1);
  });
});
