/**
 * Photograph the 50-unit simulation inside the running application.
 *
 * The simulation itself runs headless in simulate50Units.ts, which means its
 * 50 units and 20 returns never touched a screen. Screenshots of some other
 * dataset would prove nothing about these rows, so this loads the simulation's
 * own store into the E2E build — the shim persists to sessionStorage, so the
 * data can be injected and the page reloaded — and captures the real screens.
 *
 * Captures:
 *   inventory-N   the sales table, paged until all 40 sales have been shown
 *   returns-N     the returns table, paged until all 20 have been shown
 *   ledger        the Return Losses panel
 *   history-NN    the Unit History for every returned unit
 *
 * Run:  npx tsx scripts/simulate50Units.ts
 *       VITE_E2E=1 npx vite build --outDir dist-e2e
 *       npx vite preview --outDir dist-e2e --port 4173
 *       node scripts/captureSimulationScreens.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('simulation-output/screens');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const store = JSON.parse(readFileSync(resolve('simulation-output/simulation-store.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve('simulation-output/simulation-manifest.json'), 'utf8'));

const shots = [];
async function shot(page, name, locator) {
  const target = locator ? page.locator(locator).last() : page;
  if (locator) {
    if (!(await target.isVisible().catch(() => false))) { console.log(`  MISS ${name}`); return false; }
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
  }
  const file = `${name}.png`;
  await target.screenshot({ path: `${OUT}/${file}`, ...(locator ? {} : { fullPage: false }) });
  shots.push(file);
  console.log(`  ✓ ${file}`);
  return true;
}

function modal(page) { return page.locator('div.fixed.inset-0').last(); }
async function dismiss(page) {
  for (let i = 0; i < 5; i++) {
    const o = page.locator('div.fixed.inset-0').last();
    if (!(await o.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(220);
  }
}
async function closeDrawer(page) {
  const c = page.getByLabel('Close menu').first();
  if (await c.isVisible().catch(() => false)) { await c.click().catch(() => {}); await page.waitForTimeout(350); }
}
/** Markers that prove we actually landed on the screen. */
// Matched case-insensitively: the UI uppercases these labels in CSS, and
// innerText returns the RENDERED text, so a title-case marker never matches.
const ARRIVED = {
  Inventory: [/sold today/i, /mark multiple sold/i],
  Returns:   [/process return/i, /all returns/i],
};

/** Navigate, then VERIFY.
 *
 *  Two traps here, both of which produced silent wrong-screen screenshots:
 *
 *  1. getByRole('button', {name: /^Returns$/}) matches nothing — the nav
 *     buttons' accessible name is not their visible text.
 *  2. At desktop width the visible nav items belong to the mobile bottom bar
 *     and are display:none. The real sidebar lives inside a DRAWER that has
 *     to be opened first, so a click that "succeeded" hit nothing and the run
 *     photographed whatever screen was already open.
 *
 *  Hence: open the drawer, match on text content, then confirm a marker that
 *  only that screen renders. */
async function gotoTab(page, label) {
  await dismiss(page);
  const rx = new RegExp(`^\\s*${label}\\s*$`);

  const clickIfVisible = async () => {
    const b = page.locator('button').filter({ hasText: rx })
      .locator('visible=true').first();
    if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 6000 }); return true; }
    return false;
  };

  if (!(await clickIfVisible())) {
    const burger = page.getByLabel(/menu/i).first();
    if (!(await burger.isVisible().catch(() => false))) throw new Error(`no way to reach "${label}"`);
    await burger.click();
    await page.waitForTimeout(600);
    if (!(await clickIfVisible())) throw new Error(`nav item "${label}" not found even with the drawer open`);
  }

  await page.waitForTimeout(1500);
  await closeDrawer(page);

  const body = await page.locator('body').innerText().catch(() => '');
  const want = ARRIVED[label] || [];
  if (want.length && !want.some(rx => rx.test(body))) {
    throw new Error(`clicked "${label}" but none of its markers appeared`);
  }
  console.log(`  on ${label}`);
}

/** Click through a PaginationBar, shooting the table on each page. */
async function shootPages(page, tableLocator, prefix, maxPages = 8) {
  for (let i = 1; i <= maxPages; i++) {
    await shot(page, `${prefix}-${String(i).padStart(2, '0')}`, tableLocator);
    const next = page.getByRole('button', { name: /^next$|›|Next/i }).first();
    const can = await next.isEnabled().catch(() => false);
    if (!can) break;
    await next.click().catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function run() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));

  console.log('loading the simulation into the app…');
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // Overwrite the seed with the simulation, then reload WITHOUT e2eReset so
  // the shim restores what we just wrote instead of re-seeding over it.
  await page.evaluate(s => sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s)), store);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await dismiss(page);
  await closeDrawer(page);

  const loaded = await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return { units: Object.keys(s.inventoryUnits || {}).length, sales: Object.keys(s.sales || {}).length };
  });
  console.log(`  store now holds ${loaded.units} units / ${loaded.sales} sales`);
  if (loaded.units !== 50 || loaded.sales !== 40) {
    console.log('  FAILED to load the simulation — aborting rather than shooting the wrong data');
    await browser.close();
    process.exit(1);
  }

  // ── Sales ──────────────────────────────────────────────────────────────────
  console.log('\nsales screens');
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  await shot(page, 'inventory-kpis', 'div.rounded-3xl:has(p:text-is("Sold Today"))');
  // Full page, not a table selector: the Inventory screen's sale rows are not
  // in a single <table> the way the Returns list is, and the first attempt
  // grabbed a 198px-tall summary strip instead of the sales. One tall capture
  // is sliced into page-sized panels when the PDF is built.
  // The sale rows are not on the page itself — fullPage returned exactly the
  // viewport, because the list lives in an inner scroll container. The KPI
  // tiles open an Excel-style overlay of the sales behind them, which is the
  // per-sale view, so drive that and page through it.
  const tile = page.locator('button').filter({ hasText: /ALL-TIME SOLD/i }).first();
  if (await tile.isVisible().catch(() => false)) {
    await tile.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1400);
    const overlay = page.locator('div.fixed.inset-0').last();
    if (await overlay.isVisible().catch(() => false)) {
      // The overlay groups sales by MODEL with a ×N count; the individual
      // sales are behind each row's expander. Un-expanded this shows six rows
      // for forty sales, which is not "each sale".
      const rows = overlay.locator('tbody tr');
      const before = await rows.count();
      for (let i = before - 1; i >= 0; i--) {
        const chev = rows.nth(i).locator('button, [role="button"]').first();
        if (await chev.isVisible().catch(() => false)) {
          await chev.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(180);
        }
      }
      await page.waitForTimeout(900);
      const after = await rows.count();
      console.log(`  expanded ${before} groups → ${after} rows`);
      await shootPages(page, 'div.fixed.inset-0 table', 'sales-table', 12);
      await dismiss(page);
    } else {
      console.log('  MISS sales overlay did not open');
    }
  } else {
    console.log('  MISS ALL-TIME SOLD tile not found');
  }

  // ── Returns ────────────────────────────────────────────────────────────────
  console.log('\nreturns screens');
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1200);
  await shot(page, 'returns-kpis', 'div.rounded-3xl:has(p:text-is("Back to Inventory"))');
  await shootPages(page, 'table', 'returns-table');
  await shot(page, 'returns-loss-ledger', 'div.rounded-3xl:has(p:text-is("Return Losses · Lifecycle"))');

  // ── One history card per returned unit ─────────────────────────────────────
  console.log('\nunit histories');
  const returned = manifest.journeys;
  let captured = 0;
  for (const j of returned) {
    await gotoTab(page, 'Returns');
    const search = page.locator('input[placeholder*="Search IMEI" i]').first();
    if (!(await search.isVisible().catch(() => false))) { console.log('  no search box — stopping'); break; }
    await search.fill(String(j.imei));
    await page.waitForTimeout(900);
    // The Activity History rows open the per-unit journey card.
    const row = page.locator(`text=${j.imei}`).last();
    if (!(await row.isVisible().catch(() => false))) { console.log(`  MISS row ${j.imei}`); continue; }
    await row.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(900);
    const m = modal(page);
    if (await m.isVisible().catch(() => false)) {
      if (await shot(page, `history-${String(j.n).padStart(2, '0')}-${j.route}`, 'div.fixed.inset-0 > div')) captured++;
      await dismiss(page);
    } else {
      console.log(`  no history modal for ${j.imei}`);
    }
    await search.fill('').catch(() => {});
  }
  console.log(`\n${shots.length} screenshots · ${captured}/${returned.length} unit histories`);
  await browser.close();
}

run().catch(e => { console.error(e); process.exit(1); });
