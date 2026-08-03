/**
 * scripts/e2eLiveClientFileReconcile.mjs — reproduces and verifies the
 * client's exact real-world workflow: wipe, upload the real Inventory
 * Report (all-time, 247 office + 46 SHS), upload the real Sales Report
 * (492 rows), complete every orphan, confirm, and report the final state.
 *
 * Built to answer a live incident: the client uploaded these two real
 * files and hit "481 sold records need completing" — this script proves
 * that's the CORRECT, expected mechanism (an Office Stock report only
 * ever lists currently-unsold units; historical sold units are rebuilt
 * FROM the Sales Report via the orphan-completion flow, not matched
 * against the Inventory Report), not a bug. It then drives the
 * completion through to Confirm and reports the real end state so the
 * predicted numbers are verified, not asserted.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eLiveClientFileReconcile.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/live-client-file-reconcile';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const INV_FILE = '/root/.claude/uploads/9cdb0165-62ae-52fe-83ef-914786a3a63d/6facc7da-inventoryreportalltime20260731_1553.xlsx';
const SALES_FILE = '/root/.claude/uploads/9cdb0165-62ae-52fe-83ef-914786a3a63d/0cef3b48-salesreport20260731_1553.xlsx';

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
async function gotoTab(page, label) {
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

/** Same robust completion loop proven on the 138-sale converted file:
 *  blank Model → fresh catalog entry via "+ Add"; invalid IMEI → a
 *  synthetic valid one (flagged for the operator, not a real fix). */
async function completeRemainingOrphans(page) {
  const auditPanel = modal(page).locator('div.border-2.border-orange-300');
  const badImeiOrders = [];
  let modelsFilled = 0;

  // ONE bulk read for every blank-model index — avoids re-scanning the
  // full (growing-slow) row list per fix, which is what made the naive
  // "find first incomplete row" loop effectively O(n²) at 481 rows
  // (~115k redundant DOM reads) and crashed the page.
  const blankModelIndices = await page.evaluate(() => {
    const panel = document.querySelector('div.border-2.border-orange-300');
    const inputs = Array.from(panel.querySelectorAll('input[placeholder="Search model…"]'));
    return inputs.map((el, i) => [i, (el).value]).filter(([, v]) => !v.trim()).map(([i]) => i);
  });
  const modelInputs = auditPanel.locator('input[placeholder="Search model…"]');

  // ONE draft model for all 480 rows, not one per row.
  //
  // Two reasons, and the second is why this loop used to eat the run budget.
  // Honesty first: these rows carry no model in the client's file, so a single
  // clearly-named bucket describes that; 480 invented model names imply 480
  // distinct handsets we know nothing about. Cost second: every "+ Add" writes
  // a catalog doc, and the catalog is a prop of all 480 combo boxes on the
  // panel — so a per-row entry re-rendered the whole panel 480 times, which is
  // quadratic and is the bulk of the wall clock. One entry, then 479 picks off
  // the dropdown, is what an operator does anyway.
  const DRAFT_MODEL = 'UNRECORDED MODEL';
  // Scoped to the open dropdown. The page-wide getByRole this replaces
  // snapshotted the accessibility tree of a 480-row panel on every row.
  const dropdown = page.locator('div.z-\\[9999\\]').last();
  const addBtn = dropdown.locator('button', { hasText: /to the model catalog/i });
  const pickBtn = dropdown.locator('button', { hasText: DRAFT_MODEL });

  for (const idx of blankModelIndices) {
    const input = modelInputs.nth(idx);
    await input.click();
    await input.fill(DRAFT_MODEL);
    // Wait on the dropdown settling rather than a fixed sleep — returns as
    // soon as it is ready, and waits longer than 120ms when the box is busy.
    await Promise.race([
      pickBtn.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {}),
      addBtn.first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {}),
    ]);
    if (await pickBtn.first().isVisible().catch(() => false)) {
      await pickBtn.first().click();
    } else if (await addBtn.first().isVisible().catch(() => false)) {
      await addBtn.first().click();                 // the first row only
      await page.waitForTimeout(400);               // let the catalog write land
    } else {
      await input.press('Escape');
    }
    modelsFilled++;
  }

  // Second bulk read for invalid-IMEI rows — independent of the model
  // fixes above, so this list is stable and computed once too.
  const imeiRowInfo = await page.evaluate(() => {
    const panel = document.querySelector('div.border-2.border-orange-300');
    const rows = Array.from(panel.querySelectorAll('li'));
    const out = [];
    rows.forEach((row, i) => {
      const imeiInput = row.querySelector('input[placeholder="IMEI required"]');
      if (imeiInput) {
        const orderSpan = row.querySelector('span.font-mono');
        out.push({ index: i, order: orderSpan ? orderSpan.textContent.trim() : `row ${i}` });
      }
    });
    return out;
  });
  // These inputs only render while invalid, so the live collection SHRINKS
  // by one per fix — always target the current first match, not a fixed index.
  const imeiInputs = auditPanel.locator('input[placeholder="IMEI required"]');
  for (let k = 0; k < imeiRowInfo.length; k++) {
    const input = imeiInputs.first();
    const syntheticImei = `9999990${String(k).padStart(8, '0')}`;
    await input.click();
    await input.fill(syntheticImei);
    await page.waitForTimeout(120);
    badImeiOrders.push(imeiRowInfo[k].order);
  }

  // Third pass: rows whose SUPPLIER is blank.
  //
  // This pass did not exist, and it is why the run stopped at 479 of 480.
  // The client's file has one eBay sale (order 03-14884-31041) with no
  // supplier named, the audit gate correctly refuses to complete without one,
  // and Confirm stayed locked — so the two assertions after it could never
  // pass. An operator completing this import would type a supplier; so does
  // this. Same shrinking-collection handling as the IMEI pass: the input only
  // renders while the field is blank.
  const supplierInputs = auditPanel.locator('input[placeholder="Supplier required"]');
  let suppliersFilled = 0;
  for (let guard = 0; guard < 50; guard++) {
    if (await supplierInputs.count() === 0) break;
    const input = supplierInputs.first();
    await input.click();
    await input.fill('UNRECORDED SUPPLIER');
    await input.press('Tab');
    await page.waitForTimeout(150);
    suppliersFilled++;
  }

  return { modelsFilled, badImeiOrders, suppliersFilled };
}

/** Module-scoped so the catch at the foot can close it. Left open, an
 *  unhandled failure keeps node's event loop alive forever — which is how a
 *  script that errored in forty seconds got recorded as a fifteen-minute
 *  timeout with no result at all. */
let browser;

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const BENIGN_CONSOLE = /Failed to load resource.*(net::ERR_CONNECTION_RESET|404)/i;
  page.on('pageerror', e => record('no JS runtime errors', false, e.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE.test(msg.text())) record('no console errors', false, msg.text());
  });

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await wipeAll(page);

  // ── Step 1: Inventory Report (real client file) ──────────────────────
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Import$/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INV_FILE);
  await page.waitForTimeout(4000);
  await shot(page, 'inventory-preview');
  const invPreviewText = await modal(page).innerText().catch(() => '');
  record('Inventory preview lands as 247 office / 46 SHS', /247 office stock/.test(invPreviewText) && /46 SHS/.test(invPreviewText),
    invPreviewText.match(/LANDS AS[\s\S]{0,60}/i)?.[0] ?? '');

  const invConfirm = modal(page).getByRole('button', { name: /Confirm|Load [\d,]+/i }).last();
  await invConfirm.click();
  await page.waitForTimeout(6000);
  await shot(page, 'inventory-done');
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);

  const afterInv = await dumpStore(page);
  const unitsAfterInv = Object.values(afterInv.inventoryUnits ?? {});
  note(`Units after Inventory Report confirm: ${unitsAfterInv.length}`);
  record('293 units created from the real Inventory Report', unitsAfterInv.length === 293, `got ${unitsAfterInv.length}`);

  // ── Step 2: Sales Report (real client file) ───────────────────────────
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /^Import$/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(9000);
  await shot(page, 'sales-preview');

  const salesPreviewText = await modal(page).innerText().catch(() => '');
  const orphanMatch = salesPreviewText.match(/(\d+)\s*sold records? need completing/i);
  const fulfilledMatch = salesPreviewText.match(/(\d+)\s*office-stock unit[s]? will be fulfilled/i);
  const orphanCount = orphanMatch ? Number(orphanMatch[1]) : 0;
  const fulfilledCount = fulfilledMatch ? Number(fulfilledMatch[1]) : 0;
  note(`Orphans needing completion: ${orphanCount}`);
  note(`Units auto-matched & will be fulfilled/marked sold: ${fulfilledCount}`);
  record('reproduces the client-reported "sold records need completing" state', orphanCount > 400, `orphans=${orphanCount}`);
  record('the known stuck unit auto-matches for fulfilment', fulfilledCount >= 1, `fulfilled=${fulfilledCount}`);

  // ── Complete every orphan ──────────────────────────────────────────────
  const t0 = Date.now();
  const { modelsFilled, badImeiOrders, suppliersFilled } = await completeRemainingOrphans(page);
  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  note(`Completion pass took ${elapsedSec}s: ${modelsFilled} blank-model row(s)`
     + `${modelsFilled ? ` (${(Number(elapsedSec) / modelsFilled).toFixed(2)}s each)` : ''}`
     + `, ${suppliersFilled} blank supplier(s).`);
  // Worth saying out loud: the model column is no longer the bottleneck. The
  // importer infers a model from the SKU, so these rows arrive complete on
  // that field and the blank-model pass has nothing to do. What actually held
  // the confirm was blank SUPPLIERS — no formula can guess one, and the audit
  // gate is right to refuse without it.
  if (badImeiOrders.length) {
    note(`DATA QUALITY — ${badImeiOrders.length} order(s) with malformed source IMEI, needs correcting at the source: ${badImeiOrders.join(', ')}`);
  }
  await shot(page, 'orphans-completed');

  const preConfirmText = await modal(page).innerText().catch(() => '');
  const stillComplete = preConfirmText.match(/(\d+)\s*of\s*(\d+)\s*complete/i);
  record('every orphan complete before Confirm',
    !!stillComplete && stillComplete[1] === stillComplete[2], stillComplete?.[0] ?? 'no match');

  // The inventory-impact gate. This file flips one in-stock unit (the stuck
  // 350635881777105) to sold, and Confirm stays disabled until an operator
  // ticks the acknowledgement — completing the 480 orphans is not enough on
  // its own. Not ticking it is why "Confirm enabled" failed: the button then
  // reads "Complete N records to continue", the locator below never matched,
  // isDisabled() threw into its catch, and the click that followed waited out
  // the whole run budget. Tick it, exactly as the operator does.
  const flipAck = modal(page)
    .locator('label', { hasText: /fulfil & mark the \d+ units? sold/i })
    .locator('input[type="checkbox"]');
  if (await flipAck.isVisible().catch(() => false)) {
    await flipAck.check({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    note('Ticked the inventory-impact acknowledgement.');
  }

  // Match the DISABLED label too ("Complete N records to continue"). A
  // locator that only knows the enabled wording turns "the button is
  // disabled" into "there is no button", which reads as a hang, not a result.
  const confirmBtn = modal(page)
    .getByRole('button', { name: /Load [\d,]+ sales?|Re-confirm|Complete \d+ records? to continue/i })
    .last();
  const disabled = await confirmBtn.isDisabled().catch(() => true);
  record('Confirm enabled', !disabled,
    disabled ? await confirmBtn.innerText().catch(() => 'button not found') : '');
  if (disabled) {
    note('Confirm is disabled — skipping the click rather than waiting out the budget on it.');
    await shot(page, 'confirm-blocked');
  } else {
    await confirmBtn.click({ timeout: 30_000 });
  }
  await page.waitForTimeout(12000);
  await shot(page, 'sales-done');
  const doneText = await modal(page).innerText().catch(() => '');
  note(`Done screen: ${doneText.slice(0, 400).replace(/\n+/g, ' · ')}`);
  await modal(page).getByRole('button', { name: /Close/i }).click().catch(() => {});
  await page.waitForTimeout(800);

  // ── Final state ─────────────────────────────────────────────────────
  const final = await dumpStore(page);
  const units = Object.values(final.inventoryUnits ?? {});
  const sales = Object.values(final.sales ?? {});
  const available = units.filter(u => u.status === 'available');
  const sold = units.filter(u => u.status === 'sold');
  const incoming = units.filter(u => u.status === 'incoming');
  note(`FINAL: ${units.length} total units — ${available.length} available (office), ${incoming.length} incoming (SHS), ${sold.length} sold.`);
  note(`FINAL: ${sales.length} sale docs.`);
  record('stuck unit 350635881777105 is now sold, not available',
    units.find(u => u.imei === '350635881777105')?.status === 'sold');
  record('office stock net change is exactly -1 from the 247 baseline (only the stuck unit left)',
    available.length === 246, `available=${available.length}`);

  await browser.close();

  console.log('\n── Summary ──');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

run().catch(async e => {
  console.error(e);
  process.exitCode = 1;
  await browser?.close().catch(() => {});
});
