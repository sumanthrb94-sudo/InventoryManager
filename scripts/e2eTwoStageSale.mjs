/**
 * scripts/e2eTwoStageSale.mjs — the two-team sale, driven end to end.
 *
 * Team 1 knows the model, order number, SKU, marketplace and price but not the
 * IMEI. Team 2 knows which handset left the shelf. This walks both halves
 * through the real UI and checks the database after each, because the thing
 * that matters is not that the forms accept input — it is that stage 1 leaves
 * the stock ALONE while still producing a financially complete sale, and that
 * stage 2 recomputes the money against the handset actually picked.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eTwoStageSale.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/two-stage-sale';
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
  await page.waitForTimeout(400);
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  page.setDefaultTimeout(15000);

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);

  const before = await dumpStore(page);
  const available = docsOf(before, 'inventoryUnits').filter(u => u.status === 'available' && (u.imei || '').trim());
  const target = available[0];
  record('found available stock to sell by model', !!target, target ? `${target.model} · ${target.imei}` : 'none');
  if (!target) { await browser.close(); return finish(); }

  const model = String(target.model || '').trim();
  const sameModel = available.filter(u => String(u.model || '').trim() === model);
  const salesBefore = docsOf(before, 'sales').length;
  const availBefore = available.length;

  // ══ STAGE 1 · the sales team, who cannot see the shelf ══
  console.log('\n══ STAGE 1 · record by model, no IMEI ══');
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /Mark Multiple Sold/i }).click();
  const modal = page.locator('div.bg-white.rounded-2xl').filter({ hasText: 'Mark Multiple Sold' }).first();
  await modal.waitFor({ state: 'visible' });

  const row = modal.locator('tbody tr').first();
  // NOT selected: 'Model only' is the default now, which is the point — team 1
  // must never be routed through an IMEI-listing source.
  record('the grid defaults to Model only',
    (await row.getByLabel('Source').inputValue()) === 'model');
  const modelCell = row.getByLabel('Model');
  await modelCell.click();
  await modelCell.fill(model);
  const listbox = page.locator('[role="listbox"][aria-label="Stock"]');
  await listbox.waitFor({ state: 'visible', timeout: 6000 });
  await listbox.getByRole('option').first().click();

  await row.getByLabel('SKU').fill('E2E-TWOSTAGE-1');
  await row.getByLabel('Order number').fill('TWOSTAGE-1');
  await row.getByLabel('Sale price').fill('399');
  await shot(page, 'stage1-filled');

  const confirmBtn = page.getByRole('button', { name: /Update \d+ Sale/i });
  record('the action reads Update, not Confirm — nothing is being sold yet',
    await confirmBtn.isVisible().catch(() => false));
  record('the model-only row is accepted as ready', await confirmBtn.isEnabled().catch(() => false));
  await confirmBtn.first().click();
  await page.getByText('Nothing else to do', { exact: false }).waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await shot(page, 'stage1-done');
  await page.getByRole('button', { name: /^Close$/i }).last().click().catch(() => {});
  await page.waitForTimeout(1200);

  const mid = await dumpStore(page);
  const pending = docsOf(mid, 'sales').find(s => s.orderNumber === 'TWOSTAGE-1');

  record('a sale document was created', !!pending, pending ? pending.id : 'not found');
  record('it is flagged awaiting an IMEI', !!pending?.awaitingImei);
  record('it has NO unit linked', !pending?.unitId && !String(pending?.imei || '').trim(),
    `unitId=${pending?.unitId ?? '—'} imei="${pending?.imei ?? ''}"`);

  // The point of the whole design: stock must not move at stage 1.
  const availMid = docsOf(mid, 'inventoryUnits').filter(u => u.status === 'available').length;
  record('NO unit was marked sold — stock is untouched', availMid === availBefore,
    `${availBefore} → ${availMid} available`);

  // ...while still being financially complete, because the report and the VAT
  // return read this row the moment it exists.
  record('the sale still carries commission and VAT',
    Number(pending?.commission) > 0 && Number.isFinite(Number(pending?.totalVat)),
    `commission £${pending?.commission} · totalVat £${pending?.totalVat}`);
  record('its buy price is marked provisional', pending?.provisionalBuyPrice === true,
    `BP £${pending?.buyPrice}`);

  // ══ STAGE 2 · the warehouse, who has the handset ══
  console.log('\n══ STAGE 2 · attach the IMEI and mark sold ══');
  await gotoTab(page, 'Inventory');
  await page.getByRole('button', { name: /Mark Multiple Sold/i }).click();
  await page.locator('div.bg-white.rounded-2xl').filter({ hasText: 'Mark Multiple Sold' })
            .first().waitFor({ state: 'visible' });
  // Team 2 works in the SAME screen — a tab inside this modal, not a separate
  // panel behind it.
  const stageTab = page.getByRole('tab', { name: /Update IMEI/i });
  record('the second stage is a tab in Mark Multiple Sold', await stageTab.isVisible().catch(() => false));
  await stageTab.click();
  const panel = page.getByText('Awaiting IMEI', { exact: false }).first();
  record('the warehouse queue shows the waiting sale', await panel.isVisible().catch(() => false));
  await shot(page, 'stage2-queue');

  const select = page.getByLabel('IMEI for TWOSTAGE-1');
  const optionCount = await select.locator('option').count().catch(() => 0);
  record('the IMEI dropdown is filtered to that model',
    optionCount - 1 === sameModel.length, `${optionCount - 1} offered · ${sameModel.length} of that model in stock`);

  await select.selectOption({ index: 1 });
  await page.getByRole('button', { name: /Mark Sold/i }).first().click();
  await page.waitForTimeout(2000);
  await shot(page, 'stage2-done');

  const after = await dumpStore(page);
  const done = docsOf(after, 'sales').find(s => s.orderNumber === 'TWOSTAGE-1');
  record('the sale is no longer awaiting an IMEI', done?.awaitingImei === false);
  record('an IMEI is now attached', !!String(done?.imei || '').trim(), done?.imei);
  record('the buy price is no longer provisional', done?.provisionalBuyPrice === false,
    `BP £${done?.buyPrice}`);

  const soldUnit = docsOf(after, 'inventoryUnits').find(u => u.id === done?.unitId);
  record('that unit is now marked sold', soldUnit?.status === 'sold', `${soldUnit?.imei} → ${soldUnit?.status}`);
  record('exactly ONE unit left stock across both stages',
    docsOf(after, 'inventoryUnits').filter(u => u.status === 'available').length === availBefore - 1,
    `${availBefore} → ${docsOf(after, 'inventoryUnits').filter(u => u.status === 'available').length}`);
  record('one sale document, not two', docsOf(after, 'sales').length === salesBefore + 1,
    `${salesBefore} → ${docsOf(after, 'sales').length}`);
  record('the queue is empty again',
    !(await page.getByLabel('IMEI for TWOSTAGE-1').isVisible().catch(() => false)));

  await browser.close();
  finish();
}

function finish() {
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${'='.repeat(64)}\nRESULT: ${pass}/${results.length} passed\n${'='.repeat(64)}`);
  if (pass !== results.length) {
    console.log('\n── Failures ──');
    results.filter(r => !r.ok).forEach(r => console.log(`FAIL  ${r.name} — ${r.detail}`));
    process.exitCode = 1;
  }
}

run().catch(e => { console.error(e); process.exit(1); });
