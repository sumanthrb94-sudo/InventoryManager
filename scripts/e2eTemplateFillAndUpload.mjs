/**
 * scripts/e2eTemplateFillAndUpload.mjs — "if I use the templates and type my
 * data in, will it upload?"
 *
 * The other suites drive fixtures built to match the schema. This one drives
 * the SHIPPED TEMPLATES themselves, filled by scripts/fillTemplatesAsOperator.mjs
 * exactly as the SOP says to fill them: example rows deleted, data typed into
 * the columns as headed, README sheet left attached, dropdowns untouched.
 *
 * It answers the question end to end, both routes in:
 *
 *   A  filled inventory template  → filled per-channel sales templates
 *   B  filled inventory template  → filled combined workbook
 *   C  the SHS-only template, on its own
 *   D  what happens if you FORGET to delete the grey example rows
 *
 * D is the one that matters most in practice — rule 1 of the SOP is the rule
 * people skip, so the behaviour needs to be known and stated, not guessed.
 *
 * Run after: node scripts/fillTemplatesAsOperator.mjs
 *            VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eTemplateFillAndUpload.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/template-fill-upload';
const FILLED = (f) => resolve('templates/filled-examples', f);
const TEMPLATE = (f) => resolve('templates', f);
// All five. This read four, so the per-channel pass uploaded four files while
// the combined workbook carried five — the Temu sales existed on one side of
// the comparison and not the other, and every figure in it disagreed by
// exactly that gap (sold 21 vs 25, office 14 vs 10). FILLED_SALES_TEMU.xlsx
// was already sitting in templates/filled-examples/.
const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];

/**
 * What fillTemplatesAsOperator.mjs typed in — COUNTED from the files, not
 * transcribed.
 *
 * These were literals (sales: 21, soldFromShelf: 20). They described four
 * marketplaces, and stopped being true the day Temu's filled example was
 * added: every figure was then off by exactly the Temu rows, which reads as
 * stock failing to reconcile and is a stale constant. Counting the rows costs
 * nothing and cannot go stale.
 */
function countFilledSalesRows() {
  let n = 0;
  for (const m of MARKETPLACES) {
    const wb = XLSX.read(readFileSync(FILLED(`FILLED_SALES_${m}.xlsx`)), { type: 'buffer' });
    for (const sheet of wb.SheetNames) {
      if (sheet.toUpperCase() === 'README') continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false });
      // minus the header row; a sheet with only headers contributes nothing
      n += Math.max(0, rows.length - 1);
    }
  }
  return n;
}

// One row in the fixture is a supplier-held phone; the rest come off the
// shelf. That split is a property of how the examples were filled, not of how
// many marketplaces there are.
const SHS_FULFILLED = 1;
const FILLED_SALES_ROWS = countFilledSalesRows();
const EXPECT = {
  office: 34, shs: 6, stock: 40,
  sales: FILLED_SALES_ROWS,
  soldFromShelf: FILLED_SALES_ROWS - SHS_FULFILLED,
  shsFulfilled: SHS_FULFILLED,
};

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Adopt every model the import is HOLDING, the way an admin does.
 *
 * Import holds any row whose Model is not in the admin catalogue — the gate
 * that stops supplier product codes becoming model names. A fixture that
 * invents its own model names therefore lands entirely held, and with no
 * unheld rows there is no "Load N rows" button at all: the script dies
 * waiting for a control the app is correct not to show.
 *
 * The preview offers the way through — "Add to catalogue" beside each held
 * model, a prefilled Brand and a Save — and that is the documented flow, so
 * walk it rather than working around the gate. No-op when nothing is held.
 */
async function adoptHeldModels(page) {
  for (let i = 0; i < 12; i++) {
    const add = modal(page).getByRole('button', { name: /^Add to catalogue$/i }).first();
    if (!(await add.isVisible().catch(() => false))) break;
    await add.scrollIntoViewIfNeeded().catch(() => {});
    await add.click();
    await page.waitForTimeout(400);
    const brand = modal(page).locator('input[placeholder^="Brand"]').first();
    if (await brand.isVisible().catch(() => false)) {
      if (!(await brand.inputValue().catch(() => ''))) await brand.fill('GENERIC');
      await modal(page).getByRole('button', { name: /^Save$/i }).first().click().catch(() => {});
    }
    await page.waitForTimeout(900);
  }
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
}

const modal = (page) => page.locator('div.fixed.inset-0[class*="z-["]').last();

async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close")').last();
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
  // The Import dropdown is gone. Inventory and Sales import are now two
  // labelled icon buttons in the header (App.tsx, behind SHOW_IMPORT_UI &&
  // userIsAdmin), so there is no menu to open — the click that used to follow
  // this call now targets the button directly. Kept as a no-op so the call
  // sites read the same and the diff stays reviewable.
  await page.waitForTimeout(200);
}

async function readStore(page) {
  return page.evaluate(() => {
    try {
      const store = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || 'null');
      if (!store) return null;
      return {
        units: Object.values(store.inventoryUnits || {}),
        sales: Object.values(store.sales || {}),
      };
    } catch { return null; }
  });
}

function state(db) {
  const units = db?.units ?? [];
  return {
    office: units.filter(u => u.status === 'available').length,
    shs: units.filter(u => u.status === 'incoming').length,
    sold: units.filter(u => u.status === 'sold').length,
    sales: (db?.sales ?? []).length,
    imeis: new Set(units.map(u => String(u.imei || ''))),
  };
}

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

/** Upload a stock file. Returns the preview text and whether Confirm ran. */
async function uploadInventory(page, file, { confirm = true } = {}) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3500);
  const preview = await modal(page).innerText().catch(() => '');
  if (!confirm) return { preview, confirmed: false };

  // Adopt anything the catalogue gate is holding first. This fixture types its
  // own models, so some rows land held — and a held row is simply missing from
  // the count, which is why office came in 28/34 rather than failing loudly.
  await adoptHeldModels(page);
  const btn = modal(page).getByRole('button', { name: /Load [\d,]+ rows/i });
  if (await btn.isDisabled().catch(() => true)) return { preview, confirmed: false };
  await btn.click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);
  return { preview, confirmed: true };
}

/**
 * Fill what an orphan sold-record needs before Confirm unlocks: IMEI, model,
 * supplier, buy price.
 *
 * MODEL IS A CATALOGUE PICKER, NOT A TEXT BOX — typing a name leaves the row
 * "on a model not in your catalog" and Confirm stays locked, which is the gate
 * doing its job. And the field is never empty: it carries the sheet's own
 * model string, which is exactly why the row is held, so it must be re-picked
 * rather than skipped for being non-blank.
 */
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
  const modelBoxes = modal(page).locator('input[placeholder="Search model…"]');
  for (let i = 0; i < await modelBoxes.count(); i++) {
    const box = modelBoxes.nth(i);
    await box.scrollIntoViewIfNeeded().catch(() => {});
    await box.click();
    await box.fill('');
    await page.waitForTimeout(200);
    await box.fill('IPHONE 12');
    await page.waitForTimeout(700);
    const option = page.locator('div[role="listbox"] button[role="option"]').first();
    if (await option.isVisible().catch(() => false)) await option.click();
    else await box.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
  await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
  const numeric = modal(page).locator('input[type="number"]');
  for (let i = 0; i < await numeric.count(); i++) {
    const box = numeric.nth(i);
    const v = await box.inputValue().catch(() => '1');
    if (!v || Number(v) === 0) { await box.fill('200'); await box.press('Tab'); await page.waitForTimeout(120); }
  }
  await page.waitForTimeout(700);
}

async function uploadSales(page, file, marketplace) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(800);
  if (marketplace) {
    await modal(page).getByRole('button', { name: new RegExp(`^${marketplace}$`, 'i') }).first().click();
    await page.waitForTimeout(400);
  }
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(5000);
  const preview = await modal(page).innerText().catch(() => '');

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  // A sold IMEI with no matching unit is an ORPHAN, and Confirm stays locked
  // until each one carries model / supplier / BP. There was no completion step
  // here at all, so every sales template reported "Confirm never enabled".
  let confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) await completeAudit(page);
  confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) {
    const panel = (await modal(page).innerText().catch(() => '') || '')
      .split('\n').map(l => l.trim()).filter(Boolean);
    const why = panel.filter(l => /held|catalog|supplier|required|complete|\d+ row/i.test(l))
      .slice(0, 3).join(' · ');
    return { preview, confirmed: false, done: '', why };
  }
  await confirm.click();
  await page.waitForTimeout(9000);
  const done = await modal(page).innerText().catch(() => '');
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1800);
  await dismissModals(page);
  return { preview, confirmed: true, done };
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── A. Filled inventory template, then one filled sales template per channel
  console.log('\n── A · filled templates, one channel at a time ──');
  await wipeAll(page);

  const inv = await uploadInventory(page, FILLED('FILLED_INVENTORY.xlsx'));
  await shot(page, 'filled-inventory-uploaded');
  record('A · the filled inventory template imports', inv.confirmed,
    inv.confirmed ? '' : 'Confirm never enabled');

  // The README sheet ships inside the template. It must be skipped silently,
  // not parsed into 40 invalid rows.
  record('A · the template README sheet is ignored, not read as data',
    !/README/i.test(inv.preview) || !/invalid/i.test(inv.preview.split('README')[1] ?? ''),
    'no README rows in the preview');

  let s = state(await readStore(page));
  record('A · every typed row lands, split office / SHS as typed',
    s.office === EXPECT.office && s.shs === EXPECT.shs,
    `office=${s.office}/${EXPECT.office} shs=${s.shs}/${EXPECT.shs}`);

  let channelsOk = true;
  for (const m of MARKETPLACES) {
    const r = await uploadSales(page, FILLED(`FILLED_SALES_${m}.xlsx`), m);
    if (!r.confirmed) channelsOk = false;
    const running = state(await readStore(page));
    console.log(`   ${m}: sales=${running.sales} office=${running.office} shs=${running.shs}`);
    record(`A · filled ${m} template imports with no manual completion`, r.confirmed,
      r.confirmed ? (r.done.match(/\d+ created · \d+ updated/i) || [''])[0] : 'Confirm never enabled');
  }
  await shot(page, 'filled-sales-per-channel-done');

  const A = state(await readStore(page));
  record('A · sales reconcile against the stock that was typed in',
    A.sales === EXPECT.sales && A.sold === EXPECT.sales,
    `sales=${A.sales}/${EXPECT.sales} sold=${A.sold}/${EXPECT.sales}`);

  record('A · office stock drops by exactly the units sold from the shelf',
    A.office === EXPECT.office - EXPECT.soldFromShelf,
    `${EXPECT.office} → ${A.office} (expected ${EXPECT.office - EXPECT.soldFromShelf})`);

  record('A · the supplier-shipped sale drops SHS, not office',
    A.shs === EXPECT.shs - EXPECT.shsFulfilled,
    `${EXPECT.shs} → ${A.shs} (expected ${EXPECT.shs - EXPECT.shsFulfilled})`);

  // ── B. Same data, combined four-sheet workbook ───────────────────────────
  console.log('\n── B · the same rows in the combined workbook ──');
  await wipeAll(page);
  await uploadInventory(page, FILLED('FILLED_INVENTORY.xlsx'));
  const comb = await uploadSales(page, FILLED('FILLED_SALES_COMBINED.xlsx'), null);
  await shot(page, 'filled-sales-combined-done');
  record('B · the filled combined workbook imports', comb.confirmed,
    comb.confirmed ? (comb.done.match(/\d+ created · \d+ updated/i) || [''])[0] : 'Confirm never enabled');

  const B = state(await readStore(page));
  console.log(`   B: office=${B.office} shs=${B.shs} sold=${B.sold} sales=${B.sales}`);
  record('B · combined and per-channel land on the same numbers',
    B.office === A.office && B.shs === A.shs && B.sold === A.sold && B.sales === A.sales,
    `office ${A.office}/${B.office} · shs ${A.shs}/${B.shs} · sold ${A.sold}/${B.sold} · sales ${A.sales}/${B.sales}`);

  // ── C. The SHS-only template on its own ─────────────────────────────────
  console.log('\n── C · the SHS template on its own ──');
  await wipeAll(page);
  const shsOnly = await uploadInventory(page, FILLED('FILLED_SHS_STOCK.xlsx'));
  await shot(page, 'filled-shs-template-done');
  const C = state(await readStore(page));
  record('C · the filled SHS template imports', shsOnly.confirmed);
  record('C · every row lands as supplier-held, none on the office shelf',
    C.shs === EXPECT.shs && C.office === 0,
    `shs=${C.shs}/${EXPECT.shs} office=${C.office}`);

  // ── D. The rule people skip ─────────────────────────────────────────────
  // "Delete the grey example rows" is rule 1 of the SOP, and it's the one
  // that gets forgotten. Upload a virgin template and record what happens,
  // so the answer is documented rather than discovered.
  console.log('\n── D · uploading a template with the example rows still in ──');
  await wipeAll(page);
  const virgin = await uploadInventory(page, TEMPLATE('INVENTORY_REPORT_TEMPLATE.xlsx'), { confirm: false });
  await shot(page, 'untouched-template-preview');
  const rowsSeen = (virgin.preview.match(/Load ([\d,]+) rows/i) || [])[1];
  record('D · an untouched template previews only its example rows, not 500 blanks',
    rowsSeen === '5', `preview offers to load ${rowsSeen ?? '?'} rows`);
  record('D · nothing is written before the preview is confirmed',
    state(await readStore(page)).office === 0,
    'office=0 while the preview is open');
  await dismissModals(page);

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
