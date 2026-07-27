/**
 * scripts/e2eReturnTypesRoundTrip.mjs — proves ALL THREE return
 * destinations (Back to Inventory, Return to Supplier, Repair) survive a
 * real download → wipe → re-upload round trip with zero manual fill-in.
 *
 * Unlike e2eReturnRestoreOnReimport.mjs (which used hand-built fixture
 * workbooks), this drives the return live through the real Process Return
 * UI for all three destinations, downloads the app's OWN Inventory Report
 * + Sales Report afterwards, wipes the database, re-uploads both real
 * downloads, and checks that all three units land back in EXACTLY their
 * pre-wipe state — no orphan-fill screen, no manual search, nothing.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eReturnTypesRoundTrip.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/return-types-round-trip';
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
// Proven exactly as-is (13/13) in e2eReturnsMenuAndDeviceCatalog.mjs — do
// not "improve" this without re-verifying against that script's coverage.
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
// matches THAT button first since it's already visible (no drawer needed),
// so gotoTab() would "succeed" without ever leaving the Stock Intake page.
// This always forces the hamburger drawer open and scopes the click to it.
async function gotoInventoryTabViaDrawer(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click().catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^Inventory$/i }).first().click();
  await page.waitForTimeout(900);
  await dismissModals(page);
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

// ── Fixtures: 3 office units, sold live, each returned a different way ────
const SUPPLIER = 'MOBILE WHOLESALE LTD';
const IMEI_1 = '350190000091111'; // -> Back to Inventory (Refund)
const IMEI_2 = '350190000092222'; // -> Return to Supplier
const IMEI_3 = '350190000093333'; // -> Repair
const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [IMEI_1, IMEI_2, IMEI_3].map(imei =>
    ['2026-06-01', 'IPHONE 14 128GB', imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 350, 'OFFICE', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const row = imei => ['2026-07-10', `AMZ-${imei.slice(-4)}`, 'IP14-128-BLK', imei, SUPPLIER, 1, 350, 500, 150, '', '', 8, '', '', '', '', '', ''];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, row(IMEI_1), row(IMEI_2), row(IMEI_3)]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'SALES.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);

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

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
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

  // Live-process all three return destinations.
  await processReturnFor(page, { imeiSearch: IMEI_1, returnType: 'Back to Inventory', reason: 'Customer changed mind', outcome: 'Refund' });
  await processReturnFor(page, { imeiSearch: IMEI_2, returnType: 'Return to Supplier', reason: 'Faulty on arrival, RTS to supplier' });
  await processReturnFor(page, { imeiSearch: IMEI_3, returnType: 'Send for Repair', reason: 'Screen fault, needs bench repair' });

  const preWipeStore = await dumpStore(page);
  const preWipeUnits = {};
  for (const imei of [IMEI_1, IMEI_2, IMEI_3]) {
    preWipeUnits[imei] = Object.values(preWipeStore.inventoryUnits ?? {}).find(u => u.imei === imei);
  }
  console.log('\nPre-wipe state:');
  for (const imei of [IMEI_1, IMEI_2, IMEI_3]) {
    const u = preWipeUnits[imei];
    console.log(` ${imei}: status=${u?.status} returnType=${u?.returnType} returnDate=${u?.returnDate} returnOutcome=${u?.returnOutcome}`);
  }

  // ── Download the app's OWN Inventory Report + Sales Report ─────────────
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(500);
  const invReportBtn = page.getByRole('button', { name: /^Inventory Report$/i }).first();
  const [invDownload] = await Promise.all([
    page.waitForEvent('download').catch(() => null),
    invReportBtn.click().catch(() => {}),
  ]);
  // If the button opens a range-picker menu instead of downloading directly, pick "All Time".
  let invDl = invDownload;
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
  const downloadedInventoryPath = resolve(OUT, 'downloaded-inventory-report.xlsx');
  if (invDl) await invDl.saveAs(downloadedInventoryPath);
  record('Downloaded a real Inventory Report from the app', !!invDl);
  await dismissModals(page);

  await gotoInventoryTabViaDrawer(page);
  await page.waitForTimeout(500);
  await shot(page, 'debug-on-inventory-sell-tab');
  const salesReportBtn = page.getByRole('button', { name: /^Sales Report$/i }).first();
  const [salesDl0] = await Promise.all([
    page.waitForEvent('download').catch(() => null),
    salesReportBtn.click().catch(() => {}),
  ]);
  let salesDl = salesDl0;
  if (!salesDl) {
    await page.waitForTimeout(400);
    const allTime = page.getByRole('button', { name: /All Time/i }).first();
    if (await allTime.isVisible().catch(() => false)) {
      [salesDl] = await Promise.all([
        page.waitForEvent('download').catch(() => null),
        allTime.click().catch(() => {}),
      ]);
    }
  }
  const downloadedSalesPath = resolve(OUT, 'downloaded-sales-report.xlsx');
  if (salesDl) await salesDl.saveAs(downloadedSalesPath);
  record('Downloaded a real Sales Report from the app', !!salesDl);
  await dismissModals(page);

  // ── Verify the downloaded Sales Report's Returns Detail sheet reflects
  //    all three return types correctly, straight from the real export ──
  if (salesDl) {
    const wb = XLSX.read(readFileSync(downloadedSalesPath));
    const sheetName = wb.SheetNames.find(n => /returns detail/i.test(n));
    record('Downloaded Sales Report has a Returns Detail sheet', !!sheetName, wb.SheetNames.join(', '));
    if (sheetName) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
      const header = rows[0] || [];
      const imeiCol = header.findIndex(h => /unit imei/i.test(String(h)));
      const typeCol = header.findIndex(h => /return type/i.test(String(h)));
      const found = {};
      for (const r of rows.slice(1)) {
        const imei = String(r[imeiCol] ?? '');
        if ([IMEI_1, IMEI_2, IMEI_3].includes(imei)) found[imei] = r[typeCol];
      }
      record('Returns Detail sheet shows Back to Inventory for IMEI_1', /back to inventory/i.test(found[IMEI_1] || ''), found[IMEI_1]);
      // clientReport.ts's export column label for this returnType is "To
      // Supplier" (returnTypeExportLabel), distinct from — but consistent
      // with — the live UI's "Return to Supplier" button text.
      record('Returns Detail sheet shows To Supplier for IMEI_2', /to supplier/i.test(found[IMEI_2] || ''), found[IMEI_2]);
      record('Returns Detail sheet shows Repair for IMEI_3', /repair/i.test(found[IMEI_3] || ''), found[IMEI_3]);
    }
  }

  // ── Wipe everything, re-upload ONLY the two real downloads ──────────────
  await wipeAll(page);
  if (invDl) {
    await importInventory(page, downloadedInventoryPath);
  }
  if (salesDl) {
    await gotoTab(page, 'Stock Intake');
    await openImportMenu(page);
    await page.getByRole('menuitem', { name: /Sales Report/i }).click();
    await page.waitForTimeout(700);
    await page.locator('input[type="file"]').first().setInputFiles(downloadedSalesPath);
    await page.waitForTimeout(4000);
    await shot(page, 'reupload-sales-preview');

    const previewText = await modal(page).innerText().catch(() => '');
    record('Re-upload preview requires NO manual orphan fill (no "COMPLETE ... RECORDS" gate)',
      !/COMPLETE \d+ RECORDS? TO CONTINUE/i.test(previewText), previewText.match(/COMPLETE[^\n]*/i)?.[0] ?? '(none found)');
    record('Re-upload preview shows the Returns to restore panel', /Returns to restore/i.test(previewText));

    const confirmBtn = modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last();
    await confirmBtn.click();
    await page.waitForTimeout(4000);
    await shot(page, 'reupload-sales-done');
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
    await dismissModals(page);
  }

  // ── Verify all three units landed back EXACTLY where they were ─────────
  const postStore = await dumpStore(page);
  for (const [imei, label] of [[IMEI_1, 'Back to Inventory'], [IMEI_2, 'Return to Supplier'], [IMEI_3, 'Repair']]) {
    const before = preWipeUnits[imei];
    const after = Object.values(postStore.inventoryUnits ?? {}).find(u => u.imei === imei);
    record(`${label}: unit exists after wipe + re-upload with no manual fill`, !!after, after ? after.id : '(missing)');
    if (after) {
      record(`${label}: status matches pre-wipe (${before?.status})`, after.status === before?.status, `now=${after.status}`);
      record(`${label}: returnType matches pre-wipe (${before?.returnType})`, after.returnType === before?.returnType, `now=${after.returnType}`);
      record(`${label}: returnDate matches pre-wipe (${before?.returnDate})`, after.returnDate === before?.returnDate, `now=${after.returnDate}`);
    }
  }
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(600);
  await shot(page, 'returns-page-after-round-trip');

  record('No uncaught JS errors across the whole round trip', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
