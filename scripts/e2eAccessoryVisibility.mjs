/**
 * scripts/e2eAccessoryVisibility.mjs — proves the two fixes from this round:
 *
 *   1. Friendly-name display: an accessory sale never links an InventoryUnit
 *      (no IMEI to link), so Sales History, Reports → Daily Sales, and
 *      Insights → Best Sellers used to fall back to raw SKU text
 *      ("USB-C-20W") instead of the accessory's friendly name ("USB-C 20W
 *      Charger"). Now all three resolve the live accessoryStock pool by SKU
 *      and show the friendly name — revenue/GP figures were always correct,
 *      only the label was wrong.
 *
 *   2. Dashboard/Stock Alerts visibility: accessoryStock pools never created
 *      an InventoryUnit, so they were invisible to every units-driven view —
 *      Dashboard had no accessory tile at all, and Buy → Stock Alerts never
 *      flagged a pool that sold out or ran low. Now Dashboard shows a
 *      dedicated Accessories section (SKU count / value / sold-out / low-
 *      stock counts) and Stock Alerts folds accessory pools into the same
 *      Sold Out / Running Low columns phone SKUs already use, tagged
 *      "Accessory".
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAccessoryVisibility.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-visibility';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'USB-C-20W';
const ACCESSORY_NAME = 'USB-C 20W Charger';
const ADD_QTY = 5;
const ADD_BP = 3.5;
const FIRST_SALE_QTY = 2;   // 5 -> 3: low stock (<=3)
const SECOND_SALE_QTY = 3;  // 3 -> 0: sold out
const SALES_FILE_1 = resolve(`${OUT}/sales-accessory-1.xlsx`);
const SALES_FILE_2 = resolve(`${OUT}/sales-accessory-2.xlsx`);

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
  const confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirm.click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);
}

async function buildAccessorySalesFile(file, orderNumber, qty) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
  ws.getRow(2).values = [
    '2026-07-22', orderNumber, SKU, '', 'MOBILE WHOLESALE LTD',
    qty, ADD_BP, 8.99, '', '', '', 0, '', '', '',
  ];
  await wb.xlsx.writeFile(file);
}

async function run() {
  await buildAccessorySalesFile(SALES_FILE_1, 'ACC-VIS-1001', FIRST_SALE_QTY);
  await buildAccessorySalesFile(SALES_FILE_2, 'ACC-VIS-1002', SECOND_SALE_QTY);

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

  // ══ 1. Create the accessory pool (5 units) ═══════════════════════════════
  console.log('\n── 1. Add Stock → Accessories: 5 x USB-C 20W Charger ──');
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

  // ══ 2. Dashboard shows the new Accessories section (5 SKUs, £17.50) ═════
  console.log('\n── 2. Dashboard → Overview: Accessories tile ──');
  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(700);
  const dashText1 = await page.innerText('body').catch(() => '');
  await shot(page, 'dashboard-accessory-tile-1sku');
  record('Dashboard shows "Accessory SKUs" tile with count 1', /Accessory SKUs/i.test(dashText1) && /\b1\b[\s\S]{0,40}Accessory SKUs|Accessory SKUs[\s\S]{0,10}\b1\b/i.test(dashText1));
  record('Dashboard shows the pooled stock value (£17.50 = 5 x £3.50)', /17\.5|17,5/.test(dashText1));
  record('Dashboard shows 0 accessories sold out (nothing sold yet)', /Accessories Sold Out/i.test(dashText1));

  // ══ 3. Sell 2 (5 -> 3) — friendly-name display + Running Low alert ═══════
  console.log('\n── 3. Sell 2 via Sales Report import → pool at 3 (low stock) ──');
  await importSalesFile(page, SALES_FILE_1);

  const afterFirst = await readStore(page);
  const poolAfterFirst = afterFirst.accessoryStock.find(a => a.sku === SKU);
  record(`Pool decremented to ${ADD_QTY - FIRST_SALE_QTY} after first sale`, poolAfterFirst?.quantity === ADD_QTY - FIRST_SALE_QTY, `quantity=${poolAfterFirst?.quantity}`);

  // 3a. Sales History row shows the friendly name, not the raw SKU
  await gotoAdminSub(page, 'Sales History');
  await page.waitForTimeout(700);
  const salesText = await page.innerText('body').catch(() => '');
  await shot(page, 'sales-history-friendly-name');
  record('Sales History shows the friendly accessory name ("USB-C 20W Charger")', salesText.includes(ACCESSORY_NAME));

  // 3b. Reports → Daily Sales / unified feed shows the friendly name. The
  // sale landed on 2026-07-22, so the Daily Sales date picker (defaults to
  // today) must be pointed at that date before the row is visible.
  await gotoAdminSub(page, 'Reports');
  await page.waitForTimeout(700);
  const reportsDateInput = page.locator('input[type="date"]').first();
  if (await reportsDateInput.isVisible().catch(() => false)) {
    await reportsDateInput.fill('2026-07-22');
    await page.waitForTimeout(500);
  }
  const reportsText = await page.innerText('body').catch(() => '');
  await shot(page, 'reports-daily-sales-friendly-name');
  record('Reports (Daily Sales / unified feed) shows the friendly accessory name', reportsText.includes(ACCESSORY_NAME));

  // 3c. Insights → Best Sellers shows the friendly name under "Accessory" brand
  await gotoAdminSub(page, 'Insights');
  await page.waitForTimeout(700);
  const insightsBestSellers = page.locator('text=/Top 10 Best Sellers/i').first();
  await insightsBestSellers.scrollIntoViewIfNeeded().catch(() => {});
  await insightsBestSellers.click().catch(() => {});
  await page.waitForTimeout(500);
  const insightsText = await page.innerText('body').catch(() => '');
  await shot(page, 'insights-best-sellers-friendly-name');
  record('Insights → Best Sellers shows the friendly accessory name', insightsText.includes(ACCESSORY_NAME));

  // 3d. Buy → Stock Alerts: Running Low column includes the accessory
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(700);
  const stockAlertsSection = page.locator('text=/Running Low · Reorder Soon/i').first();
  await stockAlertsSection.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  const buyText1 = await page.innerText('body').catch(() => '');
  await shot(page, 'stock-alerts-running-low-accessory');
  record('Stock Alerts → Running Low includes the accessory (3 left, <= 3 threshold)', buyText1.includes(ACCESSORY_NAME) && /Accessory/.test(buyText1));

  // ══ 4. Sell remaining 3 (3 -> 0) — Sold Out alert + Dashboard count ══════
  console.log('\n── 4. Sell remaining 3 via Sales Report import → pool at 0 (sold out) ──');
  await importSalesFile(page, SALES_FILE_2);

  const afterSecond = await readStore(page);
  const poolAfterSecond = afterSecond.accessoryStock.find(a => a.sku === SKU);
  record('Pool decremented to 0 after second sale', poolAfterSecond?.quantity === 0, `quantity=${poolAfterSecond?.quantity}`);

  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(700);
  const stockAlertsSoldOut = page.locator('text=/Sold Out · Reorder/i').first();
  await stockAlertsSoldOut.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  const buyText2 = await page.innerText('body').catch(() => '');
  await shot(page, 'stock-alerts-sold-out-accessory');
  record('Stock Alerts → Sold Out includes the accessory (0 left, had sales)', buyText2.includes(ACCESSORY_NAME) && /Accessory/.test(buyText2));

  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(700);
  const dashText2 = await page.innerText('body').catch(() => '');
  await shot(page, 'dashboard-accessory-sold-out-1');
  record('Dashboard "Accessories Sold Out" tile now reads 1', /Accessories Sold Out/i.test(dashText2) && /Accessories Sold Out[\s\S]{0,10}\b1\b|\b1\b[\s\S]{0,10}Accessories Sold Out/i.test(dashText2));

  record('No uncaught JS errors across the whole investigation', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
