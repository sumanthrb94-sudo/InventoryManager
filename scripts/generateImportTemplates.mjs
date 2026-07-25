/**
 * generateImportTemplates — writes the two canonical upload templates.
 *
 * These are the STANDARD for every future report the team produces. Both
 * match the schemas the importers parse and the app exports, so a file
 * built from a template round-trips: export → edit → re-import.
 *
 *   templates/INVENTORY_REPORT_TEMPLATE.xlsx
 *   templates/SALES_REPORT_TEMPLATE.xlsx
 *
 * Each carries a README sheet documenting every column — required vs
 * optional, accepted values, and what the importer does with it — plus
 * dropdown validation on the fields operators most often mistype.
 *
 * A vitest guard (templates.test.ts) parses these files with the REAL
 * parsers and fails if either stops being valid input, so the templates
 * can't silently drift from the code.
 *
 * Run: node scripts/generateImportTemplates.mjs
 */
import ExcelJS from 'exceljs';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = 'templates';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
const EXAMPLE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

/** Style a header row, freeze it, and switch on the autofilter. */
function dressSheet(sheet, headers, widths) {
  sheet.columns = headers.map((h, i) => ({ header: h, key: h, width: widths?.[i] ?? 16 }));
  const row = sheet.getRow(1);
  row.eachCell(cell => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  row.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

/** Tint the example rows so nobody mistakes them for real data. */
function markExamples(sheet, count) {
  for (let r = 2; r <= count + 1; r++) {
    sheet.getRow(r).eachCell(cell => { cell.fill = EXAMPLE_FILL; });
  }
}

/** README sheet — the column contract, in the file itself. */
function addReadme(wb, title, intro, rows) {
  const sheet = wb.addWorksheet('README', { properties: { tabColor: { argb: 'FF10B981' } } });
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 30;
  sheet.getColumn(4).width = 74;

  sheet.addRow([title]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  for (const line of intro) {
    const r = sheet.addRow([line]);
    r.getCell(1).alignment = { wrapText: true };
    r.font = { size: 10, color: { argb: 'FF475569' } };
  }
  sheet.addRow([]);

  const head = sheet.addRow(['Column', 'Required', 'Accepted values / format', 'What the importer does with it']);
  head.eachCell(cell => { cell.fill = HEADER_FILL; cell.font = HEADER_FONT; });

  for (const [col, req, fmt, note] of rows) {
    const r = sheet.addRow([col, req, fmt, note]);
    r.getCell(2).font = { bold: true, color: { argb: req === 'Yes' ? 'FFB91C1C' : 'FF64748B' } };
    r.getCell(4).alignment = { wrapText: true };
    r.getCell(3).alignment = { wrapText: true };
    r.height = 30;
  }
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY REPORT
// ═══════════════════════════════════════════════════════════════════════════
async function buildInventoryTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MOBILEPHONEMARKET Inventory Manager';
  wb.created = new Date(Date.UTC(2026, 6, 25));

  const headers = [
    'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
    'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
  ];
  const sheet = wb.addWorksheet('INVENTORY');
  dressSheet(sheet, headers, [14, 26, 20, 8, 10, 14, 14, 26, 10, 12, 34]);

  const examples = [
    ['2026-07-25', 'IPHONE 13', '350100000000000', 'A',  '128GB', 'Physical SIM', 'MIDNIGHT',  'MOBILE WHOLESALE LTD', 320.00, 'OFFICE', ''],
    ['2026-07-25', 'IPHONE 13', '350100000007919', 'A+', '128GB', 'eSIM',         'STARLIGHT', 'MOBILE WHOLESALE LTD', 318.50, 'OFFICE', ''],
    ['2026-07-24', 'SAMSUNG GALAXY S22', '350100000015838', 'B', '128GB', 'Dual SIM', 'GREEN',  'PHONEBOX DIRECT',      240.00, 'OFFICE', 'Minor scuff on frame'],
    ['2026-07-24', 'IPHONE 13 PRO', '350100000023757', 'A', '256GB', 'Physical SIM', 'GRAPHITE', 'CELLHUB TRADING',    520.00, 'SHS',    'Supplier holding — awaiting delivery'],
    ['2026-07-23', 'GOOGLE PIXEL 7', '350100000031676', 'A', '128GB', 'eSIM',        'BLACK',    'NORTHSIDE STOCK',     275.00, 'SHS',    'Supplier holding — awaiting delivery'],
  ];
  examples.forEach(r => sheet.addRow(r));
  markExamples(sheet, examples.length);

  sheet.getColumn(9).numFmt = '0.00';
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';

  // Dropdowns on the fields most often mistyped. 500 rows of headroom.
  const validate = (colLetter, values) => {
    for (let r = 2; r <= 500; r++) {
      sheet.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${values.join(',')}"`],
      };
    }
  };
  validate('D', ['A+', 'A', 'B+', 'B', 'C']);
  validate('F', ['Physical SIM', 'eSIM', 'Dual SIM', 'Not Applicable']);
  validate('J', ['OFFICE', 'SHS']);

  addReadme(wb, 'INVENTORY REPORT — upload template',
    [
      'Use this sheet to add or update stock in bulk. Upload via Import → Inventory Report.',
      'Nothing is written until you confirm the preview, which tells you exactly what will change.',
      'The grey example rows are illustrations — delete them before uploading your own data.',
      'An IMEI already in the system UPDATES that unit; a new IMEI CREATES one. Re-uploading the same file is safe.',
    ],
    [
      ['Stock In Date', 'No',  'yyyy-mm-dd (or any Excel date cell)', 'The day the unit was received. Blank defaults to today. Drives the "Stock added in last 72 hours" tile and the Age column.'],
      ['Model',         'Yes', 'Free text, e.g. "IPHONE 13 PRO"',     'Brand and storage are parsed out of this string where possible. Keep it consistent — it is how stock groups together across the app.'],
      ['IMEI',          'Yes', '15 digits, or a 10-12 character Apple serial', 'The unique key for the unit. An existing IMEI updates that unit rather than creating a duplicate. Invalid IMEIs are listed in the preview and skipped.'],
      ['Grade',         'No',  'A+, A, B+, B, C',                     'Condition grade. Free text is accepted, but sticking to the dropdown keeps reports groupable.'],
      ['Storage',       'No',  'e.g. 64GB, 128GB, 256GB, 1TB',        'Used with Model to form the SKU. If omitted it is parsed out of Model when present there.'],
      ['SIM Type',      'No',  'Physical SIM, eSIM, Dual SIM, Not Applicable', 'Recorded on the unit and shown in the stock overlays.'],
      ['Colour',        'No',  'Free text, e.g. MIDNIGHT',            'Recorded on the unit; used for colour breakdowns in reports.'],
      ['Supplier',      'Yes', 'Free text, e.g. MOBILE WHOLESALE LTD','Matched case-insensitively against existing suppliers. A name we have never seen is created automatically — the preview lists any new ones first.'],
      ['BP',            'Yes', 'Number greater than 0',               'Buy price in GBP. Every gross-profit figure in the app depends on this, so a row with BP of 0 or blank is rejected.'],
      ['Stock Type',    'No',  'OFFICE or SHS (blank = OFFICE)',      'SHS means the supplier still holds the unit: it lands as incoming stock and appears under SHS, not on the office shelf. Also accepts INCOMING, SUPPLIER, Y, YES, TRUE, 1.'],
      ['Notes',         'No',  'Free text',                           'Free-form note stored on the unit. NOTE: writing "SHS" here does nothing — use the Stock Type column.'],
    ],
  );

  await wb.xlsx.writeFile(`${OUT}/INVENTORY_REPORT_TEMPLATE.xlsx`);
  console.log(`${OUT}/INVENTORY_REPORT_TEMPLATE.xlsx — ${headers.length} columns, ${examples.length} example rows`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SALES REPORT
// ═══════════════════════════════════════════════════════════════════════════
const SALES_LAYOUTS = {
  AMAZON: ['nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'],
  BM:     ['Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'Payment Mode', 'SP-BP', 'Marginal Tax', 'PayPal/Klarna Com', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'],
  EBAY:   ['DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS', 'BP', 'SP', 'SP-BP', 'MAR TAX', 'COM', 'ROF', 'FVF', '0.2', 'T.COM', 'SHIPPING', 'GP', 'GP%', 'NP(incl. PROMOTION)'],
  ONBUY:  ['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP', 'SP-BP', 'MAR VAT', 'COM 7%', 'VAT 20%', 'SHIP', 'GP', 'GP%', 'Comments'],
};

const SALES_EXAMPLES = {
  AMAZON: [
    ['2026-07-20', 'AMZ-5001', 'IP13-128-MID', '350100000000000', 'MOBILE WHOLESALE LTD', 1, 320.00, 425.00, '', '', '', 8, '', '', ''],
    ['2026-07-21', 'AMZ-5002', 'IP13-128-STA', '350100000007919', 'MOBILE WHOLESALE LTD', 1, 318.50, 419.99, '', '', '', 8, '', '', 'Prime'],
  ],
  BM: [
    ['2026-07-20', 'BM-7781', 'S22-128-GRN', '350100000015838', 'PHONEBOX DIRECT', 1, 240.00, 329.00, 'Paypal', '', '', '', '', 8, '', '', ''],
  ],
  EBAY: [
    ['2026-07-22', 'EB-3310', 'IP13P-256-GRA', '350100000023757', 'CELLHUB TRADING', 1, 520.00, 679.00, '', '', '', '', '', '', '', 8, '', '', ''],
  ],
  ONBUY: [
    ['2026-07-23', 'OB-9002', 'PIX7-128-BLK', '350100000031676', 'NORTHSIDE STOCK', 275.00, 359.00, '', '', '', '', 8, '', '', ''],
  ],
};

async function buildSalesTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MOBILEPHONEMARKET Inventory Manager';
  wb.created = new Date(Date.UTC(2026, 6, 25));

  for (const [marketplace, headers] of Object.entries(SALES_LAYOUTS)) {
    const sheet = wb.addWorksheet(marketplace);
    dressSheet(sheet, headers, headers.map(h => (h === 'Comments' ? 28 : h.length < 6 ? 12 : 16)));
    const rows = SALES_EXAMPLES[marketplace] ?? [];
    rows.forEach(r => sheet.addRow(r));
    markExamples(sheet, rows.length);
  }

  addReadme(wb, 'SALES REPORT — upload template',
    [
      'One sheet per marketplace. Upload via Import → Sales Report. Sheets you do not trade on can be left with just their header row.',
      'IMPORTANT: the app RECOMPUTES every money column that is derived — SP-BP, Marginal Tax, Commission, ROF, FVF, VAT, GP, GP%. Leave them blank; whatever you type there is ignored.',
      'You only have to fill in what the marketplace actually gives you: date, order number, IMEI, supplier, BP, SP and postage.',
      'Sales are matched to stock by IMEI. Import the Inventory Report FIRST so units auto-match — otherwise each unmatched sale must be completed by hand before the import will confirm.',
      'The grey example rows are illustrations — delete them before uploading your own data.',
    ],
    [
      ['Date / DATE / nw', 'Yes', 'yyyy-mm-dd (or any Excel date cell)', 'Sale date. Drives every period figure — Sold Today, This Month, and the date-range reports. A row with no readable date is rejected.'],
      ['Order Number',     'Yes', 'Free text, e.g. AMZ-5001',            'The marketplace order id. Combined with the IMEI it forms the record key, so re-uploading the same report updates rows instead of duplicating them.'],
      ['SKU',              'No',  'Free text',                           'Used as a fallback identifier when the IMEI cell is empty, and to derive a model name for unmatched sales.'],
      ['IMEI',             'No',  '15 digits — or several separated by " / "', 'How a sale is matched to a unit in stock; that unit is then marked SOLD and linked to the sale. A bulk order with several IMEIs in one cell is split into one row per phone, with BP and SP divided evenly. Strongly recommended on every row.'],
      ['Supplier',         'No',  'Free text',                           'Shown on the sale record. Required only for sales with no matching unit, where it is filled in during the import.'],
      ['Quantity / UNITS', 'No',  'Whole number, defaults to 1',         'Units on the order line. OnBuy has no Quantity column by design — do not add one.'],
      ['BP',               'Yes', 'Number greater than 0',               'Buy price in GBP. Every profit figure depends on it.'],
      ['SP',               'Yes', 'Number greater than 0',               'Sale price in GBP, as the marketplace reports it.'],
      ['Payment Mode',     'No',  'BM only: Paypal, Klarna, Clear Pay, Card', 'BM only. Paypal/Klarna/Clearpay attract their own commission line, which the app calculates.'],
      ['Postage / SHIP / SHIPPING', 'No', 'Number, e.g. 8 or 6.30',      'What the postage actually cost. On eBay the values 1, 2 and 8 are read as the standard shipping tiers; any other number is taken literally.'],
      ['Comments',         'No',  'Free text',                           'Free-form note kept on the sale record.'],
      ['(row colour)',     'No',  'Red fill on the Date or Order cell',  'A red-filled row is imported as FLAGGED and shown in red across the app — the convention for returns, refunds, chargebacks and disputes. Filling the cell red is the only way to set it.'],
    ],
  );

  await wb.xlsx.writeFile(`${OUT}/SALES_REPORT_TEMPLATE.xlsx`);
  const counts = Object.entries(SALES_LAYOUTS).map(([m, h]) => `${m}:${h.length}c`).join(' ');
  console.log(`${OUT}/SALES_REPORT_TEMPLATE.xlsx — ${counts}`);
}

await buildInventoryTemplate();
await buildSalesTemplate();
console.log('\nTemplates written. They are parsed by src/__tests__/lib/templates.test.ts on every test run.');
