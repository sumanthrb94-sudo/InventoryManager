/**
 * generateBulkSoldTemplate — the sheet the operator fills in to mark a batch
 * of handsets sold.
 *
 * Run: npx tsx scripts/generateBulkSoldTemplate.ts
 *
 * The columns come from BULK_SOLD_HEADERS in src/lib/bulkSoldImport.ts — the
 * same constant the parser reads — so the sheet and the reader cannot drift.
 * That is the mistake the old hand-written SALES_LAYOUTS made, and it shipped
 * templates nothing could parse for months.
 *
 * Deliberately plain: no derived money columns. This sheet says WHICH handset
 * sold, for how much, on which marketplace. Every fee, VAT line and GP figure
 * is computed by the application on upload — the same calculator that runs
 * when a sale is tapped in by hand — and appears on the Sales Report
 * afterwards. Putting a second copy of the arithmetic here would give the
 * operator a number to disagree with.
 */
import ExcelJS from 'exceljs';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { BULK_SOLD_HEADERS } from '../src/lib/bulkSoldImport';
import { MARKETPLACES } from '../src/types';

const OUT = 'templates';
const PUBLIC_OUT = 'public/templates';
for (const dir of [OUT, PUBLIC_OUT]) if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const BLANK_ROWS = 300;
const FILE = 'BULK_SOLD_TEMPLATE.xlsx';

/** Width per column, keyed by header so re-ordering cannot mis-size them. */
const WIDTH: Record<string, number> = {
  'IMEI': 20, 'Marketplace': 14, 'Order Number': 22, 'Sale Price': 12,
  'Sale Date': 13, 'Postage': 10, 'Payment Mode': 14, 'Comments': 34,
};

const REQUIRED = new Set(['IMEI', 'Marketplace', 'Order Number', 'Sale Price']);

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BULK SOLD');
  ws.columns = BULK_SOLD_HEADERS.map(h => ({ width: WIDTH[h] ?? 16 }));

  const header = ws.addRow([...BULK_SOLD_HEADERS]);
  header.font = { bold: true };
  header.eachCell((cell, c) => {
    const name = BULK_SOLD_HEADERS[c - 1];
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      // Required columns are shaded so it is obvious at a glance which four
      // must be filled and which four are optional overrides.
      fgColor: { argb: REQUIRED.has(name) ? 'FFDBEAFE' : 'FFF1F5F9' },
    };
    cell.alignment = { vertical: 'middle' };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // A worked example so the shape of a row is never in doubt.
  const example = ws.addRow([
    '350000000000404', 'AMAZON', 'AMZ-5001', 610, new Date('2026-08-01'), 8, '', 'example row — delete or type over',
  ]);
  example.getCell(4).numFmt = '0.00';
  example.getCell(5).numFmt = 'd-mmm-yyyy';
  example.getCell(6).numFmt = '0.00';
  example.font = { italic: true, color: { argb: 'FF64748B' } };

  // Blank rows with the right number formats, and a marketplace dropdown so a
  // typo cannot become a rejected row.
  for (let i = 0; i < BLANK_ROWS; i++) {
    const row = ws.addRow([]);
    row.getCell(4).numFmt = '0.00';
    row.getCell(5).numFmt = 'd-mmm-yyyy';
    row.getCell(6).numFmt = '0.00';
    row.getCell(2).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: [`"${MARKETPLACES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Not a marketplace',
      error: `Pick one of: ${MARKETPLACES.join(', ')}`,
    };
  }

  // ── README ──────────────────────────────────────────────────────────────
  const rm = wb.addWorksheet('README');
  rm.columns = [{ width: 26 }, { width: 96 }];
  const head = (t: string) => {
    const r = rm.addRow([t, '']);
    r.getCell(1).font = { bold: true, size: 12 };
  };
  const line = (a: string, b: string) => {
    const r = rm.addRow([a, b]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };

  head('BULK SOLD — mark a batch of handsets sold from a spreadsheet');
  rm.addRow([]);
  line('What it does',
    'One row per handset. Upload it and each row marks that unit sold, exactly as if you had '
    + 'used Mark Multiple Sold in the app — same calculator, same VAT lines, same audit trail.');
  line('What you must fill',
    'IMEI, Marketplace, Order Number and Sale Price. Those four are shaded blue in the header.');
  line('What is optional',
    'Sale Date (defaults to today), Postage (defaults to the marketplace rate), Payment Mode '
    + '(Back Market only) and Comments.');
  line('One order, several handsets',
    'Just repeat the order number on each row. That is how a multi-handset order is recorded '
    + 'in the app too.');
  line('What it will NOT do',
    'It can only mark stock you already have. It never creates a unit, never restores a return '
    + 'and never re-imports old sales. An IMEI that is not in stock, or is already sold, is '
    + 'rejected and told to you before anything is written.');
  line('Nothing is written until you say so',
    'The upload shows you every row it accepted and every row it rejected, with the reason. '
    + 'You confirm after reading it.');
  line('Where the money figures go',
    'They are not on this sheet on purpose. Fees, VAT, GP and GP % are computed on upload and '
    + 'appear on the Sales Report, which is also where you can carry on typing sales by hand.');
  rm.getRow(1).height = 22;

  await wb.xlsx.writeFile(`${OUT}/${FILE}`);
  copyFileSync(`${OUT}/${FILE}`, `${PUBLIC_OUT}/${FILE}`);
  console.log(`${FILE} — ${BULK_SOLD_HEADERS.length} columns, ${BLANK_ROWS} blank rows`);
}

main().catch(err => { console.error(err); process.exit(1); });
