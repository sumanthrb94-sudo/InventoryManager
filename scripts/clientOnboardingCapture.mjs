/**
 * scripts/clientOnboardingCapture.mjs — screenshots for the client
 * onboarding document.
 *
 * Seeds a realistic, fully-reconciled system (the same sample stock and
 * sales files used across the e2e suite) and then tours every screen a
 * new user — employee or admin — would actually see, capturing a clean
 * full-page screenshot at each stop. No assertions, no wipe demos: this
 * is a presentation pass, not a test.
 *
 * Run against a built app:
 *   VITE_E2E=1 npm run build && npx vite preview --port 4173 &
 *   node scripts/clientOnboardingCapture.mjs
 *
 * Output: e2e-screenshots/client-onboarding/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/client-onboarding';
// Taller than a typical laptop viewport on purpose: the app shell scrolls
// an inner container rather than the document, so Playwright's fullPage
// screenshot (which measures document height) can't capture anything below
// the viewport anyway. A taller viewport is the only way to get more of
// each screen into one clean shot without a second scrolled capture.
const DESKTOP = { width: 1440, height: 1300 };
const MOBILE = { width: 430, height: 932 };

const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const SALES_FILE = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');
const DIRECT_SHIPMENT = { order: 'AMA-SHS-1', model: 'IPHONE 14', supplier: 'NORTHSIDE STOCK' };
const NEUTRAL_MODEL = 'IPHONE 13';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let shotIndex = 0;
const shots = [];
async function shot(page, name, caption) {
  // Best-effort: a live "unit sold" toast can reappear mid-tour. Close it
  // rather than let it sit over the corner of a clean screenshot.
  const clearToasts = page.getByLabel('Dismiss all').first();
  if (await clearToasts.isVisible({ timeout: 200 }).catch(() => false)) {
    await clearToasts.click().catch(() => {});
    await page.waitForTimeout(200);
  }
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  shots.push({ file, caption });
  console.log(`  ↳ ${file}  —  ${caption}`);
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
  await page.waitForTimeout(900);
}

async function gotoAdminSub(page, label) {
  const tab = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  await tab.scrollIntoViewIfNeeded().catch(() => {});
  await tab.click();
  await page.waitForTimeout(900);
}

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const executablePath = chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined;
  const browser = await chromium.launch({ executablePath });
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ══ SETUP · seed realistic, fully-reconciled data (no screenshots) ═══════
  console.log('\n── setup: wipe + seed realistic stock and sales ──');
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

  // ══ 1 · Home ══════════════════════════════════════════════════════════
  await gotoTab(page, 'Notices');
  await shot(page, 'notices-home', 'Home screen — the team notice board, first thing everyone sees on sign-in.');

  // ══ 2 · Stock Intake — empty, then populated ═════════════════════════
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'stock-intake-empty', 'Stock Intake before any data — Add Stock, Bulk Order and Import controls.');

  const addStockBtn = page.getByRole('button', { name: /Add Stock/i }).first();
  if (await addStockBtn.isVisible().catch(() => false)) {
    await addStockBtn.click();
    await page.waitForTimeout(700);
    await shot(page, 'add-stock-modal', 'Adding one unit by hand — model, IMEI, grade, storage, colour, supplier, buy price.');
    await dismissModals(page);
  }

  // ── Import → Inventory Report, template offer + preview ──────────────
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  const buildFrom = modal(page).getByText(/Build a new file from/i);
  if (await buildFrom.isVisible().catch(() => false)) {
    await shot(page, 'inventory-import-template-offer', 'Every import screen offers the current template first — never guess the columns.');
  }
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await shot(page, 'inventory-import-preview', 'Inventory Report preview — office stock and supplier-held (SHS) stock split automatically before anything is written.');
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  await shot(page, 'stock-intake-populated', 'Stock Intake after the import — 110 office units and 10 supplier-held holdings on the books.');

  // ══ 3 · Inventory (Sell) — browsing stock ═════════════════════════════
  await gotoTab(page, 'Inventory');
  await shot(page, 'inventory-browse', 'Inventory — live stock grouped by model, searchable, with quick sell actions.');

  const firstUnit = page.locator('[data-testid="unit-row"], li, div').filter({ hasText: /IPHONE|GALAXY|IMEI/i }).first();
  const anyCard = page.locator('button, div').filter({ hasText: /IMEI/i }).first();
  if (await anyCard.isVisible().catch(() => false)) {
    await anyCard.click().catch(() => {});
    await page.waitForTimeout(700);
    const overlayOpen = await modal(page).isVisible().catch(() => false);
    if (overlayOpen) {
      await shot(page, 'unit-detail', 'A single unit’s full record — condition, pricing, supplier, and the Mark Sold action.');
    }
    await dismissModals(page);
  }

  // ══ 4 · Sales Report — import, audit, done ════════════════════════════
  await gotoTab(page, 'Inventory');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);
  await shot(page, 'sales-import-preview', 'Sales Report preview — one workbook, all four marketplaces, matched against stock automatically.');

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  // Complete the audit rows so the system lands fully reconciled — same
  // known fixture as the SHS orphan-flow test, so counts are exact.
  const orphanIndex = await page.evaluate((order) => {
    const SEL = 'input[placeholder="Search model…"]';
    const boxes = [...document.querySelectorAll(SEL)];
    return boxes.findIndex((box) => {
      let row = box.parentElement, n = row;
      for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
        if (n.querySelectorAll(SEL).length > 1) break;
        row = n;
      }
      return (row.textContent || '').includes(order);
    });
  }, DIRECT_SHIPMENT.order);

  if (orphanIndex >= 0) {
    await shot(page, 'sales-audit-screen', 'Every sold record needs a full audit trail before it can be confirmed — nothing is written half-finished.');
    const shsModelBox = modal(page).locator('input[placeholder="Search model…"]').nth(orphanIndex);
    await shsModelBox.scrollIntoViewIfNeeded().catch(() => {});
    await shsModelBox.fill(DIRECT_SHIPMENT.model);
    await shsModelBox.press('Tab');
    await page.waitForTimeout(400);
    const shsToggle = modal(page).getByRole('button', { name: /^SHS$/ }).nth(orphanIndex);
    if (await shsToggle.isVisible().catch(() => false)) await shsToggle.click();
    await page.waitForTimeout(400);
    await shot(page, 'sales-audit-office-or-shs', 'One toggle answers the only question the system cannot guess: did this ship from the shelf, or straight from the supplier?');
  }

  const fill = async (sel, v) => {
    const loc = modal(page).locator(sel);
    for (let i = 0; i < await loc.count(); i++) {
      const b = loc.nth(i);
      if ((await b.inputValue().catch(() => 'x')) === '') { await b.fill(v); await b.press('Tab'); await page.waitForTimeout(100); }
    }
  };
  await fill('input[placeholder="IMEI required"]', '350000000000999');
  await fill('input[placeholder="Search model…"]', NEUTRAL_MODEL);
  await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
  const nums = modal(page).locator('input[type="number"]');
  for (let i = 0; i < await nums.count(); i++) {
    const b = nums.nth(i);
    if ((await b.inputValue().catch(() => '1')) === '0') { await b.fill('50'); await page.waitForTimeout(80); }
  }
  // Also set Colour/Storage on the rows this script just backfilled — left
  // blank, the resulting sold unit shows up on the Inventory page's own
  // "Orphans" data-quality pill (a different feature from the sales-import
  // orphan concept above: it flags sold units with missing storage/colour
  // or a raw SKU as the model). Real operator uploads carry these values;
  // filling them here just keeps this demo dataset from tripping a check
  // that a hand-typed placeholder row was always going to trip.
  const selects = modal(page).locator('select');
  for (let i = 0; i < await selects.count(); i++) {
    const s = selects.nth(i);
    const val = await s.inputValue().catch(() => '');
    if (val === '') {
      const options = await s.locator('option').allInnerTexts();
      const real = options.find(o => o.trim() && o.trim() !== '—');
      if (real) await s.selectOption({ label: real }).catch(() => {});
    }
  }
  await page.waitForTimeout(500);

  const confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isEnabled().catch(() => false)) {
    await confirm.click();
    await page.waitForTimeout(6000);
    await shot(page, 'sales-import-done', 'Confirmation — every sale reconciled, every unit that shipped from a supplier accounted for.');
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
    await page.waitForTimeout(1000);
  }
  await dismissModals(page);

  // The sales import above queues one "unit sold" toast per fulfilled sale.
  // Left alone it sits over the top-left corner of every following screen —
  // fine as proof the app is live, wrong for a document meant to show off
  // the actual screen. Clear it once before the rest of the tour.
  const clearAllToasts = page.getByLabel('Dismiss all').first();
  if (await clearAllToasts.isVisible().catch(() => false)) {
    await clearAllToasts.click();
    await page.waitForTimeout(400);
  }

  // ══ 5 · Returns ════════════════════════════════════════════════════════
  await gotoTab(page, 'Returns');
  await shot(page, 'returns-overview', 'Returns — a return is a two-step workflow (technical inspection, then outcome), not a spreadsheet row.');

  // ══ 6 · Admin ══════════════════════════════════════════════════════════
  await gotoTab(page, 'Admin');
  await shot(page, 'admin-overview', 'Admin → Overview — the headline numbers for the business right now.');

  await gotoAdminSub(page, 'Sales History');
  await shot(page, 'admin-sales-history', 'Sales History — every sale, deduplicated and matched to a physical unit.');

  await gotoAdminSub(page, 'Money');
  await shot(page, 'admin-money-vat', 'Money — VAT Centre. UK Margin Scheme VAT computed per sale, totalled per period, exportable for the accountant.');
  const capitalTab = page.getByRole('button', { name: /Capital/i }).first();
  if (await capitalTab.isVisible().catch(() => false)) {
    await capitalTab.click();
    await page.waitForTimeout(700);
    await shot(page, 'admin-money-capital', 'Money → Capital Position — how much money is tied up in stock, and how long it’s been sitting there.');
  }

  await gotoAdminSub(page, 'Insights');
  await shot(page, 'admin-insights-top', 'Insights — supplier performance, model profitability and platform mix, at a glance.');
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(500);
  await shot(page, 'admin-insights-scrolled', 'Insights, continued — aged-stock buckets and the per-supplier breakdown.');
  await page.mouse.wheel(0, -1400);

  await gotoAdminSub(page, 'Reports');
  await shot(page, 'admin-reports', 'Reports — view or download the Inventory, Sales and Returns reports; a template button sits beside each one.');

  const dataHealthLink = page.getByText(/Data Health/i).first();
  if (await dataHealthLink.isVisible().catch(() => false)) {
    await dataHealthLink.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'admin-data-health', 'Data Health — records worth a second look (a missing buy price, a supplier typo) surfaced before they reach a report. Nothing here blocks a write.');
  }

  await gotoAdminSub(page, 'Configuration');
  await shot(page, 'admin-configuration', 'Configuration — the model catalog and, further down, the Data Health panel that checks live data for anything worth a second look.');
  await page.mouse.wheel(0, 1300);
  await page.waitForTimeout(500);
  await shot(page, 'admin-configuration-suppliers', 'Configuration, continued — the supplier list every other screen (SHS matching, return rates, VAT export) reads from.');

  // ══ 7 · Mobile pass ════════════════════════════════════════════════════
  // Stay in the SAME context/page rather than opening a new one — a fresh
  // context gets a fresh sessionStorage, which loses every seeded record
  // (the e2e shim persists state there) and falls back to the app's small
  // built-in demo dataset. Resizing the existing page keeps the same 101
  // reconciled sales in frame; the only cost is a fixed device pixel ratio
  // set at context creation, which doesn't affect a screenshot's content.
  await page.setViewportSize(MOBILE);
  await page.waitForTimeout(500);
  await gotoTab(page, 'Inventory');
  await shot(page, 'mobile-inventory', 'The same Inventory screen on a phone — this is what the floor team actually uses.');
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(600);
  await shot(page, 'mobile-admin-overview', 'Admin Overview on mobile — the business summary in your pocket.');

  await ctx.close();
  await browser.close();

  console.log(`\n${shots.length} screenshots captured → ${OUT}/`);
  console.log(JSON.stringify(shots, null, 2));
}

run().catch(e => { console.error(e); process.exit(1); });
