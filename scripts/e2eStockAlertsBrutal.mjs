/**
 * scripts/e2eStockAlertsBrutal.mjs — pixel-precise verification of the
 * "Out of Stock" / "Low Stock" panel the user asked about by name — this
 * is BuySheet.tsx's StockAlerts component specifically (Stock Intake page),
 * distinct from the aging/value panels already verified in
 * e2eStockAgingPanelsBrutal.mjs.
 *
 *   Sold Out · Reorder:    available===0 && incoming===0 && sold>0
 *   Running Low · Reorder: available>0 && available<=3
 *
 * Fixture: three distinct SKU buckets, each landing on one side of the
 * threshold with no ambiguity —
 *   PHONE A: 1 unit, SOLD (via a real Sales Report import) -> Sold Out
 *   PHONE B: 2 units available -> Running Low (2 <= 3)
 *   PHONE C: 5 units available -> NOT low stock (5 > 3), must NOT appear
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eStockAlertsBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/stock-alerts-panel';
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
async function importInventory(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(5000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
}

// ── Fixture ──────────────────────────────────────────────────────────────
const SUPPLIER = 'STOCK ALERT TEST SUPPLIER';
const IMEI_A = '350190000081001';           // sole unit — will be sold
const IMEIS_B = ['350190000082001', '350190000082002'];                              // 2 units
const IMEIS_C = ['350190000083001', '350190000083002', '350190000083003', '350190000083004', '350190000083005']; // 5 units

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['2026-07-01', 'STOCK ALERT PHONE A', IMEI_A, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 100, 'OFFICE', ''],
    ...IMEIS_B.map(imei => ['2026-07-01', 'STOCK ALERT PHONE B', imei, 'A', '128GB', 'Physical SIM', 'BLUE', SUPPLIER, 150, 'OFFICE', '']),
    ...IMEIS_C.map(imei => ['2026-07-01', 'STOCK ALERT PHONE C', imei, 'A', '128GB', 'Physical SIM', 'GREEN', SUPPLIER, 200, 'OFFICE', '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    AMAZON_HEADERS,
    ['2026-07-20', 'AMZ-ALERT-1', 'SAP-A-128-BLK', IMEI_A, SUPPLIER, 1, 100, 180, 80, '', '', 8, '', '', '', '', '', ''],
  ]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'ALERTS_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'ALERTS_SALES.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);

  // Sell PHONE A's sole unit via a real Sales Report import.
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE);
  await page.waitForTimeout(4000);
  const flipAck = modal(page).getByText(/I've reviewed the list/i);
  if (await flipAck.isVisible().catch(() => false)) { await flipAck.click(); await page.waitForTimeout(300); }
  await modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last().click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  // ═══ Stock Intake → Stock Alerts panel ═══
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(800);
  const alertsSection = page.locator('div', { hasText: 'Stock Alerts' }).last();
  await alertsSection.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, 'stock-alerts-panel');

  const pageText = await page.innerText('body').catch(() => '');
  record('Stock Alerts shows "Sold Out · Reorder" for PHONE A (0 available, 0 incoming, 1 sold)',
    /PHONE A/i.test(pageText) && /Sold Out/i.test(pageText),
    pageText.match(/Sold Out[\s\S]{0,150}/i)?.[0]?.slice(0, 100));
  record('Stock Alerts shows "Running Low" for PHONE B (2 available, <= 3 threshold)',
    /PHONE B/i.test(pageText) && /Running Low/i.test(pageText),
    pageText.match(/Running Low[\s\S]{0,200}/i)?.[0]?.slice(0, 150));
  record('Stock Alerts does NOT flag PHONE C as low stock (5 available, > 3 threshold)',
    (() => {
      const lowChunk = pageText.match(/Running Low[\s\S]{0,300}/i)?.[0] || '';
      return !/PHONE C/i.test(lowChunk);
    })());
  record('Stock Alerts does NOT flag PHONE C as sold out either (it still has 5 available)',
    (() => {
      const soldOutChunk = pageText.match(/Sold Out[\s\S]*?(?=Running Low|BUY INTELLIGENCE)/i)?.[0] || '';
      return !/PHONE C/i.test(soldOutChunk);
    })());
  record('Stock Alerts does NOT flag PHONE B as sold out (it has 2 available, not 0)',
    (() => {
      const soldOutChunk = pageText.match(/Sold Out[\s\S]*?(?=Running Low|BUY INTELLIGENCE)/i)?.[0] || '';
      return !/PHONE B/i.test(soldOutChunk);
    })());

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
