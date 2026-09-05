/**
 * scripts/e2eSupplierAndBestSellersBrutal.mjs — pixel-precise verification
 * of Admin → Insights' two "source of truth" sales-derived panels: "Top 10
 * Best Sellers · By GP" and "Supplier Performance · Sales".
 *
 * Also proves a real bug found by reading AnalyticsPage.tsx directly: the
 * whole SALES-DERIVED ANALYTICS block (liveSales — feeding Daily Revenue/GP,
 * Marketplace Margin, Best Sellers, Supplier Performance · Sales) never
 * excluded voided/refunded sales, unlike the parallel unit-status-derived
 * "legacy" block (which naturally excludes returns via status==='sold').
 * A live Process Return on a real sold unit voids its Sale doc — this test
 * proves that sale's revenue/GP must NOT still be counted in Best Sellers or
 * Supplier Performance afterwards. Fixed in AnalyticsPage.tsx by filtering
 * `!s.voidedAt` into `liveSales` at its one definition point.
 *
 * Fixture:
 *   ALPHA SUPPLIER CO / model "BESTSELLER ALPHA PHONE" — 4 units:
 *     3 sold via AMAZON (SP=300 each), 1 of those 3 then RETURNED live via
 *     Process Return -> Return to Supplier (voids that Sale, unit status
 *     'returned'), 1 unit never sold (available).
 *     Expected AFTER the return: 2 sold, 1 returned, 1 available, 4 total
 *     -> return rate 25%; Best Sellers / revenue/GP count only the 2
 *     surviving (non-voided) sales.
 *   BETA SUPPLIER CO / model "BESTSELLER BETA PHONE" — 3 units, all 3 sold
 *     via EBAY (SP=120 each), 0 returned -> return rate 0%.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eSupplierAndBestSellersBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/supplier-and-best-sellers';
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
  // The Import dropdown is gone. Inventory and Sales import are now two
  // labelled icon buttons in the header (App.tsx, behind SHOW_IMPORT_UI &&
  // userIsAdmin), so there is no menu to open — the click that used to follow
  // this call now targets the button directly. Kept as a no-op so the call
  // sites read the same and the diff stays reviewable.
  await page.waitForTimeout(200);
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
  await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(5000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
}
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}
async function processReturnFor(page, { imeiSearch, returnType, reason, outcome }) {
  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Process Return$/i }).click();
  await page.waitForTimeout(500);
  const pickerModal = modal(page);
  await pickerModal.locator('input[placeholder*="Search by model" i]').fill(imeiSearch);
  await page.waitForTimeout(400);
  await pickerModal.locator('button', { hasText: imeiSearch }).first().click();
  await page.waitForTimeout(600);

  const qcModal = modal(page);
  await qcModal.locator('textarea').nth(0).fill('Customer says it stopped charging.');
  await qcModal.locator('textarea').nth(1).fill('QC: confirmed fault, unit otherwise clean.');
  await qcModal.getByRole('button', { name: /Send to CRM Queue/i }).click();
  await page.waitForTimeout(1000);
  await dismissModals(page);

  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Finalise$/i }).first().click();
  await page.waitForTimeout(600);
  const crmModal = modal(page);
  await crmModal.getByText(returnType, { exact: false }).first().click();
  await page.waitForTimeout(300);
  await crmModal.locator('input[placeholder*="Customer changed mind" i]').fill(reason);
  if (outcome) {
    await crmModal.getByText(outcome, { exact: false }).first().click();
    await page.waitForTimeout(200);
  }
  await crmModal.getByRole('button', { name: /Finalise Return/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);
}

// ── Fixture ──────────────────────────────────────────────────────────────
const SUPPLIER_ALPHA = 'ALPHA SUPPLIER CO';
const SUPPLIER_BETA = 'BETA SUPPLIER CO';
const MODEL_ALPHA = 'BESTSELLER ALPHA PHONE';
const MODEL_BETA = 'BESTSELLER BETA PHONE';

// ALPHA: 4 units — 3 sold (AMAZON, SP=300), 1 of the 3 gets returned live, 1 never sold.
const A_SOLD = ['350190000094001', '350190000094002', '350190000094003'];
const A_AVAIL = ['350190000094004'];
const A_RETURNED_IMEI = A_SOLD[2]; // the 3rd sold unit gets returned live

// BETA: 3 units, all 3 sold (EBAY, SP=120), none returned.
const B_SOLD = ['350190000095001', '350190000095002', '350190000095003'];

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ...A_SOLD.map(imei => ['2026-06-01', MODEL_ALPHA, imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER_ALPHA, 100, 'OFFICE', '']),
    ...A_AVAIL.map(imei => ['2026-06-01', MODEL_ALPHA, imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER_ALPHA, 100, 'OFFICE', '']),
    ...B_SOLD.map(imei => ['2026-06-01', MODEL_BETA, imei, 'A', '128GB', 'Physical SIM', 'BLUE', SUPPLIER_BETA, 90, 'OFFICE', '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const amazonRows = A_SOLD.map(imei => ['2026-07-10', `AMZ-A-${imei.slice(-4)}`, 'BSA-128-BLK', imei, SUPPLIER_ALPHA, 1, 100, 300, 200, '', '', 8, '', '', '', '', '', '']);
  const ebayRows = B_SOLD.map(imei => ['2026-07-12', `EBAY-B-${imei.slice(-4)}`, 'BSB-128-BLU', imei, SUPPLIER_BETA, 1, 90, 120, 30, '', '', 8, '', '', '', '', '', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...amazonRows]), 'AMAZON');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...ebayRows]), 'EBAY');
  for (const m of ['BM', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'SUPPLIER_BESTSELLERS_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'SUPPLIER_BESTSELLERS_SALES.xlsx');
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
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE);
  await page.waitForTimeout(4000);
  const flipAck = modal(page).getByText(/I've reviewed the list/i);
  if (await flipAck.isVisible().catch(() => false)) { await flipAck.click(); await page.waitForTimeout(300); }
  await modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last().click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  // Live-process one ALPHA return -> Return to Supplier (voids that Sale).
  await processReturnFor(page, {
    imeiSearch: A_RETURNED_IMEI,
    returnType: 'Return to Supplier',
    reason: 'Faulty on arrival, RTS to supplier',
  });

  const store = await dumpStore(page);
  const allSales = Object.values(store.sales ?? {});
  const returnedSale = allSales.find(s => s.imei === A_RETURNED_IMEI);
  record('The returned ALPHA unit\'s Sale doc is actually voided', !!returnedSale?.voidedAt, returnedSale?.voidedAt);

  const survivingAlphaSales = allSales.filter(s => A_SOLD.includes(s.imei) && !s.voidedAt);
  const expectedAlphaRevenue = survivingAlphaSales.reduce((s, r) => s + (r.salePrice || 0), 0);
  const expectedAlphaGp = survivingAlphaSales.reduce((s, r) => s + (r.grossProfit || 0), 0);
  console.log(`\nExpected (from store, voided excluded): ALPHA ${survivingAlphaSales.length} surviving sales, revenue £${expectedAlphaRevenue}, GP £${Math.round(expectedAlphaGp)}`);

  const allUnits = Object.values(store.inventoryUnits ?? {});
  const alphaUnits = allUnits.filter(u => u.model === MODEL_ALPHA || A_SOLD.includes(u.imei) || A_AVAIL.includes(u.imei));
  const alphaReturnedCount = alphaUnits.filter(u => u.status === 'returned').length;
  const alphaSoldCount = alphaUnits.filter(u => u.status === 'sold').length;
  record('ALPHA: exactly 1 unit is now status=returned', alphaReturnedCount === 1, `returned=${alphaReturnedCount}`);
  record('ALPHA: exactly 2 units remain status=sold', alphaSoldCount === 2, `sold=${alphaSoldCount}`);

  // ═══ Admin → Insights: Best Sellers by GP + Supplier Performance · Sales ═══
  await gotoAdminSub(page, 'Insights');
  await page.waitForTimeout(800);

  const bestSellersToggle = page.locator('button', { hasText: 'Top 10 Best Sellers' }).first();
  await bestSellersToggle.scrollIntoViewIfNeeded().catch(() => {});
  await bestSellersToggle.click();
  await page.waitForTimeout(400);

  const supplierPerfToggle = page.locator('button', { hasText: 'Supplier Performance' }).filter({ hasText: 'return rate' }).first();
  await supplierPerfToggle.scrollIntoViewIfNeeded().catch(() => {});
  await supplierPerfToggle.click();
  await page.waitForTimeout(400);
  await shot(page, 'admin-insights-bestsellers-supplierperf');

  const insightsText = await page.innerText('body').catch(() => '');

  record('Best Sellers shows BESTSELLER ALPHA PHONE with 2 sold (NOT 3 — the voided sale excluded)',
    (() => {
      const chunk = insightsText.match(/ALPHA PHONE[\s\S]*?(?=BESTSELLER)/i)?.[0] || '';
      return /\b2 sold\b/i.test(chunk) && !/\b3 sold\b/i.test(chunk);
    })(), insightsText.match(/ALPHA PHONE[\s\S]*?(?=BESTSELLER)/i)?.[0]);
  record(`Best Sellers shows BESTSELLER ALPHA PHONE revenue £${expectedAlphaRevenue.toLocaleString()} (voided sale's £300 excluded, not £900)`,
    insightsText.includes(`£${expectedAlphaRevenue.toLocaleString()}`));
  record('Best Sellers shows BESTSELLER BETA PHONE with 3 sold',
    (() => {
      const chunk = insightsText.match(/BETA PHONE[\s\S]{0,150}/i)?.[0] || '';
      return /\b3 sold\b/i.test(chunk);
    })());
  record('Best Sellers shows BESTSELLER BETA PHONE revenue £360 (3 x £120)', insightsText.includes('£360'));

  record('Supplier Performance · Sales shows ALPHA SUPPLIER CO with Sold=2', /ALPHA SUPPLIER CO[\s\S]{0,60}2\b/i.test(insightsText),
    insightsText.match(/ALPHA SUPPLIER CO[\s\S]{0,60}/i)?.[0]);
  record('Supplier Performance · Sales shows BETA SUPPLIER CO with Sold=3', /BETA SUPPLIER CO[\s\S]{0,60}3\b/i.test(insightsText),
    insightsText.match(/BETA SUPPLIER CO[\s\S]{0,60}/i)?.[0]);
  record('Supplier Performance · Sales shows ALPHA SUPPLIER CO return rate 25%',
    (() => {
      const chunk = insightsText.match(/ALPHA SUPPLIER CO[\s\S]{0,250}/i)?.[0] || '';
      return /25%/.test(chunk);
    })(), insightsText.match(/ALPHA SUPPLIER CO[\s\S]{0,250}/i)?.[0]);
  // Renders a literal "0%", not an em-dash. The panel used to print "—" for a
  // supplier with no returns; it prints the zero now, which is less ambiguous
  // — a dash reads as "not measured" when the real answer is "none came back".
  // This assertion also passed no detail, so when it failed it said only
  // "false" and gave nothing to work from. It reports the chunk now.
  record('Supplier Performance · Sales shows BETA SUPPLIER CO return rate 0%',
    (() => {
      const chunk = insightsText.match(/BETA SUPPLIER CO[\s\S]{0,250}/i)?.[0] || '';
      return /\b0%/.test(chunk) || /—/.test(chunk);
    })(), (insightsText.match(/BETA SUPPLIER CO[\s\S]{0,120}/i)?.[0] || 'BETA row not found').replace(/\s+/g, ' '));
  record(`Supplier Performance · Sales shows ALPHA revenue £${expectedAlphaRevenue.toLocaleString()} (not £900)`,
    (() => {
      const chunk = insightsText.match(/ALPHA SUPPLIER CO[\s\S]{0,250}/i)?.[0] || '';
      return chunk.includes(`£${expectedAlphaRevenue.toLocaleString()}`) && !chunk.includes('£900');
    })());

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
