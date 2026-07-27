/**
 * scripts/e2eAccessoryReuploadReconcile.mjs — does re-uploading a Sales
 * Report that already reconciled an accessory sale do the right thing the
 * SECOND time, and does the accessory pool survive a full wipe + re-upload
 * like everything else in the app?
 *
 * e2eAccessoryStock.mjs already proves the first-time flow: add a SKU pool,
 * import one sale, the pool decrements. It never re-uploads. This script
 * covers the two questions that only show up on a second pass:
 *
 *   A. Re-importing the EXACT SAME Sales Report a second time (without a
 *      wipe in between) — does the accessory pool decrement AGAIN (bug:
 *      -4 instead of -2) or correctly no-op (by design, per the comment in
 *      SalesReportImport.tsx: accessory decrement is scoped to
 *      preview.toCreate only, since a re-import re-lands the same sales as
 *      preview.toUpdate)? Already correct — proven below.
 *
 *   B. The standard reconciliation round trip used everywhere else in this
 *      app — download the current reports, wipe the database, re-upload
 *      both files — does the accessory pool come back? Originally NO: a
 *      real gap was found and documented (accessoryStock was included in
 *      every wipe scope but never in the Inventory Report export/import
 *      schema). NOW FIXED: the Inventory Report exports an "Accessories"
 *      sheet carrying `totalReceived` (cumulative intake, never decremented
 *      by a sale — see AccessoryStock in types.ts), and re-importing it
 *      recreates any missing pool at that gross figure via
 *      restoreAccessoryStockFromImport (CREATE-only, never clobbers a live
 *      pool). The accompanying Sales Report re-upload then nets it back
 *      down to the exact pre-wipe quantity via the ordinary
 *      decrement-on-first-import path — the same "Inventory Report gives
 *      the gross baseline, Sales Report replay nets it down" pattern
 *      regular units already use.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAccessoryReuploadReconcile.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-reupload-reconcile';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'USB-C-20W';
const ACCESSORY_NAME = 'USB-C 20W Charger';
const ADD_QTY = 50;
const ADD_BP = 3.5;
const SALE_QTY = 2;
const SALES_FILE = resolve(`${OUT}/sales-accessory.xlsx`);

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  console.log(`      ↳ ${file}`);
}
function modal(page) {
  return page.locator('div.fixed.inset-0').last();
}
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function gotoTab(page, label) {
  await dismissModals(page);
  const re = new RegExp(`^${label}(\\s|$)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
}
async function gotoInventoryTabViaDrawer(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click().catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^Inventory$/i }).first().click();
  await page.waitForTimeout(900);
  await dismissModals(page);
}
// The app's content scrolls inside an inner <main class="overflow-y-auto">
// container, not the page/body — a fullPage screenshot only ever captures
// whatever was scrolled into view immediately beforehand. The Accessory
// Stock panel sits below Models Catalog on Configuration, so it must be
// scrolled to explicitly before every screenshot that's meant to show it.
async function scrollToAccessoryPanel(page) {
  const heading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
  await heading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
}
async function gotoAdminSub(page, label) {
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(700);
}
async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}
async function wipeAll(page) {
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Wipe$/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Wipe All/i }).click();
  await page.waitForTimeout(600);
  await page.getByText(/I understand this will delete all inventory data/i).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(2500);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      accessoryStock: Object.values(s.accessoryStock || {}),
      sales: Object.values(s.sales || {}),
      units: Object.values(s.inventoryUnits || {}),
    };
  });
}
async function importSalesFile(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  const amazonPicker = modal(page).getByRole('button', { name: /^Amazon$/i }).first();
  if (await amazonPicker.isVisible().catch(() => false)) { await amazonPicker.click(); await page.waitForTimeout(400); }
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3500);
}

/** Same accessory sale row every time — a genuine re-upload of the same file. */
async function buildAccessorySalesFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
  ws.getRow(2).values = [
    '2026-07-22', 'ACC-REUP-9001', SKU, '', 'MOBILE WHOLESALE LTD',
    SALE_QTY, ADD_BP, 8.99, '', '', '', 0, '', '', '',
  ];
  await wb.xlsx.writeFile(SALES_FILE);
}

async function run() {
  await buildAccessorySalesFile();

  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  // ══ 1. Create the accessory pool ═════════════════════════════════════════
  console.log('\n── 1. Add Stock → Accessories: 50 x USB-C 20W Charger ──');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  await modal(page).locator('input[placeholder="e.g. USB-C-20W"]').first().fill(SKU);
  await modal(page).locator('input[placeholder="e.g. USB-C 20W Charger"]').first().fill(ACCESSORY_NAME);
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill(String(ADD_QTY));
  await modal(page).locator('input[placeholder="0.00"]').first().fill(String(ADD_BP));
  await page.waitForTimeout(300);
  await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  const afterAdd = await readStore(page);
  const poolStart = afterAdd.accessoryStock.find(a => a.sku === SKU);
  record(`Accessory pool created: ${SKU} x ${ADD_QTY}`, poolStart?.quantity === ADD_QTY, `quantity=${poolStart?.quantity}`);

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-created-50-units');

  // ══ 2. First import: sells 2, pool should drop to 48 ════════════════════
  console.log('\n── 2. First import of the Sales Report — sells 2 ──');
  await importSalesFile(page, SALES_FILE);
  await shot(page, 'first-import-preview');
  const confirm1 = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirm1.click();
  await page.waitForTimeout(4000);
  await shot(page, 'first-import-done');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterFirst = await readStore(page);
  const poolAfterFirst = afterFirst.accessoryStock.find(a => a.sku === SKU);
  record(`After 1st import: pool = ${ADD_QTY - SALE_QTY} (${ADD_QTY} - ${SALE_QTY})`,
    poolAfterFirst?.quantity === ADD_QTY - SALE_QTY, `quantity=${poolAfterFirst?.quantity}`);

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-after-first-import-48-units');

  // ══ 3. QUESTION A — re-upload the SAME file again, no wipe in between ════
  console.log('\n── 3. Re-upload the EXACT SAME Sales Report a second time (no wipe) ──');
  await importSalesFile(page, SALES_FILE);
  await page.waitForTimeout(500);
  await shot(page, 'second-import-same-file-preview');
  const previewText2 = await modal(page).innerText().catch(() => '');
  record('Re-import preview recognises this as an already-seen sale (0 to create / re-confirm path), not a fresh one',
    /already|re-confirm|0 new/i.test(previewText2), previewText2.match(/.{0,80}(already|re-confirm|0 new).{0,80}/i)?.[0]);

  const confirm2 = modal(page).getByRole('button', { name: /Load|Confirm|record|Re-confirm/i }).last();
  await confirm2.click();
  await page.waitForTimeout(4000);
  await shot(page, 'second-import-done');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterSecond = await readStore(page);
  const poolAfterSecond = afterSecond.accessoryStock.find(a => a.sku === SKU);
  const salesForSku = afterSecond.sales.filter(s => (s.sku || '') === SKU);
  record(`QUESTION A — pool does NOT double-decrement on re-upload: still ${ADD_QTY - SALE_QTY} (not ${ADD_QTY - SALE_QTY * 2})`,
    poolAfterSecond?.quantity === ADD_QTY - SALE_QTY,
    `quantity=${poolAfterSecond?.quantity} (would be ${ADD_QTY - SALE_QTY * 2} if double-decremented)`);
  record('Exactly one sale record exists for this SKU/order after both imports (no duplicate row)',
    salesForSku.length === 1, `count=${salesForSku.length}`);

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-after-second-import-still-48-units');

  // ══ 4. QUESTION B — standard wipe+reupload round trip ════════════════════
  // Now FIXED: the Inventory Report exports an "Accessories" sheet (Total
  // Added = cumulative intake, never decremented by a sale), and importing
  // it recreates any missing pool at that gross figure. The Sales Report
  // re-upload then nets it back down via the ordinary decrement-on-first
  // -import path — same "gross baseline + sales replay nets it" pattern
  // regular units already use.
  console.log('\n── 4. Download the REAL Inventory Report, wipe, re-upload both ──');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(500);
  const invReportBtn = page.getByRole('button', { name: /^Inventory Report$/i }).first();
  const [invDownload0] = await Promise.all([
    page.waitForEvent('download').catch(() => null),
    invReportBtn.click().catch(() => {}),
  ]);
  let invDl = invDownload0;
  if (!invDl) {
    await page.waitForTimeout(400);
    const allTime = page.getByRole('button', { name: /All Time/i }).first();
    if (await allTime.isVisible().catch(() => false)) {
      [invDl] = await Promise.all([
        page.waitForEvent('download').catch(() => null),
        allTime.click().catch(() => {}),
      ]);
    }
  }
  const invDownloadedFile = resolve(`${OUT}/downloaded-inventory-report.xlsx`);
  if (invDl) await invDl.saveAs(invDownloadedFile);
  record('Downloaded the real Inventory Report from the app', !!invDl);
  await dismissModals(page);

  await wipeAll(page);
  await shot(page, 'after-wipe-empty');

  // Re-upload the Inventory Report FIRST (establishes the gross baseline),
  // exactly the order the operator already follows for everything else.
  if (invDl) {
    await gotoTab(page, 'Stock Intake');
    await openImportMenu(page);
    await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
    await page.waitForTimeout(700);
    await page.locator('input[type="file"]').first().setInputFiles(invDownloadedFile);
    await page.waitForTimeout(3000);
    await shot(page, 'post-wipe-inventory-report-preview');
    await modal(page).getByRole('button', { name: /Restore \d+ accessory pool|Load [\d,]+ rows/i }).click();
    await page.waitForTimeout(3000);
    await shot(page, 'post-wipe-inventory-report-done');
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
    await dismissModals(page);
  }

  const afterInvRestore = await readStore(page);
  const poolAfterInvRestore = afterInvRestore.accessoryStock.find(a => a.sku === SKU);
  record('Inventory Report re-upload alone restores the pool at the GROSS total (50, not yet netted for the sale)',
    poolAfterInvRestore?.quantity === ADD_QTY, `quantity=${poolAfterInvRestore?.quantity} (expected ${ADD_QTY})`);

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-restored-from-inventory-report-50-units');

  // Re-upload the same accessory sales file (same as the operator would,
  // re-uploading their monthly Sales Report after a wipe).
  await importSalesFile(page, SALES_FILE);
  await page.waitForTimeout(500);
  await shot(page, 'post-wipe-reupload-sales-preview');
  const confirm3 = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirm3.click();
  await page.waitForTimeout(4000);
  const doneText3 = await modal(page).innerText().catch(() => '');
  await shot(page, 'post-wipe-reupload-sales-done');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterWipeReupload = await readStore(page);
  const poolAfterWipe = afterWipeReupload.accessoryStock.find(a => a.sku === SKU);
  const saleAfterWipe = afterWipeReupload.sales.find(s => (s.sku || '') === SKU);
  record('The sale itself still imports fine after the wipe (no crash)', !!saleAfterWipe);
  record(`QUESTION B — FIXED: the accessory pool comes back at exactly the pre-wipe quantity (${ADD_QTY - SALE_QTY})`,
    poolAfterWipe?.quantity === ADD_QTY - SALE_QTY,
    `quantity=${poolAfterWipe?.quantity} (expected ${ADD_QTY - SALE_QTY})`);
  record('No error surfaced to the operator at any point in the round trip', !/error|fail/i.test(doneText3), doneText3.slice(0, 200));

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-fully-restored-48-units-after-full-round-trip');
  const configText = await page.innerText('body').catch(() => '');
  record(`Configuration's Accessory Stock panel shows ${SKU} at 48 after the full round trip`,
    configText.includes(SKU) && /\b48\b/.test(configText.match(new RegExp(`${SKU}[\\s\\S]{0,200}`))?.[0] || ''));

  record('No uncaught JS errors across the whole investigation', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
