/**
 * scripts/e2eShsOrphanFlow.mjs — the direct-shipment walkthrough.
 *
 * The question this answers: a sales report lands, and some rows are for
 * phones the supplier shipped straight to the customer. Those arrive as
 * ORPHANS, because the IMEI on them is one we have never seen — the holding
 * that covers them never had an IMEI, since the phone had not shipped when we
 * recorded it. So how does the operator close the holding?
 *
 * Answer: on the import's audit screen, using the controls that are already
 * there. Enter the model, and set that row's Office/SHS toggle to SHS. That
 * toggle is the ONLY signal separating "the supplier shipped this" from
 * "history is being replayed on a restore", and the app will not guess.
 *
 * Every step is screenshotted, in order, so the sequence can be read without
 * running it.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/shs-orphan-flow';
const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const SALES_FILE = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');

/** The sample's supplier-shipped row: an IPHONE 14 held by NORTHSIDE STOCK. */
const DIRECT_SHIPMENT = { order: 'AMA-SHS-1', model: 'IPHONE 14', supplier: 'NORTHSIDE STOCK' };
/** A catalog model with NO holding — used for the other orphans so exactly
 *  one holding is consumed and every count below is exact. */
const NEUTRAL_MODEL = 'IPHONE 13';

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
    await page.waitForTimeout(350);
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
  await page.waitForTimeout(1000);
}

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    const units = Object.values(s.inventoryUnits || {});
    return {
      holdings: units.filter(u => u.status === 'incoming'),
      sold: units.filter(u => u.status === 'sold'),
      sales: Object.values(s.sales || {}),
    };
  });
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ══ STEP 1 · Start clean ═════════════════════════════════════════════════
  console.log('\n── 1. Wipe ──');
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
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'step1-empty-database');

  // ══ STEP 2 · Record the holdings — no IMEIs ══════════════════════════════
  console.log('\n── 2. Import stock, including 10 supplier holdings with NO IMEI ──');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await shot(page, 'step2-inventory-preview-office-and-shs');
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'step3-shs-tile-shows-10-holdings');

  const before = await readStore(page);
  record('holdings are recorded with NO IMEI at all',
    before.holdings.length === 10 && before.holdings.every(u => !String(u.imei || '').trim()),
    `${before.holdings.length} holdings · ${before.holdings.filter(u => String(u.imei || '').trim()).length} carry an IMEI`);

  const target = before.holdings.find(u =>
    (u.model || '').includes('14') && (u.supplierName || '').includes('NORTHSIDE'));
  record(`a holding exists for ${DIRECT_SHIPMENT.model} / ${DIRECT_SHIPMENT.supplier}`,
    !!target, target ? `id ${target.id}` : 'not found');

  // ══ STEP 3 · The sales report arrives ════════════════════════════════════
  console.log('\n── 3. Upload the sales report — the direct shipment lands as an ORPHAN ──');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);
  await shot(page, 'step4-sales-preview');

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  let confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  const blocked = await confirm.isDisabled().catch(() => false);
  record('the import REFUSES to confirm while orphans are incomplete', blocked,
    (await confirm.textContent().catch(() => ''))?.trim());
  await shot(page, 'step5-audit-blocked-orphans-need-completing');

  // Clear the "show only rows still needing attention" filter first. It is ON
  // by default (SalesReportImport.tsx: showIncompleteOnly = useState(true)),
  // and this orphan is already complete — the file names its model and
  // supplier — so it is not rendered at all. The index search below then
  // returned -1 and every SHS assertion after it failed, which reads like the
  // audit screen dropping a direct shipment and is nothing of the kind.
  const attentionFilter = modal(page)
    .getByRole('checkbox', { name: /still needing attention/i }).first();
  if (await attentionFilter.isChecked().catch(() => false)) {
    await attentionFilter.uncheck().catch(() => {});
    await page.waitForTimeout(500);
  }

  // Find the direct shipment's row BY INDEX.
  //
  // A div-container filter looked right and wasn't: the innermost div holding
  // both the order number and a model input still wrapped several rows, so
  // clicking "the first SHS button inside it" marked a DIFFERENT orphan. The
  // wrong holding closed and the real one stayed open — a failure that looks
  // like success on every count.
  //
  // The audit rows are parallel lists, so pairing them by position is exact.
  const orphanIndex = await page.evaluate((order) => {
    const SEL = 'input[placeholder="Search model…"]';
    const boxes = [...document.querySelectorAll(SEL)];
    return boxes.findIndex((box) => {
      // Walk up only while the ancestor still holds exactly ONE model input.
      // The moment it holds two, we have left this row. Without that bound
      // the walk reaches a container wrapping every row, whose text contains
      // the order number — so the FIRST row matched every time.
      let row = box.parentElement;
      let n = row;
      for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
        if (n.querySelectorAll(SEL).length > 1) break;
        row = n;
      }
      return (row.textContent || '').includes(order);
    });
  }, DIRECT_SHIPMENT.order);
  record('the direct shipment appears on the audit screen as an orphan',
    orphanIndex >= 0, `${DIRECT_SHIPMENT.order} at row ${orphanIndex}`);
  await shot(page, 'step6-the-orphan-row-for-the-direct-shipment');

  // ══ STEP 4 · The operator identifies it ══════════════════════════════════
  console.log('\n── 4. Operator states the model and marks the row SHS ──');
  const shsModelBox = modal(page).locator('input[placeholder="Search model…"]').nth(orphanIndex);
  await shsModelBox.scrollIntoViewIfNeeded().catch(() => {});
  // Through the dropdown, not by typing and tabbing away. The picker became
  // catalog-strict in 2026-08, so a free-typed model commits nothing and the
  // row stays incomplete.
  await shsModelBox.click();
  await shsModelBox.fill(DIRECT_SHIPMENT.model);
  await page.waitForTimeout(400);
  await page.locator('div.z-\\[9999\\] button').first().click()
    .catch(async () => { await shsModelBox.press('Enter'); });
  await page.waitForTimeout(400);
  record('the model is committed through the catalog picker',
    (await shsModelBox.inputValue().catch(() => '')) !== '',
    DIRECT_SHIPMENT.model);
  await shot(page, 'step7-model-entered');

  // Same pairing for the toggle: the Nth orphan's SHS button.
  const shsToggle = modal(page).getByRole('button', { name: /^SHS$/ }).nth(orphanIndex);
  record('the row offers an Office / SHS toggle',
    await shsToggle.isVisible().catch(() => false),
    'the only signal that separates a direct shipment from a replayed sale');
  await shsToggle.click();
  await page.waitForTimeout(500);
  await shot(page, 'step8-row-marked-SHS');

  // Everything else gets a model with no holding, so exactly one closes.
  const fill = async (sel, v) => {
    const loc = modal(page).locator(sel);
    for (let i = 0; i < await loc.count(); i++) {
      const b = loc.nth(i);
      if ((await b.inputValue().catch(() => 'x')) === '') {
        await b.fill(v); await b.press('Tab'); await page.waitForTimeout(120);
      }
    }
  };
  await fill('input[placeholder="IMEI required"]', '350000000000999');
  await fill('input[placeholder="Search model…"]', NEUTRAL_MODEL);
  await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
  const nums = modal(page).locator('input[type="number"]');
  for (let i = 0; i < await nums.count(); i++) {
    const b = nums.nth(i);
    const v = await b.inputValue().catch(() => '1');
    if (!v || Number(v) === 0) { await b.fill('200'); await b.press('Tab'); await page.waitForTimeout(120); }
  }
  await page.waitForTimeout(800);
  await shot(page, 'step9-all-orphans-completed');

  confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  record('Confirm unlocks once every orphan is complete',
    !(await confirm.isDisabled().catch(() => true)),
    (await confirm.textContent().catch(() => ''))?.trim());

  // ══ STEP 5 · Confirm, and read what happened ════════════════════════════
  console.log('\n── 5. Confirm ──');
  await confirm.click();
  await page.waitForTimeout(9000);
  const done = await modal(page).innerText().catch(() => '');
  await shot(page, 'step10-done-screen-reports-the-fulfilment');

  record('the Done screen reports the SHS fulfilment', /SHS fulfilled/i.test(done),
    (done.match(/SHS fulfilled[^\n]*/i) || [])[0] || 'not reported');

  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(2000);
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'step11-shs-tile-dropped-to-9');

  // ══ STEP 6 · The consequences ═══════════════════════════════════════════
  const after = await readStore(page);
  record('exactly ONE holding was closed — not the whole model line',
    after.holdings.length === before.holdings.length - 1,
    `${before.holdings.length} → ${after.holdings.length}`);

  record('the closed holding is the one that matched model + supplier',
    !after.holdings.some(u => (u.model || '').includes('14') && (u.supplierName || '').includes('NORTHSIDE')),
    `${DIRECT_SHIPMENT.model} / ${DIRECT_SHIPMENT.supplier} no longer held`);

  const shipped = after.sold.find(u => (u.saleOrderId || '') === DIRECT_SHIPMENT.order);
  record('the shipped phone is now a SOLD unit', !!shipped,
    shipped ? `imei ${shipped.imei}` : 'not found');

  record('it carries the real IMEI the supplier shipped',
    !!shipped && !!String(shipped.imei || '').trim(),
    shipped ? shipped.imei : '—');

  record('the sale is tagged as SHS revenue, not office',
    !!shipped && shipped.stockSource === 'shs',
    shipped ? `stockSource=${shipped.stockSource}` : '—');

  record('every other holding is untouched',
    after.holdings.length === 9 && after.holdings.every(u => !String(u.imei || '').trim()),
    `${after.holdings.length} still open, all IMEI-less`);

  // The SHS overlay, as the operator sees it.
  const shsTile = page.getByText(/SHS STOCK/i).first();
  if (await shsTile.isVisible().catch(() => false)) {
    await shsTile.click().catch(() => {});
    await page.waitForTimeout(1500);
    await shot(page, 'step12-shs-overlay-remaining-holdings');
    await dismissModals(page);
  }

  record('no uncaught JS errors across the flow', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
