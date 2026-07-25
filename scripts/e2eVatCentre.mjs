/**
 * scripts/e2eVatCentre.mjs — the VAT figure, on screen, from real imported data.
 *
 * Loads the 120-row inventory and the 100-sale workbook, then opens Admin →
 * VAT and checks the quarter totals against the sales that were actually
 * imported. The point is not that the component renders — it is that the
 * number it renders is the number the data implies, including the two
 * readings and the loss-making rows behind their difference.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eVatCentre.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/vat-centre';
const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const SALES_FILE = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
let lossFile = null;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${String(++shotIndex).padStart(2, '0')}-${name}.png`, fullPage: true });
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

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

async function readStore(page) {
  return page.evaluate(() => {
    try {
      const store = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || 'null');
      return store ? { sales: Object.values(store.sales || {}) } : null;
    } catch { return null; }
  });
}

/** The VAT figures the imported data implies, computed independently here. */
function expectedFromStore(db) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const byQuarter = new Map();
  for (const s of db.sales) {
    if (s.voidedAt) continue;
    const m = /^(\d{4})-(\d{2})/.exec(s.saleDate || '');
    if (!m) continue;
    const key = `${m[1]}-Q${Math.floor((Number(m[2]) - 1) / 3) + 1}`;
    const b = byQuarter.get(key) ?? { asComputed: 0, scheme: 0, losses: 0, count: 0 };
    const margin = r2((s.salePrice || 0) - (s.buyPrice || 0));
    const tax = r2(s.marginalTax || 0);
    b.asComputed += tax;
    b.scheme += margin > 0 ? Math.max(0, tax) : 0;
    if ((margin > 0 ? Math.max(0, tax) : 0) !== tax) b.losses++;
    b.count++;
    byQuarter.set(key, b);
  }
  for (const b of byQuarter.values()) { b.asComputed = r2(b.asComputed); b.scheme = r2(b.scheme); }
  return byQuarter;
}

const parseMoney = (t) => {
  const m = /(−|-)?£([\d,]+\.\d{2})/.exec(t || '');
  return m ? (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')) : null;
};

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── Load real data ───────────────────────────────────────────────────────
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
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);

  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);
  const ack = modal(page).locator('input[type="checkbox"]').first();
  if (await ack.isVisible().catch(() => false)) { await ack.check(); await page.waitForTimeout(400); }
  let confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (await confirm.isDisabled().catch(() => true)) {
    const fill = async (sel, v) => {
      const loc = modal(page).locator(sel);
      for (let i = 0; i < await loc.count(); i++) {
        const b = loc.nth(i);
        if ((await b.inputValue().catch(() => 'x')) === '') { await b.fill(v); await b.press('Tab'); await page.waitForTimeout(120); }
      }
    };
    await fill('input[placeholder="IMEI required"]', '350190000009999');
    await fill('input[placeholder="Search model…"]', 'IPHONE 12');
    await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
    const nums = modal(page).locator('input[type="number"]');
    for (let i = 0; i < await nums.count(); i++) {
      const b = nums.nth(i);
      const v = await b.inputValue().catch(() => '1');
      if (!v || Number(v) === 0) { await b.fill('200'); await b.press('Tab'); await page.waitForTimeout(120); }
    }
    await page.waitForTimeout(700);
    confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  }
  await confirm.click();
  await page.waitForTimeout(9000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1800);
  await dismissModals(page);

  // ── Force the case that matters ─────────────────────────────────────────
  // The sample workbook is all profitable, so the difference between the two
  // readings would never appear and the check would pass vacuously. Sell two
  // phones already in stock for less than they cost — the real situation this
  // whole screen exists for (clearing aged stock, a bad buy).
  {
    const XLSXw = await import('xlsx');
    const { writeFileSync } = await import('node:fs');
    const stock = await page.evaluate(() => {
      const store = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
      return Object.values(store.inventoryUnits || {})
        .filter(u => u.status === 'available')
        .slice(0, 2)
        .map(u => ({ imei: u.imei, bp: u.buyPrice, supplier: u.supplierName, model: u.rawModel || u.model }));
    });
    const HEADERS = ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP',
      'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'];
    const rows = stock.map((u, i) => ([
      '2026-07-29', `LOSS-${900 + i}`, 'CLEARANCE', u.imei, u.supplier, 1,
      u.bp, Math.round(u.bp * 0.6 * 100) / 100, '', '', '', 8, '', '', 'sold below cost',
    ]));
    const wb = XLSXw.utils.book_new();
    XLSXw.utils.book_append_sheet(wb, XLSXw.utils.aoa_to_sheet([HEADERS, ...rows]), 'AMAZON');
    lossFile = resolve(OUT, 'loss-making-sales.xlsx');
    writeFileSync(lossFile, XLSXw.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    console.log(`\nselling ${rows.length} in-stock phones below cost to exercise the difference`);

    await gotoTab(page, 'Stock Intake');
    await openImportMenu(page);
    await page.getByRole('menuitem', { name: /Sales Report/i }).click();
    await page.waitForTimeout(800);
    await modal(page).getByRole('button', { name: /^AMAZON$/i }).first().click();
    await page.waitForTimeout(400);
    await page.locator('input[type="file"]').first().setInputFiles(lossFile);
    await page.waitForTimeout(4500);
    const ack2 = modal(page).locator('input[type="checkbox"]').first();
    if (await ack2.isVisible().catch(() => false)) { await ack2.check(); await page.waitForTimeout(400); }
    const c2 = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
    if (!(await c2.isDisabled().catch(() => true))) {
      await c2.click();
      await page.waitForTimeout(8000);
      await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    await dismissModals(page);
  }

  const db = await readStore(page);
  const expected = expectedFromStore(db);
  console.log(`\nimported ${db.sales.length} sales across ${expected.size} VAT quarters`);

  // ── Admin → VAT ─────────────────────────────────────────────────────────
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(900);
  const moneyTab = page.getByRole('button', { name: /^Money$/i }).first();
  record('Admin has a Money section', await moneyTab.isVisible().catch(() => false));
  await moneyTab.click();
  await page.waitForTimeout(1200);
  const vatTab = page.getByRole('button', { name: /^VAT$/i }).first();
  record('Money opens on VAT', await vatTab.isVisible().catch(() => false));
  await vatTab.click();
  await page.waitForTimeout(1500);
  await shot(page, 'vat-centre');

  const body = await page.locator('body').innerText();

  // Which quarter is selected? The picker shows the newest first.
  const newestKey = [...expected.keys()].sort().reverse()[0];
  const exp = expected.get(newestKey);
  console.log(`newest quarter ${newestKey}: asComputed=£${exp.asComputed.toFixed(2)} ` +
              `scheme=£${exp.scheme.toFixed(2)} losses=${exp.losses} sales=${exp.count}`);

  const asComputedShown = parseMoney(
    (body.match(/AS HISTORICALLY COMPUTED\s*\n\s*([^\n]+)/i) || [])[1]);
  const schemeShown = parseMoney(
    (body.match(/PER MARGIN SCHEME\s*\n\s*([^\n]+)/i) || [])[1]);

  record('the historical reading matches the imported sales',
    asComputedShown !== null && Math.abs(asComputedShown - exp.asComputed) < 0.05,
    `screen ${asComputedShown} · data ${exp.asComputed}`);

  record('the margin-scheme reading matches the imported sales',
    schemeShown !== null && Math.abs(schemeShown - exp.scheme) < 0.05,
    `screen ${schemeShown} · data ${exp.scheme}`);

  record('flooring never lowers the total',
    asComputedShown !== null && schemeShown !== null && schemeShown >= asComputedShown,
    `${schemeShown} >= ${asComputedShown}`);

  if (exp.losses > 0) {
    record('the difference is surfaced with the count behind it',
      /readings differ by/i.test(body) && body.includes(String(exp.losses)),
      `${exp.losses} loss-making sales in ${newestKey}`);

    const toggle = page.getByRole('button', { name: /Show the \d+ sales?/i }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(800);
      await shot(page, 'loss-making-sales');
      const rows = await page.locator('table tbody tr').count();
      record('every loss-making sale is listed for the accountant',
        rows === exp.losses, `${rows} rows · ${exp.losses} expected`);
    }
  } else {
    record('agreement is stated plainly when there are no losses',
      /both readings agree/i.test(body), 'no loss-making sales this quarter');
  }

  // ── The accountant export ───────────────────────────────────────────────
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    page.getByRole('button', { name: /Export for accountant/i }).click(),
  ]);
  const XLSX = await import('xlsx');
  const { readFileSync } = await import('node:fs');
  const wb = XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
  record('the export carries summary, stock book and the loss list',
    ['VAT Summary', 'Stock Book', 'Loss-Making Sales'].every(s => wb.SheetNames.includes(s)),
    wb.SheetNames.join(', '));

  const bookRows = XLSX.utils.sheet_to_json(wb.Sheets['Stock Book'], { header: 1, defval: '' })
    .filter(r => r.some(c => String(c).trim() !== ''));
  record('the stock book has one row per sale in the quarter',
    bookRows.length - 1 === exp.count, `${bookRows.length - 1} rows · ${exp.count} sales`);

  // ── Mobile ──────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await shot(page, 'mobile-vat-centre');
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  record('mobile · VAT centre does not overflow sideways', overflow === 0, `overflow=${overflow}px`);

  record('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

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
