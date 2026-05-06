/**
 * Generates sample-data.xlsx for testing the InventoryManager import flow.
 * Run with: npx tsx scripts/generateSampleData.ts
 *
 * Produces 4 sheets:
 *   BUY_IMEI  — IMEI-per-row format (stock in + sold history)
 *   BUY_BULK  — Bulk/batch format   (from supplier invoice)
 *   SHS       — Supplier-held stock (bulk format with QTY = SHS)
 *   RETURNS   — Reference sheet     (returns are processed in the UI, not imported)
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ───────────────────────────────────────────────────────────────────

function row(...cells: (string | number | null)[]): (string | number | null)[] {
  return cells;
}

function headerRow(cells: string[]): string[] {
  return cells;
}

function sectionHeader(label: string, cols: number): (string | null)[] {
  return [label, ...Array(cols - 1).fill(null)];
}

function styleSheet(ws: XLSX.WorkSheet, headerRow: number, totalCols: number) {
  // Set column widths
  ws['!cols'] = Array(totalCols).fill({ wch: 22 });
  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: headerRow };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 1 — BUY_IMEI  (recommended going-forward format)
// The ImportModal's "IMEI per row" parser reads this.
// Status=available → stock in office
// Status=sold      → historical sale record
// ─────────────────────────────────────────────────────────────────────────────

const BUY_IMEI_HEADERS = [
  'Date In',       // When unit arrived in office  (YYYY-MM-DD or DD/MM/YYYY)
  'Model',         // Full model string             e.g. "iPhone 15 Pro Max 256GB"
  'IMEI',          // 15-digit IMEI or serial       leave blank for SHS units
  'Supplier',      // Supplier name                 auto-creates supplier record
  'Buy Price',     // What you paid (£)             numbers only
  'Colour',        // Colour name                   e.g. "Natural Titanium"
  'Storage',       // Storage size                  e.g. "256GB" (optional)
  'Status',        // available / sold              leave blank = available
  'Sale Platform', // eBay / Amazon / OnBuy / Backmarket / Other  (sold rows only)
  'Sale Price',    // Sale amount (£)               (sold rows only)
  'Sale Date',     // Date sold (YYYY-MM-DD)        (sold rows only)
  'Sale Order ID', // Platform order number         e.g. 12-34567-89012
  'Notes',         // Free-text notes               optional
];

const BUY_IMEI_ROWS = [
  // ── Available Stock (units currently in office) ────────────────────────────
  row('2026-04-01', 'iPhone 15 Pro Max 256GB',        '353209102768686', 'TechSource Ltd',  800, 'Natural Titanium', '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-01', 'iPhone 15 Pro Max 256GB',        '357883401512577', 'TechSource Ltd',  820, 'Black Titanium',   '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-01', 'iPhone 15 Pro Max 512GB',        '352344113462551', 'TechSource Ltd',  950, 'White Titanium',   '512GB', 'available', null,         null, null,         null,               null),
  row('2026-04-03', 'iPhone 15 Pro 128GB',            '356789012345678', 'MHL Direct',      650, 'Blue Titanium',    '128GB', 'available', null,         null, null,         null,               null),
  row('2026-04-03', 'iPhone 15 Pro 128GB',            '354321098765432', 'MHL Direct',      660, 'Natural Titanium', '128GB', 'available', null,         null, null,         null,               'Box missing'),
  row('2026-04-05', 'iPhone 14 Pro Max 256GB',        '351234567890123', 'IMAX Wholesale',  580, 'Space Black',      '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-05', 'iPhone 14 Pro Max 256GB',        '351234567890124', 'IMAX Wholesale',  575, 'Gold',             '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-08', 'Samsung Galaxy S24 Ultra 256GB', '356123456789001', 'IMAX Wholesale',  680, 'Titanium Black',   '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-08', 'Samsung Galaxy S24 Ultra 256GB', '356123456789002', 'IMAX Wholesale',  680, 'Titanium Gray',    '256GB', 'available', null,         null, null,         null,               'Minor scratch on back'),
  row('2026-04-08', 'Samsung Galaxy S24 Ultra 512GB', '356123456789003', 'IMAX Wholesale',  750, 'Titanium Violet',  '512GB', 'available', null,         null, null,         null,               null),
  row('2026-04-10', 'Samsung Galaxy S24+ 256GB',      '356123456789004', 'PhoneMart UK',    520, 'Marble Gray',      '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-10', 'Samsung Galaxy A54 256GB',       '359876543210987', 'PhoneMart UK',    210, 'Awesome Violet',   '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-10', 'Samsung Galaxy A54 256GB',       '359876543210988', 'PhoneMart UK',    210, 'Awesome Black',    '256GB', 'available', null,         null, null,         null,               null),
  row('2026-04-12', 'iPhone 15 128GB',                '358765432109000', 'TechSource Ltd',  550, 'Pink',             '128GB', 'available', null,         null, null,         null,               null),
  row('2026-04-12', 'iPhone 15 128GB',                '358765432109001', 'TechSource Ltd',  550, 'Yellow',           '128GB', 'available', null,         null, null,         null,               null),
  row('2026-04-15', 'iPad Pro 11" M2 256GB',          'NL6CMQCYTD',      'TechSource Ltd',  700, 'Silver',           '256GB', 'available', null,         null, null,         null,               'Tablet serial number'),
  row('2026-04-15', 'iPad Air M1 64GB',               'DMPH4RYJPF',      'MHL Direct',      450, 'Starlight',        '64GB',  'available', null,         null, null,         null,               null),

  // ── Sold History (historical sales records) ────────────────────────────────
  row('2026-03-15', 'iPhone 15 Pro Max 256GB',        '353209100000001', 'TechSource Ltd',  800, 'Natural Titanium', '256GB', 'sold',      'eBay',       980, '2026-03-20', '12-34567-89012',   null),
  row('2026-03-15', 'iPhone 15 Pro 256GB',            '353209100000002', 'TechSource Ltd',  720, 'Blue Titanium',    '256GB', 'sold',      'Amazon',     880, '2026-03-22', '202-1234567-8901', null),
  row('2026-03-18', 'Samsung Galaxy S24 Ultra 256GB', '356100000000001', 'IMAX Wholesale',  660, 'Titanium Black',   '256GB', 'sold',      'Backmarket', 810, '2026-03-25', 'BM-456789',        null),
  row('2026-03-20', 'iPhone 14 256GB',                '351000000000001', 'MHL Direct',      480, 'Midnight',         '256GB', 'sold',      'eBay',       620, '2026-03-26', '12-77654-32109',   null),
  row('2026-03-22', 'iPhone 14 256GB',                '351000000000002', 'MHL Direct',      475, 'Purple',           '256GB', 'sold',      'OnBuy',      610, '2026-03-28', 'OB-112233',        null),
  row('2026-04-01', 'Samsung Galaxy A54 128GB',       '359000000000001', 'PhoneMart UK',    195, 'Awesome Black',    '128GB', 'sold',      'eBay',       290, '2026-04-05', '12-99887-76655',   null),
];

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 2 — BUY_BULK  (matches the Indian team's old supplier-invoice style)
// The ImportModal's "client-bulk" parser reads this.
// One row = one model line; Colour column encodes quantity per colour.
// ─────────────────────────────────────────────────────────────────────────────

const BUY_BULK_HEADERS = [
  'Model',         // Full model string             e.g. "iPhone 15 Pro Max 256GB"
  'BP',            // Buy price (£)                 one price for all units in this row
  'Quantity',      // Total units                   numeric, or "SHS" for supplier stock
  'Colour',        // "COLOUR QTY COLOUR QTY"       e.g. "BLACK 5 WHITE 3 GOLD 2"
  'Supplier',      // Supplier name
  'Notes',         // Any note for this batch line
];

const BUY_BULK_ROWS = [
  // Each row creates N units (one per colour slot)
  row('iPhone 15 Pro Max 256GB',        800,  10, 'NATURAL 4 BLACK 3 WHITE 2 BLUE 1', 'TechSource Ltd',  null),
  row('iPhone 15 Pro Max 512GB',        950,  5,  'NATURAL 3 BLACK 2',                'TechSource Ltd',  'All boxed'),
  row('iPhone 15 Pro 128GB',            650,  8,  'BLUE 4 NATURAL 4',                 'MHL Direct',      null),
  row('iPhone 15 128GB',                540,  12, 'PINK 5 YELLOW 4 BLACK 3',          'MHL Direct',      null),
  row('iPhone 14 Pro Max 256GB',        575,  6,  'SPACE BLACK 3 GOLD 2 SILVER 1',    'IMAX Wholesale',  null),
  row('iPhone 14 Pro 128GB',            500,  4,  'SPACE BLACK 2 GOLD 2',             'IMAX Wholesale',  null),
  row('Samsung Galaxy S24 Ultra 256GB', 680,  8,  'TITANIUM BLACK 4 TITANIUM GRAY 3 TITANIUM VIOLET 1', 'IMAX Wholesale', null),
  row('Samsung Galaxy S24+ 256GB',      520,  6,  'MARBLE GRAY 3 AMBER YELLOW 3',     'PhoneMart UK',    null),
  row('Samsung Galaxy A54 256GB',       210,  15, 'AWESOME BLACK 5 AWESOME VIOLET 5 WHITE 5', 'PhoneMart UK', null),
  row('Samsung Galaxy A34 128GB',       160,  10, 'AWESOME BLACK 5 AWESOME LIME 5',   'PhoneMart UK',    null),
];

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 3 — SHS  (Supplier-Held Stock)
// Uses the bulk format; QTY = "SHS" tells the importer these have no IMEI yet.
// Units get status=incoming; IMEI entered manually when received.
// ─────────────────────────────────────────────────────────────────────────────

const SHS_HEADERS = [
  'Model',         // Full model string
  'BP',            // Agreed buy price (£)          what you will pay per unit
  'Quantity',      // Must be "SHS"                 tells the app: supplier holds this
  'Colour',        // Colour(s)                     "BLACK RED WHITE" space-separated
  'Supplier',      // Which supplier holds the stock
  'Notes',         // e.g. "Ordered 2026-05-01, ETA 2 weeks"
];

const SHS_ROWS = [
  // QTY = "SHS" — these get status=incoming; no IMEI until received
  row('iPhone 16 Pro Max 256GB',        920,  'SHS', 'DESERT TITANIUM BLACK TITANIUM WHITE TITANIUM', 'TechSource Ltd',  'Pre-ordered, ETA 2 weeks'),
  row('iPhone 16 Pro Max 512GB',        1050, 'SHS', 'DESERT TITANIUM BLACK TITANIUM',                'TechSource Ltd',  'Pre-ordered'),
  row('iPhone 16 Pro 128GB',            750,  'SHS', 'DESERT TITANIUM WHITE TITANIUM',                'MHL Direct',      null),
  row('Samsung Galaxy S25 Ultra 256GB', 800,  'SHS', 'TITANIUM SILVERBLUE TITANIUM BLACK',            'IMAX Wholesale',  'Awaiting stock from supplier'),
  row('Samsung Galaxy S25+ 256GB',      600,  'SHS', 'ICY BLUE SILVER SHADOW',                        'IMAX Wholesale',  null),
];

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 4 — RETURNS (reference / documentation only)
// Returns are processed through the app UI (not imported).
// This sheet shows the data the UI collects when processing a return.
// ─────────────────────────────────────────────────────────────────────────────

const RETURNS_HEADERS = [
  'IMEI',          // The sold unit's IMEI          used to look up the unit in the app
  'Model',         // For reference
  'Return Date',   // When customer returned it
  'Return Type',   // returned_to_inventory / returned_to_supplier / repair
  'Return Reason', // Free text
  'Sale Order ID', // The original order number
  'Notes',
];

const RETURNS_ROWS = [
  // returned_to_inventory → unit goes back to available stock, sale data cleared
  row('353209100000001', 'iPhone 15 Pro Max 256GB',        '2026-03-28', 'returned_to_inventory', 'Customer changed mind',         '12-34567-89012',   'Condition: like new'),
  // returned_to_supplier → unit is DELETED from inventory (gone from stock)
  row('353209100000002', 'iPhone 15 Pro 256GB',            '2026-03-30', 'returned_to_supplier',  'Faulty face ID',                '202-1234567-8901', 'Sent back to TechSource'),
  // repair → unit gets status=returned, stays in system for tracking
  row('356100000000001', 'Samsung Galaxy S24 Ultra 256GB', '2026-04-02', 'repair',                'Cracked screen on arrival',     'BM-456789',        'Sent to repair centre'),
  row('351000000000001', 'iPhone 14 256GB',                '2026-04-03', 'returned_to_inventory', 'Wrong colour delivered by us',  '12-77654-32109',   null),
];

// ─────────────────────────────────────────────────────────────────────────────
// Sheet 5 — COLUMN GUIDE (human-readable reference)
// ─────────────────────────────────────────────────────────────────────────────

const GUIDE_ROWS = [
  ['SHEET',          'COLUMN',        'REQUIRED', 'ACCEPTED VALUES / FORMAT',                                       'NOTES'],
  // ── BUY_IMEI ──────────────────────────────────────────────────────────────
  ['BUY_IMEI',       'Date In',       'Optional', 'YYYY-MM-DD  or  DD/MM/YYYY',                                     'Defaults to today if blank'],
  ['BUY_IMEI',       'Model',         'Required', 'iPhone 15 Pro Max 256GB  /  Samsung Galaxy S24 Ultra 256GB',     'Full model string — drives the periodic table grouping'],
  ['BUY_IMEI',       'IMEI',          'Optional', '15-digit number  or  tablet serial (alphanumeric)',              'Leave blank for SHS/incoming units'],
  ['BUY_IMEI',       'Supplier',      'Optional', 'Any text',                                                       'Auto-creates supplier record if new'],
  ['BUY_IMEI',       'Buy Price',     'Required', 'Number  e.g. 800',                                               'Whole number or decimal, no £ symbol'],
  ['BUY_IMEI',       'Colour',        'Optional', 'Natural Titanium  /  Black Titanium  /  Phantom Black',          'Defaults to "Unknown" if blank'],
  ['BUY_IMEI',       'Storage',       'Optional', '64GB / 128GB / 256GB / 512GB / 1TB',                            'For display only'],
  ['BUY_IMEI',       'Status',        'Optional', 'available   OR   sold',                                          'Defaults to "available". Use "sold" to migrate sales history'],
  ['BUY_IMEI',       'Sale Platform', 'Optional', 'eBay / Amazon / OnBuy / Backmarket / Other',                    'Only fill for status=sold rows'],
  ['BUY_IMEI',       'Sale Price',    'Optional', 'Number  e.g. 950',                                               'Only fill for status=sold rows'],
  ['BUY_IMEI',       'Sale Date',     'Optional', 'YYYY-MM-DD',                                                     'Only fill for status=sold rows'],
  ['BUY_IMEI',       'Sale Order ID', 'Optional', '12-34567-89012  /  202-1234567-89012',                           'Platform order number, for sold rows'],
  ['BUY_IMEI',       'Notes',         'Optional', 'Any text',                                                       'e.g. "Box missing", "Minor scratch"'],
  [null, null, null, null, null],
  // ── BUY_BULK ──────────────────────────────────────────────────────────────
  ['BUY_BULK',       'Model',         'Required', 'iPhone 15 Pro Max 256GB',                                        'One row = one model line from the invoice'],
  ['BUY_BULK',       'BP',            'Required', 'Number  e.g. 800',                                               'Buy price per unit'],
  ['BUY_BULK',       'Quantity',      'Required', 'Number  e.g. 10   OR   "SHS" for supplier-held stock',           '"SHS" creates incoming units with no IMEI'],
  ['BUY_BULK',       'Colour',        'Required', 'BLACK 5 WHITE 3 GOLD 2',                                         'COLOUR QTY pairs separated by space. Total should match Quantity'],
  ['BUY_BULK',       'Supplier',      'Optional', 'Any text',                                                       'Auto-creates supplier'],
  ['BUY_BULK',       'Notes',         'Optional', 'Any text',                                                       null],
  [null, null, null, null, null],
  // ── SHS ───────────────────────────────────────────────────────────────────
  ['SHS',            'Model',         'Required', 'iPhone 16 Pro Max 256GB',                                        'Same as BUY_BULK'],
  ['SHS',            'BP',            'Required', 'Number',                                                          'Agreed price with supplier'],
  ['SHS',            'Quantity',      'Required', 'SHS',                                                             'Always "SHS" — creates incoming/supplier-held units'],
  ['SHS',            'Colour',        'Optional', 'DESERT TITANIUM BLACK TITANIUM WHITE TITANIUM',                  'Space-separated colour names, no qty needed'],
  ['SHS',            'Supplier',      'Required', 'Supplier name',                                                   'Who holds the stock'],
  ['SHS',            'Notes',         'Optional', 'Pre-ordered, ETA 2 weeks',                                       null],
  [null, null, null, null, null],
  // ── RETURNS ───────────────────────────────────────────────────────────────
  ['RETURNS',        '— NOTE —',      null,       'Returns are processed in the app UI, not via Excel import',       'Go to Returns page → Process New Return → search sold unit → select type'],
  ['RETURNS',        'Return Type',   'Required', 'returned_to_inventory / returned_to_supplier / repair',          '"returned_to_supplier" DELETES the unit from stock permanently'],
  ['RETURNS',        'Return Reason', 'Required', 'Free text',                                                       'e.g. "Customer changed mind", "Faulty screen"'],
];

// ─────────────────────────────────────────────────────────────────────────────
// Build workbook
// ─────────────────────────────────────────────────────────────────────────────

const wb = XLSX.utils.book_new();

// Sheet 1: BUY_IMEI
const ws1 = XLSX.utils.aoa_to_sheet([BUY_IMEI_HEADERS, ...BUY_IMEI_ROWS]);
ws1['!cols'] = BUY_IMEI_HEADERS.map((_, i) => ({ wch: i === 1 ? 30 : i >= 8 ? 18 : 22 }));
ws1['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws1, 'BUY_IMEI');

// Sheet 2: BUY_BULK
const ws2 = XLSX.utils.aoa_to_sheet([BUY_BULK_HEADERS, ...BUY_BULK_ROWS]);
ws2['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 42 }, { wch: 20 }, { wch: 20 }];
ws2['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws2, 'BUY_BULK');

// Sheet 3: SHS
const ws3 = XLSX.utils.aoa_to_sheet([SHS_HEADERS, ...SHS_ROWS]);
ws3['!cols'] = [{ wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 50 }, { wch: 20 }, { wch: 30 }];
ws3['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws3, 'SHS');

// Sheet 4: RETURNS (reference)
const ws4 = XLSX.utils.aoa_to_sheet([RETURNS_HEADERS, ...RETURNS_ROWS]);
ws4['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 26 }, { wch: 30 }, { wch: 20 }, { wch: 25 }];
ws4['!freeze'] = { xSplit: 0, ySplit: 1 };
XLSX.utils.book_append_sheet(wb, ws4, 'RETURNS');

// Sheet 5: COLUMN GUIDE
const ws5 = XLSX.utils.aoa_to_sheet(GUIDE_ROWS);
ws5['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 55 }, { wch: 45 }];
XLSX.utils.book_append_sheet(wb, ws5, 'COLUMN GUIDE');

// Write file
const outPath = path.join(__dirname, '..', 'public', 'sample-data.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`✓ Written: ${outPath}`);
console.log(`  BUY_IMEI  : ${BUY_IMEI_ROWS.length} rows (${BUY_IMEI_ROWS.filter(r => r[7] === 'available').length} available, ${BUY_IMEI_ROWS.filter(r => r[7] === 'sold').length} sold)`);
console.log(`  BUY_BULK  : ${BUY_BULK_ROWS.length} model lines`);
console.log(`  SHS       : ${SHS_ROWS.length} supplier-held lines`);
console.log(`  RETURNS   : ${RETURNS_ROWS.length} example return records`);
