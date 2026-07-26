/**
 * scripts/e2eModelPickerBucketFilter.mjs — the orphan-row model picker must
 * only suggest models that exist under the row's own Office/SHS toggle.
 *
 * Reported bug: an orphan row toggled to SHS was showing office-stock
 * models (with office "N IN STOCK" counts) in its suggestion list — a
 * model with 88 units on the office shelf and zero SHS holdings is not a
 * valid pick for a row that says "this shipped from an SHS holding".
 *
 * This drives two deliberately disjoint fixtures — one model that exists
 * ONLY as office stock, one that exists ONLY as an SHS holding — and
 * checks the picker in both toggle positions:
 *   Office → only the office-only model suggested, never the SHS-only one.
 *   SHS    → only the SHS-only model suggested, never the office-only one.
 * A third case covers the "neither bucket has it" path: a model with zero
 * stock anywhere suggests nothing at all — no admin-seed fallback, no
 * cross-bucket leak — and the admin creates it on the spot via the
 * existing "+ Add ... to the model catalog" affordance.
 *
 * Also covers three follow-up reports on the same screen:
 *   - the import modal was too small to work in (now max-w-6xl, not
 *     max-w-3xl, and the audit row list gets far more vertical room);
 *   - SIM Type was never asked when a unit was created from this screen,
 *     unlike every other intake path;
 *   - a model created via "+ Add" on one row didn't show up on another
 *     row needing the same brand-new model without a reload.
 *
 * Run after: VITE_E2E=1 vite build && vite preview --port 4173
 *   node scripts/e2eModelPickerBucketFilter.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/model-picker-bucket-filter';

// Single-word, no spaces — DeviceComboBox splits "brand · model" on the
// first space when rendering a suggestion, so a multi-word fixture name
// can land the marker text on either side of a middle-dot the extracted
// innerText doesn't preserve as a plain space. One word sidesteps that
// entirely and keeps the assertion about the filtering, not the render.
const OFFICE_MODEL = 'ZENOVAOFFICEONLY';
const SHS_MODEL = 'ZENOVBSHSONLY';
/** Exists in neither fixture — the "create it in Admin" case. */
const GHOST_MODEL = 'ZENOVCGHOSTMODEL';
const ORPHAN_IMEI = '350000000099999';
const ORPHAN_IMEI_2 = '350000000088888';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

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

const modal = (page) => page.locator('div.fixed.inset-0[class*="z-["]').last();

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close")').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(350);
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

function buildInventoryFile() {
  const headers = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
  const rows = [
    ['2026-07-20', OFFICE_MODEL, '350000000011111', 'A', '128GB', 'Physical SIM', 'Black', 'TESTSUP', 100, 'OFFICE', ''],
    ['2026-07-20', SHS_MODEL, '', 'A', '128GB', 'Physical SIM', 'Blue', 'TESTSUP', 100, 'SHS', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'INVENTORY');
  const path = resolve(OUT, 'bucket-fixture-inventory.xlsx');
  XLSX.writeFile(wb, path);
  return path;
}

function buildSalesFile() {
  const headers = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'];
  const rows = [
    ['2026-07-24', 'ORPHAN-BUCKET-TEST', 'SKU-X', ORPHAN_IMEI, 'TESTSUP', 1, 100, 150, '', '', '', 6.3, '', '', ''],
    // A second orphan — used to check that a model created via "+ Add" on
    // the FIRST row is immediately pickable here, on the second, without
    // a reload or re-search of the whole page.
    ['2026-07-24', 'ORPHAN-BUCKET-TEST-2', 'SKU-Y', ORPHAN_IMEI_2, 'TESTSUP', 1, 90, 140, '', '', '', 6.3, '', '', ''],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'AMAZON');
  const path = resolve(OUT, 'bucket-fixture-sales.xlsx');
  XLSX.writeFile(wb, path);
  return path;
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ══ 1 · Wipe ══════════════════════════════════════════════════════════
  console.log('\n── 1. Wipe ──');
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

  // ══ 2 · Import the two disjoint fixtures ═════════════════════════════
  console.log('\n── 2. Import one office-only model and one SHS-only model ──');
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(buildInventoryFile());
  await page.waitForTimeout(2500);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows?/i }).click();
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);

  // ══ 3 · Import a sale with an unmatched IMEI → orphan row ════════════
  console.log('\n── 3. Import a sale with no matching unit — lands as an orphan ──');
  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(buildSalesFile());
  await page.waitForTimeout(2500);
  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  const modelBox = modal(page).locator('input[placeholder="Search model…"]').first();
  record('the orphan row is on screen', await modelBox.isVisible().catch(() => false));

  // The modal was reported as too small to work in comfortably — it was
  // capped at max-w-3xl (768px); it's now max-w-6xl (1152px), with the
  // audit row list itself given far more vertical room too.
  const modalBox = await modal(page).boundingBox();
  record('the import modal is wide — max-w-6xl, not the old cramped max-w-3xl',
    !!modalBox && modalBox.width >= 1100, `width=${modalBox?.width?.toFixed(0)}px`);

  // ══ 4 · Office (default) — only the office-only model suggested ══════
  console.log('\n── 4. Toggle = Office (default) ──');
  const officeToggle = modal(page).getByRole('button', { name: /^Office$/ }).first();
  const officeActive = await officeToggle.evaluate(el => el.className.includes('bg-slate-700')).catch(() => false);
  record('the row defaults to Office', officeActive);

  await modelBox.click();
  await page.waitForTimeout(400);
  await shot(page, 'office-toggle-suggestions');
  const officePanelText = await modal(page).locator('div[class*="z-[9999]"]').last().innerText().catch(() => '');
  record('Office toggle: the office-only model IS suggested', officePanelText.includes(OFFICE_MODEL),
    officePanelText.slice(0, 120));
  record('Office toggle: the SHS-only model is NOT suggested', !officePanelText.includes(SHS_MODEL),
    officePanelText.slice(0, 120));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ══ 4b · SIM Type — asked here too, same as every other intake path ══
  // A unit created from this screen used to skip SIM Type entirely, unlike
  // Add Stock, Bulk Order and the Inventory Report import. Not a required
  // field (matches the Inventory Report schema — SIM Type is optional
  // there too), but it must be ASKED, and it must actually persist.
  console.log('\n── 4b. SIM Type is offered on the row and can be set ──');
  const simTypeSelect = modal(page).locator('select').filter({ has: page.locator('option[value="Physical SIM + eSIM"]') }).first();
  const simTypeVisible = await simTypeSelect.isVisible().catch(() => false);
  record('a SIM Type dropdown is offered on the row', simTypeVisible);
  if (simTypeVisible) {
    await simTypeSelect.selectOption('Physical SIM + eSIM');
    await page.waitForTimeout(200);
    const selected = await simTypeSelect.inputValue().catch(() => '');
    record('picking a SIM Type sets the row\'s value', selected === 'Physical SIM + eSIM', `got "${selected}"`);
  }

  // ══ 5 · Switch to SHS — only the SHS-only model suggested ════════════
  console.log('\n── 5. Toggle = SHS ──');
  const shsToggle = modal(page).getByRole('button', { name: /^SHS$/ }).first();
  await shsToggle.click();
  await page.waitForTimeout(400);

  await modelBox.click();
  await page.waitForTimeout(400);
  await shot(page, 'shs-toggle-suggestions');
  const shsPanelText = await modal(page).locator('div[class*="z-[9999]"]').last().innerText().catch(() => '');
  record('SHS toggle: the SHS-only model IS suggested', shsPanelText.includes(SHS_MODEL),
    shsPanelText.slice(0, 120));
  record('SHS toggle: the office-only model is NOT suggested', !shsPanelText.includes(OFFICE_MODEL),
    shsPanelText.slice(0, 120));

  // ══ 6 · A model neither bucket has — nothing suggested, admin can add it ══
  // Still toggled to SHS from step 5. Typing a model with zero stock in
  // EITHER bucket must not fall back to admin seeds or the other bucket —
  // the picker should show nothing, and the operator's path forward is
  // the existing "+ Add" (admin) / "ask an admin" (employee) affordance.
  console.log('\n── 6. A model with no stock anywhere — empty picker, "+ Add" to create it ──');
  await modelBox.click();
  await modelBox.fill(GHOST_MODEL);
  await page.waitForTimeout(500);
  await shot(page, 'no-match-anywhere-add-in-admin');

  const panel = modal(page).locator('div[class*="z-[9999]"]').last();
  const panelText = await panel.innerText().catch(() => '');
  record('no suggestions at all for a model with zero stock in either bucket',
    !panelText.includes('IN STOCK'), panelText.slice(0, 160));
  record('the header says "no matches" instead of a misleading device count',
    /no matches in \d+ known device/i.test(panelText), panelText.slice(0, 60));

  const addButton = panel.getByRole('button', { name: new RegExp(`Add "${GHOST_MODEL}"`, 'i') });
  const addVisible = await addButton.isVisible().catch(() => false);
  record('admin gets a "+ Add ... to the model catalog" affordance instead', addVisible,
    panelText.slice(0, 160));
  // The button must actually look like a button — a plain hover-only text
  // link is easy to miss (the exact "why isn't there an Add button" report
  // that prompted this). A persistent fill/border makes it read as
  // actionable at a glance, not just on hover.
  const addButtonHasFill = await addButton.evaluate(el =>
    el.className.includes('bg-emerald-50') && el.className.includes('border')).catch(() => false);
  record('the Add button has a persistent visible fill, not just a hover tint',
    addButtonHasFill);

  if (addVisible) {
    await addButton.click();
    await page.waitForTimeout(1200);
    await shot(page, 'ghost-model-created-and-picked');
    const value = await modelBox.inputValue().catch(() => '');
    record('creating it fills the row with the new model, ready to confirm',
      value.toUpperCase().includes(GHOST_MODEL), `input now reads "${value}"`);
  }

  // ══ 7 · The model just created must be pickable on the OTHER row too ═
  // Reported bug: a model created via "+ Add" on one row didn't show up
  // for other rows needing the same brand-new model — the operator had
  // to retype/recreate it per row. justCreatedModels (SalesReportImport)
  // is meant to fix that: every row's picker gets the session's newly
  // created models as seeds, live, no reload.
  console.log('\n── 7. The just-created model is visible on the SECOND orphan row, live ──');
  const modelBox2 = modal(page).locator('input[placeholder="Search model…"]').nth(1);
  const row2Visible = await modelBox2.isVisible().catch(() => false);
  record('the second orphan row is on screen', row2Visible);
  if (row2Visible) {
    await modelBox2.click();
    await modelBox2.fill(GHOST_MODEL.slice(0, 10));
    await page.waitForTimeout(500);
    await shot(page, 'ghost-model-visible-on-second-row');
    const panel2Text = await modal(page).locator('div[class*="z-[9999]"]').last().innerText().catch(() => '');
    record('row 2 sees the model row 1 just created, without reloading',
      panel2Text.toUpperCase().includes(GHOST_MODEL), panel2Text.slice(0, 160));
  }

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
