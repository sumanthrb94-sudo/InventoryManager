/**
 * scripts/e2eBatchVsMarketplace.mjs — two ways in, one state out; then back.
 *
 * Marketplaces send their reports separately, but the app also accepts a
 * combined four-sheet workbook. Those are two different code paths into the
 * same reconciliation, and if they disagree the operator's numbers depend on
 * which file they happened to be handed that morning. So:
 *
 *   Pass A  wipe → 120-row inventory → the COMBINED sales workbook
 *   Pass B  wipe → 120-row inventory → the SAME rows, four separate uploads
 *           (AMAZON, BM, EBAY, ONBUY), each with the marketplace picker set
 *   Compare A and B unit for unit, sale for sale.
 *
 * Then the question the operator actually asked — can I get back here from
 * the files I download?
 *
 *   Pass C  download the Inventory Report, wipe, re-upload it
 *   Pass D  re-upload the downloaded Sales Report on top
 *
 * State is read from the E2E store itself, not scraped from KPI tiles, so a
 * mismatch points at a unit id rather than at a number on a card.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eBatchVsMarketplace.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/batch-vs-marketplace';
const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const COMBINED_SALES = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');
const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY'];
const PER_MARKET_FILE = (m) => resolve(`templates/samples/SALES_${m}_SAMPLE.xlsx`);

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

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
  return page.locator('div.fixed.inset-0[class*="z-["]').last();
}

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
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
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(900);
}

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

// ── State, read from the store rather than the screen ────────────────────────

/**
 * The whole E2E Firestore, as the app left it. Reading this instead of KPI
 * tiles means a mismatch names the unit that diverged, not a tile that reads
 * "27" when it should read "28".
 */
async function readStore(page) {
  return page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('__e2e_firestore__');
      if (!raw) return null;
      const store = JSON.parse(raw);
      const units = Object.values(store.inventoryUnits || {});
      const sales = Object.values(store.sales || {});
      return { units, sales };
    } catch { return null; }
  });
}

/** A comparable summary of where the business stands. */
function fingerprint(db) {
  const units = db?.units ?? [];
  const sales = db?.sales ?? [];
  const office = units.filter(u => u.status === 'available' || u.returnType === 'returned_to_inventory')
    .filter(u => u.status !== 'sold' && u.returnType !== 'returned_to_supplier');
  const shs = units.filter(u => u.status === 'incoming');
  const sold = units.filter(u => u.status === 'sold');
  const perMarket = {};
  for (const s of sales) perMarket[s.marketplace] = (perMarket[s.marketplace] ?? 0) + 1;
  const money = (n) => Math.round((n ?? 0) * 100) / 100;
  return {
    officeCount: office.length,
    shsCount: shs.length,
    soldCount: sold.length,
    saleCount: sales.length,
    perMarket,
    revenue: money(sales.reduce((a, s) => a + (Number(s.salePrice) || 0), 0)),
    cost: money(sales.reduce((a, s) => a + (Number(s.buyPrice) || 0), 0)),
    officeImeis: new Set(office.map(u => String(u.imei || '').toUpperCase())),
    shsImeis: new Set(shs.map(u => String(u.imei || '').toUpperCase())),
    soldImeis: new Set(sold.map(u => String(u.imei || '').toUpperCase())),
    saleIds: new Set(sales.map(s => s.id)),
    /** Per-IMEI stock detail, for the restore comparison. */
    stockDetail: new Map([...office, ...shs].map(u => [String(u.imei || '').toUpperCase(), {
      model: u.rawModel || u.model || '',
      grade: u.grade || '',
      storage: u.storage || '',
      simType: u.simType || '',
      colour: u.colour || '',
      supplier: u.supplierName || '',
      buyPrice: money(u.buyPrice),
      shs: u.status === 'incoming',
    }])),
  };
}

const setsEqual = (a, b) => a.size === b.size && [...a].every(v => b.has(v));
const diff = (a, b) => [...a].filter(v => !b.has(v));

// ── The flows ────────────────────────────────────────────────────────────────

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

async function uploadInventory(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3500);
  const text = await modal(page).innerText().catch(() => '');
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);
  return text;
}

/** Fill every empty required field in the orphan-sales audit panel. */
async function completeAudit(page) {
  const fill = async (selector, value) => {
    const loc = modal(page).locator(selector);
    for (let i = 0; i < await loc.count(); i++) {
      const box = loc.nth(i);
      if ((await box.inputValue().catch(() => 'x')) === '') {
        await box.fill(value); await box.press('Tab'); await page.waitForTimeout(120);
      }
    }
  };
  await fill('input[placeholder="IMEI required"]', '350190000009999');
  await fill('input[placeholder="Search model…"]', 'IPHONE 12');
  await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
  const numeric = modal(page).locator('input[type="number"]');
  for (let i = 0; i < await numeric.count(); i++) {
    const box = numeric.nth(i);
    const v = await box.inputValue().catch(() => '1');
    if (!v || Number(v) === 0) { await box.fill('200'); await box.press('Tab'); await page.waitForTimeout(120); }
  }
  await page.waitForTimeout(700);
}

/**
 * Upload one sales file. `marketplace` picks the channel chip first (the
 * per-channel path); null leaves the picker on "All marketplaces" (combined).
 * Returns the Done-screen text.
 */
async function uploadSales(page, file, marketplace) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(800);

  if (marketplace) {
    await modal(page).getByRole('button', { name: new RegExp(`^${marketplace}$`, 'i') }).first().click();
    await page.waitForTimeout(400);
  }

  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(5000);

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  let confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) await completeAudit(page);

  confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) {
    return { done: '', blocked: true };
  }
  await confirm.click();
  await page.waitForTimeout(9000);
  const done = await modal(page).innerText().catch(() => '');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1800);
  await dismissModals(page);
  return { done, blocked: false };
}

/** Open a report menu on the current page and download its All Time range.
 *  The range rows are `All Time` (downloads) with an eye button beside them
 *  (views) — the download is the text button, not the icon. */
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── Pass A: the combined four-sheet workbook ─────────────────────────────
  console.log('\n── Pass A · combined workbook ──');
  await wipeAll(page);
  await uploadInventory(page, INVENTORY_FILE);
  const afterInvA = fingerprint(await readStore(page));
  record('A · inventory lands 110 office + 10 SHS',
    afterInvA.officeCount === 110 && afterInvA.shsCount === 10,
    `office=${afterInvA.officeCount} shs=${afterInvA.shsCount}`);

  const batchDone = await uploadSales(page, COMBINED_SALES, null);
  record('A · combined sales workbook imports', !batchDone.blocked,
    batchDone.blocked ? 'Confirm never enabled' : (batchDone.done.match(/\d+ created · \d+ updated/i) || [''])[0]);
  await shot(page, 'batch-import-done');

  await gotoTab(page, 'Stock Intake');
  const A = fingerprint(await readStore(page));
  console.log(`   A: office=${A.officeCount} shs=${A.shsCount} sold=${A.soldCount} sales=${A.saleCount} ` +
              `revenue=${A.revenue} ${JSON.stringify(A.perMarket)}`);
  await shot(page, 'batch-final-state');

  // ── Pass B: the same rows, four separate per-channel uploads ─────────────
  console.log('\n── Pass B · one file per marketplace ──');
  await wipeAll(page);
  await uploadInventory(page, INVENTORY_FILE);
  const afterInvB = fingerprint(await readStore(page));
  record('B · inventory lands 110 office + 10 SHS',
    afterInvB.officeCount === 110 && afterInvB.shsCount === 10,
    `office=${afterInvB.officeCount} shs=${afterInvB.shsCount}`);

  let allChannelsLanded = true;
  for (const m of MARKETPLACES) {
    const r = await uploadSales(page, PER_MARKET_FILE(m), m);
    if (r.blocked) allChannelsLanded = false;
    const running = fingerprint(await readStore(page));
    console.log(`   ${m}: sales=${running.saleCount} office=${running.officeCount} shs=${running.shsCount}`);
    record(`B · ${m} uploads on its own with the picker set`, !r.blocked,
      r.blocked ? 'Confirm never enabled' : (r.done.match(/\d+ created · \d+ updated/i) || [''])[0]);
  }
  await shot(page, 'per-marketplace-final-state');

  await gotoTab(page, 'Stock Intake');
  const B = fingerprint(await readStore(page));
  console.log(`   B: office=${B.officeCount} shs=${B.shsCount} sold=${B.soldCount} sales=${B.saleCount} ` +
              `revenue=${B.revenue} ${JSON.stringify(B.perMarket)}`);

  // ── Do the two routes agree? ─────────────────────────────────────────────
  console.log('\n── A vs B ──');
  record('same number of sales recorded either way', A.saleCount === B.saleCount,
    `batch=${A.saleCount} per-marketplace=${B.saleCount}`);

  const marketMismatch = MARKETPLACES.filter(m => (A.perMarket[m] ?? 0) !== (B.perMarket[m] ?? 0));
  record('same sales per marketplace either way', marketMismatch.length === 0,
    MARKETPLACES.map(m => `${m} ${A.perMarket[m] ?? 0}/${B.perMarket[m] ?? 0}`).join(' · '));

  const saleIdDiff = diff(A.saleIds, B.saleIds);
  record('sale record ids are identical — a re-upload updates, never duplicates',
    setsEqual(A.saleIds, B.saleIds),
    saleIdDiff.length ? `${saleIdDiff.length} only in batch, e.g. ${saleIdDiff[0]}` : 'identical keys');

  record('the same units are marked sold either way', setsEqual(A.soldImeis, B.soldImeis),
    `batch sold ${A.soldImeis.size} · per-marketplace ${B.soldImeis.size}` +
    (setsEqual(A.soldImeis, B.soldImeis) ? '' : ` · differs by ${diff(A.soldImeis, B.soldImeis).length}`));

  record('office stock reconciles to the same units', setsEqual(A.officeImeis, B.officeImeis),
    `batch ${A.officeCount} · per-marketplace ${B.officeCount}`);

  record('SHS stock reconciles to the same units', setsEqual(A.shsImeis, B.shsImeis),
    `batch ${A.shsCount} · per-marketplace ${B.shsCount}`);

  record('revenue and cost agree to the penny',
    A.revenue === B.revenue && A.cost === B.cost,
    `revenue ${A.revenue}/${B.revenue} · cost ${A.cost}/${B.cost}`);

  // ── Pass C: download both reports, wipe, put them back ───────────────────
  // Both downloads happen HERE, from the live state — that is the whole
  // point of the exercise. Downloading after the wipe would export an empty
  // book and prove nothing.
  console.log('\n── Pass C · restore stock from the downloaded report ──');
  await gotoTab(page, 'Stock Intake');
  const invPath = await downloadReport(page, /Inventory Report/i);
  const restoreFile = resolve(OUT, 'downloaded-inventory-report.xlsx');
  copyFileSync(invPath, restoreFile);
  record('Inventory Report downloads from the current state', existsSync(restoreFile));

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  let salesRestore = null;
  try {
    const salesPath = await downloadReport(page, /Sales Report/i);
    salesRestore = resolve(OUT, 'downloaded-sales-report.xlsx');
    copyFileSync(salesPath, salesRestore);
  } catch { /* recorded below */ }
  record('Sales Report downloads from the current state', !!salesRestore);

  await wipeAll(page);
  const wiped = fingerprint(await readStore(page));
  record('C · wipe leaves no stock behind',
    wiped.officeCount === 0 && wiped.shsCount === 0,
    `office=${wiped.officeCount} shs=${wiped.shsCount}`);

  await uploadInventory(page, restoreFile);
  await gotoTab(page, 'Stock Intake');
  const C = fingerprint(await readStore(page));
  await shot(page, 'restored-from-download');
  console.log(`   C: office=${C.officeCount} shs=${C.shsCount}`);

  record('restored office stock matches what was on the shelf',
    C.officeCount === B.officeCount && setsEqual(C.officeImeis, B.officeImeis),
    `was ${B.officeCount} · restored ${C.officeCount}`);

  record('restored SHS stock matches what the supplier still held',
    C.shsCount === B.shsCount && setsEqual(C.shsImeis, B.shsImeis),
    `was ${B.shsCount} · restored ${C.shsCount}`);

  // Field-level: a restore that gets the count right but loses the grade or
  // the buy price is not a restore.
  const fieldDrift = [];
  for (const [imei, before] of B.stockDetail) {
    const after = C.stockDetail.get(imei);
    if (!after) { fieldDrift.push(`${imei} missing`); continue; }
    for (const k of Object.keys(before)) {
      if (String(before[k]) !== String(after[k])) {
        fieldDrift.push(`${imei} ${k}: ${before[k]} → ${after[k]}`);
      }
    }
  }
  record('every restored unit keeps model, grade, storage, SIM, colour, supplier, BP and stock type',
    fieldDrift.length === 0,
    fieldDrift.length ? `${fieldDrift.length} drifted, e.g. ${fieldDrift.slice(0, 2).join(' | ')}`
                      : `${B.stockDetail.size} units × 8 fields`);

  // ── Pass D: put the sales back on top ────────────────────────────────────
  console.log('\n── Pass D · restore sales from the downloaded report ──');
  if (salesRestore) {
    const r = await uploadSales(page, salesRestore, null);
    await gotoTab(page, 'Stock Intake');
    const D = fingerprint(await readStore(page));
    await shot(page, 'restored-sales-from-download');
    console.log(`   D: office=${D.officeCount} shs=${D.shsCount} sold=${D.soldCount} sales=${D.saleCount}`);

    record('D · the downloaded sales report re-imports', !r.blocked,
      r.blocked ? 'Confirm never enabled' : (r.done.match(/\d+ created · \d+ updated/i) || [''])[0]);
    record('restoring sales does not disturb the restored stock',
      D.officeCount === C.officeCount && D.shsCount === C.shsCount,
      `office ${C.officeCount} → ${D.officeCount} · shs ${C.shsCount} → ${D.shsCount}`);
    record('sales come back with the same record ids, so nothing duplicates',
      D.saleCount === B.saleCount && setsEqual(D.saleIds, B.saleIds),
      `was ${B.saleCount} · restored ${D.saleCount}`);

    // The restored sold units have to be the SAME phones, not placeholders
    // conjured by the orphan audit — otherwise the books balance on fiction.
    record('the same units come back marked sold', setsEqual(D.soldImeis, B.soldImeis),
      `was ${B.soldImeis.size} · restored ${D.soldImeis.size}` +
      (setsEqual(D.soldImeis, B.soldImeis) ? '' : ` · ${diff(B.soldImeis, D.soldImeis).length} never came back`));

    record('revenue and cost land back on the same figures',
      D.revenue === B.revenue && D.cost === B.cost,
      `revenue ${B.revenue} → ${D.revenue} · cost ${B.cost} → ${D.cost}`);

    record('a full restore reproduces the whole business — stock, sales and sold units',
      D.officeCount === B.officeCount && D.shsCount === B.shsCount
        && D.soldCount === B.soldCount && D.saleCount === B.saleCount,
      `office ${D.officeCount}/${B.officeCount} · shs ${D.shsCount}/${B.shsCount} · ` +
      `sold ${D.soldCount}/${B.soldCount} · sales ${D.saleCount}/${B.saleCount}`);
  }

  record('no uncaught JS errors across all four passes', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
