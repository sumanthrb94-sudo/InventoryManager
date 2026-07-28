/**
 * scripts/e2eAccessorySellAndFixes.mjs — live proof for the four issues
 * reported live in production:
 *
 *   1. "How do I mark accessories sold here" — Record a Sale now has an
 *      Accessories tab (SellUnitPicker → AccessorySaleModal), the in-app
 *      counterpart to SellOrderModal for units.
 *   2. "That is not even showing in the periodic table" — the periodic
 *      table's "Accessories" bucket was actually the misclassified-unit
 *      "Other" bucket, never accessoryStock at all. Renamed to
 *      "Unclassified"; a real AccessoryStockPanel now renders on the same
 *      Inventory screen, right below the periodic table.
 *   3. A sibling classification bug: Apple Watch SE units whose model
 *      string lost the word "Watch" entirely ("SE3 40MM GPS") landed in
 *      that same bucket. Fixed via RE_APPLE_WATCH_SIZE in modelStorage.ts.
 *   4. "I don't see any auto generated id or stock in date" — the
 *      Accessories sheet on the Inventory Report now carries a
 *      "First Added" column for context (pooled stock genuinely has no
 *      per-item ID or single stock-in date — that part was by design).
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAccessorySellAndFixes.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-sell-and-fixes';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'TYPE-C-25W-TEST';
const NAME = 'usb type c 25w';

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
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
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
      sales: Object.values(s.sales || {}),
      inventoryUnits: Object.values(s.inventoryUnits || {}),
    };
  });
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

async function run() {
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

  // ══ 1. Add the accessory + an Apple Watch SE unit whose model lost "Watch" ══
  console.log('\n── 1. Add Stock: the reported test accessory + a bare "SE3 40MM GPS" watch ──');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  await modal(page).locator('input[placeholder="e.g. USB-C-20W"]').first().fill(SKU);
  await modal(page).locator('input[placeholder="e.g. USB-C 20W Charger"]').first().fill(NAME);
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill('12');
  await modal(page).locator('input[placeholder="0.00"]').first().fill('4.25');
  await page.waitForTimeout(300);
  await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  const afterAdd = await readStore(page);
  const pool = afterAdd.accessoryStock.find(a => a.sku === SKU);
  record('Accessory pool created (matches the live bug report)', pool?.quantity === 12, `quantity=${pool?.quantity}`);

  // Seed one genuinely unclassifiable unit (no brand keyword at all) so the
  // periodic table's data-quality bucket has real content to check the
  // rename against — an empty bucket renders no row at all (buildGroups
  // filters zero-element groups), so this can't be proven with zero units.
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    const store = raw ? JSON.parse(raw) : {};
    store.inventoryUnits = store.inventoryUnits || {};
    store.inventoryUnits['unrecognised-1'] = {
      id: 'unrecognised-1', imei: '111222333444555',
      model: 'ZZZ-UNKNOWN-WIDGET 999', storage: '', colour: 'Black',
      buyPrice: 10, dateIn: '2026-07-28',
      supplierId: 'sup_test', supplierName: 'TESTSUP',
      status: 'available',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-07-28T00:00:00Z',
    };
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(store));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // ══ 2. Periodic table — bucket rename + real Accessories panel visible ═══
  console.log('\n── 2. Inventory tab: periodic table + Accessory Stock panel ──');
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  const bodyText1 = await page.innerText('body').catch(() => '');
  record('Periodic table no longer labels the misclassified-unit bucket "Accessories"', !/Accessories\s*\(/.test(bodyText1));
  record('Periodic table shows "Unclassified" for the data-quality bucket (with a real unclassifiable unit present)', /Unclassified/.test(bodyText1));

  const accHeading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
  await accHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  const accPanelVisible = await accHeading.isVisible().catch(() => false);
  record('A real Accessory Stock panel renders on the Inventory tab (below the periodic table)', accPanelVisible);
  const bodyText2 = await page.innerText('body').catch(() => '');
  record('The test accessory (SKU + name from the bug report) is visible right there', bodyText2.includes(SKU) && bodyText2.includes(NAME));
  await shot(page, 'inventory-tab-accessory-panel-visible');

  // ══ 3. Record a Sale → Accessories tab → AccessorySaleModal ═════════════
  console.log('\n── 3. Record a Sale → Accessories tab: sell the test accessory ──');
  await page.getByRole('button', { name: /^Record Sale$/i }).first().click();
  await page.waitForTimeout(700);
  await shot(page, 'record-sale-picker-opened');
  const accessoriesTabBtn = modal(page).getByRole('button', { name: /^Accessories · \d+$/i });
  record('Record a Sale picker has an Accessories tab', await accessoriesTabBtn.isVisible().catch(() => false));
  await accessoriesTabBtn.click();
  await page.waitForTimeout(400);
  const pickerText = await modal(page).innerText().catch(() => '');
  record('The test accessory is listed in the picker', pickerText.includes(NAME) && pickerText.includes(SKU));
  await modal(page).getByText(NAME, { exact: false }).first().click();
  await page.waitForTimeout(700);
  await shot(page, 'accessory-sale-modal-opened');

  await modal(page).getByRole('button', { name: /^Amazon$/i }).click();
  await modal(page).getByPlaceholder(/026-1234567/i).fill('AMZ-ACC-TEST-1');
  // Quantity input is the first type=number field (Sale Price, the second
  // one, carries placeholder="0.00" and is targeted separately below).
  await modal(page).locator('input[type="number"]').first().fill('3');
  await modal(page).locator('input[placeholder="0.00"]').fill('11.97');
  await page.waitForTimeout(300);
  await shot(page, 'accessory-sale-modal-filled');
  await modal(page).getByRole('button', { name: /Confirm Sale/i }).click();
  await page.waitForTimeout(1500);
  await dismissModals(page);

  const afterSale = await readStore(page);
  const poolAfterSale = afterSale.accessoryStock.find(a => a.sku === SKU);
  record('Pool decremented by the sold quantity (12 - 3 = 9)', poolAfterSale?.quantity === 9, `quantity=${poolAfterSale?.quantity}`);
  const sale = afterSale.sales.find(s => (s.sku || '') === SKU);
  record('A real Sale doc was created for the accessory (marketplace/order/quantity/GP)', !!sale
    && sale.marketplace === 'AMAZON' && sale.orderNumber === 'AMZ-ACC-TEST-1' && sale.quantity === 3
    && typeof sale.grossProfit === 'number',
    JSON.stringify({ marketplace: sale?.marketplace, orderNumber: sale?.orderNumber, quantity: sale?.quantity, gp: sale?.grossProfit }));
  await shot(page, 'accessory-sale-confirmed');

  // ══ 4. Apple Watch SE bare-model classification fix ══════════════════════
  // Reproduces the exact live report: real Apple Watch units (proper IMEI,
  // Grade A, 64GB, GPS+Cellular, a genuine Stock In Date) stored with model
  // "SE3 40MM GPS+CELLULAR" — no "Watch" token survives at all — landing in
  // the periodic table's "Accessories"(now "Unclassified") bucket instead
  // of "Apple Watch". Seeded directly into the E2E Firestore shim (same
  // pattern as scripts/repro_office_reupload_after_fix.mjs) so this proves
  // the periodic table's live bucketing, not a fragile Add-Stock UI flow.
  console.log('\n── 4. Apple Watch "SE3 40MM GPS+CELLULAR" (no "Watch" token) buckets correctly ──');
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    const store = raw ? JSON.parse(raw) : {};
    store.inventoryUnits = store.inventoryUnits || {};
    const imei = '352673833169541';
    store.inventoryUnits[imei] = {
      id: imei, imei,
      model: 'SE3 40MM GPS+CELLULAR', storage: '64GB', colour: 'Black',
      buyPrice: 145, dateIn: '2026-07-28',
      supplierId: 'sup_test', supplierName: 'TESTSUP',
      status: 'available',
      flags: [], notes: '', platformListed: false, listingSites: [],
      ownerId: 'shared', createdAt: '2026-07-28T00:00:00Z',
    };
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(store));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1000);
  // Tiles carry title={el.seriesKey} = "<model> <storage>" — an exact,
  // DOM-scoped handle (avoids fragile flattened-text regexes that can
  // bleed across sections). Walk up from the tile to its row container
  // (each row is <div>[label row][tiles row]</div>) and read the row label.
  const seTileRowLabel = await page.evaluate(() => {
    const btn = document.querySelector('button[title="SE3 40MM GPS+CELLULAR 64GB"]');
    if (!btn) return null;
    let node = btn;
    for (let i = 0; i < 8 && node; i++) {
      const prev = node.previousElementSibling;
      const text = prev?.textContent?.trim() || '';
      if (text && text.length < 40 && !/^\d+$/.test(text)) return text;
      node = node.parentElement;
    }
    return null;
  });
  record('Real Apple Watch unit (SE3 40MM GPS+CELLULAR, real IMEI/BP/date) lands under "Apple Watch", not "Unclassified"',
    (seTileRowLabel || '').startsWith('Apple Watch'), `row label found: "${seTileRowLabel}"`);
  const seTileCount = await page.locator('button[title="SE3 40MM GPS+CELLULAR 64GB"]').count();
  record('The SE3 tile appears exactly once (not duplicated across two buckets)', seTileCount === 1, `count=${seTileCount}`);
  await shot(page, 'apple-watch-se-correctly-bucketed');

  // ══ 4b. Buy screen's Accessory Stock overlay has NO Adjust/Return ═══════
  // Per operator feedback: accessories are marked sold on the Sell/Inventory
  // screen now (step 3 above) — the Buy screen's overlay is for topping up
  // pools, so Adjust/Return there was redundant clutter. History stays.
  console.log('\n── 4b. Buy screen Accessory Stock overlay: Adjust/Return removed ──');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(700);
  await page.getByText(/Accessory SKUs/i).first().click();
  await page.waitForTimeout(700);
  await shot(page, 'buy-screen-accessory-overlay');
  const buyOverlayText = await modal(page).innerText().catch(() => '');
  record('Buy screen accessory overlay shows the SKU (still visible/read-only)', buyOverlayText.includes(SKU));
  record('Buy screen accessory overlay has NO Adjust button', !/\bAdjust\b/.test(buyOverlayText));
  record('Buy screen accessory overlay has NO Return button', !/\bReturn\b/.test(buyOverlayText));
  // This overlay's only close affordance is the header X button (no
  // backdrop-click-to-close, no Escape handler) — target it directly
  // rather than the generic dismissModals() fallback.
  await modal(page).locator('button').first().click();
  await page.waitForTimeout(400);
  await dismissModals(page);

  // ══ 5. Inventory Report Accessories sheet has a First Added column ═══════
  console.log('\n── 5. Inventory Report — Accessories sheet carries "First Added" ──');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(500);
  const invPath = await downloadReport(page, /Inventory Report/i);
  const invDownloaded = resolve(`${OUT}/downloaded-inventory-report.xlsx`);
  copyFileSync(invPath, invDownloaded);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(invDownloaded);
  const accSheet = wb.getWorksheet('Accessories');
  record('Inventory Report has an Accessories sheet', !!accSheet);
  if (accSheet) {
    const headerRow = accSheet.getRow(1).values;
    record('Accessories sheet header includes "First Added"', headerRow.some(v => v === 'First Added'), JSON.stringify(headerRow));
    record('Accessories sheet still has no per-item "Unit ID" column (by design — pooled stock)', !headerRow.some(v => v === 'Unit ID'));
  }

  record('No uncaught JS errors across the whole run', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
