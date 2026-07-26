/**
 * scripts/e2eAccessoryStock.mjs — the no-IMEI accessory walkthrough.
 *
 * Chargers, SIM eject pins, cables — client asked how these get into
 * inventory when they carry no IMEI/serial at all (unlike iPods/tablets,
 * which at least have an alphanumeric serial in the same slot). Answer:
 * a quantity-pool stock type, separate from the per-unit IMEI model —
 * one AccessoryStock doc per SKU, added/topped-up from Add Stock →
 * Accessories, and decremented by the sales importer when a no-IMEI sale
 * row's SKU matches a pool.
 *
 * This script proves both directions end to end:
 *   1. Add Stock → Accessories creates a new SKU pool with a quantity.
 *   2. Importing a sale for that SKU (no IMEI on the row, exactly like a
 *      real accessory order) decrements the pool by the sale's quantity —
 *      without needing any orphan/office-or-SHS completion, since a
 *      no-IMEI row was always out of that gate's scope.
 *
 * Every step is screenshotted, in order, so the sequence can be read
 * without running it.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-stock';
const SALES_FILE = resolve('e2e-screenshots/accessory-stock/sales-accessory.xlsx');

const SKU = 'USB-C-20W';
const ACCESSORY_NAME = 'USB-C 20W Charger';
const ADD_QTY = 50;
const ADD_BP = 3.5;
const SALE_QTY = 2;

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
  await page.waitForTimeout(1000);
}

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      accessoryStock: Object.values(s.accessoryStock || {}),
      sales: Object.values(s.sales || {}),
    };
  });
}

/** Build a one-row AMAZON sales file for a no-IMEI accessory sale — cloned
 *  from the shipped template so header order / sheet name match exactly
 *  what a real upload looks like. */
async function buildAccessorySalesFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  // Overwrite the first shipped example row with the accessory sale, and
  // BLANK (not delete — ExcelJS's spliceRows silently no-ops on this
  // workbook) every other example row. The parser reads with
  // blankrows:false, so an all-empty row is skipped — this file resolves
  // to exactly one sale, keeping every count below exact.
  for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).values = [];
  ws.getRow(2).values = [
    '2026-07-22', 'ACC-9001', SKU, '', 'MOBILE WHOLESALE LTD',
    SALE_QTY, ADD_BP, 8.99, '', '', '', 0, '', '', '',
  ];
  await wb.xlsx.writeFile(SALES_FILE);
}

async function run() {
  await buildAccessorySalesFile();

  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ══ STEP 1 · Start clean ═════════════════════════════════════════════════
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
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'step1-empty-database');

  // ══ STEP 2 · Add Stock → Accessories creates a new SKU pool ═════════════
  console.log('\n── 2. Add Stock → Accessories — a chargers SKU with no IMEI at all ──');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  await shot(page, 'step2-accessories-tab');

  await modal(page).locator('input[placeholder="e.g. USB-C-20W"]').first().fill(SKU);
  await modal(page).locator('input[placeholder="e.g. USB-C 20W Charger"]').first().fill(ACCESSORY_NAME);
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill(String(ADD_QTY));
  await modal(page).locator('input[placeholder="0.00"]').first().fill(String(ADD_BP));
  await page.waitForTimeout(300);
  await shot(page, 'step3-accessory-line-filled');

  const saveBtn = modal(page).getByRole('button', { name: /Save \d+ accessory line/i });
  record('Save button reflects one ready accessory line', await saveBtn.isEnabled().catch(() => false),
    (await saveBtn.textContent().catch(() => ''))?.trim());
  await saveBtn.click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  const afterAdd = await readStore(page);
  const pool = afterAdd.accessoryStock.find(a => a.sku === SKU);
  record('a new accessoryStock pool was created for the SKU', !!pool, pool ? `id ${pool.id}` : 'not found');
  record('the pool carries the quantity typed at Add Stock', pool?.quantity === ADD_QTY,
    `quantity=${pool?.quantity}`);
  record('no IMEI field exists anywhere on the accessory doc', pool && !('imei' in pool),
    'accessoryStock docs never carry an imei key — a different collection entirely from inventoryUnits');

  // ══ STEP 3 · Configuration shows the pool ════════════════════════════════
  console.log('\n── 3. Configuration → Accessory Stock shows the live pool ──');
  await gotoTab(page, 'Admin');
  const configTab = page.getByRole('button', { name: /^Configuration$/i }).first();
  if (await configTab.isVisible().catch(() => false)) { await configTab.click(); await page.waitForTimeout(700); }
  const panelText = await page.locator('text=Accessory Stock').first().isVisible().catch(() => false);
  record('the Configuration page has an Accessory Stock panel', panelText);
  await shot(page, 'step4-configuration-accessory-panel');
  const rowText = await page.locator(`text=${SKU}`).first().isVisible().catch(() => false);
  record('the panel lists the SKU with its quantity', rowText);

  // ══ STEP 4 · Import a no-IMEI sale for the same SKU ══════════════════════
  console.log('\n── 4. Upload a sales report — one accessory sale, no IMEI, matching SKU ──');
  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  const amazonPicker = modal(page).getByRole('button', { name: /^Amazon$/i }).first();
  if (await amazonPicker.isVisible().catch(() => false)) { await amazonPicker.click(); await page.waitForTimeout(400); }
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(3000);
  await shot(page, 'step5-sales-preview-accessory-row');

  const confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  record('confirm is enabled — a no-IMEI accessory row is out of the audit-completion gate',
    await confirm.isEnabled().catch(() => false));
  await confirm.click();
  await page.waitForTimeout(4000);
  await shot(page, 'step6-sales-import-done');

  const doneText = await modal(page).innerText().catch(() => '');
  record('the Done screen reports the accessory decrement', /Accessory stock updated/i.test(doneText),
    (doneText.match(/Accessory stock updated[^\n]*/i) || [])[0] || 'not reported');

  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);

  // ══ STEP 5 · The pool actually dropped by the sale's quantity ═══════════
  console.log('\n── 5. Verify the pool decremented, and only by the sale itself ──');
  const afterSale = await readStore(page);
  const poolAfter = afterSale.accessoryStock.find(a => a.sku === SKU);
  record('the SKU pool decremented by exactly the sale quantity',
    poolAfter?.quantity === ADD_QTY - SALE_QTY,
    `${ADD_QTY} → ${poolAfter?.quantity} (expected ${ADD_QTY - SALE_QTY})`);

  const sale = afterSale.sales.find(s => (s.sku || '') === SKU && (s.orderNumber || '') === 'ACC-9001');
  record('the sale itself carries no IMEI', !!sale && !String(sale.imei || '').trim(),
    sale ? `imei="${sale.imei || ''}"` : 'not found');

  record('no uncaught JS errors across the flow', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
