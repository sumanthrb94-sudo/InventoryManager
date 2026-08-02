/**
 * scripts/e2eReportsInsightsBrutal.mjs — pixel-precise verification of the
 * remaining Admin panels: Reports (Stock Report per-model, Daily Sales) and
 * Insights (Fast Movers, Slow Movers, Reorder Alerts, Platform Scorecard).
 *
 * Three distinct models, each engineered to land unambiguously on one side
 * of every threshold involved:
 *
 *   TESTBRAND VELOCITY FASTMOVER   — 2 sold in 5 days each (AMAZON), 3 still available
 *                        -> Fast Mover (avgDays<=14); sellThrough 40%, NOT
 *                        a Reorder Alert (needs >=65%)
 *   TESTBRAND VELOCITY SLOWMOVER   — 2 sold in 50 days each (EBAY), 2 still available
 *                        -> Slow Mover (avgDays>30); sellThrough 50%
 *   TESTBRAND VELOCITY REORDERALERT — 4 sold in 20 days each (AMAZON), 2 still available
 *                        -> sellThrough 67% (>=65) AND inStock 2 (<=3) AND
 *                        sold 4 (>=2) -> must appear in Reorder Alerts;
 *                        avgDays 20 is neither <=14 nor >30, so it must NOT
 *                        appear in Fast or Slow Movers
 *
 * Platform Scorecard is a side effect of the same fixture: AMAZON gets
 * FAST MOVER's 2 + REORDER ALERT's 4 = 6 sold (avg SP round((2*200+4*180)/6)
 * = 187, avg days round((2*5+4*20)/6) = 15); EBAY gets SLOW MOVER's 2 sold
 * (avg SP 150, avg days 50).
 *
 * Reports' Daily Sales for today: 8 units, revenue £1,420, GP £620 — all
 * fee-INDEPENDENT figures (Net Profit is skipped here since it depends on
 * marketplace commission formulas, which have their own separate coverage).
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eReportsInsightsBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/reports-insights-panels';
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

// ── Fixture ──────────────────────────────────────────────────────────────
// Must be the real today — a literal date here is a time bomb: it is correct
// on the day it is written and wrong every day after, and the failure looks
// like a broken "sold today" KPI rather than a stale fixture.
const TODAY = new Date().toISOString().slice(0, 10);
const SUPPLIER = 'VELOCITY TEST SUPPLIER';
const daysAgo = n => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];

function invRow(dateIn, model, imei) {
  return [dateIn, model, imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 100, 'OFFICE', ''];
}
function saleRow(date, order, imei, sp, marketplace) {
  return [date, order, 'VEL-128-BLK', imei, SUPPLIER, 1, 100, sp, sp - 100, '', '', 8, '', '', '', '', '', ''];
}

const invRows = [];
const saleRows = [];
let seq = 0;
function nextImei() { seq++; return `35019000009${String(6000 + seq).padStart(4, '0')}`; }

// FAST MOVER: 2 sold (5 days, AMAZON, SP=200), 3 available
const FM_SOLD = [nextImei(), nextImei()];
const FM_AVAIL = [nextImei(), nextImei(), nextImei()];
for (const imei of FM_SOLD) { invRows.push(invRow(daysAgo(5), 'TESTBRAND VELOCITY FASTMOVER', imei)); saleRows.push(saleRow(TODAY, `AMZ-FM-${imei.slice(-4)}`, imei, 200, 'AMAZON')); }
for (const imei of FM_AVAIL) invRows.push(invRow(daysAgo(5), 'TESTBRAND VELOCITY FASTMOVER', imei));

// SLOW MOVER: 2 sold (50 days, EBAY, SP=150), 2 available
const SM_SOLD = [nextImei(), nextImei()];
const SM_AVAIL = [nextImei(), nextImei()];
for (const imei of SM_SOLD) { invRows.push(invRow(daysAgo(50), 'TESTBRAND VELOCITY SLOWMOVER', imei)); saleRows.push(saleRow(TODAY, `EBAY-SM-${imei.slice(-4)}`, imei, 150, 'EBAY')); }
for (const imei of SM_AVAIL) invRows.push(invRow(daysAgo(50), 'TESTBRAND VELOCITY SLOWMOVER', imei));

// REORDER ALERT: 4 sold (20 days, AMAZON, SP=180), 2 available
const RA_SOLD = [nextImei(), nextImei(), nextImei(), nextImei()];
const RA_AVAIL = [nextImei(), nextImei()];
for (const imei of RA_SOLD) { invRows.push(invRow(daysAgo(20), 'TESTBRAND VELOCITY REORDERALERT', imei)); saleRows.push(saleRow(TODAY, `AMZ-RA-${imei.slice(-4)}`, imei, 180, 'AMAZON')); }
for (const imei of RA_AVAIL) invRows.push(invRow(daysAgo(20), 'TESTBRAND VELOCITY REORDERALERT', imei));

function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...invRows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const amazonRows = saleRows.filter(r => r[3].startsWith('35019') && (r[1].startsWith('AMZ')));
  const ebayRows = saleRows.filter(r => r[1].startsWith('EBAY'));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...amazonRows]), 'AMAZON');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...ebayRows]), 'EBAY');
  for (const m of ['BM', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'VELOCITY_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'VELOCITY_SALES.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, acceptDownloads: true });
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

  // ═══ Admin → Reports ═══
  await gotoAdminSub(page, 'Reports');
  await page.waitForTimeout(800);
  await shot(page, 'admin-reports-daily-and-stock');
  const reportsText = await page.innerText('body').catch(() => '');

  record('Reports Daily Sales — 8 units sold today', /£1,420[\s\S]{0,100}8\b/.test(reportsText) || /\b8\b[\s\S]{0,10}(units|sales)/i.test(reportsText),
    reportsText.match(/Sales for [\d-]+[\s\S]{0,200}/i)?.[0]?.slice(0, 150));
  record('Reports Daily Sales — Revenue = £1,420', reportsText.includes('£1,420'),
    reportsText.match(/£1,420/)?.[0]);
  record('Reports Daily Sales — Gross Profit = £620', reportsText.includes('£620'),
    reportsText.match(/£620/)?.[0]);

  // Must actually switch to the "Stock Report" tab — it's a separate tab
  // from "Daily Sales", not a scrolled-down section of the same page.
  const stockReportTab = page.getByRole('button', { name: /^Stock Report$/i }).first();
  const stockTabFound = await stockReportTab.isVisible().catch(() => false);
  if (stockTabFound) {
    await stockReportTab.click();
    await page.waitForTimeout(500);
  }
  record('Stock Report tab found and clicked', stockTabFound);
  await shot(page, 'admin-reports-stock-report-tab');
  const stockReportText = await page.innerText('body').catch(() => '');

  record('Stock Report: TESTBRAND VELOCITY FASTMOVER shows 40% sell-through',
    (() => {
      const chunk = stockReportText.match(/VELOCITY FASTMOVER[\s\S]{0,150}/i)?.[0] || '';
      return /40%/.test(chunk);
    })());
  record('Stock Report: TESTBRAND VELOCITY SLOWMOVER shows 50% sell-through',
    (() => {
      const chunk = stockReportText.match(/VELOCITY SLOWMOVER[\s\S]{0,150}/i)?.[0] || '';
      return /50%/.test(chunk);
    })());
  record('Stock Report: TESTBRAND VELOCITY REORDERALERT shows 67% sell-through',
    (() => {
      const chunk = stockReportText.match(/VELOCITY REORDERALERT[\s\S]{0,150}/i)?.[0] || '';
      return /67%/.test(chunk);
    })());

  // ═══ Admin → Insights ═══
  await gotoAdminSub(page, 'Insights');
  await page.waitForTimeout(800);

  // Fast Movers / Slow Movers (velocity) / Reorder Alerts are all
  // CollapsibleSections — but "Slow Movers" as a bare prefix ALSO matches
  // the unrelated "Slow Movers · By SKU" card earlier on the page, so each
  // toggle is found by its title AND its unique meta text together.
  const toggleFor = async (titleText, metaText) => {
    const toggle = page.locator('button', { hasText: titleText }).filter({ hasText: metaText }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.scrollIntoViewIfNeeded().catch(() => {});
      await toggle.click();
      await page.waitForTimeout(300);
      return true;
    }
    return false;
  };
  const fastOpened = await toggleFor('Fast Movers', '14d avg');
  const slowOpened = await toggleFor('Slow Movers', '30d avg');
  const reorderOpened = await toggleFor('Reorder Alerts', 'Low stock');
  record('Fast Movers section toggle found and opened', fastOpened);
  record('Slow Movers (velocity) section toggle found and opened — distinct from "Slow Movers · By SKU"', slowOpened);
  record('Reorder Alerts section toggle found and opened', reorderOpened);

  const platformToggle = page.getByRole('button', { name: /Platform Scorecard/i }).first();
  await platformToggle.scrollIntoViewIfNeeded().catch(() => {});
  await platformToggle.click();
  await page.waitForTimeout(400);
  await shot(page, 'admin-insights-velocity-panels');

  const insightsText = await page.innerText('body').catch(() => '');

  record('Fast Movers shows VELOCITY FASTMOVER with 5d avg', /VELOCITY FASTMOVER[\s\S]{0,100}5d/i.test(insightsText),
    insightsText.match(/VELOCITY FASTMOVER[\s\S]{0,100}/i)?.[0]);
  record('Fast Movers does NOT show TESTBRAND VELOCITY REORDERALERT (20d, not <=14d)',
    (() => {
      const fastChunk = insightsText.match(/FAST MOVERS[\s\S]*?(?=SLOW MOVERS)/i)?.[0] || '';
      return !/VELOCITY REORDERALERT/i.test(fastChunk);
    })());
  record('Slow Movers shows VELOCITY SLOWMOVER with 50d avg', /VELOCITY SLOWMOVER[\s\S]{0,100}50d/i.test(insightsText),
    insightsText.match(/VELOCITY SLOWMOVER[\s\S]{0,100}/i)?.[0]);
  record('Reorder Alerts shows TESTBRAND VELOCITY REORDERALERT with 67% sell-through',
    (() => {
      const chunk = insightsText.match(/REORDER ALERTS[\s\S]*?(?=SUPPLIER PERFORMANCE)/i)?.[0] || '';
      return /VELOCITY REORDERALERT/i.test(chunk) && /67%/.test(chunk);
    })());
  record('Reorder Alerts does NOT show TESTBRAND VELOCITY FASTMOVER (only 40% sell-through)',
    (() => {
      const chunk = insightsText.match(/REORDER ALERTS[\s\S]*?(?=SUPPLIER PERFORMANCE)/i)?.[0] || '';
      return !/VELOCITY FASTMOVER/i.test(chunk);
    })());

  record('Platform Scorecard: AMAZON shows 6 units sold', /AMAZON[\s\S]{0,20}6\b[\s\S]{0,20}units sold/i.test(insightsText),
    insightsText.match(/AMAZON[\s\S]{0,60}/i)?.[0]);
  record('Platform Scorecard: AMAZON avg price £187', /AMAZON[\s\S]{0,150}£187/i.test(insightsText),
    insightsText.match(/AMAZON[\s\S]{0,150}/i)?.[0]?.slice(0, 100));
  record('Platform Scorecard: AMAZON avg days to sell 15d', /AMAZON[\s\S]{0,200}15d/i.test(insightsText));
  record('Platform Scorecard: EBAY shows 2 units sold', /EBAY[\s\S]{0,20}2\b[\s\S]{0,20}units sold/i.test(insightsText),
    insightsText.match(/EBAY[\s\S]{0,60}/i)?.[0]);
  record('Platform Scorecard: EBAY avg price £150', /EBAY[\s\S]{0,150}£150/i.test(insightsText));
  record('Platform Scorecard: EBAY avg days to sell 50d', /EBAY[\s\S]{0,200}50d/i.test(insightsText));

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
