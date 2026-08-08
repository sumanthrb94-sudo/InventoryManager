/**
 * scripts/e2eSeedSalesSelfTest.mjs — prove the seeding helper before 32
 * scripts are pointed at it.
 *
 * A seeding helper that silently does nothing is worse than no helper: every
 * script built on it goes green while asserting against an empty database.
 * So this drives seedSales for real, then reads the store back and checks the
 * sales actually exist, on the right marketplace, for the right money.
 *
 * Run:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eSeedSalesSelfTest.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { seedSales, assertSeeded } from './e2eSeedSales.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/seed-sales-self-test';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const f = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${f}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${f}`);
}

async function gotoTab(page, label) {
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('aside').last()
    .getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const dumpStore = (page) => page.evaluate(() => {
  const raw = sessionStorage.getItem('__e2e_firestore__');
  return raw ? JSON.parse(raw) : {};
});
const docsOf = (s, c) => Object.values(s[c] || {});

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  // The seed ships available office stock; take three real units to sell so
  // the test does not depend on any import path existing.
  const before = await dumpStore(page);
  const available = docsOf(before, 'inventoryUnits')
    .filter(u => u.status === 'available' && (u.imei || '').trim())
    .slice(0, 3);
  record('found seeded office stock to sell', available.length === 3,
    available.map(u => u.imei).join(', '));
  if (available.length < 3) { await browser.close(); return finish(); }

  const salesBefore = docsOf(before, 'sales').length;

  // Three sales, three different marketplaces — proves the tab switching
  // works, which is the part most likely to break.
  const plan = [
    { marketplace: 'AMAZON', kind: 'office', search: available[0].imei, orderNumber: 'SEED-A-1', price: 401 },
    { marketplace: 'EBAY',   kind: 'office', search: available[1].imei, orderNumber: 'SEED-E-1', price: 402 },
    { marketplace: 'BM',     kind: 'office', search: available[2].imei, orderNumber: 'SEED-B-1', price: 403 },
  ];

  const result = await seedSales(page, plan, { gotoTab });
  assertSeeded(record, result);
  await shot(page, 'after-seeding');

  // The point of the exercise: the sales are really in the database.
  const after = await dumpStore(page);
  const sales = docsOf(after, 'sales');
  record('three new sale documents exist',
    sales.length === salesBefore + 3, `${salesBefore} → ${sales.length}`);

  for (const p of plan) {
    const s = sales.find(x => x.orderNumber === p.orderNumber);
    record(`${p.orderNumber} landed on ${p.marketplace} at £${p.price}`,
      !!s && s.marketplace === p.marketplace && Number(s.salePrice) === p.price,
      s ? `${s.marketplace} £${s.salePrice}` : 'not found');
  }

  // And the stock moved — a sale that does not sell anything is not a sale.
  const soldNow = docsOf(after, 'inventoryUnits')
    .filter(u => available.some(a => a.imei === u.imei) && u.status === 'sold');
  record('all three units are now marked sold', soldNow.length === 3, `${soldNow.length}/3`);

  // Gross profit was computed, not left blank — the seeding goes through the
  // real service, so the money must be there too.
  const withGp = plan
    .map(p => sales.find(x => x.orderNumber === p.orderNumber))
    .filter(s => s && Number.isFinite(s.grossProfit) && s.grossProfit !== 0);
  record('every seeded sale carries a computed gross profit', withGp.length === 3,
    withGp.map(s => `${s.orderNumber} £${s.grossProfit}`).join(' · '));

  await browser.close();
  finish();
}

function finish() {
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  if (pass !== results.length) {
    console.log('\n── Failures ──');
    results.filter(r => !r.ok).forEach(r => console.log(`FAIL  ${r.name} — ${r.detail}`));
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exit(1); });
