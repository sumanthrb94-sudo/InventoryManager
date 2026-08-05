/**
 * scripts/e2eTodaysFixes.mjs — a live simulation of the four defects the
 * operator reported, driven through the real UI rather than asserted in a
 * unit test against hand-built objects.
 *
 * Each phase is built so the OLD behaviour would fail it:
 *
 *  1. SOLD TODAY IS COUNTED BY SALE DATE, NOT BY LAST WRITE.
 *     The fixture imports five sold handsets in one go: two sold today, three
 *     sold last month. Every one of the five is WRITTEN today, because that is
 *     when the import runs — which is exactly the shape that made the Buy
 *     screen read 5 while the Sell screen read 2. Both screens must read 2.
 *
 *  2. OUT OF STOCK IS PER SKU BUCKET, STORAGE INCLUDED.
 *     The operator asked why a 128GB model showed as out of stock when "we
 *     have 64GB in store". Storage is part of the SKU, so the 128GB bucket is
 *     genuinely empty while the 64GB one is not. The panel must name the empty
 *     one and leave the stocked one alone.
 *
 *  3. A HANDSET CAN GO THROUGH REPAIR TWICE.
 *     Sold → repair → back to stock → sold again → repair again. The second
 *     cycle used to strand the unit: no "In Repair" chip, no "Back to Stock"
 *     button, no way out, because the first cycle's `repairedAt` was never
 *     cleared.
 *
 *  4. A RETURNED SALE KEEPS ITS ROW ON ITS MARKETPLACE TAB.
 *     The operator asked to cross-verify this. The exported workbook must
 *     carry the returned sale on the sheet it was sold on, with its outcome
 *     and postage loss — not move it away to the Returns sheets.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eTodaysFixes.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/todays-fixes';
const FIXTURES = `${OUT}/fixtures`;
for (const d of [OUT, FIXTURES]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${file}`);
}

// ── Generic UI helpers (same shapes the other live scripts use) ─────────────
function modal(page) { return page.locator('div.fixed.inset-0').last(); }

async function dismissModals(page) {
  for (let i = 0; i < 6; i++) {
    const overlay = page.locator('div.fixed.inset-0').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Done"), button:has-text("Close")').last();
    if (await close.isVisible().catch(() => false)) await close.click({ timeout: 3000 }).catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(350);
  }
}

async function gotoTab(page, label) {
  await dismissModals(page);
  const re = new RegExp(`^${label}(\\s|$)`, 'i');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await page.getByRole('button', { name: re }).first().isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(450);
    }
    try {
      await page.getByRole('button', { name: re }).first().click({ timeout: 6000 });
      await page.waitForTimeout(900);
      return true;
    } catch { await page.waitForTimeout(400); }
  }
  return false;
}

/** "Inventory" (the Sell screen) collides with the INVENTORY REPORT download
 *  button on Stock Intake, so always go via the drawer. */
async function gotoSellTab(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('aside').last().getByRole('button', { name: /^INVENTORY$/i }).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);
}

const dumpStore = page => page.evaluate(() => {
  const raw = sessionStorage.getItem('__e2e_firestore__');
  return raw ? JSON.parse(raw) : {};
});
const docsOf = (store, col) => Object.values(store[col] || {});

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

/** The E2E build boots with a demo dataset; wipe it so every count below is
 *  the fixture's and nothing else's. */
async function wipeAll(page) {
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Wipe$/i }).click({ timeout: 8000 });
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
  await dismissModals(page);
}

async function importSales(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(4000);
  const ack = modal(page).getByText(/I've reviewed the list/i);
  if (await ack.isVisible().catch(() => false)) { await ack.click(); await page.waitForTimeout(300); }
  await modal(page).getByRole('button', { name: /Load [\d,]+ sales|Re-confirm/i }).last().click();
  await page.waitForTimeout(4000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);
}

// ── Fixture ────────────────────────────────────────────────────────────────
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAgo = n => {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TODAY = localToday();
const LAST_MONTH = daysAgo(28);
const SUPPLIER = 'FIXVERIFY WHOLESALE';

/** The bucket that sells out — 128GB, one unit only. */
const SOLD_OUT_IMEI = '350770000000101';
/** Same model, 64GB, two units that stay on the shelf. */
const IN_STOCK_IMEIS = ['350770000000201', '350770000000202'];
/** Sold today. */
const TODAY_IMEIS = ['350770000000301', '350770000000302'];
/** Sold weeks ago, but WRITTEN today by the import — the trap. */
const OLD_IMEIS = ['350770000000303', '350770000000304', '350770000000305'];
/** Left available so its bucket is not out of stock. */
const SPARE_IMEIS = ['350770000000306', '350770000000307'];

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
const invRow = (model, imei, storage, bp) =>
  [daysAgo(60), model, imei, 'A', storage, 'Physical SIM', 'BLACK', SUPPLIER, bp, 'OFFICE', ''];

function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    invRow('FIXVERIFY 12', SOLD_OUT_IMEI, '128GB', 200),
    ...IN_STOCK_IMEIS.map(i => invRow('FIXVERIFY 12', i, '64GB', 180)),
    ...[...TODAY_IMEIS, ...OLD_IMEIS, ...SPARE_IMEIS].map(i => invRow('FIXVERIFY 15', i, '256GB', 400)),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}

const AMAZON_HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments', 'Return Date', 'Outcome', 'Return Reason'];
const saleRow = (date, order, imei, bp, sp) =>
  [date, order, '', imei, SUPPLIER, 1, bp, sp, '', '', '', 6.3, '', '', '', '', '', ''];

function writeSalesFixture(path) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    AMAZON_HEADERS,
    saleRow(TODAY, 'FIX-SOLDOUT', SOLD_OUT_IMEI, 200, 330),
    ...TODAY_IMEIS.map((imei, i) => saleRow(TODAY, `FIX-TODAY-${i + 1}`, imei, 400, 620)),
    // Sold weeks ago; the import writes the doc today, which is what used to
    // make these count as "sold today".
    ...OLD_IMEIS.map((imei, i) => saleRow(LAST_MONTH, `FIX-OLD-${i + 1}`, imei, 400, 600)),
  ]), 'AMAZON');
  for (const m of ['BM', 'EBAY', 'ONBUY', 'TEMU']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([AMAZON_HEADERS]), m);
  }
  XLSX.writeFile(wb, path);
}

const INVENTORY_FIXTURE = resolve(FIXTURES, 'FIXVERIFY_INVENTORY.xlsx');
const SALES_FIXTURE = resolve(FIXTURES, 'FIXVERIFY_SALES.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);
writeSalesFixture(SALES_FIXTURE);

// ── Reading a KPI tile off the screen ──────────────────────────────────────
/**
 * The number rendered under a KPI label. Tiles put the label and the value in
 * sibling nodes, so the tile is found by its label and then read whole —
 * a positional lookup would read a neighbouring tile the moment the strip's
 * order changes.
 */
async function tileValue(page, label) {
  // The tile IS a button — label, then the number, then a caption. Anchoring
  // on the button (not any element containing the words) keeps this off the
  // page-level wrappers, whose text would match too and yield the first
  // number on the screen instead of this tile's.
  //
  // No \b after the label: hasText matches the element's textContent, where
  // the label and the value run together as "SOLD TODAY0" — between "y" and
  // "0" there is no word boundary, so \b would never match.
  const tile = page.locator('button').filter({ hasText: new RegExp(`^\\s*${label}`, 'i') }).first();
  const text = (await tile.innerText().catch(() => '')).replace(/\s+/g, ' ');
  const m = text.match(new RegExp(`${label}\\D*?(\\d[\\d,]*)`, 'i'));
  return m ? Number(m[1].replace(/,/g, '')) : NaN;
}

/**
 * SellOrderModal's order box carries the marketplace's SAMPLE order number as
 * its placeholder, not the word "order" — so the box can only be found per
 * marketplace. Matching on "order" fills nothing, and the only symptom is a
 * disabled Confirm Sale button with no clue why.
 */
const ORDER_PLACEHOLDER = {
  Amazon: '026-1234567-1234567',
  'Back Market': '79008748',
  eBay: '01-14475-65087',
  OnBuy: 'T6G29N2',
  Temu: 'T6G29N2',
};

/** Sell one available unit through the real Record-a-sale flow. */
async function sellOne(page, { search, marketplace = 'Amazon', order, sp }) {
  await gotoSellTab(page);
  const opener = page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first();
  if (!(await opener.isVisible().catch(() => false))) return { ok: false, why: 'no sell opener' };
  await opener.click();
  await page.waitForTimeout(900);

  const picker = modal(page);
  await picker.locator('input[placeholder*="Search by model" i]').first().fill(search);
  await page.waitForTimeout(700);
  const row = picker.locator('button').filter({ hasText: /£\d/ }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: `no unit matching ${search}` };
  await row.click();
  await page.waitForTimeout(1000);

  const m = modal(page);
  await m.getByRole('button', { name: new RegExp(`^${marketplace}$`, 'i') }).first()
    .click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const placeholder = ORDER_PLACEHOLDER[marketplace];
  if (!placeholder) return { ok: false, why: `no order placeholder known for ${marketplace}` };
  await m.locator(`input[placeholder="${placeholder}"]`).first().fill(order).catch(() => {});
  await m.locator('input[placeholder="0.00"]').first().fill(String(sp)).catch(() => {});
  await page.waitForTimeout(500);

  const confirm = m.getByRole('button', { name: /Confirm Sale/i }).last();
  if (!(await confirm.isEnabled().catch(() => false))) return { ok: false, why: 'Confirm Sale disabled' };
  await confirm.click();
  await page.waitForTimeout(1800);
  await dismissModals(page);
  return { ok: true };
}

/** Tech QC → CRM queue → Finalise, the real two-step return. */
async function processReturn(page, { imei, returnType, reason }) {
  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Process Return$/i }).click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const picker = modal(page);
  await picker.locator('input[placeholder*="Search by model" i]').first().fill(imei);
  await page.waitForTimeout(600);
  const row = picker.locator('button').filter({ hasText: new RegExp(imei) }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: `${imei} not returnable` };
  await row.click();
  await page.waitForTimeout(900);

  const qc = modal(page);
  await qc.locator('textarea').nth(0).fill('Customer reports a fault.').catch(() => {});
  await qc.locator('textarea').nth(1).fill('QC: fault confirmed.').catch(() => {});
  await qc.getByRole('button', { name: /Send to CRM Queue/i }).click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  await dismissModals(page);

  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Finalise$/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const crm = modal(page);
  await crm.getByText(returnType, { exact: false }).first().click();
  await page.waitForTimeout(300);
  await crm.locator('input[placeholder*="Customer changed mind" i]').fill(reason).catch(() => {});
  await crm.getByRole('button', { name: /Finalise Return/i }).click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await dismissModals(page);
  return { ok: true };
}

/** Click the In-Repair row's "Back to Stock" and confirm it in the modal. */
async function backToStock(page) {
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(700);
  const btn = page.getByRole('button', { name: /Back to Stock/i }).first();
  if (!(await btn.isVisible().catch(() => false))) return { ok: false, why: 'no Back to Stock button' };
  await btn.click();
  await page.waitForTimeout(700);
  await modal(page).getByRole('button', { name: /^Back to Stock$/i }).click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await dismissModals(page);
  return { ok: true };
}

/** The Sales Report menu lives on the Sell screen; its range picker is what
 *  actually triggers the download. */
async function downloadSalesReport(page) {
  await gotoSellTab(page);
  await page.getByRole('button', { name: /Sales Report/i }).first().click({ timeout: 10000 });
  await page.waitForTimeout(500);
  const wait = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /^All Time$/i }).first().click();
  const dl = await wait;
  const path = resolve(OUT, 'sales-report.xlsx');
  await dl.saveAs(path);
  await page.waitForTimeout(600);
  return path;
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

  // ══ PHASE 1 · Sold Today counts sales, not writes ════════════════════════
  console.log('\n══ PHASE 1 · "Sold Today" counts sales, not writes ══');
  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);
  await importSales(page, SALES_FIXTURE);
  await shot(page, 'phase1-after-import');

  let store = await dumpStore(page);
  let units = docsOf(store, 'inventoryUnits');
  const sold = units.filter(u => u.status === 'sold');
  const soldToday = sold.filter(u => (u.saleDate || '').startsWith(TODAY));
  record('the fixture really sets the trap: 6 sold, only 3 of them today',
    sold.length === 6 && soldToday.length === 3, `${sold.length} sold, ${soldToday.length} dated today`);
  record('and all six docs were WRITTEN today, which is what used to be counted',
    sold.length === 6, `imported ${TODAY}`);

  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(900);
  const buyTile = await tileValue(page, 'Sold Today');
  record('Buy screen · "Sold Today" reads 3, not 6', buyTile === 3, `tile reads ${buyTile}`);
  await shot(page, 'phase1-buy-sold-today');

  await gotoSellTab(page);
  await page.waitForTimeout(900);
  const sellTile = await tileValue(page, 'Sold Today');
  record('Sell screen · "Sold Today" reads the same 3', sellTile === 3, `tile reads ${sellTile}`);
  record('the two screens agree off one database', buyTile === sellTile, `buy=${buyTile} sell=${sellTile}`);
  await shot(page, 'phase1-sell-sold-today');

  // ══ PHASE 2 · Out of stock is per SKU bucket, storage included ════════════
  console.log('\n══ PHASE 2 · Out of stock is per SKU bucket, storage included ══');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(900);
  const alertsText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await shot(page, 'phase2-stock-alerts');

  store = await dumpStore(page);
  units = docsOf(store, 'inventoryUnits');
  const avail = model => units.filter(u => u.status === 'available'
    && (u.model || '').toUpperCase().includes(model)).length;
  const availOf = (model, storage) => units.filter(u => u.status === 'available'
    && (u.model || '').toUpperCase().includes(model)
    && (u.storage || '').toUpperCase().includes(storage)).length;

  record('the 128GB bucket really is empty', availOf('FIXVERIFY 12', '128') === 0,
    `${availOf('FIXVERIFY 12', '128')} available`);
  record('while the 64GB bucket of the SAME model still has stock',
    availOf('FIXVERIFY 12', '64') === 2, `${availOf('FIXVERIFY 12', '64')} available`);
  record('so "out of stock" naming the 128 while the 64 sits in stock is correct, not a bug',
    availOf('FIXVERIFY 12', '128') === 0 && availOf('FIXVERIFY 12', '64') > 0,
    'storage is part of the SKU');
  record('Stock Alerts names the sold-out model', /FIXVERIFY 12/i.test(alertsText),
    'panel mentions FIXVERIFY 12');
  record('the partly-sold FIXVERIFY 15 bucket is NOT sold out — it keeps 2 on the shelf',
    avail('FIXVERIFY 15') === 2, `${avail('FIXVERIFY 15')} available`);

  // ══ PHASE 3 · Repair twice, with a way back both times ═══════════════════
  console.log('\n══ PHASE 3 · A handset through repair TWICE ══');
  const REPAIR_IMEI = TODAY_IMEIS[0];

  const r1 = await processReturn(page, { imei: REPAIR_IMEI, returnType: 'Repair', reason: 'Cracked screen' });
  record('cycle 1 · the sold handset goes to repair', r1.ok, r1.why || '');
  await shot(page, 'phase3-cycle1-in-repair');

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(700);
  const btn1 = await page.getByRole('button', { name: /Back to Stock/i }).first()
    .isVisible().catch(() => false);
  record('cycle 1 · the row offers "Back to Stock"', btn1);

  const b1 = await backToStock(page);
  record('cycle 1 · the repair completes back to the shelf', b1.ok, b1.why || '');
  store = await dumpStore(page);
  let unit = docsOf(store, 'inventoryUnits').find(u => u.imei === REPAIR_IMEI);
  record('cycle 1 · the unit is available again',
    unit?.status === 'available', `status=${unit?.status} returnType=${unit?.returnType}`);
  await shot(page, 'phase3-cycle1-back-on-shelf');

  const resell = await sellOne(page, {
    search: REPAIR_IMEI, order: 'FIX-RESOLD-1', sp: 610,
  });
  record('the repaired handset sells again', resell.ok, resell.why || '');

  const r2 = await processReturn(page, { imei: REPAIR_IMEI, returnType: 'Repair', reason: 'Faulty again' });
  record('cycle 2 · it goes to repair a second time', r2.ok, r2.why || '');
  await shot(page, 'phase3-cycle2-in-repair');

  store = await dumpStore(page);
  unit = docsOf(store, 'inventoryUnits').find(u => u.imei === REPAIR_IMEI);
  record('cycle 2 · THE REGRESSION: the previous cycle\'s repairedAt is cleared',
    !unit?.repairedAt, `repairedAt=${unit?.repairedAt ?? 'null'}`);
  record('cycle 2 · and the permanent repaired_unit flag survives clearing it',
    Array.isArray(unit?.flags) && unit.flags.includes('repaired_unit'),
    `flags=${JSON.stringify(unit?.flags ?? [])}`);

  await gotoTab(page, 'Returns');
  await page.waitForTimeout(700);
  const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const btn2 = await page.getByRole('button', { name: /Back to Stock/i }).first()
    .isVisible().catch(() => false);
  record('cycle 2 · the way back is offered again — the unit is not stranded', btn2);
  record('cycle 2 · the row reads "In Repair", not "Repaired"', /In Repair/i.test(pageText));

  // The Return Activity History is the surface the stale stamp actually broke:
  // its chip and its quick action are gated on `returnType === 'repair' &&
  // !repairedAt`, so cycle two showed a "Repaired" chip and no way back while
  // the handset was still at the repairer. (The table's own Back-to-Stock
  // button is gated on returnType alone, which is why it kept working and the
  // bug was easy to miss.)
  const timelineAction = page.getByRole('button', { name: /Mark Repaired · Back to Stock/i });
  const timelineCount = await timelineAction.count();
  record('cycle 2 · the Return Activity History offers "Mark Repaired · Back to Stock" too',
    timelineCount >= 1, `${timelineCount} on the timeline`);

  const b2 = await backToStock(page);
  record('cycle 2 · the second repair completes back to the shelf', b2.ok, b2.why || '');
  store = await dumpStore(page);
  unit = docsOf(store, 'inventoryUnits').find(u => u.imei === REPAIR_IMEI);
  record('cycle 2 · sellable again after two full repair cycles',
    unit?.status === 'available', `status=${unit?.status}`);
  await shot(page, 'phase3-cycle2-back-on-shelf');

  // ══ PHASE 4 · Returned sales stay on their marketplace tab ═══════════════
  console.log('\n══ PHASE 4 · Returned sales on the marketplace tabs ══');
  const reportPath = await downloadSalesReport(page);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(reportPath);
  const amazon = wb.getWorksheet('AMAZON');
  record('the Sales Report has an AMAZON tab', !!amazon);

  if (amazon) {
    const headers = ((amazon.getRow(1).values ?? []).slice(1)).map(v => String(v ?? ''));
    const col = h => headers.indexOf(h) + 1;
    const rows = [];
    amazon.eachRow((row, n) => {
      if (n === 1) return;
      const order = row.getCell(col('Order Number')).value;
      if (!order || String(order).toUpperCase() === 'TOTAL') return;
      rows.push(row);
    });
    const cell = (row, h) => {
      const v = row.getCell(col(h)).value;
      return v && typeof v === 'object' && 'formula' in v ? v.result : v;
    };
    const repairRow = rows.find(r => String(cell(r, 'Order Number')) === 'FIX-RESOLD-1');
    record('the returned sale keeps its row on the marketplace tab it sold on', !!repairRow,
      repairRow ? 'FIX-RESOLD-1 present' : `orders on the tab: ${rows.map(r => cell(r, 'Order Number')).join(', ')}`);
    if (repairRow) {
      record('it carries the return outcome', /repair/i.test(String(cell(repairRow, 'Outcome') ?? '')),
        String(cell(repairRow, 'Outcome')));
      record('with the carriage a repair costs — two legs',
        Number(cell(repairRow, 'Shipping Legs')) === 2, `legs=${cell(repairRow, 'Shipping Legs')}`);
      record('and a postage loss above zero',
        Number(cell(repairRow, 'Postage Loss')) > 0, `loss=${cell(repairRow, 'Postage Loss')}`);
    }
    const untouched = rows.find(r => String(cell(r, 'Order Number')) === 'FIX-OLD-1');
    record('an unreturned sale on the same tab is untouched by any of it', !!untouched);
  }

  record('no uncaught JS errors across the whole simulation', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

  await shot(page, 'phase4-final');
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${'═'.repeat(72)}\nRESULT: ${passed}/${results.length} passed\n${'═'.repeat(72)}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
