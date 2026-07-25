/**
 * scripts/e2eAdminDeepDive.mjs — Sales History, Reports and the rest of
 * Insights, checked against the data rather than against their own headings.
 *
 * The Platform Scorecard bug got through because the test asserted a heading
 * existed. The heading was fine. The number under it was zero on 354 real
 * sales. So every check here is one of two shapes:
 *
 *   1. A figure on screen equals the same figure computed from the store.
 *   2. The parts sum to the whole — per-marketplace counts add up to total
 *      sold, per-supplier counts add up to total sold, age buckets add up to
 *      total stock. This is the property the scorecard bug violated, and it
 *      catches a whole class of "silently missing rows" without needing to
 *      know what the right answer is.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAdminDeepDive.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/admin-deep-dive';
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
  await page.waitForTimeout(1100);
}

async function adminSub(page, label) {
  await gotoTab(page, 'Admin');
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(1800);
}

async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      units: Object.values(s.inventoryUnits || {}),
      sales: Object.values(s.sales || {}),
      suppliers: Object.values(s.suppliers || {}),
    };
  });
}

/**
 * Expand every collapsed section on the Insights page.
 *
 * Targets CollapsibleSection headers by their structure — a full-width
 * button carrying the accent stripe — rather than by text. Matching on words
 * like "Stock" swept up the "Add Stock" action button and opened a modal, so
 * the whole run ended up on a different screen taking screenshots of a form.
 * A section is only toggled if its body is not already visible.
 */
async function expandInsightsSections(page) {
  const headers = page.locator('button.w-full.flex.items-center');
  const n = Math.min(await headers.count(), 25);
  for (let i = 0; i < n; i++) {
    const h = headers.nth(i);
    const expanded = await h.evaluate(el => {
      const body = el.parentElement?.querySelector('button + div');
      return !!body && (body).offsetParent !== null;
    }).catch(() => true);
    if (!expanded) {
      await h.scrollIntoViewIfNeeded().catch(() => {});
      await h.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
  await page.waitForTimeout(1000);
}

/** All integers appearing in a labelled section of the page text. */
function sectionText(body, heading, chars = 1400) {
  const i = body.toUpperCase().indexOf(heading.toUpperCase());
  return i === -1 ? '' : body.slice(i, i + chars);
}

async function loadRealData(page) {
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
  await page.waitForTimeout(2000);
  await dismissModals(page);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await loadRealData(page);

  const db = await readStore(page);
  const available = db.units.filter(u => u.status === 'available');
  const sold = db.units.filter(u => u.status === 'sold');
  const liveSales = db.sales.filter(s => !s.voidedAt);
  console.log(`\nstore: ${db.units.length} units · ${available.length} available · ` +
              `${sold.length} sold · ${db.sales.length} sales (${liveSales.length} live)`);

  // ══ SALES HISTORY ══════════════════════════════════════════════════════
  await adminSub(page, 'Sales History');
  await shot(page, 'sales-history');
  let body = await page.locator('body').innerText();

  const availableShown = Number(
    (/Available to Sell\s*\n\s*([\d,]+)/i.exec(body) || [])[1]?.replace(/,/g, ''));
  record('Sales History · "Available to Sell" matches the store',
    availableShown === available.length,
    `screen ${availableShown} · store ${available.length}`);

  const rowsShown = Number(
    (/([\d,]+)\s*\n?\s*(?:sale )?rows?/i.exec(body) || [])[1]?.replace(/,/g, ''));
  record('Sales History · the row tally is non-zero with sales loaded',
    Number.isFinite(rowsShown) && rowsShown > 0, `${rowsShown ?? '?'} rows listed`);

  // The screen merges Sale docs with sold units and must dedupe. It didn't:
  // the guard compared a synthesised row's id (a UNIT id) against Sale doc
  // ids, which cannot collide, so every matched sale was listed twice —
  // 101 + 93 = 194 rows with revenue inflated to match.
  record('Sales History · does not list a sale once per source',
    rowsShown === liveSales.length,
    `${rowsShown} rows · ${liveSales.length} live sales (${sold.length} sold units merged in)`);

  record('Sales History · the row tally never exceeds sales + unmatched units',
    rowsShown <= liveSales.length + sold.length,
    'upper bound sanity');

  // Search has to actually filter — a search box that does nothing is the
  // same class of bug as a heading with no number behind it.
  const search = page.getByPlaceholder(/Search order/i).first();
  if (await search.isVisible().catch(() => false)) {
    const target = liveSales.find(s => s.orderNumber);
    await search.fill(target.orderNumber);
    await page.waitForTimeout(1500);
    await shot(page, 'sales-history-search');
    const filtered = await page.locator('body').innerText();
    const after = Number((/([\d,]+)\s*\n?\s*(?:sale )?rows?/i.exec(filtered) || [])[1]?.replace(/,/g, ''));
    record('Sales History · search narrows the list',
      Number.isFinite(after) && after < rowsShown && after > 0,
      `${rowsShown} → ${after} for "${target.orderNumber}"`);
    record('Sales History · the searched order is the one shown',
      filtered.includes(target.orderNumber));
    await search.fill('');
    await page.waitForTimeout(1200);
  } else {
    record('Sales History · search box present', false, 'not found');
  }

  // ══ REPORTS ════════════════════════════════════════════════════════════
  await adminSub(page, 'Reports');
  await shot(page, 'reports-daily');
  body = await page.locator('body').innerText();

  const revenueShown = /£/.test(body);
  record('Reports · renders figures', revenueShown);

  // Stock Report: per-model in-stock counts must sum to available stock.
  await page.getByRole('button', { name: /^Stock Report$/i }).first().click();
  await page.waitForTimeout(1800);
  await shot(page, 'reports-stock');

  const stockTotals = await page.evaluate(() => {
    // The per-model stock table heads its quantity column "Qty" and also
    // carries "Avg BP" — enough to tell it from the daily-sales table.
    const table = [...document.querySelectorAll('table')].find(t => {
      const head = (t.querySelector('thead')?.textContent || '').toLowerCase();
      return head.includes('qty') && head.includes('avg bp');
    });
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim().toLowerCase());
    const col = headers.findIndex(h => h === 'qty');
    if (col === -1) return null;
    let sum = 0; let rows = 0;
    for (const tr of table.querySelectorAll('tbody tr')) {
      const cells = tr.querySelectorAll('td');
      if (!cells[col]) continue;
      const n = Number((cells[col].textContent || '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n)) { sum += n; rows++; }
    }
    return { sum, rows };
  });

  record('Reports · Stock Report per-model counts sum to available stock',
    !!stockTotals && stockTotals.sum === available.length,
    stockTotals ? `${stockTotals.sum} across ${stockTotals.rows} models · store ${available.length}`
                : 'stock table not found');

  // The CSV export is the deliverable here, so parse what actually downloads.
  // The two tabs label the same action differently — "Export CSV" on Daily
  // Sales, plain "CSV" on Stock Report.
  const exportBtn = page.getByRole('button', { name: /^(Export CSV|CSV)$/i }).first();
  if (await exportBtn.isVisible().catch(() => false)) {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      exportBtn.click(),
    ]);
    const csv = readFileSync(await dl.path(), 'utf8');
    const lines = csv.trim().split('\n').filter(Boolean);
    record('Reports · the CSV export contains rows, not just a header',
      lines.length > 1, `${lines.length - 1} data rows`);
    record('Reports · the CSV export has one row per model in the table',
      !stockTotals || lines.length - 1 === stockTotals.rows,
      `${lines.length - 1} csv · ${stockTotals?.rows ?? '?'} on screen`);
  } else {
    record('Reports · offers a CSV export', false, 'no export button');
  }

  // ══ INSIGHTS ═══════════════════════════════════════════════════════════
  await adminSub(page, 'Insights');
  await expandInsightsSections(page);
  await shot(page, 'insights');
  body = await page.locator('body').innerText();

  // Every section must render — but the real checks are the sums below.
  const SECTIONS = [
    'Per-Marketplace Margin', 'Top 10 Best Sellers', 'Slow Movers',
    'Supplier Performance', 'Platform Scorecard', 'Aged Stock',
    'Fast Movers', 'Sales Calendar',
  ];
  for (const s of SECTIONS) {
    record(`Insights · "${s}" renders`, body.toUpperCase().includes(s.toUpperCase()));
  }

  // Parts sum to the whole — the property the scorecard bug violated.
  const scorecardCounts = await page.evaluate(() => {
    const out = {};
    const text = document.body.innerText;
    for (const label of ['eBay', 'Amazon', 'OnBuy', 'Backmarket']) {
      const m = new RegExp(`${label}\\s*\\n+\\s*([\\d,]+)\\s*\\n+\\s*units sold`, 'i').exec(text);
      out[label] = m ? Number(m[1].replace(/,/g, '')) : null;
    }
    return out;
  });
  const scorecardTotal = Object.values(scorecardCounts).reduce((a, b) => a + (b ?? 0), 0);
  record('Insights · Platform Scorecard totals reconcile with sold units',
    scorecardTotal === sold.length,
    `${JSON.stringify(scorecardCounts)} = ${scorecardTotal} · store ${sold.length}`);

  // Insights carries TWO supplier tables: "Supplier Performance · Sales",
  // built from sale records, and "Supplier Performance", built from units.
  // They answer different questions and have different denominators — a sale
  // with no matching unit counts in the first and not the second — so each is
  // reconciled against its own source.
  const supplierTables = await page.evaluate(() => {
    const out = [];
    for (const table of document.querySelectorAll('table')) {
      const head = (table.querySelector('thead')?.textContent || '').toLowerCase();
      if (!head.includes('supplier')) continue;
      const headers = [...table.querySelectorAll('thead th')].map(th => (th.textContent || '').trim().toLowerCase());
      const col = headers.findIndex(h => h === 'sold');
      if (col === -1) continue;
      let sum = 0; let rows = 0;
      for (const tr of table.querySelectorAll('tbody tr')) {
        const cells = tr.querySelectorAll('td');
        if (!cells[col]) continue;
        const n = Number((cells[col].textContent || '').replace(/[^\d.-]/g, ''));
        if (Number.isFinite(n)) { sum += n; rows++; }
      }
      out.push({ sum, rows });
    }
    return out;
  });

  record('Insights · a supplier table reconciles with live sales',
    supplierTables.some(t => t.sum === liveSales.length),
    `${JSON.stringify(supplierTables.map(t => t.sum))} · live sales ${liveSales.length}`);

  record('Insights · a supplier table reconciles with sold units',
    supplierTables.some(t => t.sum === sold.length),
    `${JSON.stringify(supplierTables.map(t => t.sum))} · sold units ${sold.length}`);

  record('Insights · no supplier table invents sales out of nowhere',
    supplierTables.length > 0 && supplierTables.every(t => t.sum <= liveSales.length),
    `max ${Math.max(0, ...supplierTables.map(t => t.sum))} · live sales ${liveSales.length}`);

  // Aged Stock buckets are the same shape of claim about held stock.
  // Scraping a fixed character window ran past the section into the next one
  // and double-counted. Read the four labelled buckets from the DOM instead.
  const agedBuckets = await page.evaluate(() => {
    const LABELS = ['0 – 30 days', '31 – 60 days', '61 – 90 days', '90+ days'];
    // Walk UP from each label only as far as the first ancestor that also
    // holds a "<n> units" span. Going further caught the section's £ figures
    // and read a stock value as a unit count.
    const found = {};
    for (const el of document.querySelectorAll('span')) {
      const label = (el.textContent || '').trim();
      if (!LABELS.includes(label)) continue;
      let node = el.parentElement;
      for (let hops = 0; node && hops < 4; hops++, node = node.parentElement) {
        const countSpan = [...node.querySelectorAll('span')]
          .find(sp => /^\d+\s*units?$/.test((sp.textContent || '').trim()));
        if (countSpan) {
          found[label] = Number((countSpan.textContent || '').replace(/[^\d]/g, ''));
          break;
        }
      }
    }
    return found;
  });
  const agedSum = Object.values(agedBuckets).reduce((a, b) => a + b, 0);
  record('Insights · Aged Stock buckets sum to available stock',
    Object.keys(agedBuckets).length === 4 && agedSum === available.length,
    `${JSON.stringify(agedBuckets)} = ${agedSum} · available ${available.length}`);

  record('Insights · no section shows a bare zero while sales exist',
    !(scorecardTotal === 0 && sold.length > 0),
    'the exact failure the live screenshot showed');

  // ── Mobile ─────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  for (const sub of ['Sales History', 'Reports', 'Insights']) {
    await adminSub(page, sub);
    await shot(page, `mobile-${sub.toLowerCase().replace(/\s+/g, '-')}`);
    const overflow = await page.evaluate(() =>
      Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    record(`mobile · ${sub} does not overflow sideways`, overflow === 0, `overflow=${overflow}px`);
  }

  record('no uncaught JS errors across the deep dive', jsErrors.length === 0,
    jsErrors.slice(0, 3).join(' | '));

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
