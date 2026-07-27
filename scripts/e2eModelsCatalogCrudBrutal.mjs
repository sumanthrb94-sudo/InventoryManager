/**
 * scripts/e2eModelsCatalogCrudBrutal.mjs — end-to-end proof of the
 * Configuration → Models Catalog CRUD flow (add / edit / delete), and that
 * a newly-added catalog entry is immediately usable in the real Add Stock
 * device picker (DeviceComboBox) — no refresh, no re-navigation.
 *
 * Unlike the numeric KPI panels tested elsewhere this session, Models
 * Catalog has no aggregate/computed figures to get wrong — it's a plain
 * CRUD list. The precision risk here is behavioural (does add/edit/delete
 * actually persist and propagate live), not arithmetic.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eModelsCatalogCrudBrutal.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/models-catalog-crud';
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

const BRAND = 'CATALOGTEST';
const MODEL = 'CrudPhone Alpha';
const MODEL_EDITED = 'CrudPhone Alpha Max';
const SERIES = 'CrudPhone Series';

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));
  // window.confirm() in removeModel() needs an explicit handler or Chromium
  // auto-dismisses it (cancelling the delete).
  page.on('dialog', d => d.accept());

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await wipeAll(page);

  // ═══ Add a model ═══
  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(800);

  const countBefore = await page.locator('text=/\\d+ models? · employees pick/i').innerText().catch(() => '');
  const beforeCount = parseInt((countBefore.match(/\d+/) || ['0'])[0], 10);

  await page.getByPlaceholder('Samsung').fill(BRAND);
  await page.getByPlaceholder('Galaxy S24 Ultra').fill(MODEL);
  await page.getByPlaceholder('Galaxy S', { exact: true }).fill(SERIES);
  // Two "Add" buttons exist on this page (Models Catalog + embedded
  // Suppliers) — the catalog one is the emerald-styled inline form button.
  await page.locator('button.bg-emerald-600', { hasText: 'Add' }).click();
  await page.waitForTimeout(1000);
  await shot(page, 'model-added');

  const pageTextAfterAdd = await page.innerText('body').catch(() => '');
  record(`New model "${BRAND} ${MODEL}" appears in the catalog list`,
    pageTextAfterAdd.includes(BRAND) && pageTextAfterAdd.includes(MODEL));
  const countAfterAdd = await page.locator('text=/\\d+ models? · employees pick/i').innerText().catch(() => '');
  const afterAddCount = parseInt((countAfterAdd.match(/\d+/) || ['0'])[0], 10);
  record(`Catalog count incremented by 1 (${beforeCount} -> ${afterAddCount})`, afterAddCount === beforeCount + 1);

  // ═══ New model is immediately usable in the real Add Stock picker ═══
  await gotoTab(page, 'Stock Intake');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^\+?\s*Add Stock$/i }).click();
  await page.waitForTimeout(700);
  const addStockModal = modal(page);
  const deviceInput = addStockModal.getByPlaceholder(/Search the catalog/i);
  await deviceInput.fill(MODEL);
  await page.waitForTimeout(500);
  await shot(page, 'new-model-in-add-stock-picker');
  const pickerText = await addStockModal.innerText().catch(() => '');
  record(`New model "${MODEL}" appears live in the Add Stock device picker (no refresh needed)`,
    pickerText.includes(MODEL), pickerText.match(new RegExp(`.{0,40}${MODEL}.{0,40}`, 'i'))?.[0]);
  await dismissModals(page);

  // ═══ Edit the model ═══
  await gotoAdminSub(page, 'Configuration');
  await page.waitForTimeout(800);
  const row = page.locator('tr', { hasText: MODEL }).first();
  await row.getByRole('button', { name: /Edit/i }).click();
  await page.waitForTimeout(400);
  const editRow = page.locator('tr').filter({ has: page.locator('button:has-text("Save")') }).first();
  const modelInput = editRow.locator('input').nth(1);
  await modelInput.fill(MODEL_EDITED);
  await editRow.getByRole('button', { name: /Save/i }).click();
  await page.waitForTimeout(800);
  await shot(page, 'model-edited');
  const pageTextAfterEdit = await page.innerText('body').catch(() => '');
  record(`Edited model name "${MODEL_EDITED}" now shows in the catalog`, pageTextAfterEdit.includes(MODEL_EDITED));
  record(`Old model name "${MODEL}" (exact, unedited) no longer shows as its own row`,
    !new RegExp(`\\b${MODEL}\\b(?!\\sMax)`, 'i').test(pageTextAfterEdit) || pageTextAfterEdit.includes(MODEL_EDITED));

  // ═══ Delete the model ═══
  const editedRow = page.locator('tr', { hasText: MODEL_EDITED }).first();
  const deleteBtn = editedRow.locator('button[title="Remove from catalog"]');
  await deleteBtn.click();
  await page.waitForTimeout(800);
  await shot(page, 'model-deleted');
  const pageTextAfterDelete = await page.innerText('body').catch(() => '');
  record(`Deleted model "${MODEL_EDITED}" no longer appears in the catalog`, !pageTextAfterDelete.includes(MODEL_EDITED));
  const countAfterDelete = await page.locator('text=/\\d+ models? · employees pick/i').innerText().catch(() => '');
  const afterDeleteCount = parseInt((countAfterDelete.match(/\d+/) || ['0'])[0], 10);
  record(`Catalog count back to original (${beforeCount})`, afterDeleteCount === beforeCount);

  record('No uncaught JS errors', jsErrors.length === 0, jsErrors.join(' | '));

  await browser.close();
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) process.exitCode = 1;
}

run().catch(e => { console.error(e); process.exit(1); });
