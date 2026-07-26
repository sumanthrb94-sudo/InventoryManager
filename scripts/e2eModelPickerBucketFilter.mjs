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
const ORPHAN_IMEI = '350000000099999';

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
  const row = ['2026-07-24', 'ORPHAN-BUCKET-TEST', 'SKU-X', ORPHAN_IMEI, 'TESTSUP', 1, 100, 150, '', '', '', 6.3, '', '', ''];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, row]), 'AMAZON');
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

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
