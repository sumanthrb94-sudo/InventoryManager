/**
 * scripts/e2eBulkSale40.mjs — end-to-end proof for the new "Mark Multiple
 * Sold" bulk-sale feature (BulkSaleModal.tsx / recordBulkSales()).
 *
 * Simulates selling 40 units in one sitting through the real UI, mixed
 * across all three sale sources the picker supports:
 *   - 20 office-stock units (status='available')
 *   - 12 SHS units (status='incoming', no IMEI on file yet — the batch
 *     types one in per line, same as SellOrderModal's single-sale flow)
 *   -  8 accessory-pool lines (no IMEI at all)
 *
 * Run in 4 batches of 10 (5 office + 3 SHS + 2 accessory each) through the
 * actual "Mark Multiple Sold" modal, then verifies:
 *   1. Every batch's completion summary reports 10/10 succeeded.
 *   2. The underlying store: units flipped to sold with stockSource
 *      stamped, SHS units carry the typed IMEI, accessory pools decremented.
 *   3. Dashboard's Top 10 Sold / Sales by Platform panels grow to include
 *      the new sales (screenshot before/after).
 *   4. The downloaded Sales Report has all 40 lines spread correctly:
 *      32 unit sales across the 5 marketplace sheets, 8 accessory sales on
 *      the dedicated Accessories sheet — parsed with ExcelJS, not eyeballed.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eBulkSale40.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/bulk-sale-40';
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
function modal(page) { return page.locator('div.fixed.inset-0').last(); }
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Done"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function gotoTab(page, label) {
  await dismissModals(page);
  const re = new RegExp(`^${label}\\b(?! Report)`, 'i');
  for (let attempt = 0; attempt < 5; attempt++) {
    const tab = page.getByRole('button', { name: re }).first();
    if (!(await tab.isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    try {
      await page.getByRole('button', { name: re }).first().click({ timeout: 5000 });
      await page.waitForTimeout(900);
      return;
    } catch {
      await page.waitForTimeout(500);
      if (attempt === 3) await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    }
  }
}
async function gotoAdminSub(page, label) {
  await gotoTab(page, 'Admin');
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await tab.click();
  await page.waitForTimeout(700);
}
async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      inventoryUnits: Object.values(s.inventoryUnits || {}),
      accessoryStock: Object.values(s.accessoryStock || {}),
      sales: Object.values(s.sales || {}),
    };
  });
}

// ── Test dataset: 20 office / 12 SHS / 8 accessory ──────────────────────────

function pad(n, len) { return String(n).padStart(len, '0'); }

const OFFICE_UNITS = Array.from({ length: 20 }, (_, i) => {
  const n = i + 1;
  return {
    id: `bulk-office-${pad(n, 2)}`,
    imei: `999000000${pad(n, 6)}`, // 15 digits, unique
    model: 'IPHONE 13 128GB',
    storage: '128GB',
    colour: n % 2 === 0 ? 'MIDNIGHT' : 'STARLIGHT',
    status: 'available',
    buyPrice: 200 + n,
    dateIn: '2026-07-01',
    supplierId: 'sup-1',
    supplierName: 'MOBILE WHOLESALE LTD',
    flags: [],
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-07-01',
  };
});

// The picker's SHS search matches against `model` and the SUPPLIER NAME
// (looked up via supplierId → the `suppliers` collection, not the unit's
// own supplierName field — see SellSheet.tsx's supplierMap). A tag baked
// into `model` alone isn't reliably searchable: the app's model-catalog
// display normalises free-text model strings down to the recognised
// catalog name (e.g. "IPHONE 12 64GB SHSBULKxx" renders as plain
// "IPHONE 12"), silently dropping the unrecognised suffix. Supplier names
// pass through unnormalised, so each SHS unit gets its OWN supplier doc
// with a unique, searchable name instead.
const SHS_SUPPLIERS = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  return {
    id: `bulk-shs-supplier-${pad(n, 2)}`,
    name: `PHONEBOX BULKSHS${pad(n, 2)}`,
    ownerId: 'shared', createdAt: '2026-01-01', contact: '', notes: '',
  };
});
const SHS_UNITS = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  return {
    id: `bulk-shs-${pad(n, 2)}`,
    imei: '',
    model: 'IPHONE 12',
    storage: '64GB',
    colour: 'BLUE',
    status: 'incoming',
    stockSource: 'shs',
    buyPrice: 300 + n,
    dateIn: '2026-07-05',
    supplierId: SHS_SUPPLIERS[i].id,
    supplierName: SHS_SUPPLIERS[i].name,
    flags: [],
    platformListed: false,
    ownerId: 'shared',
    createdAt: '2026-07-05',
  };
});

const ACCESSORY_SKUS = Array.from({ length: 8 }, (_, i) => {
  const n = i + 1;
  const sku = `BULKACC${pad(n, 2)}`;
  return {
    id: sku.toLowerCase(),
    sku,
    name: `Bulk Test Accessory ${n}`,
    supplierId: 'sup-1',
    supplierName: 'MOBILE WHOLESALE LTD',
    quantity: 5,
    totalReceived: 5,
    buyPrice: 10 + n,
    ownerId: 'shared',
    createdAt: '2026-07-01',
  };
});

const PLATFORMS = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];

// 4 batches of 10 (5 office + 3 shs + 2 accessory each)
const BATCHES = Array.from({ length: 4 }, (_, b) => ({
  office: OFFICE_UNITS.slice(b * 5, b * 5 + 5),
  shs: SHS_UNITS.slice(b * 3, b * 3 + 3),
  accessory: ACCESSORY_SKUS.slice(b * 2, b * 2 + 2),
}));

async function seedExtraStock(page) {
  await page.evaluate(({ office, shs, accessory, shsSuppliers }) => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    const store = raw ? JSON.parse(raw) : {};
    store.inventoryUnits = store.inventoryUnits || {};
    store.accessoryStock = store.accessoryStock || {};
    store.suppliers = store.suppliers || {};
    for (const u of [...office, ...shs]) store.inventoryUnits[u.id] = u;
    for (const a of accessory) store.accessoryStock[a.id] = a;
    for (const s of shsSuppliers) store.suppliers[s.id] = s;
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(store));
  }, { office: OFFICE_UNITS, shs: SHS_UNITS, accessory: ACCESSORY_SKUS, shsSuppliers: SHS_SUPPLIERS });
}

// ── Bulk-sale modal interaction helpers ─────────────────────────────────────

async function openBulkSaleModal(page) {
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /Mark Multiple Sold/i }).click();
  await page.waitForTimeout(500);
}

/**
 * Add a row and fill it, the way the grid works now.
 *
 * Mark Multiple Sold is a spreadsheet since the operator asked for one: type
 * into the Model cell to search STOCK, pick the model, then pick which handset
 * from the IMEI dropdown beside it. Supplier and BP come with the unit — the
 * grid shows them, it does not let you type them, because a hand-typed BP
 * would disagree with the buy record.
 */
const PLATFORM_LABEL = { AMAZON: 'Amazon', BM: 'Back Market', EBAY: 'eBay', ONBUY: 'OnBuy', TEMU: 'Temu' };

/** Every row currently in the grid. */
const gridRows = (page) => modal(page).locator('tbody tr');

async function addRow(page, { search, kind }) {
  const m = modal(page);
  // The first row exists from the start; every one after it needs adding.
  const before = await gridRows(page).count();
  const filled = await m.locator('input[aria-label="Model"]')
    .evaluateAll(els => els.filter(e => e.value.trim()).length);
  if (filled >= before) {
    await m.getByRole('button', { name: /^Add row$/i }).click();
    await page.waitForTimeout(200);
  }
  const row = gridRows(page).last();
  await row.locator('input[aria-label="Model"]').fill(search);
  await page.waitForTimeout(350);
  // Pick by the suggestion's own kind tag rather than by position. Office and
  // SHS stock can share a model name, so "the first hit" silently picked the
  // wrong kind — and the row then rendered the wrong cells, which surfaced 30
  // seconds later as an unrelated timeout instead of as "wrong option".
  // A plain string, so Playwright does a case-insensitive substring match. A
  // regex with \b anchors does NOT work here: the option's textContent runs
  // its spans together ("…20 in stockSTOCK"), so there is no word boundary
  // after the tag to anchor against.
  const wanted = { office: 'stock', shs: 'SHS', accessory: 'pool' }[kind];
  const all = page.locator('div.z-\\[9999\\] button');
  const tagged = all.filter({ hasText: wanted });
  if (!(await tagged.count())) {
    throw new Error(
      `no ${wanted} suggestion for "${search}" — got: ${(await all.allInnerTexts()).join(' | ')}`);
  }
  await tagged.first().click({ timeout: 8000 });
  await page.waitForTimeout(250);
  return row;
}

async function fillRow(page, row, { marketplace, orderNumber, price, imei, unitImei }) {
  // Cells are addressed by aria-label, never by position. Positional lookup
  // was wrong in both directions: the IMEI <select> only exists for an office
  // unit, so "the first select" was Marketplace on some rows and IMEI on
  // others; and Postage's placeholder is the marketplace autofill, which is
  // "0.00" on some tariffs and so collided with the SP cell.
  await row.getByLabel('Marketplace').selectOption(marketplace);
  await page.waitForTimeout(120);
  if (unitImei) {
    // Choose the exact handset among that model's units.
    const imeiSelect = row.locator('select[aria-label="IMEI"]');
    if (await imeiSelect.count() > 0) {
      await imeiSelect.selectOption({ label: new RegExp(unitImei) }).catch(() => {});
    }
  }
  if (imei !== undefined) {
    await row.locator('input[aria-label="IMEI"]').fill(imei);
  }
  await row.getByLabel('Order number').fill(orderNumber);
  await row.getByLabel('Sale price').fill(String(price));
  await page.waitForTimeout(120);
}

async function runBatch(page, batchIndex, batch) {
  await openBulkSaleModal(page);
  let mp = 0;
  const nextPlatform = () => PLATFORMS[(mp++) % PLATFORMS.length];

  for (const u of batch.office) {
    const row = await addRow(page, { search: u.model, kind: 'office' });
    await fillRow(page, row, {
      marketplace: nextPlatform(),
      orderNumber: `BULK-OFF-${u.id.slice(-2)}`,
      price: Math.round(u.buyPrice * 1.5),
      unitImei: u.imei,
    });
  }
  for (const u of batch.shs) {
    // Search the unique supplier tag, NOT the model. Every SHS unit here is an
    // "IPHONE 12", the same model as the office stock, so searching the model
    // returns both and the first hit is the office unit — which already has an
    // IMEI, so the row renders an IMEI <select> and the batch never stamps one.
    // The per-unit supplier names exist precisely to be searchable; see
    // SHS_SUPPLIERS above.
    const tag = u.supplierName.match(/BULKSHS\d+/)[0];
    const row = await addRow(page, { search: tag, kind: 'shs' });
    await fillRow(page, row, {
      marketplace: nextPlatform(),
      orderNumber: `BULK-SHS-${u.id.slice(-2)}`,
      price: Math.round(u.buyPrice * 1.5),
      imei: `888000000${pad(Number(u.id.slice(-2)), 6)}`,
      unitImei: u.imei || undefined,
    });
  }
  for (const a of batch.accessory) {
    const row = await addRow(page, { search: a.name || a.sku, kind: 'accessory' });
    await fillRow(page, row, {
      marketplace: nextPlatform(),
      orderNumber: `BULK-ACC-${a.sku.slice(-2)}`,
      price: Math.round(a.buyPrice * 2),
    });
  }

  await shot(page, `batch${batchIndex}-built`);

  const m = modal(page);
  const confirmBtn = m.getByRole('button', { name: /^Confirm \d+ Sales?$/i });
  await confirmBtn.click();
  await page.waitForTimeout(1200);

  const summaryText = await m.innerText();
  const match = summaryText.match(/(\d+)\s*sold/i);
  const ok = !!match && match[1] === '10' && !/failed/i.test(summaryText);
  record(`batch ${batchIndex}: all 10 sales recorded`, ok,
    (summaryText.match(/\d+ sold[^\n]*/i) ?? [])[0] || summaryText.slice(0, 120));
  await shot(page, `batch${batchIndex}-summary`);

  // Two things are named "Close": the header's X (aria-label) and the done
  // screen's own button. Take the last, which is the footer button.
  await m.getByRole('button', { name: /^Close$/i }).last().click();
  await page.waitForTimeout(600);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  // Google Fonts / Vercel analytics requests are blocked in this sandbox
  // (no network egress to fonts.googleapis.com, no /_vercel/* endpoints on
  // the local vite preview server) — expected noise, not app bugs.
  const BENIGN_CONSOLE = /Failed to load resource.*(net::ERR_CONNECTION_RESET|404)/i;
  page.on('pageerror', e => record('no JS runtime errors', false, e.message));
  page.on('console', msg => {
    if (msg.type() === 'error' && !BENIGN_CONSOLE.test(msg.text())) {
      record('no console errors', false, msg.text());
    }
  });

  // ── Seed: reset to pristine, then append our 40-unit test dataset ────────
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await seedExtraStock(page);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const before = await readStore(page);
  record('seed: 20 office + 12 SHS units, 8 accessory SKUs present',
    before.inventoryUnits.filter(u => u.id?.startsWith('bulk-office-')).length === 20
    && before.inventoryUnits.filter(u => u.id?.startsWith('bulk-shs-')).length === 12
    && before.accessoryStock.filter(a => a.sku?.startsWith('BULKACC')).length === 8);

  await gotoAdminSub(page, 'Overview');
  await shot(page, 'dashboard-before');

  // ── Run all 4 batches through the real "Mark Multiple Sold" UI ──────────
  for (let b = 0; b < BATCHES.length; b++) {
    await runBatch(page, b + 1, BATCHES[b]);
  }

  // ── Verify underlying store ───────────────────────────────────────────
  const after = await readStore(page);
  const officeSold = after.inventoryUnits.filter(u => u.id?.startsWith('bulk-office-'));
  const shsSold = after.inventoryUnits.filter(u => u.id?.startsWith('bulk-shs-'));
  const accAfter = after.accessoryStock.filter(a => a.sku?.startsWith('BULKACC'));

  record('all 20 office units flipped to sold with stockSource=office',
    officeSold.length === 20 && officeSold.every(u => u.status === 'sold' && u.stockSource === 'office'));
  record('all 12 SHS units flipped to sold, IMEI stamped, stockSource=shs',
    shsSold.length === 12 && shsSold.every(u => u.status === 'sold' && u.stockSource === 'shs' && /^\d{15}$/.test(u.imei || '')));
  record('all 8 accessory pools decremented by 1 (5 → 4)',
    accAfter.length === 8 && accAfter.every(a => a.quantity === 4));

  const bulkSales = after.sales.filter(s => (s.orderNumber || '').startsWith('BULK-'));
  record('40 sale docs written for the batch', bulkSales.length === 40, `found ${bulkSales.length}`);
  const accSalesCount = bulkSales.filter(s => !s.imei && s.sku).length;
  const unitSalesCount = bulkSales.filter(s => !!s.imei).length;
  record('32 unit sales + 8 accessory sales among the 40', unitSalesCount === 32 && accSalesCount === 8,
    `unit=${unitSalesCount} accessory=${accSalesCount}`);

  // ── Dashboard reflects the new sales ─────────────────────────────────
  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(800);
  // "Top 10 Sold Products" / "Sales by Platform" are CollapsibleSections
  // with defaultOpen=false — their content isn't rendered in the DOM at
  // all until expanded (AnimatePresence unmounts, not just hides), so the
  // text check below needs them open first.
  for (const title of [/^Top 10 Sold Products/i, /^Sales by Platform/i]) {
    const header = page.getByRole('button', { name: title }).first();
    if (await header.isVisible().catch(() => false)) {
      await header.click();
      await page.waitForTimeout(300);
    }
  }
  await shot(page, 'dashboard-after');
  const dashboardText = await page.locator('body').innerText();
  record('Dashboard mentions the bulk-sold model (IPHONE 13)', /IPHONE 13/i.test(dashboardText));
  record('Dashboard mentions a bulk-sold accessory name', /Bulk Test Accessory/i.test(dashboardText));

  // ── Sales Report reflects all 40 lines correctly ─────────────────────
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(500);
  const reportBtn = page.getByRole('button', { name: /Sales Report/i }).first();
  await reportBtn.click();
  await page.waitForTimeout(500);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    page.getByRole('button', { name: /^All Time$/i }).first().click(),
  ]);
  const dlPath = await download.path();
  await page.waitForTimeout(500);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dlPath);
  const sheetNames = wb.worksheets.map(w => w.name);
  record('workbook has the Accessories sheet', sheetNames.includes('Accessories'), sheetNames.join(', '));

  function countOrdersOnSheet(sheetName, prefix) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return 0;
    let count = 0;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const orderCell = row.getCell(2).text || row.getCell(2).value; // col B = Order Number on marketplace sheets
      if (String(orderCell || '').startsWith(prefix)) count++;
    });
    return count;
  }

  const officeOnSheets = PLATFORMS.reduce((sum, p) => sum + countOrdersOnSheet(p, 'BULK-OFF-'), 0);
  const shsOnSheets = PLATFORMS.reduce((sum, p) => sum + countOrdersOnSheet(p, 'BULK-SHS-'), 0);
  record('all 20 office + 12 SHS bulk sales land on the correct marketplace sheets',
    officeOnSheets === 20 && shsOnSheets === 12, `office=${officeOnSheets} shs=${shsOnSheets}`);

  const accWs = wb.getWorksheet('Accessories');
  let accRows = 0;
  accWs.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const orderCell = row.getCell(3).text || row.getCell(3).value;
    if (String(orderCell || '').startsWith('BULK-ACC-')) accRows++;
  });
  record('all 8 accessory bulk sales land on the dedicated Accessories sheet', accRows === 8, `found ${accRows}`);

  await browser.close();

  console.log('\n── Summary ──');
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exitCode = 1; });
