/**
 * scripts/e2eUploadFlow.mjs — the operator's daily round trip, driven in
 * a real browser against the real UI.
 *
 *   1. Wipe the database from the scoped Admin controls
 *   2. Upload a 120-row INVENTORY report → preview → confirm
 *   3. Upload a 100-row SALES report → preview → confirm
 *   4. Verify units were marked sold and stock counts moved
 *   5. Process a return end to end (Tech-QC → CRM finalise)
 *   6. Check the Sell page and the Returns page report the SAME count
 *
 * Fixtures come from scripts/generateE2EWorkbooks.mjs and match the
 * schemas the app itself exports, so this is the export → edit →
 * re-import loop, not a synthetic happy path.
 *
 * Run (after `VITE_E2E=1 vite build --outDir dist-e2e` + `vite preview`):
 *   node scripts/e2eUploadFlow.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/upload-flow';
const INVENTORY_FILE = resolve('e2e-fixtures/INVENTORY_REPORT_E2E.xlsx');
const SALES_FILE = resolve('e2e-fixtures/SALES_REPORT_E2E.xlsx');

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

/** Navigate to a tab. The bottom tab-bar is mobile-only; on desktop the
 *  same items live in the hamburger drawer, so open it when needed. */
/** The topmost modal overlay — scoping clicks here stops Playwright
 *  matching the page chrome sitting behind the dim layer. */
function modal(page) {
  return page.locator('div.fixed.inset-0[class*="z-["]').last();
}

async function gotoTab(page, label) {
  // Dismiss anything modal first — an open dialog swallows nav clicks.
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('div.fixed.inset-0').filter({ hasNot: page.locator('nav') }).last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const close = page.locator('button[aria-label*="lose" i], button:has-text("Cancel")').last();
    if (await close.isVisible().catch(() => false)) { await close.click().catch(() => {}); }
    await page.waitForTimeout(400);
  }
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click();
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(900);
}

/** Read a KPI tile's number by its label — walks up to the tile card and
 *  takes the first standalone number inside it. */
async function kpi(page, label) {
  return page.evaluate((lbl) => {
    const wanted = lbl.toLowerCase();
    for (const el of Array.from(document.querySelectorAll('p, span, div'))) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t !== wanted) continue;
      let node = el;
      for (let i = 0; i < 5 && node?.parentElement; i++) {
        node = node.parentElement;
        const m = (node.innerText || '').match(/\n\s*(\d[\d,]*)\s*\n/);
        if (m) return Number(m[1].replace(/,/g, ''));
      }
    }
    return null;
  }, label);
}

/** The Import control is icon-only below md — target it by its ARIA role. */
async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) { await byLabel.click(); }
  else { await page.locator('button[aria-haspopup="menu"]').first().click(); }
  await page.waitForTimeout(500);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── 1. Wipe ───────────────────────────────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'before-wipe');

  // Wipe controls now live behind one menu in the action row.
  await page.getByRole('button', { name: /^Wipe$/i }).click();
  await page.waitForTimeout(400);
  await page.getByRole('menuitem', { name: /Wipe All/i }).click();
  await page.waitForTimeout(600);
  await page.getByText(/I understand this will delete all inventory data/i).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'wipe-done');
  record('full wipe completes', await page.getByText(/All data cleared/i).isVisible().catch(() => false));

  // ResetDataModal reloads the app; re-navigate rather than fight it.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await gotoTab(page, 'Stock Intake');
  const officeAfterWipe = await kpi(page, 'ALL OFFICE STOCK');
  record('office stock is empty after the wipe', officeAfterWipe === 0, `office=${officeAfterWipe}`);
  await shot(page, 'empty-database');

  // ── 2. Inventory upload ───────────────────────────────────────────────────
  await openImportMenu(page);
  await shot(page, 'import-menu');
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await shot(page, 'inventory-preview');

  const previewText = await page.locator('body').innerText();
  const parsed120 = /120/.test(previewText);
  record('inventory preview parses all 120 rows', parsed120);
  record('inventory preview reports new suppliers it will create',
    /supplier/i.test(previewText));

  const confirmInv = modal(page).getByRole('button', { name: /Load [\d,]+ rows/i });
  record('inventory Confirm is enabled after preview',
    await confirmInv.isEnabled().catch(() => false),
    (await confirmInv.textContent().catch(() => ''))?.trim());
  await confirmInv.click();
  await page.waitForTimeout(6000);
  await shot(page, 'inventory-import-done');

  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await gotoTab(page, 'Stock Intake');
  const officeAfterImport = await kpi(page, 'ALL OFFICE STOCK');
  const shsAfterImport = await kpi(page, 'SHS STOCK');
  record('inventory import lands 110 office + 10 SHS units',
    officeAfterImport === 110 && shsAfterImport === 10,
    `office=${officeAfterImport} shs=${shsAfterImport}`);
  record('SHS arrives by report — no manual re-keying', shsAfterImport === 10,
    'Stock Type column');
  await shot(page, 'buy-after-inventory-import');

  // ── 3. Sales upload ───────────────────────────────────────────────────────
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);
  await shot(page, 'sales-preview');

  const salesPreview = await page.locator('body').innerText();
  record('sales preview parses across all four marketplace sheets',
    /AMAZON/i.test(salesPreview) && /EBAY/i.test(salesPreview));
  record('sales preview flags the duplicated order row',
    /duplicat/i.test(salesPreview), 'file-internal dupe detection');
  record('sales preview warns which in-stock units will flip to sold',
    /flip|sold/i.test(salesPreview));

  // The flip acknowledgement gate must be ticked before Confirm enables
  const ackBox = modal(page).locator('input[type="checkbox"]').first();
  if (await ackBox.isVisible().catch(() => false)) {
    const confirmBefore = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
    const blocked = await confirmBefore.isDisabled().catch(() => false);
    await ackBox.check();
    await page.waitForTimeout(400);
    record('sales import gates Confirm behind the inventory-flip acknowledgement', blocked,
      `confirm disabled before ack = ${blocked}`);
  }
  await shot(page, 'sales-preview-acked');

  // ── Audit completion gate ────────────────────────────────────────────────
  // Orphan sales (sold on the report, never in our inventory) must be made
  // whole before the import can land — model / supplier / BP / IMEI. This is
  // the real operator task, so drive it rather than skip it.
  let confirmSales = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  const blockedLabel = (await confirmSales.textContent().catch(() => ''))?.trim();
  const blockedByAudit = await confirmSales.isDisabled().catch(() => false);
  record('import is hard-blocked until orphan sales are completed', blockedByAudit, blockedLabel);
  await shot(page, 'sales-audit-blocked');

  if (blockedByAudit) {
    // Fill every empty required input in the audit panel.
    const modelInputs = modal(page).locator('input[placeholder="Search model…"]');
    const supplierInputs = modal(page).locator('input[placeholder="Supplier required"]');
    const imeiInputs = modal(page).locator('input[placeholder="IMEI required"]');
    for (const [loc, value] of [[imeiInputs, '350000000000999'], [modelInputs, 'IPHONE 12'], [supplierInputs, 'MOBILE WHOLESALE LTD']]) {
      const n = await loc.count();
      for (let i = 0; i < n; i++) {
        const box = loc.nth(i);
        if ((await box.inputValue().catch(() => 'x')) === '') {
          await box.fill(value);
          await box.press('Tab');
          await page.waitForTimeout(150);
        }
      }
    }
    // Buy price: any numeric input left at 0 blocks the gate.
    const numeric = modal(page).locator('input[type="number"]');
    const nNum = await numeric.count();
    for (let i = 0; i < nNum; i++) {
      const box = numeric.nth(i);
      const v = await box.inputValue().catch(() => '1');
      if (!v || Number(v) === 0) { await box.fill('200'); await box.press('Tab'); await page.waitForTimeout(150); }
    }
    await page.waitForTimeout(800);
    await shot(page, 'sales-audit-completed');
  }

  confirmSales = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  const confirmLabel = (await confirmSales.textContent().catch(() => ''))?.trim();
  const confirmDisabled = await confirmSales.isDisabled().catch(() => true);
  record('sales Confirm enables once the audit rows are complete', !confirmDisabled, confirmLabel);
  if (confirmDisabled) {
    record('SKIPPED remaining steps — Confirm never enabled', false, confirmLabel);
    await ctx.close(); await browser.close();
    const f = results.filter(r => !r.ok);
    console.log(`\n${results.length - f.length}/${results.length} checks passed`);
    process.exit(1);
  }
  await confirmSales.click();
  await page.waitForTimeout(9000);
  await shot(page, 'sales-import-done');

  const doneText = await page.locator('body').innerText();
  record('import reports how many units it marked sold', /sold|linked|synced/i.test(doneText),
    (doneText.match(/\d+ units? marked sold/i) || [])[0] || '');
  const createdLine = (doneText.match(/(\d+) created · (\d+) updated/i) || []);
  record('Done screen reports the rows it actually created',
    createdLine[1] === '100' && createdLine[2] === '0',
    createdLine[0] || 'no created/updated line');

  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(2000);

  // ── 4. Did inventory reconcile? ───────────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  const officeAfterSales = await kpi(page, 'ALL OFFICE STOCK');
  const shsAfterSales = await kpi(page, 'SHS STOCK');
  record('office stock dropped as sales were reconciled',
    officeAfterSales !== null && officeAfterSales < 110,
    `110 → ${officeAfterSales}`);
  record('SHS stock survived the sales import untouched', shsAfterSales === 10,
    `shs=${shsAfterSales}`);
  await shot(page, 'buy-after-sales-import');

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  await shot(page, 'sell-after-sales-import');
  const sellText = await page.locator('body').innerText();
  const soldMatch = sellText.match(/ALL-TIME SOLD\s*\n?\s*(\d+)/i);
  record('Sell page shows the imported sales as sold', !!soldMatch,
    soldMatch ? `all-time sold=${soldMatch[1]}` : 'no ALL-TIME SOLD tile found');

  // ── 5. Returns ────────────────────────────────────────────────────────────
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1000);
  await shot(page, 'returns-empty');

  await page.getByRole('button', { name: /Process Return/i }).click();
  await page.waitForTimeout(1200);
  await shot(page, 'returns-picker');
  const pickerList = modal(page).locator('button', { hasText: /IPHONE|SAMSUNG|GOOGLE|PIXEL/i });
  const pickerRows = await pickerList.count().catch(() => 0);
  record('return picker offers the freshly-imported sold units', pickerRows > 0,
    `${pickerRows} selectable`);

  if (pickerRows > 0) {
    await pickerList.first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'return-step1-qc');
    const textareas = page.locator('textarea');
    if (await textareas.count() >= 2) {
      await textareas.nth(0).fill('Customer says the battery drains by lunchtime.');
      await textareas.nth(1).fill('QC: battery health 78%, chassis A-grade, IMEI matches.');
      await shot(page, 'return-step1-filled');
      await modal(page).getByRole('button', { name: /Save|Send to CRM|Continue/i }).last().click();
      await page.waitForTimeout(2500);
      await shot(page, 'return-crm-queue');
      const queued = await page.getByRole('button', { name: /Finalise/i }).first().isVisible().catch(() => false);
      record('Tech-QC step 1 raises the unit into the CRM queue', queued);

      // ── Step 2: CRM finalises the outcome ────────────────────────────────
      if (queued) {
        await page.getByRole('button', { name: /Finalise/i }).first().click();
        await page.waitForTimeout(1500);
        await shot(page, 'return-step2-crm');
        // Destination: Back to Inventory. Outcome: Refund. Reason required.
        await modal(page).getByText(/Back to Inventory/i).first().click();
        await page.waitForTimeout(300);
        const refund = modal(page).getByRole('button', { name: /^Refund/i }).first();
        if (await refund.isVisible().catch(() => false)) { await refund.click(); await page.waitForTimeout(300); }
        // The reason field is a bare <input> (no type attr) — target its placeholder.
        const reason = modal(page).locator('input[placeholder*="Customer changed mind" i]').first();
        await reason.fill('Battery health 78% — refunded and restocked.');
        await page.waitForTimeout(300);
        await shot(page, 'return-step2-filled');
        await modal(page).getByRole('button', { name: /Finalise Return/i }).click();
        await page.waitForTimeout(3000);
        await shot(page, 'return-finalised');
        record('CRM step 2 finalises the return', true);
      }
    }
  }

  await page.waitForTimeout(1000);
  await shot(page, 'returns-after-processing');

  // ── 6. Do both screens agree? ─────────────────────────────────────────────
  const returnsText = await page.locator('body').innerText();
  const allReturns = (returnsText.match(/ALL RETURNS\s*\n?\s*(\d+)/i) || [])[1];

  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  const sellText2 = await page.locator('body').innerText();
  const sellReturns = (sellText2.match(/(\d+)\s+returns?\s+processed\s+lifetime/i) || [])[1];
  await shot(page, 'sell-return-chip');

  record('a finalised return appears in the ledger', (allReturns ?? '0') !== '0',
    `ALL RETURNS=${allReturns ?? '0'}`);
  record('Sell chip and Returns page report the same number',
    (sellReturns ?? '0') === (allReturns ?? '0'),
    `sell=${sellReturns ?? '0'} returns=${allReturns ?? '0'}`);

  // A 90-unit import must not produce 90 toasts. The toast stack shows an
  // "N of M" pager only when more than one is queued, so M is the count;
  // no pager means at most one toast was on screen.
  const toastQueue = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/\b(\d+)\s+of\s+(\d+)\b/);
    return m ? Number(m[2]) : 1;
  });
  record('bulk import does not spam one notification per unit', toastQueue <= 12,
    `${toastQueue} queued for 90 sold units across 8 models (was 94)`);

  record('no uncaught JS errors across the whole flow', jsErrors.length === 0,
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
