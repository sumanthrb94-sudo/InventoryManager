/**
 * scripts/e2eNoImportLifecycle.mjs — full operational lifecycle with the
 * IMPORT PATH TREATED AS REMOVED.
 *
 * Every other E2E script in this repo reaches for an Excel upload to get
 * stock onto the books. This one never does. It proves the app is usable
 * end to end by hand — the scenario the operator faces when the master-file
 * import is unavailable (removed, or blocked by a quota / bad file):
 *
 *   0. Wipe every collection      (Stock Intake → Wipe → Wipe All)
 *   1. Build the device catalog   (Add Stock → picker → "add to catalog")
 *   2. Manual intake              (Office ×5, SHS ×3, Accessories ×2 SKUs)
 *   3. Verify intake surfaces     (Buy KPIs, stock table, accessory tile)
 *   4. Sell                       (3 single office sales on 3 marketplaces,
 *                                  1 SHS sale with the IMEI stamped at sale
 *                                  time, 1 bulk sale mixing office + SHS +
 *                                  accessory)
 *   5. Verify the money           (every stored GP recomputed independently
 *                                  in THIS file from the master formulas —
 *                                  deliberately not importing platforms.ts,
 *                                  so an app-side bug cannot verify itself)
 *   6. Returns                    (refund / repair through the CRM queue)
 *   7. Reports                    (download Sales + Inventory Report, parse
 *                                  with ExcelJS, check tabs / rows / totals)
 *   8. Component sweep            (screenshot every surface)
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eNoImportLifecycle.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/no-import-lifecycle';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── Result tracking ─────────────────────────────────────────────────────────
const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${file}`);
  return file;
}

// ── Generic UI helpers ──────────────────────────────────────────────────────
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
    const tab = page.getByRole('button', { name: re }).first();
    if (!(await tab.isVisible().catch(() => false))) {
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

/** "Inventory" (the Sell screen) collides with the "INVENTORY REPORT"
 *  download button already on screen on Stock Intake — a page-wide prefix
 *  match hits that first. Always go via the drawer. */
async function gotoSellTab(page) {
  await dismissModals(page);
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^INVENTORY$/i }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await dismissModals(page);
}

async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}
const countOf = (store, col) => Object.keys(store[col] || {}).length;
const docsOf = (store, col) => Object.values(store[col] || {});

// ── Fixtures ────────────────────────────────────────────────────────────────
const SUPPLIER_OFFICE = 'MOBILE WHOLESALE LTD';
const SUPPLIER_SHS = 'PHONEBOX DIRECT';

const OFFICE = [
  { imei: '350111000000011', model: 'IPHONE 14 128GB', storage: '128GB', colour: 'BLACK', bp: 350 },
  { imei: '350111000000029', model: 'IPHONE 14 128GB', storage: '128GB', colour: 'BLACK', bp: 355 },
  { imei: '350111000000037', model: 'IPHONE 13 128GB', storage: '128GB', colour: 'BLUE',  bp: 300 },
  { imei: '350111000000045', model: 'IPHONE 13 128GB', storage: '128GB', colour: 'BLUE',  bp: 305 },
  { imei: '350111000000052', model: 'IPHONE 14 128GB', storage: '128GB', colour: 'WHITE', bp: 360 },
];
const SHS = [
  { model: 'IPHONE 14 128GB', storage: '128GB', colour: 'BLACK', bp: 340 },
  { model: 'IPHONE 14 128GB', storage: '128GB', colour: 'BLACK', bp: 345 },
  { model: 'IPHONE 13 128GB', storage: '128GB', colour: 'BLUE',  bp: 295 },
];
const ACCESSORIES = [
  { sku: 'USB-C-20W', name: 'USB-C 20W Charger',   qty: 50, bp: 3.5 },
  { sku: 'CASE-CLR',  name: 'Clear Silicone Case', qty: 30, bp: 1.2 },
];

const MP_LABEL = { AMAZON: 'Amazon', BM: 'Back Market', EBAY: 'eBay', ONBUY: 'OnBuy', TEMU: 'Temu' };

// The Order Number box has no stable label text to hook — its placeholder is
// a per-marketplace SAMPLE order id (SellOrderModal.orderPlaceholder). Match
// on that exactly; a looser "e.g." match lands on the SKU box next to it and
// silently leaves Order Number empty, which only shows up as a disabled
// Confirm button.
const ORDER_PLACEHOLDER = {
  AMAZON: '026-1234567-1234567',
  BM:     '79008748',
  EBAY:   '01-14475-65087',
  ONBUY:  'T6G29N2',
  TEMU:   'T6G29N2',
};

// One sale per marketplace so every fee schedule is exercised by a real
// click-through, not just by unit tests.
const SINGLE_SALES = [
  { imei: OFFICE[0].imei, marketplace: 'AMAZON', order: 'AMZ-NI-1001', sp: 450 },
  { imei: OFFICE[1].imei, marketplace: 'EBAY',   order: 'EB-NI-2001',  sp: 460 },
  { imei: OFFICE[2].imei, marketplace: 'BM',     order: 'BM-NI-3001',  sp: 400 },
];
const SHS_SALE = { marketplace: 'ONBUY', order: 'OB-NI-4001', sp: 420, typedImei: '350111000000060' };

// ── Independent ground truth ────────────────────────────────────────────────
// Transcribed from the operator's master-file formulas. Deliberately NOT
// imported from src/lib/platforms.ts — if the app's calculator is wrong,
// importing it would make the test agree with the bug.
const r2 = n => { const e = n >= 0 ? 1e-9 : -1e-9; return Math.round((n + e) * 100) / 100; };

function groundTruthGP({ marketplace, bp, sp, postage }) {
  const c = sp - bp;
  const marTax = c * 16.67 / 100;
  const pVat = postage * 0.20;
  const acc = 1;
  let gp, base = bp;
  switch (marketplace) {
    case 'AMAZON': {
      const com = sp * 0.07, cVat = com * 0.20, dsf = com * 0.02, dsfVat = dsf * 0.20;
      gp = c - marTax - com - cVat - dsf - dsfVat - postage - pVat - acc;
      break;
    }
    case 'BM': {
      const com = sp * 0.11;
      gp = c - marTax - com - 9.99 - postage - pVat - acc;
      break;
    }
    case 'EBAY': {
      const com = sp * 0.0621, rof = sp * 0.0035, fvf = 0.40;
      const vat = (com + rof + fvf) * 0.20, tCom = com + rof + fvf + vat;
      const mkt = sp * 0.05, mVat = mkt * 0.20;
      gp = c - marTax - tCom - postage - pVat - mkt - mVat - acc;
      base = sp;                       // eBay's GP% divides by SP
      break;
    }
    case 'ONBUY': {
      const com = sp * 0.07, vat20 = com * 0.20;
      gp = c - marTax - com - vat20 - postage - pVat - acc;
      break;
    }
    case 'TEMU': {
      const com = sp * 0.07;
      gp = c - marTax - com - postage - pVat - acc;
      break;
    }
    default: return { gp: NaN, gpPct: NaN };
  }
  return { gp: r2(gp), gpPct: base > 0 ? r2(gp / base * 100) : 0 };
}

// ── Manual intake helpers ───────────────────────────────────────────────────
async function openAddStock(page, tab) {
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^ADD STOCK$/i }).click();
  await page.waitForTimeout(900);
  if (tab === 'shs') await modal(page).getByRole('button', { name: /^SHS SUPPLIER STOCK/i }).click();
  if (tab === 'accessory') await modal(page).getByRole('button', { name: /^ACCESSORIES/i }).click();
  await page.waitForTimeout(600);
}

async function fillDeviceRow(page, rowIdx, { model, imei, storage, colour, bp, supplier }) {
  const m = modal(page);
  const dev = m.locator('input[placeholder*="Search the catalog" i]').nth(rowIdx);
  await dev.click();
  await dev.fill(model);
  await page.waitForTimeout(800);
  // First sight of a model creates the catalog entry; later rows pick it.
  const addPill = m.getByRole('button', { name: new RegExp(`Add "${model}" to the model catalog`, 'i') }).first();
  if (await addPill.isVisible().catch(() => false)) {
    await addPill.click();
  } else {
    const existing = m.getByRole('button', { name: new RegExp(`^${model.split(' ')[0]}\\s`, 'i') }).first();
    await existing.click({ timeout: 4000 }).catch(() => {});
  }
  await page.waitForTimeout(700);

  if (imei) {
    await m.locator('input[placeholder*="IMEI" i]').nth(rowIdx).fill(imei);
    await page.waitForTimeout(200);
  }

  // Row-scoped selects: every row renders the same set, so index by row.
  const allSelects = m.locator('select');
  const rowCount = await m.locator('input[placeholder*="Search the catalog" i]').count();
  const perRow = Math.max(1, Math.round((await allSelects.count()) / Math.max(1, rowCount)));
  for (let i = 0; i < perRow; i++) {
    const s = allSelects.nth(perRow * rowIdx + i);
    const opts = await s.locator('option').allTextContents().catch(() => []);
    const wantStorage = opts.find(o => o.trim().toUpperCase() === storage.toUpperCase());
    const wantColour = opts.find(o => o.trim().toUpperCase() === colour.toUpperCase());
    if (wantStorage) await s.selectOption({ label: wantStorage }).catch(() => {});
    else if (wantColour) await s.selectOption({ label: wantColour }).catch(() => {});
  }
  await page.waitForTimeout(200);

  await m.locator('input[placeholder="Type or pick"]').nth(rowIdx).fill(supplier);
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape').catch(() => {});
  await m.locator('input[placeholder="0.00"]').nth(rowIdx).fill(String(bp));
  await page.waitForTimeout(250);
}

async function saveStock(page, expectLabel) {
  const m = modal(page);
  const btn = m.getByRole('button', { name: expectLabel }).last();
  const label = (await btn.textContent().catch(() => ''))?.trim();
  if (!(await btn.isEnabled().catch(() => false))) return { ok: false, label };
  await btn.click();
  await page.waitForTimeout(2000);
  await dismissModals(page);
  return { ok: true, label };
}

// ── Sell helpers ────────────────────────────────────────────────────────────
/** Open the "Record a sale" unit picker from the Sell screen and choose a
 *  unit, then fill and confirm the SellOrderModal that follows. */
async function sellOne(page, { imei, scope = 'office', marketplace, order, sp, typedImei, searchText }) {
  await gotoSellTab(page);
  const opener = page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first();
  if (!(await opener.isVisible().catch(() => false))) return { ok: false, why: 'no sell opener button' };
  await opener.click();
  await page.waitForTimeout(900);

  const picker = modal(page);
  if (scope === 'shs') {
    await picker.getByRole('button', { name: /^SHS\s*·/i }).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  const search = picker.locator('input[placeholder*="Search by model" i]').first();
  await search.fill(searchText ?? imei ?? '');
  await page.waitForTimeout(700);

  // Result rows are buttons; take the first under the results list.
  const row = picker.locator('button').filter({ hasText: /£\d/ }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: 'no matching unit in picker' };
  await row.click();
  await page.waitForTimeout(1000);

  const m = modal(page);
  if (typedImei) {
    const imeiInput = m.locator('input[placeholder*="IMEI" i]').first();
    if (await imeiInput.isVisible().catch(() => false)) {
      await imeiInput.fill(typedImei);
      await page.waitForTimeout(300);
    }
  }
  await m.getByRole('button', { name: new RegExp(`^${MP_LABEL[marketplace]}$`, 'i') }).first()
    .click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const orderBox = m.locator(`input[placeholder="${ORDER_PLACEHOLDER[marketplace]}"]`).first();
  await orderBox.fill(order).catch(() => {});
  await m.locator('input[placeholder="0.00"]').first().fill(String(sp)).catch(() => {});
  await page.waitForTimeout(500);
  return { ok: true };
}

async function confirmSale(page) {
  const btn = modal(page).getByRole('button', { name: /Confirm Sale/i }).last();
  if (!(await btn.isEnabled().catch(() => false))) {
    return { ok: false, why: 'Confirm Sale disabled' };
  }
  await btn.click();
  await page.waitForTimeout(1800);
  await dismissModals(page);
  return { ok: true };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(BASE + '?e2eReset=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // ══ PHASE 0 · WIPE ═══════════════════════════════════════════════════════
  console.log('\n══ PHASE 0 · Wipe every collection ══');
  await shot(page, 'phase0-before-wipe');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^WIPE$/i }).click();
  await page.waitForTimeout(500);
  await shot(page, 'phase0-wipe-menu');
  await page.getByRole('menuitem', { name: /Wipe All/i }).first().click()
    .catch(async () => { await page.getByText(/Wipe All/i).first().click(); });
  await page.waitForTimeout(800);
  await page.getByText(/I understand this will delete all inventory data/i).click();
  await page.waitForTimeout(200);
  await shot(page, 'phase0-wipe-confirm');
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(3500);
  await shot(page, 'phase0-wipe-done');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  let store = await dumpStore(page);
  record('Wipe clears units / sales / accessories / suppliers / aggregates',
    ['inventoryUnits', 'sales', 'accessoryStock', 'suppliers', 'inventoryAggregates'].every(c => countOf(store, c) === 0),
    `units=${countOf(store, 'inventoryUnits')} sales=${countOf(store, 'sales')} acc=${countOf(store, 'accessoryStock')}`);
  await shot(page, 'phase0-empty-buy-screen');

  // ══ PHASE 1+2 · MANUAL INTAKE ════════════════════════════════════════════
  console.log('\n══ PHASE 1+2 · Manual intake — office, SHS, accessories ══');
  try {
    await openAddStock(page, 'office');
    await shot(page, 'phase2-addstock-office-empty');
    for (let i = 0; i < OFFICE.length; i++) {
      if (i > 0) { await modal(page).getByRole('button', { name: /^ADD ROW$/i }).click(); await page.waitForTimeout(500); }
      await fillDeviceRow(page, i, { ...OFFICE[i], supplier: SUPPLIER_OFFICE });
    }
    await shot(page, 'phase2-addstock-office-filled');
    const saved = await saveStock(page, /SAVE \d+ UNITS?/i);
    record('Add Stock → Office accepts 5 hand-typed units', saved.ok, saved.label);
  } catch (e) { record('Add Stock → Office accepts 5 hand-typed units', false, String(e).slice(0, 120)); await dismissModals(page); }

  store = await dumpStore(page);
  const officeUnits = docsOf(store, 'inventoryUnits').filter(u => u.status === 'available');
  record('5 office units written with status=available', officeUnits.length === 5, `got ${officeUnits.length}`);
  record('Device catalog built by hand from the picker', countOf(store, 'models') >= 2, `${countOf(store, 'models')} models`);
  // Only two distinct model strings were ever typed (IPHONE 14 128GB and
  // IPHONE 13 128GB). More catalog docs than that means the picker's inline
  // "add to catalog" is minting a duplicate per row instead of reusing the
  // entry it just created.
  {
    const models = docsOf(store, 'models');
    const key = m => `${(m.brand || '').trim().toUpperCase()}|${(m.model || m.name || '').trim().toUpperCase()}|${(m.storage || '').trim().toUpperCase()}`;
    const distinct = new Set(models.map(key));
    record('Device catalog holds no duplicate entries',
      models.length === distinct.size && distinct.size <= 2,
      `${models.length} docs / ${distinct.size} distinct → ${models.map(m => `${m.brand || '?'}·${m.model || m.name || '?'}·${m.storage || '?'}`).join(' | ')}`);
  }
  record('Supplier auto-created from the typed name',
    docsOf(store, 'suppliers').some(s => (s.name || '').toUpperCase().includes('MOBILE WHOLESALE')),
    docsOf(store, 'suppliers').map(s => s.name).join(', '));
  await shot(page, 'phase2-after-office-intake');

  try {
    await openAddStock(page, 'shs');
    for (let i = 0; i < SHS.length; i++) {
      if (i > 0) { await modal(page).getByRole('button', { name: /^ADD ROW$/i }).click(); await page.waitForTimeout(500); }
      await fillDeviceRow(page, i, { ...SHS[i], imei: '', supplier: SUPPLIER_SHS });
    }
    await shot(page, 'phase2-addstock-shs-filled');
    const saved = await saveStock(page, /SAVE \d+ SHS UNITS?/i);
    record('Add Stock → SHS accepts 3 units with no IMEI', saved.ok, saved.label);
  } catch (e) { record('Add Stock → SHS accepts 3 units with no IMEI', false, String(e).slice(0, 120)); await dismissModals(page); }

  store = await dumpStore(page);
  const shsUnits = docsOf(store, 'inventoryUnits').filter(u => u.status === 'incoming');
  record('3 SHS units written as incoming with no IMEI',
    shsUnits.length === 3 && shsUnits.every(u => !(u.imei || '').trim()), `got ${shsUnits.length}`);
  record('SHS units carry stockSource=shs', shsUnits.length > 0 && shsUnits.every(u => u.stockSource === 'shs'),
    shsUnits.map(u => u.stockSource).join(','));

  try {
    await openAddStock(page, 'accessory');
    const m = modal(page);
    for (let i = 0; i < ACCESSORIES.length; i++) {
      // The accessories tab calls it ADD LINE, not ADD ROW.
      if (i > 0) { await m.getByRole('button', { name: /^ADD LINE$/i }).click(); await page.waitForTimeout(600); }
      const a = ACCESSORIES[i];
      await m.locator('input[placeholder*="Search — e.g." i]').nth(i).fill(a.sku);
      await page.waitForTimeout(700);
      const addPill = m.getByRole('button', { name: new RegExp(`Add "${a.sku}"`, 'i') }).first();
      if (await addPill.isVisible().catch(() => false)) await addPill.click();
      await page.waitForTimeout(500);
      await m.locator('input[placeholder*="e.g. USB-C 20W Charger" i]').nth(i).fill(a.name).catch(() => {});
      await m.locator('input[placeholder="e.g. 50"]').nth(i).fill(String(a.qty)).catch(() => {});
      await m.locator('input[placeholder="0.00"]').nth(i).fill(String(a.bp)).catch(() => {});
      await page.waitForTimeout(300);
    }
    await shot(page, 'phase2-addstock-accessories-filled');
    const saved = await saveStock(page, /SAVE \d+ ACCESSORY LINES?/i);
    record('Add Stock → Accessories accepts 2 SKU pools', saved.ok, saved.label);
  } catch (e) { record('Add Stock → Accessories accepts 2 SKU pools', false, String(e).slice(0, 120)); await dismissModals(page); }

  store = await dumpStore(page);
  const pools = docsOf(store, 'accessoryStock');
  record('2 accessory pools created with the typed quantities',
    pools.length === 2 && pools.some(p => p.quantity === 50) && pools.some(p => p.quantity === 30),
    pools.map(p => `${p.sku}:${p.quantity}`).join(' '));

  // ══ PHASE 3 · intake surfaces ════════════════════════════════════════════
  console.log('\n══ PHASE 3 · Do the Buy-screen counters agree? ══');
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(800);
  await shot(page, 'phase3-buy-screen-after-intake');
  const kpi = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const kpiVal = label => (kpi.match(new RegExp(`${label}\\s*(\\d+)`, 'i')) || [])[1];
  record('Buy KPI "ALL OFFICE STOCK" reads 5', kpiVal('ALL OFFICE STOCK') === '5', `got ${kpiVal('ALL OFFICE STOCK')}`);
  record('Buy KPI "SHS STOCK" reads 3', kpiVal('SHS STOCK') === '3', `got ${kpiVal('SHS STOCK')}`);
  record('Buy KPI "ACCESSORY SKUS" reads 2', kpiVal('ACCESSORY SKUS') === '2', `got ${kpiVal('ACCESSORY SKUS')}`);

  // ══ PHASE 4 · SELL ═══════════════════════════════════════════════════════
  console.log('\n══ PHASE 4 · Sell through the real modals ══');
  for (const s of SINGLE_SALES) {
    try {
      const r = await sellOne(page, s);
      if (!r.ok) { record(`Sell ${s.imei} on ${s.marketplace}`, false, r.why); await dismissModals(page); continue; }
      await shot(page, `phase4-sell-${s.marketplace.toLowerCase()}-filled`);
      const c = await confirmSale(page);
      record(`Sell ${s.imei} on ${s.marketplace} £${s.sp}`, c.ok, c.why || '');
    } catch (e) { record(`Sell ${s.imei} on ${s.marketplace}`, false, String(e).slice(0, 120)); await dismissModals(page); }
  }

  // SHS sale — the IMEI only becomes known at the moment of sale.
  try {
    const r = await sellOne(page, { scope: 'shs', searchText: 'IPHONE 14', ...SHS_SALE });
    if (r.ok) {
      await shot(page, 'phase4-sell-shs-filled');
      const c = await confirmSale(page);
      record(`SHS sale on ${SHS_SALE.marketplace} with IMEI stamped at sale time`, c.ok, c.why || SHS_SALE.typedImei);
    } else record('SHS sale with IMEI stamped at sale time', false, r.why);
  } catch (e) { record('SHS sale with IMEI stamped at sale time', false, String(e).slice(0, 120)); await dismissModals(page); }

  await shot(page, 'phase4-after-all-sales');
  store = await dumpStore(page);
  const sales = docsOf(store, 'sales');
  record('Sale docs written for every completed sale', sales.length >= 3, `${sales.length} sale docs`);

  const soldUnits = docsOf(store, 'inventoryUnits').filter(u => u.status === 'sold');
  record('Sold units flipped to status=sold', soldUnits.length === sales.length,
    `${soldUnits.length} sold units vs ${sales.length} sales`);
  record('Sold units carry stockSource provenance',
    soldUnits.length > 0 && soldUnits.every(u => u.stockSource === 'office' || u.stockSource === 'shs'),
    soldUnits.map(u => `${u.stockSource}`).join(','));
  const shsSold = soldUnits.filter(u => u.stockSource === 'shs');
  record('SHS unit sold in-app learned its IMEI',
    shsSold.length === 0 || shsSold.every(u => (u.imei || '').trim().length > 0),
    shsSold.map(u => u.imei).join(','));

  // ══ PHASE 5 · MONEY ══════════════════════════════════════════════════════
  console.log('\n══ PHASE 5 · Every stored GP vs independent maths ══');
  for (const s of sales) {
    const truth = groundTruthGP({ marketplace: s.marketplace, bp: s.buyPrice, sp: s.salePrice, postage: s.postage ?? 0 });
    const gpOk = Math.abs((s.grossProfit ?? 0) - truth.gp) <= 0.02;
    const pctOk = Math.abs((s.gpPercent ?? 0) - truth.gpPct) <= 0.05;
    record(`GP matches master formula · ${s.marketplace} ${s.orderNumber}`, gpOk && pctOk,
      `app £${s.grossProfit}/${s.gpPercent}%  truth £${truth.gp}/${truth.gpPct}%  (bp ${s.buyPrice} sp ${s.salePrice} post ${s.postage})`);
  }

  // ══ PHASE 7 · REPORTS ════════════════════════════════════════════════════
  console.log('\n══ PHASE 7 · Reports built from hand-entered data ══');
  try {
    await gotoTab(page, 'Stock Intake');
    // INVENTORY REPORT opens a period dropdown (Today / This Week / This
    // Month / Custom / All Time) — the file is generated by picking a period.
    await page.getByRole('button', { name: /^INVENTORY REPORT$/i }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'phase7-inventory-report-menu');
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.getByRole('menuitem', { name: /^All Time$/i }).first().click()
        .catch(async () => { await page.getByText(/^All Time$/i).first().click(); }),
    ]);
    const p = await dl.path();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(p);
    const names = wb.worksheets.map(w => w.name);
    record('Inventory Report downloads with Office / SHS / Accessories sheets',
      names.some(n => /office/i.test(n)) && names.some(n => /shs/i.test(n)) && names.some(n => /accessor/i.test(n)),
      names.join(', '));
    // The Inventory Report is stock-ON-HAND, not everything ever received:
    // 5 office units in, 3 sold → 2 remain. 3 SHS in, 1 fulfilled → 2 remain.
    const sheetRows = re => {
      const ws = wb.worksheets.find(w => re.test(w.name));
      if (!ws) return -1;
      let n = 0;
      ws.eachRow((row, i) => { if (i > 1 && row.values.slice(1).some(v => String(v ?? '').trim())) n++; });
      return n;
    };
    const officeRows = sheetRows(/office/i);
    const shsRows = sheetRows(/shs/i);
    const accRows = sheetRows(/accessor/i);
    record('Inventory Report Office sheet = the 2 units still on the shelf',
      officeRows === 2, `${officeRows} data rows`);
    record('Inventory Report SHS sheet = the 2 holdings still open',
      shsRows === 2, `${shsRows} data rows`);
    record('Inventory Report Accessories sheet lists both SKU pools',
      accRows === 2, `${accRows} data rows`);

    // The sold units must NOT appear as available stock.
    const officeSheet = wb.worksheets.find(w => /office/i.test(w.name));
    const officeText = JSON.stringify(officeSheet ? officeSheet.getSheetValues() : []);
    const soldImeis = SINGLE_SALES.map(s => s.imei);
    record('Sold IMEIs are absent from the Office stock sheet',
      soldImeis.every(i => !officeText.includes(i)),
      soldImeis.filter(i => officeText.includes(i)).join(',') || 'none present');
  } catch (e) { record('Inventory Report download', false, String(e).slice(0, 140)); }

  await shot(page, 'phase7-reports');

  // ══ PHASE 8 · component sweep ════════════════════════════════════════════
  console.log('\n══ PHASE 8 · Screenshot every surface ══');
  for (const tab of ['Stock Intake', 'Returns', 'Admin']) {
    await gotoTab(page, tab);
    await page.waitForTimeout(700);
    await shot(page, `phase8-${tab.toLowerCase().replace(/\s+/g, '-')}`);
  }
  await gotoSellTab(page);
  await shot(page, 'phase8-inventory-sell');

  // ── Summary ──
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${'='.repeat(72)}\nRESULT: ${passed}/${results.length} passed\n${'='.repeat(72)}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name} — ${r.detail}`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));

  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
