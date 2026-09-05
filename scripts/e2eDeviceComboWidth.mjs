/**
 * scripts/e2eDeviceComboWidth.mjs — the model picker on the sales-audit
 * screen was unreadable.
 *
 * DeviceComboBox anchors its suggestion dropdown to the width of its own
 * input. That is fine in a full-width form, but the sales-import audit
 * table puts the combobox in a narrow grid column (~150px on a 1440px
 * viewport), so "iPhone 14 Pro Max · 15 in stock" rendered as
 * "iPh… · 15 IN…" — the model name, storage line and stock count all
 * clipped to ellipses, exactly what the user's screenshot showed.
 *
 * Fix: the dropdown now widens to a MIN_DROPDOWN_WIDTH regardless of the
 * input's own width, clamped so it never runs past the right edge of the
 * viewport. This script drives the real audit screen, opens that dropdown,
 * and asserts the rendered panel is actually wide enough — and that no
 * suggestion row is overflowing/truncated inside it.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/device-combo-width';
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
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false });
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
  // The Import dropdown is gone. Inventory and Sales import are now two
  // labelled icon buttons in the header (App.tsx, behind SHOW_IMPORT_UI &&
  // userIsAdmin), so there is no menu to open — the click that used to follow
  // this call now targets the button directly. Kept as a no-op so the call
  // sites read the same and the diff stays reviewable.
  await page.waitForTimeout(200);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  // Narrow-ish viewport (not ultra-wide) so the audit table's grid column
  // stays genuinely narrow — the exact condition that broke it.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  console.log('\n── Wipe and load stock + sales so the audit screen has orphans ──');
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

  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');

  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);

  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }

  console.log('\n── Open the model combobox on an empty orphan row ──');
  // Target a row whose model field is still blank — a prefilled row would
  // have this test's typed text appended onto existing text, garbling the
  // query into something that matches nothing. An empty box gives a clean
  // query and real catalog suggestions, same as the user's original report.
  const allModelBoxes = modal(page).locator('input[placeholder="Search model…"]');
  const emptyCount = await allModelBoxes.count();
  let modelBox = allModelBoxes.first();
  for (let i = 0; i < emptyCount; i++) {
    const candidate = allModelBoxes.nth(i);
    if ((await candidate.inputValue().catch(() => 'x')) === '') { modelBox = candidate; break; }
  }
  await modelBox.scrollIntoViewIfNeeded();
  await shot(page, 'before-narrow-column');

  const inputBox = await modelBox.boundingBox();
  record('sanity: the audit column really is narrow',
    !!inputBox && inputBox.width < 250, `input width ${inputBox?.width?.toFixed(0)}px`);

  await modelBox.click();
  await modelBox.pressSequentially('iPhone', { delay: 30 });
  await page.waitForTimeout(400);
  await shot(page, 'dropdown-open-over-narrow-input');

  const panel = page.locator('div[class*="z-[9999]"]').last();
  const panelVisible = await panel.isVisible().catch(() => false);
  record('the suggestion panel opens', panelVisible);

  if (panelVisible) {
    const panelBox = await panel.boundingBox();
    const viewport = page.viewportSize();
    record('the panel is widened past the narrow input, not clamped to it',
      !!panelBox && panelBox.width >= 320, `panel width ${panelBox?.width?.toFixed(0)}px vs input ${inputBox?.width?.toFixed(0)}px`);
    record('the widened panel still fits inside the viewport',
      !!panelBox && !!viewport && (panelBox.x + panelBox.width) <= viewport.width + 1,
      `panel right edge ${panelBox ? (panelBox.x + panelBox.width).toFixed(0) : '?'}px vs viewport ${viewport?.width}px`);

    // Every truncatable text node inside the panel should NOT be overflowing
    // its own box — scrollWidth <= clientWidth (+1px rounding) means the
    // full string fits without needing the ellipsis it's styled to use.
    const overflowReport = await panel.evaluate((el) => {
      const nodes = [...el.querySelectorAll('.truncate')];
      return nodes.map(n => ({
        text: n.textContent?.trim() || '',
        overflowing: n.scrollWidth > n.clientWidth + 1,
        scrollWidth: n.scrollWidth,
        clientWidth: n.clientWidth,
      }));
    });
    const overflowing = overflowReport.filter(n => n.overflowing);
    record('no suggestion row text is clipped by its own box',
      overflowing.length === 0,
      overflowing.length
        ? overflowing.map(n => `"${n.text}" (${n.scrollWidth}>${n.clientWidth})`).join('; ')
        : `${overflowReport.length} text nodes checked, all fit`);

    const firstRowText = await panel.locator('button').first().innerText().catch(() => '');
    record('a real model name is fully readable in the first suggestion',
      /iPhone/i.test(firstRowText) && !firstRowText.includes('…'),
      JSON.stringify(firstRowText));
  }

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (failed.length) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
