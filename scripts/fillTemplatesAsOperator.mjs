/**
 * scripts/fillTemplatesAsOperator.mjs — do what the SOP tells an operator to do.
 *
 * Opens the SHIPPED templates (not a copy of their layout, the actual files
 * the app hands out), deletes the grey example rows as rule 1 says, types in
 * real data, and saves. The result is what lands on the import screen when
 * someone follows the procedure — README sheet still attached, dropdowns
 * still attached, column order untouched.
 *
 * Output goes to templates/filled-examples/, and scripts/e2eTemplateFillAndUpload.mjs
 * uploads it through the real UI. Anything the fill gets wrong the upload
 * will catch, which is the point: this is not a mock of the schema, it IS
 * the schema.
 *
 * Run: node scripts/fillTemplatesAsOperator.mjs
 */
import ExcelJS from 'exceljs';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

const SRC = 'templates';
const OUT = 'templates/filled-examples';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── The data an operator would actually type ────────────────────────────────
// Values come only from the SOP's accepted lists — Grade, Storage, SIM Type.
// Anything outside them would still import, but wouldn't group on any screen,
// so a worked example must not demonstrate it.

const MODELS = [
  ['IPHONE 13', '128GB', 'MIDNIGHT'],
  ['IPHONE 13 PRO', '256GB', 'GRAPHITE'],
  ['IPHONE 14', '128GB', 'STARLIGHT'],
  ['SAMSUNG GALAXY S22', '128GB', 'GREEN'],
  ['GOOGLE PIXEL 7', '128GB', 'BLACK'],
];
const GRADES = ['A', 'B', 'C', 'ONU', 'Brand new'];
const SIMS = ['Physical SIM', 'Physical SIM + eSIM', 'Dual Physical SIM', 'Not Applicable'];
const SUPPLIERS = ['MOBILE WHOLESALE LTD', 'NORTHSIDE STOCK', 'CELLHUB TRADING'];

const OFFICE_COUNT = 34;
const SHS_COUNT = 6;
const TOTAL_STOCK = OFFICE_COUNT + SHS_COUNT;

/** 15-digit IMEIs, unique and stable across runs. */
const imeiFor = (n) => String(350900000000000 + n);

/** Every stock row, office first then SHS — the order an operator would type. */
const stockRows = Array.from({ length: TOTAL_STOCK }, (_, i) => {
  const [model, storage, colour] = MODELS[i % MODELS.length];
  const shs = i >= OFFICE_COUNT;
  const day = 10 + (i % 15);
  return {
    dateIn: `2026-07-${String(day).padStart(2, '0')}`,
    model,
    imei: imeiFor(i + 1),
    grade: GRADES[i % GRADES.length],
    storage,
    simType: SIMS[i % SIMS.length],
    colour,
    supplier: SUPPLIERS[i % SUPPLIERS.length],
    bp: 200 + (i % 20) * 7.25,
    stockType: shs ? 'SHS' : 'OFFICE',
    notes: shs ? 'awaiting delivery' : '',
  };
});

/**
 * Sales, spread across all five channels. Most sell office stock; the last one
 * sells a phone the supplier still holds, which is the case worth proving —
 * it has to drop SHS, not office.
 */
const SALES_PLAN = [
  { marketplace: 'AMAZON', count: 6 },
  { marketplace: 'BM', count: 5 },
  { marketplace: 'EBAY', count: 5 },
  { marketplace: 'ONBUY', count: 4 },
  { marketplace: 'TEMU', count: 4 },
];
const OFFICE_SOLD = SALES_PLAN.reduce((n, p) => n + p.count, 0);
const SHS_SALE_INDEX = OFFICE_COUNT; // first SHS unit

const salesRows = [];
{
  let unit = 0;
  for (const { marketplace, count } of SALES_PLAN) {
    for (let i = 0; i < count; i++) {
      const row = stockRows[unit];
      salesRows.push({
        marketplace,
        date: `2026-07-${String(20 + (unit % 8)).padStart(2, '0')}`,
        orderNumber: `${marketplace}-${9000 + unit}`,
        sku: `${row.model.replace(/\s+/g, '')}-${row.storage}`,
        imei: row.imei,
        supplier: row.supplier,
        quantity: 1,
        bp: row.bp,
        sp: Math.round((row.bp * 1.38 + 20) * 100) / 100,
        postage: 8,
        // Temu is the one channel where the operator TYPES the commission:
        // its referral rate varies by category, so the Temu export reports
        // the fee actually charged per order rather than a flat percentage
        // the app could derive. Left blank these would silently exercise
        // the 7% fallback, which is not what a real Temu file looks like.
        ...(marketplace === 'TEMU'
          ? (() => {
              const rate = [4.6, 5.5, 7, 8.2][i % 4];
              const com = Math.round(row.bp * 1.38 * rate) / 100;
              return { commission: com, commissionVat: Math.round(com * 20) / 100 };
            })()
          : {}),
      });
      unit++;
    }
  }
  // The supplier-held one, on Amazon.
  const shsUnit = stockRows[SHS_SALE_INDEX];
  salesRows.push({
    marketplace: 'AMAZON',
    date: '2026-07-28',
    orderNumber: 'AMAZON-9999',
    sku: `${shsUnit.model.replace(/\s+/g, '')}-${shsUnit.storage}`,
    imei: shsUnit.imei,
    supplier: shsUnit.supplier,
    quantity: 1,
    bp: shsUnit.bp,
    sp: Math.round((shsUnit.bp * 1.38 + 20) * 100) / 100,
    postage: 8,
  });
}

// ── Filling, the way Excel does it ──────────────────────────────────────────

/**
 * Delete the example rows below the header, leaving everything else — the
 * README sheet, the dropdown validations, the column widths — exactly as
 * shipped. Returns how many were removed.
 */
function clearExampleRows(ws) {
  let last = 1;
  for (let r = 2; r <= ws.rowCount; r++) {
    const v = ws.getRow(r).getCell(1).value;
    if (v === null || v === undefined || String(v).trim() === '') break;
    last = r;
  }
  const removed = last - 1;
  if (removed > 0) ws.spliceRows(2, removed);
  return removed;
}

/** Write values into a row without disturbing the sheet's styling. */
function writeRow(ws, rowNumber, values) {
  const row = ws.getRow(rowNumber);
  values.forEach((v, i) => { row.getCell(i + 1).value = v === '' ? null : v; });
  row.commit();
}

/** Column index (1-based) of a header, matched the way the importer does. */
function colOf(ws, header) {
  const headerRow = ws.getRow(1);
  const want = header.trim().toLowerCase();
  for (let c = 1; c <= headerRow.cellCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim().toLowerCase() === want) return c;
  }
  throw new Error(`template has no "${header}" column — schema drift`);
}

async function fillStockTemplate(srcFile, outFile, rows, label) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`${SRC}/${srcFile}`);
  const ws = wb.getWorksheet('INVENTORY');
  const removed = clearExampleRows(ws);

  // Build each row positionally FROM THE HEADER, never from a hard-coded
  // order — if the template's columns ever move, this fills the wrong cells
  // loudly (colOf throws) instead of quietly.
  const cols = {
    dateIn: colOf(ws, 'Stock In Date'), model: colOf(ws, 'Model'), imei: colOf(ws, 'IMEI'),
    grade: colOf(ws, 'Grade'), storage: colOf(ws, 'Storage'), simType: colOf(ws, 'SIM Type'),
    colour: colOf(ws, 'Colour'), supplier: colOf(ws, 'Supplier'), bp: colOf(ws, 'BP'),
    stockType: colOf(ws, 'Stock Type'), notes: colOf(ws, 'Notes'),
  };
  const width = Math.max(...Object.values(cols));

  rows.forEach((r, i) => {
    const values = new Array(width).fill('');
    for (const [field, c] of Object.entries(cols)) values[c - 1] = r[field];
    writeRow(ws, 2 + i, values);
  });

  await wb.xlsx.writeFile(`${OUT}/${outFile}`);
  console.log(`${OUT}/${outFile} — ${removed} example rows removed, ${rows.length} ${label} rows typed in`);
}

async function fillSalesTemplate(srcFile, outFile, sheetName, rows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`${SRC}/${srcFile}`);
  const ws = wb.getWorksheet(sheetName);
  const removed = clearExampleRows(ws);

  // Header names differ per marketplace — resolve each through the same
  // aliases the importer accepts rather than assuming one spelling.
  const find = (...names) => {
    for (const n of names) {
      try { return colOf(ws, n); } catch { /* try the next spelling */ }
    }
    return null;
  };
  const cols = {
    date: find('Date', 'DATE', 'nw'),
    orderNumber: find('Order Number', 'ORDER NUMBER', 'Order No'),
    sku: find('SKU'),
    imei: find('IMEI', 'IMEI NUMBER'),
    supplier: find('Supplier', 'SUPPLIER'),
    quantity: find('Quantity', 'UNITS'),
    bp: find('BP'), sp: find('SP'),
    postage: find('Postage', 'SHIPPING', 'SHIP'),
    // TEMU only — every other channel derives these, and only TEMU rows
    // carry the fields, so the writer's `!== undefined` guard skips them.
    commission: find('Commission'),
    commissionVat: find('Commission VAT'),
  };
  const width = Math.max(...Object.values(cols).filter(Boolean));

  rows.forEach((r, i) => {
    const values = new Array(width).fill('');
    for (const [field, c] of Object.entries(cols)) {
      if (c && r[field] !== undefined) values[c - 1] = r[field];
    }
    writeRow(ws, 2 + i, values);
  });

  await wb.xlsx.writeFile(`${OUT}/${outFile}`);
  console.log(`${OUT}/${outFile} — ${removed} example rows removed, ${rows.length} ${sheetName} sales typed in`);
}

await fillStockTemplate('INVENTORY_REPORT_TEMPLATE.xlsx', 'FILLED_INVENTORY.xlsx', stockRows, 'stock');
await fillStockTemplate(
  'SHS_STOCK_TEMPLATE.xlsx', 'FILLED_SHS_STOCK.xlsx',
  stockRows.filter(r => r.stockType === 'SHS'), 'SHS',
);

for (const { marketplace } of SALES_PLAN) {
  await fillSalesTemplate(
    `SALES_${marketplace}_TEMPLATE.xlsx`,
    `FILLED_SALES_${marketplace}.xlsx`,
    marketplace,
    salesRows.filter(s => s.marketplace === marketplace),
  );
}

// The combined workbook — same rows, one sheet per channel.
{
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`${SRC}/SALES_REPORT_TEMPLATE.xlsx`);
  for (const { marketplace } of SALES_PLAN) {
    const ws = wb.getWorksheet(marketplace);
    clearExampleRows(ws);
  }
  await wb.xlsx.writeFile(`${OUT}/_tmp.xlsx`);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(`${OUT}/_tmp.xlsx`);
  for (const { marketplace } of SALES_PLAN) {
    const ws = wb2.getWorksheet(marketplace);
    const find = (...names) => {
      for (const n of names) {
        try { return colOf(ws, n); } catch { /* next */ }
      }
      return null;
    };
    const cols = {
      date: find('Date', 'DATE', 'nw'),
      orderNumber: find('Order Number', 'ORDER NUMBER', 'Order No'),
      sku: find('SKU'), imei: find('IMEI', 'IMEI NUMBER'),
      supplier: find('Supplier', 'SUPPLIER'),
      quantity: find('Quantity', 'UNITS'),
      bp: find('BP'), sp: find('SP'),
      postage: find('Postage', 'SHIPPING', 'SHIP'),
      // TEMU only — see the note in fillSalesTemplate above.
      commission: find('Commission'),
      commissionVat: find('Commission VAT'),
    };
    const width = Math.max(...Object.values(cols).filter(Boolean));
    salesRows.filter(s => s.marketplace === marketplace).forEach((r, i) => {
      const values = new Array(width).fill('');
      for (const [field, c] of Object.entries(cols)) {
        if (c && r[field] !== undefined) values[c - 1] = r[field];
      }
      writeRow(ws, 2 + i, values);
    });
  }
  await wb2.xlsx.writeFile(`${OUT}/FILLED_SALES_COMBINED.xlsx`);
  // Scratch round-trip file — ExcelJS needs the write/read to materialise the
  // cleared sheets. It is not a deliverable, so don't leave it in templates/.
  rmSync(`${OUT}/_tmp.xlsx`, { force: true });
  console.log(`${OUT}/FILLED_SALES_COMBINED.xlsx — ${salesRows.length} sales across ${SALES_PLAN.length} sheets`);
}

console.log(`\nExpected after uploading inventory then sales:`);
console.log(`  office ${OFFICE_COUNT} → ${OFFICE_COUNT - OFFICE_SOLD}   (${OFFICE_SOLD} sold from the shelf)`);
console.log(`  SHS    ${SHS_COUNT} → ${SHS_COUNT - 1}     (1 shipped direct by the supplier)`);
console.log(`  sold   ${salesRows.length}   ·   sales ${salesRows.length}`);
