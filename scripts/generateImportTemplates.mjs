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
// SALES REPORT — moved out of this script (2026-08)
// ═══════════════════════════════════════════════════════════════════════════
//
// The sales templates are generated by scripts/generateSalesTemplates.ts now,
// which calls the real report writer — so their columns, number formats and
// per-row formulas come from the same code path that writes a live Sales
// Report and cannot drift from it.
//
// This script used to keep its own SALES_LAYOUTS table, and it drifted badly:
// the templates were still shipping eBay's `0.2` and `NP(incl. PROMOTION)`
// and BM's `PayPal/Klarna Com` long after the report had dropped them, so an
// operator building a file from the template produced something that looked
// nothing like the report. Leaving a second copy here — even a corrected one —
// would restart that clock, and running this script would silently overwrite
// the generated templates with the stale shape.
//
//   npx tsx scripts/generateSalesTemplates.ts     (or: npm run templates)

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
 * ACCESSORIES template — the no-IMEI quantity-pool schema (chargers, SIM
 * pins, cables). Same importer as the Inventory/SHS reports (the sheet is
 * recognised by having a SKU + Total Added column and no IMEI column), but
 * its own file because the schema is genuinely different — six columns,
 * no Grade/Storage/SIM Type, no per-unit IMEI at all.
 */
async function buildAccessoriesTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MOBILEPHONEMARKET Inventory Manager';

  const headers = ['SKU', 'Name', 'Supplier', 'Total Added', 'BP', 'Notes'];
  const sheet = wb.addWorksheet('ACCESSORIES');
  dressSheet(sheet, headers, [18, 26, 26, 12, 10, 34]);

  const examples = [
    ['USB-C-20W',   'USB-C 20W Charger',      'IMAX WHOLESALE',   50, 3.50, ''],
    ['SIM-PIN-01',  'SIM Eject Pin',          'NIHAL ACCESSORIES', 200, 0.15, ''],
    ['SCR-PROT-UNI','Universal Screen Protector', 'MHL SUPPLIES', 100, 0.80, 'Bulk pack of 100'],
  ];
  examples.forEach(r => sheet.addRow(r));
  markExamples(sheet, examples.length);
  sheet.getColumn(5).numFmt = '0.00';

  addReadme(wb, 'ACCESSORIES — upload template',
    [
      'Use this to bulk-add or top up accessory stock — chargers, SIM pins, cables, cases and the like.',
      'Upload via Import → Inventory Report (the same importer reads this sheet; it is recognised by its own SKU + Total Added columns, with no IMEI column at all).',
      'Accessories are tracked as a QUANTITY POOL per SKU, never as individual serialised units — there is no IMEI, ever.',
      'A SKU already in the system ADDS this row\'s Total Added on top of the existing pool; a new SKU CREATES one.',
      'The grey example rows are illustrations — delete them before uploading your own data.',
    ],
    [
      ['SKU',          'Yes', 'Free text, e.g. USB-C-20W',    'The unique key for the accessory pool. An existing SKU tops up that pool rather than creating a duplicate.'],
      ['Name',         'No',  'Free text, e.g. "USB-C 20W Charger"', 'Friendly display name shown everywhere the SKU appears. Falls back to the SKU itself if left blank.'],
      ['Supplier',     'No',  'Free text',                     'Matched case-insensitively against existing suppliers; an unknown name is created.'],
      ['Total Added',  'Yes', 'Whole number greater than 0',   'How many units this row adds to the pool. Reflected in the running quantity — NOT the same as the pool\'s current quantity, which also falls as sales are recorded.'],
      ['BP',           'Yes', 'Number greater than 0',         'Buy price per unit in GBP. Used for every gross-profit figure when a unit from this pool sells.'],
      ['Notes',        'No',  'Free text',                     'Free-form note stored on the pool.'],
    ],
  );

  await wb.xlsx.writeFile(`${OUT}/ACCESSORIES_TEMPLATE.xlsx`);
  console.log(`${OUT}/ACCESSORIES_TEMPLATE.xlsx — ${headers.length} columns, ${examples.length} example rows`);
}

await buildInventoryTemplate();
await buildShsTemplate();
await buildAccessoriesTemplate();
const published = publishToPublic();
console.log(`${PUBLIC_OUT}/ — ${published} templates published for the in-app download buttons`);
console.log('\nTemplates written. They are parsed by src/__tests__/lib/templates.test.ts on every test run.');
