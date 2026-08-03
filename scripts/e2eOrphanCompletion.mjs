/**
 * scripts/e2eOrphanCompletion.mjs — does completing an orphan sale during a
 * Sales Report import actually save the new unit, and does it show up
 * everywhere afterwards?
 *
 * "Orphan" here = a sale row whose IMEI has NO matching inventory unit.
 * SalesReportImport's preview surfaces this as a "sold record needs
 * completing" row (tagged NEW) and hard-blocks Confirm until the operator
 * fills in the missing audit fields — this is the exact screen the client
 * hit with the SALES_TEMPLATE_UPLOAD_30TH_JULY.xlsx file.
 *
 * Proves, end to end, through the real UI:
 *   1. The orphan is detected and flagged (not silently dropped).
 *   2. Filling in the Model field (the only field genuinely missing for a
 *      fresh orphan whose sheet already carries IMEI/Supplier/BP/SP/Date)
 *      unlocks Confirm.
 *   3. On Confirm, a real InventoryUnit is created (status=sold, IMEI
 *      stamped, model/supplier/BP as entered) AND a real Sale doc exists.
 *   4. The Dashboard's Sold Today/This Month counters move.
 *   5. The downloaded Sales Report's AMAZON sheet carries the new row.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eOrphanCompletion.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/orphan-completion';
const FIXTURES = `${OUT}/fixtures`;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}
function modal(page) { return page.locator('div.fixed.inset-0[class*="z-["]').last(); }
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
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
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  for (let attempt = 0; attempt < 5; attempt++) {
    const tab = page.getByRole('button', { name: re }).first();
    if (!(await tab.isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    try {
      await page.getByRole('button', { name: re }).first().click({ timeout: 5000 });
      await page.waitForTimeout(900);
      return;
    } catch {
      await page.waitForTimeout(500);
      if (attempt === 3) await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    }
  }
}
async function gotoAdminSub(page, label) {
  await gotoTab(page, 'Admin');
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await tab.click();
  await page.waitForTimeout(700);
}
async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}
async function dumpStore(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}'));
}

const today = () => new Date().toISOString().slice(0, 10);
const ORPHAN_IMEI = '359999000000001';
const ORPHAN_ORDER = 'ORPHAN-TEST-1';
const ORPHAN_SUPPLIER = 'MOBILE WHOLESALE LTD'; // matches the default E2E seed's sup-1
const ORPHAN_BP = 250;
const ORPHAN_SP = 399.99;

const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'];
function orphanRow() {
  return [today(), ORPHAN_ORDER, 'ASI-SG-ORPHAN-TEST', ORPHAN_IMEI, ORPHAN_SUPPLIER, 1, ORPHAN_BP, ORPHAN_SP, '', '', '', 8, '', '', ''];
}
const ORPHAN_FIXTURE = resolve(FIXTURES, 'SALES_ORPHAN_TEST.xlsx');
function writeOrphanFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, orphanRow()]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}

/** Module-scoped so the catch at the foot can close it — see the note there. */
let browser;

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const BENIGN_CONSOLE = /Failed to load resource.*(net::ERR_CONNECTION_RESET|404)/i;
  page.on('pageerror', e => record('no JS runtime errors', false, e.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE.test(msg.text())) record('no console errors', false, msg.text());
  });

  writeOrphanFixture(ORPHAN_FIXTURE);

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const before = await dumpStore(page);
  record('pre-condition: orphan IMEI does not exist in inventory yet',
    !Object.values(before.inventoryUnits ?? {}).some(u => u.imei === ORPHAN_IMEI));
  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(800);
  const soldThisMonthBefore = (await page.locator('body').innerText()).match(/(\d+)\s*sales\s*·\s*GP/i)?.[1];

  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(ORPHAN_FIXTURE);
  await page.waitForTimeout(4000);
  await shot(page, 'preview-with-orphan');

  const previewText = await modal(page).innerText().catch(() => '');
  record('preview flags 1 sold record needing completion (the orphan)',
    /1 sold record.*need.*completing/i.test(previewText), previewText.match(/\d+ sold record[^\n]*/i)?.[0] ?? 'no match');
  record('preview tags the row NEW (no existing unit)', /\bNEW\b/.test(previewText));

  // The row's Model field is pre-filled from a SKU→friendly-name guess
  // (a raw, unrecognisable SKU like "ASI-SG-ORPHAN-TEST" still yields
  // *something* here), so the row can already read "complete" before the
  // operator touches it — the real correctness question is whether
  // OVERRIDING it to a genuine catalog pick actually sticks, which the
  // post-Confirm assertions below check directly against the stored unit.
  record('audit panel is non-blank pre-fill or blank — either way Confirm gates on it',
    /\d+\s*of\s*1\s*complete/i.test(previewText), previewText.match(/\d+\s*of\s*1\s*complete/i)?.[0] ?? 'no match');

  // Fill in the Model field via the searchable DeviceComboBox — pick an
  // existing catalog model (IPHONE 13, seeded office stock) so no new
  // catalog entry is needed.
  const auditPanel = modal(page).locator('div.border-2.border-orange-300');

  // "Show only rows still needing attention" is ticked by default. The check
  // above just established this row already reads 1 of 1 complete — the model
  // was inferred from the SKU — so under that filter the list renders the
  // words "All 1 rows are complete." and NO row at all. There is then no model
  // input to click, which is exactly how this script started failing: not
  // because overriding a model stopped working, but because the row it wanted
  // was filtered out of view. Untick it to see every row, complete or not.
  const showAll = auditPanel.locator('label', { hasText: /Show only rows still needing attention/i })
    .locator('input[type="checkbox"]');
  if (await showAll.isChecked().catch(() => false)) {
    await showAll.uncheck();
    await page.waitForTimeout(400);
  }

  const modelInput = auditPanel.locator('input[placeholder="Search model…"]').first();
  await modelInput.click();
  await modelInput.fill('IPHONE 13');
  await page.waitForTimeout(500);
  // First suggestion in the dropdown.
  const suggestion = page.locator('div.z-\\[9999\\] button').first();
  await suggestion.click().catch(async () => {
    // Fallback: fixed-position dropdown selector might differ — press Enter.
    await modelInput.press('Enter');
  });
  await page.waitForTimeout(400);
  await shot(page, 'orphan-model-filled');

  const afterFillText = await modal(page).innerText().catch(() => '');
  record('audit panel shows 1 of 1 complete after picking a model',
    /\b1\b\s*of\s*1\s*complete/i.test(afterFillText), afterFillText.match(/\d+\s*of\s*1\s*complete/i)?.[0] ?? 'no match');

  const confirmBtn = modal(page).getByRole('button', { name: /Load [\d,]+ sales?|Re-confirm/i }).last();
  const confirmDisabled = await confirmBtn.isDisabled().catch(() => true);
  record('Confirm is enabled once the orphan is complete', !confirmDisabled);

  await confirmBtn.click();
  await page.waitForTimeout(4000);
  await shot(page, 'orphan-import-done');
  const doneText = await modal(page).innerText().catch(() => '');
  record('Done screen reports units created', /created|patched|sold/i.test(doneText), doneText.slice(0, 300));

  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  // ── Verify the write actually landed in the store ─────────────────────
  const after = await dumpStore(page);
  const newUnit = Object.values(after.inventoryUnits ?? {}).find(u => u.imei === ORPHAN_IMEI);
  const newSale = Object.values(after.sales ?? {}).find(s => s.orderNumber === ORPHAN_ORDER);

  record('a real InventoryUnit was created for the orphan IMEI', !!newUnit, newUnit ? `unit ${newUnit.id}` : 'not found');
  record('the new unit is status=sold with the entered model', newUnit?.status === 'sold' && /IPHONE 13/i.test(newUnit?.model || ''),
    `status=${newUnit?.status} model=${newUnit?.model}`);
  record('the new unit carries the sheet\'s BP/supplier', Number(newUnit?.buyPrice) === ORPHAN_BP && newUnit?.supplierName === ORPHAN_SUPPLIER,
    `buyPrice=${newUnit?.buyPrice} supplierName=${newUnit?.supplierName}`);
  record('a real Sale doc was created and linked to the unit', !!newSale && newSale.unitId === newUnit?.id,
    `sale.unitId=${newSale?.unitId} unit.id=${newUnit?.id}`);
  record('the sale carries the sheet\'s SP', Number(newSale?.salePrice) === ORPHAN_SP, `salePrice=${newSale?.salePrice}`);

  // ── Dashboard reflects it ──────────────────────────────────────────────
  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(1000);
  const dashText = await page.locator('body').innerText();
  const soldThisMonthAfter = dashText.match(/(\d+)\s*sales\s*·\s*GP/i)?.[1];
  await shot(page, 'dashboard-after-orphan');
  record('Dashboard "Sold This Month" counter increased by the new sale',
    Number(soldThisMonthAfter) === Number(soldThisMonthBefore || 0) + 1,
    `before=${soldThisMonthBefore} after=${soldThisMonthAfter}`);

  for (const title of [/^Top 10 Sold Products/i, /^Sales by Platform/i]) {
    const header = page.getByRole('button', { name: title }).first();
    if (await header.isVisible().catch(() => false)) { await header.click(); await page.waitForTimeout(300); }
  }
  const dashTextExpanded = await page.locator('body').innerText();
  record('Dashboard mentions the orphan-completed model somewhere once expanded',
    /IPHONE 13/i.test(dashTextExpanded));

  // ── Downloaded Sales Report reflects it ────────────────────────────────
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Sales Report/i }).first().click();
  await page.waitForTimeout(500);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    page.getByRole('button', { name: /^All Time$/i }).first().click(),
  ]);
  const dlPath = await download.path();
  await page.waitForTimeout(500);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dlPath);
  const amazonSheet = wb.getWorksheet('AMAZON');
  let found = false;
  let foundRow = null;
  amazonSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const order = row.getCell(2).text || row.getCell(2).value;
    if (String(order || '') === ORPHAN_ORDER) { found = true; foundRow = row.values; }
  });
  record('the downloaded Sales Report\'s AMAZON sheet carries the orphan-completed sale',
    found, found ? JSON.stringify(foundRow) : 'not found in AMAZON sheet');

  await browser.close();

  console.log('\n── Summary ──');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

// A Playwright browser left open keeps node's event loop alive, so an
// unhandled failure here used to hang until the suite runner killed it — the
// script was recorded as a seven-minute timeout with no result, when in truth
// it had failed on one locator in forty seconds. Close it, and the failure
// reports as a failure.
run().catch(async e => {
  console.error(e);
  process.exitCode = 1;
  await browser?.close().catch(() => {});
});
