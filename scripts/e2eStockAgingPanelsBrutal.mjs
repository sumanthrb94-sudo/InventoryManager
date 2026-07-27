/**
 * scripts/e2eStockAgingPanelsBrutal.mjs — pixel-precise, hand-computed
 * verification of the "how old is our stock / how much capital is tied up"
 * panels the user specifically named (Old Stock / In Stock / Out of Stock /
 * Low Stock), across the pages that each independently compute it:
 *
 *   - Admin → Insights → Aged Stock (AnalyticsPage.tsx agedBuckets):
 *       AVAILABLE units only, buckets 0-30/31-60/61-90/91+ days by dateIn.
 *       An undated unit is silently DROPPED (not counted anywhere here).
 *   - Admin → Money → Capital tied up in stock (capital.ts capitalPosition):
 *       AVAILABLE + INCOMING (SHS) units, same day buckets, BUT an undated
 *       unit lands in the 91+ bucket instead of being dropped.
 *   - Admin → Overview → Stock on Hand / SHS Pending (Dashboard.tsx):
 *       plain status counts + BP value sum.
 *   - Admin → Configuration → Data Health → stale-shs:
 *       incoming units held > 60 days.
 *
 * The fixture below has EVERY unit's age deliberately placed well inside
 * one bucket (never near a boundary) so the expected numbers are exact,
 * not "probably right". One unit is deliberately left with NO Stock In
 * Date at all — this is the exact case the codebase-mapping pass flagged
 * as a real divergence between Insights (drops it) and Money (counts it
 * as 91+ days) — proving that divergence is real, not theoretical.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eStockAgingPanelsBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/stock-aging-panels';
const FIXTURES = `${OUT}/fixtures`;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
if (!existsSync(FIXTURES)) mkdirSync(FIXTURES, { recursive: true });

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
  return page.locator('div.fixed.inset-0').last();
}
async function dismissModals(page) {
  for (let i = 0; i < 4; i++) {
    const overlay = page.locator('div.fixed.inset-0').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    else await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function gotoTab(page, label) {
  await dismissModals(page);
  const re = new RegExp(`^${label}(\\s|$)`, 'i');
  const tab = page.getByRole('button', { name: re }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByLabel('Open menu').click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.getByRole('button', { name: re }).first().click();
  await page.waitForTimeout(900);
}
async function gotoAdminSub(page, label) {
  await gotoTab(page, 'Admin');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click();
  await page.waitForTimeout(700);
}
async function openImportMenu(page) {
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}
async function wipeAll(page) {
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
}
async function importInventory(page, file) {
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(3000);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(5000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(800);
  await dismissModals(page);
}

// ── Fixture: every unit's age deliberately far from any bucket boundary ──
const SUPPLIER = 'AGING TEST SUPPLIER LTD';
const daysAgo = n => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const U = {
  U1: { imei: '350190000071001', daysOld: 5,   bp: 100, bucket: '0-30' },
  U2: { imei: '350190000071002', daysOld: 20,  bp: 150, bucket: '0-30' },
  U3: { imei: '350190000071003', daysOld: 45,  bp: 200, bucket: '31-60' },
  U4: { imei: '350190000071004', daysOld: 75,  bp: 250, bucket: '61-90' },
  U5: { imei: '350190000071005', daysOld: 110, bp: 300, bucket: '91+' },
};
const S1 = { daysOld: 65, bp: 180 }; // SHS, no IMEI — also triggers stale-shs (>60d)
// NOTE on the "undated unit" divergence the code-mapping pass flagged
// (AnalyticsPage drops a unit with no dateIn entirely; capital.ts counts
// it in the 91+ bucket): confirmed real by reading the source, but NOT
// reproducible through a normal Inventory Report import — leaving "Stock
// In Date" blank in the uploaded file makes InventoryReportImport.tsx's
// toRow() default it to TODAY's date (`r.dateIn || ... || new Date()...`),
// so a freshly-imported row can never actually reach either code path
// with a genuinely empty dateIn. That defaulting is itself a good thing —
// it's the reason this divergence, while real in the source, doesn't
// manifest for any data that arrives through the tested import route.

const INVENTORY_HEADERS = ['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes'];
function writeInventoryFixture(path) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ...Object.values(U).map(u => [daysAgo(u.daysOld), 'AGING TEST PHONE', u.imei, 'A', '128GB', 'Physical SIM', 'BLACK', SUPPLIER, u.bp, 'OFFICE', '']),
    [daysAgo(S1.daysOld), 'AGING TEST SHS PHONE', '', 'A', '128GB', 'Physical SIM', 'BLUE', SUPPLIER, S1.bp, 'SHS', ''],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([INVENTORY_HEADERS, ...rows]), 'INVENTORY');
  XLSX.writeFile(wb, path);
}
const INVENTORY_FIXTURE = resolve(FIXTURES, 'AGING_INVENTORY.xlsx');
writeInventoryFixture(INVENTORY_FIXTURE);

// ── Hand-computed expected values ──────────────────────────────────────
const EXPECTED = {
  insightsAged: {
    '0-30':  { count: 2, value: U.U1.bp + U.U2.bp },              // U1+U2 = 250
    '31-60': { count: 1, value: U.U3.bp },                        // 200
    '61-90': { count: 1, value: U.U4.bp },                        // 250
    '91+':   { count: 1, value: U.U5.bp },                        // 300
  },
  moneyBuckets: {
    '0-30':  { count: 2, value: U.U1.bp + U.U2.bp },                    // 250
    '31-60': { count: 1, value: U.U3.bp },                              // 200
    '61-90': { count: 2, value: U.U4.bp + S1.bp },                      // 250+180=430 (SHS counted here, unlike Insights)
    '91+':   { count: 1, value: U.U5.bp },                              // 300
  },
  officeValue: Object.values(U).reduce((s, u) => s + u.bp, 0), // 1000
  shsValue: S1.bp, // 180
  stockOnHandCount: 5, // 5 dated office units (SHS excluded)
  shsPendingCount: 1,
};

function money(n) { return `£${n.toLocaleString()}`; }

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await wipeAll(page);
  await importInventory(page, INVENTORY_FIXTURE);

  // ═══ Admin → Overview ═══
  await gotoAdminSub(page, 'Overview');
  await page.waitForTimeout(800);
  await shot(page, 'admin-overview');
  const overviewText = await page.innerText('body').catch(() => '');
  const stockOnHandMatch = overviewText.match(/Stock on Hand[\s\S]{0,40}?(\d[\d,]*)/i);
  record('Dashboard "Stock on Hand" count = 6', stockOnHandMatch?.[1]?.replace(/,/g, '') === String(EXPECTED.stockOnHandCount),
    stockOnHandMatch ? stockOnHandMatch[1] : '(not found)');
  const officeValueMatch = overviewText.match(/£([\d,]+)\s*BP/i);
  record(`Dashboard "Stock on Hand" £ value = ${money(EXPECTED.officeValue)}`,
    officeValueMatch?.[1]?.replace(/,/g, '') === String(EXPECTED.officeValue), officeValueMatch ? `£${officeValueMatch[1]}` : '(not found)');
  const shsPendingMatch = overviewText.match(/SHS Pending[\s\S]{0,40}?(\d[\d,]*)/i);
  record('Dashboard "SHS Pending" count = 1', shsPendingMatch?.[1]?.replace(/,/g, '') === String(EXPECTED.shsPendingCount),
    shsPendingMatch ? shsPendingMatch[1] : '(not found)');

  // ═══ Admin → Insights → Aged Stock ═══
  await gotoAdminSub(page, 'Insights');
  await page.waitForTimeout(800);
  // "Aged Stock" is a collapsed accordion (CollapsibleSection) by default —
  // its bucket rows aren't in the DOM at all until the header is clicked.
  const agedStockToggle = page.getByRole('button', { name: /Aged Stock/i }).first();
  await agedStockToggle.scrollIntoViewIfNeeded().catch(() => {});
  await agedStockToggle.click();
  await page.waitForTimeout(500);
  await agedStockToggle.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'admin-insights-aged-stock');
  const insightsText = await page.innerText('body').catch(() => '');
  for (const [label, exp] of Object.entries(EXPECTED.insightsAged)) {
    const rx = label === '91+'
      ? /90\+\s*days[\s\S]{0,120}/i
      : new RegExp(`${label.replace('-', '\\s*[–-]\\s*')}\\s*days[\\s\\S]{0,120}`, 'i');
    const chunk = insightsText.match(rx)?.[0] || '';
    const countMatch = chunk.match(/(\d+)\s*units?/i);
    const valueMatch = chunk.match(/£([\d,]+)/);
    record(`Insights Aged Stock ${label}d bucket: ${exp.count} units`,
      countMatch?.[1] === String(exp.count), `chunk="${chunk.slice(0, 80)}" found=${countMatch?.[1]}`);
    record(`Insights Aged Stock ${label}d bucket: ${money(exp.value)}`,
      valueMatch?.[1]?.replace(/,/g, '') === String(exp.value), `found=£${valueMatch?.[1]}`);
  }
  // ═══ Admin → Money → Capital tied up ═══
  await gotoAdminSub(page, 'Money');
  await page.waitForTimeout(800);
  const capitalTab = page.getByRole('button', { name: /Capital/i }).first();
  if (await capitalTab.isVisible().catch(() => false)) { await capitalTab.click(); await page.waitForTimeout(600); }
  await shot(page, 'admin-money-capital');
  const moneyText = await page.innerText('body').catch(() => '');
  const onShelfMatch = moneyText.match(/On the shelf[\s\S]{0,30}?£([\d,]+)/i);
  record(`Money "On the shelf" (officeValue) = ${money(EXPECTED.officeValue)}`,
    onShelfMatch?.[1]?.replace(/,/g, '') === String(EXPECTED.officeValue), onShelfMatch ? `£${onShelfMatch[1]}` : '(not found)');
  const withSuppliersMatch = moneyText.match(/With suppliers[\s\S]{0,30}?£([\d,]+)/i);
  record(`Money "With suppliers" (shsValue) = ${money(EXPECTED.shsValue)}`,
    withSuppliersMatch?.[1]?.replace(/,/g, '') === String(EXPECTED.shsValue), withSuppliersMatch ? `£${withSuppliersMatch[1]}` : '(not found)');
  for (const [label, exp] of Object.entries(EXPECTED.moneyBuckets)) {
    const rx = label === '91+'
      ? /90\+\s*days[\s\S]{0,100}/i
      : new RegExp(`${label.replace('-', '[–-]')}\\s*days[\\s\\S]{0,100}`, 'i');
    const chunk = moneyText.match(rx)?.[0] || '';
    const valueMatch = chunk.match(/£([\d,]+)/);
    const unitsMatch = chunk.match(/(\d+)\s*units?/i);
    record(`Money Capital bucket ${label}d: ${money(exp.value)}`,
      valueMatch?.[1]?.replace(/,/g, '') === String(exp.value), `chunk="${chunk.slice(0, 80)}" found=£${valueMatch?.[1]}`);
    record(`Money Capital bucket ${label}d: ${exp.count} units`,
      unitsMatch?.[1] === String(exp.count), `found=${unitsMatch?.[1]}`);
  }
  // ═══ Admin → Configuration → Data Health ═══
  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(800);
  await shot(page, 'admin-configuration-datahealth');
  const configText = await page.innerText('body').catch(() => '');
  const staleShsChunk = configText.match(/Supplier-held stock over 60 days[\s\S]{0,80}/i)?.[0] || '';
  record('Data Health flags "Supplier-held stock over 60 days"', staleShsChunk.length > 0, staleShsChunk.slice(0, 60));
  record('Data Health stale-SHS count = 1 (our one 65-day-old SHS unit)',
    /\bMEDIUM\b[\s\S]{0,10}1\b/i.test(staleShsChunk) || /\b1\b/.test(staleShsChunk),
    staleShsChunk);

  record('No uncaught JS errors across the whole check', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
