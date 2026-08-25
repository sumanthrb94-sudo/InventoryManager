/**
 * scripts/e2eOfflineBanner.mjs — the screen that looks like a wiped business.
 *
 * WHAT HAPPENED
 *
 * The operator opened the app the morning after importing several hundred
 * sales and found All Office Stock 0, SHS 0, Sold Today 0, Accessory SKUs 0,
 * Stock Alerts 0 and "ALL STOCK LEVELS HEALTHY". Their message was "I'm seeing
 * no data why man", which is the only sane reading of that screen.
 *
 * Nothing had been deleted. A Firestore snapshot had ERRORED — dbService flips
 * its sync flag false on that one condition and every collection then serves
 * an empty cache. The UI renders the emptiness faithfully and says nothing
 * about where it came from.
 *
 * WHY IT MATTERS MORE THAN A MISSING MESSAGE
 *
 * The two controls nearest to hand on that page are WIPE and import. Someone
 * who believes their data is already gone has no reason not to press either.
 * One is destructive, the other a route to duplicates, and neither is
 * recoverable by a person who thinks they have nothing left to lose. The screen
 * was quietly inviting the one action that turns a transient read error into
 * real loss.
 *
 * WHAT THIS PROVES
 *
 *   1. The zeros still appear — the failure is faithfully reproduced, not
 *      papered over. If the app started hiding the numbers this test would
 *      stop testing anything.
 *   2. The banner appears WITH them, saying the zeros are a read failure.
 *   3. It names the danger: do not wipe, do not import.
 *   4. It is legible on a PHONE, which is where the operator hit this and
 *      where the old 1.5px dot and its hover tooltip were useless.
 *   5. On a healthy load it is absent — a banner that cried wolf on every
 *      start-up would be scrolled past within a day.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eOfflineBanner.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/offline-banner');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let failures = 0, checks = 0;
function check(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
}

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined,
});

/** The operator was on a phone. That is not incidental — it is why the dot
 *  and its tooltip were invisible, so the replacement has to be checked at
 *  that width and nowhere else. */
const PHONE = { width: 412, height: 915 };

// ── 1 · A healthy load says nothing ─────────────────────────────────────────
console.log('\n1 · healthy load — the banner must stay out of the way');
{
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  check('no cannot-reach banner on a working database',
    /Can.t reach the database/i.test(body), false);
  await page.screenshot({ path: `${OUT}/01-healthy.png`, fullPage: false });
  await ctx.close();
}

// ── 2 · The failure, reproduced ─────────────────────────────────────────────
console.log('\n2 · every snapshot errors — the screen the operator saw');
{
  const ctx = await browser.newContext({ viewport: PHONE });
  const page = await ctx.newPage();
  const logged = [];
  page.on('console', m => { if (m.type() === 'warning') logged.push(m.text()); });

  await page.goto(`${BASE}?e2eSnapshotError=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const body = await page.locator('body').innerText();

  // The failure is real, not mocked at the UI layer: dbService logged it.
  check('dbService logged the snapshot error',
    logged.some(l => /snapshot error/i.test(l)), true);

  // (1) the zeros are still there — we are not hiding the symptom
  check('the KPI tiles still read 0', /\b0\b/.test(body), true);

  // (2) and the banner explains them
  check('the banner is shown', /Can.t reach the database/i.test(body), true);
  check('it says the zeros are a read failure',
    /because nothing could be\s*loaded/i.test(body.replace(/\s+/g, ' ')), true);

  // (3) and names the danger
  check('it says do not wipe and do not import',
    /Do not wipe and do not import/i.test(body), true);

  // (4) legible on a phone: actually painted, on screen, and not one line tall
  const banner = page.locator('text=/Can.t reach the database/i').first();
  check('the banner is visible', await banner.isVisible().catch(() => false), true);
  const box = await banner.boundingBox();
  check('it is inside the viewport', Boolean(box && box.y >= 0 && box.y < PHONE.height), true);

  // NOT OCCLUDED. isVisible() only asks whether the element is rendered with a
  // non-empty box — it says nothing about what is painted ON TOP. The first
  // version of this fix put the banner at z-[110], under the z-[300] loading
  // overlay, and every check here passed while the screenshot showed a spinner
  // and nothing else. Ask the browser what the operator's thumb would actually
  // hit at that point.
  const topmostIsBanner = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return Boolean(el && el.closest('.bg-rose-600'));
  }, { x: Math.round((box?.x ?? 0) + (box?.width ?? 0) / 2), y: Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2) });
  check('nothing is painted over it', topmostIsBanner, true);

  // And the spinner must stop claiming to be loading, since it is not going to
  // finish — that wait is what made a read error look like a slow app.
  check('the loading screen admits the database is unreachable',
    /Database unreachable/i.test(body) || !/Loading inventory/i.test(body), true);

  const blockBox = await page.locator('div.bg-rose-600').first().boundingBox();
  check('it is a block a thumb cannot miss (>= 40px tall)',
    Boolean(blockBox && blockBox.height >= 40), true);
  check('it spans the full width', Boolean(blockBox && blockBox.width >= PHONE.width - 2), true);

  await page.screenshot({ path: `${OUT}/02-cannot-read.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/03-cannot-read-full.png`, fullPage: true });
  await ctx.close();
}

console.log(`\n${failures === 0 ? 'ok' : 'FAILED'} — ${checks - failures}/${checks} checks`);
console.log(`screenshots in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
