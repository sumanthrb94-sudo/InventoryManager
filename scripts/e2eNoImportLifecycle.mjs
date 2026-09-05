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
 *   2. Manual intake              (Office ×6, SHS ×3, Accessories ×2 SKUs)
 *   3. Verify intake surfaces     (Buy KPIs, stock table, accessory tile)
 *   4. Sell                       (3 single office sales on 3 marketplaces,
 *                                  1 SHS sale with the IMEI stamped at sale
 *                                  time, 1 accessory sale through the
 *                                  Accessories scope of the picker, and a
 *                                  bulk batch mixing office + accessory)
 *   5. Verify the money           (every stored GP recomputed independently
 *                                  in THIS file from the master formulas —
 *                                  deliberately not importing platforms.ts,
 *                                  so an app-side bug cannot verify itself)
 *   6. Returns                    (three unit routes: refund → Back to
 *                                  Inventory, repair, and replacement with a
 *                                  like-for-like unit named)
 *   7. Reports                    (download Sales + Inventory Report, parse
 *                                  with ExcelJS, check tabs / rows / totals
 *                                  and that all three returns reach Returns
 *                                  Detail with the right outcomes)
 *   8. Component sweep            (screenshot every surface)
 *
 * Two things the app enforces that the fixtures have to respect, both found
 * the hard way:
 *   - A replacement needs LIKE-FOR-LIKE stock (same brand + model + storage)
 *     available, or ReturnsPage refuses to finalise. OFFICE[5] is held back
 *     unsold for exactly this.
 *   - The accessory panel offers Adjust ONLY. Return was removed in 2026-08
 *     (marketplace returns arrive via the Sales Report and reconcile on their
 *     own); the run asserts it stays gone.
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
  // Kept unsold on purpose: the replacement route requires LIKE-FOR-LIKE
  // stock (same brand + model + storage as the unit coming back), so the
  // iPhone 13 being replaced needs another iPhone 13 128GB on the shelf.
  // Offering an iPhone 14 gets correctly refused by ReturnsPage.
  { imei: '350111000000078', model: 'IPHONE 13 128GB', storage: '128GB', colour: 'BLUE',  bp: 310 },
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
      // Customer care is £8.99 per the operator's 2026-08 master, not 9.99.
      const com = sp * 0.11;
      // PSF — Payment Seller Fee, SP x 1%, in force from 2026-08-15
      // (DEFAULT_MARKETPLACE_FEES.BM.psfPct). This truth was frozen at the
      // schedule before it existed, so every BM row here read exactly SP x 1%
      // high — £4.00 on a £400 phone — and reported the APP as wrong. The app
      // is date-aware: PRE_2026_08_15_FEES puts psfPct back to 0 for sales
      // dated before the cutoff, and these fixtures are dated today.
      const psf = sp * 0.01;
      gp = c - marTax - com - 8.99 - psf - postage - pVat - acc;
      break;
    }
    case 'EBAY': {
      const com = sp * 0.0621, rof = sp * 0.0035, fvf = 0.40;
      const vat = (com + rof + fvf) * 0.20, tCom = com + rof + fvf + vat;
      // Marketing is a TYPED cell in the master, not SP x 5% — it is £0 on
      // most rows, and inventing it charged a spend that never happened
      // (plus its VAT) against margin. eBay's P. VAT is 0 for the same
      // reason: no formula behind the cell, zero on all 33 master rows.
      const mkt = 0, mVat = mkt * 0.20;
      gp = c - marTax - tCom - postage - mkt - mVat - acc;
      // `base` stays BP, like every other marketplace. eBay divided by SP
      // until 2026-08 — the operator's own eBay tab still does — but one
      // report carrying two denominators ranked the channels backwards:
      // eBay earned more per phone and displayed the lower percentage.
      // Changed on their instruction; every other eBay figure here still
      // reproduces the master exactly.
      break;
    }
    case 'ONBUY': {
      const com = sp * 0.07, vat20 = com * 0.20;
      gp = c - marTax - com - vat20 - postage - pVat - acc;
      break;
    }
    case 'TEMU': {
      // 3.96% from 2026-08-14, not the July master's 4.61%: the client's
      // current report computes every Temu Commission cell as `=H2*3.96%`.
      // Holding the old rate here charged 0.65% of SP too much commission and
      // read as an app bug. Pre-cutoff sales still use 4.61% in the app via
      // PRE_2026_08_15_FEES; these fixtures are dated today.
      const com = sp * 0.0396;
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

/**
 * Mark an ACCESSORY sold — the counterpart to sellOne() for no-IMEI pool
 * stock. Reached through the same "Record a sale" picker, on its
 * Accessories scope, which hands off to AccessorySaleModal instead of
 * SellOrderModal. Screenshots each step so the sequence is readable
 * without running it.
 */
async function sellAccessory(page, { sku, marketplace, order, quantity, sp }) {
  await gotoSellTab(page);
  await shot(page, 'acc-step1-sell-screen');

  const opener = page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first();
  if (!(await opener.isVisible().catch(() => false))) return { ok: false, why: 'no sell opener button' };
  await opener.click();
  await page.waitForTimeout(900);
  await shot(page, 'acc-step2-picker-office-scope');

  const picker = modal(page);
  await picker.getByRole('button', { name: /^Accessories\s*·/i }).click({ timeout: 6000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'acc-step3-picker-accessories-scope');

  await picker.locator('input[placeholder*="Search by SKU" i]').first().fill(sku).catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, 'acc-step4-picker-searched');

  const row = picker.locator('button').filter({ hasText: new RegExp(sku, 'i') }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: `SKU ${sku} not in picker` };
  await row.click();
  await page.waitForTimeout(1000);
  await shot(page, 'acc-step5-accessory-sale-modal');

  const m = modal(page);
  await m.getByRole('button', { name: new RegExp(`^${MP_LABEL[marketplace]}$`, 'i') }).first()
    .click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  await m.locator(`input[placeholder="${ORDER_PLACEHOLDER[marketplace]}"]`).first().fill(order).catch(() => {});
  // Quantity: the +/- steppers are icon-only buttons with no text, so drive
  // the number input between them. min="1" distinguishes it from the Sale
  // Price box (which carries placeholder="0.00").
  await m.locator('input[type="number"][min="1"]').first().fill(String(quantity)).catch(() => {});
  await page.waitForTimeout(300);
  await m.locator('input[placeholder="0.00"]').first().fill(String(sp)).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'acc-step6-filled-with-pl-breakdown');
  return { ok: true };
}

/** Bulk "Mark Multiple Sold" — one office unit + one accessory line in a
 *  single batch, the mixed case recordBulkSales() exists for.
 *
 *  The batch screen is now the Sales Report's own sheets: one TAB per
 *  marketplace, each carrying that marketplace's columns. So a line's
 *  marketplace is the tab it is typed under, not a per-row dropdown, and
 *  there is no separate stock-picker overlay — each row picks its source
 *  and then searches stock inside the row itself.
 */
async function bulkSale(page, { unitSearch, accessorySku, marketplace, order, sp, accSp }) {
  await gotoSellTab(page);
  await page.getByRole('button', { name: /Mark Multiple Sold/i }).click({ timeout: 8000 });
  await page.waitForTimeout(900);
  await shot(page, 'bulk-step1-empty-batch');

  const m = () => modal(page);
  const rows = () => m().locator('tbody tr');

  // Both lines go on the same marketplace's tab, which is what puts them on
  // that sheet of the Sales Report.
  await m().getByRole('tab', { name: new RegExp(`^${MP_LABEL[marketplace]}`, 'i') })
    .click({ timeout: 6000 });
  await page.waitForTimeout(400);

  const addLine = async (kind, search, { orderNumber, price }) => {
    // Each tab opens with one blank row; every line after it needs adding.
    const before = await rows().count();
    const filled = await m().locator('input[aria-label="Model"]')
      .evaluateAll(els => els.filter(e => e.value.trim()).length);
    if (filled >= before) {
      await m().getByRole('button', { name: /^Add row$/i }).click({ timeout: 6000 });
      await page.waitForTimeout(250);
    }
    const row = rows().last();

    // Source is chosen BEFORE searching — the search only offers the chosen
    // source, which is what stops an office handset answering an accessory
    // search for the same words.
    await row.getByLabel('Source').selectOption(kind);
    await page.waitForTimeout(150);
    await row.locator('input[aria-label="Model"]').fill(search);
    await page.waitForTimeout(500);
    const options = page.locator('div[role="listbox"] button[role="option"]');
    if (!(await options.count())) return { ok: false, why: `no ${kind} stock matching "${search}"` };
    await options.first().click({ timeout: 8000 });
    await page.waitForTimeout(300);

    await row.getByLabel('Order number').fill(orderNumber);
    await row.getByLabel('Sale price').fill(String(price));
    // SKU is required on an office line and the picker does not supply one.
    // Leaving it blank left the row NOT READY: the modal said "SKU required",
    // "1 of 3 rows ready" and "Confirm 1 Sale", and sold the accessory alone.
    // The app was right at every step — this helper simply never filled the
    // field, then accepted a Confirm button whose count it never read.
    const sku = row.getByLabel('SKU');
    if (await sku.isVisible().catch(() => false) && !(await sku.inputValue().catch(() => 'x'))) {
      await sku.fill(`SKU-${search}`.slice(0, 24));
      await page.waitForTimeout(150);
    }
    return { ok: true };
  };

  const office = await addLine('office', unitSearch, { orderNumber: `${order}-1`, price: sp });
  if (!office.ok) return office;
  await shot(page, 'bulk-step2-office-line-added');
  const accessory = await addLine('accessory', accessorySku, { orderNumber: `${order}-2`, price: accSp });
  if (!accessory.ok) return accessory;
  await shot(page, 'bulk-step3-accessory-line-added');
  await shot(page, 'bulk-step4-both-lines-filled');

  const confirm = m().getByRole('button', { name: /^Confirm \d+ Sales?$/i }).last();
  if (!(await confirm.isEnabled().catch(() => false))) {
    return { ok: false, why: (await confirm.textContent().catch(() => '')) + ' disabled' };
  }
  // The COUNT, not just the button. Two lines were added, so anything other
  // than "Confirm 2 Sales" means a row was rejected — which is exactly what
  // happened and went unnoticed for as long as this only matched \d+.
  const label = (await confirm.textContent().catch(() => '')) || '';
  const ready = Number((label.match(/(\d+)/) || [])[1] || 0);
  if (ready !== 2) {
    const banner = await m().locator('text=/\\d+ OF \\d+ ROWS READY/i').first().textContent().catch(() => '');
    return { ok: false, why: `${label.trim()} — expected 2 lines · ${banner.trim()}` };
  }
  await confirm.click();
  await page.waitForTimeout(2500);
  await shot(page, 'bulk-step5-batch-result');
  await dismissModals(page);
  return { ok: true };
}

/** Full return journey: pick the sold unit → QC notes → CRM queue →
 *  finalise with an outcome. Screenshots every stage. */
async function processReturn(page, { imei, returnType, reason, tag, outcome, replacementSearch }) {
  await gotoTab(page, 'Returns');
  await shot(page, `ret-${tag}-step1-returns-screen`);
  await page.getByRole('button', { name: /^Process Return$/i }).click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const picker = modal(page);
  await picker.locator('input[placeholder*="Search by model" i]').first().fill(imei).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, `ret-${tag}-step2-pick-sold-unit`);
  const row = picker.locator('button').filter({ hasText: new RegExp(imei) }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: `IMEI ${imei} not returnable` };
  await row.click();
  await page.waitForTimeout(900);

  const qc = modal(page);
  await qc.locator('textarea').nth(0).fill('Customer reports it stopped charging.').catch(() => {});
  await qc.locator('textarea').nth(1).fill('QC: fault confirmed on bench, cosmetics clean.').catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, `ret-${tag}-step3-qc-notes`);
  await qc.getByRole('button', { name: /Send to CRM Queue/i }).click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  await dismissModals(page);

  await gotoTab(page, 'Returns');
  await shot(page, `ret-${tag}-step4-crm-queue`);
  await page.getByRole('button', { name: /^Finalise$/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const crm = modal(page);
  await crm.getByText(returnType, { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  // Customer Outcome only renders for non-repair routes — a repair IS the
  // outcome, so ReturnsPage hides the picker entirely when returnType is
  // 'Send for Repair'. Asking for it there would hang on an absent button.
  if (outcome) {
    await crm.getByRole('button', { name: new RegExp(`^${outcome}`, 'i') }).first()
      .click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  // A replacement must name the unit actually shipped out in its place
  // (needsReplacementUnit in ReturnsPage) — otherwise Finalise stays blocked.
  if (replacementSearch) {
    const repBox = crm.locator('input[placeholder*="Filter by IMEI" i]').first();
    await repBox.fill(replacementSearch).catch(() => {});
    await page.waitForTimeout(600);
    await shot(page, `ret-${tag}-step5a-replacement-picker`);
    await crm.locator('button').filter({ hasText: new RegExp(replacementSearch) }).first()
      .click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await crm.locator('input[placeholder*="Customer changed mind" i]').first().fill(reason).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, `ret-${tag}-step5-finalise-form`);
  await crm.getByRole('button', { name: /Finalise Return/i }).click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  await dismissModals(page);
  await shot(page, `ret-${tag}-step6-after-finalise`);
  return { ok: true };
}

/**
 * The Accessory Stock panel offers Adjust and NOTHING ELSE.
 *
 * Return was removed in 2026-08. Every real accessory return arrives through
 * the Sales Report import as a voided row and reconciles on its own, so the
 * manual button only duplicated it — the same reasoning that removed the
 * manual accessory Sell action before it. Adjust stays because it is the one
 * thing nothing else can do: correct a pool after a physical count (damaged,
 * lost, miscounted, found extra).
 *
 * Asserted rather than assumed, so silently re-adding Return fails loudly.
 */
async function accessoryRowActions(page, sku) {
  await gotoSellTab(page);
  await page.waitForTimeout(600);
  const row = page.locator('tr').filter({ hasText: new RegExp(sku, 'i') }).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, 'acc-panel-adjust-only');
  return row.locator('button')
    .evaluateAll(bs => bs.map(b => (b.innerText || '').trim()).filter(Boolean))
    .catch(() => []);
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * Where did OFFICE[3] change state?
 *
 * It is sold in the bulk sale and no return is ever processed against it, so
 * its status must stay 'sold' from that point to the end of the run. The
 * Inventory Report says otherwise — it lists the IMEI as office stock, and the
 * live store agrees with the report, so whatever moved it moved the unit and
 * not just the sheet. This prints the status at each phase boundary so the
 * step that flips it is named rather than guessed at.
 */
async function traceUnit(page, imei, where) {
  const st = await dumpStore(page);
  const u = docsOf(st, 'inventoryUnits').find(x => (x.imei || '') === imei);
  console.log(`      [trace ${imei}] ${where}: status=${u ? u.status : 'ABSENT'}`
    + (u && u.returnType ? ` returnType=${u.returnType}` : '')
    + (u && u.replacedByUnitId ? ` replacedBy=${u.replacedByUnitId}` : '')
    + (u && u.replacementForUnitId ? ` replacementFor=${u.replacementForUnitId}` : ''));
}

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
    record('Add Stock → Office accepts 6 hand-typed units', saved.ok, saved.label);
  } catch (e) { record('Add Stock → Office accepts 6 hand-typed units', false, String(e).slice(0, 120)); await dismissModals(page); }

  store = await dumpStore(page);
  const officeUnits = docsOf(store, 'inventoryUnits').filter(u => u.status === 'available');
  record('6 office units written with status=available', officeUnits.length === 6, `got ${officeUnits.length}`);
  record('Device catalog built by hand from the picker', countOf(store, 'models') >= 2, `${countOf(store, 'models')} models`);
  // Only two distinct model strings were ever typed (IPHONE 14 128GB and
  // IPHONE 13 128GB). More catalog docs than that means the picker's inline
  // "add to catalog" is minting a duplicate per row instead of reusing the
  // entry it just created.
  {
    const models = docsOf(store, 'models');
    const key = m => `${(m.brand || '').trim().toUpperCase()}|${(m.model || m.name || '').trim().toUpperCase()}|${(m.storage || '').trim().toUpperCase()}`;
    const distinct = new Set(models.map(key));
    // The two models this test typed must appear ONCE EACH. That is the
    // actual claim — the picker's inline "add to catalog" reuses the entry it
    // just created instead of minting one per row.
    //
    // It used to be spelled `distinct.size <= 2`, i.e. "the catalogue contains
    // nothing but the two we typed", which only held while the shim seeded an
    // empty catalogue. The shim now seeds one (production's survives a wipe),
    // so that spelling failed on six pre-existing entries and said "duplicate
    // entries" about a catalogue with none.
    // Match on the model WITHOUT its storage. The picker splits a typed
    // "IPHONE 14 128GB" into model "IPHONE 14" + storage "128GB"
    // (parseBrandModelStorage), so the catalogue never holds the storage in
    // the model name — matching the typed string verbatim found zero and
    // called a healthy catalogue duplicated.
    const typed = ['IPHONE 14 128GB', 'IPHONE 13 128GB']
      .map(t => t.replace(/\s+\d+\s*(GB|TB)$/i, '').trim());
    const countOfModel = name => models.filter(m =>
      (m.model || m.name || '').trim().toUpperCase() === name).length;
    const typedCounts = typed.map(countOfModel);
    record('Device catalog holds no duplicate entries',
      models.length === distinct.size && typedCounts.every(n => n === 1),
      `${models.length} docs / ${distinct.size} distinct · typed ${typed.map((t, i) => `${t}×${typedCounts[i]}`).join(', ')}`);
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
  record('Buy KPI "ALL OFFICE STOCK" reads 6', kpiVal('ALL OFFICE STOCK') === '6', `got ${kpiVal('ALL OFFICE STOCK')}`);
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

  // ── Accessory sale — the no-IMEI pool counterpart ──
  console.log('\n── Marking an ACCESSORY sold ──');
  const ACC_SALE = { sku: 'USB-C-20W', marketplace: 'AMAZON', order: 'AMZ-NI-5001', quantity: 3, sp: 45 };
  const poolBefore = docsOf(await dumpStore(page), 'accessoryStock').find(p => p.sku === ACC_SALE.sku);
  try {
    const r = await sellAccessory(page, ACC_SALE);
    if (r.ok) {
      const c = await confirmSale(page);
      record(`Accessory sale · ${ACC_SALE.quantity}× ${ACC_SALE.sku} on ${ACC_SALE.marketplace} £${ACC_SALE.sp}`,
        c.ok, c.why || '');
    } else record(`Accessory sale · ${ACC_SALE.sku}`, false, r.why);
  } catch (e) { record(`Accessory sale · ${ACC_SALE.sku}`, false, String(e).slice(0, 120)); await dismissModals(page); }
  await shot(page, 'acc-step7-after-accessory-sale');

  {
    const st = await dumpStore(page);
    const poolAfter = docsOf(st, 'accessoryStock').find(p => p.sku === ACC_SALE.sku);
    record('Accessory pool decremented by the sold quantity',
      poolAfter && poolBefore && (poolBefore.quantity - poolAfter.quantity) === ACC_SALE.quantity,
      `${poolBefore?.quantity} → ${poolAfter?.quantity}`);
    const accSale = docsOf(st, 'sales').find(s => s.sku === ACC_SALE.sku && !(s.imei || '').trim());
    record('Accessory sale doc carries quantity and no IMEI',
      !!accSale && accSale.quantity === ACC_SALE.quantity && !(accSale.imei || '').trim(),
      accSale ? `qty=${accSale.quantity} imei="${accSale.imei || ''}" bp=${accSale.buyPrice}` : 'no doc');
    // BP must be the pool cost × quantity — the line-total convention.
    record('Accessory BP = pool buy price × quantity',
      !!accSale && Math.abs(accSale.buyPrice - (poolBefore.buyPrice * ACC_SALE.quantity)) < 0.01,
      accSale ? `${accSale.buyPrice} vs ${poolBefore.buyPrice} × ${ACC_SALE.quantity}` : '');
    const ledger = docsOf(st, 'accessoryStockEvents').filter(e => e.type === 'sale');
    record('Accessory stock ledger recorded the sale',
      ledger.length >= 1, `${ledger.length} sale events`);
  }

  // ── Bulk sale — office + accessory in one batch ──
  console.log('\n── Bulk sale (office + accessory in one batch) ──');
  try {
    const r = await bulkSale(page, {
      unitSearch: OFFICE[3].imei, accessorySku: 'CASE-CLR',
      marketplace: 'TEMU', order: 'TEMU-NI-6001', sp: 330, accSp: 24,
    });
    record('Bulk sale confirms an office unit + an accessory line together', r.ok, r.why || '');
  } catch (e) { record('Bulk sale confirms an office unit + an accessory line together', false, String(e).slice(0, 120)); await dismissModals(page); }

  await traceUnit(page, OFFICE[3].imei, 'after bulk sale');
  {
    const st = await dumpStore(page);
    const units = docsOf(st, 'inventoryUnits');
    console.log('      [trace ALL UNITS after bulk sale]');
    for (const u of units) {
      console.log(`        ${(u.imei || u.id || '?').padEnd(18)} status=${String(u.status).padEnd(10)} src=${u.stockSource || '?'}`);
    }
    const salesNow = docsOf(st, 'sales');
    console.log('      [trace SALES after bulk sale]');
    for (const sd of salesNow) {
      console.log(`        ${(sd.orderNumber || '?').padEnd(16)} imei=${sd.imei || '(none)'} sku=${sd.sku || '-'} sp=${sd.salePrice}`);
    }
  }
  await shot(page, 'phase4-after-all-sales');
  store = await dumpStore(page);
  const sales = docsOf(store, 'sales');
  record('Sale docs written for every completed sale', sales.length >= 3, `${sales.length} sale docs`);

  // Accessory sales have no inventory unit by design, so compare unit-backed
  // sales only.
  const unitSales = sales.filter(s => (s.imei || '').trim());
  const soldUnits = docsOf(store, 'inventoryUnits').filter(u => u.status === 'sold');
  record('Sold units flipped to status=sold', soldUnits.length === unitSales.length,
    `${soldUnits.length} sold units vs ${unitSales.length} unit-backed sales (${sales.length} sales total)`);
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

  // ══ PHASE 6 · RETURNS ════════════════════════════════════════════════════
  console.log('\n══ PHASE 6 · Returns through the CRM queue ══');
  const returnsBefore = docsOf(await dumpStore(page), 'sales').filter(s => s.voidedAt).length;
  try {
    const r = await processReturn(page, {
      imei: OFFICE[0].imei, returnType: 'Back to Inventory',
      reason: 'Refund — battery health below 85%', tag: 'refund',
    });
    record('Return processed end to end (pick → QC → CRM queue → finalise)', r.ok, r.why || OFFICE[0].imei);
    await traceUnit(page, OFFICE[3].imei, 'after OFFICE[0] refund return');
  } catch (e) { record('Return processed end to end (pick → QC → CRM queue → finalise)', false, String(e).slice(0, 140)); await dismissModals(page); }

  {
    const st = await dumpStore(page);
    const voided = docsOf(st, 'sales').filter(s => s.voidedAt);
    record('Return voids the originating sale doc', voided.length > returnsBefore,
      `${voided.length} voided sales`);
    const u = docsOf(st, 'inventoryUnits').find(x => (x.imei || '') === OFFICE[0].imei);
    record('Refunded unit went Back to Inventory (available again)',
      !!u && u.status === 'available' && u.returnType === 'returned_to_inventory',
      u ? `status=${u.status} returnType=${u.returnType || '—'}` : 'unit missing');
  }

  // ── Repair route — the outcome picker is hidden; repair IS the outcome ──
  try {
    const r = await processReturn(page, {
      imei: OFFICE[1].imei, returnType: 'Send for Repair',
      reason: 'Cracked rear glass in transit', tag: 'repair',
    });
    record('Repair return processed (Send for Repair)', r.ok, r.why || OFFICE[1].imei);
    await traceUnit(page, OFFICE[3].imei, 'after OFFICE[1] repair return');
  } catch (e) { record('Repair return processed (Send for Repair)', false, String(e).slice(0, 140)); await dismissModals(page); }

  {
    const st = await dumpStore(page);
    const u = docsOf(st, 'inventoryUnits').find(x => (x.imei || '') === OFFICE[1].imei);
    record('Repaired unit carries returnType=repair and is not resaleable stock',
      !!u && u.returnType === 'repair' && u.status !== 'available',
      u ? `status=${u.status} returnType=${u.returnType || '—'}` : 'unit missing');
    const s = docsOf(st, 'sales').find(x => (x.imei || '') === OFFICE[1].imei);
    record('Repair stamps voidOutcome=repair on the sale (drives 2-leg postage loss)',
      !!s && s.voidedAt && s.voidOutcome === 'repair',
      s ? `voidedAt=${s.voidedAt} outcome=${s.voidOutcome}` : 'sale missing');
  }

  // ── Replacement route — needs a real replacement unit named ──
  try {
    const r = await processReturn(page, {
      imei: OFFICE[2].imei, returnType: 'Back to Inventory', outcome: 'Replacement',
      replacementSearch: OFFICE[5].imei,   // the like-for-like iPhone 13 held back
      reason: 'Face ID intermittent — swapped for a like-for-like unit', tag: 'replacement',
    });
    record('Replacement return processed (with a replacement unit named)', r.ok, r.why || OFFICE[2].imei);
    await traceUnit(page, OFFICE[3].imei, 'after OFFICE[2] replacement return');
  } catch (e) { record('Replacement return processed (with a replacement unit named)', false, String(e).slice(0, 140)); await dismissModals(page); }

  {
    const st = await dumpStore(page);
    const s = docsOf(st, 'sales').find(x => (x.imei || '') === OFFICE[2].imei);
    record('Replacement stamps voidOutcome=replacement (drives 3-leg postage loss)',
      !!s && s.voidedAt && s.voidOutcome === 'replacement',
      s ? `voidedAt=${s.voidedAt} outcome=${s.voidOutcome}` : 'sale missing');
    const orig = docsOf(st, 'inventoryUnits').find(x => (x.imei || '') === OFFICE[2].imei);
    record('Returned unit links to the replacement that shipped in its place',
      !!orig && !!orig.replacedByUnitId,
      orig ? `replacedByUnitId=${orig.replacedByUnitId || '—'}` : 'unit missing');
  }

  // ── Accessory panel offers Adjust only ──
  console.log('\n── Accessory panel actions ──');
  {
    const labels = await accessoryRowActions(page, 'USB-C-20W');
    record('Accessory row offers Adjust', labels.some(l => /^adjust$/i.test(l)), labels.join(', ') || 'none');
    record('Accessory row no longer offers Return',
      !labels.some(l => /^return$/i.test(l)), labels.join(', ') || 'none');
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
    // Assert against the LIVE store rather than a hand-counted constant —
    // after three different return routes the expected totals are a moving
    // target, and "the report agrees with the app" is the invariant that
    // actually matters.
    const liveStore = await dumpStore(page);
    const liveAvailable = docsOf(liveStore, 'inventoryUnits').filter(u => u.status === 'available').length;
    const liveIncoming = docsOf(liveStore, 'inventoryUnits').filter(u => u.status === 'incoming').length;
    record('Inventory Report Office sheet matches live available stock',
      officeRows === liveAvailable, `report ${officeRows} vs store ${liveAvailable}`);
    record('Inventory Report SHS sheet matches live incoming holdings',
      shsRows === liveIncoming, `report ${shsRows} vs store ${liveIncoming}`);
    record('Inventory Report Accessories sheet lists both SKU pools',
      accRows === 2, `${accRows} data rows`);

    await traceUnit(page, OFFICE[3].imei, 'at Inventory Report time');
    const officeSheet = wb.worksheets.find(w => /office/i.test(w.name));
    // The IMEI COLUMN, not a substring search over the whole sheet.
    //
    // The sheet also carries a Notes column, and a replacement return writes
    // the other handset's IMEI into it — so "is this string anywhere in the
    // sheet" answered yes for a unit that has no row at all, and reported a
    // reporting bug that did not exist. What the assertion means is "this
    // unit is not LISTED AS STOCK", and that is a question about one column.
    const officeImeis = (() => {
      if (!officeSheet) return [];
      const header = officeSheet.getRow(1).values.map(v => String(v ?? '').trim().toUpperCase());
      const col = header.indexOf('IMEI');
      if (col < 0) return [];
      const out = [];
      officeSheet.eachRow((row, i) => {
        if (i === 1) return;
        const v = String(row.values[col] ?? '').trim();
        if (v) out.push(v);
      });
      return out;
    })();
    // Still-sold and in-repair units must NOT read as available stock…
    record('Still-sold IMEI is absent from the Office stock sheet',
      !officeImeis.includes(OFFICE[3].imei), `${OFFICE[3].imei} · ${officeImeis.length} rows`);
    record('In-repair unit is absent from the Office stock sheet',
      !officeImeis.includes(OFFICE[1].imei), `${OFFICE[1].imei} · ${officeImeis.length} rows`);
    // …but the Back-to-Inventory unit must be back ON it.
    record('Refunded unit is back on the Office stock sheet',
      officeImeis.includes(OFFICE[0].imei), `${OFFICE[0].imei} · ${officeImeis.join(',')}`);
  } catch (e) { record('Inventory Report download', false, String(e).slice(0, 140)); }

  // Sales Report — the accessory line must appear BOTH on its marketplace
  // tab (interleaved with phone sales) and on the cross-marketplace
  // Accessories sheet.
  try {
    await gotoSellTab(page);
    await page.getByRole('button', { name: /^SALES REPORT$/i }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'phase7-sales-report-menu');
    const [dl2] = await Promise.all([
      page.waitForEvent('download', { timeout: 40000 }),
      page.getByRole('menuitem', { name: /^All Time$/i }).first().click()
        .catch(async () => { await page.getByText(/^All Time$/i).first().click(); }),
    ]);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile(await dl2.path());
    const names2 = wb2.worksheets.map(w => w.name);
    record('Sales Report has a tab per marketplace + an Accessories sheet',
      ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'].every(n => names2.includes(n)) && names2.includes('Accessories'),
      names2.join(', '));

    const sheetText = n => {
      const ws = wb2.worksheets.find(w => w.name === n);
      return ws ? JSON.stringify(ws.getSheetValues()) : '';
    };
    record('Accessory sale appears on its own marketplace tab (AMAZON)',
      sheetText('AMAZON').includes('USB-C-20W'), 'searched AMAZON sheet for USB-C-20W');
    record('Accessory sale also appears on the cross-marketplace Accessories sheet',
      sheetText('Accessories').includes('USB-C-20W'), 'searched Accessories sheet');
    record('Sales Report carries the Returns sheets',
      names2.some(n => /returns summary/i.test(n)) && names2.some(n => /returns detail/i.test(n)),
      names2.filter(n => /return/i.test(n)).join(', '));

    // All four return routes must reach the Returns Detail sheet — the
    // three unit outcomes plus the accessory, which has no unit at all and
    // rides there purely on its voided Sale doc.
    const detail = sheetText('Returns Detail');
    record('Returns Detail carries the refunded unit', detail.includes(OFFICE[0].imei), OFFICE[0].imei);
    record('Returns Detail carries the repaired unit', detail.includes(OFFICE[1].imei), OFFICE[1].imei);
    record('Returns Detail carries the replaced unit', detail.includes(OFFICE[2].imei), OFFICE[2].imei);
    // No accessory-return assertions here any more: the manual Return action
    // is gone, so this run never creates one. The Returns Detail sheet still
    // supports accessory rows (they ride in the Model column tagged Return
    // Type = "Accessory") — that path is now exercised only by an imported
    // voided row, which is how it happens in production anyway.
    record('Returns Detail records a Repair outcome', /repair/i.test(detail), 'outcome vocabulary present');
    record('Returns Detail records a Replacement outcome', /replacement/i.test(detail), 'outcome vocabulary present');
  } catch (e) { record('Sales Report download', false, String(e).slice(0, 140)); }

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
