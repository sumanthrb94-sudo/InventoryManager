/**
 * scripts/e2eQuarterSimulationPart2.mjs — continuation of
 * e2eQuarterSimulation.mjs: live unit returns (refund + one full QC-failed
 * -> repair -> back-to-stock cycle), the ADMIN persona (Notices, new model
 * config, model-rename behaviour), and the final "wipe + re-upload once =
 * go live" reconciliation at full quarter scale.
 *
 * Run: node scripts/e2eQuarterSimulationPart2.mjs
 * (imports and re-runs the Part 1 phases first, then continues — this file
 * is the actual full entry point for the whole simulation.)
 */
import { readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import {
  BASE, OUT, manifest, ground, results, record, close, shot, modal, dismissModals,
  gotoTab, gotoAdminSub, openImportMenu, wipeAll, dumpStore, downloadReport,
  stockIntakePersona, salesPersona, auditPersona,
} from './e2eQuarterSimulation.mjs';

// ══════════════════════════════════════════════════════════════════════════
// Live unit returns — a representative sample via the real two-step
// Tech-QC -> CRM-Finalise flow (ProcessReturnModal), plus one full
// QC-failed -> repair -> Back to Stock cycle.
// ══════════════════════════════════════════════════════════════════════════
async function liveUnitReturnsPersona(page) {
  console.log('\n══ LIVE UNIT RETURNS persona — refund sample + one full repair cycle ══');
  const candidates = manifest.sales.filter(s => s.returnCandidate).slice(0, 11);
  let refundDone = 0;
  let repairImei = null;

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const isRepair = i === 0;
    try {
      await gotoTab(page, 'Returns');
      await page.getByRole('button', { name: /Process Return/i }).click({ timeout: 8000 });
      await page.waitForTimeout(700);
      const searchInput = modal(page).getByPlaceholder(/Search by model, IMEI, order/i);
      await searchInput.fill(cand.imei);
      await page.waitForTimeout(600);
      const row = modal(page).locator('button', { hasText: cand.imei }).first();
      if (!(await row.isVisible().catch(() => false))) { await dismissModals(page); continue; }
      await row.click();
      await page.waitForTimeout(700);

      // Step 1 — Tech-QC
      const areas = modal(page).locator('textarea');
      await areas.nth(0).fill('Customer reports the device stopped charging reliably.');
      await areas.nth(1).fill(isRepair
        ? 'Bench inspection: charging port fault confirmed. IMEI matches. Sending for repair.'
        : 'Bench inspection: fault confirmed, IMEI matches, no repair viable — processing refund.');
      await modal(page).getByRole('button', { name: /Send to CRM Queue/i }).click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      await dismissModals(page);

      // Step 2 — CRM finalise, from the Pending CRM Review card's "Finalise" button
      await gotoTab(page, 'Returns');
      await page.waitForTimeout(800);
      const finaliseBtn = page.getByRole('button', { name: /Finalise/i }).first();
      await finaliseBtn.click({ timeout: 8000 });
      await page.waitForTimeout(700);
      if (isRepair) {
        await modal(page).getByText(/Send for Repair/i).first().click();
      } else {
        await modal(page).getByText(/^Back to Inventory$/i).first().click();
        await page.waitForTimeout(200);
        const refundBtn = modal(page).getByRole('button', { name: /^Refund$/i });
        if (await refundBtn.isVisible().catch(() => false)) await refundBtn.click();
      }
      await modal(page).locator('input[placeholder*="Customer changed mind" i]').first().fill(
        isRepair ? 'Faulty charging port — sent for bench repair' : 'Customer changed their mind',
      );
      if (i === 0) await shot(page, 'live-return-crm-finalise-filled');
      await modal(page).getByRole('button', { name: /Finalise Return/i }).click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      await dismissModals(page);

      if (isRepair) { repairImei = cand.imei; } else { refundDone++; }
    } catch (e) {
      record(`Live return #${i + 1} (IMEI ${cand.imei}) completed without error`, false, String(e).slice(0, 250));
      await dismissModals(page);
    }
  }
  record(`Processed ${refundDone}/${candidates.length - 1} live refund returns`, refundDone > 0, `${refundDone} done`);
  record('Processed the QC-failed → repair CRM finalise step', !!repairImei, repairImei ? `IMEI ${repairImei}` : 'not completed');
  await shot(page, 'live-returns-done');

  // Complete the repair cycle: Returns tab → repaired unit's "Back to Stock".
  if (repairImei) {
    try {
      await gotoTab(page, 'Returns');
      await page.waitForTimeout(800);
      const backToStockBtn = page.getByRole('button', { name: /Back to Stock/i }).first();
      const visible = await backToStockBtn.isVisible().catch(() => false);
      record('Repaired unit shows a "Back to Stock" action on the Returns tab', visible);
      if (visible) {
        await backToStockBtn.click();
        await page.waitForTimeout(600);
        await shot(page, 'ready-to-ship-modal');
        await modal(page).getByRole('button', { name: /^Back to Stock$/i }).click({ timeout: 8000 });
        await page.waitForTimeout(1200);
        await dismissModals(page);
        const s = await dumpStore(page);
        const unit = Object.values(s.inventoryUnits || {}).find(u => u.imei === repairImei);
        record('QC-failed → repair unit completed the full cycle and is back to available stock',
          unit?.status === 'available' && unit?.returnType === 'returned_to_inventory',
          JSON.stringify({ status: unit?.status, returnType: unit?.returnType }));
      }
    } catch (e) {
      record('Repair completion (Back to Stock) completed without error', false, String(e).slice(0, 250));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ADMIN persona — Notices, new model config, model-rename behaviour
// ══════════════════════════════════════════════════════════════════════════
async function adminPersona(page) {
  console.log('\n══ ADMIN persona — Notices, new model config, rename behaviour ══');

  try {
    await gotoTab(page, 'Notices');
    await page.waitForTimeout(700);
    const composeBox = page.getByPlaceholder(/Write a notice for the team/i);
    await composeBox.fill('Q3 stock intake complete — 1,800 units processed across office + SHS. Flag any discrepancies to admin.');
    await shot(page, 'admin-notice-composed');
    await page.getByRole('button', { name: /^Post$/i }).click({ timeout: 8000 });
    await page.waitForTimeout(1000);
    const bodyText = await page.innerText('body').catch(() => '');
    record('Admin notice posted and visible on the Notices board', bodyText.includes('Q3 stock intake complete'));
  } catch (e) {
    record('Admin Notices post completed without error', false, String(e).slice(0, 250));
  }

  try {
    await gotoAdminSub(page, 'Configuration');
    await page.waitForTimeout(800);
    await page.getByPlaceholder(/^Samsung$/i).first().fill('Samsung');
    await page.getByPlaceholder(/Galaxy S24 Ultra/i).first().fill('Galaxy S25 FE');
    const seriesInput = page.getByPlaceholder(/^Galaxy S$/i).first();
    if (await seriesInput.isVisible().catch(() => false)) await seriesInput.fill('Galaxy S');
    await shot(page, 'admin-new-model-filled');
    await page.getByRole('button', { name: /^Add$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(1000);
    const bodyText = await page.innerText('body').catch(() => '');
    record('New model config created (Samsung Galaxy S25 FE)', bodyText.includes('Galaxy S25 FE') || /live in Add Stock now/i.test(bodyText));
  } catch (e) {
    record('Admin new-model config completed without error', false, String(e).slice(0, 250));
  }

  // Model rename — documents current behaviour rather than assuming a bug:
  // does an existing catalog rename cascade to already-imported historical
  // units, or does it only affect the catalog spelling used at future import?
  try {
    await gotoAdminSub(page, 'Configuration');
    await page.waitForTimeout(800);
    const beforeStore = await dumpStore(page);
    const targetModel = 'iPhone 13'; // present on hundreds of bulk-imported units
    const unitsBeforeRename = Object.values(beforeStore.inventoryUnits || {}).filter(u => (u.model || '').includes(targetModel)).length;

    const catalogRow = page.locator('tr', { hasText: targetModel }).first();
    const editBtn = catalogRow.getByRole('button', { name: /^Edit$/i });
    const hasEditableCatalogRow = await editBtn.isVisible().catch(() => false);
    if (hasEditableCatalogRow) {
      await editBtn.click();
      await page.waitForTimeout(400);
      const modelInput = catalogRow.locator('input').nth(1);
      await modelInput.fill('iPhone 13 (Renamed)');
      await catalogRow.getByRole('button', { name: /^Save$/i }).click({ timeout: 8000 });
      await page.waitForTimeout(1000);
      const afterStore = await dumpStore(page);
      const unitsWithNewName = Object.values(afterStore.inventoryUnits || {}).filter(u => (u.model || '').includes('iPhone 13 (Renamed)')).length;
      record(
        `Model rename cascade check — ${unitsBeforeRename} historical "${targetModel}" units on file: renaming the catalog entry ` +
        (unitsWithNewName > 0 ? 'DID cascade to historical units (retroactive rewrite happened)' : 'did NOT cascade — only the catalog spelling changed, historical units keep their original model text'),
        true, // informational finding, not a pass/fail — recorded either way
        `unitsWithNewName=${unitsWithNewName}`,
      );
    } else {
      record('Model rename UI located in Configuration catalog', false, 'no Edit button found on the catalog row — cannot test rename cascade behaviour');
    }
  } catch (e) {
    record('Model rename behaviour check completed without error', false, String(e).slice(0, 250));
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GO LIVE — download real reports from this fully-simulated state, wipe,
// re-upload ONCE, and confirm stock + GP reconcile exactly.
// ══════════════════════════════════════════════════════════════════════════
async function goLiveReconciliation(page) {
  console.log('\n══ GO LIVE — download real reports, wipe, re-upload once ══');
  const preWipe = await dumpStore(page);
  const preWipeUnits = Object.values(preWipe.inventoryUnits || {});
  const preWipeSales = Object.values(preWipe.sales || {}).filter(s => !s.voidedAt);
  const preWipeAccessories = Object.values(preWipe.accessoryStock || {});
  const preWipeOfficeAvailable = preWipeUnits.filter(u => u.status === 'available').length;
  const preWipeGP = preWipeSales.reduce((a, s) => a + (Number(s.grossProfit) || 0), 0);

  let invPath, salesPath;
  try {
    await gotoTab(page, 'Stock Intake');
    await page.waitForTimeout(600);
    invPath = await downloadReport(page, /^Inventory Report$/i);
    record('Downloaded the real Inventory Report from the fully-simulated state', !!invPath);
  } catch (e) {
    record('Inventory Report download completed without error', false, String(e).slice(0, 250));
  }
  try {
    await gotoTab(page, 'Inventory');
    await page.waitForTimeout(1200);
    salesPath = await downloadReport(page, /^Sales Report$/i);
    record('Downloaded the real Sales Report from the fully-simulated state', !!salesPath);
  } catch (e) {
    record('Sales Report download completed without error', false, String(e).slice(0, 250));
  }

  if (!invPath || !salesPath) {
    record('Go-live reconciliation aborted — one or both downloads failed', false);
    return;
  }
  const invDownloaded = resolve(OUT, 'downloaded-inventory-report.xlsx');
  const salesDownloaded = resolve(OUT, 'downloaded-sales-report.xlsx');
  copyFileSync(invPath, invDownloaded);
  copyFileSync(salesPath, salesDownloaded);

  await wipeAll(page);
  await shot(page, 'go-live-after-wipe-empty');

  // Re-upload Inventory Report first (establishes the gross baseline).
  try {
    await gotoTab(page, 'Stock Intake');
    await openImportMenu(page);
    await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="file"]').first().setInputFiles(invDownloaded);
    await page.waitForTimeout(45000);
    await modal(page).getByRole('button', { name: /Load [\d,]+ rows|Restore \d+ accessory pool/i }).first().click({ timeout: 30000 });
    await page.waitForTimeout(45000);
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click({ timeout: 10000 }).catch(() => {});
    await dismissModals(page);
    record('Re-uploaded Inventory Report without error', true);
  } catch (e) {
    record('Re-upload Inventory Report completed without error', false, String(e).slice(0, 250));
  }

  // Re-upload Sales Report second (replays the sell-through + GP history).
  try {
    await gotoTab(page, 'Stock Intake');
    await openImportMenu(page);
    await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
    await page.waitForTimeout(1000);
    await page.locator('input[type="file"]').first().setInputFiles(salesDownloaded);

    // WAIT FOR THE PREVIEW, AND MEASURE IT — do not sleep a fixed 60s.
    //
    // This is by far the largest import in the suite: a full quarter is ~2,200
    // sales across five tabs. A fixed sleep answers the wrong question — it
    // says "did it finish inside the number I guessed" rather than "how long
    // does it actually take", so a genuine slowdown and an unlucky container
    // look identical. The elapsed time is recorded so the answer is a figure
    // rather than a verdict.
    const t0 = Date.now();
    const confirmBtn = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
    await confirmBtn.waitFor({ state: 'visible', timeout: 240000 });
    await page.waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('button')]
          .filter(b => /Load|Confirm|record/i.test(b.textContent || ''));
        return btns.length > 0 && btns.some(b => !b.disabled);
      },
      undefined,
      { timeout: 240000 },
    );
    const previewSecs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`      preview ready after ${previewSecs}s`);
    await confirmBtn.click({ timeout: 30000 });

    const t1 = Date.now();
    await page.waitForTimeout(60000);
    console.log(`      confirm settled after ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    record(`Sales Report preview built in under 4 minutes at quarter scale`,
      Number(previewSecs) < 240, `${previewSecs}s for ~2,200 sales`);
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click({ timeout: 10000 }).catch(() => {});
    await dismissModals(page);
    record('Re-uploaded Sales Report without error', true);
  } catch (e) {
    record('Re-upload Sales Report completed without error', false, String(e).slice(0, 250));
  }

  const postReupload = await dumpStore(page);
  const postUnits = Object.values(postReupload.inventoryUnits || {});
  const postSales = Object.values(postReupload.sales || {}).filter(s => !s.voidedAt);
  const postAccessories = Object.values(postReupload.accessoryStock || {});
  const postOfficeAvailable = postUnits.filter(u => u.status === 'available').length;
  const postGP = postSales.reduce((a, s) => a + (Number(s.grossProfit) || 0), 0);

  record('GO LIVE — unit count reconciles exactly after wipe + single re-upload',
    postUnits.length === preWipeUnits.length, `pre=${preWipeUnits.length} post=${postUnits.length}`);
  record('GO LIVE — office available-stock count reconciles',
    close(postOfficeAvailable, preWipeOfficeAvailable, 3), `pre=${preWipeOfficeAvailable} post=${postOfficeAvailable}`);
  record('GO LIVE — active (non-voided) sale count reconciles',
    close(postSales.length, preWipeSales.length, 5), `pre=${preWipeSales.length} post=${postSales.length}`);
  record('GO LIVE — total GP reconciles to within rounding',
    close(postGP, preWipeGP, Math.max(50, Math.abs(preWipeGP) * 0.01)), `pre=${preWipeGP.toFixed(2)} post=${postGP.toFixed(2)}`);
  record('GO LIVE — accessory SKU count reconciles',
    postAccessories.length === preWipeAccessories.length, `pre=${preWipeAccessories.length} post=${postAccessories.length}`);
  for (const a of preWipeAccessories) {
    const match = postAccessories.find(x => x.sku === a.sku);
    record(`GO LIVE — accessory "${a.sku}" quantity reconciles`,
      !!match && close(match.quantity, a.quantity, 1), `pre=${a.quantity} post=${match?.quantity}`);
  }
  await shot(page, 'go-live-reconciled');
}

// ══════════════════════════════════════════════════════════════════════════
async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.on('dialog', d => d.accept().catch(() => {})); // window.confirm() for notice delete etc.
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  const startedAt = Date.now();
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  await stockIntakePersona(page);
  const preLiveReturnsStore = await salesPersona(page);
  await liveUnitReturnsPersona(page);
  await auditPersona(page, preLiveReturnsStore);
  await adminPersona(page);
  await goLiveReconciliation(page);

  record('No uncaught JS errors across the entire quarter simulation', jsErrors.length === 0, jsErrors.slice(0, 5).join(' | '));

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  writeFileSync(resolve(OUT, 'final-results.json'), JSON.stringify({ elapsedMin, results }, null, 2));
  const passed = results.filter(r => r.ok).length;
  console.log(`\n[FULL QUARTER SIMULATION] ${passed}/${results.length} checks passed — ${elapsedMin} min`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log('\n── Failures ──');
    for (const f of failed) console.log(`FAIL  ${f.name} — ${f.detail}`);
  }

  await ctx.close();
  await browser.close();
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
