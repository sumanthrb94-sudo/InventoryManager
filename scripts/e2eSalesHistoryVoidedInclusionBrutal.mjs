/**
 * scripts/e2eSalesHistoryVoidedInclusionBrutal.mjs — confirms a specific
 * divergence the codebase-mapping pass flagged but never live-tested: the
 * Sell (Inventory) page's "Sold Today" EXCLUDES voided sales, while Admin
 * → Sales History's "Sold Today" chip INCLUDES them (mergeSalesWithSoldUnits
 * / allSales has no voidedAt filter — see Sales.tsx:304 vs SellSheet.tsx:516).
 *
 * This is not asserted as a bug — Sales History is explicitly a full audit
 * trail — but the two screens showing a DIFFERENT "Sold Today" number for
 * the exact same day is worth confirming precisely, not assuming from
 * reading the source.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eSalesHistoryVoidedInclusionBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/sales-history-voided-inclusion';
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

// ── Fixture: one active sale + one voided sale, BOTH dated today ────────
// TODAY has to be the real today, every day. This was pinned to a literal
// '2026-07-27' with a comment saying it matched the environment's date — true
// on the day it was written, and quietly wrong from the next morning. Every
// "Sold Today" assertion then failed against sales the fixture had dated in
// the past, which looks exactly like a broken KPI and is not one.
const TODAY = new Date().toISOString().slice(0, 10);
const SUPPLIER = 'SOLD TODAY TEST SUPPLIER';
const IMEI_ACTIVE = '350190000095001';
const IMEI_VOIDED = '350190000095002';

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [IMEI_ACTIVE, IMEI_VOIDED].map(imei =>
    ['2026-06-01', 'SOLD TODAY TEST PHONE', imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 100, 'OFFICE', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    [TODAY, 'AMZ-STT-ACTIVE', 'STT-128-BLK', IMEI_ACTIVE, SUPPLIER, 1, 100, 200, 100, '', '', 8, '', '', '', '', '', ''],
    [TODAY, 'AMZ-STT-VOIDED', 'STT-128-BLK', IMEI_VOIDED, SUPPLIER, 1, 100, 150, 50, '', '', 8, '', '', '', TODAY, 'Refund', 'Cx changed mind'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...rows]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'SOLDTODAY_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'SOLDTODAY_SALES.xlsx');
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

  // ═══ Inventory (Sell) tab — "Sold Today" must EXCLUDE the voided sale ═══
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(800);
  await shot(page, 'sell-tab-sold-today');
  const sellText = await page.innerText('body').catch(() => '');
  const sellSoldTodayMatch = sellText.match(/Sold Today[\s\S]{0,30}?(\d+)/i);
  record('Sell (Inventory) tab "Sold Today" = 1 (voided sale excluded)',
    sellSoldTodayMatch?.[1] === '1', sellSoldTodayMatch ? sellSoldTodayMatch[1] : '(not found)');

  // ═══ Admin → Sales History — "Sold Today" must INCLUDE the voided sale ═══
  await gotoAdminSub(page, 'Sales History');
  await page.waitForTimeout(800);
  await shot(page, 'admin-sales-history-sold-today');
  const historyText = await page.innerText('body').catch(() => '');
  const historySoldTodayMatch = historyText.match(/Sold Today[\s\S]{0,30}?(\d+)/i);
  record('Admin Sales History "Sold Today" = 2 (voided sale INCLUDED — full audit trail)',
    historySoldTodayMatch?.[1] === '2', historySoldTodayMatch ? historySoldTodayMatch[1] : '(not found)');
  record('Admin Sales History lists both order numbers (active AND voided)',
    historyText.includes('AMZ-STT-ACTIVE') && historyText.includes('AMZ-STT-VOIDED'));

  // ═══ Footer KPIs (Sum SP / Sum GP / Avg GP%) — same audit-trail design:  ═══
  // must sum BOTH sales, not just the active one, since Sales History's own
  // "Sold Today" chip above already proved it counts voided rows too. A
  // footer that quietly dropped the voided row's SP/GP would contradict the
  // very "full audit trail" behaviour this page advertises.
  const store = await page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
  const allStoreSales = Object.values(store.sales ?? {});
  const activeSale = allStoreSales.find(s => s.orderNumber === 'AMZ-STT-ACTIVE');
  const voidedSale = allStoreSales.find(s => s.orderNumber === 'AMZ-STT-VOIDED');
  const expectedSumSP = (activeSale?.salePrice || 0) + (voidedSale?.salePrice || 0);
  const expectedSumGP = Math.round(((activeSale?.grossProfit || 0) + (voidedSale?.grossProfit || 0)) * 100) / 100;
  console.log(`\nExpected footer (from store, BOTH sales summed): Sum SP=£${expectedSumSP}, Sum GP=£${expectedSumGP}`);

  record(`Sales History footer Sum SP = £${expectedSumSP.toLocaleString('en-GB')} (active + voided both counted)`,
    historyText.includes(`£${expectedSumSP.toLocaleString('en-GB')}`),
    historyText.match(/Sum SP[\s\S]{0,30}/i)?.[0]);
  record(`Sales History footer Sum GP includes the voided sale's GP too`,
    (() => {
      const chunk = historyText.match(/Sum GP[\s\S]{0,40}/i)?.[0] || '';
      // The active-sale-only GP (excluding voided) must NOT be what's shown.
      const activeOnlyGp = Math.round((activeSale?.grossProfit || 0) * 100) / 100;
      const activeOnlyStr = `£${activeOnlyGp.toLocaleString('en-GB')}`;
      const bothStr = `£${expectedSumGP.toLocaleString('en-GB')}`;
      return chunk.includes(bothStr) && (activeOnlyGp === expectedSumGP || !chunk.includes(activeOnlyStr));
    })(), historyText.match(/Sum GP[\s\S]{0,40}/i)?.[0]);
  record('Sales History footer row count = 2 (both rows present)',
    /\b2 rows\b/i.test(historyText), historyText.match(/\d+ rows?/i)?.[0]);

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
