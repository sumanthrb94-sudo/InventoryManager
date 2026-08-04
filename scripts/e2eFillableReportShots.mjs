/**
 * e2eFillableReportShots — photograph the fillable Sales Report.
 *
 * Opens the in-browser report viewer and captures what an operator sees:
 * the sales, the blank-but-live rows underneath them, the TOTAL that spans
 * both, and the Summary tab whose figures follow the rows as they are filled.
 *
 * The viewer runs the same formulas Excel will, so these are screenshots of
 * the real arithmetic, not a mock-up.
 *
 * Run (preview server up):
 *   node scripts/e2eFillableReportShots.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const OUT = 'e2e-screenshots/fillable-sales-report';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let n = 0;
const shot = async (page, name, opts = {}) => {
  const path = `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path, ...opts });
  console.log(`  ${path}`);
  return path;
};

const gotoTab = async (page, label) => {
  const re = new RegExp(`^(\\d+\\s*)?${label}\\b(?! Report)`, 'i');
  for (let i = 0; i < 4; i++) {
    if (await page.getByRole('button', { name: re }).first().isVisible().catch(() => false)) break;
    await page.getByLabel('Open menu').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.getByRole('button', { name: re }).first().click({ timeout: 15000 });
  await page.waitForTimeout(1200);
};

const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// The Sales Report lives on the Inventory (Sell) screen.
await gotoTab(page, 'Inventory');
await page.getByRole('button', { name: /Sales Report/i }).first().click();
await page.waitForTimeout(800);
await page.locator('button[title="View All Time in browser"]').first().click();
await page.waitForTimeout(6000);

// 1 — the Summary the file opens on.
await shot(page, 'summary-tab');

// 2 — a marketplace tab: sales, then the blank live rows.
const amazon = page.getByRole('button', { name: /^AMAZON$/ }).first();
if (await amazon.isVisible().catch(() => false)) {
  await amazon.click();
  await page.waitForTimeout(2500);
}
await shot(page, 'marketplace-tab-with-fillable-rows');

// 3 — scroll the grid to the foot so the TOTAL under the blank rows is visible.
const scroller = page.locator('div').filter({ has: page.locator('table') }).last();
await scroller.evaluate(el => {
  const box = el.querySelector('table')?.parentElement ?? el;
  box.scrollTop = box.scrollHeight;
}).catch(() => {});
await page.waitForTimeout(1200);
await shot(page, 'total-row-below-the-fillable-rows');

// What the grid reports, so the screenshots have a number beside them.
const dims = (await page.locator('body').innerText())
  .match(/([\d,]+)\s*ROWS?\s*[×x]\s*([\d,]+)\s*COLS?/i);
if (dims) console.log(`\nAMAZON grid: ${dims[1]} rows × ${dims[2]} cols`);

await browser.close();
console.log(`\n${n} screenshots in ${OUT}`);
