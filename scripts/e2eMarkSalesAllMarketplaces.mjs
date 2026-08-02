/**
 * scripts/e2eMarkSalesAllMarketplaces.mjs
 *
 * Mark ONE sale on EVERY marketplace, and check EVERY calculated field for
 * each — not just GP and GP% the way the other scripts do.
 *
 * Ground truth is transcribed from the operator's master sheet inside this
 * file. src/lib/platforms.ts is deliberately NOT imported: if the app's
 * calculator is wrong, importing it would make the test agree with the bug.
 *
 * Also dumps calculations.json — every input and every derived figure, per
 * marketplace — so SALES_SCHEMA_AND_CALCULATIONS.md is generated from a real
 * run rather than hand-typed.
 *
 * Run after:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eMarkSalesAllMarketplaces.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import ExcelJS from 'exceljs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/mark-sales-all-marketplaces';
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

// ── UI helpers ──────────────────────────────────────────────────────────────
function modal(page) { return page.locator('div.fixed.inset-0').last(); }

async function land(page) {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1800);
}
async function gotoTab(page, label) {
  await page.getByLabel('Open menu').click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('aside').last()
    .getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
    .click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
}
async function dumpStore(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('__e2e_firestore__');
    return raw ? JSON.parse(raw) : {};
  });
}
const docsOf = (s, c) => Object.values(s[c] || {});

// ── Fixtures ────────────────────────────────────────────────────────────────
// Distinct BP/SP per marketplace so a copy-paste error in the ground truth
// can't accidentally match another marketplace's numbers.
const SALES = [
  { marketplace: 'AMAZON', label: 'Amazon',       imei: '350333000000011', bp: 350, sp: 499.99, order: 'AMZ-MS-1001' },
  { marketplace: 'BM',     label: 'Back Market',  imei: '350333000000029', bp: 300, sp: 449.99, order: 'BM-MS-2001'  },
  { marketplace: 'EBAY',   label: 'eBay',         imei: '350333000000037', bp: 280, sp: 429.99, order: 'EB-MS-3001'  },
  { marketplace: 'ONBUY',  label: 'OnBuy',        imei: '350333000000045', bp: 260, sp: 399.99, order: 'OB-MS-4001'  },
  { marketplace: 'TEMU',   label: 'Temu',         imei: '350333000000052', bp: 240, sp: 379.99, order: 'TM-MS-5001'  },
];
const MODEL = 'IPHONE 13 128GB';
const SUPPLIER = 'MOBILE WHOLESALE LTD';

const ORDER_PLACEHOLDER = {
  AMAZON: '026-1234567-1234567', BM: '79008748',
  EBAY: '01-14475-65087', ONBUY: 'T6G29N2', TEMU: 'T6G29N2',
};

// ── Ground truth, transcribed from the master sheet ─────────────────────────
// Excel's model: compute every intermediate at full precision, round only on
// the way out. Rounding each step compounds into 1p drift on Total VAT / GP.
const r2 = n => { const e = n >= 0 ? 1e-9 : -1e-9; return Math.round((n + e) * 100) / 100; };
const MAR_TAX_PCT = 16.67;   // literal, NOT 1/6 — they differ in the 3rd decimal
const VAT = 0.20;
const ACCESSORIES = 1;       // flat, every marketplace

function truthFor({ marketplace, bp, sp, postage }) {
  const c = sp - bp;
  const marginalTax = c * MAR_TAX_PCT / 100;
  const pVat = postage * VAT;
  const out = { bp, sp, postage, spMinusBp: c, marginalTax, postageVat: pVat, accessories: ACCESSORIES };

  switch (marketplace) {
    case 'AMAZON': {
      const commission = sp * 0.07;
      const commissionVat = commission * VAT;
      const dsf = commission * 0.02;
      const dsfVat = dsf * VAT;
      const totalVat = commissionVat + dsfVat + pVat;
      const gp = c - marginalTax - commission - commissionVat - dsf - dsfVat - postage - pVat - ACCESSORIES;
      Object.assign(out, { commission, commissionVat, dsf, dsfVat, totalVat, grossProfit: gp,
        gpPercent: gp / bp * 100, totalVatNtp: marginalTax - totalVat, gpBase: 'BP' });
      break;
    }
    case 'BM': {
      const commission = sp * 0.11;
      const customerCareFees = 8.99;   // 2026-08 master; was 9.99
      const gp = c - marginalTax - commission - customerCareFees - postage - pVat - ACCESSORIES;
      // BM's ONLY VAT line is P. VAT, so there is no separate Total VAT
      // column and NTP subtracts P. VAT directly.
      Object.assign(out, { commission, customerCareFees, totalVat: pVat, grossProfit: gp,
        gpPercent: gp / bp * 100, totalVatNtp: marginalTax - pVat, gpBase: 'BP' });
      break;
    }
    case 'EBAY': {
      const commission = sp * 0.0621;      // 6.9% less the 10% reduction
      const rof = sp * 0.0035;
      const fvf = 0.40;
      const vat20 = (commission + rof + fvf) * VAT;
      const totalCom = commission + rof + fvf + vat20;
      // Marketing and P. VAT are TYPED cells in the operator master, with no
      // formula behind either — marketing is £0 on most rows, and eBay's
      // postage is zero-rated to them. Deriving marketing as SP x 5% charged
      // a spend that never happened, plus its VAT, straight to margin.
      const marketing = 0;
      const marketingVat = marketing * VAT;
      const eBayPVat = 0;
      const totalVat = vat20 + eBayPVat + marketingVat;
      const gp = c - marginalTax - totalCom - postage - eBayPVat - marketing - marketingVat - ACCESSORIES;
      Object.assign(out, { commission, rof, fvf, vat20, totalCom, marketing, marketingVat, totalVat,
        grossProfit: gp, gpPercent: gp / sp * 100, totalVatNtp: marginalTax - totalVat, gpBase: 'SP' });
      break;
    }
    case 'ONBUY': {
      const commission = sp * 0.07;
      const vat20 = commission * VAT;      // VAT on the COMMISSION, not the margin
      const totalVat = vat20 + pVat;
      const gp = c - marginalTax - commission - vat20 - postage - pVat - ACCESSORIES;
      Object.assign(out, { commission, vat20, totalVat, grossProfit: gp,
        gpPercent: gp / bp * 100, totalVatNtp: marginalTax - totalVat, gpBase: 'BP' });
      break;
    }
    case 'TEMU': {
      const commission = sp * 0.0461;      // the master's own rate; the export's value wins when present
      const commissionVat = commission * VAT;
      // Commission VAT is reclaimable input tax — deliberately EXCLUDED from
      // both Total VAT and GP. Total VAT is P. VAT alone.
      const totalVat = pVat;
      const gp = c - marginalTax - commission - postage - pVat - ACCESSORIES;
      Object.assign(out, { commission, commissionVat, totalVat, grossProfit: gp,
        gpPercent: gp / bp * 100, totalVatNtp: marginalTax - totalVat, gpBase: 'BP' });
      break;
    }
  }
  for (const k of Object.keys(out)) if (typeof out[k] === 'number') out[k] = r2(out[k]);
  return out;
}

// Fields recordSale() actually writes to Firestore, per marketplace.
const STORED = {
  AMAZON: ['spMinusBp', 'marginalTax', 'commission', 'postageVat', 'grossProfit', 'gpPercent'],
  BM:     ['spMinusBp', 'marginalTax', 'commission', 'postageVat', 'grossProfit', 'gpPercent'],
  EBAY:   ['spMinusBp', 'marginalTax', 'commission', 'rof', 'fvf', 'twentyPercent', 'totalCom', 'vat20', 'postageVat', 'grossProfit', 'gpPercent'],
  ONBUY:  ['spMinusBp', 'marginalTax', 'commission', 'vat20', 'marVat', 'postageVat', 'grossProfit', 'gpPercent'],
  TEMU:   ['spMinusBp', 'marginalTax', 'commission', 'postageVat', 'grossProfit', 'gpPercent'],
};
// Present in the REPORT but never on the Sale doc — derived at export.
const DERIVED_ONLY = ['commissionVat', 'dsf', 'dsfVat', 'totalVat', 'totalVatNtp', 'accessoryFee', 'customerCareFees', 'marketing', 'marketingVat'];

// ── Intake ──────────────────────────────────────────────────────────────────
async function addUnits(page) {
  await gotoTab(page, 'STOCK INTAKE');
  await page.getByRole('button', { name: /^ADD STOCK$/i }).click();
  await page.waitForTimeout(900);
  const m = modal(page);

  for (let i = 0; i < SALES.length; i++) {
    if (i > 0) {
      await m.getByRole('button', { name: /^ADD ROW$/i }).click();
      await page.waitForTimeout(500);
    }
    const dev = m.locator('input[placeholder*="Search the catalog" i]').nth(i);
    await dev.click();
    await dev.fill(MODEL);
    await page.waitForTimeout(800);
    const pill = m.getByRole('button', { name: new RegExp(`Add "${MODEL}" to the model catalog`, 'i') }).first();
    if (await pill.isVisible().catch(() => false)) await pill.click();
    else await m.getByRole('button', { name: /^IPHONE\s/i }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(700);

    await m.locator('input[placeholder*="IMEI" i]').nth(i).fill(SALES[i].imei);
    const selects = m.locator('select');
    const rows = await m.locator('input[placeholder*="Search the catalog" i]').count();
    const perRow = Math.max(1, Math.round((await selects.count()) / Math.max(1, rows)));
    for (let k = 0; k < perRow; k++) {
      const sel = selects.nth(perRow * i + k);
      const opts = await sel.locator('option').allTextContents().catch(() => []);
      const st = opts.find(o => o.trim().toUpperCase() === '128GB');
      const co = opts.find(o => o.trim().toUpperCase() === 'BLACK');
      if (st) await sel.selectOption({ label: st }).catch(() => {});
      else if (co) await sel.selectOption({ label: co }).catch(() => {});
    }
    await m.locator('input[placeholder="Type or pick"]').nth(i).fill(SUPPLIER);
    await page.keyboard.press('Escape').catch(() => {});
    await m.locator('input[placeholder="0.00"]').nth(i).fill(String(SALES[i].bp));
    await page.waitForTimeout(250);
  }
  await shot(page, 'intake-five-units');
  await m.getByRole('button', { name: /SAVE \d+ UNITS?/i }).last().click();
  await page.waitForTimeout(2200);
  await land(page);
}

// ── Sell one unit on one marketplace ────────────────────────────────────────
async function markSold(page, s) {
  await gotoTab(page, 'INVENTORY');
  await page.getByRole('button', { name: /^(SELL|Record Sale|Mark Sold)$/i }).first().click();
  await page.waitForTimeout(900);
  const picker = modal(page);
  await picker.locator('input[placeholder*="Search by model" i]').first().fill(s.imei);
  await page.waitForTimeout(700);
  const row = picker.locator('button').filter({ hasText: /£\d/ }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: 'unit not in picker' };
  await row.click();
  await page.waitForTimeout(1000);

  const m = modal(page);
  await m.getByRole('button', { name: new RegExp(`^${s.label}$`, 'i') }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(400);
  await m.locator(`input[placeholder="${ORDER_PLACEHOLDER[s.marketplace]}"]`).first().fill(s.order).catch(() => {});
  await m.locator('input[placeholder="0.00"]').first().fill(String(s.sp)).catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, `sell-${s.marketplace.toLowerCase()}`);

  const confirm = m.getByRole('button', { name: /Confirm Sale/i }).last();
  if (!(await confirm.isEnabled().catch(() => false))) return { ok: false, why: 'Confirm Sale disabled' };
  await confirm.click();
  await page.waitForTimeout(1900);
  await land(page);
  return { ok: true };
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

  // ══ Clean slate ══════════════════════════════════════════════════════════
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

  await addUnits(page);
  const units = docsOf(await dumpStore(page), 'inventoryUnits');
  record('5 units booked in, one per marketplace', units.length === 5, `${units.length} units`);

  // ══ Mark one sale on each marketplace ════════════════════════════════════
  console.log('\n══ Marking one sale on each marketplace ══');
  for (const s of SALES) {
    const r = await markSold(page, s);
    record(`Marked sold · ${s.marketplace} · £${s.sp}`, r.ok, r.why || s.order);
  }

  const store = await dumpStore(page);
  const sales = docsOf(store, 'sales');
  record('5 sale docs written', sales.length === 5, `${sales.length}`);
  await shot(page, 'after-all-five-sales');

  // ══ Verify EVERY calculated field, per marketplace ═══════════════════════
  console.log('\n══ Every calculated field vs independent maths ══');
  const calculations = {};
  const near = (a, b) => Math.abs((a ?? 0) - b) <= 0.02;

  for (const s of SALES) {
    const sale = sales.find(x => x.marketplace === s.marketplace);
    if (!sale) { record(`${s.marketplace} · sale doc found`, false, 'missing'); continue; }

    const t = truthFor({ marketplace: s.marketplace, bp: sale.buyPrice, sp: sale.salePrice, postage: sale.postage ?? 0 });
    calculations[s.marketplace] = { inputs: { bp: sale.buyPrice, sp: sale.salePrice, postage: sale.postage ?? 0 }, truth: t, stored: {} };

    console.log(`\n  ── ${s.marketplace} · BP £${t.bp} · SP £${t.sp} · postage £${t.postage} ──`);
    for (const [k, v] of Object.entries(t)) {
      if (typeof v === 'number') console.log(`     ${k.padEnd(16)} ${v}`);
    }

    // Every field recordSale persists must match the master formulas.
    for (const field of STORED[s.marketplace]) {
      const expectKey = field === 'twentyPercent' ? 'vat20' : field === 'marVat' ? 'marginalTax' : field;
      const expected = t[expectKey];
      if (expected === undefined) continue;
      calculations[s.marketplace].stored[field] = sale[field];
      record(`${s.marketplace} · ${field}`, near(sale[field], expected), `${sale[field]} vs ${expected}`);
    }

    // The derived-not-stored boundary, pinned rather than described.
    const wronglyStored = DERIVED_ONLY.filter(k => sale[k] !== undefined);
    record(`${s.marketplace} · VAT breakdown stays derived, not persisted`,
      wronglyStored.length === 0,
      wronglyStored.length ? `unexpectedly stored: ${wronglyStored.join(', ')}` : 'none on the doc, as designed');
  }

  // GP% base differs — the trap worth its own assertion.
  const ebaySale = sales.find(x => x.marketplace === 'EBAY');
  if (ebaySale) {
    const t = truthFor({ marketplace: 'EBAY', bp: ebaySale.buyPrice, sp: ebaySale.salePrice, postage: ebaySale.postage ?? 0 });
    record('eBay GP% divides by SP, not BP',
      near(ebaySale.gpPercent, t.gpPercent) && !near(ebaySale.gpPercent, r2(t.grossProfit / t.bp * 100)),
      `${ebaySale.gpPercent}% = GP/SP (GP/BP would be ${r2(t.grossProfit / t.bp * 100)}%)`);
  }

  // ══ The report's formulas ════════════════════════════════════════════════
  console.log('\n══ Sales Report formulas, per marketplace tab ══');
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

  const EXPECT_FORMULAS = {
    AMAZON: { 'Marginal Tax': /I2\*16\.67%/, 'Commission': /H2\/100\*7/, 'C. VAT': /K2\*20%/, 'DSF': /K2\*2%/, 'Total VAT': /L2\+N2\+P2/ },
    BM:     { 'Marginal Tax': /I2\*16\.67%/, 'Commission': /H2\/100\*11/, 'P. VAT': /M2\*20%/ },
    // No Marketing entry: that cell carries no formula any more. It is typed
    // by the operator in the master, so the report writes the sale's own
    // value — emitting `=H2*5%` there made a re-opened workbook re-invent a
    // promotional spend that never happened.
    EBAY:   { 'Marginal Tax': /I2\*16\.67%/, 'Commission': /\(H2\*6\.9%\)-\(H2\*6\.9%\)\*10%/, 'ROF': /H2\*0\.35%/, 'M. VAT': /R2\*20%/, 'Total VAT': /N2\+Q2\+S2/ },
    ONBUY:  { 'Marginal Tax': /H2\*16\.67%/, 'Commission': /G2\*7%/, 'VAT 20%': /J2\*20%/, 'Total VAT': /K2\+M2/ },
    TEMU:   { 'Marginal Tax': /I2\*16\.67%/, 'Total VAT': /N2/ },
  };
  for (const [mp, expectations] of Object.entries(EXPECT_FORMULAS)) {
    const ws = wb.getWorksheet(mp);
    if (!ws) { record(`${mp} tab present`, false, 'missing'); continue; }
    const headers = (ws.getRow(1).values || []).slice(1).map(h => String(h ?? '').trim());
    calculations[mp] = calculations[mp] || {};
    calculations[mp].reportColumns = headers;
    for (const [col, re] of Object.entries(expectations)) {
      const cell = ws.getRow(2).getCell(headers.indexOf(col) + 1).value;
      const f = (cell || {}).formula || String(cell ?? '');
      record(`${mp} report · ${col}`, re.test(f), f);
    }
  }
  record('BM has no Total VAT column — P. VAT is its only VAT line',
    !((wb.getWorksheet('BM')?.getRow(1).values || []).slice(1).map(h => String(h ?? '').trim()).includes('Total VAT')),
    'BM tab');

  await shot(page, 'report-downloaded');

  // ── Outputs ──
  const passed = results.filter(r => r.ok).length;
  console.log(`\n${'='.repeat(72)}\nRESULT: ${passed}/${results.length} passed\n${'='.repeat(72)}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name} — ${r.detail}`);
  writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
  writeFileSync(`${OUT}/calculations.json`, JSON.stringify(calculations, null, 2));
  console.log(`\ncalculations.json written to ${OUT}/`);

  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}

run().catch(e => { console.error('FATAL', e); process.exit(1); });
