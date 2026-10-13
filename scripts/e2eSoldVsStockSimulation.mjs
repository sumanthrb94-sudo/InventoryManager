/**
 * scripts/e2eSoldVsStockSimulation.mjs — "500 − 85 sold should be 415, but
 * All Office Stock says 437." A month of trading, three ways, audited against
 * the Stock Intake tiles and Data Health in the real UI.
 *
 * WHY THIS EXISTS
 *
 * A sale row and its unit's flip to 'sold' are separate writes. When the flip
 * doesn't happen (two-stage sale still awaiting its IMEI, a failed write, an
 * SHS holding never fulfilled) the sale counts AND the phone still counts.
 * The operator sees it as stock that "didn't update as sold". Data Health's
 * "Sold but still counted as stock" names each one. This proves, in the
 * browser, that:
 *
 *   1. every Stock Intake tile matches ground truth computed HERE from the
 *      generated month, without importing a line of the app's logic;
 *   2. a clean month reconciles exactly (opening + intake − sold + back-to-
 *      inventory = office tile) and the new check reads Clear;
 *   3. a month with every kind of drift injected is off by EXACTLY the
 *      injected count, and the check lists exactly those sales — no false
 *      positives from voided sales, accessory sales, genuine returns or
 *      orphan IMEIs;
 *   4. the operator's own 12-Oct numbers (500 opening, 85 sales split
 *      44/10/8/3/20, tile reading 437) reproduce, and the check accounts for
 *      the full gap of 22.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eSoldVsStockSimulation.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/sold-vs-stock';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Deterministic month generator ───────────────────────────────────────────
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const todayMid = Date.parse(iso(NOW));
const dayIso = (daysAgo) => iso(todayMid - daysAgo * DAY);

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const MODELS = [
  ['SAMSUNG GALAXY A13', '64GB', 62], ['SAMSUNG GALAXY A32', '64GB', 63],
  ['SAMSUNG GALAXY S21 FE', '128GB', 110], ['SAMSUNG GALAXY S23 FE', '128GB', 165],
  ['IPHONE SE 2022', '128GB', 108], ['GOOGLE PIXEL 6A', '128GB', 95],
];
const SUPPLIERS = ['NIHAL', 'MHL', 'IMAX', 'NANAK'];
const MPS = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];

/**
 * Build one month. `mix` is the per-marketplace sale count; `faults` the
 * number of each drift kind to inject. Everything the assertions need is
 * returned alongside the docs, computed from the generator's own bookkeeping.
 */
function buildMonth({ seed, opening, intakePerDay, mix, faults, backToInv = 5 }) {
  const r = rng(seed);
  const units = [];
  const sales = [];
  let n = 0;
  const mkUnit = (o) => {
    const [model, storage, bp] = MODELS[Math.floor(r() * MODELS.length)];
    const id = `sim-u-${++n}`;
    const u = {
      id, imei: `35${String(seed).padStart(3, '0')}${String(n).padStart(10, '0')}`,
      model, rawModel: model, storage, colour: 'BLACK', buyPrice: bp,
      supplierName: SUPPLIERS[n % SUPPLIERS.length], supplierId: `sup-${n % SUPPLIERS.length}`,
      status: 'available', flags: [], platformListed: false, ownerId: 'shared',
      dateIn: dayIso(30), createdAt: dayIso(30), ...o,
    };
    units.push(u);
    return u;
  };
  const mkSale = (u, mp, daysAgo, o = {}) => {
    const s = {
      id: `${mp}__SIM-${seed}-${sales.length + 1}__${u ? u.imei : (o.sku || 'x')}`,
      marketplace: mp, orderNumber: `SIM-${seed}-${sales.length + 1}`, quantity: 1,
      imei: u ? u.imei : undefined, unitId: u ? u.id : undefined,
      model: u ? u.model : o.model, sku: o.sku || 'SIM-SKU',
      buyPrice: u ? u.buyPrice : 60, salePrice: (u ? u.buyPrice : 60) + 50,
      spMinusBp: 50, grossProfit: 20, gpPercent: 10, postage: 6.3,
      saleDate: dayIso(daysAgo), supplierName: u ? u.supplierName : 'NIHAL',
      importBatchId: 'sim', sourceFile: 'SIM.xlsx', sourceRow: sales.length + 2,
      importedAt: dayIso(daysAgo), createdAt: dayIso(daysAgo), updatedAt: dayIso(daysAgo),
      ownerId: 'shared', ...o,
    };
    sales.push(s);
    return s;
  };
  const flip = (u, s) => Object.assign(u, {
    status: 'sold', saleDate: s.saleDate, salePrice: s.salePrice,
    salePlatform: s.marketplace, saleOrderId: s.orderNumber,
    stockSource: u.stockSource || 'office',
  });

  // Opening pile + daily intake across the month.
  for (let i = 0; i < opening; i++) mkUnit({});
  for (let d = 29; d >= 0; d--) for (let i = 0; i < intakePerDay; i++) mkUnit({ dateIn: dayIso(d), createdAt: dayIso(d) });
  // Supplier-held stock (no IMEI yet).
  for (let i = 0; i < 8; i++) mkUnit({ id: `shs_manual_${seed}_${i}`, imei: '', status: 'incoming', stockSource: 'shs' });

  const pool = () => units.filter(u => u.status === 'available' && !u.returnType);
  const take = () => { const p = pool(); return p[Math.floor(r() * p.length)]; };
  const spreadDay = () => Math.floor(r() * 30);

  // Correctly-recorded sales, per marketplace.
  let goodSales = 0;
  for (const [mp, count] of Object.entries(mix)) {
    for (let i = 0; i < count; i++) { const u = take(); flip(u, mkSale(u, mp, spreadDay())); goodSales++; }
  }
  // Genuine Back-to-Inventory: sold, then returned and available again.
  for (let i = 0; i < backToInv; i++) {
    const u = take(); const d = 10 + i; const s = mkSale(u, 'AMAZON', d);
    Object.assign(u, { status: 'available', returnType: 'returned_to_inventory', returnDate: dayIso(d - 3) });
    void s;
  }
  // Noise that must NOT be flagged.
  for (let i = 0; i < 2; i++) { const u = take(); mkSale(u, 'EBAY', 5, { voidedAt: dayIso(4) }); }   // voided
  mkSale(null, 'AMAZON', 3, { sku: 'CASE-BLK', imei: undefined });                                    // accessory
  const orphans = faults.orphan || 0;
  for (let i = 0; i < orphans; i++) mkSale({ id: undefined, imei: `3599${seed}${String(i).padStart(9, '0')}`, buyPrice: 70, supplierName: 'MHL', model: 'X' }, 'BM', 2, { unitId: undefined });
  // A properly fulfilled SHS sale.
  { const u = units.find(x => x.status === 'incoming'); const s = mkSale(u, 'TEMU', 1); flip(u, s); u.stockSource = 'shs'; }

  // ── Injected drift ──
  const flagged = [];
  for (let i = 0; i < (faults.failedFlip || 0); i++) { const u = take(); flagged.push(mkSale(u, MPS[i % 5], i % 4).id); }
  for (let i = 0; i < (faults.pending || 0); i++) {
    flagged.push(mkSale(null, MPS[i % 5], 1, { awaitingImei: true, model: 'SAMSUNG GALAXY A13', imei: undefined, unitId: undefined }).id);
  }
  for (let i = 0; i < (faults.shsStuck || 0); i++) {
    const u = units.find(x => x.status === 'incoming' && !sales.some(s => s.unitId === x.id));
    flagged.push(mkSale(u, 'BM', 2).id);
  }

  // ── Ground truth, from the generator's own state ──
  const cutoff = NOW - 72 * 3600 * 1000;
  const truth = {
    office: units.filter(u => u.status === 'available' || (u.returnType === 'returned_to_inventory' && u.status !== 'sold')).length,
    shs: units.filter(u => u.status === 'incoming').length,
    recent: units.filter(u => !(u.id.startsWith('shs_') && u.status === 'incoming') && Date.parse(u.dateIn) >= cutoff).length,
    // Date-only sale dates are read as MIDDAY local (firestoreTime.toMillis),
    // so a sale dated three days ago at noon is still inside the window.
    sold72h: units.filter(u => u.status === 'sold' && Date.parse(`${u.saleDate}T12:00:00`) >= cutoff).length,
    flagged: flagged.sort(),
    orphans,
    // The operator's arithmetic: every office phone bought, minus every
    // marketplace sale they counted, plus what genuinely came back.
    operatorExpectation: opening + intakePerDay * 30 - (goodSales + (faults.failedFlip || 0) + (faults.pending || 0)),
  };
  return { units, sales, truth };
}

// ── Browser plumbing ────────────────────────────────────────────────────────
async function gotoTab(page, label) {
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('aside').last()
    .getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

/** Read a KPI tile's number by its label from the rendered text. */
async function tile(page, label) {
  const text = await page.locator('main').innerText();
  const m = text.match(new RegExp(`${label}\\s*\\n+\\s*(\\d+)`, 'i'));
  return m ? Number(m[1]) : NaN;
}

async function loadMonth(page, month) {
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(({ units, sales }) => {
    const store = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    const byId = (arr) => Object.fromEntries(arr.map(d => [d.id, d]));
    store.inventoryUnits = byId(units);
    store.sales = byId(sales);
    store.inventoryAggregates = {};   // tile = unit count, no master-file rollup
    store.deletedUnits = {};
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(store));
  }, { units: month.units, sales: month.sales });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
}

async function auditScenario(page, name, month, expect) {
  console.log(`\n══ ${name} ══`);
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e));
  page.on('pageerror', onErr);
  await loadMonth(page, month);
  const t = month.truth;

  await gotoTab(page, 'Stock Intake');
  await page.screenshot({ path: `${OUT}/${name}-stock-intake.png`, fullPage: false }).catch(() => {});
  const office = await tile(page, 'All Office Stock');
  const shs = await tile(page, 'SHS Stock');
  const recent = await tile(page, 'Stock Added in Last 72 Hours');
  const sold72 = await tile(page, 'Sold Units · Last 72h');
  record(`${name}: All Office Stock tile = ground truth`, office === t.office, `tile ${office} · truth ${t.office}`);
  record(`${name}: SHS Stock tile = ground truth`, shs === t.shs, `tile ${shs} · truth ${t.shs}`);
  record(`${name}: Stock Added 72h tile = ground truth`, recent === t.recent, `tile ${recent} · truth ${t.recent}`);
  record(`${name}: Sold Units 72h tile = ground truth`, sold72 === t.sold72h, `tile ${sold72} · truth ${t.sold72h}`);
  record(`${name}: office gap vs operator arithmetic = injected office drift`,
    office - t.operatorExpectation === expect.officeGap,
    `tile ${office} − expected ${t.operatorExpectation} = ${office - t.operatorExpectation} · injected ${expect.officeGap}`);

  await gotoTab(page, 'Admin');
  await page.getByRole('button', { name: /^Configuration$/i }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const row = page.locator('button').filter({ hasText: 'Sold but still counted as stock' }).first();
  await row.scrollIntoViewIfNeeded().catch(() => {});
  const rowText = await row.innerText().catch(() => '');
  const shown = /Clear/i.test(rowText) ? 0 : Number((rowText.match(/(\d+)\s*$/m) || [])[1]);
  record(`${name}: Data Health "Sold but still counted as stock" count`, shown === t.flagged.length,
    `panel ${shown} · injected ${t.flagged.length}`);
  if (t.flagged.length) {
    await row.click();
    await page.waitForTimeout(400);
    const listed = await row.locator('xpath=..').locator('li p:first-child').allInnerTexts();
    const want = month.sales.filter(s => t.flagged.includes(s.id)).map(s => `${s.marketplace} · ${s.orderNumber}`).sort();
    const got = listed.filter(l => /·/.test(l)).sort();
    const exact = want.slice(0, 25).every(w => got.includes(w)) && got.every(g => want.includes(g));
    record(`${name}: listed sales are exactly the injected ones`, exact, `${got.length} listed`);
  }
  const orphanRow = page.locator('button').filter({ hasText: 'Sales with no matching stock' }).first();
  const orphanText = await orphanRow.innerText().catch(() => '');
  const orphanShown = /Clear/i.test(orphanText) ? 0 : Number((orphanText.match(/(\d+)\s*$/m) || [])[1]);
  record(`${name}: orphan-IMEI sales count`, orphanShown === t.orphans, `panel ${orphanShown} · injected ${t.orphans}`);
  await page.screenshot({ path: `${OUT}/${name}-data-health.png`, fullPage: true }).catch(() => {});

  page.off('pageerror', onErr);
  record(`${name}: no uncaught page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  page.setDefaultTimeout(15000);

  // 1 · Clean month: every sale flips its unit. Must reconcile to zero.
  const clean = buildMonth({
    seed: 101, opening: 400, intakePerDay: 6,
    mix: { AMAZON: 60, BM: 25, EBAY: 20, ONBUY: 8, TEMU: 30 }, faults: {},
  });
  // Back-to-Inventory nets to zero: the operator counts the sale AND the
  // return, so a clean month reconciles exactly.
  await auditScenario(page, 'clean-month', clean, { officeGap: 0 });

  // 2 · Drifted month: every failure kind, plus noise that must not flag.
  const drift = buildMonth({
    seed: 202, opening: 400, intakePerDay: 6,
    mix: { AMAZON: 60, BM: 25, EBAY: 20, ONBUY: 8, TEMU: 30 },
    faults: { failedFlip: 9, pending: 4, shsStuck: 2, orphan: 3 },
  });
  // Office gap = failed flips (9) + pending (4): counted by the operator,
  // took no unit off. SHS-stuck (2) inflates SHS, not office; orphans,
  // voided and accessory sales never touched office stock.
  await auditScenario(page, 'drifted-month', drift, { officeGap: 9 + 4 });

  // 3 · The operator's 12-Oct report: 500 office, 85 sales 44/10/8/3/20,
  //     tile reads 437. 63 flipped correctly, 22 did not.
  const real = buildMonth({
    seed: 303, opening: 500, intakePerDay: 0, backToInv: 0,
    mix: { AMAZON: 34, BM: 7, EBAY: 6, ONBUY: 2, TEMU: 14 },
    faults: { failedFlip: 18, pending: 4 },
  });
  await auditScenario(page, 'operator-12-oct', real, { officeGap: 22 });
  const officeReal = real.truth.office;
  record('operator-12-oct: reproduces the 437 on the tile', officeReal === 437, `truth ${officeReal}`);

  await browser.close();
  finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); record('run completed', false, String(e)); finish(); });
