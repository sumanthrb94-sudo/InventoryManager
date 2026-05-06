/**
 * Generates sample-data.xlsx — single master sheet for production use.
 * Run: npx tsx scripts/generateSampleData.ts
 *
 * One sheet ("Master Data") covers all three flows:
 *   status=available  → Buy / Stock In
 *   status=sold       → Sales history
 *   status=incoming   → SHS (supplier holds, no IMEI yet)
 */

import * as XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// 14 canonical column headers — exact names the parser matches
// ─────────────────────────────────────────────────────────────────────────────

const HEADERS = [
  'Date In',        // 1  YYYY-MM-DD            when unit arrived / buy date
  'Model',          // 2  full model string      drives periodic table grouping
  'IMEI',           // 3  15-digit or serial     BLANK for SHS/incoming
  'Supplier',       // 4  supplier name          auto-creates supplier record
  'Buy Price',      // 5  number, no symbol      what you paid per unit
  'Colour',         // 6  single colour name     e.g. Natural Titanium
  'Storage',        // 7  capacity string        e.g. 256GB
  'Status',         // 8  available/sold/incoming  blank = available
  'Sale Platform',  // 9  platform name          sold rows only
  'Sale Price',     // 10 number                 sold rows only
  'Sale Date',      // 11 YYYY-MM-DD             sold rows only
  'Sale Order ID',  // 12 platform order ref     sold rows only
  'Postage Cost',   // 13 number, default 8      sold rows only
  'Notes',          // 14 free text              any row
];

type Row = (string | number | null)[];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Available (stock currently in office)
// Status = available · IMEI filled · Sale columns blank
// ─────────────────────────────────────────────────────────────────────────────
const AVAILABLE: Row[] = [
  //  Date In         Model                              IMEI              Supplier          BP    Colour               Storage  Status       Plt  SP    SD    OID  Post  Notes
  ['2026-04-01', 'iPhone 15 Pro Max 256GB',        '353209102768686', 'TechSource Ltd',  800,  'Natural Titanium', '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-01', 'iPhone 15 Pro Max 256GB',        '357883401512577', 'TechSource Ltd',  820,  'Black Titanium',   '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-01', 'iPhone 15 Pro Max 512GB',        '352344113462551', 'TechSource Ltd',  960,  'White Titanium',   '512GB', 'available', null, null, null, null, null, null],
  ['2026-04-03', 'iPhone 15 Pro 128GB',            '356789012345678', 'MHL Direct',      650,  'Blue Titanium',    '128GB', 'available', null, null, null, null, null, null],
  ['2026-04-03', 'iPhone 15 Pro 128GB',            '354321098765432', 'MHL Direct',      655,  'Natural Titanium', '128GB', 'available', null, null, null, null, null, 'Box missing'],
  ['2026-04-03', 'iPhone 15 Pro 256GB',            '354321098765400', 'MHL Direct',      720,  'Black Titanium',   '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-05', 'iPhone 14 Pro Max 256GB',        '351234567890123', 'IMAX Wholesale',  575,  'Space Black',      '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-05', 'iPhone 14 Pro Max 256GB',        '351234567890124', 'IMAX Wholesale',  570,  'Gold',             '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-05', 'iPhone 14 Pro 128GB',            '351234567890125', 'IMAX Wholesale',  500,  'Space Black',      '128GB', 'available', null, null, null, null, null, null],
  ['2026-04-08', 'Samsung Galaxy S24 Ultra 256GB', '356123456789001', 'IMAX Wholesale',  680,  'Titanium Black',   '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-08', 'Samsung Galaxy S24 Ultra 256GB', '356123456789002', 'IMAX Wholesale',  680,  'Titanium Gray',    '256GB', 'available', null, null, null, null, null, 'Minor scratch on back'],
  ['2026-04-08', 'Samsung Galaxy S24 Ultra 512GB', '356123456789003', 'IMAX Wholesale',  750,  'Titanium Violet',  '512GB', 'available', null, null, null, null, null, null],
  ['2026-04-10', 'Samsung Galaxy S24+ 256GB',      '356123456789004', 'PhoneMart UK',    520,  'Marble Gray',      '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-10', 'Samsung Galaxy A54 256GB',       '359876543210987', 'PhoneMart UK',    210,  'Awesome Violet',   '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-10', 'Samsung Galaxy A54 256GB',       '359876543210988', 'PhoneMart UK',    210,  'Awesome Black',    '256GB', 'available', null, null, null, null, null, null],
  ['2026-04-12', 'iPhone 15 128GB',                '358765432109000', 'TechSource Ltd',  545,  'Pink',             '128GB', 'available', null, null, null, null, null, null],
  ['2026-04-12', 'iPhone 15 128GB',                '358765432109001', 'TechSource Ltd',  545,  'Yellow',           '128GB', 'available', null, null, null, null, null, null],
  ['2026-04-15', 'iPad Pro 11" M2 256GB',          'NL6CMQCYTD',      'TechSource Ltd',  700,  'Silver',           '256GB', 'available', null, null, null, null, null, 'Tablet serial'],
  ['2026-04-15', 'iPad Air M1 64GB',               'DMPH4RYJPF',      'MHL Direct',      445,  'Starlight',        '64GB',  'available', null, null, null, null, null, null],
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Sold (historical sales — all 9 sale columns must be filled)
// Status = sold · IMEI filled · all Sale columns filled
// ─────────────────────────────────────────────────────────────────────────────
const SOLD: Row[] = [
  //  Date In         Model                              IMEI              Supplier          BP    Colour               Storage  Status  Platform      SP    Sale Date     Order ID              Post  Notes
  ['2026-03-15', 'iPhone 15 Pro Max 256GB',        '353209100000001', 'TechSource Ltd',  800,  'Natural Titanium', '256GB', 'sold', 'eBay',       980,  '2026-03-20', '12-34567-89012',      8,    null],
  ['2026-03-15', 'iPhone 15 Pro 256GB',            '353209100000002', 'TechSource Ltd',  720,  'Blue Titanium',    '256GB', 'sold', 'Amazon',     875,  '2026-03-22', '202-1234567-8901234', 8,    null],
  ['2026-03-18', 'Samsung Galaxy S24 Ultra 256GB', '356100000000001', 'IMAX Wholesale',  660,  'Titanium Black',   '256GB', 'sold', 'Backmarket', 810,  '2026-03-25', 'BM-456789',           8,    null],
  ['2026-03-20', 'iPhone 14 256GB',                '351000000000001', 'MHL Direct',      480,  'Midnight',         '256GB', 'sold', 'eBay',       620,  '2026-03-26', '12-77654-32109',      8,    null],
  ['2026-03-22', 'iPhone 14 256GB',                '351000000000002', 'MHL Direct',      475,  'Purple',           '256GB', 'sold', 'OnBuy',      605,  '2026-03-28', 'OB-112233',           8,    null],
  ['2026-04-01', 'Samsung Galaxy A54 128GB',       '359000000000001', 'PhoneMart UK',    195,  'Awesome Black',    '128GB', 'sold', 'eBay',       290,  '2026-04-05', '12-99887-76655',      8,    null],
  ['2026-04-02', 'iPhone 15 128GB',                '358700000000001', 'TechSource Ltd',  530,  'Blue',             '128GB', 'sold', 'Amazon',     670,  '2026-04-07', '202-9876543-2109876', 8,    null],
  ['2026-04-03', 'iPad Air M1 64GB',               'XZPQ7RTNKM',      'MHL Direct',      430,  'Space Gray',       '64GB',  'sold', 'eBay',       560,  '2026-04-08', '12-55443-32211',      8,    null],
];

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Incoming / SHS (supplier holds the stock — no IMEI yet)
// Status = incoming · IMEI blank · Sale columns blank
// When received: open unit in app → enter IMEI → status flips to available
// ─────────────────────────────────────────────────────────────────────────────
const INCOMING: Row[] = [
  //  Date In         Model                              IMEI  Supplier          BP    Colour               Storage  Status      Plt   SP    SD    OID  Post  Notes
  ['2026-05-01', 'iPhone 16 Pro Max 256GB',        '',   'TechSource Ltd',  920,  'Desert Titanium',  '256GB', 'incoming', null, null, null, null, null, 'Pre-ordered, ETA 2 weeks'],
  ['2026-05-01', 'iPhone 16 Pro Max 256GB',        '',   'TechSource Ltd',  920,  'Black Titanium',   '256GB', 'incoming', null, null, null, null, null, 'Pre-ordered, ETA 2 weeks'],
  ['2026-05-01', 'iPhone 16 Pro Max 512GB',        '',   'TechSource Ltd',  1050, 'Desert Titanium',  '512GB', 'incoming', null, null, null, null, null, 'Pre-ordered'],
  ['2026-05-03', 'Samsung Galaxy S25 Ultra 256GB', '',   'IMAX Wholesale',  800,  'Titanium Silverblue','256GB', 'incoming', null, null, null, null, null, 'Awaiting supplier confirmation'],
  ['2026-05-03', 'Samsung Galaxy S25 Ultra 256GB', '',   'IMAX Wholesale',  800,  'Titanium Black',   '256GB', 'incoming', null, null, null, null, null, null],
];

// ─────────────────────────────────────────────────────────────────────────────
// Build master sheet
// ─────────────────────────────────────────────────────────────────────────────

const allRows: Row[] = [
  ...AVAILABLE,
  ...SOLD,
  ...INCOMING,
];

const wb = XLSX.utils.book_new();

// ── Sheet 1: Master Data (the importable sheet) ───────────────────────────────
const ws1 = XLSX.utils.aoa_to_sheet([HEADERS, ...allRows]);

ws1['!cols'] = [
  { wch: 12 }, // Date In
  { wch: 34 }, // Model
  { wch: 18 }, // IMEI
  { wch: 18 }, // Supplier
  { wch: 11 }, // Buy Price
  { wch: 20 }, // Colour
  { wch: 10 }, // Storage
  { wch: 11 }, // Status
  { wch: 15 }, // Sale Platform
  { wch: 11 }, // Sale Price
  { wch: 12 }, // Sale Date
  { wch: 22 }, // Sale Order ID
  { wch: 13 }, // Postage Cost
  { wch: 28 }, // Notes
];

// Freeze header row
ws1['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws1, 'Master Data');

// ── Sheet 2: Column Guide ─────────────────────────────────────────────────────
const GUIDE: (string | null)[][] = [
  ['Column',        'Required',             'Format / Accepted Values',                                                          'When to fill'],
  ['Date In',       'Required',             'YYYY-MM-DD  (e.g. 2026-04-01)',                                                    'Every row'],
  ['Model',         'Required',             'Full string inc. storage: iPhone 15 Pro Max 256GB',                                 'Every row'],
  ['IMEI',          'Cond.',                '15-digit numeric  OR  tablet serial (alphanumeric)  OR  blank for SHS',             'Every row except incoming'],
  ['Supplier',      'Required',             'Any text — auto-creates supplier record',                                            'Every row'],
  ['Buy Price',     'Required',             'Number only, no £ symbol  (e.g. 800)',                                              'Every row'],
  ['Colour',        'Required',             'Single colour name  (e.g. Natural Titanium, Phantom Black)',                        'Every row'],
  ['Storage',       'Optional',             '64GB / 128GB / 256GB / 512GB / 1TB',                                               'Every row'],
  ['Status',        'Required',             'available  |  sold  |  incoming',                                                   'Every row — blank defaults to available'],
  ['Sale Platform', 'Sold rows only',        'eBay  |  Amazon  |  OnBuy  |  Backmarket  |  Other',                              'Status = sold'],
  ['Sale Price',    'Sold rows only',        'Number  (e.g. 950)',                                                               'Status = sold'],
  ['Sale Date',     'Sold rows only',        'YYYY-MM-DD',                                                                      'Status = sold'],
  ['Sale Order ID', 'Sold rows only',        'Platform order ref  (e.g. 12-34567-89012)',                                       'Status = sold'],
  ['Postage Cost',  'Optional',             'Number — defaults to £8 if blank',                                                  'Status = sold'],
  ['Notes',         'Optional',             'Free text',                                                                         'Any row'],
  [null, null, null, null],
  ['STATUS RULES',  null,                   null,                                                                                 null],
  ['available',     'Unit is in your office, ready to sell',  'IMEI required',                                                   'Fill cols 1–8 + Notes'],
  ['sold',          'Historical sale record',                  'IMEI required + all Sale cols',                                  'Fill all 14 cols'],
  ['incoming',      'Supplier holds the stock — no IMEI yet', 'Leave IMEI blank',                                               'Fill cols 1–8 + Notes; enter IMEI in app when received'],
  [null, null, null, null],
  ['RETURNS NOTE',  null,                   null,                                                                                 null],
  ['—',             'Returns are NOT imported via Excel.',     null,                                                             'Go to app → Returns → Process New Return → search sold unit by IMEI → select type'],
  ['—',             'returned_to_inventory',                   'Unit restored to available stock, sale data cleared',            null],
  ['—',             'returned_to_supplier',                    'Unit permanently DELETED from inventory',                        null],
  ['—',             'repair',                                  'Unit stays in system as "returned", tracked in Returns tab',     null],
];

const ws2 = XLSX.utils.aoa_to_sheet(GUIDE);
ws2['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 60 }, { wch: 52 }];
XLSX.utils.book_append_sheet(wb, ws2, 'Column Guide');

// Write
const outPath = path.join(__dirname, '..', 'public', 'sample-data.xlsx');
XLSX.writeFile(wb, outPath);

const avail = AVAILABLE.length;
const sold  = SOLD.length;
const inc   = INCOMING.length;
console.log(`✓  ${outPath}`);
console.log(`   Master Data sheet: ${avail + sold + inc} rows`);
console.log(`   ├─ available  : ${avail} units (stock in office)`);
console.log(`   ├─ sold       : ${sold} units (historical sales)`);
console.log(`   └─ incoming   : ${inc} units (SHS — no IMEI)`);
console.log(`   Column Guide  : 14 columns documented`);
