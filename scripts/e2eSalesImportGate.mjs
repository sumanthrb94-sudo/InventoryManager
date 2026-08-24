/**
 * scripts/e2eSalesImportGate.mjs — the restored Sales Report import, end to end.
 *
 * SCOPE: this route and nothing else. The sales importer was deleted in
 * 2026-08 and restored on 2026-08-24 behind the same catalogue gate the
 * inventory route came back with, so — like e2eInventoryImport.mjs — this
 * script stands alone rather than being a step inside a wider lifecycle. The
 * older scripts that used to reach the importer through an "Import ▾" menu
 * predate the delete and no longer describe the UI.
 *
 * WHAT IT PROVES
 *
 *   1. The route is admin-reachable at all, from its own header button.
 *   2. A sold record that matches stock already on file reconciles and marks
 *      the unit sold — the thing the operator asked for.
 *   3. THE GATE. A row whose Model is not in the admin catalogue, or whose
 *      Supplier is not already on file, HOLDS: Confirm is disabled and the
 *      row says which of the two is wrong. This is the property whose absence
 *      got the importer deleted, moved to where sales re-opens it — the
 *      completion panel, not the file.
 *   4. THE RECOMMENDATION. The held row names the model it probably meant,
 *      and taking it clears the block. Without this the obvious way out of a
 *      held row is to add the typo to the catalogue, which recreates exactly
 *      the split ledger the gate exists to prevent.
 *   5. THE QUIET CASE. A model one GENERATION away is not offered as a
 *      correction. A catalogue is full of names one character apart on
 *      purpose, and a suggestion that points at the adjacent generation would
 *      file the sale of an S24 against the S23.
 *   6. Confirming writes: the reconciled unit is sold, and NOTHING from the
 *      held row reached the database — no unit, no model, no supplier.
 *
 * Every assertion that can read the STORE reads the store. A preview tile
 * showing "1" proves what was rendered, not what was written, and here it is
 * the write that matters.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eSalesImportGate.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { writeRowByHeader, clearDataRows } from './e2eSheetHelpers.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/sales-import-gate');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const SALES_FILE = resolve('/tmp', 'e2e-sales-import-gate.xlsx');

// ── Fixtures ────────────────────────────────────────────────────────────────

const CATALOGUE_MODEL = 'iPhone 13';
/** One character from CATALOGUE_MODEL, generation digits intact — a typo. */
const TYPO_MODEL      = 'iPhoen 13';
/** In the catalogue, so the row that carries it is held on its SUPPLIER only. */
const SECOND_MODEL    = 'Galaxy S23 Ultra';
/** One GENERATION from SECOND_MODEL. Must NOT be offered as a correction. */
const GENERATION_MODEL = 'Galaxy S24 Ultra';

const KNOWN_SUPPLIER  = 'MOBILE WHOLESALE LTD';
const UNKNOWN_SUPPLIER = 'NEVER HEARD OF THEM LTD';

/** Reconciles against a unit seeded below. */
const MATCHED_IMEI = '359999999999801';
/** Orphans — no unit on file, so each becomes a completion row. */
const TYPO_IMEI    = '359999999999802';
const GEN_IMEI     = '359999999999803';
const SUPPLIER_IMEI = '359999999999804';

const ROWS = [
  // 2 — matches seeded stock, catalogued model, known supplier  → reconciles
  { 'Date': '2026-08-01', 'Order Number': 'SG-1001', 'SKU': 'SKU-1', 'IMEI': MATCHED_IMEI,
    'Model': CATALOGUE_MODEL, 'Supplier': KNOWN_SUPPLIER, 'BP': 200, 'SP': 300, 'Postage': 0 },
  // 3 — orphan on a typo of a catalogued model                  → HELD + suggestion
  { 'Date': '2026-08-01', 'Order Number': 'SG-1002', 'SKU': 'SKU-2', 'IMEI': TYPO_IMEI,
    'Model': TYPO_MODEL, 'Supplier': KNOWN_SUPPLIER, 'BP': 210, 'SP': 310, 'Postage': 0 },
  // 4 — orphan on the NEXT GENERATION of a catalogued model     → HELD, no suggestion
  { 'Date': '2026-08-01', 'Order Number': 'SG-1003', 'SKU': 'SKU-3', 'IMEI': GEN_IMEI,
    'Model': GENERATION_MODEL, 'Supplier': KNOWN_SUPPLIER, 'BP': 400, 'SP': 520, 'Postage': 0 },
  // 5 — catalogued model, supplier nobody has ever added        → HELD on supplier
  { 'Date': '2026-08-01', 'Order Number': 'SG-1004', 'SKU': 'SKU-4', 'IMEI': SUPPLIER_IMEI,
    'Model': SECOND_MODEL, 'Supplier': UNKNOWN_SUPPLIER, 'BP': 380, 'SP': 500, 'Postage': 0 },
];

/** Cloned from the shipped template so the sheet name and header order match
 *  exactly what a real upload looks like, and addressed BY HEADER so a column
 *  reorder fails loudly here instead of producing an empty preview. */
async function buildSalesFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  clearDataRows(ws);
  ROWS.forEach((r, i) => writeRowByHeader(ws, i + 2, r));
  await wb.xlsx.writeFile(SALES_FILE);
}

// ── Harness ─────────────────────────────────────────────────────────────────

let failures = 0, checks = 0;
function check(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
}

await buildSalesFile();

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const page = await ctx.newPage();
const jsErrors = [];
page.on('pageerror', e => { jsErrors.push(String(e)); console.log(`  [pageerror] ${e.message}`); });

// Seed: two catalogue models, one supplier, one unit for the row that should
// reconcile. Written straight into the store — this script is about the
// importer, and driving Add Stock four times would only add ways to fail that
// have nothing to do with what is being tested.
await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(({ models, supplier, imei, model }) => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  s.models = {};
  models.forEach((m, i) => {
    s.models[`mdl-seed-${i}`] = { id: `mdl-seed-${i}`, brand: m.brand, model: m.model,
                                  ownerId: 'shared', createdAt: '2026-01-01' };
  });
  s.suppliers = { 'sup-seed': { id: 'sup-seed', name: supplier, ownerId: 'shared',
                                createdAt: '2026-01-01' } };
  s.inventoryUnits = s.inventoryUnits || {};
  s.inventoryUnits['unit-seed'] = {
    id: 'unit-seed', imei, model, storage: '128GB', colour: 'Black',
    status: 'available', buyPrice: 200, dateIn: '2026-07-01', supplierName: supplier,
    flags: [], platformListed: false, ownerId: 'shared', createdAt: '2026-07-01',
  };
  sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s));
}, {
  models: [{ brand: 'Apple', model: CATALOGUE_MODEL }, { brand: 'Samsung', model: SECOND_MODEL }],
  supplier: KNOWN_SUPPLIER, imei: MATCHED_IMEI, model: CATALOGUE_MODEL,
});
// goto, NOT reload: reload repeats ?e2eReset=1 and wipes the seed, which reads
// as "the gate holds everything" and looks like a product bug rather than a
// fixture one.
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// ── 1 · The route is reachable ──────────────────────────────────────────────
console.log('\n1 · route reachable');
const btn = page.getByRole('button', { name: /Import Sales Report/i }).first();
check('sales import button visible to admin', await btn.isVisible().catch(() => false), true);

await btn.click();
await page.waitForTimeout(800);
await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
await page.waitForTimeout(3000);
const modal = page.locator('div.fixed.inset-0').last();
await modal.screenshot({ path: `${OUT}/01-preview.png` });

// ── 2 · The gate holds what it does not know ────────────────────────────────
console.log('\n2 · the gate');
let text = await modal.innerText();
check('the unknown model is named as not in the catalog', /model not in catalog/i.test(text), true);
check('the unknown supplier is named as not on file', /supplier not on file/i.test(text), true);

/** The Confirm button — the only emerald one in the footer. Matching on its
 *  LABEL is not an option: it renames itself to "Complete N records to
 *  continue" while blocked, which is the state under test. */
const confirmButton = (m) => m.locator('button.bg-emerald-600').last();

check('Confirm is disabled while rows are held',
  await confirmButton(modal).isDisabled().catch(() => null), true);

// ── 3 · The recommendation ──────────────────────────────────────────────────
console.log('\n3 · did you mean');
const modelSuggestion = modal.getByRole('button', { name: /Model: did you mean/i });
check('exactly one model suggestion is offered', await modelSuggestion.count(), 1);
check('it names the catalogue spelling',
  new RegExp(CATALOGUE_MODEL, 'i').test(await modelSuggestion.first().innerText()), true);

// The quiet case: nothing points GENERATION_MODEL at SECOND_MODEL.
check('no suggestion mentions the adjacent generation',
  /did you mean [^\n]*S23/i.test(text), false);

const supplierSuggestion = modal.getByRole('button', { name: /Supplier: did you mean/i });
check('an invented supplier resembling nothing gets no suggestion',
  await supplierSuggestion.count(), 0);

await modal.screenshot({ path: `${OUT}/02-held-with-suggestion.png` });

// Taking it must actually clear that row's block.
await modelSuggestion.first().click();
await page.waitForTimeout(600);
text = await modal.innerText();
check('taking the suggestion removes that row from the held count',
  (text.match(/model not in catalog/gi) || []).length, 1);   // the generation row remains
await modal.screenshot({ path: `${OUT}/03-suggestion-taken.png` });

// ── 4 · Clearing the rest, then confirming ──────────────────────────────────
console.log('\n4 · confirm writes the known rows and nothing else');
// The two rows that cannot be corrected onto existing names are removed from
// the file rather than forced through — which is the operator's real choice:
// add the model in Configuration / the supplier in Admin, or leave them out.
ROWS.splice(2, 2);
await buildSalesFile();
await modal.getByRole('button', { name: /Pick another file/i }).click();
await page.waitForTimeout(600);
await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
await page.waitForTimeout(3000);

// Row 3 still carries the typo — correct it via the suggestion, as an
// operator would, rather than by typing the right name and proving nothing.
const again = modal.getByRole('button', { name: /Model: did you mean/i });
if (await again.count() > 0) { await again.first().click(); await page.waitForTimeout(600); }

const ack = modal.locator('input[type="checkbox"]');
for (let i = 0; i < await ack.count(); i++) {
  const box = ack.nth(i);
  if (await box.isChecked().catch(() => true)) continue;
  const label = await box.evaluate(el => el.closest('label')?.innerText || '').catch(() => '');
  if (/flip|sold/i.test(label)) await box.check().catch(() => {});
}
await page.waitForTimeout(400);

const confirm2 = confirmButton(modal);
check('Confirm enables once nothing is held', await confirm2.isDisabled().catch(() => null), false);
await modal.screenshot({ path: `${OUT}/04-ready-to-confirm.png` });

await confirm2.click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/05-after-confirm.png`, fullPage: true });

const written = await page.evaluate(({ matched, typo, gen, sup, typoModel, genModel, unknownSupplier }) => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  const units = Object.values(s.inventoryUnits || {});
  const models = Object.values(s.models || {});
  const suppliers = Object.values(s.suppliers || {});
  const lower = (v) => String(v || '').toLowerCase();
  return {
    matchedSold: units.filter(u => u.imei === matched && u.status === 'sold').length,
    typoUnit: units.filter(u => u.imei === typo).length,
    generationUnit: units.filter(u => u.imei === gen).length,
    unknownSupplierUnit: units.filter(u => u.imei === sup).length,
    typoModelCreated: models.filter(m => lower(m.model) === lower(typoModel)).length,
    generationModelCreated: models.filter(m => lower(m.model) === lower(genModel)).length,
    unknownSupplierCreated: suppliers.filter(x => lower(x.name) === lower(unknownSupplier)).length,
  };
}, {
  matched: MATCHED_IMEI, typo: TYPO_IMEI, gen: GEN_IMEI, sup: SUPPLIER_IMEI,
  typoModel: TYPO_MODEL, genModel: GENERATION_MODEL, unknownSupplier: UNKNOWN_SUPPLIER,
});

check('the reconciled unit is marked sold', written.matchedSold, 1);
check('the corrected orphan did NOT create a model under the typo', written.typoModelCreated, 0);
check('the row left out of the file created no unit', written.generationUnit, 0);
check('...and no model', written.generationModelCreated, 0);
check('the unknown-supplier row created no unit', written.unknownSupplierUnit, 0);
check('...and no supplier', written.unknownSupplierCreated, 0);

check('no uncaught page errors', jsErrors, []);

console.log(`\n${failures === 0 ? 'ok' : 'FAILED'} — ${checks - failures}/${checks} checks`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
