/**
 * scripts/e2eTemuMarketplace.mjs — Temu, the 5th marketplace, end to end.
 *
 * Added 2026-07, corrected 2026-07 against the client's final Temu export
 * (TEMU_FORMULA.csv) — the real transaction for this exact order, which an
 * earlier illustrative pass had gotten wrong (BP=100/SP=119.33/commission
 * computed as a flat 7%, zero VAT anywhere). This drives the real running
 * app through the client's actual row:
 *
 *   Order PO-210-07053322437751959 · IMEI 350901801557294
 *   BP £55 · SP £83.99 · Postage £6.30 · Commission £3.87 (Temu's own
 *   reported per-order fee — its referral rate varies by category, not a
 *   flat percentage) · Commission VAT £0.77 = 3.87 x 20% (derived; the
 *   master's own cell says 4.07 because `=K2+20%` is a typo for `=K2*20%`)
 *   → Marginal Tax £4.83 · P.VAT £1.26 · Total VAT £1.26 · GP £11.73 ·
 *     GP% 21.32 · Total VAT NTP £3.57
 *
 *   1. Import one office unit matching the sheet's IMEI/BP/supplier.
 *   2. Import the shipped SALES_TEMU_TEMPLATE.xlsx (marketplace picker set
 *      to Temu) — its own example row IS the client's real row, so this is
 *      the real template, not a synthetic fixture.
 *   3. Confirm the sale reconciles: unit sold, marketplace tagged TEMU,
 *      every derived figure matches the export exactly, Commission VAT is
 *      excluded from Total VAT/GP, and there's no DSF line at all.
 *   4. Confirm Temu shows up correctly across the app: Inventory, Sales
 *      History, VAT Centre, Insights (Platform Scorecard), and the
 *      downloaded Master Excel report (a real TEMU sheet, right headers,
 *      right numbers).
 *
 * Run after: VITE_E2E=1 vite build && vite preview --port 4173
 *   node scripts/e2eTemuMarketplace.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/temu-marketplace';
const TEMU_SALES_FILE = resolve('templates/SALES_TEMU_TEMPLATE.xlsx');

const ROW = {
  order: 'PO-210-07053322437751959',
  imei: '350901801557294',
  sku: 'SG-A17-128GB-OB',
  model: 'GALAXY A17',
  supplier: 'MHL',
  bp: 55,
  sp: 83.99,
  postage: 6.30,
  commission: 3.87,
  commissionVat: 0.77,   // 3.87 x 20% — derived, not read from the sheet
};

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

async function gotoAdminSub(page, label) {
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await tab.scrollIntoViewIfNeeded().catch(() => {});
  await tab.click();
  await page.waitForTimeout(900);
}

async function openImportMenu(page) {
  // The Import dropdown is gone. Inventory and Sales import are now two
  // labelled icon buttons in the header (App.tsx, behind SHOW_IMPORT_UI &&
  // userIsAdmin), so there is no menu to open — the click that used to follow
  // this call now targets the button directly. Kept as a no-op so the call
  // sites read the same and the diff stays reviewable.
  await page.waitForTimeout(200);
}

async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      units: Object.values(s.inventoryUnits || {}),
      sales: Object.values(s.sales || {}),
    };
  });
}

/** Build a one-row Inventory Report matching the Temu sheet's unit, so the
 *  sales import below matches it by IMEI instead of landing as an orphan —
 *  this test is about the Temu calculation chain, not the orphan flow
 *  (already covered by e2eShsOrphanFlow.mjs). */
function buildInventoryFile() {
  const headers = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
  const row = ['2026-07-20', ROW.model, ROW.imei, 'A', '128GB', 'Physical SIM', 'Black', ROW.supplier, ROW.bp, 'OFFICE', ''];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, row]), 'INVENTORY');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const path = resolve(OUT, 'temu-unit-inventory.xlsx');
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

  // ══ 2 · Import the matching office unit ══════════════════════════════
  console.log('\n── 2. Import the office unit the Temu sale will match ──');
  const invFile = buildInventoryFile();
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(invFile);
  await page.waitForTimeout(2500);
  await shot(page, 'inventory-preview');
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows?/i }).click();
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);

  const afterInv = await readStore(page);
  const unit = afterInv.units.find(u => (u.imei || '') === ROW.imei);
  record('the office unit is on the books before the sale', !!unit && unit.status === 'available',
    unit ? `${unit.model} · ${unit.status}` : 'not found');

  // ══ 3 · Import the real Temu template (marketplace = Temu) ═══════════
  console.log('\n── 3. Upload SALES_TEMU_TEMPLATE.xlsx with the marketplace picker set to Temu ──');
  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(700);
  const temuPicker = modal(page).getByRole('button', { name: /^Temu$/i }).first();
  if (await temuPicker.isVisible().catch(() => false)) {
    await temuPicker.click();
    await page.waitForTimeout(400);
  }
  record('the marketplace picker offers Temu', await temuPicker.isVisible().catch(() => false)
    || await modal(page).getByText(/Temu/i).first().isVisible().catch(() => false));
  await page.locator('input[type="file"]').first().setInputFiles(TEMU_SALES_FILE);
  await page.waitForTimeout(3000);
  await shot(page, 'sales-preview-temu');

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }
  const confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  record('confirm is enabled — the sale matched the unit, no orphan completion needed',
    await confirm.isEnabled().catch(() => false));
  await confirm.click();
  await page.waitForTimeout(4000);
  await shot(page, 'sales-import-done');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);

  // ══ 4 · Verify the store — every figure matches the sheet exactly ════
  console.log('\n── 4. Verify against the sheet\'s own numbers ──');
  const after = await readStore(page);
  const soldUnit = after.units.find(u => (u.imei || '') === ROW.imei);
  record('the unit is now SOLD', soldUnit?.status === 'sold', `status=${soldUnit?.status}`);

  const sale = after.sales.find(s => s.marketplace === 'TEMU' && (s.imei || '') === ROW.imei);
  record('a TEMU sale was recorded, matched by IMEI', !!sale, sale ? sale.id : 'not found');

  if (sale) {
    const close = (a, b, tol = 0.02) => Math.abs((a ?? NaN) - b) <= tol;
    record('Commission = £3.87 (Temu\'s own reported per-order fee, read from the file)',
      close(sale.commission, 3.87), `got ${sale.commission}`);
    // DERIVED as Commission x 20%, not read. The operator master computes it
    // as `=K2+20%`, which Excel evaluates as K + 0.2 rather than K x 20%:
    // 3.87 + 0.2 = 4.07 where 20% VAT on 3.87 is 0.77. A plus typed for a
    // times. Nothing downstream moves — Temu VAT-invoices this back as
    // reclaimable input tax, so it sits outside Total VAT and GP either way.
    record('Commission VAT = £0.77 (derived as Commission x 20%, not the sheet\'s typo)',
      close(sale.commissionVat, 0.77), `got ${sale.commissionVat}`);
    record('Marginal Tax = £4.83 ((SP-BP)*16.67%)', close(sale.marginalTax, 4.83),
      `got ${sale.marginalTax}`);
    record('P. VAT = £1.26 (Postage × 20% — no longer a fixed 0)', close(sale.postageVat, 1.26),
      `got ${sale.postageVat}`);
    record('Total VAT = £1.26 (= P.VAT alone — Commission VAT excluded)', close(sale.totalVat, 1.26),
      `got ${sale.totalVat}`);
    record('GP = £11.73', close(sale.grossProfit, 11.73), `got ${sale.grossProfit}`);
    record('GP% = 21.32 (GP/BP*100)', close(sale.gpPercent, 21.32), `got ${sale.gpPercent}`);
    record('Total VAT NTP = £3.57 (Marginal Tax - Total VAT)', close(sale.totalVatNtp, 3.57),
      `got ${sale.totalVatNtp}`);
    record('no DSF line at all — Temu\'s export has no DSF/DSF VAT columns',
      sale.dsf === undefined && sale.dsfVat === undefined,
      `dsf=${sale.dsf} dsfVat=${sale.dsfVat}`);
  }

  // ══ 5 · Confirm Temu shows up across the app ═════════════════════════
  console.log('\n── 5. Temu across the app — Inventory, Sales History, VAT, Insights ──');
  await gotoTab(page, 'Admin');
  await shot(page, 'admin-overview');

  await gotoAdminSub(page, 'Sales History');
  await page.waitForTimeout(600);
  const historyHasTemu = await page.getByText(/temu/i).first().isVisible().catch(() => false);
  record('the Temu sale appears in Sales History', historyHasTemu);
  await shot(page, 'admin-sales-history');

  await gotoAdminSub(page, 'Money');
  await page.waitForTimeout(600);
  await shot(page, 'admin-money-vat');
  const vatBodyText = await page.locator('body').innerText();
  record('VAT Centre reflects the imported sale (period shows 1 sale)',
    /1 sale/i.test(vatBodyText) || /Sales in Period[\s\S]{0,20}1/i.test(vatBodyText));

  await gotoAdminSub(page, 'Insights');
  await page.waitForTimeout(600);
  const insightsHasTemu = await page.getByText(/temu/i).first().isVisible().catch(() => false);
  record('Temu appears on the Insights / Platform Scorecard', insightsHasTemu);
  await shot(page, 'admin-insights');

  // ══ 6 · Download the Sales Report — real TEMU sheet ══════════════════
  // "Download Master Excel" on Admin → Reports is the INVENTORY export
  // (stock + IMEI numbers + supplier feed) — the Sales Report with one
  // sheet per marketplace lives on Inventory (Sell) → "Sales Report".
  console.log('\n── 6. Download the Sales Report and verify the TEMU sheet ──');
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(600);
  const salesReportBtn = page.getByRole('button', { name: /^Sales Report$/i }).first();
  await salesReportBtn.click();
  await page.waitForTimeout(400);
  await shot(page, 'sales-report-menu');
  const [download] = await Promise.all([
    page.waitForEvent('download').catch(() => null),
    page.getByRole('button', { name: /All Time/i }).first().click().catch(() => {}),
  ]);
  if (download) {
    const dlPath = resolve(OUT, 'downloaded-sales-report.xlsx');
    await download.saveAs(dlPath);
    const wb = XLSX.read(readFileSync(dlPath));
    record('the downloaded workbook has a TEMU sheet', wb.SheetNames.includes('TEMU'),
      wb.SheetNames.join(', '));
    if (wb.SheetNames.includes('TEMU')) {
      const sheet = wb.Sheets['TEMU'];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const header = rows[0] || [];
      record('the TEMU sheet has Commission VAT but no DSF columns (Temu\'s own layout)',
        header.includes('Commission VAT') && !header.includes('DSF') && !header.includes('DSF. VAT'),
        header.join(' | '));
      const dataRow = rows[1] || [];
      const orderIdx = header.indexOf('Order Number');
      record('the TEMU sheet carries the imported order',
        orderIdx >= 0 && String(dataRow[orderIdx]) === ROW.order,
        `${dataRow[orderIdx]}`);
    }
  } else {
    record('Master Excel download triggered', false, 'no download event captured');
  }

  record('no uncaught JS errors across the Temu flow', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
