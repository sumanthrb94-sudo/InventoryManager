/**
 * scripts/e2eQuarterSimulation.mjs — full-scale simulation requested by the
 * operator: a quarter of business (90 days, ~20 units/day) run through the
 * real app by four "personas," audited against independent ground truth,
 * then wiped and restored from a single re-upload to prove it's ready to
 * go live.
 *
 *   STOCK INTAKE  — bulk-imports the generated Inventory Report (office +
 *                   SHS + accessories), plus a couple of manual Add Stock
 *                   actions to prove that path too.
 *   SALES         — bulk-imports the generated Sales Report (marks ~1,600
 *                   units + ~530 accessory lines sold across all 5
 *                   marketplaces), plus manual Record Sale actions (unit +
 *                   accessory), plus a representative sample of LIVE
 *                   returns across refund/replacement/repair outcomes,
 *                   including one full QC-failed → repair → back-to-stock
 *                   cycle.
 *   AUDIT         — cross-checks Dashboard / Analytics / VAT Centre / the
 *                   periodic table against groundTruthCalc.mjs, which never
 *                   imports the app's own formula code.
 *   ADMIN         — Notices board, new model/accessory config, and (as a
 *                   finding, not an assumed bug) whether a model rename
 *                   cascades to historical units.
 *   GO LIVE       — downloads the real Inventory + Sales Reports from this
 *                   simulated state, wipes, re-uploads ONCE, and confirms
 *                   stock/GP/VAT reconcile exactly.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/generateQuarterSimData.mjs
 *   node scripts/e2eQuarterSimulation.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { computeGroundTruth, calcFinancials } from './groundTruthCalc.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const SIM_DIR = resolve('e2e-screenshots/quarter-simulation');
const OUT = SIM_DIR;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(SIM_DIR, 'manifest.json'), 'utf8'));
const ground = computeGroundTruth(manifest);

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function close(a, b, tol = 1) { return Math.abs(a - b) <= tol; }
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(3, '0')}-${name}.png`, fullPage: true }).catch(() => {});
}
function modal(page) { return page.locator('div.fixed.inset-0').last(); }
async function dismissModals(page) {
  for (let i = 0; i < 5; i++) {
    const overlay = page.locator('div.fixed.inset-0').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closeBtn = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label*="lose" i]').last();
    if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function gotoTab(page, label) {
  await dismissModals(page);
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  try {
    await page.getByRole('button', { name: re }).first().click({ timeout: 45000 });
  } catch (e) {
    // A stuck modal/overlay from a prior step can block every click
    // downstream — a reload keeps the sessionStorage-backed store intact
    // but clears any leftover UI state, so one bad step doesn't cascade
    // into the rest of the persona failing identically.
    console.log(`  gotoTab('${label}') first attempt failed, reloading and retrying: ${String(e).slice(0, 150)}`);
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    await dismissModals(page);
    if (!(await tab.isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: re }).first().click({ timeout: 45000 });
  }
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
  await page.waitForTimeout(3000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}
async function downloadReport(page, buttonName) {
  await page.getByRole('button', { name: buttonName }).first().click();
  await page.waitForTimeout(600);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: /^All Time$/i }).first().click(),
  ]);
  const path = await download.path();
  await page.waitForTimeout(800);
  await dismissModals(page);
  return path;
}

// ══════════════════════════════════════════════════════════════════════════
// STOCK INTAKE persona — bulk import + a couple of manual adds
// ══════════════════════════════════════════════════════════════════════════
// Polls for the modal's Close/Done button instead of a blind fixed sleep —
// a large-file confirm can legitimately take anywhere from a few seconds to
// a few minutes (per-row writes for accessory consumption / returns
// restoration inside handleConfirm), so a fixed wait is either wasteful or
// too short. capMs is a generous ceiling, not the expected case.
async function waitForImportDone(page, capMs = 240000) {
  const start = Date.now();
  const closeBtn = modal(page).getByRole('button', { name: /Close|Done/i }).last();
  while (Date.now() - start < capMs) {
    if (await closeBtn.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function importInventoryReport(page, file, longWaitMs = 45000) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(900);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  // 1800 office/SHS rows + accessories — parsing + preview can take a while.
  await page.waitForTimeout(longWaitMs);
  const loadBtn = modal(page).getByRole('button', { name: /Load [\d,]+ rows|Restore \d+ accessory pool/i }).first();
  await loadBtn.click({ timeout: 30000 });
  await waitForImportDone(page);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click({ timeout: 10000 }).catch(() => {});
  await dismissModals(page);
}

async function importSalesReport(page, file, longWaitMs = 60000) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(900);
  // No marketplace picker click — combined workbook, one sheet per marketplace,
  // auto-detected by sheet name.
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(longWaitMs);
  // Inventory impact gate — when the import flips in-stock units to 'sold',
  // a checkbox must be ticked before Confirm enables (SalesReportImport.tsx
  // ~line 1009). Tick it first if present so the click below isn't blocked.
  const ackCheckbox = modal(page).getByRole('checkbox').first();
  if (await ackCheckbox.isVisible().catch(() => false)) {
    await ackCheckbox.check({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const confirmBtn = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  await confirmBtn.click({ timeout: 30000 });
  await waitForImportDone(page);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click({ timeout: 10000 }).catch(() => {});
  await dismissModals(page);
}

async function stockIntakePersona(page) {
  console.log('\n══ STOCK INTAKE persona — bulk import + manual adds ══');
  try {
    await importInventoryReport(page, manifest.files.inventory);
    const s1 = await dumpStore(page);
    const units1 = Object.values(s1.inventoryUnits || {});
    record('Bulk Inventory Report import landed the expected office+SHS unit count',
      units1.length === manifest.officeUnits.length + manifest.shsUnits.length,
      `got ${units1.length}, expected ${manifest.officeUnits.length + manifest.shsUnits.length}`);
    const acc1 = Object.values(s1.accessoryStock || {});
    record('Bulk Inventory Report import created all 6 accessory pools', acc1.length === manifest.accessories.length, `got ${acc1.length}`);
    await shot(page, 'intake-bulk-inventory-done');
  } catch (e) {
    record('Bulk Inventory Report import completed without error', false, String(e).slice(0, 300));
  }

  // Large dataset just landed (1800+ rows) — give the periodic table / stock
  // alerts panels a beat to finish re-rendering before the next click, and
  // make sure no leftover toast/modal is still intercepting clicks.
  await dismissModals(page);
  await page.waitForTimeout(1500);

  // Manual office unit add — proves the manual path independent of bulk import.
  try {
    await gotoTab(page, 'Stock Intake');
    await page.getByRole('button', { name: /^Add Stock$/i }).click();
    await page.waitForTimeout(600);
    const officeTab = modal(page).getByRole('button', { name: /^Office/i }).first();
    if (await officeTab.isVisible().catch(() => false)) await officeTab.click();
    await page.waitForTimeout(300);
    await modal(page).getByPlaceholder(/search the catalog/i).first().fill('iPhone 13 128GB');
    const imeiInput = modal(page).getByPlaceholder(/imei/i).first();
    if (await imeiInput.isVisible().catch(() => false)) await imeiInput.fill('359999000011122');
    // Storage is a separate required <select> — typing the model text
    // (even with a storage size baked in) doesn't auto-populate it.
    const storageSelect = modal(page).locator('select').nth(1);
    if (await storageSelect.isVisible().catch(() => false)) await storageSelect.selectOption('128GB').catch(() => {});
    const bpInput = modal(page).locator('input[type="number"]').first();
    if (await bpInput.isVisible().catch(() => false)) await bpInput.fill('300');
    const supplierInput = modal(page).getByPlaceholder(/type or pick/i).first();
    if (await supplierInput.isVisible().catch(() => false)) await supplierInput.fill('IMAX');
    await shot(page, 'intake-manual-office-add-filled');
    const saveBtn = modal(page).getByRole('button', { name: /Save|Add Stock|Confirm/i }).last();
    await saveBtn.click({ timeout: 45000 });
    await page.waitForTimeout(1500);
    await dismissModals(page);
    const s2 = await dumpStore(page);
    const hasManual = Object.values(s2.inventoryUnits || {}).some(u => u.imei === '359999000011122');
    record('Manual Add Stock (office unit) reflected in the store', hasManual);
  } catch (e) {
    record('Manual Add Stock (office unit) completed without error', false, String(e).slice(0, 300));
  }

  // Manual accessory top-up — new SKU, distinct from the bulk-imported 6.
  try {
    await gotoTab(page, 'Stock Intake');
    await page.getByRole('button', { name: /^Add Stock$/i }).click();
    await page.waitForTimeout(600);
    await modal(page).getByRole('button', { name: /^Accessories/i }).click();
    await page.waitForTimeout(400);
    await modal(page).locator('input[placeholder="e.g. USB-C-20W"]').first().fill('SIM-TEST-MANUAL');
    await modal(page).locator('input[placeholder="e.g. USB-C 20W Charger"]').first().fill('Manual Test Accessory');
    await modal(page).locator('input[placeholder="e.g. 50"]').first().fill('40');
    await modal(page).locator('input[placeholder="0.00"]').first().fill('2.10');
    await page.waitForTimeout(300);
    await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click({ timeout: 45000 });
    await page.waitForTimeout(1200);
    await dismissModals(page);
    const s3 = await dumpStore(page);
    const hasAcc = Object.values(s3.accessoryStock || {}).some(a => a.sku === 'SIM-TEST-MANUAL' && a.quantity === 40);
    record('Manual Add Stock (accessory top-up) reflected in the store', hasAcc);
  } catch (e) {
    record('Manual Add Stock (accessory top-up) completed without error', false, String(e).slice(0, 300));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SALES persona — bulk import + manual sale + representative live returns
// ══════════════════════════════════════════════════════════════════════════
async function salesPersona(page) {
  console.log('\n══ SALES persona — bulk import + manual sale + live returns ══');
  let preLiveReturnsStore = null;
  try {
    await importSalesReport(page, manifest.files.sales);
    preLiveReturnsStore = await dumpStore(page);
    const sales = Object.values(preLiveReturnsStore.sales || {});
    const expectedSales = manifest.sales.length + manifest.accessorySales.length;
    record('Bulk Sales Report import created the expected sale count',
      close(sales.length, expectedSales, 5), `got ${sales.length}, expected ~${expectedSales}`);
    const soldUnits = Object.values(preLiveReturnsStore.inventoryUnits || {}).filter(u => u.status === 'sold');
    // SHS units carry no IMEI (they're supplier-held, never scanned in) —
    // the app's own hint text (SalesReportImport.tsx ~line 1345) spells out
    // the intended order as "Inventory Report → SHS Receive → Manual Stock
    // → Sales Report": an SHS unit is meant to be fulfilled through SHS
    // Receive/manual completion BEFORE it'd ever appear in a blank-IMEI bulk
    // Sales Report row, not auto-matched by a bulk import with nothing to
    // join on. So a blind bulk import correctly flips office units only —
    // this generator's SHS sale rows (blank IMEI, same as the SHS units
    // themselves) are consequently not expected to auto-fulfil here.
    record('Bulk Sales Report import flipped office units to sold',
      close(soldUnits.length, manifest.counts.officeSold, 10),
      `got ${soldUnits.length}, expected ~${manifest.counts.officeSold}`);
    await shot(page, 'sales-bulk-import-done');
  } catch (e) {
    record('Bulk Sales Report import completed without error', false, String(e).slice(0, 300));
  }

  // Large write just landed (2000+ sale docs, hundreds of units flipped to
  // sold) — same stabilization as after the inventory bulk import: let any
  // batched "sold" toast (grouped by model, but still one per distinct
  // model touched) finish rendering before the next click.
  await dismissModals(page);
  await page.waitForTimeout(1500);

  // Manual Record Sale — one available office unit, via SellOrderModal.
  try {
    await gotoTab(page, 'Inventory');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /^Record Sale$/i }).first().click();
    await page.waitForTimeout(700);
    const officeTab = modal(page).getByRole('button', { name: /^Office Stock/i }).first();
    if (await officeTab.isVisible().catch(() => false)) await officeTab.click();
    await page.waitForTimeout(400);
    const firstRow = modal(page).locator('button').filter({ hasText: /£/ }).first();
    await firstRow.click({ timeout: 45000 });
    await page.waitForTimeout(700);
    await modal(page).getByRole('button', { name: /^Amazon$/i }).click();
    await modal(page).getByPlaceholder(/026-1234567/i).fill('SIM-MANUAL-UNIT-1');
    await modal(page).locator('input[type="number"]').first().fill('450');
    await shot(page, 'sales-manual-record-sale-filled');
    await modal(page).getByRole('button', { name: /Confirm Sale/i }).click({ timeout: 45000 });
    await page.waitForTimeout(1200);
    await dismissModals(page);
    const s = await dumpStore(page);
    const manualSale = Object.values(s.sales || {}).find(x => x.orderNumber === 'SIM-MANUAL-UNIT-1');
    record('Manual Record Sale (unit) created a real Sale doc', !!manualSale);
  } catch (e) {
    record('Manual Record Sale (unit) completed without error', false, String(e).slice(0, 300));
  }

  // Manual accessory sale — via AccessorySaleModal.
  try {
    await gotoTab(page, 'Inventory');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /^Record Sale$/i }).first().click();
    await page.waitForTimeout(700);
    await modal(page).getByRole('button', { name: /^Accessories · \d+$/i }).click();
    await page.waitForTimeout(400);
    await modal(page).getByText('USB-C 20W Charger', { exact: false }).first().click({ timeout: 45000 });
    await page.waitForTimeout(700);
    await modal(page).getByRole('button', { name: /^eBay$/i }).click();
    await modal(page).getByPlaceholder(/01-14475/i).fill('SIM-MANUAL-ACC-1');
    await modal(page).locator('input[placeholder="0.00"]').fill('9.99');
    await shot(page, 'sales-manual-accessory-sale-filled');
    await modal(page).getByRole('button', { name: /Confirm Sale/i }).click({ timeout: 45000 });
    await page.waitForTimeout(1200);
    await dismissModals(page);
    const s = await dumpStore(page);
    const manualAccSale = Object.values(s.sales || {}).find(x => x.orderNumber === 'SIM-MANUAL-ACC-1');
    record('Manual Record Sale (accessory) created a real Sale doc', !!manualAccSale);
  } catch (e) {
    record('Manual Record Sale (accessory) completed without error', false, String(e).slice(0, 300));
  }

  // Live accessory returns — pick a handful of eligible accessory sale lines.
  try {
    const s = await dumpStore(page);
    const salesArr = Object.values(s.sales || {});
    const accSkus = manifest.accessories.map(a => a.sku);
    const eligibleAccSales = salesArr.filter(x => accSkus.includes(x.sku) && !x.voidedAt).slice(0, 6);
    let accReturnsDone = 0;
    for (const sale of eligibleAccSales) {
      await gotoAdminSub(page, 'Configuration');
      await page.waitForTimeout(700);
      const accHeading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
      await accHeading.scrollIntoViewIfNeeded().catch(() => {});
      const row = page.locator('tr', { hasText: sale.sku }).first();
      const returnBtn = row.getByRole('button', { name: /^Return$/i });
      if (!(await returnBtn.isVisible().catch(() => false))) continue;
      await returnBtn.click();
      await page.waitForTimeout(500);
      const select = modal(page).locator('select').first();
      if (await select.isVisible().catch(() => false)) {
        await select.selectOption({ label: new RegExp(sale.orderNumber) }).catch(() => {});
      }
      const outcomeBtn = modal(page).getByRole('button', { name: /^Refund$/i });
      if (await outcomeBtn.isVisible().catch(() => false)) await outcomeBtn.click();
      const confirmBtn = modal(page).getByRole('button', { name: /Confirm Return/i });
      if (await confirmBtn.isEnabled().catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
        accReturnsDone++;
      }
      await dismissModals(page);
    }
    record(`Processed ${accReturnsDone}/${eligibleAccSales.length} live accessory returns`, accReturnsDone > 0, `${accReturnsDone} done`);
    await shot(page, 'sales-accessory-returns-done');
  } catch (e) {
    record('Live accessory returns completed without error', false, String(e).slice(0, 300));
  }

  return preLiveReturnsStore;
}

// ══════════════════════════════════════════════════════════════════════════
// AUDIT persona — cross-check ground truth (pre-live-return bulk state)
// ══════════════════════════════════════════════════════════════════════════
async function auditPersona(page, preLiveReturnsStore) {
  console.log('\n══ AUDIT persona — cross-checking against independent ground truth ══');
  try {
    const salesArr = Object.values(preLiveReturnsStore.sales || {});
    let gpSum = 0, revSum = 0;
    for (const s of salesArr) {
      gpSum += Number(s.grossProfit) || 0;
      revSum += Number(s.salePrice) || 0;
    }
    record('Live total revenue matches ground truth (bulk-import state)',
      close(revSum, ground.totalRevenue, ground.totalRevenue * 0.005),
      `live=${revSum.toFixed(2)} truth=${ground.totalRevenue.toFixed(2)}`);
    record('Live total GP matches ground truth (bulk-import state)',
      close(gpSum, ground.totalGP, Math.max(50, Math.abs(ground.totalGP) * 0.02)),
      `live=${gpSum.toFixed(2)} truth=${ground.totalGP.toFixed(2)}`);

    for (const mp of Object.keys(ground.byMarketplace)) {
      const mpSales = salesArr.filter(s => s.marketplace === mp);
      const mpGp = mpSales.reduce((a, s) => a + (Number(s.grossProfit) || 0), 0);
      const truth = ground.byMarketplace[mp];
      record(`${mp}: live GP matches ground truth`,
        close(mpGp, truth.gp, Math.max(20, Math.abs(truth.gp) * 0.03)),
        `live=${mpGp.toFixed(2)} truth=${truth.gp.toFixed(2)} (n=${mpSales.length}/${truth.count})`);
    }
  } catch (e) {
    record('GP/revenue cross-check completed without error', false, String(e).slice(0, 300));
  }

  // VAT Centre cross-check.
  try {
    await gotoAdminSub(page, 'Money');
    await page.waitForTimeout(600);
    const vatTab = page.getByRole('button', { name: /^VAT/i }).first();
    if (await vatTab.isVisible().catch(() => false)) await vatTab.click();
    await page.waitForTimeout(1200);
    await shot(page, 'audit-vat-centre');
    const vatText = await page.innerText('body').catch(() => '');
    for (const period of ground.vatPeriods) {
      const netPayableStr = period.netPayableAsComputed.toFixed(2);
      const found = vatText.includes(netPayableStr) || vatText.includes(Math.abs(period.netPayableAsComputed).toFixed(2));
      record(`VAT Centre shows the ${period.key} net payable figure (£${netPayableStr})`, found,
        found ? '' : `not found verbatim in VAT Centre text (period sale count ${period.saleCount})`);
    }
  } catch (e) {
    record('VAT Centre cross-check completed without error', false, String(e).slice(0, 300));
  }

  // Periodic table bucket check — every generated series should have a
  // correctly-labelled row, and the deliberately-generic model should show
  // under "Unclassified" (not silently miscounted or crashing the view).
  try {
    await gotoTab(page, 'Inventory');
    await page.waitForTimeout(1200);
    const bodyText = await page.innerText('body').catch(() => '');
    const seriesToCheck = [...new Set(manifest.models.map(m => m.series))];
    for (const series of seriesToCheck) {
      const label = series === 'Other' ? 'Unclassified' : series;
      record(`Periodic table shows a "${label}" row`, bodyText.includes(label));
    }
  } catch (e) {
    record('Periodic table bucket check completed without error', false, String(e).slice(0, 300));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Entry point (persona functions for QC/repair/Notices/Configuration and the
// final wipe+reupload reconciliation are appended after recon confirms exact
// selectors — see e2eQuarterSimulationPart2.mjs)
// ══════════════════════════════════════════════════════════════════════════
export {
  BASE, OUT, manifest, ground, results, record, close, shot, modal, dismissModals,
  gotoTab, gotoAdminSub, openImportMenu, wipeAll, dumpStore, downloadReport,
  importInventoryReport, importSalesReport, stockIntakePersona, salesPersona, auditPersona,
};

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  await stockIntakePersona(page);
  const preLiveReturnsStore = await salesPersona(page);
  await auditPersona(page, preLiveReturnsStore);

  record('No uncaught JS errors across the whole run (part 1)', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  writeFileSync(resolve(OUT, 'part1-results.json'), JSON.stringify(results, null, 2));
  const passed = results.filter(r => r.ok).length;
  console.log(`\n[Part 1] ${passed}/${results.length} checks passed`);

  await ctx.close();
  await browser.close();
  if (passed !== results.length) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith('e2eQuarterSimulation.mjs')) {
  run().catch(e => { console.error(e); process.exit(1); });
}
