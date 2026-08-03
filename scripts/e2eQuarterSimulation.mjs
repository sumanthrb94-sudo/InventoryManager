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
import { computeGroundTruth, calcFinancials, quarterKeyOf } from './groundTruthCalc.mjs';

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
  // The notification toast (NotificationToast.tsx) is a SEPARATE fixed
  // banner — not `div.fixed.inset-0` — so the loop above never touches it.
  // Any bulk write (returns, sales) that flips more units than the various
  // session-dedup registrations cover can leave a multi-item queue cycling
  // for a while, and the CURRENT card's visible area genuinely intercepts
  // clicks under it. "Clear All" (multi-item queue) or the single Dismiss
  // (X) button empties it instantly instead of waiting out the 2s/item
  // auto-cycle.
  for (let i = 0; i < 5; i++) {
    const clearAll = page.getByRole('button', { name: /Dismiss all|Clear All/i }).first();
    if (await clearAll.isVisible().catch(() => false)) { await clearAll.click().catch(() => {}); await page.waitForTimeout(200); continue; }
    const dismissOne = page.getByRole('button', { name: 'Dismiss' }).first();
    if (await dismissOne.isVisible().catch(() => false)) { await dismissOne.click().catch(() => {}); await page.waitForTimeout(200); continue; }
    break;
  }
}
// Nav items only exist in the DOM while the hamburger drawer is open.
/**
 * Open the nav drawer and PROVE it opened, by watching for the tab we came
 * for rather than trusting the toggle.
 *
 * The previous version clicked "Open menu" and moved on. When that click
 * landed but the drawer did not end up open, nothing said so — the toggle
 * reported success, so no failure was logged, and the caller then spent
 * fifteen seconds waiting for a nav button that was never in the document.
 * Five retries later the whole return failed with a call log reading only
 * "waiting for getByRole(...)", which names the symptom and hides the cause.
 * Every live return in the simulation died this way.
 *
 * So: check the drawer by its contents. If the tab still is not there after
 * the toggle, close and reopen to resync — the toggle relabels itself
 * "Open menu" / "Close menu", and a state mismatch between the two is
 * exactly what a blind click cannot recover from.
 */
async function openNavDrawer(page, tabRe) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (tabRe && await page.getByRole('button', { name: tabRe }).first()
      .isVisible().catch(() => false)) return;                       // already open

    const opener = page.getByLabel('Open menu').first();
    const closer = page.getByLabel('Close menu').first();
    if (await opener.isVisible().catch(() => false)) {
      await opener.click({ timeout: 20000 }).catch(e =>
        console.log(`  openNavDrawer: "Open menu" click failed: ${String(e).slice(0, 120)}`));
    } else if (await closer.isVisible().catch(() => false)) {
      // The toggle says open, the drawer disagrees. Cycle it.
      console.log('  openNavDrawer: drawer reports open but the tab is absent — resyncing');
      await closer.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.getByLabel('Open menu').first().click({ timeout: 8000 }).catch(() => {});
    } else {
      console.log('  openNavDrawer: neither "Open menu" nor "Close menu" is on screen');
    }
    await page.waitForTimeout(600);
  }
  if (tabRe && !(await page.getByRole('button', { name: tabRe }).first().isVisible().catch(() => false))) {
    console.log(`  openNavDrawer: gave up — ${tabRe} still not visible after 4 attempts`);
  }
}
async function gotoTab(page, label) {
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  // This click flakes intermittently right after a heavy write, in a way
  // neither a longer single timeout nor one retry reliably catches — but a
  // fresh dismiss+open+click cycle recovers it almost every time. So retry
  // the WHOLE cycle several times with real pauses in between (letting
  // whatever transient state settle) before falling back to a reload, rather
  // than trusting one long wait to ride it out.
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      await dismissModals(page);
      await openNavDrawer(page, re);
      const tab = page.getByRole('button', { name: re }).first();
      await tab.click({ timeout: 15000 });
      await page.waitForTimeout(900);
      return;
    } catch (e) {
      lastErr = e;
      console.log(`  gotoTab('${label}') attempt ${i + 1}/5 failed: ${String(e).slice(0, 150)}`);
      await page.waitForTimeout(1500);
    }
  }
  console.log(`  gotoTab('${label}') still failing after 5 attempts, reloading: ${String(lastErr).slice(0, 150)}`);
  await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissModals(page);
  await openNavDrawer(page, re);
  await page.getByRole('button', { name: re }).first().click({ timeout: 45000 });
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
    // The model field is a catalog-search combobox — typed text that doesn't
    // match a real catalog entry gets cleared on blur (a confirmed selection
    // is required, not free text), so pick an entry that actually exists in
    // the sim's catalog and click its suggestion row.
    await modal(page).getByPlaceholder(/search the catalog/i).first().fill('iPhone 14 Pro');
    await page.waitForTimeout(500);
    await modal(page).getByText(/iPhone 14 Pro/i).first().click();
    await page.waitForTimeout(500);
    const imeiInput = modal(page).getByPlaceholder(/imei/i).first();
    if (await imeiInput.isVisible().catch(() => false)) await imeiInput.fill('359999000011122');
    // Storage is a separate required <select> — picking the catalog
    // suggestion doesn't auto-populate it when the model has more than one
    // storage size (iPhone 14 Pro has 128GB/256GB).
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
    // The accessory SKU field is no longer free text: it is a strict
    // AccessoryComboBox over the existing pools, and a genuinely new SKU has
    // to be admin-approved through the "+ Add" pill before the Name field
    // unlocks. That gate is the point of the feature (it stops "type c usb"
    // and "c type usb" becoming two pools), so the test drives it rather
    // than routing around it.
    await modal(page).locator('input[placeholder="Search — e.g. USB-C 20W"]').first().fill('SIM-TEST-MANUAL');
    await page.waitForTimeout(400);
    await modal(page).getByRole('button', { name: /Add "SIM-TEST-MANUAL" as a new accessory/i }).click();
    await page.waitForTimeout(300);
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

  // Accessory returns — the Accessory Stock panel deliberately offers no
  // Return button.
  //
  // This block used to click one, six times, and reported "0/6 live accessory
  // returns processed", which reads as a broken returns feature. It isn't. The
  // manual Return action was removed on purpose: every real accessory return
  // arrives through the Sales Report import as a voided row and reconciles on
  // its own, so a manual button only offered a second way to record the same
  // event — and a way that could disagree with the sheet. Adjust stays,
  // because correcting a pool after a physical count is the one thing no
  // import can do. See AccessoryStockPanel.tsx's own comment.
  //
  // So assert what is actually true, and leave the real path to the script
  // that drives it end to end: e2eAccessoryReuploadReconcile.mjs, which
  // imports accessory returns and checks they survive a wipe and re-upload.
  try {
    const s = await dumpStore(page);
    const salesArr = Object.values(s.sales || {});
    const accSkus = manifest.accessories.map(a => a.sku);
    const accSales = salesArr.filter(x => accSkus.includes(x.sku));
    record('accessory sales are recorded and available to return against',
      accSales.length > 0, `${accSales.length} accessory sale lines`);

    await gotoAdminSub(page, 'Configuration');
    await page.waitForTimeout(700);
    const accHeading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
    await accHeading.scrollIntoViewIfNeeded().catch(() => {});
    const firstSku = accSkus[0];
    const row = page.locator('tr', { hasText: firstSku }).first();
    record('the Accessory Stock panel lists the pool',
      await row.isVisible().catch(() => false), firstSku);
    record('Adjust is offered — the one correction no import can make',
      await row.getByRole('button', { name: /^Adjust$/i }).isVisible().catch(() => false));
    record('no manual Return button — returns come in through the Sales Report',
      await row.getByRole('button', { name: /^Return$/i }).count() === 0);
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
    // Recompute the expectation from the sales that are ACTUALLY in the app,
    // not from the manifest.
    //
    // Two reasons. The manifest is fixed before the run starts, but the run
    // then records two manual sales of its own — so a manifest-derived figure
    // can never equal what the VAT Centre shows, and the check was failing by
    // a pound or two forever. And what this check is for is the AGGREGATION:
    // does the VAT Centre add up its own period correctly? Recomputing the
    // live population with groundTruthCalc answers exactly that, still
    // without importing a line of the app's own formula code.
    const store = await dumpStore(page);
    const livePeriods = new Map();
    for (const s of Object.values(store.sales ?? {})) {
      if (s.voidedAt) continue;                       // isVatable() in vat.ts
      if (!s.saleDate) continue;
      const key = quarterKeyOf(s.saleDate);
      const fin = calcFinancials(s.marketplace, Number(s.buyPrice) || 0,
        Number(s.salePrice) || 0, Number(s.postage) || 0);
      const acc = livePeriods.get(key) ?? { marginVat: 0, inputVat: 0, n: 0 };
      acc.marginVat += fin.marginalTax;
      acc.inputVat += fin.totalVat;
      acc.n += 1;
      livePeriods.set(key, acc);
    }

    const periodSelect = page.getByLabel('VAT period');
    for (const [key, acc] of [...livePeriods.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      // The VAT Centre shows ONE period at a time. Without this the check read
      // whichever period happened to be selected and compared it against every
      // period's expectation in turn — so it reported the newest quarter's
      // figure as a £2,643 discrepancy in the oldest.
      await periodSelect.selectOption(key).catch(() => {});
      await page.waitForTimeout(900);
      const text = await page.innerText('body').catch(() => '');
      const shown = /Net payable\s*·?\s*as computed[^\d£-]*£?\s*(-?[\d,]+\.\d{2})/i.exec(text)
        ?? /Net payable[^\d£-]*£?\s*(-?[\d,]+\.\d{2})/i.exec(text);
      const live = shown ? Number(shown[1].replace(/,/g, '')) : null;
      const expected = Math.round((acc.marginVat - acc.inputVat) * 100) / 100;
      const gap = live === null ? null : Math.round((live - expected) * 100) / 100;
      record(`VAT Centre · ${key} net payable reconciles (£${expected.toFixed(2)} over ${acc.n} sales)`,
        gap !== null && Math.abs(gap) <= 1,
        gap === null ? 'no "Net payable" figure on screen'
          : `screen £${live.toFixed(2)}, independent recompute £${expected.toFixed(2)}, gap £${gap.toFixed(2)}`);
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
    // SERIES_GROUPS renders a human LABEL, not the internal series id, and
    // for three groups the two differ entirely ("Galaxy Note" → "Samsung
    // Note"). Grepping the id passed only where a label or a model name
    // happened to contain it, so Note / Z / XCover reported missing while
    // rendering perfectly — a harness bug, not a product one. Assert what
    // the operator actually sees.
    const SERIES_LABEL = {
      'iPhone': 'Apple iPhones', 'iPad': 'Apple iPads', 'Apple Watch': 'Apple Watch',
      'MacBook': 'MacBook', 'Galaxy S': 'Samsung Galaxy S', 'Galaxy A': 'Samsung Galaxy A',
      'Galaxy Note': 'Samsung Note', 'Galaxy Z': 'Samsung Z (Fold/Flip)',
      'Galaxy M': 'Samsung Galaxy M', 'Galaxy XCover': 'Samsung XCover',
      'Galaxy Tab': 'Samsung Tabs', 'Pixel': 'Google Pixel', 'Other': 'Unclassified',
    };
    const seriesToCheck = [...new Set(manifest.models.map(m => m.series))];
    for (const series of seriesToCheck) {
      const label = SERIES_LABEL[series] ?? (series === 'Other' ? 'Unclassified' : series);
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
