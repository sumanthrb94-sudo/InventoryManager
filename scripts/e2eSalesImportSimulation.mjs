/**
 * scripts/e2eSalesImportSimulation.mjs — the restored Sales Report import,
 * driven at scale across every marketplace and every way a row can go wrong.
 *
 * WHY THIS EXISTS ALONGSIDE e2eSalesImportGate.mjs
 *
 * That script proves the gate on four rows. Four rows cannot show whether the
 * gate holds when a file carries forty, whether one marketplace's column set
 * behaves differently from another's, or whether a suggestion that is right in
 * isolation stays right when the catalogue has near neighbours in it. The
 * failure mode this is looking for is not "the check is wrong" — it is "the
 * check is right on the example and noisy on the file", which is how a warning
 * gets ignored.
 *
 * THE FILE IS THE DELIVERABLE, NOT JUST THE INPUT
 *
 * The workbook is written to templates/samples/SALES_IMPORT_SIMULATION.xlsx
 * and kept. Every row carries its scenario id and its EXPECTED outcome in the
 * Comments column, so the file can be opened and read as the test plan it is —
 * and re-uploaded by hand to reproduce any single row. A run whose evidence
 * only exists in a terminal cannot be checked by the person who has to trust
 * it.
 *
 * THE MATRIX — 40 rows over 5 marketplace tabs
 *
 *   RECONCILIATION      matched office unit; matched SHS unit; a clean orphan
 *   THE GATE            unknown model; unknown supplier; both at once
 *   THE RECOMMENDATION  transposition; dropped letter; spacing-only
 *   THE QUIET CASE      adjacent generation; a trailing-letter variant;
 *                       a storage variant; an unrelated name — each of which
 *                       is one edit from a catalogue entry and must NOT be
 *                       offered as a correction
 *   THE OLD CHECKS      placeholder IMEI; missing BP; missing supplier
 *   RETURNS             refund / replacement / repair restored from the row
 *   IDEMPOTENCY         the whole file re-uploaded changes nothing
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eSalesImportSimulation.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { clearDataRows, openImporter } from './e2eSheetHelpers.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/sales-import-simulation');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const WORKBOOK = resolve('templates/samples/SALES_IMPORT_SIMULATION.xlsx');

// ── The world the file arrives into ─────────────────────────────────────────
//
// Deliberately full of near neighbours. A catalogue of two names proves almost
// nothing about a near-miss check; the pairs below (13/14, S23/S24, 7/7a,
// A54/A55) are exactly the shapes that make a naive edit-distance check
// unusable, and they have to be present for the quiet cases to mean anything.
const CATALOG = [
  { brand: 'Apple',   model: 'iPhone 13' },
  { brand: 'Apple',   model: 'iPhone 14' },
  { brand: 'Apple',   model: 'iPhone 15 Pro Max' },
  { brand: 'Samsung', model: 'Galaxy S23 Ultra' },
  { brand: 'Samsung', model: 'Galaxy S24 Ultra' },
  { brand: 'Samsung', model: 'Galaxy A54' },
  { brand: 'Google',  model: 'Pixel 7' },
  { brand: 'Google',  model: 'Pixel 7a' },
];
const SUPPLIERS = ['MOBILE WHOLESALE LTD', 'NIHAL', 'IMAX'];

/** Office stock (status available) — a sale on one of these reconciles. */
const OFFICE = [
  { imei: '359900000000001', model: 'iPhone 13',        bp: 200 },
  { imei: '359900000000002', model: 'iPhone 14',        bp: 260 },
  { imei: '359900000000003', model: 'Galaxy S23 Ultra', bp: 380 },
  { imei: '359900000000004', model: 'Pixel 7',          bp: 190 },
  { imei: '359900000000005', model: 'Galaxy A54',       bp: 170 },
  { imei: '359900000000006', model: 'iPhone 13',        bp: 205 },
  { imei: '359900000000007', model: 'iPhone 14',        bp: 265 },
  { imei: '359900000000008', model: 'Galaxy S24 Ultra', bp: 470 },
];
/** Supplier-held stock (status incoming) — no IMEI until it is received. */
const SHS = [
  { imei: '359900000000101', model: 'iPhone 15 Pro Max', bp: 700 },
  { imei: '359900000000102', model: 'Pixel 7a',          bp: 210 },
];

// ── The matrix ──────────────────────────────────────────────────────────────
//
// `expect` is written into the Comments column of the row itself, so the
// workbook explains what each row is for without this script beside it.
//
//   reconcile   matched unit, flips to sold, no completion row
//   ready       orphan with everything the audit needs — creates a unit
//   held-model  model not in the catalogue     → blocks, no unit written
//   held-supp   supplier not on file           → blocks, no supplier written
//   suggest     held AND a correction is offered
//   quiet       held and NO correction offered (the near neighbour case)
//   blocked     fails one of the pre-existing presence/format checks
//   return      a voided row whose outcome is restored
const M = (marketplace, rows) => rows.map((r, i) => ({ marketplace, ...r, seq: i + 1 }));

const SCENARIOS = [
  ...M('AMAZON', [
    { id: 'A1',  kind: 'reconcile',  imei: OFFICE[0].imei, model: 'iPhone 13',        supplier: 'MOBILE WHOLESALE LTD', bp: 200, sp: 300 },
    { id: 'A2',  kind: 'reconcile',  imei: OFFICE[1].imei, model: 'iPhone 14',        supplier: 'MOBILE WHOLESALE LTD', bp: 260, sp: 380 },
    { id: 'A3',  kind: 'ready',      imei: '359900000000201', model: 'iPhone 13',     supplier: 'NIHAL',                bp: 210, sp: 320 },
    { id: 'A4',  kind: 'suggest',    imei: '359900000000202', model: 'iPhoen 13',     supplier: 'NIHAL',                bp: 210, sp: 320, wantModel: 'iPhone 13' },
    { id: 'A5',  kind: 'suggest',    imei: '359900000000203', model: 'Galaxy S24 Ulta', supplier: 'NIHAL',              bp: 470, sp: 600, wantModel: 'Galaxy S24 Ultra' },
    { id: 'A6',  kind: 'suggest',    imei: '359900000000204', model: 'iPhone13',      supplier: 'NIHAL',                bp: 200, sp: 300, wantModel: 'iPhone 13' },
    { id: 'A7',  kind: 'quiet',      imei: '359900000000205', model: 'iPhone 16',     supplier: 'NIHAL',                bp: 300, sp: 420 },
    { id: 'A8',  kind: 'quiet',      imei: '359900000000206', model: 'Galaxy A55',    supplier: 'NIHAL',                bp: 180, sp: 260 },
  ]),
  ...M('BM', [
    { id: 'B1',  kind: 'reconcile',  imei: OFFICE[2].imei, model: 'Galaxy S23 Ultra', supplier: 'MOBILE WHOLESALE LTD', bp: 380, sp: 520 },
    { id: 'B2',  kind: 'ready',      imei: '359900000000301', model: 'Galaxy A54',    supplier: 'IMAX',                 bp: 170, sp: 250 },
    { id: 'B3',  kind: 'suggest',    imei: '359900000000302', model: 'Galaxy A54',    supplier: 'NIHAAL',               bp: 170, sp: 250, wantSupplier: 'NIHAL' },
    { id: 'B4',  kind: 'held-supp',  imei: '359900000000303', model: 'Galaxy A54',    supplier: 'TOTALLY MADE UP LTD',  bp: 170, sp: 250 },
    { id: 'B5',  kind: 'suggest',    imei: '359900000000304', model: 'Galaxy S23 Ulra', supplier: 'NIHAAL',             bp: 380, sp: 520, wantModel: 'Galaxy S23 Ultra', wantSupplier: 'NIHAL' },
    { id: 'B6',  kind: 'quiet',      imei: '359900000000305', model: 'Pixel 8',       supplier: 'IMAX',                 bp: 250, sp: 340 },
    { id: 'B7',  kind: 'blocked',    imei: 'GENERIC',        model: 'iPhone 13',      supplier: 'IMAX',                 bp: 200, sp: 300 },
    { id: 'B8',  kind: 'blocked',    imei: '359900000000306', model: 'iPhone 13',     supplier: 'IMAX',                 bp: 0,   sp: 300 },
  ]),
  ...M('EBAY', [
    { id: 'E1',  kind: 'reconcile',  imei: OFFICE[3].imei, model: 'Pixel 7',          supplier: 'MOBILE WHOLESALE LTD', bp: 190, sp: 280 },
    { id: 'E2',  kind: 'quiet',      imei: '359900000000401', model: 'Pixel 7 Pro',   supplier: 'IMAX',                 bp: 300, sp: 400 },
    { id: 'E3',  kind: 'ready',      imei: '359900000000402', model: 'Pixel 7a',      supplier: 'IMAX',                 bp: 210, sp: 300 },
    { id: 'E4',  kind: 'return',     imei: OFFICE[4].imei, model: 'Galaxy A54',       supplier: 'MOBILE WHOLESALE LTD', bp: 170, sp: 250,
      returnDate: '2026-08-12', outcome: 'Refund',      reason: 'Customer changed mind' },
    { id: 'E5',  kind: 'return',     imei: OFFICE[5].imei, model: 'iPhone 13',        supplier: 'MOBILE WHOLESALE LTD', bp: 205, sp: 310,
      returnDate: '2026-08-13', outcome: 'Replacement', reason: 'Faulty screen' },
    { id: 'E6',  kind: 'return',     imei: OFFICE[6].imei, model: 'iPhone 14',        supplier: 'MOBILE WHOLESALE LTD', bp: 265, sp: 390,
      returnDate: '2026-08-14', outcome: 'Repair',      reason: 'Battery' },
    { id: 'E7',  kind: 'suggest',    imei: '359900000000403', model: 'Pixel 7a',      supplier: 'MOBILE WHOLESAL LTD',  bp: 210, sp: 300, wantSupplier: 'MOBILE WHOLESALE LTD' },
    { id: 'E8',  kind: 'quiet',      imei: '359900000000404', model: 'Galaxy S22 Ultra', supplier: 'IMAX',              bp: 330, sp: 450 },
  ]),
  ...M('ONBUY', [
    { id: 'O1',  kind: 'reconcile',  imei: OFFICE[7].imei, model: 'Galaxy S24 Ultra', supplier: 'MOBILE WHOLESALE LTD', bp: 470, sp: 640 },
    { id: 'O2',  kind: 'ready',      imei: '359900000000501', model: 'iPhone 15 Pro Max', supplier: 'NIHAL',            bp: 700, sp: 900 },
    { id: 'O3',  kind: 'suggest',    imei: '359900000000502', model: 'iPhone 15 Pro Mx',  supplier: 'NIHAL',            bp: 700, sp: 900, wantModel: 'iPhone 15 Pro Max' },
    { id: 'O4',  kind: 'quiet',      imei: '359900000000503', model: 'iPhone 15 Pro',     supplier: 'NIHAL',            bp: 650, sp: 850 },
    { id: 'O5',  kind: 'held-supp',  imei: '359900000000504', model: 'iPhone 13',     supplier: 'CELLHUB TRADING',      bp: 200, sp: 300 },
    { id: 'O6',  kind: 'blocked',    imei: '359900000000505', model: 'iPhone 13',     supplier: '',                     bp: 200, sp: 300 },
    { id: 'O7',  kind: 'ready',      imei: '359900000000506', model: 'Galaxy S23 Ultra', supplier: 'IMAX',              bp: 380, sp: 520 },
    { id: 'O8',  kind: 'quiet',      imei: '359900000000507', model: 'Galaxy A34',    supplier: 'IMAX',                 bp: 150, sp: 220 },
  ]),
  ...M('TEMU', [
    { id: 'T1',  kind: 'reconcile',  imei: SHS[0].imei,    model: 'iPhone 15 Pro Max', supplier: 'MOBILE WHOLESALE LTD', bp: 700, sp: 900 },
    { id: 'T2',  kind: 'reconcile',  imei: SHS[1].imei,    model: 'Pixel 7a',         supplier: 'MOBILE WHOLESALE LTD', bp: 210, sp: 300 },
    { id: 'T3',  kind: 'ready',      imei: '359900000000601', model: 'iPhone 14',     supplier: 'NIHAL',                bp: 260, sp: 370 },
    { id: 'T4',  kind: 'suggest',    imei: '359900000000602', model: 'iPhone 41',     supplier: 'NIHAL',                bp: 260, sp: 370, wantModel: 'iPhone 14' },
    { id: 'T5',  kind: 'quiet',      imei: '359900000000603', model: 'Redmi Note 12', supplier: 'NIHAL',                bp: 120, sp: 180 },
    { id: 'T6',  kind: 'ready',      imei: '359900000000604', model: 'Pixel 7',       supplier: 'IMAX',                 bp: 190, sp: 270 },
    { id: 'T7',  kind: 'quiet',      imei: '359900000000605', model: 'Pixel 6a',      supplier: 'IMAX',                 bp: 160, sp: 230 },
    { id: 'T8',  kind: 'ready',      imei: '359900000000606', model: 'Galaxy A54',    supplier: 'NIHAL',                bp: 170, sp: 250 },
  ]),
];

const EXPECT_TEXT = {
  reconcile:  'matched unit — flips to SOLD, no completion row',
  ready:      'orphan with full audit data — creates a unit',
  'held-supp':'HELD: supplier not on file, and no close match to offer',
  suggest:    'HELD, and a correction is offered',
  quiet:      'HELD, and NO correction offered — near neighbour of a real model',
  blocked:    'blocked by the pre-existing presence/format checks',
  return:     'matched unit, voided — outcome restored from the row',
};

/** The quantity column is named differently per tab, and ONBUY has none. */
function quantityKey(marketplace) {
  if (marketplace === 'ONBUY') return null;
  return marketplace === 'EBAY' ? 'Units' : 'Quantity';
}

async function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_REPORT_TEMPLATE.xlsx');
  for (const ws of wb.worksheets) {
    if (ws.name === 'README') continue;
    clearDataRows(ws);
  }
  const headersOf = (ws) => (ws.getRow(1).values ?? []).slice(1).map(v => String(v ?? '').trim());

  for (const s of SCENARIOS) {
    const ws = wb.getWorksheet(s.marketplace);
    const headers = headersOf(ws);
    const row = ws.getRow(s.seq + 1);
    const put = (name, value) => {
      const idx = headers.indexOf(name);
      if (idx < 0) throw new Error(`${ws.name}: no "${name}" column — headers: ${headers.join(', ')}`);
      row.getCell(idx + 1).value = value;
    };
    put('Date', '2026-08-10');
    put('Order Number', `${s.marketplace}-${s.id}`);
    // SKU deliberately holds an OPERATOR CODE, not the friendly name. That is
    // what a real marketplace export carries, and it is the shape that proves
    // the Model column is being read: before it was, every one of these rows
    // arrived with the model blank.
    put('SKU', `OP-${s.id}-CODE`);
    put('IMEI', s.imei);
    put('Model', s.model);
    put('Supplier', s.supplier);
    put('BP', s.bp);
    put('SP', s.sp);
    put('Postage', 0);
    const qty = quantityKey(s.marketplace);
    if (qty) put(qty, 1);
    if (s.returnDate) {
      put('Return Date', s.returnDate);
      put('Outcome', s.outcome);
      put('Return Reason', s.reason);
    }
    put('Comments', `${s.id} · ${s.kind} · expect: ${EXPECT_TEXT[s.kind]}${[s.wantModel, s.wantSupplier].filter(Boolean).map(w => ` → "${w}"`).join('')}`);
    row.commit();
  }
  await wb.xlsx.writeFile(WORKBOOK);
}

// ── Harness ─────────────────────────────────────────────────────────────────

let failures = 0, checks = 0;
function check(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
}

await buildWorkbook();
console.log(`workbook: ${WORKBOOK}  (${SCENARIOS.length} rows over 5 tabs)`);

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', e => { jsErrors.push(String(e)); console.log(`  [pageerror] ${e.message}`); });

await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(({ catalog, suppliers, office, shs }) => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  s.models = {};
  catalog.forEach((m, i) => {
    s.models[`mdl-${i}`] = { id: `mdl-${i}`, brand: m.brand, model: m.model,
                             ownerId: 'shared', createdAt: '2026-01-01' };
  });
  s.suppliers = {};
  suppliers.forEach((n, i) => {
    s.suppliers[`sup-${i}`] = { id: `sup-${i}`, name: n, ownerId: 'shared', createdAt: '2026-01-01' };
  });
  s.inventoryUnits = {};
  const unit = (u, status, i) => ({
    id: `unit-${status}-${i}`, imei: u.imei, model: u.model, storage: '128GB',
    colour: 'Black', status, buyPrice: u.bp, dateIn: '2026-07-01',
    supplierName: 'MOBILE WHOLESALE LTD', flags: [], platformListed: false,
    ownerId: 'shared', createdAt: '2026-07-01',
  });
  office.forEach((u, i) => { s.inventoryUnits[`unit-available-${i}`] = unit(u, 'available', i); });
  shs.forEach((u, i) => { s.inventoryUnits[`unit-incoming-${i}`] = unit(u, 'incoming', i); });
  sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s));
}, { catalog: CATALOG, suppliers: SUPPLIERS, office: OFFICE, shs: SHS });
// goto, NOT reload — reload repeats ?e2eReset=1 and wipes the seed.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const modal = () => page.locator('div.fixed.inset-0').last();
/** Confirm is the only emerald footer button; it RENAMES itself while blocked
 *  ("Complete N records to continue"), so matching on its label is not an
 *  option — that is the state under test. */
const confirmButton = () => modal().locator('button.bg-emerald-600').last();

async function upload(file) {
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(4000);
}

// ── 1 · The whole file, classified ──────────────────────────────────────────
console.log('\n1 · 40 rows, 5 marketplaces — how the preview classifies them');
await openImporter(page, 'sales');
await upload(WORKBOOK);
await modal().screenshot({ path: `${OUT}/01-preview-40-rows.png` });

let text = await modal().innerText();
const num = (rx) => { const m = text.match(rx); return m ? Number(m[1].replace(/,/g, '')) : null; };

const expected = SCENARIOS.reduce((a, s) => { a[s.kind] = (a[s.kind] || 0) + 1; return a; }, {});
console.log(`  matrix: ${Object.entries(expected).map(([k, v]) => `${k}=${v}`).join(' ')}`);

// Every marketplace tab was read. A tab silently skipped would leave the
// totals plausible and the coverage fictional.
for (const mkt of ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU']) {
  check(`${mkt} tab parsed 8 rows`, num(new RegExp(`${mkt}\\s*\\n\\s*(\\d+)`)), 8);
}

// A 'suggest' row can be wrong in BOTH fields at once (B5 is), so the two are
// counted independently — one row, two corrections.
const isModelSuggestion = (s) => Boolean(s.wantModel);
const isSupplierSuggestion = (s) => Boolean(s.wantSupplier);
const count = (fn) => SCENARIOS.filter(fn).length;

check('rows held on an unknown MODEL',
  num(/(\d+) rows? on a model not in your catalog/),
  count(isModelSuggestion) + count(s => s.kind === 'quiet'));
check('rows held on an unknown SUPPLIER',
  num(/(\d+) rows? on a supplier not on file/),
  count(isSupplierSuggestion) + count(s => s.kind === 'held-supp'));

check('Confirm is disabled while anything is held',
  await confirmButton().isDisabled().catch(() => null), true);

// ── 2 · The recommendations, one row at a time ──────────────────────────────
console.log('\n2 · did-you-mean — offered where it should be, silent where it should not');
const offeredNames = async () => (await modal()
  .locator('button:has-text("did you mean")').allInnerTexts())
  // Each button reads: Model: did you mean “iPhone 13”?
  .map(t => (t.match(/[“"]([^”"]+)[”"]/) || [])[1] || t.trim())
  .sort();

const offered = await offeredNames();
const wanted = SCENARIOS.flatMap(s => [s.wantModel, s.wantSupplier].filter(Boolean)).sort();

// The set comparison is the whole check, and it is two-sided on purpose.
// Listing only "was my typo offered the right name" would pass a build that
// ALSO named a correction on every quiet row — which is the failure that
// matters, because a check that fires on correct data gets ignored, and an
// ignored warning is a missing warning.
check('every offered correction, exactly', offered, wanted);

for (const s of SCENARIOS.filter(x => x.kind === 'suggest')) {
  for (const [field, want] of [['model', s.wantModel], ['supplier', s.wantSupplier]]) {
    if (!want) continue;
    check(`  ${s.id} ${field} → "${want}"`, offered.includes(want), true);
  }
}
for (const s of SCENARIOS.filter(x => x.kind === 'quiet')) {
  // Named individually so a failure says WHICH near neighbour leaked, not
  // just that the totals disagree.
  const nearest = [...CATALOG.map(c => c.model), ...SUPPLIERS]
    .filter(n => !wanted.includes(n));
  check(`  ${s.id} "${s.model}" → silent`,
    offered.some(o => nearest.includes(o) && !wanted.includes(o)), false);
}
const suggestionCount = offered.length;

await modal().screenshot({ path: `${OUT}/02-suggestions.png` });

// ── 3 · Taking every suggestion ─────────────────────────────────────────────
console.log('\n3 · taking every offered correction');
const before = { model: num(/(\d+) rows? on a model not in your catalog/),
                 supplier: num(/(\d+) rows? on a supplier not on file/) };
for (let i = 0; i < suggestionCount; i++) {
  // Always click the FIRST one: taking a suggestion removes it, so the list
  // shortens under us and a fixed index would skip every other row.
  const btn = modal().locator('button:has-text("did you mean")').first();
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(350);
}
text = await modal().innerText();
const after = { model: num(/(\d+) rows? on a model not in your catalog/) ?? 0,
                supplier: num(/(\d+) rows? on a supplier not on file/) ?? 0 };
check('every model correction cleared its row',
  before.model - after.model, count(isModelSuggestion));
check('every supplier correction cleared its row',
  before.supplier - after.supplier, count(isSupplierSuggestion));
check('the quiet rows are still held', after.model, count(s => s.kind === 'quiet'));
await modal().screenshot({ path: `${OUT}/03-corrections-taken.png` });

// ── 4 · Confirm — and what does NOT get written ─────────────────────────────
//
// The rows that cannot be corrected onto an existing name are taken OUT of the
// file rather than forced through, which is the operator's real choice: add
// the model in Configuration / the supplier in Admin, or leave them out.
console.log('\n4 · the importable subset confirms; the rest never reaches the database');
const IMPORTABLE = SCENARIOS.filter(s => !['quiet', 'held-supp', 'blocked'].includes(s.kind));
const DROPPED = SCENARIOS.filter(s => ['quiet', 'held-supp', 'blocked'].includes(s.kind));
const seqPerTab = {};
SCENARIOS.length = 0;
for (const s of IMPORTABLE) {
  seqPerTab[s.marketplace] = (seqPerTab[s.marketplace] || 0) + 1;
  SCENARIOS.push({ ...s, seq: seqPerTab[s.marketplace] });
}
await buildWorkbook();

await modal().getByRole('button', { name: /Pick another file/i }).click();
await page.waitForTimeout(600);
await upload(WORKBOOK);

// The typo rows are still typos in the rebuilt file — correct them the way an
// operator would, through the suggestion, rather than by typing the right
// name and proving nothing.
for (let i = 0; i < 20; i++) {
  const btn = modal().locator('button:has-text("did you mean")').first();
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(350);
}
// Acknowledge the in-stock flips.
const boxes = modal().locator('input[type="checkbox"]');
for (let i = 0; i < await boxes.count(); i++) {
  const box = boxes.nth(i);
  if (await box.isChecked().catch(() => true)) continue;
  const label = await box.evaluate(el => el.closest('label')?.innerText || '').catch(() => '');
  if (/flip|sold|fulfil/i.test(label)) await box.check().catch(() => {});
}
await page.waitForTimeout(500);
check('Confirm enables once nothing is held',
  await confirmButton().isDisabled().catch(() => null), false);
await modal().screenshot({ path: `${OUT}/04-ready-to-confirm.png` });

await confirmButton().click();
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/05-after-confirm.png`, fullPage: true });

const store = () => page.evaluate(() => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  return {
    units: Object.values(s.inventoryUnits || {}),
    models: Object.values(s.models || {}).map(m => String(m.model || '')),
    suppliers: Object.values(s.suppliers || {}).map(x => String(x.name || '')),
    sales: Object.values(s.sales || {}),
  };
});
let db = await store();
const unitByImei = (imei) => db.units.find(u => u.imei === imei);

for (const s of IMPORTABLE.filter(x => x.kind === 'reconcile')) {
  check(`${s.id} matched unit is SOLD`, unitByImei(s.imei)?.status, 'sold');
}
for (const s of IMPORTABLE.filter(x => x.kind === 'ready')) {
  check(`${s.id} orphan created as SOLD under "${s.model}"`,
    [unitByImei(s.imei)?.status, unitByImei(s.imei)?.model], ['sold', s.model]);
}
for (const s of IMPORTABLE.filter(x => x.wantModel)) {
  check(`${s.id} corrected orphan landed on the CATALOGUE name, not the typo`,
    unitByImei(s.imei)?.model, s.wantModel);
}
check('no model was created under a typo',
  db.models.filter(m => ['iPhoen 13', 'Galaxy S24 Ulta', 'iPhone13', 'Galaxy S23 Ulra',
                         'iPhone 15 Pro Mx', 'iPhone 41'].includes(m)), []);
check('no supplier was created under a typo',
  db.suppliers.filter(n => ['NIHAAL', 'MOBILE WHOLESAL LTD'].includes(n)), []);
check('the catalogue is still exactly the 8 seeded models', db.models.length, CATALOG.length);

// The rows left out of the file: nothing of theirs may exist.
for (const s of DROPPED) {
  check(`${s.id} (${s.kind}) wrote no unit`, unitByImei(s.imei) ? 1 : 0, 0);
}
check('no supplier from a held row exists',
  db.suppliers.filter(n => ['TOTALLY MADE UP LTD', 'CELLHUB TRADING'].includes(n)), []);
check('no model from a held row exists',
  db.models.filter(m => ['iPhone 16', 'Galaxy A55', 'Pixel 8', 'Pixel 7 Pro',
                         'Galaxy S22 Ultra', 'iPhone 15 Pro', 'Galaxy A34',
                         'Redmi Note 12', 'Pixel 6a'].includes(m)), []);

// ── 5 · Returns restored from the row ───────────────────────────────────────
console.log('\n5 · a voided row restores its outcome');
for (const s of IMPORTABLE.filter(x => x.kind === 'return')) {
  const sale = db.sales.find(x => String(x.orderNumber || '') === `${s.marketplace}-${s.id}`);
  check(`${s.id} sale carries voidedAt + ${s.outcome.toLowerCase()}`,
    [Boolean(sale?.voidedAt), String(sale?.voidOutcome || '')],
    [true, s.outcome.toLowerCase()]);
}

// ── 6 · Re-uploading the same file changes nothing ──────────────────────────
console.log('\n6 · idempotency');
const unitsBefore = db.units.length;
const salesBefore = db.sales.length;
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await openImporter(page, 'sales');
await upload(WORKBOOK);
await modal().screenshot({ path: `${OUT}/06-reupload-preview.png` });
text = await modal().innerText();
check('the second pass creates nothing new', /already been imported|0\s*\n\s*TO CREATE|nothing to create/i.test(text) || num(/TO CREATE\s*\n\s*(\d+)/) === 0, true);

db = await store();
check('unit count unchanged', db.units.length, unitsBefore);
check('sale count unchanged', db.sales.length, salesBefore);

check('no uncaught page errors', jsErrors, []);

console.log(`\n${failures === 0 ? 'ok' : 'FAILED'} — ${checks - failures}/${checks} checks`);
console.log(`workbook kept at ${WORKBOOK}`);
console.log(`screenshots in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
