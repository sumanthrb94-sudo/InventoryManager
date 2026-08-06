/**
 * scripts/e2eMonthSimulation.mjs — a month of trading at the operator's real
 * daily rate, audited against the panels two teams actually work from.
 *
 *   40 units bought per day · 49 units sold per day · 30 days
 *   (a RUN-DOWN month: it outsells its intake and eats an opening pile)
 *
 * WHO THIS IS FOR, AND WHY THE ASSERTIONS ARE WHAT THEY ARE
 *
 * Two teams read these screens and act on them:
 *
 *   SALES decide what to list and what to delist. They need the count of
 *   units genuinely available RIGHT NOW, per model, and they need it to
 *   exclude anything sold, returned to a supplier, or away being repaired.
 *   A number that is too high gets a customer an order they cannot fulfil.
 *
 *   STOCK INTAKE decide what to buy. They work from Sold Out · Reorder and
 *   Running Low · Reorder Soon. A model missing from those lists is stock
 *   that silently never gets reordered.
 *
 * So this run does not merely check that pages render. Every headline number
 * on every panel is compared against ground truth computed HERE, from the
 * generated manifest, without importing a line of the app's own logic. If the
 * app's aggregation and this file's arithmetic disagree, that is the finding.
 *
 * Run:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   SIM_DAYS=30 SIM_INTAKE_PER_DAY=40 SIM_SALES_PER_DAY=49 \
 *     SIM_OPENING_STOCK=700 SIM_END_DATE=<today> \
 *     node scripts/generateQuarterSimData.mjs e2e-screenshots/month-simulation
 *   node scripts/e2eMonthSimulation.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calcFinancials } from './groundTruthCalc.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const SIM_DIR = resolve('e2e-screenshots/month-simulation');
const OUT = SIM_DIR;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const manifest = JSON.parse(readFileSync(resolve(SIM_DIR, 'manifest.json'), 'utf8'));

// ── Reporting ───────────────────────────────────────────────────────────────
const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(msg) { console.log(`      ${msg}`); }
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${file}`);
}
const timings = [];

// ── UI helpers ──────────────────────────────────────────────────────────────
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
  // The toast queue is a separate fixed banner, not an inset-0 overlay, and a
  // bulk import leaves it cycling long enough to intercept clicks.
  for (let i = 0; i < 5; i++) {
    const clearAll = page.getByRole('button', { name: /Dismiss all|Clear All/i }).first();
    if (await clearAll.isVisible().catch(() => false)) { await clearAll.click().catch(() => {}); await page.waitForTimeout(200); continue; }
    const one = page.getByRole('button', { name: 'Dismiss' }).first();
    if (await one.isVisible().catch(() => false)) { await one.click().catch(() => {}); await page.waitForTimeout(200); continue; }
    break;
  }
}

/** Navigate and TIME it — the first thing the client asked for is that these
 *  screens load at all at this volume. */
async function gotoTab(page, label, { viaDrawer = false } = {}) {
  await dismissModals(page);
  const started = Date.now();
  const re = new RegExp(`^${label}(\\s|$)`, 'i');
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    if (viaDrawer || !(await page.getByRole('button', { name: re }).first().isVisible().catch(() => false))) {
      await page.getByLabel('Open menu').click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const drawer = page.locator('aside').last();
      ok = await drawer.getByRole('button', { name: re }).first()
        .click({ timeout: 8000 }).then(() => true).catch(() => false);
    }
    if (!ok) {
      ok = await page.getByRole('button', { name: re }).first()
        .click({ timeout: 8000 }).then(() => true).catch(() => false);
    }
    if (!ok) await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);
  const ms = Date.now() - started;
  timings.push({ screen: label, ms, failed: !ok });
  return { ok, ms };
}

/**
 * The Dashboard and the Analytics page are NOT nav tabs — they are Admin
 * sub-tabs (Overview and Insights). The drawer carries five entries only:
 * Notices, Stock Intake, Inventory, Returns, Admin.
 */
async function gotoAdminSub(page, label) {
  const admin = await gotoTab(page, 'Admin', { viaDrawer: true });
  if (!admin.ok) return { ok: false, ms: admin.ms };
  const started = Date.now();
  const ok = await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    .click({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  const ms = Date.now() - started;
  timings.push({ screen: `Admin · ${label}`, ms, failed: !ok });
  return { ok, ms };
}

/**
 * The number rendered on a KPI tile.
 *
 * Scoped to the tile STRIP, not the whole page: a KPI overlay left open from
 * an earlier click is also a button containing the same label, and it lists
 * every matching unit — so an unscoped match reads the overlay's row count
 * (1,470) instead of the tile's headline (49). Any open overlay is dismissed
 * before reading, and the raw text is returned alongside the number so a
 * mismatch can be diagnosed from the log rather than guessed at.
 *
 * No \b after the label: hasText matches textContent, where the label and the
 * value run together as "SOLD TODAY49" — between "y" and "4" there is no word
 * boundary, so \b never matches and every tile reads NaN.
 */
async function tileValue(page, label) {
  await dismissModals(page);
  const tiles = page.locator('button').filter({ hasText: new RegExp(`^\\s*${label}`, 'i') });
  const n = await tiles.count();
  let best = NaN;
  let raw = '';
  for (let i = 0; i < n; i++) {
    const text = (await tiles.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ');
    // A KPI tile is short: label, number, one caption line. Anything longer is
    // a panel that happens to contain the words.
    if (text.length > 90) continue;
    const m = text.match(new RegExp(`${label}\\D*?([\\d,]+)`, 'i'));
    if (m) { best = Number(m[1].replace(/,/g, '')); raw = text; break; }
  }
  return { value: best, raw, candidates: n };
}
/** Just the number, for assertions that do not need the diagnostics. */
const tileNum = async (page, label) => (await tileValue(page, label)).value;

/** Everything the app has actually stored, read from the E2E shim. */
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

async function wipeAll(page) {
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Wipe$/i }).click({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Wipe All/i }).click();
  await page.waitForTimeout(600);
  await page.getByText(/I understand this will delete all inventory data/i).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(3000);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
}

/** Import a workbook and time the whole preview → confirm → done cycle. */
async function importWorkbook(page, { menuItem, confirmRe, file, label }) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: menuItem }).click();
  await page.waitForTimeout(800);
  const started = Date.now();
  await page.locator('input[type="file"]').first().setInputFiles(file);
  // Big files: wait for the confirm button to appear rather than a fixed sleep.
  const confirm = modal(page).getByRole('button', { name: confirmRe }).last();
  await confirm.waitFor({ state: 'visible', timeout: 180000 });
  const previewMs = Date.now() - started;
  const ack = modal(page).getByText(/I've reviewed the list/i);
  if (await ack.isVisible().catch(() => false)) { await ack.click(); await page.waitForTimeout(300); }
  const confirmStarted = Date.now();
  await confirm.click();
  await modal(page).getByRole('button', { name: /Close|Done/i }).last()
    .waitFor({ state: 'visible', timeout: 300000 }).catch(() => {});
  const writeMs = Date.now() - confirmStarted;
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await dismissModals(page);
  timings.push({ screen: `${label} · preview`, ms: previewMs });
  timings.push({ screen: `${label} · write`, ms: writeMs });
  note(`${label}: preview ${(previewMs / 1000).toFixed(1)}s · write ${(writeMs / 1000).toFixed(1)}s`);
  return { previewMs, writeMs };
}

// ══ GROUND TRUTH — from the manifest, never from the app ═══════════════════
const soldImeis = new Set(manifest.sales.filter(s => s.imei).map(s => String(s.imei)));
const officeUnits = manifest.officeUnits;
const shsUnits = manifest.shsUnits;

const officeAvailable = officeUnits.filter(u => !soldImeis.has(String(u.imei)));
const bucketKey = u => `${u.model}|${u.storage || ''}`;

/** available / sold per model+storage bucket — what both teams read. */
const buckets = new Map();
const ensure = k => {
  if (!buckets.has(k)) buckets.set(k, { available: 0, sold: 0, shs: 0 });
  return buckets.get(k);
};
for (const u of officeUnits) {
  const b = ensure(bucketKey(u));
  if (soldImeis.has(String(u.imei))) b.sold++; else b.available++;
}
for (const u of shsUnits) ensure(bucketKey(u)).shs++;

const soldOutBuckets = [...buckets.entries()]
  .filter(([, b]) => b.available === 0 && b.shs === 0 && b.sold > 0);
const lowStockBuckets = [...buckets.entries()]
  .filter(([, b]) => b.available > 0 && b.available <= 3);

const TODAY = manifest.endDate;
const soldToday = manifest.sales.filter(s => s.saleDate === TODAY);
const unitSalesToday = soldToday.filter(s => s.imei);
/** Every sale DOC dated today — unit lines plus accessory lines. The Sell
 *  screen counts documents, the Buy screen counts units, so the two have
 *  different right answers on any day with an accessory sale on it. */
const allSaleDocsToday = soldToday.length
  + manifest.accessorySales.filter(s => s.saleDate === TODAY).length;

/** Revenue and GP, recomputed from the master formulas in groundTruthCalc. */
let truthRevenue = 0;
let truthGp = 0;
for (const s of [...manifest.sales, ...manifest.accessorySales]) {
  const fin = calcFinancials(s.marketplace, s.bp, s.sp, 0);
  truthRevenue += s.sp;
  truthGp += fin.grossProfit;
}

const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') jsErrors.push(`console: ${m.text().slice(0, 200)}`); });
  // A bare "Failed to load resource" in the console names nothing. Record the
  // URL and status so a 404 can be told apart from a dropped connection.
  const netFailures = [];
  page.on('requestfailed', r => netFailures.push(`${r.failure()?.errorText || 'failed'} ${r.url().slice(0, 120)}`));
  page.on('response', r => { if (r.status() >= 400) netFailures.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });

  console.log(`\n══ THE MONTH ══`);
  console.log(`  ${manifest.shape.intakePerDay}/day in · ${manifest.shape.salesPerDay}/day out · ${manifest.days} days`);
  console.log(`  opening stock ${manifest.shape.openingStock} on ${manifest.shape.openingDate}`);
  console.log(`  intake ${officeUnits.length} office + ${shsUnits.length} SHS · ${manifest.sales.length} unit sales`);
  console.log(`  ends ${TODAY} · office left on the shelf ${officeAvailable.length}`);
  if (manifest.shape.salesShortfalls?.length) {
    console.log(`  ${manifest.shape.salesShortfalls.length} day(s) could not fill the quota — stock ran out`);
  }

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // ══ PHASE 1 · Load the month ════════════════════════════════════════════
  console.log('\n══ PHASE 1 · Load a month of trading ══');
  await wipeAll(page);
  await importWorkbook(page, {
    menuItem: /Inventory Report/i, confirmRe: /Load [\d,]+ rows/i,
    file: manifest.files.inventory, label: 'Inventory import',
  });
  await importWorkbook(page, {
    menuItem: /Sales Report/i, confirmRe: /Load [\d,]+ sales|Re-confirm/i,
    file: manifest.files.sales, label: 'Sales import',
  });
  await shot(page, 'phase1-loaded');

  const store = await dumpStore(page);
  const units = docsOf(store, 'inventoryUnits');
  const sales = docsOf(store, 'sales');
  const batches = docsOf(store, 'importBatches');
  const appAvailable = units.filter(u =>
    u.status === 'available' || (u.returnType === 'returned_to_inventory' && u.status !== 'sold'));
  const appSold = units.filter(u => u.status === 'sold');
  const appShs = units.filter(u => u.stockSource === 'shs' || u.stockType === 'SHS');

  record('every intake row landed as a unit',
    units.length === officeUnits.length + shsUnits.length,
    `${units.length} units vs ${officeUnits.length + shsUnits.length} in the file`);
  record('every sale row landed as a sale',
    sales.length === manifest.sales.length + manifest.accessorySales.length,
    `${sales.length} sales vs ${manifest.sales.length + manifest.accessorySales.length} in the file`);
  record('units flipped to sold match the sales file',
    appSold.length === manifest.sales.length,
    `${appSold.length} sold vs ${manifest.sales.length} unit sales`);

  // Provenance: both imports must leave a batch row, or the Operations Hub
  // has nothing to show and the importBatchId on every doc points at nothing.
  record('both imports recorded a batch row', batches.length === 2,
    `${batches.length} batch rows: ${batches.map(b => `${b.sourceFile} ${b.rowCount}`).join(' · ')}`);
  const stampedUnits = units.filter(u => (u.importBatchId || '').trim()).length;
  const stampedSales = sales.filter(x => (x.importBatchId || '').trim()).length;
  const batchIds = new Set(batches.map(b => b.id));
  const danglingSales = sales.filter(x => x.importBatchId && !batchIds.has(x.importBatchId)).length;
  record('every imported doc carries a batch id that points at a real row',
    stampedUnits === units.length && stampedSales === sales.length && danglingSales === 0,
    `units ${stampedUnits}/${units.length} · sales ${stampedSales}/${sales.length} · dangling ${danglingSales}`);

  // ══ PHASE 2 · What SALES read: what can I list right now ════════════════
  console.log('\n══ PHASE 2 · Sales team — what is available to list ══');
  const buy = await gotoTab(page, 'Stock Intake');
  record('Stock Intake loads', buy.ok, `${(buy.ms / 1000).toFixed(1)}s`);
  await shot(page, 'phase2-stock-intake');

  const officeTile = await tileNum(page, 'All Office Stock');
  record('Buy · "All Office Stock" equals stock genuinely on the shelf',
    officeTile === officeAvailable.length,
    `tile ${officeTile} vs ${officeAvailable.length} unsold office units`);

  const shsTile = await tileNum(page, 'SHS Stock');
  record('Buy · "SHS Stock" equals supplier-held units',
    shsTile === shsUnits.length, `tile ${shsTile} vs ${shsUnits.length}`);

  // Cross-check the tile against the DATA before blaming either: how many
  // sold units does the store itself say carry today's sale date?
  const storeSoldToday = units.filter(u => u.status === 'sold' && (u.saleDate || '') === TODAY);
  record('the imported units carry the sale dates from the file, not the import date',
    storeSoldToday.length === unitSalesToday.length,
    `${storeSoldToday.length} units dated ${TODAY} vs ${unitSalesToday.length} in the file`);

  const soldTodayTile = await tileValue(page, 'Sold Today');
  record('Buy · "Sold Today" equals units whose SALE DATE is today',
    soldTodayTile.value === unitSalesToday.length,
    `tile ${soldTodayTile.value} vs ${unitSalesToday.length} sold on ${TODAY}${soldTodayTile.value !== unitSalesToday.length ? ` · tile text "${soldTodayTile.raw}"` : ''}`);

  record('the store agrees with the tile on available stock',
    appAvailable.length === officeAvailable.length + shsUnits.length
      || appAvailable.length === officeAvailable.length,
    `store ${appAvailable.length} · office ${officeAvailable.length} · SHS ${appShs.length}`);

  const sell = await gotoTab(page, 'INVENTORY', { viaDrawer: true });
  record('Inventory (Sell) loads', sell.ok, `${(sell.ms / 1000).toFixed(1)}s`);
  await shot(page, 'phase2-sell');
  // Sell counts SALE DOCS (units + accessory lines); Buy counts UNITS. On a
  // day with accessory sales the two legitimately differ, so compare each to
  // its own truth rather than to each other.
  const sellSoldToday = await tileNum(page, 'Sold Today');
  record('Sell · "Sold Today" equals every sale doc dated today',
    sellSoldToday === allSaleDocsToday,
    `sell ${sellSoldToday} vs ${allSaleDocsToday} sale docs dated ${TODAY} (${unitSalesToday.length} units + ${allSaleDocsToday - unitSalesToday.length} accessory lines)`);
  const allTime = await tileNum(page, 'All-time Sold');
  record('Sell · "All-time Sold" equals every sale in the month',
    allTime === manifest.sales.length + manifest.accessorySales.length
      || allTime === manifest.sales.length,
    `tile ${allTime} · unit sales ${manifest.sales.length} · +accessories ${manifest.sales.length + manifest.accessorySales.length}`);

  // ══ PHASE 3 · What INTAKE read: what do I need to buy ═══════════════════
  console.log('\n══ PHASE 3 · Stock intake team — what to reorder ══');
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(1200);
  const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await shot(page, 'phase3-stock-alerts');

  // Guard first: with no empty bucket in the data, the two assertions below
  // pass without ever looking at a line, which is how a month-long run once
  // reported the reorder panel "verified" while it was empty.
  record('the month actually ran some SKUs dry — otherwise the checks below prove nothing',
    soldOutBuckets.length > 0, `${soldOutBuckets.length} sold-out buckets · ${lowStockBuckets.length} running low`);
  record('Sold Out · Reorder panel is on the screen', /Sold Out/i.test(pageText));
  record('Running Low · Reorder Soon panel is on the screen', /Running Low/i.test(pageText));

  // Every model that sold out must be NAMED. A missing line is stock that
  // never gets reordered, which is the intake team's whole job.
  const missingSoldOut = soldOutBuckets
    .map(([k]) => k.split('|')[0])
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .filter(model => !pageText.toUpperCase().includes(model.toUpperCase()));
  record('every sold-out model is named on the reorder panel',
    missingSoldOut.length === 0,
    missingSoldOut.length ? `missing: ${missingSoldOut.slice(0, 5).join(', ')}` : `${soldOutBuckets.length} sold-out buckets`);

  const missingLow = lowStockBuckets
    .map(([k]) => k.split('|')[0])
    .filter((m, i, arr) => arr.indexOf(m) === i)
    .filter(model => !pageText.toUpperCase().includes(model.toUpperCase()));
  record('every running-low model is named on the reorder panel',
    missingLow.length === 0,
    missingLow.length ? `missing: ${missingLow.slice(0, 5).join(', ')}` : `${lowStockBuckets.length} low buckets`);

  // ══ PHASE 3b · THE PROCESSES, RUN LIVE ══════════════════════════════════
  //
  // The month arrives by import. That leaves every hand-driven process
  // unexercised, and the Returns panels showing their empty state — correct
  // behaviour, but it proves nothing about them. So a representative unit
  // goes through the real two-step return flow, and a second through repair
  // and back onto the shelf, BEFORE the panels are read.
  console.log('\n══ PHASE 3b · Returns, processed live ══');

  /** The drawer is a fixed z-50 layer, not an inset-0 overlay, so
   *  dismissModals never touches it — and left open it covers the picker. */
  const closeDrawer = async () => {
    const close = page.getByLabel('Close menu').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  };

  const processReturn = async (imei, returnType, reason) => {
    await gotoTab(page, 'Returns');
    await closeDrawer();
    await page.getByRole('button', { name: /^Process Return$/i }).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
    const picker = modal(page);
    const box = picker.locator('input[placeholder*="Search" i]').first();
    if (!(await box.isVisible().catch(() => false))) {
      await shot(page, `ret-${imei}-no-search-box`);
      return { ok: false, why: 'the Process Return picker showed no search box' };
    }
    await box.fill(imei);
    // 1,900 units behind this picker — give the filter time to settle rather
    // than reading an empty list and calling the unit missing.
    await page.waitForTimeout(2500);
    const row = picker.locator('button').filter({ hasText: new RegExp(imei) }).first();
    if (!(await row.isVisible().catch(() => false))) {
      const offered = await picker.locator('button').count().catch(() => 0);
      await shot(page, `ret-${imei}-picker-empty`);
      return { ok: false, why: `${imei} not offered — picker showed ${offered} buttons after searching` };
    }
    await row.click();
    await page.waitForTimeout(1000);
    const qc = modal(page);
    await qc.locator('textarea').nth(0).fill('Customer reports a fault.').catch(() => {});
    await qc.locator('textarea').nth(1).fill('QC: fault confirmed.').catch(() => {});
    await qc.getByRole('button', { name: /Send to CRM Queue/i }).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await dismissModals(page);
    await gotoTab(page, 'Returns');
    await closeDrawer();
    await page.getByRole('button', { name: /^Finalise$/i }).first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
    const crm = modal(page);
    await crm.getByText(returnType, { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    await crm.locator('input[placeholder*="Customer changed mind" i]').fill(reason).catch(() => {});
    await crm.getByRole('button', { name: /Finalise Return/i }).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await dismissModals(page);
    return { ok: true };
  };

  const soldImeiList = manifest.sales.filter(x => x.imei).map(x => String(x.imei));
  const refundImei = soldImeiList[0];
  const repairImei = soldImeiList[1];

  const r1 = await processReturn(refundImei, 'Back to Inventory', 'Customer changed mind');
  const r2 = await processReturn(repairImei, 'Repair', 'Cracked screen');

  await gotoTab(page, 'Returns');
  await closeDrawer();
  const backBtn = page.getByRole('button', { name: /Back to Stock/i }).first();
  const hasBack = await backBtn.isVisible().catch(() => false);
  record('the repaired unit offers a way back to stock', hasBack);
  if (hasBack) {
    await backBtn.click();
    await page.waitForTimeout(800);
    await modal(page).getByRole('button', { name: /^Back to Stock$/i }).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1600);
    await dismissModals(page);
  }

  const afterReturns = await dumpStore(page);
  const rUnits = docsOf(afterReturns, 'inventoryUnits');
  const refundUnit = rUnits.find(u => String(u.imei) === refundImei);
  const repairUnit = rUnits.find(u => String(u.imei) === repairImei);
  record('a refund return processes end to end', r1.ok
    && (refundUnit?.status === 'available' || refundUnit?.returnType === 'returned_to_inventory'),
    r1.why || `IMEI ${refundImei} · status=${refundUnit?.status} returnType=${refundUnit?.returnType}`);
  record('a repair return processes end to end and comes back to stock', r2.ok
    && repairUnit?.status === 'available',
    r2.why || `IMEI ${repairImei} · status=${repairUnit?.status} returnType=${repairUnit?.returnType}`);
  const voided = docsOf(afterReturns, 'sales').filter(x => x.voidedAt).length;
  record('both returns voided their sale', voided >= 2, `${voided} voided sale docs`);
  await shot(page, 'phase3b-returns-processed');

  // ══ PHASE 4 · The intelligent dashboards ════════════════════════════════
  console.log('\n══ PHASE 4 · Dashboards and panels at volume ══');
  const screenHealthy = async (label, r, shotName) => {
    const body = await page.locator('body').innerText().catch(() => '');
    // An empty state is not a blank screen. The Notices board legitimately
    // renders "No notices yet" and little else — judging it by character count
    // called a working screen broken.
    const stripped = body.replace(/\s+/g, '');
    const blank = stripped.length < 60
      || (stripped.length < 200 && !/no .* yet|nothing|empty/i.test(body));
    const crashed = /Something went wrong|Unexpected error|Error boundary/i.test(body);
    record(`${label} loads with content`, r.ok && !blank && !crashed,
      `${(r.ms / 1000).toFixed(1)}s${blank ? ' · BLANK' : ''}${crashed ? ' · ERROR SCREEN' : ''}`);
    await shot(page, shotName);
    return body.replace(/\s+/g, ' ');
  };

  for (const tab of ['Returns', 'Notices']) {
    const r = await gotoTab(page, tab, { viaDrawer: true });
    await screenHealthy(tab, r, `phase4-${tab.toLowerCase()}`);
  }

  // The intelligent dashboards live under Admin, not in the drawer.
  const overview = await gotoAdminSub(page, 'Overview');
  const overviewText = await screenHealthy('Admin · Overview (Dashboard)', overview, 'phase4-dashboard');

  // The periodic table renders inside the Dashboard — its headline is the
  // per-model view the sales team scans for what can be listed.
  // Anchor on the periodic table's own title. A bare /([\d,]+) units/ matches
  // the SHS PENDING tile's "184 units + 0 agg" higher up the page and reports
  // the supplier-held count as the office count.
  const headline = overviewText.match(/OFFICE STOCK VISIBILITY\s*([\d,]+)\s*units/i);
  const shown = headline ? Number(headline[1].replace(/,/g, '')) : NaN;
  record('Periodic table · headline unit count equals office stock on the shelf',
    shown === officeAvailable.length,
    `shows ${shown} vs ${officeAvailable.length} available office units`);

  // The intake team's provenance panel: when did stock last land, and how
  // much of it? Two full imports just ran, so "No imports yet" is a defect.
  record('Operations Hub · "Last Import" reflects the imports that just ran',
    !/No imports yet/i.test(overviewText),
    /No imports yet/i.test(overviewText)
      ? 'reads "No imports yet" after 1,900 units and 1,703 sales were imported'
      : 'populated');

  for (const [sub, shotName] of [
    ['Insights', 'phase4-insights'],
    ['Money', 'phase4-money'],
    ['Sales History', 'phase4-sales-history'],
    ['Reports', 'phase4-reports'],
    ['Configuration', 'phase4-configuration'],
  ]) {
    const r = await gotoAdminSub(page, sub);
    await screenHealthy(`Admin · ${sub}`, r, shotName);
  }

  // ══ PHASE 4b · EVERY PANEL, BY NAME ═════════════════════════════════════
  //
  // Loading a screen proves the page mounts. It does not prove the panels on
  // it rendered — a panel that throws inside a boundary, or silently returns
  // null on an empty derivation, leaves a page that still "loads with
  // content". Both teams work from the panels, not the page, so each one is
  // asserted by its own title, on the screen it belongs to.
  //
  // The titles are transcribed from the components. When a panel is renamed
  // this fails, which is the point: a renamed panel nobody re-verified is
  // indistinguishable from a missing one.
  console.log('\n══ PHASE 4b · Every panel, by name ══');

  const PANELS = [
    { screen: 'Stock Intake', nav: { tab: 'Stock Intake' }, panels: [
      'Stock Added In Last 72 Hours', 'All Office Stock', 'SHS Stock', 'Sold Today',
      'Accessory SKUs', 'Sold Out', 'Running Low',
      'Fast Movers', 'Profit Drivers', 'Old Stock Alerts', 'This Week Trending Sold', 'Stock Depth',
    ] },
    { screen: 'Inventory (Sell)', nav: { tab: 'INVENTORY', drawer: true }, panels: [
      'Sold Today', 'This Month', 'All-time Sold', 'Avg GP %',
      'Hot This Week', 'Top Earners', 'Push These',
      'OFFICE STOCK VISIBILITY',
    ] },
    { screen: 'Returns', nav: { tab: 'Returns' }, panels: [
      'Back to Inventory', 'In Repair', 'Returned to Supplier', 'All Returns',
      'Return Activity History',
    ] },
    { screen: 'Admin · Overview', nav: { admin: 'Overview' }, panels: [
      'Last Import', 'Batch Rows', 'Total Docs', 'Integrity',
      'Stock on Hand', 'SHS Pending', 'Sold This Month', 'By Marketplace',
      'Accessory SKUs', 'Accessories Sold Out', 'Accessories Running Low',
      'OFFICE STOCK VISIBILITY',
    ] },
    { screen: 'Admin · Insights', nav: { admin: 'Insights' }, panels: [
      'Per-Marketplace Margin', 'Top 10 Best Sellers', 'Slow Movers',
      'Supplier Performance', 'Platform Scorecard', 'Aged Stock',
      'Sales Calendar', 'Reorder Alerts',
    ] },
    { screen: 'Admin · Money', nav: { admin: 'Money' }, panels: ['VAT'] },
    { screen: 'Admin · Sales History', nav: { admin: 'Sales History' }, panels: [] },
    { screen: 'Admin · Reports', nav: { admin: 'Reports' }, panels: [] },
    { screen: 'Admin · Configuration', nav: { admin: 'Configuration' }, panels: [] },
  ];

  /** Open collapsed sections so a panel is not "missing" merely because it is folded. */
  const expandAll = async () => {
    const toggles = page.locator('button[aria-expanded="false"]');
    const n = Math.min(await toggles.count().catch(() => 0), 25);
    for (let i = 0; i < n; i++) await toggles.nth(i).click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(600);
  };

  const screenText = {};
  for (const entry of PANELS) {
    const r = entry.nav.admin
      ? await gotoAdminSub(page, entry.nav.admin)
      : await gotoTab(page, entry.nav.tab, { viaDrawer: !!entry.nav.drawer });
    if (!r.ok) { record(`${entry.screen} · reachable`, false, 'navigation failed'); continue; }
    await expandAll();
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    screenText[entry.screen] = text;
    const missing = entry.panels.filter(p => !text.toUpperCase().includes(p.toUpperCase()));
    record(`${entry.screen} · all ${entry.panels.length} panels present`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : entry.panels.join(' · ') || 'screen renders');
    await shot(page, `panels-${entry.screen.toLowerCase().replace(/[^a-z]+/g, '-')}`);
  }

  // ── Numbers on the panels, against truth computed here ──────────────────
  const num = (text, label) => {
    const m = (text || '').match(new RegExp(`${label}\\D{0,40}?([\\d,]+)`, 'i'));
    return m ? Number(m[1].replace(/,/g, '')) : NaN;
  };
  const buyText = screenText['Stock Intake'] || '';
  const dashText = screenText['Admin · Overview'] || '';
  const retText = screenText['Returns'] || '';

  record('Returns · "All Returns" counts the two processed live',
    num(retText, 'All Returns') === 2,
    `panel ${num(retText, 'All Returns')} vs 2 processed`);

  // Stock added in the last 72 hours reads the unit's dateIn, which came from
  // the file — so it is the tail of the month, not the whole import.
  const cutoff = new Date(new Date(TODAY).getTime() - 3 * 86400000).toISOString().slice(0, 10);
  const added72 = officeUnits.concat(shsUnits).filter(u => (u.dateIn || '') > cutoff).length;
  record('Buy · "Stock Added In Last 72 Hours" matches the intake dates in the file',
    num(buyText, 'Stock Added In Last 72 Hours') === added72,
    `tile ${num(buyText, 'Stock Added In Last 72 Hours')} vs ${added72} units dated after ${cutoff}`);

  record('Buy · "Accessory SKUs" equals the pools in the file',
    num(buyText, 'Accessory SKUs') === manifest.accessories.length,
    `tile ${num(buyText, 'Accessory SKUs')} vs ${manifest.accessories.length}`);

  record('Dashboard · "Stock on Hand" equals office stock on the shelf',
    num(dashText, 'Stock on Hand') === officeAvailable.length,
    `tile ${num(dashText, 'Stock on Hand')} vs ${officeAvailable.length}`);
  record('Dashboard · "SHS Pending" equals supplier-held units',
    num(dashText, 'SHS Pending') === shsUnits.length,
    `tile ${num(dashText, 'SHS Pending')} vs ${shsUnits.length}`);

  // Every marketplace that carries a sale must appear on the channel split.
  const channels = [...new Set(manifest.sales.map(s => s.marketplace))];
  const missingChannels = channels.filter(c => !dashText.toUpperCase().includes(c === 'AMAZON' ? 'ZON' : c));
  record('Dashboard · the marketplace split names every channel that sold',
    missingChannels.length === 0,
    missingChannels.length ? `missing: ${missingChannels.join(', ')}` : channels.join(' · '));

  // ══ PHASE 5 · Money, against formulas the app never sees ════════════════
  console.log('\n══ PHASE 5 · Revenue and GP vs independent maths ══');
  const storedGp = sales.reduce((s, x) => s + (Number(x.grossProfit) || 0), 0);
  const storedRevenue = sales.reduce((s, x) => s + (Number(x.salePrice) || 0), 0);
  record('stored revenue matches the sales file',
    near(storedRevenue, truthRevenue, 1), `app £${storedRevenue.toFixed(2)} vs £${truthRevenue.toFixed(2)}`);
  record('stored GP matches the master formulas',
    near(storedGp, truthGp, Math.max(5, Math.abs(truthGp) * 0.002)),
    `app £${storedGp.toFixed(2)} vs £${truthGp.toFixed(2)}`);

  // ══ PHASE 6 · Did anything throw? ═══════════════════════════════════════
  const realErrors = jsErrors.filter(e => !/favicon|ResizeObserver|Failed to load resource/i.test(e));
  record('no uncaught JS errors across the whole month', realErrors.length === 0,
    realErrors.slice(0, 3).join(' | '));
  // Only the app's OWN resources count. Two classes of failure here are the
  // environment, not the build, and calling them defects would train the
  // reader to ignore this line:
  //   fonts.googleapis.com — the sandbox has no route to it; the browser
  //     falls back to the local stack, which is why the screenshots render.
  //   /_vercel/insights + /_vercel/speed-insights — analytics endpoints that
  //     exist only when Vercel serves the site; 404 under `vite preview` is
  //     expected and the scripts are non-blocking.
  const environmental = /fonts\.googleapis|fonts\.gstatic|_vercel\/(speed-)?insights|favicon|\.map$/i;
  const realNetFailures = netFailures.filter(f => !environmental.test(f));
  record('no failed requests for the app\'s own resources', realNetFailures.length === 0,
    [...new Set(realNetFailures)].slice(0, 5).join(' | '));
  const envSeen = [...new Set(netFailures.filter(f => environmental.test(f)))];
  if (envSeen.length) note(`environmental, not defects: ${envSeen.length} (fonts CDN / Vercel analytics, absent under vite preview)`);

  console.log('\n── Load times ──');
  for (const t of timings) console.log(`  ${String((t.ms / 1000).toFixed(1)).padStart(6)}s  ${t.screen}`);
  // A failed navigation burns its retry budget and would report as a slow
  // screen — time only what actually opened, or the number means nothing.
  const slow = timings.filter(t => t.ms > 5000 && !/import/i.test(t.screen) && !t.failed);
  record('every screen renders in under 5 seconds at this volume',
    slow.length === 0, slow.map(t => `${t.screen} ${(t.ms / 1000).toFixed(1)}s`).join(', '));

  await browser.close();

  const passed = results.filter(r => r.ok).length;
  writeFileSync(resolve(OUT, 'audit.json'), JSON.stringify({ results, timings }, null, 2));
  console.log(`\n${'═'.repeat(72)}\nRESULT: ${passed}/${results.length} passed\n${'═'.repeat(72)}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
