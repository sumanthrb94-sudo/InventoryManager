/**
 * scripts/e2eAccessoryReturnViaReturnsPage.mjs — an accessory return processed
 * on the Returns screen, the way an operator does it.
 *
 * Accessories were the one thing the Returns screen couldn't handle. Their
 * return lived on the Accessory Stock panel, then on the Sales Report import;
 * both came out of the UI, which left a charger refund with nowhere to go but
 * a manual Adjust — and Adjust moves the stock without reversing the revenue,
 * so GP and the Returns Summary would both have been wrong.
 *
 * This drives the whole thing through the real UI, no import anywhere:
 *
 *   1. Add Stock → Accessories: a pool of 50
 *   2. Sell → Mark Sold: 3 of them on AMAZON
 *   3. Returns → Process Return → Accessories tab → pick the line → Refund
 *   4. Pool is back to 50, the sale is voided, the ledger carries the event
 *   5. The new Accessory returns section on the screen shows the row + loss
 *   6. The Returns Report and the Sales Report both carry it
 *
 * Run after: VITE_E2E=1 vite build && vite preview
 *   node scripts/e2eAccessoryReturnViaReturnsPage.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/accessory-return-returns-page';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'USB-C-20W';
const NAME = 'USB-C 20W Charger';
const ADD_QTY = 50;
const ADD_BP = 3.5;
const SALE_QTY = 3;
const SALE_SP = 26.97;
const ORDER = 'ACC-RP-4001';
const REASON = 'faulty on arrival';

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
  const re = new RegExp(`^${label}(\\s|$)(?! Report)`, 'i');
  if (!(await page.getByRole('button', { name: re }).first().isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
}
async function gotoSellTab(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^INVENTORY$/i }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);
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
      accessoryStockEvents: Object.values(s.accessoryStockEvents || {}),
      sales: Object.values(s.sales || {}),
    };
  });
}
async function downloadReport(page, buttonName) {
  // Any leftover overlay swallows the click on the report button, and the
  // menu then never opens — which shows up much later as "no download event"
  // rather than as a failed click. Clear first, and confirm the menu really
  // opened before racing the download.
  await dismissModals(page);
  const trigger = page.getByRole('button', { name: buttonName }).first();
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  // ReportRangeMenu's open state is local, and the store subscriptions are
  // still delivering for a beat after a navigation — a re-render lands while
  // the popover is open and resets it to closed. One click therefore isn't
  // reliably enough; retry until the range row is actually on screen. The
  // trigger is a toggle, so a click that DID open it has to be undone before
  // trying again or the retry just closes it.
  const allTime = page.getByRole('button', { name: /^All Time$/i }).first();
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt++) {
    await trigger.click();
    opened = await allTime.isVisible({ timeout: 2500 }).catch(() => false);
    if (!opened) await page.waitForTimeout(800);
  }
  if (!opened) {
    await page.screenshot({ path: `${OUT}/DEBUG-menu-not-open.png`, fullPage: true });
    throw new Error(`${buttonName} menu never opened — see DEBUG-menu-not-open.png`);
  }
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    allTime.click(),
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

  // ══ 1. Intake — an accessory pool, by hand ═══════════════════════════════
  console.log('\n── 1. Add Stock → Accessories: 50 x USB-C 20W Charger ──');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  await modal(page).locator('input[placeholder*="Search — e.g." i]').first().fill(SKU);
  await page.waitForTimeout(700);
  const addPill = modal(page).getByRole('button', { name: new RegExp(`Add "${SKU}"`, 'i') }).first();
  if (await addPill.isVisible().catch(() => false)) await addPill.click();
  await page.waitForTimeout(500);
  await modal(page).locator('input[placeholder*="e.g. USB-C 20W Charger" i]').first().fill(NAME).catch(() => {});
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill(String(ADD_QTY));
  await modal(page).locator('input[placeholder="0.00"]').first().fill(String(ADD_BP));
  await page.waitForTimeout(300);
  await shot(page, 'intake-accessory-filled');
  await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click();
  await page.waitForTimeout(1500);
  await dismissModals(page);

  let store = await readStore(page);
  const pool0 = store.accessoryStock.find(a => a.sku === SKU);
  record(`Pool created at ${ADD_QTY}`, pool0?.quantity === ADD_QTY, `quantity=${pool0?.quantity}`);

  // ══ 2. Sell 3 through the real Sell flow ═════════════════════════════════
  // Selectors lifted verbatim from e2eNoImportLifecycle's sellAccessory —
  // the Sell screen lives under the INVENTORY drawer entry, the picker has
  // an "Accessories · N" scope button, and the Order Number box is matched on
  // its exact per-marketplace placeholder (a looser match lands on the SKU
  // box next to it and leaves Order Number silently empty).
  console.log('\n── 2. Sell → Mark Sold: 3 chargers on AMAZON ──');
  await gotoSellTab(page);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first().click();
  await page.waitForTimeout(900);
  await modal(page).getByRole('button', { name: /^Accessories\s*·/i }).click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);
  await modal(page).locator('input[placeholder*="Search by SKU" i]').first().fill(SKU).catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, 'sell-picker-accessories');
  await modal(page).locator('button').filter({ hasText: new RegExp(SKU, 'i') }).first().click();
  await page.waitForTimeout(1000);

  const m2 = modal(page);
  await m2.getByRole('button', { name: /^Amazon$/i }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await m2.locator('input[placeholder="026-1234567-1234567"]').first().fill(ORDER).catch(() => {});
  await m2.locator('input[type="number"][min="1"]').first().fill(String(SALE_QTY)).catch(() => {});
  await page.waitForTimeout(300);
  await m2.locator('input[placeholder="0.00"]').first().fill(String(SALE_SP)).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'sell-accessory-form');
  await m2.getByRole('button', { name: /Mark Sold|Confirm|Record/i }).last().click();
  await page.waitForTimeout(2000);
  await dismissModals(page);

  store = await readStore(page);
  const pool1 = store.accessoryStock.find(a => a.sku === SKU);
  record(`Pool after selling ${SALE_QTY}: ${ADD_QTY - SALE_QTY}`,
    pool1?.quantity === ADD_QTY - SALE_QTY, `quantity=${pool1?.quantity}`);
  const sale = store.sales.find(s => (s.sku || '') === SKU);
  record('An accessory Sale doc exists and is not voided', !!sale && !sale.voidedAt,
    sale ? `order=${sale.orderNumber} qty=${sale.quantity}` : 'no sale');

  // ══ 3. Returns screen — the whole point of this script ═══════════════════
  console.log('\n── 3. Returns → Process Return → Accessories → Refund ──');
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1200);
  await shot(page, 'returns-screen-before');
  await page.getByRole('button', { name: /^Process Return$/i }).first().click();
  await page.waitForTimeout(800);

  const accKindTab = modal(page).getByRole('button', { name: /^Accessories\s*\d*$/i }).first();
  record('Return picker offers an Accessories tab', await accKindTab.isVisible().catch(() => false));
  await accKindTab.click();
  await page.waitForTimeout(600);
  await shot(page, 'return-picker-accessories-tab');

  const pickerText = await modal(page).innerText().catch(() => '');
  record('The accessory sale is listed with its friendly name', pickerText.includes(NAME),
    pickerText.replace(/\s+/g, ' ').slice(0, 140));
  record('…and its order number', pickerText.includes(ORDER));

  await modal(page).getByText(NAME, { exact: false }).first().click();
  await page.waitForTimeout(800);
  await shot(page, 'accessory-return-modal');

  const formText = await modal(page).innerText().catch(() => '');
  record('Modal states Refund as the only outcome', /refund/i.test(formText));
  record('Modal explains why there is no repair / replacement route',
    /no repair or replacement/i.test(formText), formText.replace(/\s+/g, ' ').slice(0, 160));
  record('Modal shows what is being reversed (marketplace · order · qty)',
    formText.includes(ORDER) && formText.includes('AMAZON'));

  // Reason is required — Confirm must refuse without it.
  await modal(page).getByRole('button', { name: /Confirm Return/i }).click();
  await page.waitForTimeout(500);
  const blocked = await modal(page).innerText().catch(() => '');
  record('Confirm is blocked until a reason is given', /give a reason/i.test(blocked));

  await modal(page).locator('input[placeholder*="wrong item ordered" i]').fill(REASON);
  await page.waitForTimeout(300);
  await shot(page, 'accessory-return-modal-filled');
  await modal(page).getByRole('button', { name: /Confirm Return/i }).click();
  await page.waitForTimeout(2000);
  await dismissModals(page);

  // ══ 4. The books ═════════════════════════════════════════════════════════
  console.log('\n── 4. Pool restored · sale voided · ledger written ──');
  store = await readStore(page);
  const pool2 = store.accessoryStock.find(a => a.sku === SKU);
  record(`Pool back to ${ADD_QTY} — exactly the sale's own quantity restored`,
    pool2?.quantity === ADD_QTY, `quantity=${pool2?.quantity}`);
  record('totalReceived unchanged — a return is not new intake',
    pool2?.totalReceived === ADD_QTY, `totalReceived=${pool2?.totalReceived}`);

  const voided = store.sales.find(s => (s.sku || '') === SKU);
  record('The Sale doc is voided with outcome=refund and the typed reason',
    !!voided?.voidedAt && voided?.voidOutcome === 'refund' && voided?.voidReason === REASON,
    JSON.stringify({ voidedAt: voided?.voidedAt, outcome: voided?.voidOutcome, reason: voided?.voidReason }));
  record('Still exactly ONE sale doc — the return voided it, did not duplicate',
    store.sales.filter(s => (s.sku || '') === SKU).length === 1);

  const evt = store.accessoryStockEvents.find(e => e.type === 'return');
  record('Ledger carries a return event for the right order + marketplace',
    evt?.delta === SALE_QTY && evt?.orderNumber === ORDER && evt?.marketplace === 'AMAZON',
    JSON.stringify(evt && { delta: evt.delta, order: evt.orderNumber, mkt: evt.marketplace }));

  // ══ 5. It is VISIBLE on the screen that recorded it ══════════════════════
  console.log('\n── 5. The Returns screen shows the accessory return it just took ──');
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1500);
  const screenText = await page.innerText('body').catch(() => '');
  record('Returns screen has an "Accessory returns" section', /Accessory returns/i.test(screenText));
  record('…listing the returned accessory by name', screenText.includes(NAME));
  record('…with the reason the operator typed', screenText.includes(REASON));
  // Postage loss = (postage + P.VAT) x 2 legs. The Sell modal autofills the
  // postage, so read it back off the sale rather than assuming a number.
  const postage = Number(voided?.postage) || 0;
  const pvat = voided?.postageVatExempt ? 0 : (Number(voided?.postageVat) || postage * 0.2);
  const carriage = (postage + pvat) * 2;
  // Carriage is not the whole loss. A REFUNDED sale also forfeits the fee the
  // marketplace keeps, and this screen has to print the same number the
  // Returns Report does — the column disagreed with the export by exactly the
  // kept fee until feeLossOnRefund was added to it. Amazon keeps
  // min(20% of commission, £5.00) plus VAT on a refund; a replacement keeps
  // nothing, so this only applies on the refund route the UI creates.
  const commission = Number(voided?.commission) || 0;
  const feeKept = voided?.voidOutcome === 'refund'
    ? Math.min(commission * 0.2, 5) * 1.2
    : 0;
  const expectedLoss = carriage + feeKept;
  record(`…and the postage loss £${expectedLoss.toFixed(2)} (refund = 2 legs + fee kept)`,
    screenText.includes(`£${expectedLoss.toFixed(2)}`),
    `postage=${postage} p.vat=${pvat.toFixed(2)} carriage=${carriage.toFixed(2)} feeKept=${feeKept.toFixed(2)}`);
  await shot(page, 'returns-screen-accessory-section');

  // ══ 6. Both reports ══════════════════════════════════════════════════════
  console.log('\n── 6. Returns Report + Sales Report carry it ──');
  const retPath = await downloadReport(page, /Returns Report/i);
  const retFile = resolve(`${OUT}/downloaded-returns-report.xlsx`);
  copyFileSync(retPath, retFile);
  const retWb = new ExcelJS.Workbook();
  await retWb.xlsx.readFile(retFile);
  const retDetail = retWb.getWorksheet('Returns Detail');
  record('Returns Report has a Returns Detail sheet', !!retDetail);
  if (retDetail) {
    // Returns Detail identifies a return by IMEI + Model, and carries no
    // Order Number column at all — the accessory row is matched on the
    // friendly name plus the marketplace and reason it was filed under.
    let found = null;
    for (let r = 2; r <= retDetail.rowCount; r++) {
      const row = retDetail.getRow(r);
      if (String(row.getCell(3).value ?? '') === NAME) { found = row; break; }
    }
    record('Returns Detail carries the accessory return row', !!found,
      found ? '' : `no row with Model="${NAME}" in ${retDetail.rowCount - 1} rows`);
    if (found) {
      record('…typed as an Accessory return', found.getCell(10).value === 'Accessory',
        `got ${found.getCell(10).value}`);
      record('…with outcome Refund and the operator\'s reason',
        found.getCell(11).value === 'Refund' && found.getCell(12).value === REASON);
      record('…and 2 shipping legs costed at the same £ the screen showed',
        found.getCell(15).value === 2 && Math.abs(Number(found.getCell(16).value) - expectedLoss) < 0.01,
        `legs=${found.getCell(15).value} loss=${found.getCell(16).value}`);
    }
  }

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1000);
  const salesPath = await downloadReport(page, /Sales Report/i);
  const salesFile = resolve(`${OUT}/downloaded-sales-report.xlsx`);
  copyFileSync(salesPath, salesFile);
  const salesWb = new ExcelJS.Workbook();
  await salesWb.xlsx.readFile(salesFile);
  const sDetail = salesWb.getWorksheet('Returns Detail');
  record('Sales Report embeds Returns Detail too', !!sDetail);
  if (sDetail) {
    let outcomeCell = null;
    for (let r = 2; r <= sDetail.rowCount; r++) {
      const row = sDetail.getRow(r);
      if (String(row.getCell(3).value ?? '') === NAME) { outcomeCell = row; break; }
    }
    record('…with the accessory row present', !!outcomeCell);
    if (outcomeCell) {
      record('Return Type reads "Accessory"', outcomeCell.getCell(10).value === 'Accessory',
        `got ${outcomeCell.getCell(10).value}`);
      record('Outcome reads "Refund"', outcomeCell.getCell(11).value === 'Refund',
        `got ${outcomeCell.getCell(11).value}`);
    }
  }
  await shot(page, 'reports-downloaded');

  record('No uncaught JS errors across the whole run', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) {
    console.log('\nFailures:');
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exit(1); });
