/**
 * scripts/e2eTemplateDownloads.mjs — can an operator get the standard from
 * inside the app, at the moment they need it?
 *
 * The templates are only a standard if they're reachable. A file in a repo
 * folder is documentation; a button next to the report is a procedure. This
 * drives both placements and, critically, parses what comes back — a link
 * that 404s or serves an HTML error page still *looks* like it worked.
 *
 *   1. Inventory Report menu → Blank template rows
 *   2. Sales Report menu → one row per channel
 *   3. Import modals → the same offer at the point of upload
 *   4. Download one and check it parses with the real headers
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eTemplateDownloads.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/template-downloads';

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
  // The Import dropdown is gone. Inventory and Sales import are now two
  // labelled icon buttons in the header (App.tsx, behind SHOW_IMPORT_UI &&
  // userIsAdmin), so there is no menu to open — the click that used to follow
  // this call now targets the button directly. Kept as a no-op so the call
  // sites read the same and the diff stays reviewable.
  await page.waitForTimeout(200);
}

/** Template links, as rendered — an <a download> pointing into /templates/. */
function templateLinks(scope) {
  return scope.locator('a[download$=".xlsx"]');
}

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

  // ── 1. Inventory Report menu ─────────────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /Inventory Report/i }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'inventory-report-menu-templates');

  const invLinks = templateLinks(page);
  const invFiles = await invLinks.evaluateAll(as => as.map(a => a.getAttribute('download')));
  record('Inventory Report menu offers the blank templates',
    invFiles.includes('INVENTORY_REPORT_TEMPLATE.xlsx') && invFiles.includes('SHS_STOCK_TEMPLATE.xlsx'),
    invFiles.join(', ') || 'none');

  // ── 2. Download one and prove it is a real workbook ──────────────────────
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    invLinks.filter({ hasText: /Inventory template/i }).first().click(),
  ]);
  record('the download is named for the template', download.suggestedFilename() === 'INVENTORY_REPORT_TEMPLATE.xlsx',
    download.suggestedFilename());

  let headers = [];
  let sheetNames = [];
  try {
    const wb = XLSX.read(readFileSync(await download.path()), { type: 'buffer' });
    sheetNames = wb.SheetNames;
    headers = (XLSX.utils.sheet_to_json(wb.Sheets.INVENTORY, { header: 1, raw: false, defval: '' })[0] ?? []).map(String);
  } catch (e) {
    record('served template parses as a workbook', false, String(e).slice(0, 80));
  }

  // A 404 or an SPA index.html fallback would download "something" — this is
  // the check that tells the two apart.
  record('served template parses as a real .xlsx', sheetNames.includes('INVENTORY'),
    sheetNames.join(', ') || 'not a workbook');

  record('served template carries the current 11-column schema',
    headers.slice(0, 11).join(' | ') ===
      'Stock In Date | Model | IMEI | Grade | Storage | SIM Type | Colour | Supplier | BP | Stock Type | Notes',
    headers.join(' | ') || 'no header row');

  record('served template keeps its README sheet', sheetNames.includes('README'),
    sheetNames.join(', '));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 3. Sales Report menu — one row per channel ───────────────────────────
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /Sales Report/i }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'sales-report-menu-templates');

  const salesFiles = await templateLinks(page).evaluateAll(as => as.map(a => a.getAttribute('download')));
  const wantSales = ['SALES_REPORT_TEMPLATE.xlsx', 'SALES_AMAZON_TEMPLATE.xlsx',
    'SALES_BM_TEMPLATE.xlsx', 'SALES_EBAY_TEMPLATE.xlsx', 'SALES_ONBUY_TEMPLATE.xlsx',
    'SALES_TEMU_TEMPLATE.xlsx'];
  record('Sales Report menu offers the combined and per-channel templates',
    wantSales.every(f => salesFiles.includes(f)),
    `${salesFiles.length} offered`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await dismissModals(page);

  // ── 4. The import modals — the other moment the schema is needed ─────────
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Inventory Report$/i }).click();
  await page.waitForTimeout(800);
  await shot(page, 'inventory-import-modal-template');
  const invModalFiles = await templateLinks(modal(page)).evaluateAll(as => as.map(a => a.getAttribute('download')));
  record('inventory import modal offers the template before a file is picked',
    invModalFiles.includes('INVENTORY_REPORT_TEMPLATE.xlsx'),
    invModalFiles.join(', ') || 'none');
  await dismissModals(page);

  await openImportMenu(page);
  await page.getByRole('button', { name: /^Import Sales Report$/i }).click();
  await page.waitForTimeout(800);
  const salesModalAll = await templateLinks(modal(page)).evaluateAll(as => as.map(a => a.getAttribute('download')));
  record('sales import modal offers every channel while none is picked',
    salesModalAll.length === 6, `${salesModalAll.length} offered`);

  // Picking a channel should narrow the offer to that channel's layout —
  // handing an Amazon uploader a four-sheet workbook is no help.
  await modal(page).getByRole('button', { name: /^AMAZON$/i }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'sales-import-modal-amazon-template');
  const salesModalAmazon = await templateLinks(modal(page)).evaluateAll(as => as.map(a => a.getAttribute('download')));
  record('picking a marketplace narrows the offer to that channel',
    salesModalAmazon.length === 1 && salesModalAmazon[0] === 'SALES_AMAZON_TEMPLATE.xlsx',
    salesModalAmazon.join(', ') || 'none');

  await dismissModals(page);

  // ── 5. Mobile — the rows must stay tappable, not overflow ────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /Inventory Report/i }).first().click();
  await page.waitForTimeout(700);
  await shot(page, 'mobile-inventory-report-menu');
  const overflow = await page.evaluate(() =>
    Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  record('mobile · template rows do not push the page sideways', overflow === 0, `overflow=${overflow}px`);

  const tapTarget = await templateLinks(page).first().boundingBox().catch(() => null);
  record('mobile · template rows meet the touch-target minimum',
    !!tapTarget && tapTarget.height >= 32, tapTarget ? `${Math.round(tapTarget.height)}px tall` : 'not visible');

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
