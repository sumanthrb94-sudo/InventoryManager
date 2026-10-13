/**
 * scripts/e2eImportStockGate.mjs — the sold-but-not-in-stock warning, driven
 * through the real Sales Report import.
 *
 * The 12-Oct upload: 85 sales, office stock fell by 63. The other 22 sold
 * IMEIs were not in stock — 20 never stocked in, 2 deleted as
 * "QC Fail - RTS (Return to Supplier)" — and the importer created each one as
 * an already-sold unit without saying so. This proves the preview now:
 *
 *   1. lists every such IMEI under the right heading — Returned to supplier
 *      (RTS), Deleted from stock, Never stocked in — with the reason;
 *   2. leaves an ordinary in-stock sale out of the list;
 *   3. keeps Confirm locked until the warning is ticked, independently of the
 *      existing "units will flip to sold" tick;
 *   4. once ticked, loads every sale and still sells the in-stock unit.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eImportStockGate.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { writeRowByHeader, clearDataRows } from './e2eSheetHelpers.mjs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/import-stock-gate');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const SALES_FILE = resolve('/tmp', 'e2e-import-stock-gate.xlsx');

const MODEL = 'Galaxy A32';
const SUPPLIER = 'MHL';

const IN_STOCK      = '359999999990001'; // available — sells normally
const RTS_RECORD    = '359999999990002'; // unit still on returnType returned_to_supplier
const RTS_DELETED   = '359999999990003'; // deleted with an RTS reason
const QC_DELETED    = '359999999990004'; // deleted, not RTS
const NEVER_STOCKED = '359999999990005'; // no record anywhere

const ROWS = [IN_STOCK, RTS_RECORD, RTS_DELETED, QC_DELETED, NEVER_STOCKED].map((imei, i) => ({
  'Date': '2026-10-10', 'Order Number': `GATE-${i + 1}`, 'SKU': 'SG-A32-64-BK', 'IMEI': imei,
  'Model': MODEL, 'Supplier': SUPPLIER, 'BP': 62, 'SP': 98, 'Postage': 0,
}));

async function buildSalesFile() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('templates/SALES_AMAZON_TEMPLATE.xlsx');
  const ws = wb.getWorksheet('AMAZON');
  clearDataRows(ws);
  ROWS.forEach((r, i) => writeRowByHeader(ws, i + 2, r));
  await wb.xlsx.writeFile(SALES_FILE);
}

let failures = 0, checks = 0;
function check(label, got, want) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(want)})`}`);
}

await buildSalesFile();

const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const dir = readdirSync(root).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({ executablePath: dir ? `${root}/${dir}/chrome-linux/chrome` : undefined });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(String(e)));

await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(({ model, supplier, IN_STOCK, RTS_RECORD, RTS_DELETED, QC_DELETED }) => {
  const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
  s.models = { 'mdl-a32': { id: 'mdl-a32', brand: 'Samsung', model, ownerId: 'shared', createdAt: '2026-01-01' } };
  s.suppliers = { 'sup-mhl': { id: 'sup-mhl', name: supplier, ownerId: 'shared', createdAt: '2026-01-01' } };
  const unit = (imei, extra) => ({
    id: imei, imei, model, storage: '64GB', colour: 'Black', buyPrice: 62, dateIn: '2026-09-24',
    supplierName: supplier, flags: [], platformListed: false, ownerId: 'shared', createdAt: '2026-09-24', ...extra,
  });
  s.inventoryUnits = {
    [IN_STOCK]: unit(IN_STOCK, { status: 'available' }),
    [RTS_RECORD]: unit(RTS_RECORD, { status: 'returned', returnType: 'returned_to_supplier', returnDate: '2026-10-05' }),
  };
  const del = (imei, reason) => ({
    id: `del_${imei}`, imei, unitId: imei, source: 'office', reason,
    deletedAt: '2026-10-08T16:35:00.000Z', deletedBy: 'ops1@inventorymanager.com',
    model, storage: '64GB', supplierName: supplier, ownerId: 'shared',
  });
  s.deletedUnits = {
    [`del_${RTS_DELETED}`]: del(RTS_DELETED, 'QC Fail - RTS (Return to Supplier)'),
    [`del_${QC_DELETED}`]: del(QC_DELETED, 'QC Fail - water damage'),
  };
  s.sales = {};
  sessionStorage.setItem('__e2e_firestore__', JSON.stringify(s));
}, { model: MODEL, supplier: SUPPLIER, IN_STOCK, RTS_RECORD, RTS_DELETED, QC_DELETED });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('\n1 · preview names every sold phone that was not in stock');
await page.getByRole('button', { name: /Import Sales Report/i }).first().click();
await page.waitForTimeout(800);
await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
await page.waitForTimeout(3500);
const modal = page.locator('div.fixed.inset-0').last();
const gate = modal.locator('[data-testid="stock-gate"]');
await gate.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
await gate.scrollIntoViewIfNeeded().catch(() => {});
await gate.screenshot({ path: `${OUT}/01-stock-gate.png` }).catch(() => {});
const gateText = await gate.innerText().catch(() => '');
check('headline counts 4 phones', /4 sold phones were not in stock/i.test(gateText), true);
const section = (title) => {
  const i = gateText.indexOf(title);
  if (i < 0) return '';
  const rest = gateText.slice(i + title.length);
  const next = ['Returned to supplier (RTS)', 'Deleted from stock', 'Never stocked in', 'Agreed order']
    .map(t => rest.indexOf(t)).filter(n => n >= 0);
  return rest.slice(0, next.length ? Math.min(...next) : undefined);
};
const rts = section('Returned to supplier (RTS)');
const deleted = section('Deleted from stock');
const never = section('Never stocked in');
check('RTS lists the unit still with the supplier', rts.includes(RTS_RECORD), true);
check('RTS lists the unit deleted with an RTS reason', rts.includes(RTS_DELETED), true);
check('RTS row shows the deletion reason', /QC Fail - RTS \(Return to Supplier\)/.test(rts), true);
check('Deleted lists the QC-deleted unit (not RTS)', deleted.includes(QC_DELETED) && !rts.includes(QC_DELETED), true);
check('Deleted row shows its reason', /water damage/.test(deleted), true);
check('Never stocked in lists the unknown IMEI', never.includes(NEVER_STOCKED), true);
check('the in-stock sale is NOT in the warning', gateText.includes(IN_STOCK), false);

console.log('\n2 · Confirm stays locked until the warning is ticked');
const confirmBtn = modal.locator('button.bg-emerald-600').last();
const gateBox = modal.locator('[data-testid="stock-gate-ack"]');
const boxes = modal.locator('input[type="checkbox"]');
for (let i = 0; i < await boxes.count(); i++) {
  const b = boxes.nth(i);
  if ((await b.getAttribute('data-testid')) === 'stock-gate-ack') continue;
  if (!(await b.isChecked())) await b.check().catch(() => {});
}
await page.waitForTimeout(300);
check('with every OTHER box ticked, Confirm is still disabled', await confirmBtn.isDisabled(), true);
await gateBox.check();
await page.waitForTimeout(300);
check('ticking the warning enables Confirm', await confirmBtn.isDisabled(), false);
await modal.screenshot({ path: `${OUT}/02-acknowledged.png` }).catch(() => {});

console.log('\n3 · confirming still loads everything');
await confirmBtn.click();
await page.waitForTimeout(6000);
const store = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}'));
const sales = Object.values(store.sales || {});
check('all 5 sales written', sales.length, 5);
check('the in-stock unit is now sold', store.inventoryUnits?.[IN_STOCK]?.status, 'sold');

check('no uncaught page errors', jsErrors, []);
await browser.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
