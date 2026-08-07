/**
 * scripts/e2eNewModelVatLifecycle.mjs
 *
 * Two things nothing else in the suite covers end to end:
 *
 * 1. THE NEW-MODEL LIFECYCLE, as it actually plays out in the shop.
 *    An employee goes to book in a handset whose model nobody has added to
 *    the catalog yet. They are blocked — deliberately, so a typo can't mint a
 *    junk model. An admin adds it. After a REFRESH the employee can book the
 *    stock in. That refresh step is the one that matters: the catalog is a
 *    live Firestore subscription, and "does it actually show up for the next
 *    person" is the question an operator asks.
 *
 * 2. THE MARKETPLACE VAT CHAIN. The existing lifecycle script verifies GP and
 *    GP% against independent maths; it never checks the VAT lines that sit
 *    between them. Amazon has the richest chain (C.VAT → DSF → DSF VAT →
 *    P.VAT → Total VAT → Total VAT NTP), so it's the one worth pinning.
 *
 * Ground truth is transcribed from the operator's master formulas inside this
 * file — deliberately NOT imported from platforms.ts, so a bug in the app's
 * calculator cannot verify itself.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eNewModelVatLifecycle.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/new-model-vat';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function shot(page, name) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${file}`);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function modal(page) { return page.locator('div.fixed.inset-0').last(); }

/** The Orphans/report modals ignore Escape, so a reload is the reliable
 *  dismissal. sessionStorage carries the store across it, as long as we don't
 *  bring ?e2eReset=1 along (that re-seeds from scratch). */
async function land(page, { as } = {}) {
  const q = as === 'employee' ? '?e2eUser=employee' : '';
  // Explicit timeout: setDefaultTimeout() also governs goto, and a cold
  // networkidle on this bundle regularly needs more than the action default.
  await page.goto(BASE + q, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
}

async function gotoTab(page, label) {
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('aside').last()
    .getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1300);
}

async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}
const docsOf = (s, c) => Object.values(s[c] || {});

// ── Fixtures ────────────────────────────────────────────────────────────────
// A model deliberately absent from the seed catalog.
const NEW_MODEL = { brand: 'Samsung', model: 'Galaxy S24 Ultra', series: 'Galaxy S' };
const SEARCH = 'Galaxy S24 Ultra';
const UNIT = { imei: '350222000000017', storage: '256GB', colour: 'BLACK', bp: 620 };
const SALE = { marketplace: 'AMAZON', order: 'AMZ-VAT-9001', sp: 899.99 };

const ORDER_PLACEHOLDER = {
  AMAZON: '026-1234567-1234567', BM: '79008748',
  EBAY: '01-14475-65087', ONBUY: 'T6G29N2', TEMU: 'T6G29N2',
};

// ── Independent ground truth: the FULL Amazon VAT chain ─────────────────────
// Transcribed from the operator's master sheet. Every intermediate stays raw;
// round only at the end, matching Excel's "compute precise, display rounded".
const r2 = n => { const e = n >= 0 ? 1e-9 : -1e-9; return Math.round((n + e) * 100) / 100; };

function amazonTruth({ bp, sp, postage }) {
  const spMinusBp = sp - bp;
  const marginalTax = spMinusBp * 16.67 / 100;
  const commission = sp * 0.07;          // 7% of SP
  const commissionVat = commission * 0.20;
  const dsf = commission * 0.02;
  const dsfVat = dsf * 0.20;
  const postageVat = postage * 0.20;
  const accessories = 1;
  const totalVat = commissionVat + dsfVat + postageVat;
  const gp = spMinusBp - marginalTax - commission - commissionVat
           - dsf - dsfVat - postage - postageVat - accessories;
  const totalVatNtp = marginalTax - totalVat;
  return {
    spMinusBp: r2(spMinusBp), marginalTax: r2(marginalTax),
    commission: r2(commission), commissionVat: r2(commissionVat),
    dsf: r2(dsf), dsfVat: r2(dsfVat), postageVat: r2(postageVat),
    accessories: r2(accessories), totalVat: r2(totalVat),
    grossProfit: r2(gp), gpPercent: r2(gp / bp * 100), totalVatNtp: r2(totalVatNtp),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // ══ PHASE 0 · start clean, as admin ══════════════════════════════════════
  await page.goto(BASE + '?e2eReset=1', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2200);
  await gotoTab(page, 'STOCK INTAKE');
  await page.getByRole('button', { name: /^WIPE$/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: /Wipe All/i }).first().click()
    .catch(async () => { await page.getByText(/Wipe All/i).first().click(); });
  await page.waitForTimeout(700);
  await page.getByText(/I understand this will delete all inventory data/i).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /Delete All Data/i }).click();
  await page.waitForTimeout(3500);
  await land(page);
  record('Wipe leaves an empty catalog to start from',
    docsOf(await dumpStore(page), 'models').length === 0,
    `${docsOf(await dumpStore(page), 'models').length} models`);

  // ══ PHASE 1 · employee hits a model nobody has added ═════════════════════
  console.log('\n══ PHASE 1 · Employee books in a model that is not in the catalog ══');
  await land(page, { as: 'employee' });
  // Behavioural check, not cosmetic: Admin is admin-gated, so its absence
  // from the drawer proves the employee persona actually took effect.
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);
  const drawerText = await page.locator('aside').last().innerText().catch(() => '');
  record('Employee persona active — no Admin section in the nav',
    !/\bADMIN\b/.test(drawerText), drawerText.replace(/\n+/g, ' / ').slice(0, 90));
  await shot(page, 'phase1-employee-nav');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);

  await gotoTab(page, 'STOCK INTAKE');
  await page.getByRole('button', { name: /^ADD STOCK$/i }).click();
  await page.waitForTimeout(900);
  const dev = modal(page).locator('input[placeholder*="Search the catalog" i]').first();
  await dev.click();
  await dev.fill(SEARCH);
  await page.waitForTimeout(900);
  await shot(page, 'phase1-employee-blocked');

  const m1 = modal(page);
  const addPill = await m1.getByRole('button', { name: /to the model catalog/i }).count();
  const askAdmin = /ask an admin/i.test(await m1.innerText());
  record('Employee gets NO "+ add to catalog" pill', addPill === 0, `${addPill} pills`);
  record('Employee is told to ask an admin', askAdmin, 'hint shown in the picker');

  const saveLabel = (await m1.getByRole('button', { name: /SAVE \d+/i }).last().textContent().catch(() => '')) || '';
  record('Save stays at 0 units — nothing can be booked in', /SAVE 0 /i.test(saveLabel.trim()), saveLabel.trim());
  record('No unit written while blocked',
    docsOf(await dumpStore(page), 'inventoryUnits').length === 0,
    `${docsOf(await dumpStore(page), 'inventoryUnits').length} units`);

  // ══ PHASE 2 · admin adds the model ═══════════════════════════════════════
  console.log('\n══ PHASE 2 · Admin adds it to the catalog ══');
  await land(page);                                   // back to admin
  await gotoTab(page, 'ADMIN');
  await page.getByRole('button', { name: /^Configuration$/i }).first().click().catch(() => {});
  await page.waitForTimeout(1600);
  await page.locator('input[placeholder="Samsung"]').first().fill(NEW_MODEL.brand);
  await page.locator('input[placeholder="Galaxy S24 Ultra"]').first().fill(NEW_MODEL.model);
  await page.locator('input[placeholder="Galaxy S"]').first().fill(NEW_MODEL.series);
  await page.waitForTimeout(300);
  await shot(page, 'phase2-admin-adds-model');
  // The button renders a Plus ICON followed by the word "ADD", so its
  // accessible name is just "ADD". Models Catalog is the first one on the
  // page; Accessories Catalog has its own further down.
  await page.getByRole('button', { name: /^\+?\s*ADD$/i }).first().click();
  await page.waitForTimeout(1500);

  const models = docsOf(await dumpStore(page), 'models');
  record('Model written to the catalog', models.length === 1,
    models.map(m => `${m.brand} ${m.model}`).join(', '));
  await shot(page, 'phase2-catalog-after-add');

  // ══ PHASE 3 · the refresh question ═══════════════════════════════════════
  console.log('\n══ PHASE 3 · After a refresh, is it there for the employee? ══');
  await land(page, { as: 'employee' });               // full reload, employee again
  await gotoTab(page, 'STOCK INTAKE');
  await page.getByRole('button', { name: /^ADD STOCK$/i }).click();
  await page.waitForTimeout(900);
  const dev2 = modal(page).locator('input[placeholder*="Search the catalog" i]').first();
  await dev2.click();
  await dev2.fill(SEARCH);
  await page.waitForTimeout(1000);
  await shot(page, 'phase3-employee-can-now-pick');

  const m3 = modal(page);
  const option = m3.getByRole('button', { name: new RegExp(NEW_MODEL.model, 'i') }).first();
  const pickable = await option.isVisible().catch(() => false);
  record('Employee can now pick the model after a refresh', pickable,
    pickable ? `"${NEW_MODEL.model}" offered by the picker` : 'still not offered');
  if (!pickable) { await finish(browser, page); return; }

  // ══ PHASE 4 · employee books the stock in ════════════════════════════════
  await option.click();
  await page.waitForTimeout(800);
  await m3.locator('input[placeholder*="IMEI" i]').first().fill(UNIT.imei);
  const selects = m3.locator('select');
  for (let i = 0; i < await selects.count(); i++) {
    const opts = await selects.nth(i).locator('option').allTextContents().catch(() => []);
    const s = opts.find(o => o.trim().toUpperCase() === UNIT.storage);
    const c = opts.find(o => o.trim().toUpperCase() === UNIT.colour);
    if (s) await selects.nth(i).selectOption({ label: s }).catch(() => {});
    else if (c) await selects.nth(i).selectOption({ label: c }).catch(() => {});
  }
  await m3.locator('input[placeholder="Type or pick"]').first().fill('MOBILE WHOLESALE LTD');
  await page.keyboard.press('Escape').catch(() => {});
  await m3.locator('input[placeholder="0.00"]').first().fill(String(UNIT.bp));
  await page.waitForTimeout(500);
  await shot(page, 'phase4-employee-row-ready');

  const saveBtn = m3.getByRole('button', { name: /SAVE \d+ UNITS?/i }).last();
  const label2 = (await saveBtn.textContent().catch(() => ''))?.trim();
  record('Save now reports 1 ready unit', /SAVE 1 /i.test(label2 || ''), label2);
  await saveBtn.click();
  await page.waitForTimeout(2000);
  await land(page, { as: 'employee' });

  const units = docsOf(await dumpStore(page), 'inventoryUnits');
  record('Employee booked the unit in against the new model',
    units.length === 1 && /S24 Ultra/i.test(units[0]?.model || ''),
    units.map(u => `${u.model} · ${u.imei}`).join(', '));

  // ══ PHASE 5 · sell it, and check the VAT chain ═══════════════════════════
  console.log('\n══ PHASE 5 · Sell on Amazon and verify every VAT line ══');
  await land(page);                                   // admin can sell
  await gotoTab(page, 'INVENTORY');
  await page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first().click();
  await page.waitForTimeout(900);
  const picker = modal(page);
  await picker.locator('input[placeholder*="Search by model" i]').first().fill(UNIT.imei);
  await page.waitForTimeout(700);
  await picker.locator('button').filter({ hasText: /£\d/ }).first().click();
  await page.waitForTimeout(1000);

  const sm = modal(page);
  await sm.getByRole('button', { name: /^Amazon$/i }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await sm.locator(`input[placeholder="${ORDER_PLACEHOLDER[SALE.marketplace]}"]`).first().fill(SALE.order);
  await sm.locator('input[placeholder="0.00"]').first().fill(String(SALE.sp));
  await page.waitForTimeout(700);
  await shot(page, 'phase5-sell-with-pl-breakdown');
  await sm.getByRole('button', { name: /Confirm Sale/i }).last().click();
  await page.waitForTimeout(2000);
  await land(page);

  const sale = docsOf(await dumpStore(page), 'sales')[0];
  record('Sale recorded', !!sale, sale ? `${sale.marketplace} ${sale.orderNumber} £${sale.salePrice}` : 'none');
  if (!sale) { await finish(browser, page); return; }

  const truth = amazonTruth({ bp: sale.buyPrice, sp: sale.salePrice, postage: sale.postage ?? 0 });
  console.log(`   ground truth (bp ${sale.buyPrice} / sp ${sale.salePrice} / postage ${sale.postage}):`);
  for (const [k, v] of Object.entries(truth)) console.log(`      ${k.padEnd(14)} ${v}`);

  const near = (a, b) => Math.abs((a ?? 0) - b) <= 0.02;
  record('Stored SP − BP matches', near(sale.spMinusBp, truth.spMinusBp), `${sale.spMinusBp} vs ${truth.spMinusBp}`);
  record('Stored Marginal Tax matches', near(sale.marginalTax, truth.marginalTax), `${sale.marginalTax} vs ${truth.marginalTax}`);
  record('Stored Commission matches (7% of SP)', near(sale.commission, truth.commission), `${sale.commission} vs ${truth.commission}`);
  record('Stored Postage VAT matches (20% of postage)', near(sale.postageVat, truth.postageVat), `${sale.postageVat} vs ${truth.postageVat}`);
  record('Stored GP matches the full VAT-inclusive chain', near(sale.grossProfit, truth.grossProfit), `${sale.grossProfit} vs ${truth.grossProfit}`);
  record('Stored GP% matches (GP / BP for Amazon)', near(sale.gpPercent, truth.gpPercent), `${sale.gpPercent} vs ${truth.gpPercent}`);

  // The VAT breakdown IS persisted on the Sale — this assertion used to say
  // the opposite.
  //
  // It was written as a FINDING: the six VAT fields were derived at read time
  // and never stored, so a fee change moved grossProfit while the columns it
  // was computed from stayed put, and the workbook showed a GP its own fee
  // lines did not add up to. recomputeSale now refreshes the whole set, which
  // is what made that stop happening.
  //
  // Inverted rather than deleted, and strengthened while inverting: checking
  // the fields merely EXIST would pass on six zeroes. Each is compared to the
  // independently-computed truth, so the test now proves the stored breakdown
  // is right rather than that it is present.
  const VAT_FIELDS = [
    ['commissionVat', truth.commissionVat],
    ['dsf',           truth.dsf],
    ['dsfVat',        truth.dsfVat],
    ['totalVat',      truth.totalVat],
    ['totalVatNtp',   truth.totalVatNtp],
    ['accessoryFee',  truth.accessories],
  ];
  const missing = VAT_FIELDS.filter(([k]) => sale[k] === undefined).map(([k]) => k);
  record('the VAT breakdown is persisted on the Sale, not derived at read time',
    missing.length === 0,
    missing.length ? `still absent: ${missing.join(', ')}` : 'all six stored');
  const wrong = VAT_FIELDS
    .filter(([k, want]) => sale[k] !== undefined && !near(sale[k], want))
    .map(([k, want]) => `${k} ${sale[k]} vs ${want}`);
  record('each stored VAT field matches the independently-computed truth',
    wrong.length === 0,
    wrong.length ? wrong.join(' · ') : VAT_FIELDS.map(([k]) => k).join(', '));

  // ══ PHASE 6 · the report is where those numbers live ═════════════════════
  console.log('\n══ PHASE 6 · The Sales Report carries the VAT chain as formulas ══');
  await gotoTab(page, 'INVENTORY');
  await page.getByRole('button', { name: /^SALES REPORT$/i }).first().click();
  await page.waitForTimeout(1200);
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 40000 }),
    page.getByRole('menuitem', { name: /^All Time$/i }).first().click()
      .catch(async () => { await page.getByText(/^All Time$/i).first().click(); }),
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(await dl.path());
  const ws = wb.getWorksheet('AMAZON');
  const headers = (ws.getRow(1).values || []).slice(1).map(h => String(h ?? '').trim());
  const cell = name => ws.getRow(2).getCell(headers.indexOf(name) + 1).value;
  const formulaOf = name => (cell(name) || {}).formula || String(cell(name) ?? '');

  record('Amazon tab has the full VAT column set',
    ['C. VAT', 'DSF', 'DSF. VAT', 'P. VAT', 'Total VAT', 'Total VAT NTP'].every(h => headers.includes(h)),
    headers.filter(h => /VAT|DSF/i.test(h)).join(', '));
  // Each expectation names the SOURCE COLUMNS in {braces} and is resolved
  // against this tab's real header row. Written with literal letters
  // (K2*20%, L2+N2+P2 …) these six broke the moment the columns were
  // reordered, and told us nothing about whether the arithmetic was right —
  // what matters is that C. VAT reads Commission, not that it reads K.
  const colLetter = n => { let s2 = ''; while (n > 0) { const r = (n - 1) % 26; s2 = String.fromCharCode(65 + r) + s2; n = (n - 1 - r) / 26; } return s2; };
  const ref = name => {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`no "${name}" column — headers: ${headers.join(', ')}`);
    return `${colLetter(i + 1)}2`;
  };
  const expectFormula = (label, column, template) => {
    let missing = null;
    const want = template.replace(/\{([^}]+)\}/g, (_, n) => {
      if (!headers.includes(n)) { missing = n; return n; }
      return ref(n);
    });
    if (missing) return record(label, false, `no "${missing}" column`);
    const got = formulaOf(column);
    record(`${label} — ${want}`, got.replace(/\s+/g, '') === want.replace(/\s+/g, ''), got);
  };

  expectFormula('C. VAT = Commission × 20%', 'C. VAT', '{Commission}*20%');
  expectFormula('DSF = Commission × 2%', 'DSF', '{Commission}*2%');
  expectFormula('DSF VAT = DSF × 20%', 'DSF. VAT', '{DSF}*20%');
  expectFormula('P. VAT = Postage × 20%', 'P. VAT', '{Postage}*20%');
  expectFormula('Total VAT = C.VAT + DSF VAT + P.VAT', 'Total VAT', '{C. VAT}+{DSF. VAT}+{P. VAT}');
  expectFormula('Total VAT NTP = Marginal Tax − Total VAT', 'Total VAT NTP', '{Marginal Tax}-{Total VAT}');
  record('Report carries the resolved model name',
    /S24 Ultra/i.test(String(cell('Model') ?? '')), String(cell('Model') ?? ''));
  await shot(page, 'phase6-report-downloaded');

  await finish(browser, page);
}

async function finish(browser, page) {
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${'='.repeat(72)}\nRESULT: ${passed}/${results.length} passed\n${'='.repeat(72)}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name} — ${r.detail}`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
