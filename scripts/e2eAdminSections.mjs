/**
 * scripts/e2eAdminSections.mjs — the admin section after the restructure.
 *
 * Seven tabs became five, grouped by what an admin is DOING rather than
 * which component happened to exist:
 *
 *   Overview · Sales History · Money · Insights · Reports · Configuration
 *
 * The checks that matter are the removals, because a duplicate that comes
 * back is worse than one that was never removed — two VAT figures on two
 * screens is how a business files the wrong number. So this asserts what is
 * GONE as firmly as what is present: no VAT tab under Reports, no Sales Log
 * duplicating Sales History, no stand-alone Reconcile SKUs.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAdminSections.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/admin-sections';

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

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(300);
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

const EXPECTED_SUBS = ['Overview', 'Sales History', 'Money', 'Insights', 'Reports', 'Configuration'];
const REMOVED_SUBS = ['Reconcile SKUs', 'Reconcile Models', 'VAT Returns'];

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
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(1000);
  await shot(page, 'admin-nav');

  // ── The nav itself ──────────────────────────────────────────────────────
  const navText = await page.locator('body').innerText();
  for (const label of EXPECTED_SUBS) {
    record(`admin has "${label}"`, navText.includes(label.toUpperCase()) || navText.includes(label));
  }
  for (const label of REMOVED_SUBS) {
    record(`"${label}" is gone from the nav`,
      !navText.toUpperCase().includes(label.toUpperCase()), label);
  }

  // ── Money — VAT and Capital under one roof ──────────────────────────────
  await page.getByRole('button', { name: /^Money$/i }).first().click();
  await page.waitForTimeout(1200);
  const moneyText = await page.locator('body').innerText();
  record('Money offers VAT and Capital & Profit',
    /VAT/i.test(moneyText) && /Capital & Profit/i.test(moneyText));

  await page.getByRole('button', { name: /^Capital & Profit$/i }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, 'money-capital');
  const capitalText = await page.locator('body').innerText();
  record('Capital shows money tied up, not just unit counts',
    /Capital tied up in stock/i.test(capitalText) && /£/.test(capitalText));
  record('supplier profitability carries a return rate',
    /Supplier profitability/i.test(capitalText) && /Return rate/i.test(capitalText));
  record('model profitability carries days-to-sell',
    /Model profitability/i.test(capitalText) && /Days to sell/i.test(capitalText));

  // ── Reports — the duplicates must be gone ──────────────────────────────
  await page.getByRole('button', { name: /^Reports$/i }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, 'reports');
  const reportsText = await page.locator('body').innerText();
  record('Reports keeps Daily Sales and Stock Report',
    /Daily Sales/i.test(reportsText) && /Stock Report/i.test(reportsText));
  record('Reports no longer carries a second VAT engine',
    !/VAT Returns/i.test(reportsText) && !/VAT Due/i.test(reportsText),
    'one VAT figure in the app, under Money');
  record('Reports no longer duplicates the sales log',
    !/Sales Log/i.test(reportsText), 'Sales History is the one list');

  // ── Configuration — the repair tools, together ─────────────────────────
  await page.getByRole('button', { name: /^Configuration$/i }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, 'configuration-data-health');
  const configText = await page.locator('body').innerText();
  record('Configuration holds the models catalog', /Models Catalog/i.test(configText));
  record('Configuration holds suppliers', /Suppliers/i.test(configText));
  record('Data Health is here', /Data Health/i.test(configText));
  record('SKU reconciliation folded in beside it',
    /SKU/i.test(configText), 'no longer a top-level tab');

  const healthChecks = [
    'Stock with no buy price', 'IMEI on more than one unit',
    'Sales with no matching stock', 'Stock still named by SKU code',
  ];
  for (const c of healthChecks) {
    record(`Data Health runs "${c}"`, configText.includes(c));
  }
  record('checks that pass still render, so the panel is visibly running',
    /Clear|nothing to fix/i.test(configText));

  // ── Mobile ─────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  for (const sub of ['Money', 'Reports', 'Configuration']) {
    await gotoTab(page, 'Admin');
    await page.getByRole('button', { name: new RegExp(`^${sub}$`, 'i') }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot(page, `mobile-${sub.toLowerCase()}`);
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    record(`mobile · ${sub} does not overflow sideways`, overflow === 0, `overflow=${overflow}px`);
  }

  record('no uncaught JS errors across the admin section', jsErrors.length === 0,
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
