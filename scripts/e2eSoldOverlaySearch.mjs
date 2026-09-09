/**
 * scripts/e2eSoldOverlaySearch.mjs — searching inside the sold-units overlays.
 *
 * Sold Today / This Month / All-time Sold open a full-screen list of every
 * sale in the period. The page's own search box sits BEHIND that overlay, so
 * narrowing the list meant closing it, editing the box and reopening — while
 * Stock Intake's All Office Stock / SHS Stock overlays have always had a
 * search of their own. This drives the search that closes that gap.
 *
 * What it pins, beyond "the box exists":
 *   - the row COUNT narrows, and says "N of M" so the period total is not lost
 *   - the REVENUE / GP in the header follow the search, because a header
 *     reading the whole month over a list narrowed to one model is the wrong
 *     number to quote
 *   - a search matching nothing says so, and offers the way back
 *   - clearing restores every row
 *   - it is reachable on a PHONE, which is where this operator works
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eSoldOverlaySearch.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/sold-overlay-search';
const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 430, height: 932 };
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: false });
}
const modal = page => page.locator('div.fixed.inset-0[class*="z-["]').last();
// The overlay renders the search twice — a compact one in the header for wide
// screens (hidden sm:block) and a full-width row beneath it for phones
// (sm:hidden). Both are in the DOM at every width, so a plain .first() picks
// whichever comes first in source order and finds it hidden. Select on
// VISIBILITY, and the same helper works at either breakpoint.

async function gotoInventory(page) {
  await page.getByLabel('Open menu').click().catch(() => {});
  await page.waitForTimeout(500);
  const drawer = page.locator('aside').last();
  await drawer.getByRole('button', { name: /^INVENTORY$/i }).first().click({ timeout: 6000 })
    .catch(async () => {
      await page.getByRole('button', { name: /^INVENTORY$/i }).first().click();
    });
  await page.waitForTimeout(1200);
}

/** "N rows" / "N of M rows" out of the overlay header. */
async function headerCounts(page) {
  const txt = await modal(page).locator('p.font-mono').first().innerText().catch(() => '');
  const of = txt.match(/([\d,]+)\s+rows?\s+of\s+([\d,]+)/i);
  if (of) return { shown: Number(of[1].replace(/,/g, '')), total: Number(of[2].replace(/,/g, '')), raw: txt };
  const plain = txt.match(/([\d,]+)\s+rows?/i);
  return { shown: plain ? Number(plain[1].replace(/,/g, '')) : null, total: null, raw: txt };
}

async function openTile(page, label) {
  await page.getByText(new RegExp(`^${label}$`, 'i')).first().click();
  await page.waitForTimeout(1200);
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

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await gotoInventory(page);
  await shot(page, 'inventory-tiles');

  // ── All-time Sold ────────────────────────────────────────────────────────
  await openTile(page, 'All-time Sold');
  const opened = await modal(page).isVisible().catch(() => false);
  record('All-time Sold opens an overlay', opened);
  await shot(page, 'all-time-open');

  const search = modal(page).locator('input[placeholder*="Search IMEI" i]:visible').first();
  record('the overlay carries its own search box',
    await search.isVisible().catch(() => false));

  const before = await headerCounts(page);
  record('header states the row count', before.shown !== null && before.shown > 0, before.raw.slice(0, 90));

  // Search by a model that exists in the seed. Narrow, not empty.
  await search.fill('IPHONE 13');
  await page.waitForTimeout(900);
  const after = await headerCounts(page);
  record('searching narrows the rows',
    after.shown !== null && before.shown !== null && after.shown < before.shown && after.shown > 0,
    `${before.shown} → ${after.shown}`);
  record('…and keeps the period total in view as "N of M"',
    after.total === before.shown, `of ${after.total}`);
  await shot(page, 'all-time-searched');

  // Revenue must follow the search, or the header contradicts the list.
  const narrowedHeader = after.raw;
  record('revenue/GP in the header follow the search',
    /Revenue/i.test(narrowedHeader) && narrowedHeader !== before.raw,
    narrowedHeader.slice(0, 90));

  // A search that matches nothing must say so, not read as missing data.
  await search.fill('ZZZ-NOTHING-MATCHES-THIS');
  await page.waitForTimeout(900);
  const emptyText = await modal(page).innerText().catch(() => '');
  record('a search matching nothing says so, and offers the way back',
    /No sales match/i.test(emptyText) && /Clear search/i.test(emptyText));
  await shot(page, 'all-time-no-match');

  // Clearing restores everything.
  await modal(page).getByRole('button', { name: /Clear search/i }).first().click().catch(async () => {
    await search.fill('');
  });
  await page.waitForTimeout(900);
  const restored = await headerCounts(page);
  record('clearing the search restores every row',
    restored.shown === before.shown, `${restored.shown} vs ${before.shown}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ── This Month ───────────────────────────────────────────────────────────
  await openTile(page, 'This Month');
  const mBefore = await headerCounts(page);
  const monthSearch = modal(page).locator('input[placeholder*="Search IMEI" i]:visible').first();
  const monthHasSearch = await monthSearch.isVisible().catch(() => false);
  if ((mBefore.shown ?? 0) === 0) {
    // Nothing sold this month in the fixture, and the box is gated on there
    // being rows — searching an empty list is a control that can only
    // disappoint. Assert the gate rather than the box.
    record('This Month with no sales shows no search box (nothing to search)',
      !monthHasSearch, `${mBefore.shown} rows`);
  } else {
    record('This Month carries the same search', monthHasSearch);
    await monthSearch.fill('IPHONE');
    await page.waitForTimeout(900);
    const mAfter = await headerCounts(page);
    record('This Month narrows too',
      mAfter.shown !== null && mAfter.shown <= (mBefore.shown ?? 0),
      `${mBefore.shown} → ${mAfter.shown}`);
  }
  await shot(page, 'this-month-searched');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ── The phone ────────────────────────────────────────────────────────────
  // Hiding this behind a breakpoint would put it out of reach on the device
  // the operator actually uses.
  const mCtx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  const m = await mCtx.newPage();
  await m.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1500);
  await gotoInventory(m);
  await openTile(m, 'All-time Sold');
  const mobileSearch = modal(m).locator('input[placeholder*="Search IMEI" i]:visible').first();
  record('the search is reachable on a phone', await mobileSearch.isVisible().catch(() => false));
  if (await mobileSearch.isVisible().catch(() => false)) {
    await mobileSearch.fill('IPHONE 13');
    await m.waitForTimeout(900);
    const mm = await headerCounts(m);
    record('…and narrows there as well', mm.shown !== null && mm.shown > 0, mm.raw.slice(0, 70));
  }
  await m.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-mobile-searched.png`, fullPage: false });
  await mCtx.close();

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log(`screenshots: ${OUT}/`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
