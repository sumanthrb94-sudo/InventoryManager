/**
 * scripts/e2eSupplierSoldRevenueMixedSourceBrutal.mjs — pixel-precise check
 * of Admin → Configuration → Suppliers' per-supplier "Sold" / "Revenue"
 * stat tiles when a supplier has units sold BOTH via an imported Sales
 * Report AND via a real in-app "Record Sale".
 *
 * Suspected (and RULED OUT live) bug: Suppliers.tsx's supplierStats first
 * tallies every sold unit via the unit ledger (source-agnostic), then, for
 * any supplier with a sale carrying a real `supplierId`, REPLACES (not
 * merges) `sold`/`revenue` with only the sales-collection subset. A stale
 * comment elsewhere in the codebase (AnalyticsPage.tsx, since corrected)
 * claimed imported sales never carry `supplierId` — which would make that
 * replace silently drop every imported sale for a mixed-source supplier.
 * Live proof below shows this is NOT current behaviour: SalesReportImport
 * .tsx resolves and attaches a real `supplierId` to every imported sale via
 * `resolveSupplier` (line ~577), so imported and in-app sales share the same
 * id and the aggregate is correct either way. Kept as a regression test —
 * if that import-time resolution ever regresses, this test will catch the
 * exact silent-undercount failure mode described above.
 *
 * Fixture: "MIXED SALES SUPPLIER CO" — 3 units:
 *   IMEI_1, IMEI_2 sold via an imported Sales Report (AMAZON, SP=200/150).
 *   IMEI_3 sold live via the real Record Sale flow (EBAY, SP=180).
 * Expected (and confirmed correct): Sold=3, Revenue=£530 — all three sales
 * counted regardless of which path created them.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eSupplierSoldRevenueMixedSourceBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/supplier-sold-revenue-mixed-source';
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
// Dedicated helper for the ONE genuinely ambiguous case: navigating to the
// "Inventory" (Sell) tab while the "Inventory Report" download button from
// BuySheet is still on screen — a page-wide prefix search for "Inventory"
// matches THAT button first. Always forces the hamburger drawer and scopes
// the click to it. (Same fix documented in e2eReturnTypesRoundTrip.mjs.)
async function gotoInventoryTabViaDrawer(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click().catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^Inventory$/i }).first().click();
  await page.waitForTimeout(900);
  await dismissModals(page);
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
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}

// ── Fixture ──────────────────────────────────────────────────────────────
const SUPPLIER = 'MIXED SALES SUPPLIER CO';
const MODEL = 'MIXEDSOURCE TESTPHONE';
const IMEI_1 = '350190000096001'; // -> sold via imported Sales Report
const IMEI_2 = '350190000096002'; // -> sold via imported Sales Report
const IMEI_3 = '350190000096003'; // -> sold live via Record Sale (in-app)

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [IMEI_1, IMEI_2, IMEI_3].map(imei =>
    ['2026-06-01', MODEL, imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 100, 'OFFICE', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['2026-07-10', 'AMZ-MIX-1', 'MSP-128-BLK', IMEI_1, SUPPLIER, 1, 100, 200, 100, '', '', 8, '', '', '', '', '', ''],
    ['2026-07-11', 'AMZ-MIX-2', 'MSP-128-BLK', IMEI_2, SUPPLIER, 1, 100, 150, 50, '', '', 8, '', '', '', '', '', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...rows]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'MIXEDSOURCE_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'MIXEDSOURCE_SALES.xlsx');
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

  // Import the Sales Report — sells IMEI_1 and IMEI_2 with no supplierId.
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

  // Live-record a sale for IMEI_3 via the real Sell tab flow (in-app -> supplierId set).
  await gotoInventoryTabViaDrawer(page);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Record Sale/i }).first().click();
  await page.waitForTimeout(600);
  const pickerModal = modal(page);
  await pickerModal.locator('input[placeholder*="Search by model" i]').fill(IMEI_3);
  await page.waitForTimeout(400);
  await pickerModal.locator('button', { hasText: IMEI_3 }).first().click();
  await page.waitForTimeout(600);
  const sellModal = modal(page);
  await sellModal.getByRole('button', { name: /^eBay$/i }).click();
  await page.waitForTimeout(200);
  await sellModal.locator('input[placeholder*="01-14475" i]').fill('EBAY-MIX-3');
  await sellModal.locator('input[type="number"][placeholder="0.00"]').fill('180');
  await page.waitForTimeout(400);
  await sellModal.getByRole('button', { name: /Confirm Sale/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  const store = await dumpStore(page);
  const allSales = Object.values(store.sales ?? {});
  const s1 = allSales.find(s => s.orderNumber === 'AMZ-MIX-1');
  const s2 = allSales.find(s => s.orderNumber === 'AMZ-MIX-2');
  const s3 = allSales.find(s => s.orderNumber === 'EBAY-MIX-3');
  record('All 3 sales exist in the store', !!s1 && !!s2 && !!s3);
  // Ground truth (confirmed live, contra the old AnalyticsPage.tsx comment):
  // imported sales DO get a real supplierId, resolved at import time by
  // SalesReportImport.tsx's resolveSupplier() — same id as the in-app sale.
  record('Imported sales (s1, s2) DO carry a real supplierId (import-time resolution)',
    !!s1?.supplierId && !!s2?.supplierId,
    `s1.supplierId=${s1?.supplierId} s2.supplierId=${s2?.supplierId}`);
  record('In-app sale (s3) carries the SAME supplierId as the imported sales',
    !!s3?.supplierId && s3.supplierId === s1?.supplierId, `s3.supplierId=${s3?.supplierId}`);

  const expectedRevenue = (s1?.salePrice || 0) + (s2?.salePrice || 0) + (s3?.salePrice || 0);
  console.log(`\nExpected: Sold=3, Revenue=£${expectedRevenue}`);

  // ═══ Admin → Configuration → Suppliers ═══
  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(800);
  const supplierCard = page.locator('button', { hasText: SUPPLIER }).first();
  await supplierCard.scrollIntoViewIfNeeded().catch(() => {});
  await supplierCard.click();
  await page.waitForTimeout(500);
  await shot(page, 'admin-configuration-supplier-detail');

  const pageText = await page.innerText('body').catch(() => '');
  const supplierChunk = pageText.match(new RegExp(`${SUPPLIER}[\\s\\S]*?(?=\\n[A-Z][A-Z ]+CO\\b|$)`, 'i'))?.[0]
    || pageText.match(new RegExp(`${SUPPLIER}[\\s\\S]{0,600}`, 'i'))?.[0] || '';

  record(`Suppliers panel shows Sold=3 for ${SUPPLIER} (not 1 — both imported sales counted)`,
    /\bSold\b[\s\S]{0,10}3\b/i.test(supplierChunk) || /\b3\b[\s\S]{0,10}Sold\b/i.test(supplierChunk),
    supplierChunk.slice(0, 300));
  record(`Suppliers panel shows Revenue=£${expectedRevenue} for ${SUPPLIER} (not £180 — imported sales' SP included)`,
    supplierChunk.includes(`£${expectedRevenue.toLocaleString()}`),
    supplierChunk.match(/Revenue[\s\S]{0,30}/i)?.[0]);

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
