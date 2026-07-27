/**
 * scripts/e2eVatCentreBrutal.mjs — pixel-precise verification of the VAT
 * Centre (Admin → Money → VAT), which the codebase itself calls out as
 * "the figure with a filing deadline attached."
 *
 * Rather than re-deriving each marketplace's commission/VAT fee formula by
 * hand (a separate concern with its own existing test coverage — see the
 * TEMU commission/VAT fixes earlier in this project), this test reads the
 * ACTUAL computed marginalTax/totalVat the app assigns each sale straight
 * out of the E2E firestore shim after import, then independently
 * replicates vat.ts's own aggregation logic (buildVatPeriods/vatLineOf) in
 * plain JS to compute what the VAT Centre SHOULD show — proving the
 * AGGREGATION/FILTERING logic is correct:
 *
 *   - a VOIDED sale must be excluded from the VAT period entirely
 *   - a loss-making sale's margin-scheme VAT must floor to £0, while its
 *     "as historically computed" reading keeps the real (negative) figure
 *   - the difference between the two readings, the loss-making count, the
 *     input-VAT total and both net-payable figures must all be exactly
 *     sum(per-sale value) — not double-counted, not silently dropped
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eVatCentreBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/vat-centre-panel';
const FIXTURES = `${OUT}/fixtures`;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}
function modal(page) {
  return page.locator('div.fixed.inset-0').last();
}
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
  const re = new RegExp(`^${label}(\\s|$)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
}
async function gotoAdminSub(page, label) {
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(700);
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
async function importInventory(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(5000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
}
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}

// ── Fixture: 3 sales, same quarter (Q3 2026), one profit, one loss, one voided ──
const SUPPLIER = 'VAT TEST SUPPLIER';
const IMEI_PROFIT = '350190000091101';
const IMEI_LOSS = '350190000091102';
const IMEI_VOIDED = '350190000091103';

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [IMEI_PROFIT, IMEI_LOSS, IMEI_VOIDED].map(imei =>
    ['2026-06-01', 'VAT TEST PHONE', imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, 100, 'OFFICE', '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    // Profit: SP=200, BP=100, margin=100
    ['2026-07-15', 'AMZ-VAT-PROFIT', 'VTP-128-BLK', IMEI_PROFIT, SUPPLIER, 1, 100, 200, 100, '', '', 8, '', '', '', '', '', ''],
    // Loss: SP=50, BP=100, margin=-50 (sold below cost)
    ['2026-07-16', 'AMZ-VAT-LOSS', 'VTP-128-BLK', IMEI_LOSS, SUPPLIER, 1, 100, 50, -50, '', '', 8, '', '', '', '', '', ''],
    // Voided (returned): must be fully excluded from VAT
    ['2026-07-17', 'AMZ-VAT-VOIDED', 'VTP-128-BLK', IMEI_VOIDED, SUPPLIER, 1, 100, 300, 200, '', '', 8, '', '', '', '2026-07-20', 'Refund', 'Cx changed mind'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS, ...rows]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'VAT_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'VAT_SALES.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);

function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
// Exactly matches VatCentre.tsx's own money() — always 2 decimals, and a
// real minus sign (U+2212), not a hyphen, for negatives.
function money(n) {
  return `${n < 0 ? '−' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Independently replicate vat.ts's own logic in plain JS ──────────────
function vatLineOf(sale) {
  const margin = r2((sale.salePrice ?? 0) - (sale.buyPrice ?? 0));
  const asComputed = r2(sale.marginalTax ?? 0);
  const marginScheme = margin > 0 ? Math.max(0, asComputed) : 0;
  return {
    margin, vatAsComputed: asComputed, vatMarginScheme: r2(marginScheme),
    inputVat: r2(sale.totalVat ?? 0),
    differs: r2(marginScheme) !== asComputed,
  };
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FIXTURE);
  await page.waitForTimeout(4000);
  const flipAck = modal(page).getByText(/I've reviewed the list/i);
  if (await flipAck.isVisible().catch(() => false)) { await flipAck.click(); await page.waitForTimeout(300); }
  await modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last().click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);

  // ── Read the ACTUAL computed sale fields straight out of the store ─────
  const store = await dumpStore(page);
  const allSales = Object.values(store.sales ?? {});
  const saleProfit = allSales.find(s => s.orderNumber === 'AMZ-VAT-PROFIT');
  const saleLoss = allSales.find(s => s.orderNumber === 'AMZ-VAT-LOSS');
  const saleVoided = allSales.find(s => s.orderNumber === 'AMZ-VAT-VOIDED');

  record('All 3 sales imported (profit, loss, voided)', !!saleProfit && !!saleLoss && !!saleVoided);
  record('The voided sale actually carries voidedAt', !!saleVoided?.voidedAt, saleVoided?.voidedAt);

  const lineProfit = vatLineOf(saleProfit);
  const lineLoss = vatLineOf(saleLoss);
  console.log('\nActual computed per-sale VAT fields (read from the store, not hand-derived):');
  console.log(' profit sale:', JSON.stringify(lineProfit));
  console.log(' loss sale:  ', JSON.stringify(lineLoss));

  record('Loss sale\'s margin-scheme VAT floors to £0 even though its historical VAT is non-zero',
    lineLoss.vatMarginScheme === 0 && lineLoss.vatAsComputed !== 0,
    `scheme=${lineLoss.vatMarginScheme} asComputed=${lineLoss.vatAsComputed}`);
  record('Profit sale is NOT flagged as loss-making (differs=false)', lineProfit.differs === false);
  record('Loss sale IS flagged as loss-making (differs=true)', lineLoss.differs === true);

  // Independently compute the expected VAT Centre period aggregate.
  const expected = {
    saleCount: 2, // voided excluded
    marginVatAsComputed: r2(lineProfit.vatAsComputed + lineLoss.vatAsComputed),
    marginVatMarginScheme: r2(lineProfit.vatMarginScheme + lineLoss.vatMarginScheme),
    inputVat: r2(lineProfit.inputVat + lineLoss.inputVat),
    lossMakingCount: 1,
    totalSales: r2((saleProfit.salePrice ?? 0) + (saleLoss.salePrice ?? 0)), // 200+50=250
    totalCost: r2((saleProfit.buyPrice ?? 0) + (saleLoss.buyPrice ?? 0)),     // 100+100=200
    totalMargin: r2(lineProfit.margin + lineLoss.margin),                     // 100-50=50
  };
  expected.difference = r2(expected.marginVatMarginScheme - expected.marginVatAsComputed);
  expected.netPayableAsComputed = r2(expected.marginVatAsComputed - expected.inputVat);
  expected.netPayableMarginScheme = r2(expected.marginVatMarginScheme - expected.inputVat);
  console.log('\nIndependently-computed expected VAT Centre period totals:', JSON.stringify(expected, null, 2));

  // ═══ Admin → Money → VAT ═══
  await gotoAdminSub(page, 'Money');
  await page.waitForTimeout(800);
  await shot(page, 'vat-centre-q3-2026');
  const vatText = await page.innerText('body').catch(() => '');

  record('VAT Centre shows the Jul–Sep 2026 quarter with 2 sales (voided excluded)',
    /Jul.{1,3}Sep 2026[\s\S]{0,20}?2\s*sales/i.test(vatText),
    vatText.match(/Jul[\s\S]{0,3}Sep 2026[^\n]*/i)?.[0]);
  record(`"Turnover" = ${money(expected.totalSales)}`,
    vatText.includes(money(expected.totalSales)), vatText.match(/Turnover[\s\S]{0,30}/i)?.[0]);
  record(`"Cost of goods" = ${money(expected.totalCost)}`,
    vatText.includes(money(expected.totalCost)), vatText.match(/Cost of goods[\s\S]{0,30}/i)?.[0]);
  record(`"Total margin" = ${money(expected.totalMargin)}`,
    vatText.includes(money(expected.totalMargin)), vatText.match(/Total margin[\s\S]{0,30}/i)?.[0]);
  record(`"Margin VAT · as historically computed" = ${money(expected.marginVatAsComputed)}`,
    vatText.includes(money(expected.marginVatAsComputed)));
  record(`"Margin VAT · per margin scheme" = ${money(expected.marginVatMarginScheme)}`,
    vatText.includes(money(expected.marginVatMarginScheme)));
  record(`Difference banner shows ${money(expected.difference)} and "1 sale"`,
    vatText.includes(money(expected.difference)) && /\b1\b\s*sale/i.test(vatText));
  record(`"Input VAT on fees" = ${money(expected.inputVat)}`,
    vatText.includes(money(expected.inputVat)), vatText.match(/Input VAT on fees[\s\S]{0,30}/i)?.[0]);
  record(`"Net payable · as computed" = ${money(expected.netPayableAsComputed)}`,
    vatText.includes(money(expected.netPayableAsComputed)));
  record(`"Net payable · margin scheme" = ${money(expected.netPayableMarginScheme)}`,
    vatText.includes(money(expected.netPayableMarginScheme)));

  // Expand the loss-making sales table and confirm the voided sale is nowhere in it.
  const showLossesBtn = page.getByRole('button', { name: /Show the \d+ sale/i }).first();
  if (await showLossesBtn.isVisible().catch(() => false)) {
    await showLossesBtn.click();
    await page.waitForTimeout(400);
    await shot(page, 'vat-centre-loss-detail');
    const afterExpand = await page.innerText('body').catch(() => '');
    record('Loss-making detail table shows exactly the LOSS sale\'s IMEI', afterExpand.includes(IMEI_LOSS));
    record('Loss-making detail table does NOT show the profit sale\'s IMEI', !afterExpand.includes(IMEI_PROFIT));
    record('Loss-making detail table does NOT show the voided sale anywhere', !afterExpand.includes(IMEI_VOIDED));
  }

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
