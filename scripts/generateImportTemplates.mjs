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
import { mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs';

const OUT = 'templates';
// Templates are also served by the app itself — the report menus and the
// import modals offer "Blank template" so an operator building a new file
// starts from the standard instead of a colleague's old copy. Vite serves
// public/ verbatim, so the same files are published there. Written by this
// script rather than copied at build time: a stale public/ copy would hand
// out a schema the importer no longer accepts, which is worse than no
// button at all.
const PUBLIC_OUT = 'public/templates';
for (const dir of [OUT, PUBLIC_OUT]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Copy every generated template into public/ so the app can link to it. */
function publishToPublic() {
  const files = readdirSync(OUT).filter(f => f.endsWith('.xlsx'));
  for (const f of files) copyFileSync(`${OUT}/${f}`, `${PUBLIC_OUT}/${f}`);
  return files.length;
}

// MIRRORS src/lib/unitConstants.ts. A template offering values the app
// doesn't is worse than no dropdown at all — the operator picks one, the
// import accepts it, and the data quietly disagrees with every screen.
// src/__tests__/lib/templates.test.ts fails if these drift apart.
const GRADE_OPTIONS = ['A', 'B', 'C', 'ONU', 'Brand new'];
const SIM_TYPE_OPTIONS = ['Physical SIM', 'Physical SIM + eSIM', 'Dual Physical SIM', 'Not Applicable'];

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
    ['2026-07-25', 'IPHONE 13', '350100000007919', 'ONU', '128GB', 'Physical SIM + eSIM',         'STARLIGHT', 'MOBILE WHOLESALE LTD', 318.50, 'OFFICE', ''],
    ['2026-07-24', 'SAMSUNG GALAXY S22', '350100000015838', 'B', '128GB', 'Dual Physical SIM', 'GREEN',  'PHONEBOX DIRECT',      240.00, 'OFFICE', 'Minor scuff on frame'],
    // SHS rows leave IMEI BLANK — the supplier has not shipped, so there is
    // no handset to read one off. It is captured on Receive.
    ['2026-07-24', 'IPHONE 13 PRO', '', 'A', '256GB', 'Physical SIM', 'GRAPHITE', 'CELLHUB TRADING',    520.00, 'SHS',    'Supplier holding — awaiting delivery'],
    ['2026-07-23', 'GOOGLE PIXEL 7', '', 'Brand new', '128GB', 'Physical SIM + eSIM', 'BLACK',    'NORTHSIDE STOCK',     275.00, 'SHS',    'Supplier holding — awaiting delivery'],
  ];
  examples.forEach(r => sheet.addRow(r));
  markExamples(sheet, examples.length);

  sheet.getColumn(9).numFmt = '0.00';
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';

  // Dropdowns on the fields most often mistyped. 500 rows of headroom.
  const validate = (colLetter, values) => {
    for (let r = 2; r <= 500; r++) {
      sheet.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
        // A helper, not a gate: the intake dropdowns carry an "Other"
        // escape hatch that takes free text, so Excel must not reject a
        // value the app itself would accept.
        showErrorMessage: false,
      };
    }
  };
  validate('D', GRADE_OPTIONS);
  validate('F', SIM_TYPE_OPTIONS);
  validate('J', ['OFFICE', 'SHS']);

  addReadme(wb, 'INVENTORY REPORT — upload template',
    [
      'Use this sheet to add or update stock in bulk. Upload via Import → Inventory Report.',
      'Nothing is written until you confirm the preview, which tells you exactly what will change.',
      'The grey example rows are illustrations — delete them before uploading your own data.',
      'An IMEI already in the system UPDATES that unit; a new IMEI CREATES one. Re-uploading the same file is safe.',
      'SHS rows leave IMEI BLANK — supplier-held stock has not shipped, so there is no IMEI yet. It is captured when you Receive the unit.',
    ],
    [
      ['Stock In Date', 'No',  'yyyy-mm-dd (or any Excel date cell)', 'The day the unit was received. Blank defaults to today. Drives the "Stock added in last 72 hours" tile and the Age column.'],
      ['Model',         'Yes', 'Free text, e.g. "IPHONE 13 PRO"',     'Brand and storage are parsed out of this string where possible. Keep it consistent — it is how stock groups together across the app.'],
      ['IMEI',          'Office only', '15 digits, or a 10-12 character Apple serial', 'The unique key for the unit. An existing IMEI updates that unit rather than creating a duplicate. REQUIRED for OFFICE stock; leave BLANK for SHS — supplier-held stock has not shipped, so there is no IMEI to record yet. It is captured on Receive. Invalid IMEIs are listed in the preview and skipped.'],
      ['Grade',         'No',  'A, B, C, ONU, Brand new',             'Condition grade — exactly the options the Add Stock screen offers. ONU = Open Never Used. Free text is accepted, but sticking to the dropdown keeps reports groupable.'],
      ['Storage',       'No',  'e.g. 64GB, 128GB, 256GB, 1TB',        'Used with Model to form the SKU. If omitted it is parsed out of Model when present there.'],
      ['SIM Type',      'No',  'Physical SIM, Physical SIM + eSIM, Dual Physical SIM, Not Applicable', 'Recorded on the unit and shown in the stock overlays. The app also allows a free-text "Other".'],
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
  AMAZON: ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'],
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
      ['Date / DATE', 'Yes', 'yyyy-mm-dd (or any Excel date cell)', 'Sale date. Drives every period figure — Sold Today, This Month, and the date-range reports. A row with no readable date is rejected. Older Amazon files head this column "nw"; that is still accepted, but new files should say Date.'],
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

/**
 * SHS STOCK template — the report used to MARK stock as supplier-held.
 *
 * Same schema and same importer as the Inventory Report (there is only
 * one stock importer), but every row is pre-set to Stock Type = SHS and
 * the README covers the SHS lifecycle. Kept as its own file because
 * "the supplier is holding these for us" is a separate conversation
 * with a supplier from "these arrived today".
 */
async function buildShsTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MOBILEPHONEMARKET Inventory Manager';

  const headers = [
    'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
    'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
  ];
  const sheet = wb.addWorksheet('INVENTORY');
  dressSheet(sheet, headers, [14, 26, 20, 8, 10, 14, 14, 26, 10, 12, 34]);

  const examples = [
    // IMEI is BLANK on purpose. SHS is stock the supplier has not shipped —
    // there is no handset in anyone's hand, so there is no IMEI to read off
    // it. Filling this column with invented numbers is worse than leaving it
    // empty: they never match a real phone. The IMEI is captured on Receive.
    ['2026-07-25', 'IPHONE 13 PRO', '', 'A',  '256GB', 'Physical SIM', 'GRAPHITE',    'CELLHUB TRADING', 520.00, 'SHS', 'Supplier holding — awaiting delivery'],
    ['2026-07-25', 'IPHONE 13 PRO', '', 'ONU', '256GB', 'Physical SIM + eSIM', 'SIERRA BLUE', 'CELLHUB TRADING', 525.00, 'SHS', 'Supplier holding — awaiting delivery'],
    ['2026-07-25', 'SAMSUNG GALAXY S23', '', 'Brand new', '256GB', 'Dual Physical SIM', 'CREAM',      'PHONEBOX DIRECT', 430.00, 'SHS', 'Supplier holding — awaiting delivery'],
    ['2026-07-24', 'IPHONE 14', '', 'A', '256GB', 'Physical SIM', 'PURPLE',           'NORTHSIDE STOCK', 480.00, 'SHS', 'Paid — ships Monday'],
  ];
  examples.forEach(r => sheet.addRow(r));
  markExamples(sheet, examples.length);

  sheet.getColumn(9).numFmt = '0.00';
  sheet.getColumn(1).numFmt = 'yyyy-mm-dd';

  const validate = (colLetter, values) => {
    for (let r = 2; r <= 500; r++) {
      sheet.getCell(`${colLetter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${values.join(',')}"`],
        // A helper, not a gate: the intake dropdowns carry an "Other"
        // escape hatch that takes free text, so Excel must not reject a
        // value the app itself would accept.
        showErrorMessage: false,
      };
    }
  };
  validate('D', GRADE_OPTIONS);
  validate('F', SIM_TYPE_OPTIONS);
  // Locked to SHS — this template exists to mark supplier-held stock.
  validate('J', ['SHS']);

  addReadme(wb, 'SHS STOCK — marking supplier-held stock',
    [
      'Use this when a supplier is HOLDING stock for you that has not arrived yet.',
      'Upload via Import → Inventory Report (there is one stock importer; the Stock Type column is what makes these rows SHS).',
      'Every row here is Stock Type = SHS. Units land as INCOMING and show under the SHS tile, never on the office shelf.',
      '',
      'LIFECYCLE — an SHS unit leaves SHS in exactly three ways:',
      '  1. It arrives → Receive it (Buy → SHS tile → Receive). It becomes office stock.',
      '  2. The supplier ships it straight to the customer → it appears on a Sales Report. The',
      '     import marks it sold, keeps it tagged as an SHS sale, and decrements the master row.',
      '  3. The supplier cancels → an admin deletes it from the SHS overlay.',
      '',
      'LEAVE IMEI BLANK. Supplier-held stock has not shipped — there is no handset in anyone\'s',
      'hand, so there is no IMEI to read off it. That is the whole point of recording it as SHS.',
      'The IMEI is captured when the unit arrives and you Receive it. Never invent one: an',
      'invented IMEI matches no real phone and has to be found and corrected later.',
      'The grey example rows are illustrations — delete them before uploading your own data.',
    ],
    [
      ['Stock In Date', 'No',  'yyyy-mm-dd',                        'When the holding was agreed. Blank defaults to today.'],
      ['Model',         'Yes', 'Free text, e.g. "IPHONE 13 PRO"',   'Keep spelling consistent with the catalog — model names are decided in Admin → Configuration and applied automatically on import.'],
      ['IMEI',          'No — leave blank', 'Blank. (A real IMEI is accepted if the supplier has already sent one.)', 'SHS stock has not shipped, so there is no IMEI yet. The unit is tracked by Model + Supplier until it arrives; if the supplier ships it straight to a customer, the Sales Report fulfils it on that same Model + Supplier match. The IMEI is captured on Receive.'],
      ['Grade',         'No',  'A, B, C, ONU, Brand new',           'Condition as quoted by the supplier. ONU = Open Never Used.'],
      ['Storage',       'No',  'e.g. 128GB, 256GB',                 'Used with Model to form the SKU.'],
      ['SIM Type',      'No',  'Physical SIM, Physical SIM + eSIM, Dual Physical SIM, Not Applicable', 'Recorded on the unit.'],
      ['Colour',        'No',  'Free text',                         'Recorded on the unit.'],
      ['Supplier',      'Yes', 'Free text',                         'WHO is holding it. Matched case-insensitively; an unknown name is created. This is also how the SHS master row is matched when the unit is later fulfilled — get it right.'],
      ['BP',            'Yes', 'Number greater than 0',             'Agreed buy price. Every profit figure depends on it.'],
      ['Stock Type',    'Yes', 'SHS',                               'What makes the row supplier-held: status becomes INCOMING and stockSource SHS. Leave it blank and the unit lands on the office shelf as available stock you do not actually have.'],
      ['Notes',         'No',  'Free text',                         'e.g. expected ship date. Writing "SHS" here does NOT mark the row — only the Stock Type column does.'],
    ],
  );

  await wb.xlsx.writeFile(`${OUT}/SHS_STOCK_TEMPLATE.xlsx`);
  console.log(`${OUT}/SHS_STOCK_TEMPLATE.xlsx — ${headers.length} columns, ${examples.length} SHS example rows`);
}

/**
 * Per-marketplace templates. Channels send reports separately, so one
 * file per channel is the common shape — pick the marketplace in the
 * import dialog and upload the single sheet.
 */
async function buildPerMarketplaceTemplates() {
  for (const [marketplace, headers] of Object.entries(SALES_LAYOUTS)) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MOBILEPHONEMARKET Inventory Manager';
    const sheet = wb.addWorksheet(marketplace);
    dressSheet(sheet, headers, headers.map(h => (h === 'Comments' ? 28 : h.length < 6 ? 12 : 16)));
    const rows = SALES_EXAMPLES[marketplace] ?? [];
    rows.forEach(r => sheet.addRow(r));
    markExamples(sheet, rows.length);

    addReadme(wb, `${marketplace} SALES — single-marketplace upload template`,
      [
        `One sheet, ${marketplace} only. In Import → Sales Report, choose ${marketplace} before picking the file.`,
        `The sheet does not have to be named ${marketplace} — with a marketplace selected the first sheet is used, so a raw export works as-is.`,
        'Leave the derived money columns blank: SP-BP, tax, commission, VAT, GP and GP% are all recomputed by the app.',
        'Record ids match the combined workbook exactly, so uploading per-channel today and a combined file later updates the same rows instead of duplicating them.',
        'The grey example rows are illustrations — delete them before uploading your own data.',
      ],
      [
        ['Date',         'Yes', 'yyyy-mm-dd', 'Sale date — drives every period figure.'],
        ['Order Number', 'Yes', 'Free text',  'Marketplace order id. With the IMEI it forms the record key, so re-uploads update rather than duplicate.'],
        ['SKU',          'No',  'Free text',  'Fallback identifier when IMEI is blank.'],
        ['IMEI',         'No',  '15 digits, or several separated by " / "', 'Matches the sale to a unit in stock and marks it SOLD. Multi-IMEI cells split into one row per phone with BP/SP divided.'],
        ['Supplier',     'No',  'Free text',  'Needed only for sales with no matching unit, completed during import.'],
        ['BP',           'Yes', 'Number > 0', 'Buy price.'],
        ['SP',           'Yes', 'Number > 0', 'Sale price as the marketplace reports it.'],
        ['Postage',      'No',  'Number',     marketplace === 'EBAY' ? 'Column is SHIPPING. Values 1, 2 and 8 are read as the standard eBay tiers; anything else is taken literally.' : 'What postage actually cost.'],
        ['(row colour)', 'No',  'Red fill on Date or Order', 'Imports the row as FLAGGED — the convention for returns, refunds, chargebacks and disputes.'],
      ],
    );

    await wb.xlsx.writeFile(`${OUT}/SALES_${marketplace}_TEMPLATE.xlsx`);
    console.log(`${OUT}/SALES_${marketplace}_TEMPLATE.xlsx — ${headers.length} columns`);
  }
}

await buildInventoryTemplate();
await buildShsTemplate();
await buildSalesTemplate();
await buildPerMarketplaceTemplates();
const published = publishToPublic();
console.log(`${PUBLIC_OUT}/ — ${published} templates published for the in-app download buttons`);
console.log('\nTemplates written. They are parsed by src/__tests__/lib/templates.test.ts on every test run.');
