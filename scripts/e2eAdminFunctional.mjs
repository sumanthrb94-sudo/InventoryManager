/**
 * scripts/e2eAdminFunctional.mjs — admin things that WRITE, actually driven.
 *
 * The earlier admin suite checked that sections render and that removed ones
 * stayed removed. It never created anything. That gap is exactly how a live
 * screenshot came back showing a Platform Scorecard reading zero on 354 real
 * sales and a supplier list with the same name on it twice — asserting a
 * heading exists proves nothing about the numbers underneath it.
 *
 * So this drives the write paths and then checks the CONSEQUENCE:
 *
 *   1. Create a model in Configuration → it appears in the catalog
 *   2. Create it again → the duplicate is refused, not silently added
 *   3. Create a supplier → it appears, and Data Health stays quiet
 *   4. Create the same supplier again → Data Health CATCHES the duplicate
 *   5. Import sales → the Platform Scorecard shows them (the screenshot bug)
 *   6. Insights renders real figures, not zeros beside a non-zero total
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAdminFunctional.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/admin-functional';
const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const SALES_FILE = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');

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
    return {
      models: Object.values(s.models || {}),
      suppliers: Object.values(s.suppliers || {}),
      units: Object.values(s.inventoryUnits || {}),
      sales: Object.values(s.sales || {}),
    };
  });
}

async function gotoConfiguration(page) {
  await gotoTab(page, 'Admin');
  await page.getByRole('button', { name: /^Configuration$/i }).first().click();
  await page.waitForTimeout(1500);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── 1. Create a model ───────────────────────────────────────────────────
  await gotoConfiguration(page);
  await shot(page, 'configuration');
  const before = await readStore(page);

  // The Models Catalog form labels its inputs by EXAMPLE, not by field name:
  // Brand shows "Samsung", Model shows "Galaxy S24 Ultra", Series "Galaxy S".
  const brandBox = page.getByPlaceholder('Samsung').first();
  const modelBox = page.getByPlaceholder('Galaxy S24 Ultra').first();
  const hasForm = await brandBox.isVisible().catch(() => false) && await modelBox.isVisible().catch(() => false);
  record('Configuration exposes a model-creation form', hasForm);

  if (hasForm) {
    await brandBox.fill('NOTHING');
    await modelBox.fill('PHONE 2A');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^Add( model)?$/i }).first().click();
    await page.waitForTimeout(2500);
    await shot(page, 'model-added');

    const after = await readStore(page);
    record('a new model is written to the catalog',
      after.models.length === before.models.length + 1,
      `${before.models.length} → ${after.models.length}`);
    record('the new model is visible in the table',
      (await page.locator('body').innerText()).includes('PHONE 2A'));

    // ── 2. The same model again ───────────────────────────────────────────
    await brandBox.fill('NOTHING');
    await modelBox.fill('PHONE 2A');
    await page.waitForTimeout(300);
    const addBtn = page.getByRole('button', { name: /^Add( model)?$/i }).first();
    const blocked = await addBtn.isDisabled().catch(() => false);
    if (!blocked) { await addBtn.click(); await page.waitForTimeout(2500); }
    const afterDupe = await readStore(page);
    record('adding the same model twice does not create a second catalog row',
      afterDupe.models.length === after.models.length,
      blocked ? 'Add disabled on a duplicate' : `${after.models.length} → ${afterDupe.models.length}`);
    await shot(page, 'model-duplicate-attempt');
  }

  // ── 3 + 4. Create a supplier, then create it again ─────────────────────
  await gotoConfiguration(page);
  const beforeSup = await readStore(page);
  // The supplier form is collapsed behind an "Add" button inside the embedded
  // Suppliers panel — it is not on screen until asked for. Configuration has
  // TWO buttons labelled exactly "Add" (models catalog, then suppliers), so
  // scope to the Suppliers section rather than taking the first match.
  // Configuration renders Models Catalog first and the embedded Suppliers
  // panel last, so the second "Add" is the supplier one. Indexing beats a
  // container filter here: both buttons carry identical text and the panels
  // share wrapper markup.
  const openAdd = page.getByRole('button', { name: /^Add$/i }).nth(1);
  if (await openAdd.isVisible().catch(() => false)) {
    await openAdd.scrollIntoViewIfNeeded().catch(() => {});
    await openAdd.click();
    await page.waitForTimeout(900);
  }
  const supBox = page.getByPlaceholder('Supplier name').first();
  const hasSupplierForm = await supBox.isVisible().catch(() => false);
  record('Configuration exposes a supplier-creation form', hasSupplierForm);

  if (hasSupplierForm) {
    await supBox.fill('TEST DEPOT LTD');
    await page.waitForTimeout(300);
    await supBox.press('Enter');
    await page.waitForTimeout(3000);
    const afterSup = await readStore(page);
    record('a new supplier is written',
      afterSup.suppliers.length === beforeSup.suppliers.length + 1,
      `${beforeSup.suppliers.length} → ${afterSup.suppliers.length}`);
    await shot(page, 'supplier-added');

    // The screenshot bug: the same supplier recorded twice, one row carrying
    // every sale and the other showing zero.
    const reopen = page.getByRole('button', { name: /^Add$/i }).nth(1);
    if (await reopen.isVisible().catch(() => false)) {
      await reopen.scrollIntoViewIfNeeded().catch(() => {});
      await reopen.click();
      await page.waitForTimeout(900);
    }
    const supBox2 = page.getByPlaceholder('Supplier name').first();
    await supBox2.fill('TEST DEPOT LTD');
    await page.waitForTimeout(300);
    await supBox2.press('Enter');
    await page.waitForTimeout(3000);
    const afterDupeSup = await readStore(page);
    const created = afterDupeSup.suppliers.length - afterSup.suppliers.length;
    record('a duplicate supplier is either refused OR caught by Data Health',
      created === 0 || (await page.locator('body').innerText()).includes('Suppliers recorded more than once'),
      created === 0 ? 'refused at the form' : 'created, and Data Health flags it');
    await shot(page, 'supplier-duplicate');
  }

  // ── 5. Import real sales, then check the Platform Scorecard ────────────
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);

  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);
  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }
  let confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) {
    const fill = async (sel, v) => {
      const loc = modal(page).locator(sel);
      for (let i = 0; i < await loc.count(); i++) {
        const b = loc.nth(i);
        if ((await b.inputValue().catch(() => 'x')) === '') { await b.fill(v); await b.press('Tab'); await page.waitForTimeout(120); }
      }
    };
    await fill('input[placeholder="IMEI required"]', '350190000009999');
    await fill('input[placeholder="Search model…"]', 'IPHONE 12');
    await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
    const nums = modal(page).locator('input[type="number"]');
    for (let i = 0; i < await nums.count(); i++) {
      const b = nums.nth(i);
      const v = await b.inputValue().catch(() => '1');
      if (!v || Number(v) === 0) { await b.fill('200'); await b.press('Tab'); await page.waitForTimeout(120); }
    }
    await page.waitForTimeout(700);
    confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  }
  await confirm.click();
  await page.waitForTimeout(9000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(2000);
  await dismissModals(page);

  const db = await readStore(page);
  const soldUnits = db.units.filter(u => u.status === 'sold');
  console.log(`\nimported ${db.sales.length} sales · ${soldUnits.length} units marked sold`);

  // What the scorecard SHOULD show, computed from the store.
  const ALIASES = {
    Amazon: ['amazon', 'amz', 'fba'],
    Backmarket: ['bm', 'backmarket', 'back market'],
    eBay: ['ebay', 'e-bay'],
    OnBuy: ['onbuy', 'on buy'],
  };
  const expected = {};
  for (const [label, aliases] of Object.entries(ALIASES)) {
    expected[label] = soldUnits.filter(u =>
      aliases.includes(String(u.salePlatform || '').trim().toLowerCase())).length;
  }
  console.log('expected scorecard:', JSON.stringify(expected));

  await gotoTab(page, 'Admin');
  await page.getByRole('button', { name: /^Insights$/i }).first().click();
  await page.waitForTimeout(2000);
  const scorecard = page.getByRole('button', { name: /Platform Scorecard/i }).first();
  if (await scorecard.isVisible().catch(() => false)) {
    await scorecard.click();
    await page.waitForTimeout(1200);
  }
  await shot(page, 'platform-scorecard');

  const insightsText = await page.locator('body').innerText();
  const shownFor = (label) => {
    const m = new RegExp(`${label}\\s*\\n+\\s*([\\d,]+)\\s*\\n+\\s*units sold`, 'i').exec(insightsText);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  const totalExpected = Object.values(expected).reduce((a, b) => a + b, 0);
  record('the imported sales produced sold units to report on', totalExpected > 0,
    `${totalExpected} sold units across the marketplaces`);

  let scorecardOk = true;
  const detail = [];
  for (const label of Object.keys(ALIASES)) {
    const shown = shownFor(label);
    detail.push(`${label} ${shown ?? '?'}/${expected[label]}`);
    if (shown !== expected[label]) scorecardOk = false;
  }
  record('Platform Scorecard counts the imported sales', scorecardOk, detail.join(' · '));

  record('the scorecard is not uniformly zero while sales exist',
    !Object.keys(ALIASES).every(l => (shownFor(l) ?? 0) === 0) || totalExpected === 0,
    'the exact failure the live screenshot showed');

  // ── 6. Data Health sees the real data ──────────────────────────────────
  await gotoConfiguration(page);
  await page.waitForTimeout(1200);
  await shot(page, 'data-health-live');
  const healthText = await page.locator('body').innerText();
  record('Data Health runs the duplicate-supplier check',
    healthText.includes('Suppliers recorded more than once'));
  record('Data Health runs the unrecognised-platform check',
    healthText.includes('Sold stock with an unrecognised platform'));

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

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
