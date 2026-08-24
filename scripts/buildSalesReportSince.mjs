/**
 * scripts/buildSalesReportSince.mjs — cut an upload-ready Sales Report out of
 * the client's own workbook, from a date onward.
 *
 * WHY
 *
 * The operator stopped updating the app on a given date and kept working in
 * their spreadsheet. Re-uploading the whole file would re-present thousands of
 * already-imported rows — which the importer handles (it is idempotent), but
 * which buries the rows that actually need attention in a preview of several
 * thousand, and makes any warning impossible to read. So: take only the rows
 * from the cutoff, in the app's own schema.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not invent anything. The client's file has no Model / Colour /
 * Storage columns, and those are left EMPTY rather than guessed from the SKU
 * code — a guessed model is exactly the kind of near-duplicate the import gate
 * exists to keep out. Rows whose IMEI matches stock already on file reconcile
 * on their own; anything else becomes a completion row the operator resolves
 * against the catalogue, with the near-miss suggestions to hand.
 *
 * THE RETURN COLUMN IS NOT AN OUTCOME COLUMN
 *
 * The client's AMAZON and TEMU tabs carry a single free-text "RETURN" column.
 * On a real sample it holds "RETURN FOR REFUND", but also "RM 1ST CLASS" (a
 * postage service) and "SAME TRACKING NUMBER" (a shipping note). Mapping it
 * onto the app's Outcome column would void sales that were never returned, so
 * the text is carried into Comments — lossless, and claiming nothing. Genuine
 * returns need a Return Date, which the client's file does not have, and are
 * reported at the end for the operator to decide on.
 *
 * Usage:
 *   node scripts/buildSalesReportSince.mjs <source.xlsx> <YYYY-MM-DD> [out.xlsx]
 */
import ExcelJS from 'exceljs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
// --until closes the window at the far end. Without it the cut runs to the end
// of the file, which is what the first use of this script wanted; with it the
// same tool fills a HOLE in the middle — the case that showed up once the app's
// own numbers were compared against the source and a fortnight was missing.
const UNTIL = flag('--until');
const positional = args.filter((a, i) => a !== '--until' && args[i - 1] !== '--until');
const [SRC, SINCE, OUT_ARG] = positional;
if (!SRC || !SINCE) {
  console.error('usage: node scripts/buildSalesReportSince.mjs <source.xlsx> <YYYY-MM-DD> [out.xlsx] [--until YYYY-MM-DD]');
  process.exit(2);
}
const OUT = resolve(OUT_ARG || `SALES_REPORT_SINCE_${SINCE}.xlsx`);
const TEMPLATE = resolve('templates/SALES_REPORT_TEMPLATE.xlsx');
const [sy, sm, sd] = SINCE.split('-').map(Number);
const CUTOFF = new Date(Date.UTC(sy, sm - 1, sd));
// Inclusive of the whole --until day, so "--until 2026-08-16" keeps every sale
// dated the 16th rather than stopping at its midnight.
const END = UNTIL
  ? (() => { const [y, m, d] = UNTIL.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 23, 59, 59)); })()
  : null;

/**
 * Which of the client's tabs is which marketplace.
 *
 * Matched on a prefix rather than equality: the live file names them "AMAZON
 * SALES", "BM SALES" and so on, while the app's schema uses the bare
 * marketplace name, and a future export could reasonably do either.
 */
const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];
const marketplaceOf = (sheetName) => {
  const n = String(sheetName || '').trim().toUpperCase();
  return MARKETPLACES.find(m => n === m || n.startsWith(`${m} `) || n.startsWith(`${m}_`)) || null;
};

/**
 * Header aliases, so the client's spelling lands in the app's column.
 *
 * Deliberately narrow — a loose match here silently files one column's numbers
 * under another's name, which is invisible until a money figure is wrong.
 * Anything not listed is matched case-insensitively on the exact text.
 */
const HEADER_ALIAS = new Map(Object.entries({
  'order no': 'Order Number',
  'imei number': 'IMEI',
  'gp%': 'GP %',
  'units': 'Units',
}));

const normHeader = (h) => {
  const t = String(h ?? '').trim();
  const alias = HEADER_ALIAS.get(t.toLowerCase());
  return alias || t;
};

/** ExcelJS hands back formulas, rich text and hyperlinks as objects. */
const cellValue = (cell) => {
  const v = cell.value;
  if (v == null) return null;
  if (typeof v === 'object') {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if (v instanceof Date) return v;
  }
  return v;
};

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
/** The client types dates as text ("17-Aug-2026", "17-August-2026") on some
 *  tabs and as real dates on others, so both have to parse — and a row whose
 *  date cannot be read must never be silently dropped from a date filter. */
function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]+)[-/ ](\d{4})$/);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mo >= 0) return new Date(Date.UTC(+m[3], mo, +m[1]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const iso = (d) => d.toISOString().slice(0, 10);

// ── Read the source ─────────────────────────────────────────────────────────

const src = new ExcelJS.Workbook();
await src.xlsx.readFile(resolve(SRC));

const out = new ExcelJS.Workbook();
await out.xlsx.readFile(TEMPLATE);

const report = [];
const returnsNoted = [];
const unparsedDates = [];
let grandTotal = 0;

for (const ws of src.worksheets) {
  const marketplace = marketplaceOf(ws.name);
  if (!marketplace) continue;

  const dest = out.getWorksheet(marketplace);
  if (!dest) throw new Error(`template has no "${marketplace}" sheet`);

  // Source headers, by column index. Column A on the AMAZON tab has NO header
  // at all in the live file — it is the date column and always has been — so
  // an unnamed column 1 is treated as Date rather than dropped.
  const srcHeaderRow = ws.getRow(1);
  const srcHeaders = new Map();          // column index -> normalised name
  for (let c = 1; c <= ws.columnCount; c++) {
    const raw = String(cellValue(srcHeaderRow.getCell(c)) ?? '').trim();
    if (!raw && c === 1) { srcHeaders.set(c, 'Date'); continue; }
    if (raw) srcHeaders.set(c, normHeader(raw));
  }

  const destHeaders = new Map();         // normalised name -> column index
  const destHeaderRow = dest.getRow(1);
  for (let c = 1; c <= dest.columnCount; c++) {
    const raw = String(cellValue(destHeaderRow.getCell(c)) ?? '').trim();
    if (raw) destHeaders.set(raw.toLowerCase(), c);
  }
  const destCol = (name) => destHeaders.get(String(name).toLowerCase());

  // Blank every row below the header, keeping the header's formatting. The
  // template ships 200 primed rows carrying guarded formulas; those would
  // otherwise sit under the real data and be read as blank sales.
  for (let r = 2; r <= dest.rowCount; r++) dest.getRow(r).values = [];

  const unmapped = new Set();
  let written = 0;

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const orderNumber = String(cellValue(row.getCell(2)) ?? '').trim();
    if (!orderNumber) continue;                       // spacer / total row

    const rawDate = cellValue(row.getCell(1));
    const d = toDate(rawDate);
    if (!d) { unparsedDates.push(`${ws.name} r${r} "${rawDate}"`); continue; }
    if (d < CUTOFF) continue;
    if (END && d > END) continue;

    written++;
    const destRow = dest.getRow(written + 1);

    for (const [srcIdx, name] of srcHeaders) {
      const v = cellValue(row.getCell(srcIdx));
      if (v == null || v === '') continue;

      // The free-text RETURN column has no counterpart in the app's schema —
      // and must not be mapped onto Outcome. See the header comment.
      if (name.toUpperCase() === 'RETURN') {
        const cCom = destCol('Comments');
        if (cCom) {
          const existing = String(destRow.getCell(cCom).value ?? '').trim();
          destRow.getCell(cCom).value = existing ? `${existing} · ${v}` : String(v);
        }
        returnsNoted.push({ marketplace, row: r, orderNumber, note: String(v), date: iso(d) });
        continue;
      }

      const c = destCol(name);
      if (!c) { unmapped.add(name); continue; }
      // Dates go in as real dates so the app's parser and Excel agree on them.
      destRow.getCell(c).value = name === 'Date' ? d : v;
    }
    destRow.commit();
  }

  grandTotal += written;
  report.push({ marketplace, sheet: ws.name, written, unmapped: [...unmapped] });
}

// The README tab is guidance for a blank template and says nothing true about
// a file cut from real data.
const readme = out.getWorksheet('README');
if (readme) out.removeWorksheet(readme.id);

await out.xlsx.writeFile(OUT);

// ── What was produced ───────────────────────────────────────────────────────

console.log(`\nSales Report ${SINCE}${UNTIL ? ` … ${UNTIL}` : ' onward'} → ${OUT}\n`);
for (const r of report) {
  console.log(`  ${r.marketplace.padEnd(7)} ${String(r.written).padStart(4)} rows   (from "${r.sheet}")`
    + (r.unmapped.length ? `\n      columns with no home in the app schema, dropped: ${r.unmapped.join(', ')}` : ''));
}
console.log(`  ${''.padEnd(7)} ${String(grandTotal).padStart(4)} rows total`);

if (unparsedDates.length) {
  console.log(`\n  ${unparsedDates.length} row(s) had a date that could not be read and were SKIPPED:`);
  unparsedDates.slice(0, 20).forEach(s => console.log(`     ${s}`));
}

if (returnsNoted.length) {
  console.log(`\n  ${returnsNoted.length} row(s) carried a RETURN note. Copied into Comments, NOT`);
  console.log(`  treated as returns — the app needs a Return Date, which the source has not got:`);
  for (const n of returnsNoted) {
    console.log(`     ${n.marketplace} ${n.date} ${n.orderNumber} — "${n.note}"`);
  }
}
