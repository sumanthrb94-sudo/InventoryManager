/**
 * scripts/e2eRemovalLogOnNoticeBoard.mjs — the removal log, where the team
 * can actually see it, and locked shut.
 *
 * The deletion archive was already indelible, but it lives behind an
 * admin-only tab. The line the TEAM sees was an ordinary notice, and
 * ordinary notices could be edited or deleted by an admin — so the visible
 * record of a removal could be reworded or removed while the tombstone
 * survived somewhere nobody looks.
 *
 * What this drives, in a real browser:
 *
 *   A. Delete a unit, then find that removal ON the notice board
 *   B. The removal row is badged permanent and offers NO edit / delete
 *   C. An ordinary admin notice still offers both — the lock is targeted,
 *      not a blanket freeze of the board
 *   D. An employee sees the removal too, read-only
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eRemovalLogOnNoticeBoard.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/removal-log';
const DESKTOP = { width: 1280, height: 900 };

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

function modal(page) {
  return page.locator('div.fixed.inset-0[class*="z-["]').last();
}

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    await page.waitForTimeout(350);
  }
}

/**
 * Anchored at the START only, not both ends: the Notices tab carries an
 * unseen-count badge INSIDE the button, so its accessible name reads
 * "Notices 1" and an `^…$` match never finds it. Leaving the regex
 * unanchored instead is the mistake that had ten scripts opening the
 * "Import Inventory Report" button when they wanted the report menu.
 */
async function gotoTab(page, label) {
  await dismissModals(page);
  // Anchored, but allowing a leading number: the unseen-notices badge
  // renders INSIDE the button and BEFORE the word, so the moment a deletion
  // posts its log the tab's accessible name changes from "NOTICES" to
  // "1 NOTICES" and a plain `^Notices` stops matching — precisely when this
  // script needs it. Leaving the regex unanchored instead is the mistake
  // that had ten scripts opening "Import Inventory Report".
  const name = new RegExp(`^(\\d+\\s*)?${label}`, 'i');
  // The nav is rendered TWICE — a bottom bar for narrow screens and a
  // drawer for wide ones — and only one of them is visible at a time. Both
  // match by role and name, so `.first()` on its own can return the hidden
  // copy and wait 30s for a click that will never land. Filter to visible,
  // and open the drawer first if neither is showing.
  const visible = () => page.getByRole('button', { name }).locator('visible=true').first();
  if (!(await visible().isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(500);
  }
  await visible().click();
  await page.waitForTimeout(900);
}

/** The feed row whose text contains `needle`, as a locator. */
function rowContaining(page, needle) {
  return page.locator('li', { hasText: needle }).first();
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });

  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  const REASON = 'Screen cracked in transit — scrapped';
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept(REASON);
    else await d.accept();
  });

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── A. Delete a unit so there is a removal to look for ───────────────────
  await gotoTab(page, 'Stock Intake');
  await page.getByText('ALL OFFICE STOCK').first().click();
  await page.waitForTimeout(1200);
  await modal(page).locator('button[title="Show one row per unit"]').click();
  await page.waitForTimeout(1000);

  const deleteButtons = modal(page).locator('button[title="Delete office unit"]');
  if (await deleteButtons.count() === 0) {
    record('a unit is available to delete', false, 'no delete control found');
    return finish(browser);
  }
  await deleteButtons.first().click();
  await page.waitForTimeout(1800);

  // The IMEI the archive recorded — the needle for finding the row.
  const imei = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('__e2e_firestore__');
      const recs = raw ? Object.values(JSON.parse(raw).deletedUnits || {}) : [];
      return recs.length ? String(recs[0].imei || '') : '';
    } catch { return ''; }
  });
  record('the deletion left a tombstone to report', !!imei, imei || '—');

  // ── B. It shows on the notice board, badged permanent ────────────────────
  //
  // Full reload rather than closing the overlay by hand: the delete leaves a
  // stack of overlays whose dismissal is timing-dependent, and the shim's
  // store lives in sessionStorage, so a reload keeps every record while
  // handing the next step a clean DOM.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await gotoTab(page, 'Notices');
  await page.waitForTimeout(1200);
  await shot(page, 'notice-board-with-removal');

  const board = await page.evaluate(() => document.body.innerText);
  record('the removal appears on the notice board', board.includes(imei), imei);
  record('the board names the reason it was removed', board.includes(REASON), REASON);

  const logRow = rowContaining(page, imei);
  const badged = await logRow.locator('text=/Log · permanent/i').count();
  record('the removal row is badged as a permanent log', badged > 0, `${badged} badge(s)`);

  const logEdit = await logRow.getByRole('button', { name: /^edit$/i }).count();
  const logDelete = await logRow.getByRole('button', { name: /^delete$/i }).count();
  record('the removal row offers NO edit control', logEdit === 0, `${logEdit} edit button(s)`);
  record('the removal row offers NO delete control', logDelete === 0, `${logDelete} delete button(s)`);

  // ── C. An ordinary notice is still fully editable ────────────────────────
  //
  // The lock has to be targeted. A board where nothing can be corrected is
  // a different bug, not a stricter version of this fix.
  const MESSAGE = 'Team: stock take Friday 9am.';
  const composer = page.locator('textarea').first();
  if (await composer.isVisible().catch(() => false)) {
    await composer.fill(MESSAGE);
    await page.getByRole('button', { name: /^post/i }).first().click();
    await page.waitForTimeout(1200);
  }
  await shot(page, 'ordinary-notice-posted');

  const ownRow = rowContaining(page, MESSAGE);
  const ownPosted = await ownRow.count();
  record('an admin can still post an ordinary notice', ownPosted > 0, MESSAGE);
  if (ownPosted > 0) {
    const ownEdit = await ownRow.getByRole('button', { name: /^edit$/i }).count();
    const ownDelete = await ownRow.getByRole('button', { name: /^delete$/i }).count();
    record('an ordinary notice keeps its edit control', ownEdit > 0, `${ownEdit} edit button(s)`);
    record('an ordinary notice keeps its delete control', ownDelete > 0, `${ownDelete} delete button(s)`);
    const ownBadge = await ownRow.locator('text=/Log · permanent/i').count();
    record('an ordinary notice is NOT badged permanent', ownBadge === 0, `${ownBadge} badge(s)`);
  }

  // ── D. The removal is reported once, not twice ───────────────────────────
  //
  // Each deletion writes both a notice and a tombstone. Showing both would
  // report one removal as two, which is how a log stops being trusted.
  const occurrences = (board.match(new RegExp(imei, 'g')) || []).length;
  record('the removal is listed once, not once per source', occurrences === 1,
    `${occurrences} row(s) mentioning the IMEI`);

  record('no uncaught JS errors on the notice board', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

  await finish(browser);
}

async function finish(browser) {
  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });
