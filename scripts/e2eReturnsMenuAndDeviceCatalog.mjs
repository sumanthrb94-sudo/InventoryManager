/**
 * scripts/e2eReturnsMenuAndDeviceCatalog.mjs — end-to-end proof for the two
 * fixes from this session:
 *
 *   1. Returns page: "Send to Repair" / "Re-process return" removed from the
 *      Back to Inventory / Returned to Supplier / All Returns rows (they can
 *      never succeed there — those rows are never status='sold' — and the
 *      Tech-QC step of Re-process return had no guard, so it could stamp a
 *      settled return as pending-CRM-review forever). In Repair rows must
 *      still show the working "Ready to Ship · Back to Stock" action.
 *
 *   2. Sales Report audit-completion model picker: an orphan sale's Model
 *      combobox must only ever suggest devices from ITS OWN stock bucket —
 *      office-flagged rows see office units, SHS-flagged rows see SHS units,
 *      never the other bucket's catalog.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eReturnsMenuAndDeviceCatalog.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/returns-menu-device-catalog';
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
  return page.locator('div.fixed.inset-0[class*="z-["]').last();
}

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) {
      await close.click().catch(() => {});
    } else {
      await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }
}

async function gotoTab(page, label) {
  await dismissModals(page);
  // Nav buttons can carry a live badge count appended to their accessible
  // name (e.g. "Returns 1" while a CRM review is pending) — match on the
  // label as a prefix, not an exact string, so a badge doesn't break this.
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
  await page.waitForTimeout(1000);
  await dismissModals(page);
}

// ── Fixtures ─────────────────────────────────────────────────────────────
const SUPPLIER = 'MOBILE WHOLESALE LTD';
const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];

// Three office units to be sold live and pushed through Process Return
// (one to "Back to Inventory", one to "Returned to Supplier", one to "Repair").
const IMEI_1 = '350190000011111'; // -> Back to Inventory
const IMEI_2 = '350190000022222'; // -> Returned to Supplier
const IMEI_3 = '350190000033333'; // -> Repair

function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['2026-06-01', 'IPHONE 14 128GB', IMEI_1, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 350, 'OFFICE', ''],
    ['2026-06-01', 'IPHONE 14 128GB', IMEI_2, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 350, 'OFFICE', ''],
    ['2026-06-01', 'IPHONE 14 128GB', IMEI_3, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 350, 'OFFICE', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}

const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function activeSaleRow(imei, order) {
  return ['2026-07-10', order, 'IP14-128-BLK', imei, SUPPLIER, 1, 350, 500, 150, '', '', 8, '', '', '', '', '', ''];
}
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    AMAZON_HEADERS,
    activeSaleRow(IMEI_1, 'AMZ-1-1'),
    activeSaleRow(IMEI_2, 'AMZ-2-1'),
    activeSaleRow(IMEI_3, 'AMZ-3-1'),
  ]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}

// ── Device-catalog fixtures (Part 2) ───────────────────────────────────────
// Office model vs SHS model, deliberately distinct names so a screenshot
// leaves no doubt which bucket's catalog is showing.
const OFFICE_MODEL_IMEI = '350190000044001';
const SHS_MODEL_IMEI = ''; // SHS units may have no IMEI at all
function writeInventoryFixture2(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['2026-06-01', 'PIXEL OFFICE CATALOG PHONE', OFFICE_MODEL_IMEI, 'A', '128GB', 'Physical SIM', 'BLUE', SUPPLIER, 200, 'OFFICE', ''],
    ['2026-06-01', 'PIXEL SHS CATALOG PHONE', '', 'A', '256GB', 'Dual Physical SIM', 'GREEN', SUPPLIER, 220, 'SHS', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}

// Two orphan sales — IMEIs that exist nowhere in inventory, so both need a
// manual model pick. One will be toggled to the SHS bucket in the UI.
const ORPHAN_OFFICE_IMEI = '350190000055001';
const ORPHAN_SHS_IMEI = '350190000055002';
function writeSalesFixture2(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    AMAZON_HEADERS,
    ['2026-07-12', 'AMZ-ORPHAN-OFFICE', 'UNKNOWN-SKU-1', ORPHAN_OFFICE_IMEI, SUPPLIER, 1, 200, 300, 100, '', '', 8, '', '', '', '', '', ''],
    ['2026-07-12', 'AMZ-ORPHAN-SHS', 'UNKNOWN-SKU-2', ORPHAN_SHS_IMEI, SUPPLIER, 1, 220, 320, 100, '', '', 8, '', '', '', '', '', ''],
  ]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}

const INVENTORY_FIXTURE = resolve(FIXTURES, 'INVENTORY_PART1.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'SALES_PART1.xlsx');
const INVENTORY_FIXTURE_2 = resolve(FIXTURES, 'INVENTORY_PART2.xlsx');
const SALES_FIXTURE_2 = resolve(FIXTURES, 'SALES_PART2.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);
writeInventoryFixture2(INVENTORY_FIXTURE_2);
writeSalesFixture2(SALES_FIXTURE_2);

async function importSalesActiveOnly(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(4000);
}

async function processReturnFor(page, { imeiSearch, returnType, reason, outcome }) {
  try {
    await gotoTab(page, 'Returns');
  } catch (e) {
    console.log('DEBUG url:', page.url());
    const bodyText = await page.innerText('body').catch(err => `<innerText failed: ${err}>`);
    console.log('DEBUG body text (first 2000 chars):', bodyText.slice(0, 2000));
    try {
      await page.screenshot({ path: `${OUT}/debug-gototab-returns-failed-${imeiSearch}.png`, fullPage: true, timeout: 10000 });
      console.log('DEBUG screenshot saved OK');
    } catch (shotErr) {
      console.log('DEBUG screenshot itself failed:', String(shotErr));
    }
    throw e;
  }
  await page.getByRole('button', { name: /^Process Return$/i }).click();
  await page.waitForTimeout(500);
  const pickerModal = modal(page);
  await pickerModal.locator('input[placeholder*="Search by model" i]').fill(imeiSearch);
  await page.waitForTimeout(400);
  await pickerModal.locator('button', { hasText: imeiSearch }).first().click().catch(async () => {
    // fall back: click first result row
    await pickerModal.locator('button').first().click();
  });
  await page.waitForTimeout(600);

  // Step 1: Tech-QC intake
  const qcModal = modal(page);
  await qcModal.locator('textarea').nth(0).fill('Customer says it stopped charging.');
  await qcModal.locator('textarea').nth(1).fill('QC: confirmed fault, unit otherwise clean.');
  await qcModal.getByRole('button', { name: /Send to CRM Queue/i }).click();
  await page.waitForTimeout(1000);
  await dismissModals(page);

  // Step 2: CRM finalise, via the Pending CRM Review card's Finalise button
  try {
    await gotoTab(page, 'Returns');
  } catch (e) {
    console.log('DEBUG(step2) url:', page.url());
    const bodyText = await page.innerText('body').catch(err => `<innerText failed: ${err}>`);
    console.log('DEBUG(step2) body text (first 2000 chars):', bodyText.slice(0, 2000));
    await page.screenshot({ path: `${OUT}/debug-step2-gototab-returns-failed-${imeiSearch}.png`, fullPage: true, timeout: 10000 }).catch(() => {});
    throw e;
  }
  const finaliseBtn = page.getByRole('button', { name: /^Finalise$/i }).first();
  await finaliseBtn.click();
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

  // ═══════════════════════════════════════════════════════════════════════
  // PART 1 — Returns page menu fix
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);
  await importSalesActiveOnly(page, SALES_FIXTURE);
  await shot(page, 'part1-sales-preview-active-only');
  const flipAck1 = modal(page).getByText(/I've reviewed the list/i);
  if (await flipAck1.isVisible().catch(() => false)) { await flipAck1.click(); await page.waitForTimeout(300); }
  await modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last().click();
  await page.waitForTimeout(4000);
  await shot(page, 'part1-sales-done-screen');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
  await page.waitForTimeout(500);

  await processReturnFor(page, { imeiSearch: IMEI_1, returnType: 'Back to Inventory', reason: 'Customer changed mind', outcome: 'Refund' });
  await processReturnFor(page, { imeiSearch: IMEI_2, returnType: 'Return to Supplier', reason: 'Faulty on arrival, RTS to supplier' });
  await processReturnFor(page, { imeiSearch: IMEI_3, returnType: 'Send for Repair', reason: 'Screen fault, needs bench repair' });

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(800);
  await shot(page, 'part1-returns-page-overview');

  const pageText = await page.innerText('body').catch(() => '');
  record('Part1: Back to Inventory / Returned to Supplier / In Repair KPIs all show units',
    /Back to Inventory/i.test(pageText) && /Returned to Supplier/i.test(pageText) && /In Repair/i.test(pageText));

  // ── Row 1: Back to Inventory — confirm no "..." action button at all ──
  const row1 = page.locator('tr', { hasText: IMEI_1 }).first();
  await row1.scrollIntoViewIfNeeded().catch(() => {});
  await row1.hover();
  await page.waitForTimeout(300);
  await shot(page, 'part1-back-to-inventory-row-hover');
  const row1MoreBtn = row1.locator('button[title="More actions"]');
  const row1MoreCount = await row1MoreBtn.count();
  record('Part1: Back to Inventory row has NO "More actions" (...) button', row1MoreCount === 0, `found ${row1MoreCount}`);
  const row1Text = await row1.innerText().catch(() => '');
  record('Part1: Back to Inventory row text has no Send to Repair / Re-process return leftover', !/Send to Repair/i.test(row1Text) && !/Re-process return/i.test(row1Text));

  // ── Row 2: Returned to Supplier — same check ──
  const row2 = page.locator('tr', { hasText: IMEI_2 }).first();
  await row2.scrollIntoViewIfNeeded().catch(() => {});
  await row2.hover();
  await page.waitForTimeout(300);
  await shot(page, 'part1-returned-to-supplier-row-hover');
  const row2MoreCount = await row2.locator('button[title="More actions"]').count();
  record('Part1: Returned to Supplier row has NO "More actions" (...) button', row2MoreCount === 0, `found ${row2MoreCount}`);

  // ── Row 3: In Repair — confirm the working action IS still there ──
  const row3 = page.locator('tr', { hasText: IMEI_3 }).first();
  await row3.scrollIntoViewIfNeeded().catch(() => {});
  await row3.hover();
  await page.waitForTimeout(300);
  const row3InlineBtn = row3.getByRole('button', { name: /Back to Stock/i });
  record('Part1: In Repair row DOES show the inline "Back to Stock" button', await row3InlineBtn.isVisible().catch(() => false));
  await shot(page, 'part1-in-repair-row-hover');

  const row3MoreBtn = row3.locator('button[title="More actions"]');
  record('Part1: In Repair row DOES show the "More actions" (...) button', await row3MoreBtn.isVisible().catch(() => false));
  await row3MoreBtn.click();
  await page.waitForTimeout(300);
  await shot(page, 'part1-in-repair-row-menu-open');
  const openMenuText = await page.locator('div.absolute.right-0.mt-1.w-48').last().innerText().catch(() => '');
  record('Part1: In Repair "..." menu shows ONLY "Ready to Ship · Back to Stock"',
    /Ready to Ship/i.test(openMenuText) && !/Send to Repair/i.test(openMenuText) && !/Re-process return/i.test(openMenuText),
    JSON.stringify(openMenuText));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── All Returns overlay — every row's action area checked at once ──
  await dismissModals(page);
  const allReturnsKpi = page.getByText(/^All Returns$/i).first();
  if (await allReturnsKpi.isVisible().catch(() => false)) {
    await allReturnsKpi.click();
    await page.waitForTimeout(600);
    await shot(page, 'part1-all-returns-overlay');
    const overlayMoreButtons = await modal(page).locator('button[title="More actions"]').count();
    record('Part1: All Returns overlay shows exactly 1 "More actions" button (only the In-Repair row)', overlayMoreButtons === 1, `found ${overlayMoreButtons}`);
    await dismissModals(page);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PART 2 — Device catalog is correctly scoped per office/SHS bucket
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE_2);
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE_2);
  await page.waitForTimeout(4000);
  await shot(page, 'part2-sales-preview-orphans');

  // Both orphan rows default to 'office'. Toggle the second row to SHS.
  const orphanRows = modal(page).locator('li', { hasText: /AMZ-ORPHAN-/ });
  const officeRow = modal(page).locator('li', { hasText: 'AMZ-ORPHAN-OFFICE' }).first();
  const shsRow = modal(page).locator('li', { hasText: 'AMZ-ORPHAN-SHS' }).first();
  await shsRow.getByRole('button', { name: /^SHS$/i }).click();
  await page.waitForTimeout(400);
  await shot(page, 'part2-shs-row-toggled');

  // Office row's model picker — should offer PIXEL OFFICE CATALOG PHONE only.
  await officeRow.locator('input[placeholder="Search model…"]').click();
  await page.waitForTimeout(400);
  await shot(page, 'part2-office-row-catalog-open');
  const officeCatalogText = await page.locator('div.z-\\[9999\\]').last().innerText().catch(() => '');
  record('Part2: Office orphan row catalog shows the OFFICE model', /PIXEL OFFICE CATALOG PHONE/i.test(officeCatalogText));
  record('Part2: Office orphan row catalog does NOT show the SHS model', !/PIXEL SHS CATALOG PHONE/i.test(officeCatalogText));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // SHS row's model picker — should offer PIXEL SHS CATALOG PHONE only.
  await shsRow.locator('input[placeholder="Search model…"]').click();
  await page.waitForTimeout(400);
  await shot(page, 'part2-shs-row-catalog-open');
  const shsCatalogText = await page.locator('div.z-\\[9999\\]').last().innerText().catch(() => '');
  record('Part2: SHS orphan row catalog shows the SHS model', /PIXEL SHS CATALOG PHONE/i.test(shsCatalogText));
  record('Part2: SHS orphan row catalog does NOT show the OFFICE model', !/PIXEL OFFICE CATALOG PHONE/i.test(shsCatalogText));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  record('No uncaught JS errors across either part', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
