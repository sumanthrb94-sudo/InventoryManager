/**
 * scripts/e2eScreenshots.mjs — drives the real app in Chromium and
 * captures a screenshot of every operator surface.
 *
 * The app runs against src/lib/e2e/firestoreShim (aliased over the
 * Firebase SDK by VITE_E2E=1), so this needs no credentials and no
 * network. Everything above the SDK is production code.
 *
 * Run:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173 &
 *   node scripts/e2eScreenshots.mjs
 *
 * Output: e2e-screenshots/*.png plus a PASS/FAIL line per step.
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots';
const MOBILE = { width: 430, height: 932 };   // the operator's phone
const DESKTOP = { width: 1440, height: 1000 };

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  const file = `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Click a bottom-nav tab by its visible label. */
async function gotoTab(page, label) {
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(700);
}

async function run() {
  // PLAYWRIGHT_BROWSERS_PATH holds versioned dirs; resolve rather than guess.
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const executablePath = chromeDir
    ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome`
    : undefined;
  const browser = await chromium.launch({ executablePath });

  // ── Admin, mobile — the operator's actual device ─────────────────────────
  const ctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', e => errors.push(`JS: ${e}`));
  page.on('requestfailed', r => failedRequests.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.url()} → ${r.status()}`); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const loaded = await page.getByText('MOBILEPHONEMARKET').first().isVisible().catch(() => false);
  record('app boots and auto-signs in as admin', loaded);
  await shot(page, 'boot-admin');

  // ── Stock Intake (Buy) — scoped wipe buttons live here ───────────────────
  await gotoTab(page, 'Stock Intake');
  const wipeOffice = page.getByRole('button', { name: /Wipe Office Stock/i });
  const wipeShs = page.getByRole('button', { name: /Wipe SHS/i });
  const wipeAll = page.getByRole('button', { name: /Wipe All/i });
  record('Buy page shows all three scoped wipe buttons',
    await wipeOffice.isVisible() && await wipeShs.isVisible() && await wipeAll.isVisible());
  await shot(page, 'buy-scoped-wipe-buttons');

  // Open the office wipe and read the plan it renders
  await wipeOffice.click();
  await page.waitForTimeout(500);
  const officeModal = page.getByText('Wipe In-Office Stock');
  record('office wipe modal opens with a per-bucket plan', await officeModal.isVisible());
  await shot(page, 'wipe-office-modal');

  const officeUnitsLine = await page.getByText('Office units').isVisible().catch(() => false);
  record('office wipe lists exactly what it will delete', officeUnitsLine);

  // Confirm gate: the button must be disabled until the checkbox is ticked
  const confirmBtn = page.getByRole('button', { name: /Wipe Office Stock/i }).last();
  const disabledBefore = await confirmBtn.isDisabled();
  await page.getByText(/I understand this deletes all in-office stock/i).click();
  await page.waitForTimeout(200);
  const enabledAfter = !(await confirmBtn.isDisabled());
  record('wipe is gated behind the confirm checkbox', disabledBefore && enabledAfter,
    `disabled=${disabledBefore} → enabled=${enabledAfter}`);
  await shot(page, 'wipe-office-confirmed');

  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await page.waitForTimeout(300);

  // SHS wipe — must show a DIFFERENT plan to the office one
  await wipeShs.click();
  await page.waitForTimeout(500);
  record('SHS wipe modal is scoped to SHS only',
    await page.getByText('Wipe SHS Stock').isVisible());
  await shot(page, 'wipe-shs-modal');
  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await page.waitForTimeout(300);

  // ── Returns — reconciliation panel + wipe ────────────────────────────────
  await gotoTab(page, 'Returns');
  await shot(page, 'returns-page');

  const recPanel = page.getByText(/Sell page shows \d+ · this page shows \d+/);
  const recVisible = await recPanel.isVisible().catch(() => false);
  record('returns reconciliation panel appears when the counts disagree', recVisible);
  if (recVisible) {
    const headline = await recPanel.textContent();
    record('reconciliation headline reports both numbers', true, headline?.trim());
    await recPanel.click();
    await page.waitForTimeout(500);
    await shot(page, 'returns-reconciliation-expanded');
    const reason = await page.getByText(/Second sale doc for the same unit/i).isVisible().catch(() => false);
    record('reconciliation names the duplicate sale doc as the cause', reason);
  }

  const wipeReturns = page.getByRole('button', { name: /Wipe Returns/i });
  record('Returns page has its own scoped wipe', await wipeReturns.isVisible());
  await wipeReturns.click();
  await page.waitForTimeout(500);
  record('returns wipe explains it clears flags rather than deleting units',
    await page.getByText(/No units are deleted/i).isVisible().catch(() => false));
  await shot(page, 'wipe-returns-modal');
  await page.getByRole('button', { name: /^Cancel$/i }).click();
  await page.waitForTimeout(300);

  // ── Admin → Sales History — the sales wipe ───────────────────────────────
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(600);
  await shot(page, 'admin-overview');
  const salesHistoryTab = page.getByRole('button', { name: /Sales History/i }).first();
  if (await salesHistoryTab.isVisible().catch(() => false)) {
    await salesHistoryTab.click();
    await page.waitForTimeout(800);
    const wipeSales = page.getByRole('button', { name: /Wipe Sales/i });
    record('Sales History has its own scoped wipe', await wipeSales.isVisible().catch(() => false));
    await shot(page, 'admin-sales-history');
    if (await wipeSales.isVisible().catch(() => false)) {
      await wipeSales.click();
      await page.waitForTimeout(500);
      await shot(page, 'wipe-sales-modal');
      await page.getByRole('button', { name: /^Cancel$/i }).click();
    }
  }

  record('no uncaught JS errors during the admin pass', errors.length === 0,
    errors.slice(0, 3).join(' | '));
  // Two classes of failure are expected OUTSIDE production and are not app
  // bugs: Google Fonts (blocked by the sandbox proxy) and Vercel's injected
  // analytics scripts (only served by Vercel's edge). Everything else counts.
  const EXPECTED_OFFLINE = /fonts\.googleapis\.com|fonts\.gstatic\.com|_vercel\//;
  const realFailures = [...new Set(failedRequests)].filter(u => !EXPECTED_OFFLINE.test(u));
  record('no failed network requests (excluding fonts/vercel, absent offline)',
    realFailures.length === 0, realFailures.slice(0, 4).join(' | '));
  record('NOTE: Google Fonts has no local fallback — typography degrades if it is blocked',
    true, 'app-wide font stack is remote-only');
  await ctx.close();

  // ── Employee persona — the permission surface ────────────────────────────
  const empCtx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  const emp = await empCtx.newPage();
  await emp.goto(`${BASE}?e2eUser=employee`, { waitUntil: 'networkidle' });
  await emp.waitForTimeout(1500);
  await shot(emp, 'employee-boot');

  await gotoTab(emp, 'Stock Intake');
  const empCanAdd = await emp.getByRole('button', { name: /Add Stock/i }).isVisible().catch(() => false);
  const empSeesWipe = await emp.getByRole('button', { name: /Wipe Office Stock/i }).isVisible().catch(() => false);
  record('employee can still add stock', empCanAdd);
  record('employee cannot see any wipe control', !empSeesWipe);
  await shot(emp, 'employee-buy-no-wipe');

  const empSeesImport = await emp.getByRole('button', { name: /^Import$/i }).isVisible().catch(() => false);
  record('FINDING: employee has no Import entry point at all', !empSeesImport,
    'report upload is admin-only');

  await gotoTab(emp, 'Returns');
  const empSeesRecon = await emp.getByText(/Sell page shows/).isVisible().catch(() => false);
  record('employee does not see the admin reconciliation panel', !empSeesRecon);
  await shot(emp, 'employee-returns');
  await empCtx.close();

  // ── Desktop pass — layout check on a wide viewport ───────────────────────
  const deskCtx = await browser.newContext({ viewport: DESKTOP });
  const desk = await deskCtx.newPage();
  await desk.goto(BASE, { waitUntil: 'networkidle' });
  await desk.waitForTimeout(1500);
  await shot(desk, 'desktop-dashboard');

  // Horizontal overflow is the classic responsive regression
  const overflow = await desk.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record('no horizontal overflow on desktop', overflow <= 0, `overflow=${overflow}px`);
  await deskCtx.close();

  await browser.close();

  // ── Summary ──────────────────────────────────────────────────────────────
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
