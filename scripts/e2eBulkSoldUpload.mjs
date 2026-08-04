/**
 * e2eBulkSoldUpload — the bulk-sold round trip, end to end in a real browser.
 *
 * Downloads nothing and assumes nothing: reads the units actually in stock out
 * of the running app, fills the REAL BULK_SOLD_TEMPLATE with a mix of rows
 * that should sell and rows that must be refused, uploads it through the
 * Mark Sold from Sheet button, and then checks the store to see what actually
 * changed.
 *
 * The refusals matter more than the sales. A sheet that can sell a handset
 * twice, or sell one that was never in stock, corrupts the ledger silently.
 *
 * Run (preview server up):
 *   node scripts/e2eBulkSoldUpload.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const OUT = 'e2e-screenshots/bulk-sold-upload';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const FILLED = resolve(OUT, 'BULK_SOLD_FILLED.xlsx');

const results = [];
let shotN = 0;
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const shot = (page, name) =>
  page.screenshot({ path: `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`, fullPage: true });

const dumpStore = (page) => page.evaluate(() => {
  const raw = sessionStorage.getItem('__e2e_firestore__');
  return raw ? JSON.parse(raw) : {};
});

async function gotoTab(page, label) {
  const re = new RegExp(`^(\\d+\\s*)?${label}\\b(?! Report)`, 'i');
  for (let i = 0; i < 4; i++) {
    if (await page.getByRole('button', { name: re }).first().isVisible().catch(() => false)) break;
    await page.getByLabel('Open menu').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.getByRole('button', { name: re }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
}

/** Fill the real template — same file the operator downloads. */
async function fillTemplate(rows) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/BULK_SOLD_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('BULK SOLD');
  // Row 2 is the worked example — type over it, exactly as the README says.
  rows.forEach((r, i) => {
    const row = ws.getRow(2 + i);
    row.getCell(1).value = r.imei;
    row.getCell(2).value = r.marketplace;
    row.getCell(3).value = r.orderNumber;
    row.getCell(4).value = r.salePrice;
    row.getCell(5).value = null;
    row.getCell(6).value = r.postage ?? null;
    row.getCell(7).value = null;
    row.getCell(8).value = r.comments ?? null;
    row.commit();
  });
  await wb.xlsx.writeFile(FILLED);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => record('no JS runtime errors', false, e.message));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // ── Pick real stock to sell ──────────────────────────────────────────────
  const before = await dumpStore(page);
  const units = Object.values(before.inventoryUnits ?? {});
  const sellable = units.filter(u =>
    u.imei && (u.status === 'available' || u.status === 'incoming'
      || (u.returnType === 'returned_to_inventory' && u.status !== 'sold')));
  const alreadySold = units.find(u => u.imei && u.status === 'sold');
  record('the seeded app has stock to sell', sellable.length >= 3, `${sellable.length} sellable units`);
  if (sellable.length < 3) { await browser.close(); process.exitCode = 1; return; }

  const [a, b, c] = sellable;
  const ROWS = [
    { imei: a.imei, marketplace: 'AMAZON', orderNumber: 'BULK-SHEET-1', salePrice: 411.11, postage: 8 },
    { imei: b.imei, marketplace: 'EBAY',   orderNumber: 'BULK-SHEET-2', salePrice: 222.22 },
    // Same order number as row 2 — a multi-handset order, which must be allowed.
    { imei: c.imei, marketplace: 'EBAY',   orderNumber: 'BULK-SHEET-2', salePrice: 333.33 },
    // Everything below must be REFUSED.
    { imei: a.imei, marketplace: 'AMAZON', orderNumber: 'BULK-DUP',    salePrice: 99 },   // duplicate
    { imei: '359999999999999', marketplace: 'AMAZON', orderNumber: 'BULK-GHOST', salePrice: 99 }, // not in stock
    { imei: b.imei, marketplace: 'GUMTREE', orderNumber: 'BULK-BADMKT', salePrice: 99 },  // bad marketplace
    { imei: c.imei, marketplace: 'AMAZON', orderNumber: '',            salePrice: 99 },   // no order number
    ...(alreadySold ? [{ imei: alreadySold.imei, marketplace: 'AMAZON', orderNumber: 'BULK-SOLD', salePrice: 99 }] : []),
  ];
  const expectedSold = 3;
  const expectedRefused = ROWS.length - expectedSold;
  await fillTemplate(ROWS);
  console.log(`  filled ${ROWS.length} rows — ${expectedSold} sellable, ${expectedRefused} must be refused`);

  // ── Upload it the way an operator does ───────────────────────────────────
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /Mark Sold from Sheet/i }).first().click();
  await page.waitForTimeout(800);
  await shot(page, 'upload-prompt');

  await page.locator('input[type="file"]').first().setInputFiles(FILLED);
  await page.waitForTimeout(2500);
  await shot(page, 'preview-accepted-and-refused');

  const previewText = await page.locator('div.fixed.inset-0').last().innerText();
  const willSell = Number((previewText.match(/(\d+)\s*will be marked sold/i) ?? [])[1] ?? -1);
  const cannot = Number((previewText.match(/(\d+)\s*cannot be/i) ?? [])[1] ?? 0);
  record('the preview offers to sell exactly the sellable rows', willSell === expectedSold,
    `offered ${willSell}, expected ${expectedSold}`);
  record('the preview refuses every bad row', cannot === expectedRefused,
    `refused ${cannot}, expected ${expectedRefused}`);

  for (const [label, re] of [
    ['the duplicate IMEI', /already on row/i],
    ['the IMEI that is not in stock', /no unit in stock/i],
    ['the unknown marketplace', /not a marketplace/i],
    ['the missing order number', /no order number/i],
    ...(alreadySold ? [['the unit already sold', /already marked sold/i]] : []),
  ]) {
    record(`the preview names why it refused ${label}`, re.test(previewText));
  }

  // Nothing may have been written yet.
  const midway = await dumpStore(page);
  record('nothing is written before Confirm',
    Object.values(midway.sales ?? {}).filter(s => String(s.orderNumber || '').startsWith('BULK-')).length === 0);

  // ── Confirm ──────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /Mark \d+ sold/i }).click();
  await page.waitForTimeout(4000);
  await shot(page, 'done');
  const doneText = await page.locator('div.fixed.inset-0').last().innerText();
  record('the done screen reports what it wrote', /\d+ marked sold/i.test(doneText),
    (doneText.match(/\d+ marked sold[^\n]*/i) ?? [])[0] ?? doneText.slice(0, 80));

  await page.getByRole('button', { name: /^Close$/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);

  // ── What actually changed ────────────────────────────────────────────────
  const after = await dumpStore(page);
  const afterUnits = Object.values(after.inventoryUnits ?? {});
  const newSales = Object.values(after.sales ?? {})
    .filter(s => String(s.orderNumber || '').startsWith('BULK-SHEET-'));

  record('one sale doc per sold row, and no more', newSales.length === expectedSold,
    `${newSales.length} sale docs`);
  record('the three units are now marked sold',
    [a, b, c].every(u => afterUnits.find(x => x.imei === u.imei)?.status === 'sold'),
    [a, b, c].map(u => `${u.imei}=${afterUnits.find(x => x.imei === u.imei)?.status}`).join(' '));
  record('no sale was written for any refused row',
    Object.values(after.sales ?? {}).every(s =>
      !['BULK-DUP', 'BULK-GHOST', 'BULK-BADMKT', 'BULK-SOLD'].includes(String(s.orderNumber || ''))));
  record('one order covering two handsets produced two sales under that order',
    newSales.filter(s => s.orderNumber === 'BULK-SHEET-2').length === 2);

  const first = newSales.find(s => s.orderNumber === 'BULK-SHEET-1');
  record('the sale carries the sheet\'s sale price', Number(first?.salePrice) === 411.11,
    `salePrice=${first?.salePrice}`);
  record('the sale carries its VAT lines, like any other in-app sale',
    typeof first?.totalVat === 'number' && typeof first?.grossProfit === 'number',
    `totalVat=${first?.totalVat} grossProfit=${first?.grossProfit}`);

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

let browser;
run().catch(async e => {
  console.error(e);
  process.exitCode = 1;
  await browser?.close().catch(() => {});
});
