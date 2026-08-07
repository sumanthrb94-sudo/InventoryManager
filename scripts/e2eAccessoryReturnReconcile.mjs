/**
 * scripts/e2eAccessoryReturnReconcile.mjs — proves the "unified... same
 * behaviour... download wipe and re-upload should ultimately form the same"
 * ask end to end for an ACCESSORY RETURN specifically (the one piece
 * e2eAccessoryReuploadReconcile.mjs doesn't cover — that script proves the
 * sell + wipe/reupload round trip with no return in the middle).
 *
 * An accessory return voids the real Sale doc (voidedAt/voidOutcome/
 * voidReason — the exact fields a unit return sets) instead of just bumping
 * the pool by a caller-typed number. That single design choice is what lets
 * this script prove FOUR things with no return-specific plumbing anywhere
 * else in the codebase:
 *
 *   1. A re-imported marketplace row carrying Return Date / Outcome / Return
 *      Reason voids the correct sale and restores exactly that sale's
 *      quantity (not an arbitrary amount), updating the existing record
 *      rather than creating a second one.
 *
 *      This step used to click a Return button on the Accessory Stock panel.
 *      That button was removed in 2026-08 — a manual accessory return could
 *      only ever disagree with the marketplace's own record, so the
 *      marketplace file is now the single source. returnAccessoryStock and
 *      AccessoryStockActionModal's mode='return' still exist; they simply
 *      have no entry point.
 *   2. The voided accessory sale shows up on the Sales Report's embedded
 *      Returns Detail (as an "Accessory" row, friendly-named, not a raw SKU)
 *      and Returns Summary (counted + costed) — postageLossFor/
 *      writeReturnBlock/writeReturnsSheets are pure Sale-doc logic with no
 *      InventoryUnit dependency, so this works "for free".
 *   3. A full wipe + re-upload of BOTH real downloaded reports reproduces
 *      the exact pre-wipe pool quantity — Inventory Report restores the
 *      gross totalReceived baseline (untouched by sale/return), the
 *      re-uploaded Sales Report's marketplace tab carries the void columns
 *      (Return Date/Outcome/Return Reason) on the accessory's row via the
 *      ordinary writeReturnBlock path, and decrementAccessoryStock's
 *      toCreate loop skips any row with voidedAt set — so the once-returned
 *      unit never gets re-decremented.
 *   4. The re-created sale doc itself carries voidedAt/voidOutcome/
 *      voidReason after the re-upload — the void round-trips, not just the
 *      quantity.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAccessoryReturnReconcile.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { writeRowByHeader } from './e2eSheetHelpers.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-return-reconcile';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'USB-C-20W';
const ACCESSORY_NAME = 'USB-C 20W Charger';
const ADD_QTY = 50;
const ADD_BP = 3.5;
const SALE_QTY = 3;
const POSTAGE = 2.5;
const ORDER_NUMBER = 'ACC-RET-9001';
const RETURN_DATE = '2026-07-29';
const RETURN_REASON = 'wrong item ordered';
const SALES_FILE = resolve(`${OUT}/sales-accessory.xlsx`);
const RETURN_FILE = resolve(`${OUT}/sales-accessory-returned.xlsx`);

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
function modal(page) { return page.locator('div.fixed.inset-0').last(); }
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
  const re = new RegExp(`^${label}(\\s|$)(?! Report)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
}
async function scrollToAccessoryPanel(page) {
  const heading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
  await heading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
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
      accessoryStockEvents: Object.values(s.accessoryStockEvents || {}),
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
}
async function downloadReport(page, buttonName) {
  await page.getByRole('button', { name: buttonName }).first().click();
  await page.waitForTimeout(600);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    page.getByRole('button', { name: /^All Time$/i }).first().click(),
  ]);
  const path = await download.path();
  await page.waitForTimeout(800);
  await dismissModals(page);
  return path;
}

/**
 * Write a row into a template sheet BY HEADER NAME.
 *
 * These two fixtures used to write positional arrays against "the 15-column
 * Amazon layout". That layout is gone: the templates are generated from the
 * report writer now, so Amazon is 31 columns and Postage moved from index 12
 * to 15. The positional row kept writing 2.50 into what is now C. VAT, the
 * sale landed with no postage, and the Returns Detail sheet correctly showed
 * no postage loss — which looked like a missing feature and was a fixture
 * writing into the wrong cell.
 *
 * By name it cannot drift again, and it throws loudly if a column is renamed
 * rather than silently filling the wrong one.
 */

/** One accessory sale row on the AMAZON tab, addressed by header name. */
async function buildAccessorySalesFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
  writeRowByHeader(ws, 2, {
    'Date': '2026-07-22',
    'Order Number': ORDER_NUMBER,
    'SKU': SKU,
    'Supplier': 'MOBILE WHOLESALE LTD',
    'Quantity': SALE_QTY,
    'BP': ADD_BP,
    'SP': 8.99,
    'Postage': POSTAGE,
  });
  await wb.xlsx.writeFile(SALES_FILE);
}

/**
 * The SAME sale row, now carrying the return block — this is how an accessory
 * return actually arrives.
 *
 * The manual Return button on the Accessory Stock panel was removed in
 * 2026-08 (see AccessoryStockPanel.tsx): a second manual path could only ever
 * disagree with the marketplace's own record, so the marketplace file is the
 * single source. Same record id (marketplace__order__sku), so this updates
 * the existing sale rather than creating a second one.
 *
 * Return Date / Outcome / Return Reason are read by header name off the
 * marketplace tab (salesImport.ts). The template carries all three already —
 * this used to bolt them onto columns 16-18, which in the current layout are
 * P. VAT, Accessories and Total VAT, so it was overwriting real headers.
 */
async function buildAccessoryReturnFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
  writeRowByHeader(ws, 2, {
    'Date': '2026-07-22',
    'Order Number': ORDER_NUMBER,
    'SKU': SKU,
    'Supplier': 'MOBILE WHOLESALE LTD',
    'Quantity': SALE_QTY,
    'BP': ADD_BP,
    'SP': 8.99,
    'Postage': POSTAGE,
    'Return Date': RETURN_DATE,
    'Outcome': 'Refund',
    'Return Reason': RETURN_REASON,
  });
  await wb.xlsx.writeFile(RETURN_FILE);
}

async function run() {
  await buildAccessorySalesFile();
  await buildAccessoryReturnFile();

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

  // ══ 1. Create the accessory pool, sell 3 via a real Sales Report import ══
  console.log('\n── 1. Add Stock → 50 x USB-C 20W Charger, then sell 3 via Sales Report import ──');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  // Accessory intake is a strict catalog picker since 2026-08 (commit
  // 482307e) — the free-text SKU box is gone. Type into the search field,
  // then take the admin-only Add "<sku>" pill to mint a new catalog entry.
  await modal(page).locator('input[placeholder*="Search — e.g." i]').first().fill(SKU);
  await page.waitForTimeout(700);
  const addPill = modal(page).getByRole('button', { name: new RegExp(`Add "${SKU}"`, 'i') }).first();
  if (await addPill.isVisible().catch(() => false)) await addPill.click();
  await page.waitForTimeout(500);
  await modal(page).locator('input[placeholder*="e.g. USB-C 20W Charger" i]').first().fill(ACCESSORY_NAME).catch(() => {});
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill(String(ADD_QTY));
  await modal(page).locator('input[placeholder="0.00"]').first().fill(String(ADD_BP));
  await page.waitForTimeout(300);
  await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  await importSalesFile(page, SALES_FILE);
  const confirm1 = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirm1.click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterSale = await readStore(page);
  const poolAfterSale = afterSale.accessoryStock.find(a => a.sku === SKU);
  record(`Pool after sale: ${ADD_QTY - SALE_QTY} (${ADD_QTY} - ${SALE_QTY})`,
    poolAfterSale?.quantity === ADD_QTY - SALE_QTY, `quantity=${poolAfterSale?.quantity}`);
  const saleDoc = afterSale.sales.find(s => (s.sku || '') === SKU);
  record('The accessory sale doc exists and is not voided yet', !!saleDoc && !saleDoc.voidedAt);

  // ══ 2. Return it — re-import the same row carrying the return block ══════
  // This step used to click Return on the Accessory Stock panel. That button
  // was removed in 2026-08 (AccessoryStockPanel.tsx): a manual accessory
  // return could only ever disagree with the marketplace's own record, so the
  // marketplace file became the single source. The re-import carries the same
  // record id, so it UPDATES the existing sale — no duplicate row.
  console.log('\n── 2. Return arrives as a re-imported row with Return Date / Outcome / Return Reason ──');
  await importSalesFile(page, RETURN_FILE);
  await shot(page, 'return-import-preview');
  const previewText = await modal(page).innerText().catch(() => '');
  record('Import preview recognises the row as a return, not a new sale',
    /return/i.test(previewText), previewText.replace(/\s+/g, ' ').slice(0, 160));
  const confirmReturnImport = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirmReturnImport.click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);
  await shot(page, 'return-import-confirmed');

  const afterReturn = await readStore(page);
  record('Still exactly ONE sale doc for this SKU — the return updated it, did not duplicate',
    afterReturn.sales.filter(s => (s.sku || '') === SKU).length === 1,
    `count=${afterReturn.sales.filter(s => (s.sku || '') === SKU).length}`);
  const poolAfterReturn = afterReturn.accessoryStock.find(a => a.sku === SKU);
  record(`Pool back to ${ADD_QTY} after the return (exactly the sale's own quantity restored)`,
    poolAfterReturn?.quantity === ADD_QTY, `quantity=${poolAfterReturn?.quantity}`);
  record('totalReceived still 50 — a return is not new intake', poolAfterReturn?.totalReceived === ADD_QTY);

  const voidedSale = afterReturn.sales.find(s => (s.sku || '') === SKU);
  record('The real sale doc got voided (voidedAt/voidOutcome/voidReason set)',
    !!voidedSale?.voidedAt && voidedSale?.voidOutcome === 'refund' && voidedSale?.voidReason === RETURN_REASON,
    JSON.stringify({ voidedAt: voidedSale?.voidedAt, voidOutcome: voidedSale?.voidOutcome, voidReason: voidedSale?.voidReason }));

  const returnEvent = afterReturn.accessoryStockEvents.find(e => e.type === 'return');
  record('Ledger carries a return event referencing the voided sale\'s order/marketplace',
    returnEvent?.delta === SALE_QTY && returnEvent?.orderNumber === ORDER_NUMBER && returnEvent?.marketplace === 'AMAZON',
    JSON.stringify(returnEvent));

  // Step 2 now finishes on Stock Intake (the import screen) rather than on
  // Admin → Configuration, so navigate there explicitly for the panel shot.
  await dismissModals(page);
  await gotoAdminSub(page, 'Configuration');
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-back-to-50-after-return');

  // ══ 3. The voided accessory sale shows up on the Sales Report's Returns
  //       Detail / Returns Summary — no accessory-specific plumbing needed ═
  console.log('\n── 3. Download the Sales Report, verify the accessory return on Returns Detail/Summary ──');
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1000);
  const salesPath = await downloadReport(page, /Sales Report/i);
  const salesDownloaded = resolve(`${OUT}/downloaded-sales-report.xlsx`);
  copyFileSync(salesPath, salesDownloaded);
  record('Sales Report downloaded', existsSync(salesDownloaded));

  const salesWb = new ExcelJS.Workbook();
  await salesWb.xlsx.readFile(salesDownloaded);
  const returnsDetail = salesWb.getWorksheet('Returns Detail');
  const returnsSummary = salesWb.getWorksheet('Returns Summary');
  record('Sales Report carries a Returns Detail sheet', !!returnsDetail);
  record('Sales Report carries a Returns Summary sheet', !!returnsSummary);

  if (returnsDetail) {
    let accRow = null;
    for (let r = 2; r <= returnsDetail.rowCount; r++) {
      const row = returnsDetail.getRow(r);
      if (row.getCell(3).value === ACCESSORY_NAME) { accRow = row; break; }
    }
    record('Returns Detail shows the accessory return row with its friendly name (not a raw SKU)', !!accRow,
      accRow ? '' : `looked through ${returnsDetail.rowCount - 1} rows, no match for "${ACCESSORY_NAME}"`);
    if (accRow) {
      record('Return Type reads "Accessory" (distinct from a blank unit-orphan row)', accRow.getCell(10).value === 'Accessory');
      record('Outcome reads "Refund"', accRow.getCell(11).value === 'Refund');
      record('Reason carries the operator-entered text', accRow.getCell(12).value === RETURN_REASON);
      record('Marketplace reads AMAZON', accRow.getCell(9).value === 'AMAZON');
      // (postage + P.VAT) × 2 legs. P.VAT defaults to postage × 20% when
      // not separately snapshotted, per postageLossFor's fallback.
      const expectedLoss = (POSTAGE + POSTAGE * 0.2) * 2;
      record(`Postage Loss column reads £${expectedLoss.toFixed(2)} (refund = 2 legs, same policy as a unit return)`,
        Math.abs((accRow.getCell(16).value ?? 0) - expectedLoss) < 0.01, `got ${accRow.getCell(16).value}`);
    }
  }
  if (returnsSummary) {
    record('Returns Summary counts the accessory return (Total Returns = 1)', returnsSummary.getRow(2).getCell(2).value === 1,
      `got ${returnsSummary.getRow(2).getCell(2).value}`);
    record('Returns Summary counts it as a Refund', returnsSummary.getRow(3).getCell(2).value === 1,
      `got ${returnsSummary.getRow(3).getCell(2).value}`);
  }

  // ══ 4. The standard wipe + re-upload round trip reproduces the exact
  //       pre-wipe pool quantity — no accessory-return-specific code path ═
  console.log('\n── 4. Download the Inventory Report too, wipe, re-upload both, verify the pool comes back exact ──');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(500);
  const invPath = await downloadReport(page, /Inventory Report/i);
  const invDownloaded = resolve(`${OUT}/downloaded-inventory-report.xlsx`);
  copyFileSync(invPath, invDownloaded);
  record('Inventory Report downloaded', existsSync(invDownloaded));

  await wipeAll(page);
  await shot(page, 'after-wipe-empty');

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(invDownloaded);
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Restore \d+ accessory pool|Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterInvRestore = await readStore(page);
  const poolAfterInvRestore = afterInvRestore.accessoryStock.find(a => a.sku === SKU);
  record(`Inventory Report re-upload restores the gross baseline (${ADD_QTY}) — totalReceived was never touched by the sale or the return`,
    poolAfterInvRestore?.quantity === ADD_QTY, `quantity=${poolAfterInvRestore?.quantity}`);

  await importSalesFile(page, salesDownloaded);
  await page.waitForTimeout(500);
  await shot(page, 'post-wipe-reupload-sales-preview');
  const confirm2 = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirm2.click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  const afterFinalReupload = await readStore(page);
  const poolFinal = afterFinalReupload.accessoryStock.find(a => a.sku === SKU);
  record(`FULL ROUND TRIP — pool matches the exact pre-wipe quantity (${ADD_QTY}) after sell → return → download → wipe → re-upload`,
    poolFinal?.quantity === ADD_QTY, `quantity=${poolFinal?.quantity} (expected ${ADD_QTY})`);

  const reimportedSale = afterFinalReupload.sales.find(s => (s.sku || '') === SKU);
  record('The re-created sale doc itself carries the void (voidedAt/voidOutcome) — the return round-trips, not just the quantity',
    !!reimportedSale?.voidedAt && reimportedSale?.voidOutcome === 'refund',
    JSON.stringify({ voidedAt: reimportedSale?.voidedAt, voidOutcome: reimportedSale?.voidOutcome }));

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  await scrollToAccessoryPanel(page);
  await shot(page, 'pool-fully-reconciled-after-full-round-trip');

  record('No uncaught JS errors across the whole run', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
