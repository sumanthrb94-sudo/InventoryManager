/**
 * scripts/e2eReturnRestoreOnReimport.mjs — does a re-uploaded Sales Report
 * put a return back where it belongs?
 *
 * Built for the live incident where 48 returned units were permanently
 * deleted via "Delete Unit" instead of "Process Return" — reconstructing
 * that data by hand from a downloaded Sales Report was the stopgap; this
 * proves the app now does the reconciliation itself on re-import.
 *
 * Two scenarios, covering both paths of restoreUnitReturnFromImport:
 *
 *   A. Unit still exists (status='sold') when its voided sale re-imports —
 *      the unit gets PATCHED back to its return state (status/returnType/
 *      returnDate/returnReason/returnOutcome, sale-provenance cleared).
 *      A second, non-voided sale imports alongside it as a control, to
 *      prove restoration doesn't touch unrelated sales/units.
 *
 *   B. No unit exists at all (the exact incident shape: DB wiped, only the
 *      Sales Report survives) — the unit is RECONSTRUCTED directly in
 *      returned/available shape, skipping the 'sold' intermediate.
 *
 *   C. The two reports uploaded SEPARATELY, one after the other, into an
 *      empty database — Inventory Report first (agreed workflow order),
 *      then the Sales Report — proving they link back to the SAME unit
 *      doc by IMEI with no duplicate created, and that the Inventory
 *      Report's cosmetic fields (Grade/Storage/SIM Type/Colour) survive
 *      the Sales Report's return-restore patch untouched.
 *
 *   D. Multi-cycle: sold → returned → sold AGAIN, then the whole history
 *      re-imports in one file (DB wiped). The audit-completion step marks
 *      the unit sold again under the NEWER order before the returns-restore
 *      step ever runs — proving the OLDER, now-historical return is
 *      correctly refused rather than clobbering the current sale.
 *
 * Verification is two-layered: the real UI (screenshots + preview/Done
 * text) for what the operator sees, and the E2E firestore shim's
 * sessionStorage snapshot for exact field-level assertions the UI text
 * doesn't expose.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eReturnRestoreOnReimport.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/return-restore';
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
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
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

/** Read the E2E firestore shim's raw in-memory store straight out of
 *  sessionStorage — exact field-level truth, independent of how any view
 *  chooses to render it. */
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}

// ── Fixtures ─────────────────────────────────────────────────────────────
// IMEI_A: the returning unit — voided sale + a Returns-tab Return Type.
// IMEI_B: a plain active sale on a second unit, alongside A in Scenario A
//         as a control — restoration must never touch it.
const IMEI_A = '350190000001111';
const IMEI_B = '350190000002222';
const SKU_A = 'IP13-128-BLK';
const SUPPLIER = 'MOBILE WHOLESALE LTD';

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
const invRow = (imei) => ['2026-06-01', 'IPHONE 13 128GB', imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 300, 'OFFICE', ''];

function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, invRow(IMEI_A), invRow(IMEI_B)]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}

// AMAZON layout + the 3 return-info columns writeReturnBlock exports and
// salesImport.ts's ColKey now reads back (header-name matched, so their
// position doesn't matter — appended at the end for clarity here).
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
// Matches clientReport.ts's DETAIL_HEADERS (the "Returns Detail" sheet —
// same Summary/Returns Detail/Unit Histories structure the standalone
// Returns Report uses, now embedded in the Sales Report). Unit-scoped —
// no Order Number column.
const RETURNS_DETAIL_HEADERS = ['Return Date', 'Unit IMEI', 'Model', 'Storage', 'Colour', 'Supplier', 'Original Sale Date', 'Original Sale Price', 'Marketplace', 'Return Type', 'Outcome', 'Reason', 'Comments', 'Leg Cost £', 'Shipping Legs', 'Postage Loss £'];

function activeSaleRow() {
  return ['2026-07-10', 'AMZ-B-1', SKU_A, IMEI_B, SUPPLIER, 1, 300, 450, 150, '', '', 8, '', '', '', '', '', ''];
}
function voidedSaleRow() {
  return ['2026-07-05', 'AMZ-A-1', SKU_A, IMEI_A, SUPPLIER, 1, 300, 450, 150, '', '', 6.3, '', '', '', '2026-07-15', 'Refund', 'Cx Change of Mind'];
}
function returnsDetailRow() {
  return ['2026-07-15', IMEI_A, 'IPHONE 13 128GB', '128GB', 'BLACK', SUPPLIER, '2026-07-05', 450, 'AMAZON', 'Back to Inventory', 'Refund', 'Cx Change of Mind', '', 7.56, 2, 15.12];
}

/** Scenario A: the control sale (IMEI_B, active) + the return (IMEI_A,
 *  voided + a Returns Detail row supplying its Return Type). Both
 *  marketplace-sheet rows land on the same AMAZON tab; BM/EBAY/ONBUY/TEMU
 *  ship header-only so combined parse mode doesn't report them as missing
 *  sheets. */
function writeSalesFixtureA(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, activeSaleRow(), voidedSaleRow()]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RETURNS_DETAIL_HEADERS, returnsDetailRow()]), 'Returns Detail');
  XLSX.writeFile(wb, path);
}

/** Scenario B: ONLY the return — no active-sale row, so the confirm step
 *  never touches the orphan-audit-completion UI (out of scope for this
 *  test; that flow already has its own E2E coverage). */
function writeSalesFixtureB(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, voidedSaleRow()]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RETURNS_DETAIL_HEADERS, returnsDetailRow()]), 'Returns Detail');
  XLSX.writeFile(wb, path);
}

// IMEI_C: Scenario C's unit — uploaded via a real Inventory Report row
// (distinct Grade/Colour/SIM Type from IMEI_A/B so a survived-vs-overwritten
// check is unambiguous), then its voided sale + Return Type via a SEPARATE
// Sales Report upload.
const IMEI_C = '350190000003333';

function writeInventoryFixtureC(path) {
  const wb = XLSX.utils.book_new();
  const row = ['2026-06-01', 'IPHONE 13 128GB', IMEI_C, 'B', '128GB', 'Dual Physical SIM', 'BLUE', SUPPLIER, 310, 'OFFICE', 'Scenario C fixture'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, row]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}

function voidedSaleRowC() {
  return ['2026-07-05', 'AMZ-C-1', SKU_A, IMEI_C, SUPPLIER, 1, 310, 460, 150, '', '', 6.3, '', '', '', '2026-07-16', 'Refund', 'Cx changed mind'];
}
function returnsDetailRowC() {
  return ['2026-07-16', IMEI_C, 'IPHONE 13 128GB', '128GB', 'BLUE', SUPPLIER, '2026-07-05', 460, 'AMAZON', 'Back to Inventory', 'Refund', 'Cx changed mind', '', 7.56, 2, 15.12];
}

/** Scenario C's Sales Report — only the IMEI_C voided sale, uploaded
 *  separately from (and after) the Inventory Report fixture below. */
function writeSalesFixtureC(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, voidedSaleRowC()]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RETURNS_DETAIL_HEADERS, returnsDetailRowC()]), 'Returns Detail');
  XLSX.writeFile(wb, path);
}

// IMEI_D: Scenario D's unit — sold, returned, then sold AGAIN under a
// different order, all in one file (DB wiped, no Inventory Report at all —
// the unit doesn't physically exist in the office; it's out with the
// SECOND customer). Cycle 2 (the re-sale) has no matching unit either, so
// it lands as an orphan needing one audit-completion fill (Model — IMEI,
// supplier and BP already arrive on the row and pre-fill).
const IMEI_D = '350190000004444';
function cycle1VoidedRowD() {
  // sold 1-Jun, returned 10-Jun, Return Type known from Returns Detail.
  return ['2026-06-01', 'AMZ-D-1', SKU_A, IMEI_D, SUPPLIER, 1, 300, 450, 150, '', '', 8, '', '', '', '2026-06-10', 'Refund', 'Cx first return'];
}
function cycle2ActiveRowD() {
  // sold again 20-Jul — active, no return columns at all.
  return ['2026-07-20', 'AMZ-D-2', SKU_A, IMEI_D, SUPPLIER, 1, 300, 470, 170, '', '', 8, '', '', '', '', '', ''];
}
function returnsDetailRowD() {
  return ['2026-06-10', IMEI_D, 'IPHONE 13 128GB', '128GB', 'BLACK', SUPPLIER, '2026-06-01', 450, 'AMAZON', 'Back to Inventory', 'Refund', 'Cx first return', '', 7.56, 2, 15.12];
}
function writeSalesFixtureD(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, cycle1VoidedRowD(), cycle2ActiveRowD()]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([RETURNS_DETAIL_HEADERS, returnsDetailRowD()]), 'Returns Detail');
  XLSX.writeFile(wb, path);
}

const INVENTORY_FIXTURE = resolve(FIXTURES, 'INVENTORY_FOR_RETURN_RESTORE.xlsx');
const SALES_FIXTURE_A = resolve(FIXTURES, 'SALES_RETURN_RESTORE_SCENARIO_A.xlsx');
const SALES_FIXTURE_B = resolve(FIXTURES, 'SALES_RETURN_RESTORE_SCENARIO_B.xlsx');
const INVENTORY_FIXTURE_C = resolve(FIXTURES, 'INVENTORY_FOR_RETURN_RESTORE_SCENARIO_C.xlsx');
const SALES_FIXTURE_C = resolve(FIXTURES, 'SALES_RETURN_RESTORE_SCENARIO_C.xlsx');
const SALES_FIXTURE_D = resolve(FIXTURES, 'SALES_RETURN_RESTORE_SCENARIO_D.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixtureA(SALES_FIXTURE_A);
writeSalesFixtureB(SALES_FIXTURE_B);
writeInventoryFixtureC(INVENTORY_FIXTURE_C);
writeSalesFixtureC(SALES_FIXTURE_C);
writeSalesFixtureD(SALES_FIXTURE_D);

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
  await page.waitForTimeout(1000);
  await dismissModals(page);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ═══════════════════════════════════════════════════════════════════════
  // Scenario A — unit exists (status='sold') when its voided sale re-imports
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE_A);
  await page.waitForTimeout(4000);
  await shot(page, 'scenario-a-preview');

  const previewTextA = await modal(page).innerText().catch(() => '');
  record('A: preview shows the "Returns to restore" panel', /Returns to restore/i.test(previewTextA), '');
  record('A: preview does NOT flag a missing Return Type', !/Returns with no Return Type/i.test(previewTextA), '');

  // The control sale (IMEI_B) flips its matched unit to sold — acknowledge it.
  // It's a checkbox-bearing <label>, not a button.
  const flipAck = modal(page).getByText(/I've reviewed the list/i);
  if (await flipAck.isVisible().catch(() => false)) { await flipAck.click(); await page.waitForTimeout(300); }

  const confirmA = modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last();
  await confirmA.click();
  await page.waitForTimeout(6000);
  await shot(page, 'scenario-a-done');

  const doneTextA = await modal(page).innerText().catch(() => '');
  record('A: Done screen reports a restored return', /Returns restored/i.test(doneTextA) && /1 unit.*restored to return state|restored to return state/i.test(doneTextA), doneTextA.match(/Returns restored[^\n]*/i)?.[0] ?? 'no match');

  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  const storeA = await dumpStore(page);
  const unitA = Object.values(storeA.inventoryUnits ?? {}).find(u => u.imei === IMEI_A);
  const unitB = Object.values(storeA.inventoryUnits ?? {}).find(u => u.imei === IMEI_B);
  const saleA = Object.values(storeA.sales ?? {}).find(s => s.orderNumber === 'AMZ-A-1');
  const saleB = Object.values(storeA.sales ?? {}).find(s => s.orderNumber === 'AMZ-B-1');

  record('A: returning unit is patched to status=available (returned_to_inventory)',
    unitA?.status === 'available', `status=${unitA?.status}`);
  record('A: returning unit carries the restored return fields',
    unitA?.returnType === 'returned_to_inventory' && unitA?.returnDate === '2026-07-15'
    && unitA?.returnOutcome === 'refund' && (unitA?.returnReason || '').includes('Cx Change of Mind'),
    `returnType=${unitA?.returnType} returnDate=${unitA?.returnDate} returnOutcome=${unitA?.returnOutcome} returnReason=${unitA?.returnReason}`);
  record('A: sale-provenance fields cleared on the returning unit',
    unitA?.salePrice == null && unitA?.saleDate == null && unitA?.saleOrderId == null,
    `salePrice=${unitA?.salePrice} saleDate=${unitA?.saleDate} saleOrderId=${unitA?.saleOrderId}`);
  record('A: the linked Sale doc is voided with the matching outcome',
    saleA?.voidedAt === '2026-07-15' && saleA?.voidOutcome === 'refund', `voidedAt=${saleA?.voidedAt} voidOutcome=${saleA?.voidOutcome}`);

  record('A control: unrelated active sale is untouched (not voided)', !saleB?.voidedAt, `voidedAt=${saleB?.voidedAt}`);
  record('A control: unrelated unit flips to sold normally, unaffected by the restore step',
    unitB?.status === 'sold', `status=${unitB?.status}`);

  // The Sales Report itself now carries Returns Summary / Returns Detail /
  // Unit Histories — the same structure as the standalone Returns Report,
  // embedded so return data and history live in the Sales Report rather
  // than a separate download.
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  const salesReportBtn = page.getByRole('button', { name: /Sales Report/i }).first();
  if (await salesReportBtn.isVisible().catch(() => false)) {
    await salesReportBtn.click();
    await page.waitForTimeout(600);
    const viewBtn = page.locator('button[title="View All Time in browser"]').first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
      await page.waitForTimeout(3500);
      await shot(page, 'sales-report-returns-summary-tab');
      const tabsText = await page.locator('body').innerText();
      record('Sales Report viewer shows the Returns Summary / Returns Detail / Unit Histories tabs',
        /RETURNS SUMMARY/i.test(tabsText) && /RETURNS DETAIL/i.test(tabsText) && /UNIT HISTORIES/i.test(tabsText),
        'checked tab bar text');

      const returnsDetailTab = page.getByRole('button', { name: /^RETURNS DETAIL$/i }).first();
      if (await returnsDetailTab.isVisible().catch(() => false)) {
        await returnsDetailTab.click();
        await page.waitForTimeout(1200);
        await shot(page, 'sales-report-returns-detail-tab');
        const detailText = await page.locator('body').innerText();
        record('Returns Detail tab (inside the Sales Report) shows the restored return',
          detailText.includes(IMEI_A) || detailText.includes('IPHONE 13'),
          'checked for IMEI/model in the Returns Detail sheet');
      }
    }
  }
  await dismissModals(page);

  // Returns page — the operator's actual verification surface.
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1500);
  await shot(page, 'scenario-a-returns-page');
  const returnsPageText = await page.locator('body').innerText();
  record('A: restored unit appears on the Returns page', returnsPageText.includes(IMEI_A) || returnsPageText.includes('IPHONE 13'),
    'checked for IMEI/model on the Returns page');

  // ═══════════════════════════════════════════════════════════════════════
  // Scenario B — no unit exists at all (the actual incident shape): DB
  // wiped, ONLY the Sales Report survives. The unit must be reconstructed
  // directly in returned/available shape, never via a live 'sold' moment.
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  // Deliberately NO inventory import — this is the data-loss scenario.

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE_B);
  await page.waitForTimeout(4000);
  await shot(page, 'scenario-b-preview');

  const previewTextB = await modal(page).innerText().catch(() => '');
  record('B: preview flags the unit will be reconstructed (no existing unit)',
    /unit will be reconstructed/i.test(previewTextB), '');

  const confirmB = modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last();
  await confirmB.click();
  await page.waitForTimeout(6000);
  await shot(page, 'scenario-b-done');

  const doneTextB = await modal(page).innerText().catch(() => '');
  record('B: Done screen reports a restored return', /Returns restored/i.test(doneTextB), doneTextB.match(/Returns restored[^\n]*/i)?.[0] ?? 'no match');

  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  const storeB = await dumpStore(page);
  const reconstructedUnit = Object.values(storeB.inventoryUnits ?? {}).find(u => u.imei === IMEI_A);
  const saleB2 = Object.values(storeB.sales ?? {}).find(o => o.orderNumber === 'AMZ-A-1');

  record('B: a unit was reconstructed for the returning IMEI (no live "sold" moment needed)',
    !!reconstructedUnit, reconstructedUnit ? `unit ${reconstructedUnit.id} exists` : 'no unit found');
  record('B: reconstructed unit lands directly in returned/available shape',
    reconstructedUnit?.status === 'available' && reconstructedUnit?.returnType === 'returned_to_inventory',
    `status=${reconstructedUnit?.status} returnType=${reconstructedUnit?.returnType}`);
  record('B: reconstructed unit never carries sale-provenance fields (no live sold moment existed)',
    reconstructedUnit?.salePrice == null && reconstructedUnit?.saleOrderId == null,
    `salePrice=${reconstructedUnit?.salePrice} saleOrderId=${reconstructedUnit?.saleOrderId}`);
  record('B: buy-side fields carried over from the sale (BP)',
    Number(reconstructedUnit?.buyPrice) === 300, `buyPrice=${reconstructedUnit?.buyPrice}`);
  record('B: linked Sale doc is voided', saleB2?.voidedAt === '2026-07-15', `voidedAt=${saleB2?.voidedAt}`);

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1500);
  await shot(page, 'scenario-b-returns-page');
  const returnsPageTextB = await page.locator('body').innerText();
  record('B: reconstructed unit appears on the Returns page',
    returnsPageTextB.includes(IMEI_A) || /IP13|IPHONE 13/i.test(returnsPageTextB),
    'checked for IMEI/SKU on the Returns page');

  // ═══════════════════════════════════════════════════════════════════════
  // Scenario C — the two reports uploaded SEPARATELY into an empty database:
  // Inventory Report first (agreed workflow order), then the Sales Report.
  // Proves they link back to the SAME unit doc by IMEI (no duplicate) and
  // that the Inventory Report's cosmetic fields survive the Sales Report's
  // return-restore patch untouched.
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE_C);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE_C);
  await page.waitForTimeout(4000);
  await shot(page, 'scenario-c-preview');

  const previewTextC = await modal(page).innerText().catch(() => '');
  record('C: preview shows the "Returns to restore" panel with an existing unit (not "will be reconstructed")',
    /Returns to restore/i.test(previewTextC) && !/unit will be reconstructed/i.test(previewTextC), '');

  const confirmC = modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last();
  await confirmC.click();
  await page.waitForTimeout(6000);
  await shot(page, 'scenario-c-done');
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  const storeC = await dumpStore(page);
  const unitsC = Object.values(storeC.inventoryUnits ?? {}).filter(u => u.imei === IMEI_C);
  const unitC = unitsC[0];
  const saleC = Object.values(storeC.sales ?? {}).find(s => s.orderNumber === 'AMZ-C-1');

  record('C: exactly ONE unit doc exists for the IMEI — the Sales Report patched the SAME doc the Inventory Report created, no duplicate',
    unitsC.length === 1, `found ${unitsC.length} doc(s): ${unitsC.map(u => u.id).join(', ')}`);
  record('C: unit is patched to available / returned_to_inventory',
    unitC?.status === 'available' && unitC?.returnType === 'returned_to_inventory',
    `status=${unitC?.status} returnType=${unitC?.returnType}`);
  record('C: return fields set correctly from the Sales Report',
    unitC?.returnDate === '2026-07-16' && unitC?.returnOutcome === 'refund' && (unitC?.returnReason || '').includes('Cx changed mind'),
    `returnDate=${unitC?.returnDate} returnOutcome=${unitC?.returnOutcome} returnReason=${unitC?.returnReason}`);
  record('C: Inventory Report\'s cosmetic fields (Grade/Storage/SIM Type/Colour) survive the return patch untouched',
    unitC?.grade === 'B' && unitC?.storage === '128GB' && unitC?.simType === 'Dual Physical SIM' && unitC?.colour === 'BLUE',
    `grade=${unitC?.grade} storage=${unitC?.storage} simType=${unitC?.simType} colour=${unitC?.colour}`);
  record('C: sale-provenance fields cleared', unitC?.salePrice == null && unitC?.saleOrderId == null,
    `salePrice=${unitC?.salePrice} saleOrderId=${unitC?.saleOrderId}`);
  record('C: linked Sale doc is voided', saleC?.voidedAt === '2026-07-16', `voidedAt=${saleC?.voidedAt}`);

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1500);
  await shot(page, 'scenario-c-returns-page');
  const returnsPageTextC = await page.locator('body').innerText();
  record('C: unit appears on the Returns page with its real (Inventory-Report-sourced) model',
    returnsPageTextC.includes(IMEI_C) && /IPHONE 13/i.test(returnsPageTextC),
    'checked for IMEI/model on the Returns page');

  // ═══════════════════════════════════════════════════════════════════════
  // Scenario D — multi-cycle: sold → returned → sold AGAIN, then the whole
  // history re-imports in one file (DB wiped — the unit ITSELF is out with
  // the second customer, not on the shelf, so it never gets its own
  // Inventory Report row). INVENTORY_FIXTURE is imported first purely to
  // seed "IPHONE 13" into the strict model-picker's catalog (via IMEI_A/B,
  // a different IMEI/model doc) — the audit-completion picker's suggestions
  // come from CURRENT inventory, not a global admin catalog, so a totally
  // empty database leaves it with nothing to match against. The newer
  // sale must win; the older, now-historical return must NOT be applied.
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE_D);
  await page.waitForTimeout(4000);
  await shot(page, 'scenario-d-preview');

  const previewTextD = await modal(page).innerText().catch(() => '');
  record('D: preview shows the "Returns to restore" panel for the older cycle',
    /Returns to restore/i.test(previewTextD), '');

  // Cycle 2 (the re-sale) is an orphan — no matching unit exists yet — so
  // it needs one audit-completion fill (Model; IMEI/Supplier/BP already
  // arrive on the row and pre-fill). Same pattern as e2eReportRoundTrip.mjs.
  const fillD = async (selector, value) => {
    const loc = modal(page).locator(selector);
    for (let i = 0; i < await loc.count(); i++) {
      const box = loc.nth(i);
      if ((await box.inputValue().catch(() => 'x')) === '') {
        await box.fill(value); await box.press('Tab'); await page.waitForTimeout(120);
      }
    }
  };
  await fillD('input[placeholder="Search model…"]', 'IPHONE 13');
  await fillD('input[placeholder="IMEI required"]', IMEI_D);
  await fillD('input[placeholder="Supplier required"]', SUPPLIER);
  await page.waitForTimeout(500);

  const confirmD = modal(page).getByRole('button', { name: /Load [\d,]+ sales|Complete \d+ record|Re-confirm/i }).last();
  await confirmD.click();
  await page.waitForTimeout(6000);
  await shot(page, 'scenario-d-done');
  const doneTextD = await modal(page).innerText().catch(() => '');
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  const storeD = await dumpStore(page);
  const unitsD = Object.values(storeD.inventoryUnits ?? {}).filter(u => u.imei === IMEI_D);
  const unitD = unitsD[0];
  const saleD1 = Object.values(storeD.sales ?? {}).find(s => s.orderNumber === 'AMZ-D-1');
  const saleD2 = Object.values(storeD.sales ?? {}).find(s => s.orderNumber === 'AMZ-D-2');

  record('D: exactly ONE unit doc exists for the IMEI across both cycles', unitsD.length === 1,
    `found ${unitsD.length} doc(s): ${unitsD.map(u => u.id).join(', ')}`);
  record('D: the unit ends up SOLD via the NEWER cycle (AMZ-D-2), not reverted to the old return',
    unitD?.status === 'sold' && unitD?.saleOrderId === 'AMZ-D-2',
    `status=${unitD?.status} saleOrderId=${unitD?.saleOrderId}`);
  record('D: the newer sale\'s price survives (£470, not the old cycle\'s £450)',
    Number(unitD?.salePrice) === 470, `salePrice=${unitD?.salePrice}`);
  record('D: the old return was NOT applied — returnType stays unset so the unit never shows as returned',
    !unitD?.returnType, `returnType=${unitD?.returnType}`);
  record('D: Done screen (or its failure detail) reflects the old return being refused, not silently dropped',
    /superseded|re-sold|since been/i.test(doneTextD) || /Returns needing manual/i.test(doneTextD), '');
  record('D: both Sale docs are preserved untouched — old cycle stays voided, new cycle stays active',
    saleD1?.voidedAt === '2026-06-10' && !saleD2?.voidedAt,
    `cycle1 voidedAt=${saleD1?.voidedAt} cycle2 voidedAt=${saleD2?.voidedAt}`);

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1500);
  await shot(page, 'scenario-d-returns-page');
  const returnsPageTextD = await page.locator('body').innerText();
  record('D: unit does NOT appear as an active return (it\'s currently sold, not returned)',
    !new RegExp(`${IMEI_D}[\\s\\S]{0,200}TO INVENTORY`, 'i').test(returnsPageTextD), '');

  record('no uncaught JS errors across any scenario', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  await ctx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
