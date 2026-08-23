/**
 * scripts/e2eInventoryImport.mjs — the Inventory Report import, end to end.
 *
 * SCOPE: this route and nothing else. No sales, no returns, no reports. The
 * importer was deleted in 2026-08 and restored in 2026-08-23 behind a model-
 * catalogue gate, and the 17 E2E scripts that used to drive imports went with
 * it — so this is the only script that exercises the route, and it is written
 * to stand alone rather than as a step inside a wider lifecycle.
 *
 * WHAT IT PROVES
 *
 *   1. The route is admin-reachable at all.
 *   2. The preview classifies a mixed file correctly: create, held, invalid,
 *      duplicate-in-file, and SHS.
 *   3. THE GATE. A row whose Model is not in the admin catalogue is HELD:
 *      confirming the import writes the known rows and leaves the held row —
 *      and the supplier named only on that row — entirely absent from the
 *      database. This is the property whose absence got the importer deleted.
 *   4. The held-rows download is a real round trip: same schema, headers the
 *      parser recognises, and re-uploading it is accepted.
 *   5. Adding the model to the catalogue from inside the preview releases the
 *      rows waiting on it, with no re-upload.
 *   6. Re-uploading the same file is idempotent — rows update, they do not
 *      double the stock.
 *   7. THE ROUND TRIP. The app's own all-time Inventory Report, exported
 *      through the real button and fed straight back in, holds NOTHING —
 *      with an empty admin catalogue. This is the regression that shipped:
 *      gating on the catalogue alone held 505 of the operator's 805 rows,
 *      every one of them stock the database already owned.
 *
 * Every assertion reads the STORE, not the screen, wherever the store can
 * answer: a preview tile showing "1" proves what was rendered, not what was
 * written, and it is the write that matters here.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eInventoryImport.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/inventory-import');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const TMP = resolve('/tmp');

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// IMEIs deliberately outside the E2E seed's range. `?e2eReset=1` seeds 17
// units whose IMEIs start at 350000000000101; colliding with those silently
// turns "will create" into "will update" and changes what the run tests.
const KNOWN_IMEI   = '359999999999901';
const HELD_IMEI    = '359999999999902';
const HELD2_IMEI   = '359999999999903';
const DUP_IMEI     = KNOWN_IMEI;              // repeated on purpose
const BAD_IMEI     = '123';                   // too short to be an IMEI

const CATALOGUE_MODEL = 'iPhone 13';
const HELD_MODEL      = 'SG TABA (10.1)(T580) 16GB';   // the real supplier code
// Ordinary-looking, and deliberately NOT among the models the E2E reset
// seeds — 'Galaxy S23' is, and is therefore known stock, not an unknown
// model. Check the seed before changing this.
const HELD_MODEL_2    = 'Pixel 9 Pro Fold';
const HELD_ONLY_SUPPLIER = 'HELD ROW SUPPLIER LTD';    // named on a held row only

const COMMON = {
  'Grade': 'A', 'Colour': 'Black', 'Stock In Date': '2026-08-01',
  'Supplier': 'MOBILE WHOLESALE LTD', 'Notes': '',
};

const MIXED_ROWS = [
  // 2 — catalogued, new IMEI                                    → create
  { ...COMMON, 'Model': CATALOGUE_MODEL, 'IMEI': KNOWN_IMEI, 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office' },
  // 3 — supplier product code                                   → HELD
  { ...COMMON, 'Model': HELD_MODEL, 'IMEI': HELD_IMEI, 'Storage': '16GB', 'BP': 90,
    'Stock Type': 'Office', 'Supplier': HELD_ONLY_SUPPLIER },
  // 4 — a second, different unknown model                       → HELD
  { ...COMMON, 'Model': HELD_MODEL_2, 'IMEI': HELD2_IMEI, 'Storage': '256GB', 'BP': 300, 'Stock Type': 'Office' },
  // 5 — catalogued, no IMEI, supplier-held                      → create as incoming
  { ...COMMON, 'Model': CATALOGUE_MODEL, 'IMEI': '', 'Storage': '128GB', 'BP': 190, 'Stock Type': 'SHS' },
  // 6 — catalogued but the IMEI is unusable                     → invalid
  { ...COMMON, 'Model': CATALOGUE_MODEL, 'IMEI': BAD_IMEI, 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office' },
  // 7 — repeats row 2's IMEI                                    → duplicate in file
  { ...COMMON, 'Model': CATALOGUE_MODEL, 'IMEI': DUP_IMEI, 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office' },
];

function writeWorkbook(path, rows, sheet = 'Inventory') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  XLSX.writeFile(wb, path);
  return path;
}
const MIXED_FILE = writeWorkbook(resolve(TMP, 'e2e-inv-import-mixed.xlsx'), MIXED_ROWS);

// ── Harness ─────────────────────────────────────────────────────────────────

let failures = 0, checks = 0;
function check(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
}

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
});

/** Fresh context with the catalogue holding CATALOGUE_MODEL only. */
async function freshPage() {
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1100 }, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate((model) => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    s.models = s.models || {};
    s.models['mdl-seed'] = { id: 'mdl-seed', brand: 'Apple', model,
                             ownerId: 'shared', createdAt: '2026-01-01' };
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s));
  }, CATALOGUE_MODEL);
  // goto, NOT reload: reload repeats ?e2eReset=1 and wipes the model just
  // seeded — which reads as "the gate holds everything" and looks like a bug
  // in the app rather than in the fixture.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

async function openImport(page, file) {
  await page.getByRole('button', { name: /Import Inventory Report/i }).first().click();
  await page.waitForTimeout(800);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForTimeout(2500);
  return page.locator('div.fixed.inset-0').last();
}

/** Units as the database has them, keyed by what this run cares about. */
const readUnits = (page) => page.evaluate(({ known, held, held2 }) => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  const units = Object.values(s.inventoryUnits || {});
  const suppliers = Object.values(s.suppliers || {});
  return {
    known:      units.filter(u => u.imei === known).length,
    held:       units.filter(u => u.imei === held).length,
    held2:      units.filter(u => u.imei === held2).length,
    tabCode:    units.filter(u => String(u.model || '').includes('TABA')).length,
    badImei:    units.filter(u => u.imei === '123').length,
    shsIncoming: units.filter(u => u.status === 'incoming' && !u.imei
                    && String(u.model || '').toLowerCase().includes('iphone 13')).length,
    heldSupplier: suppliers.filter(x => String(x.name || '').includes('HELD ROW')).length,
  };
}, { known: KNOWN_IMEI, held: HELD_IMEI, held2: HELD2_IMEI });

// ── 1 · The route is reachable, and the preview classifies the file ─────────
console.log('\n1 · route reachable, preview classifies a mixed file');
let heldFile;
{
  const { ctx, page } = await freshPage();
  const btn = page.getByRole('button', { name: /Import Inventory Report/i }).first();
  check('import button visible to admin', await btn.isVisible().catch(() => false), true);

  const modal = await openImport(page, MIXED_FILE);
  // innerText returns RENDERED text and the UI uppercases these labels in CSS,
  // so every match here is case-insensitive.
  const text = await modal.innerText();
  const n = (rx) => { const m = text.match(rx); return m ? Number(m[1]) : null; };

  check('held panel names both unknown models',
    /held · model not in the catalogue/i.test(text)
    && text.includes(HELD_MODEL) && text.includes(HELD_MODEL_2), true);
  check('held row count', n(/held · model not in the catalogue · (\d+) rows?/i), 2);
  check('download offers the same count', n(/download (\d+) held rows?/i), 2);
  check('duplicate IMEI reported', /duplicate imeis? in file/i.test(text), true);
  check('invalid row reported', /invalid rows? · (\d+)/i.test(text), true);

  await modal.screenshot({ path: `${OUT}/01-preview-mixed-file.png` });

  // ── 2 · The held-rows download is a real round trip ──────────────────────
  console.log('\n2 · held-rows download');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    modal.getByRole('button', { name: /download \d+ held rows?/i }).click(),
  ]);
  heldFile = resolve(TMP, 'e2e-inv-import-held.xlsx');
  await download.saveAs(heldFile);

  // XLSX.readFile is not wired up in the ESM build (no fs bound); read the
  // bytes and parse them directly.
  const wb = XLSX.read(readFileSync(heldFile));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  check('held workbook row count', rows.length, 2);
  check('carries the schema the parser reads',
    ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'Supplier', 'BP', 'Stock Type']
      .every(h => h in rows[0]), true);
  check('says why each row was held', /not in the model catalogue/i.test(String(rows[0]['Why Held'])), true);
  check('held models are the two unknown ones',
    rows.map(r => r.Model).sort(), [HELD_MODEL_2, HELD_MODEL].sort());

  // ── 3 · THE GATE: confirm, and read what actually landed ─────────────────
  console.log('\n3 · confirm with both unknown models still held');
  await modal.getByRole('button', { name: /Load \d+ rows?/i }).click();
  await page.waitForTimeout(3000);
  const u = await readUnits(page);
  check('catalogued row written', u.known, 1);
  check('SHS row written as incoming', u.shsIncoming, 1);
  check('held row NOT written', u.held, 0);
  check('second held row NOT written', u.held2, 0);
  check('supplier product code never became a model', u.tabCode, 0);
  check('supplier named only on a held row NOT created', u.heldSupplier, 0);
  check('unusable IMEI NOT written', u.badImei, 0);
  await modal.screenshot({ path: `${OUT}/02-after-confirm-held-excluded.png` });
  await ctx.close();
}

// ── 4 · The held file re-uploads ────────────────────────────────────────────
console.log('\n4 · the downloaded held file is accepted on re-upload');
{
  const { ctx, page } = await freshPage();
  const modal = await openImport(page, heldFile);
  const text = await modal.innerText();
  // Still held — the Model column has not been corrected yet. The point is
  // that the file PARSES: 2 rows recognised, not a schema rejection.
  check('re-upload parses to 2 rows', /· 2 rows/i.test(text), true);
  check('and they are still held', /held · model not in the catalogue · 2 rows?/i.test(text), true);
  await modal.screenshot({ path: `${OUT}/03-held-file-reuploaded.png` });
  await ctx.close();
}

// ── 5 · Resolving from inside the preview ───────────────────────────────────
console.log('\n5 · add the model to the catalogue from the preview');
{
  const { ctx, page } = await freshPage();
  const modal = await openImport(page, MIXED_FILE);
  // Scoped to the row for THIS model, not .first(): unknownModels is sorted by
  // row count then alphabetically, so "Galaxy S23" leads and .first() resolved
  // the wrong one — which then reads as the gate releasing the wrong rows.
  await modal.locator('li', { hasText: HELD_MODEL })
    .getByRole('button', { name: /Add to catalogue/i }).first().click();
  await page.waitForTimeout(400);
  await modal.getByLabel('Brand for ' + HELD_MODEL).fill('Samsung');
  await modal.getByRole('button', { name: /^Save$/i }).click();
  await page.waitForTimeout(2000);

  const after = await modal.innerText();
  check('one unknown model resolved, one still held',
    /held · model not in the catalogue · 1 row/i.test(after), true);
  await modal.screenshot({ path: `${OUT}/04-one-model-added.png` });

  await modal.getByRole('button', { name: /Load \d+ rows?/i }).click();
  await page.waitForTimeout(3000);
  const u = await readUnits(page);
  check('the row waiting on the resolved model is now written', u.held, 1);
  check('the row waiting on the still-unknown model stays held', u.held2, 0);
  await ctx.close();
}

// ── 6 · Re-uploading the same file does not double the stock ────────────────
console.log('\n6 · re-uploading the same file is idempotent');
{
  const { ctx, page } = await freshPage();
  let modal = await openImport(page, MIXED_FILE);
  await modal.getByRole('button', { name: /Load \d+ rows?/i }).click();
  await page.waitForTimeout(3000);
  const first = await readUnits(page);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  modal = await openImport(page, MIXED_FILE);
  const text = await modal.innerText();
  check('second pass sees them as existing, not new', /will update existing units/i.test(text), true);
  await modal.getByRole('button', { name: /Load \d+ rows?/i }).click();
  await page.waitForTimeout(3000);
  const second = await readUnits(page);

  check('catalogued unit not duplicated', second.known, first.known);
  check('SHS holding not duplicated', second.shsIncoming, first.shsIncoming);
  await modal.screenshot({ path: `${OUT}/05-reupload-idempotent.png` });
  await ctx.close();
}

// ── 7 · THE ROUND TRIP: the app's own export, straight back in ──────────────
//
// The reason this section exists. With the gate asking only "is this model in
// the admin catalogue?", the operator downloaded the all-time Inventory Report
// — 805 rows, every one a unit this database already owned — re-uploaded it,
// and 505 rows were held. The catalogue is admin-curated and had never been a
// census of what was in stock.
//
// Nothing here is seeded: this runs against whatever the E2E reset produces,
// exports it through the real report button, and feeds it back in. An empty
// catalogue is the point — the report's own stock must still be recognised.
console.log('\n7 · export the app\'s own inventory report and re-upload it');
{
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1100 }, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const catalogueSize = await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return Object.keys(s.models || {}).length;
  });
  const stockCount = await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return Object.keys(s.inventoryUnits || {}).length;
  });
  console.log(`  (catalogue holds ${catalogueSize} models; ${stockCount} units in stock)`);

  // Exact text: an unscoped /Inventory Report/ also matches a KPI tile.
  await page.locator('button')
    .filter({ hasText: /^\s*Inventory Report\s*$/i }).first().click();
  await page.waitForTimeout(900);
  const [report] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.getByRole('button', { name: /^All Time$/i }).first().click(),
  ]);
  const reportFile = resolve(TMP, 'e2e-inv-report-roundtrip.xlsx');
  await report.saveAs(reportFile);

  const modal = await openImport(page, reportFile);
  const text = await modal.innerText();
  const held = text.match(/held · model not in the catalogue · (\d+) rows?/i);
  check('the app\'s own report re-uploads with nothing held', held ? Number(held[1]) : 0, 0);
  check('and its rows are recognised as existing stock', /will update existing units/i.test(text), true);
  await modal.screenshot({ path: `${OUT}/06-own-report-round-trip.png` });
  await ctx.close();
}

// ── 8 · New suppliers: one row each, and typos called out ───────────────────
//
// The count and the rows disagreed. The panel said "3", listed two warnings,
// then repeated all three names in a comma-separated line — and the operator
// asked where the third had gone. It was there; two warnings above a blob of
// three names simply does not read as three. Both halves are checked here: the
// warning fires on the right names, and the number of rows equals the count in
// the title.
console.log('\n8 · new suppliers, one row each');
{
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1150 }, acceptDownloads: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    s.suppliers = {};
    for (const n of ['MHL', 'NANAK', 'IMAX', 'NIHAL', 'MOBILE KIT', 'RR STOCK', 'ABC', 'BUNTY']) {
      const id = `sup-${n.replace(/\W/g, '')}`;
      s.suppliers[id] = { id, name: n, portal: 'Direct', ownerId: 'shared' };
    }
    sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s));
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // NIHAL is known; NIHAAL is a typo of it; MOBILEKIT differs only in spacing;
  // PHONEBOX DIRECT is genuinely new. Three new suppliers, two of them suspect.
  const supplierFile = writeWorkbook(resolve(TMP, 'e2e-inv-import-suppliers.xlsx'), [
    { ...COMMON, 'Model': 'IPHONE 13', 'IMEI': '359999999999801', 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office', 'Supplier': 'NIHAL' },
    { ...COMMON, 'Model': 'IPHONE 13', 'IMEI': '359999999999802', 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office', 'Supplier': 'NIHAAL' },
    { ...COMMON, 'Model': 'IPHONE 13', 'IMEI': '359999999999803', 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office', 'Supplier': 'PHONEBOX DIRECT' },
    { ...COMMON, 'Model': 'IPHONE 13', 'IMEI': '359999999999804', 'Storage': '128GB', 'BP': 200, 'Stock Type': 'Office', 'Supplier': 'MOBILEKIT' },
  ]);

  const modal = await openImport(page, supplierFile);
  const text = await modal.innerText();
  const counted = Number((text.match(/new suppliers · (\d+)/i) || [])[1]);
  const rows = await modal.locator('li')
    .filter({ hasText: /did you mean|genuinely new/ }).allInnerTexts();

  check('new suppliers counted', counted, 3);
  check('one row rendered per new supplier', rows.length, counted);
  check('the typo is flagged', /NIHAAL — did you mean NIHAL\?/i.test(text), true);
  check('the spacing difference is flagged', /MOBILEKIT — did you mean MOBILE KIT\?/i.test(text), true);
  check('the genuinely new one is shown, not warned',
    /PHONEBOX DIRECT — no close match/i.test(text), true);
  check('a known supplier is not counted as new', /\bNIHAL — did you mean/i.test(text), false);
  check('nothing is blocked', /load \d+ rows?/i.test(text), true);

  await modal.screenshot({ path: `${OUT}/09-new-suppliers-one-row-each.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures === 0 ? 'INVENTORY IMPORT E2E: PASS' : `INVENTORY IMPORT E2E: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
