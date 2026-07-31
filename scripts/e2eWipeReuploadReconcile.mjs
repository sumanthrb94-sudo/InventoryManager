/**
 * scripts/e2eWipeReuploadReconcile.mjs — does the CONVERTED client sales
 * file survive a full wipe + reupload cycle with zero data loss?
 *
 * Four phases, all through the real UI:
 *   1. Wipe to a genuinely empty database, upload the converted Sales
 *      Report (SALES_REPORT_2026_CONVERTED_30TH_JULY.xlsx — no prior
 *      inventory exists, so EVERY sale is an orphan needing a fresh unit
 *      created). Report exactly how many orphans that is and confirm.
 *   2. Download the app's own Inventory Report and Sales Report from the
 *      now-populated app — this is "the app's own record of the truth".
 *   3. Wipe again, re-upload BOTH downloaded reports (Inventory first,
 *      per the app's own recommended order, then Sales) into the fresh
 *      empty database.
 *   4. Compare: same unit count, same sale count, same total revenue/GP,
 *      and — critically — ZERO orphans this time, since the Inventory
 *      Report now supplies the IMEI match the Sales Report needs.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eWipeReuploadReconcile.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/wipe-reupload-reconcile';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const CONVERTED_FILE = '/tmp/claude-0/-home-user-InventoryManager/9cdb0165-62ae-52fe-83ef-914786a3a63d/scratchpad/SALES_REPORT_2026_CONVERTED_30TH_JULY.xlsx';

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(msg) { console.log(`ℹ️  ${msg}`); }
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}
function modal(page) { return page.locator('div.fixed.inset-0[class*="z-["]').last(); }
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
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
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  for (let attempt = 0; attempt < 5; attempt++) {
    const tab = page.getByRole('button', { name: re }).first();
    if (!(await tab.isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    try {
      await page.getByRole('button', { name: re }).first().click({ timeout: 5000 });
      await page.waitForTimeout(900);
      return;
    } catch {
      await page.waitForTimeout(500);
      if (attempt === 3) await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    }
  }
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

/** Fill in any still-incomplete orphan rows. Two independent causes, both
 *  handled here:
 *
 *   1. Blank Model — the strict DeviceComboBox has no catalog to match
 *      against this early (nothing's confirmed into inventory yet), so
 *      each blank row gets its own fresh catalog entry via the admin-only
 *      "+ Add" pill, named uniquely off its row index. Expected to be the
 *      minority — most rows auto-complete their model from
 *      normalizeOperatorSku parsing the real SKU.
 *
 *   2. Invalid IMEI — a genuine DATA QUALITY problem in the source file
 *      (found via diagnostic run): some orders carry garbage in the IMEI
 *      cell instead of a real identifier (e.g. "FBA MCF", or a real IMEI
 *      with " W/ C?" appended) — auditRowMissing correctly flags these as
 *      "IMEI (invalid format)" and blocks Confirm. Since the field is
 *      editable exactly because it's invalid, each gets a synthetic valid
 *      placeholder IMEI so the import can proceed; every such row's real
 *      order number is collected and reported back, because a synthetic
 *      IMEI is NOT the right permanent fix — the operator needs to correct
 *      the source data for these specific orders.
 *
 *  Returns { modelsFilled, badImeiOrders } — re-scans after each edit since
 *  the DOM re-renders on every audit change (a stale row count would walk
 *  past a shifted list). */
async function completeRemainingOrphans(page) {
  const auditPanel = modal(page).locator('div.border-2.border-orange-300');
  const badImeiOrders = [];
  let modelsFilled = 0;
  let guard = 0;

  while (guard++ < 300) {
    const rows = auditPanel.locator('li');
    const rowCount = await rows.count();
    let acted = false;

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const cls = await row.getAttribute('class').catch(() => '');
      if (!(cls || '').includes('bg-rose-50')) continue; // this row is already complete

      const modelInput = row.locator('input[placeholder="Search model…"]');
      const modelVal = await modelInput.inputValue().catch(() => '');
      if (!modelVal.trim()) {
        await modelInput.click();
        await modelInput.fill(`Reconcile Draft Model ${i}`);
        await page.waitForTimeout(350);
        const addBtn = page.getByRole('button', { name: /Add ".*" to the model catalog/i }).first();
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(500);
        } else {
          await modelInput.press('Escape');
        }
        modelsFilled++;
        acted = true;
        break; // re-scan from the top — indices may have shifted
      }

      const imeiInput = row.locator('input[placeholder="IMEI required"]');
      if (await imeiInput.count() > 0) {
        const orderText = (await row.locator('span.font-mono').first().textContent().catch(() => '')) || `row ${i}`;
        const syntheticImei = `9999990${String(i).padStart(8, '0')}`; // valid-format, obviously synthetic
        await imeiInput.click();
        await imeiInput.fill(syntheticImei);
        await page.waitForTimeout(300);
        badImeiOrders.push(orderText.trim());
        acted = true;
        break;
      }
    }
    if (!acted) break; // nothing left to fix
  }

  return { modelsFilled, badImeiOrders };
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const BENIGN_CONSOLE = /Failed to load resource.*(net::ERR_CONNECTION_RESET|404)/i;
  page.on('pageerror', e => record('no JS runtime errors', false, e.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE.test(msg.text())) record('no console errors', false, msg.text());
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 0 — genuinely empty database
  // ═══════════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await wipeAll(page);
  const empty0 = await dumpStore(page);
  record('starts from a genuinely empty store',
    Object.keys(empty0.inventoryUnits ?? {}).length === 0 && Object.keys(empty0.sales ?? {}).length === 0);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 1 — upload the converted sales-only file into the empty DB
  // ═══════════════════════════════════════════════════════════════════════
  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(CONVERTED_FILE);
  await page.waitForTimeout(7000);
  await shot(page, 'phase1-preview');

  const previewText = await modal(page).innerText().catch(() => '');
  const completeMatch = previewText.match(/(\d+)\s*of\s*(\d+)\s*complete/i);
  const orphanCount = completeMatch ? Number(completeMatch[2]) : null;
  const readyCount = completeMatch ? Number(completeMatch[1]) : null;
  note(`ORPHAN COUNT (sales with no matching unit in the empty DB): ${orphanCount}`);
  note(`Auto-completed from SKU→model normalisation without any manual input: ${readyCount} of ${orphanCount}`);
  record('preview surfaces the orphan-completion panel', orphanCount !== null, previewText.match(/\d+ sold record[^\n]*/i)?.[0] ?? 'no match');

  let badImeiOrders = [];
  if (readyCount !== null && orphanCount !== null && readyCount < orphanCount) {
    const result = await completeRemainingOrphans(page);
    badImeiOrders = result.badImeiOrders;
    note(`Manually completed ${result.modelsFilled} rows whose SKU didn't auto-normalise to a model.`);
    if (badImeiOrders.length) {
      note(`DATA QUALITY: ${badImeiOrders.length} order(s) in the source file carry a malformed IMEI (not a schema/app bug — needs correcting at the source): ${badImeiOrders.join(', ')}`);
    }
    await page.waitForTimeout(500);
  }

  const preConfirmText = await modal(page).innerText().catch(() => '');
  record('every orphan is complete before Confirm', /\b(\d+)\s*of\s*\1\s*complete/.test(preConfirmText) || orphanCount === 0,
    preConfirmText.match(/\d+\s*of\s*\d+\s*complete/i)?.[0] ?? 'n/a');

  const confirmBtn = modal(page).getByRole('button', { name: /Load [\d,]+ sales?|Re-confirm/i }).last();
  const confirmDisabled = await confirmBtn.isDisabled().catch(() => true);
  record('Confirm is enabled', !confirmDisabled);
  await confirmBtn.click();
  await page.waitForTimeout(10000);
  await shot(page, 'phase1-done');
  const doneText = await modal(page).innerText().catch(() => '');
  note(`Phase 1 done screen: ${doneText.slice(0, 400).replace(/\n+/g, ' · ')}`);
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  const afterPhase1 = await dumpStore(page);
  const unitsP1 = Object.values(afterPhase1.inventoryUnits ?? {});
  const salesP1 = Object.values(afterPhase1.sales ?? {}).filter(s => !s.voidedAt || true);
  note(`Phase 1 store: ${unitsP1.length} inventory units, ${salesP1.length} sale docs.`);
  record('every parsed sale landed as a real Sale doc', salesP1.length >= (orphanCount ?? 0), `sales=${salesP1.length} orphans=${orphanCount}`);
  record('a real unit exists for every orphan (units == orphans, all fresh)',
    unitsP1.length === orphanCount, `units=${unitsP1.length} orphans=${orphanCount}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 2 — download the app's own Inventory Report + Sales Report
  // ═══════════════════════════════════════════════════════════════════════
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(500);
  const invPath = await downloadReport(page, /Inventory Report/i);
  note(`Downloaded Inventory Report → ${invPath}`);

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(500);
  const salesPath = await downloadReport(page, /Sales Report/i);
  note(`Downloaded Sales Report → ${salesPath}`);

  const invWb = new ExcelJS.Workbook();
  await invWb.xlsx.readFile(invPath);
  const invSheet = invWb.worksheets[0];
  const invRowCount = invSheet.rowCount - 1;
  record('downloaded Inventory Report row count matches Phase 1 unit count', invRowCount === unitsP1.length, `report=${invRowCount} store=${unitsP1.length}`);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3 — wipe again, re-upload BOTH downloaded files
  // ═══════════════════════════════════════════════════════════════════════
  await wipeAll(page);
  const empty2 = await dumpStore(page);
  record('wiped clean again before the reupload', Object.keys(empty2.inventoryUnits ?? {}).length === 0);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(invPath);
  await page.waitForTimeout(4000);
  await shot(page, 'phase3-inventory-preview');
  const invConfirm = modal(page).getByRole('button', { name: /Confirm|Load [\d,]+/i }).last();
  await invConfirm.click().catch(() => {});
  await page.waitForTimeout(5000);
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await dismissModals(page);

  const afterInv = await dumpStore(page);
  const unitsAfterInv = Object.values(afterInv.inventoryUnits ?? {});
  record('Inventory Report reupload recreated the same unit count', unitsAfterInv.length === unitsP1.length,
    `reuploaded=${unitsAfterInv.length} original=${unitsP1.length}`);

  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(salesPath);
  await page.waitForTimeout(7000);
  await shot(page, 'phase3-sales-preview');

  const reuploadPreviewText = await modal(page).innerText().catch(() => '');
  const noOrphansThisTime = !/sold record.*need.*completing/i.test(reuploadPreviewText);
  record('ZERO orphans on reupload — Inventory Report supplied every IMEI match', noOrphansThisTime,
    noOrphansThisTime ? 'no completion panel shown' : (reuploadPreviewText.match(/\d+ sold record[^\n]*/i)?.[0] ?? ''));

  const reuploadConfirm = modal(page).getByRole('button', { name: /Load [\d,]+ sales?|Re-confirm/i }).last();
  await reuploadConfirm.click();
  await page.waitForTimeout(10000);
  await shot(page, 'phase3-done');
  const reuploadDoneText = await modal(page).innerText().catch(() => '');
  note(`Phase 3 done screen: ${reuploadDoneText.slice(0, 400).replace(/\n+/g, ' · ')}`);
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4 — compare Phase 1 (original) vs Phase 3 (post wipe+reupload)
  // ═══════════════════════════════════════════════════════════════════════
  const afterPhase3 = await dumpStore(page);
  const unitsP3 = Object.values(afterPhase3.inventoryUnits ?? {});
  const salesP3 = Object.values(afterPhase3.sales ?? {});

  record('unit count identical after wipe + reupload', unitsP3.length === unitsP1.length, `before=${unitsP1.length} after=${unitsP3.length}`);
  record('sale count identical after wipe + reupload', salesP3.length === salesP1.length, `before=${salesP1.length} after=${salesP3.length}`);

  const sumSP = arr => arr.reduce((s, x) => s + (Number(x.salePrice) || 0), 0);
  const sumBP = arr => arr.reduce((s, x) => s + (Number(x.buyPrice) || 0), 0);
  const revBefore = sumSP(salesP1), revAfter = sumSP(salesP3);
  const bpBefore = sumBP(salesP1), bpAfter = sumBP(salesP3);
  record('total revenue (sum of SP) identical', Math.abs(revBefore - revAfter) < 0.01, `before=£${revBefore.toFixed(2)} after=£${revAfter.toFixed(2)}`);
  record('total buy-side (sum of BP) identical', Math.abs(bpBefore - bpAfter) < 0.01, `before=£${bpBefore.toFixed(2)} after=£${bpAfter.toFixed(2)}`);

  const byMarketplace = arr => {
    const m = {};
    for (const s of arr) m[s.marketplace] = (m[s.marketplace] || 0) + 1;
    return m;
  };
  const mpBefore = JSON.stringify(byMarketplace(salesP1));
  const mpAfter = JSON.stringify(byMarketplace(salesP3));
  record('per-marketplace sale counts identical', mpBefore === mpAfter, `before=${mpBefore} after=${mpAfter}`);

  const imeisBefore = new Set(unitsP1.map(u => u.imei));
  const imeisAfter = new Set(unitsP3.map(u => u.imei));
  const missingImeis = [...imeisBefore].filter(i => !imeisAfter.has(i));
  record('every original IMEI survived the round trip', missingImeis.length === 0, `missing=${missingImeis.length}`);

  await browser.close();

  console.log('\n── Summary ──');
  console.log(`ORPHAN COUNT on first (sales-only) upload: ${orphanCount}`);
  if (badImeiOrders.length) {
    console.log(`SOURCE DATA QUALITY ISSUES (malformed IMEI, needs manual correction): ${badImeiOrders.join(', ')}`);
  }
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
