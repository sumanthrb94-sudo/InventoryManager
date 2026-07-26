/**
 * scripts/e2eInventoryImportBucketScope.mjs — does an OFFICE-tagged
 * Inventory Report row leave an existing SHS unit alone?
 *
 * Reported live: after "Wipe Office Stock" only, re-uploading an all-OFFICE
 * workbook showed "6 to update" and the SHS Stock KPI grew — an office
 * report reaching into units it never mentioned. Fixed by scoping the
 * update-match to the same bucket the row declares (InventoryReportImport
 * buildPreview). This drives the real modal end to end:
 *
 *   1. Wipe
 *   2. Upload a one-row SHS workbook — creates an incoming (SHS) unit
 *   3. Upload a one-row OFFICE workbook with the SAME IMEI but different
 *      colour/BP — must show 0 create / 0 update / 1 "bucket conflict",
 *      and confirming must write nothing
 *   4. The SHS unit's original colour/BP survive untouched
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eInventoryImportBucketScope.mjs
 */
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';
import { mkdirSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/inventory-import-bucket-scope';
const IMEI = '359999000011122';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}

function makeWorkbook(rows) {
  const headers = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type',
    'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'INVENTORY');
  return wb;
}

async function valueFor(page, label) {
  const tile = page.locator(`text=${label}`).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  const txt = await tile.locator('p.text-2xl').innerText();
  return parseInt(txt.replace(/,/g, ''), 10);
}

async function uploadAndPreview(page, filePath) {
  await page.getByRole('button', { name: /^Import$/i }).click().catch(async () => {
    await page.locator('button[aria-haspopup="menu"]').first().click();
  });
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(600);
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByText(/Drop a .xlsx or .csv file/i).click(),
  ]);
  await fileChooser.setFiles(filePath);
  await page.waitForTimeout(1000);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stock Intake/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 1. Wipe All so the DB starts genuinely empty ────────────────────────
  await page.getByRole('button', { name: /^Wipe$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /Wipe All/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('checkbox', { name: /I understand this will delete all inventory data/i }).click();
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Reload App/i }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Stock Intake/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 2. Seed one SHS unit via an SHS-tagged workbook ─────────────────────
  const shsPath = path.resolve(OUT, 'seed-shs.xlsx');
  XLSX.writeFile(makeWorkbook([
    ['2026-01-15', 'SAMSUNG GALAXY A32 5G', IMEI, 'A', '64GB', 'Dual Physical SIM', 'Blue', 'NIHAL', 58, 'SHS', ''],
  ]), shsPath);
  await uploadAndPreview(page, shsPath);
  await shot(page, 'seed-shs-preview');
  const seedStats = {
    toCreate: await valueFor(page, 'To create'),
    landsShs: await page.locator('text=SHS (supplier-held)').locator('xpath=preceding-sibling::span[1]').innerText().catch(() => ''),
  };
  record('seed · the SHS row is a fresh create', seedStats.toCreate === 1, JSON.stringify(seedStats));
  await page.getByRole('button', { name: /Load 1 row/i }).click();
  await page.waitForTimeout(1000);
  await shot(page, 'seed-shs-done');
  await page.getByRole('button', { name: /^Close$/i }).click().catch(() => {});
  await page.waitForTimeout(500);

  const shsKpiBefore = await page.locator('text=SHS STOCK').locator('xpath=ancestor::div[contains(@class,"rounded-")][1]').locator('p.text-2xl, p.text-3xl, p').first().innerText().catch(() => '?');
  console.log('SHS KPI right after seeding:', shsKpiBefore);

  // ── 3. Upload an OFFICE-tagged row with the SAME IMEI, different details ─
  const officePath = path.resolve(OUT, 'office-conflict.xlsx');
  XLSX.writeFile(makeWorkbook([
    ['2026-07-26', 'SAMSUNG GALAXY A32 5G', IMEI, 'B', '64GB', '', 'Red', 'IMAX', 999, 'OFFICE', ''],
  ]), officePath);
  await uploadAndPreview(page, officePath);
  await shot(page, 'office-conflict-preview');

  const stats = {
    toCreate: await valueFor(page, 'To create'),
    toUpdate: await valueFor(page, 'To update'),
    invalid: await valueFor(page, 'Invalid'),
  };
  console.log('Scenario: OFFICE row hits an existing SHS IMEI:', stats);
  record('the office row does NOT create a duplicate unit', stats.toCreate === 0, JSON.stringify(stats));
  record('the office row does NOT update the SHS unit', stats.toUpdate === 0, JSON.stringify(stats));

  const conflictPanel = page.locator('text=/Skipped .* different bucket/i');
  record('a "skipped — different bucket" panel explains what happened', await conflictPanel.isVisible().catch(() => false));

  const conflictDetail = await page.locator('text=/already exists as shs/i').innerText().catch(() => '');
  record('the panel names the row and the bucket it collided with', /IMEI/.test(conflictDetail) && /shs/i.test(conflictDetail), conflictDetail);

  const loadButton = page.getByRole('button', { name: /Load \d+ rows?/i });
  const loadDisabled = await loadButton.isDisabled().catch(() => null);
  record('nothing is stageable to write — Load is disabled at 0 rows', loadDisabled === true, `disabled=${loadDisabled}`);

  await page.getByRole('button', { name: /^Cancel$/i }).click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 4. The SHS unit itself must be untouched — same colour/BP as seeded ─
  await page.getByText('SHS STOCK', { exact: false }).click();
  await page.waitForTimeout(700);
  await shot(page, 'shs-overlay-after-conflict');
  const overlayText = await page.locator('body').innerText();
  record('the SHS unit still shows its original colour (Blue), not the conflicting row\'s (Red)',
    overlayText.includes('BLUE') || overlayText.includes('Blue'));
  record('the SHS unit still shows its original BP (58), not the conflicting row\'s (999)',
    /\b58\b/.test(overlayText) && !/\b999\b/.test(overlayText));

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

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
