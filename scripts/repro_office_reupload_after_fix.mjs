/**
 * repro_office_reupload_after_fix.mjs — reproduces the operator's exact
 * production scenario against the fixed app.
 *
 * The operator's real SHS workflow: a supplier-held listing starts with NO
 * IMEI (they can list and sell before the supplier ships). Only when it
 * actually SELLS does the supplier confirm which physical unit — and its
 * IMEI — fulfilled the order. At that point the unit becomes status='sold',
 * stockSource='shs', now carrying that IMEI (see e2eShsOrphanFlow.mjs,
 * which drives that exact completion end to end). So the 6 units this
 * office report collided with in production are units that already SOLD
 * via an SHS listing — not still-open holdings.
 *
 * This seeds that exact shape directly into the E2E store (the same shape
 * addSoldUnitFromSale/completeUnitBuyInfo produce — the completion path
 * itself is already covered by e2eShsOrphanFlow.mjs, 14/14 passing) plus a
 * handful of genuine office units, then:
 *
 *   1. Wipe Office Stock ONLY (the scoped button, not Wipe All)
 *   2. Re-upload the same converted Office_Stock_26TH_JULY_CONVERTED.xlsx
 *   3. Screenshot the preview
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/repro_office_reupload_after_fix.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/office-reupload-after-fix';
const OFFICE_FILE = path.resolve(OUT, 'Office_Stock_26TH_JULY_CONVERTED.xlsx');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
let shotIndex = 0;
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}

// The 6 IMEIs the production office report collided with — already sold
// through an SHS listing before this report ever arrived.
const SOLD_VIA_SHS = [
  { imei: '356427677484680', model: 'Apple iPhone 12 64GB',        colour: 'Midnight', bp: 140, supplierName: 'MHL' },
  { imei: '350686132218258', model: 'Samsung Galaxy S21 5G 128GB', colour: 'Phantom Grey', bp: 118, supplierName: 'MHL' },
  { imei: '358822630018948', model: 'Samsung Galaxy S21 5G 128GB', colour: 'Phantom Grey', bp: 118, supplierName: 'MHL' },
  { imei: 'KLQ2W2TTWR',       model: 'Apple iPad 11 WiFi 128GB',    colour: 'Pink', bp: 285, supplierName: 'MHL' },
  { imei: 'MW2QFY2JHW',       model: 'Apple iPad 11 WiFi 128GB',    colour: 'Pink', bp: 285, supplierName: 'MHL' },
  { imei: '359043378515347', model: 'Samsung Galaxy S21FE 5G 64GB', colour: 'Graphite', bp: 112, supplierName: 'MHL' },
];

// A handful of genuine pre-existing OFFICE units, so "Wipe Office Stock"
// actually has something to clear — matching the operator's real "I had
// office stock, wiped it, then re-uploaded" sequence.
const PRE_EXISTING_OFFICE = Array.from({ length: 8 }, (_, i) => ({
  imei: `35100000000${String(i).padStart(4, '0')}`,
  model: 'Samsung Galaxy A13 64GB',
  colour: 'Black',
  bp: 65,
  supplierName: 'IMAX',
}));

function seedDoc(u, { sold }) {
  const base = {
    id: `unit_seed_${u.imei}`,
    imei: u.imei,
    model: u.model,
    brand: u.model.split(' ')[0],
    category: 'phone',
    colour: u.colour,
    buyPrice: u.bp,
    dateIn: '2026-06-01',
    supplierId: `sup_${u.supplierName.toLowerCase()}`,
    supplierName: u.supplierName,
    flags: [],
    platformListed: false,
    ownerId: 'shared',
  };
  return sold
    ? { ...base, status: 'sold', stockSource: 'shs', salePrice: u.bp + 60, saleDate: '2026-07-10' }
    : { ...base, status: 'available', stockSource: 'office' };
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // ── Seed directly into the E2E Firestore shim's store ────────────────────
  await page.evaluate(({ soldUnits, officeUnits, supplierName }) => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    const store = raw ? JSON.parse(raw) : {};
    // Replace the default E2E seed's units entirely — this demo's counts
    // (create/update/conflict) need to be exact, not mixed with unrelated
    // seed inventory (Apple IPHONE 12/13/14/15 etc.) from a fresh e2eReset.
    store.inventoryUnits = {};
    for (const u of soldUnits) store.inventoryUnits[u.id] = u;
    for (const u of officeUnits) store.inventoryUnits[u.id] = u;
    store.sales = {};
    store.suppliers = {};
    const supId = `sup_${supplierName.toLowerCase()}`;
    store.suppliers[supId] = { id: supId, name: supplierName, portal: 'Direct', ownerId: 'shared' };
    const imaxId = 'sup_imax';
    store.suppliers[imaxId] = { id: imaxId, name: 'IMAX', portal: 'Direct', ownerId: 'shared' };
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(store));
  }, {
    soldUnits: SOLD_VIA_SHS.map(u => seedDoc(u, { sold: true })),
    officeUnits: PRE_EXISTING_OFFICE.map(u => seedDoc(u, { sold: false })),
    supplierName: 'MHL',
  });

  // Plain reload (no e2eReset=1) — that param forces ensureSeeded() to
  // ignore sessionStorage and re-seed from E2E_SEED, which would silently
  // discard the data we just injected.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Stock Intake/i }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'dashboard-before-wipe');

  // ── 1. Wipe OFFICE STOCK ONLY — the scoped button, not Wipe All ──────────
  await page.getByRole('button', { name: /^Wipe$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /Wipe Office Stock/i }).click();
  await page.waitForTimeout(500);
  await shot(page, 'wipe-office-stock-only-modal');
  await page.getByRole('checkbox', { name: /I understand this deletes all in-office stock/i }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /^Wipe Office Stock$/i }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'wipe-office-stock-only-done');
  await page.getByRole('button', { name: /^Close$/i }).click().catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, 'dashboard-after-office-only-wipe');

  // ── 2. Re-upload the same converted Office Stock Excel ───────────────────
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
  await fileChooser.setFiles(OFFICE_FILE);
  await page.waitForTimeout(1400);
  await shot(page, 'reupload-preview-after-fix');

  // Scroll to the bucket-conflicts panel and grab a tight crop of it too.
  const panel = page.locator('text=/Skipped .* different bucket/i').first();
  if (await panel.isVisible().catch(() => false)) {
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, 'reupload-preview-conflicts-panel-in-view');
  }

  async function valueFor(label) {
    const tile = page.locator(`text=${label}`).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const txt = await tile.locator('p.text-2xl').innerText();
    return parseInt(txt.replace(/,/g, ''), 10);
  }
  const stats = {
    toCreate: await valueFor('To create'),
    toUpdate: await valueFor('To update'),
    invalid: await valueFor('Invalid'),
  };
  console.log('Re-upload preview stats (after the bucket-scope fix):', JSON.stringify(stats));

  await ctx.close();
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
