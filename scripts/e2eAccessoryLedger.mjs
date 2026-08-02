/**
 * scripts/e2eAccessoryLedger.mjs — proves the accessory ledger + the Adjust
 * action work end to end from Configuration → Accessory Stock, and that
 * every action produces a traceable AccessoryStockEvent row with the right
 * delta/quantityAfter/reason.
 *
 * No manual "Sell" action exists on purpose — every real accessory sale
 * flows through a marketplace, so decrementAccessoryStock (fired from the
 * Sales Report import) is the only sale path; a manual alternative would
 * just risk double-recording a sale the import already caught.
 *
 * Return is deliberately NOT exercised here — since Return now voids a real
 * marketplace Sale doc (picked from a dropdown, with a Refund/Replacement/
 * Repair outcome) rather than taking a bare typed quantity, it needs a real
 * sale to exist first. That full sell → return → Sales-Report-visibility →
 * wipe/reupload-reconciliation flow is covered end to end by
 * scripts/e2eAccessoryReturnReconcile.mjs instead.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAccessoryLedger.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const OUT = 'e2e-screenshots/accessory-ledger';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const SKU = 'USB-C-20W';
const NAME = 'USB-C 20W Charger';

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  console.log(`      ↳ ${file}`);
}
function modal(page) { return page.locator('div.fixed.inset-0').last(); }
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
async function readStore(page) {
  return page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}');
    return {
      accessoryStock: Object.values(s.accessoryStock || {}),
      accessoryStockEvents: Object.values(s.accessoryStockEvents || {}),
    };
  });
}
function poolFor(store) { return store.accessoryStock.find(a => a.sku === SKU); }

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  // ══ 1. Create the accessory pool (20 units) ═════════════════════════════
  console.log('\n── 1. Add Stock → Accessories: 20 x USB-C 20W Charger ──');
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /^Add Stock$/i }).click();
  await page.waitForTimeout(600);
  await modal(page).getByRole('button', { name: /^Accessories/i }).click();
  await page.waitForTimeout(400);
  // Accessory intake is a strict catalog picker since 2026-08 (commit
  // 482307e) — the free-text SKU box is gone. Type into the search field,
  // then take the admin-only Add "<sku>" pill to mint a new catalog entry.
  await modal(page).locator('input[placeholder*="Search — e.g." i]').first().fill(SKU);
  await page.waitForTimeout(700);
  const addPill = modal(page).getByRole('button', { name: new RegExp(`Add "${SKU}"`, 'i') }).first();
  if (await addPill.isVisible().catch(() => false)) await addPill.click();
  await page.waitForTimeout(500);
  await modal(page).locator('input[placeholder*="e.g. USB-C 20W Charger" i]').first().fill(NAME).catch(() => {});
  await modal(page).locator('input[placeholder="e.g. 50"]').first().fill('20');
  await modal(page).locator('input[placeholder="0.00"]').first().fill('3.5');
  await page.waitForTimeout(300);
  await modal(page).getByRole('button', { name: /Save \d+ accessory line/i }).click();
  await page.waitForTimeout(1200);
  await dismissModals(page);

  let store = await readStore(page);
  record('Pool created at 20', poolFor(store)?.quantity === 20, `quantity=${poolFor(store)?.quantity}`);
  record('Topup event logged', store.accessoryStockEvents.some(e => e.type === 'topup' && e.delta === 20));

  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(700);
  const accHeading = page.getByRole('heading', { name: /^Accessory Stock$/i }).first();
  await accHeading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, 'pool-created-20-units');

  // ══ 2. Sanity check — no Sell action exists at all ══════════════════════
  console.log('\n── 2. Confirm there is no manual Sell action ──');
  const sellBtnVisible = await page.getByRole('button', { name: /^Sell$/i }).first().isVisible().catch(() => false);
  record('No "Sell" button on the Accessory Stock row (every real sale flows through Sales Report import)', !sellBtnVisible);

  // ══ 3. Adjust +5 ("found more") — should bump totalReceived too ═════════
  console.log('\n── 3. Adjust +5 (found extra stock) ──');
  const adjustBtn = page.getByRole('button', { name: /^Adjust$/i }).first();
  await adjustBtn.click();
  await page.waitForTimeout(500);
  const foundBtn = modal(page).getByRole('button', { name: /Found \+/i });
  await foundBtn.click();
  await modal(page).locator('input[type="number"]').first().fill('5');
  await modal(page).getByPlaceholder(/damaged in storage/i).fill('Found an extra box in the stockroom');
  await page.waitForTimeout(200);
  await shot(page, 'adjust-found-filled');
  await modal(page).getByRole('button', { name: /Confirm Adjust/i }).click();
  await page.waitForTimeout(1000);
  await modal(page).getByRole('button', { name: /^Close$/i }).click().catch(() => {});
  await dismissModals(page);

  store = await readStore(page);
  record('Adjust +5: 20 + 5 = 25', poolFor(store)?.quantity === 25, `quantity=${poolFor(store)?.quantity}`);
  record('totalReceived bumped by the positive adjustment too (20 + 5 = 25)', poolFor(store)?.totalReceived === 25, `totalReceived=${poolFor(store)?.totalReceived}`);

  // ══ 4. Adjust -2 ("damaged") — should NOT touch totalReceived ═══════════
  console.log('\n── 4. Adjust -2 (damaged in storage) ──');
  await adjustBtn.click();
  await page.waitForTimeout(500);
  const lostBtn = modal(page).getByRole('button', { name: /Lost −/i });
  await lostBtn.click();
  await modal(page).locator('input[type="number"]').first().fill('2');
  await modal(page).getByPlaceholder(/damaged in storage/i).fill('2 units water damaged');
  await page.waitForTimeout(200);
  await modal(page).getByRole('button', { name: /Confirm Adjust/i }).click();
  await page.waitForTimeout(1000);
  await modal(page).getByRole('button', { name: /^Close$/i }).click().catch(() => {});
  await dismissModals(page);

  store = await readStore(page);
  record('Adjust -2: 25 - 2 = 23', poolFor(store)?.quantity === 23, `quantity=${poolFor(store)?.quantity}`);
  record('totalReceived unchanged by the negative adjustment (still 25)', poolFor(store)?.totalReceived === 25, `totalReceived=${poolFor(store)?.totalReceived}`);
  const adjEvent = store.accessoryStockEvents.filter(e => e.type === 'adjustment').find(e => e.delta === -2);
  record('Negative-adjustment event carries the reason', adjEvent?.reason === '2 units water damaged');

  // ══ 5. Return is GONE from the accessory panel ══════════════════════════
  // This step used to click Return and assert the modal blocked a return
  // with no sale on file. That whole action was removed in 2026-08: a real
  // accessory return arrives through the Sales Report like every other
  // return, so a second manual path could only ever disagree with it. Adjust
  // stays, because a miscount is a real thing that has no sale behind it.
  // The reversal flow itself lives in e2eAccessoryReturnReconcile.mjs.
  console.log('\n── 5. Return is gone from the accessory panel — Adjust is the only manual action ──');
  const returnBtn = page.getByRole('button', { name: /^Return$/i });
  record('Accessory row offers no Return action', await returnBtn.count() === 0,
    `found ${await returnBtn.count()} Return button(s)`);
  record('Accessory row still offers Adjust',
    await page.getByRole('button', { name: /^Adjust$/i }).count() > 0);
  await shot(page, 'return-action-removed');

  // ══ 6. History — expand and check every event renders ═══════════════════
  console.log('\n── 6. Expand History and check the ledger renders ──');
  const historyBtn = page.locator('button[title="History"]').first();
  await historyBtn.click();
  await page.waitForTimeout(500);
  await shot(page, 'history-expanded');
  const pageText = await page.innerText('body').catch(() => '');
  record('History shows the topup', /Topped up \+20/.test(pageText));
  record('History shows the +5 adjustment with reason', /Adjusted \+5.*Found an extra box/.test(pageText));
  record('History shows the -2 adjustment with reason', /Adjusted -2.*water damaged/.test(pageText));
  record('All 3 ledger rows present in the store (no return event — nothing to return yet)', store.accessoryStockEvents.length === 3, `count=${store.accessoryStockEvents.length}`);

  record('No uncaught JS errors across the whole run', jsErrors.length === 0, jsErrors.slice(0, 2).join(' | '));

  await ctx.close();
  await browser.close();

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
