/**
 * e2eExportAllTimeReports — export the two all-time reports from the running
 * app, and assert every sheet actually carries rows.
 *
 * The reports handed over before this existed came from an import-comparison
 * run, so Accessories, Returns Detail and Unit Histories were bare header
 * rows. That reads as three broken features. It wasn't — the run simply had no
 * accessories and no returns in it. The E2E seed now carries both (see
 * src/lib/e2e/seedData.ts), and this script proves the sheets fill.
 *
 * Run (preview server up, see e2eScreenshots.mjs):
 *   node scripts/e2eExportAllTimeReports.mjs
 *
 * Output: docs/client-report/reports/*.xlsx
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const OUT = 'docs/client-report/reports';
const SHOTS = 'e2e-screenshots/all-time-reports';
for (const d of [OUT, SHOTS]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Click a bottom-nav tab by its exact visible text.
 *
 * getByRole('button', { name: /^Inventory$/ }) does not match these — the nav
 * buttons carry an icon alongside the label, so their accessible name is not
 * the label alone. Filtering on text is what actually works here.
 */
const gotoTab = async (page, label) => {
  await page.locator('button')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, 'i') })
    .last()
    .click();
  await page.waitForTimeout(1000);
};

/** Open a report menu, pick All Time, and save what downloads. */
async function download(page, menuLabel, saveAs) {
  await page.getByRole('button', { name: new RegExp(menuLabel, 'i') }).first().click();
  await page.waitForTimeout(500);
  const wait = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: /^All Time$/i }).first().click();
  const dl = await wait;
  const path = resolve(OUT, saveAs);
  await dl.saveAs(path);
  await page.waitForTimeout(600);
  return path;
}

/** Data rows per sheet — a header-only sheet counts zero. */
async function sheetCounts(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const out = {};
  for (const ws of wb.worksheets) {
    let n = 0;
    ws.eachRow((row, i) => {
      if (i === 1) return;
      if (String(row.getCell(1).value ?? '').trim().toUpperCase() === 'TOTAL') return;
      if (row.getCell(1).value) n++;
    });
    out[ws.name] = n;
  }
  return out;
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  // The operator's phone. The bottom nav is mobile-only — at 1440 wide those
  // tab buttons are in the DOM but not visible, so navigation silently hangs.
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, acceptDownloads: true,
  });
  const page = await ctx.newPage();

  // ?e2eReset=1 forces the pristine seed, so the export is reproducible.
  await page.goto(`${BASE}/?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // ── Sales Report ────────────────────────────────────────────────────────
  // The Sell sheet lives under the "Inventory" tab — there is no "Sell" tab.
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/01-sell-before-export.png`, fullPage: true });
  const salesPath = await download(page, 'Sales Report', 'SALES_REPORT_ALL_TIME.xlsx');
  record('Sales Report downloads for the All Time range', !!salesPath, salesPath);

  // ── Inventory Report ────────────────────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(600);
  const invPath = await download(page, 'Inventory Report', 'INVENTORY_REPORT_ALL_TIME.xlsx');
  record('Inventory Report downloads for the All Time range', !!invPath, invPath);
  await page.screenshot({ path: `${SHOTS}/02-stock-intake-after-export.png`, fullPage: true });

  // ── Every sheet has to carry rows ───────────────────────────────────────
  const sales = await sheetCounts(salesPath);
  const inv = await sheetCounts(invPath);
  console.log('\nSales Report sheets:', JSON.stringify(sales));
  console.log('Inventory sheets:  ', JSON.stringify(inv));

  // The whole point: these three were empty in the reports handed over before.
  for (const sheet of ['Accessories', 'Returns Summary', 'Returns Detail', 'Unit Histories']) {
    record(`Sales Report · "${sheet}" carries data, not just a header`,
      (sales[sheet] ?? 0) > 0, `${sales[sheet] ?? 0} rows`);
  }
  const marketplaceRows = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU']
    .reduce((a, m) => a + (sales[m] ?? 0), 0);
  record('Sales Report · the marketplace tabs carry sales', marketplaceRows > 0,
    `${marketplaceRows} rows across five tabs`);
  record('Inventory Report · Office Stock carries units', (inv['Office Stock'] ?? 0) > 0,
    `${inv['Office Stock'] ?? 0} units`);
  record('Inventory Report · SHS Stock carries holdings', (inv['SHS Stock'] ?? 0) > 0,
    `${inv['SHS Stock'] ?? 0} holdings`);

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

run().catch(err => { console.error(err); process.exit(1); });
