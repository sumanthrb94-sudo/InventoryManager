/**
 * Live proof that a return now records what it actually cost.
 *
 * Before this, the only cost a return booked was carriage. The operator's
 * returns policy says carriage is the smallest of four costs, and the three
 * that were missing are the ones that move the number:
 *
 *   repair       → the repair invoice
 *   replacement  → a whole second handset
 *   to supplier  → offset by the credit that comes back
 *
 * Unit tests already pin the arithmetic. What they cannot prove is that the
 * operator can actually ENTER these figures on the screen and see them land —
 * which is the whole point, because every one of them is typed in by a human
 * after the fact. So this drives the real UI and then reads the store back:
 * a screen that accepts a number and drops it is indistinguishable from a
 * screen that works, if you only look at the screen.
 *
 * Run:
 *   VITE_E2E=1 npx vite build --outDir dist-e2e
 *   npx vite preview --outDir dist-e2e --port 4173
 *   node scripts/e2eReturnCostCapture.mjs
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = resolve('e2e-screenshots/return-cost-capture');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const results = [];
let shotIndex = 0;
function record(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(m) { console.log(`      ${m}`); }
async function shot(page, name) {
  const f = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${f}`, fullPage: true }).catch(() => {});
  console.log(`      ↳ ${f}`);
}

function modal(page) { return page.locator('div.fixed.inset-0').last(); }

async function dismissModals(page) {
  for (let i = 0; i < 6; i++) {
    const o = page.locator('div.fixed.inset-0').last();
    if (!(await o.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
    const c = page.locator('button:has-text("Cancel"), button:has-text("Close")').last();
    if (await c.isVisible().catch(() => false)) await c.click({ timeout: 3000 }).catch(() => {});
    else await o.click({ position: { x: 5, y: 5 }, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** The nav drawer is a fixed z-50 layer, not an inset-0 overlay, so
 *  dismissModals never touches it — and left open it covers the picker. */
async function closeDrawer(page) {
  const c = page.getByLabel('Close menu').first();
  if (await c.isVisible().catch(() => false)) {
    await c.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function gotoTab(page, label) {
  await dismissModals(page);
  const direct = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click({ timeout: 5000 }).catch(() => {});
  } else {
    const burger = page.getByLabel(/menu/i).first();
    if (await burger.isVisible().catch(() => false)) {
      await burger.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first()
        .click({ timeout: 5000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(1200);
  await closeDrawer(page);
}

const dumpStore = page => page.evaluate(() => {
  try { return JSON.parse(sessionStorage.getItem('__e2e_firestore__') || '{}'); }
  catch { return {}; }
});
const docsOf = (store, col) => Object.values(store[col] || {});

/** Drive a sold unit all the way through the two-step return flow.
 *
 *  Returns {ok:false} unless the unit's own record shows the return landed.
 *  The first version of this returned ok as soon as it had clicked Finalise,
 *  which is not the same thing: choosing Replacement without also picking a
 *  replacement handset is rejected by the service, and the unit stays sitting
 *  in the CRM queue. The next phase then clicked "Finalise" and got THAT row,
 *  so a harness bug surfaced as two unrelated-looking product failures. */
async function processReturn(page, imei, returnTypeLabel, reason, outcome, replacementImei) {
  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Process Return$/i }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  const picker = modal(page);
  const box = picker.locator('input[placeholder*="Search" i]').first();
  if (!(await box.isVisible().catch(() => false))) return { ok: false, why: 'no search box in the picker' };
  await box.fill(imei);
  await page.waitForTimeout(1800);
  const row = picker.locator('button').filter({ hasText: new RegExp(imei) }).first();
  if (!(await row.isVisible().catch(() => false))) return { ok: false, why: `${imei} not offered by the picker` };
  await row.click();
  await page.waitForTimeout(1000);

  const qc = modal(page);
  await qc.locator('textarea').nth(0).fill('Customer reports a fault.').catch(() => {});
  await qc.locator('textarea').nth(1).fill('QC: fault confirmed.').catch(() => {});
  await qc.getByRole('button', { name: /Send to CRM Queue/i }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);

  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /^Finalise$/i }).first().click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  const crm = modal(page);
  await crm.getByText(returnTypeLabel, { exact: false }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  if (outcome) {
    await crm.getByText(outcome, { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(600);
  }
  if (replacementImei) {
    // The replacement list only accepts stock matching brand + model + storage.
    const pick = crm.locator('button').filter({ hasText: new RegExp(replacementImei) }).first();
    if (!(await pick.isVisible().catch(() => false))) {
      await dismissModals(page);
      return { ok: false, why: `no eligible replacement offered for ${replacementImei}` };
    }
    await pick.click();
    await page.waitForTimeout(500);
  }
  await crm.locator('input[placeholder*="Customer changed mind" i]').fill(reason).catch(() => {});
  await crm.getByRole('button', { name: /Finalise Return/i }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Did it actually take? A rejected finalise leaves the modal open with an
  // error and the unit still queued — indistinguishable from success unless
  // the store is read back.
  const after = await dumpStore(page);
  const u = docsOf(after, 'inventoryUnits').find(x => String(x.imei) === String(imei));
  await dismissModals(page);
  if (!u?.returnType) {
    return { ok: false, why: `finalise did not stick — returnType=${JSON.stringify(u?.returnType)}` };
  }
  return { ok: true, unit: u };
}

async function run() {
  // Same resolution the rest of the suite uses: the pinned chromium-NNNN
  // directory under PLAYWRIGHT_BROWSERS_PATH, not the bare 'chromium' path
  // (which resolves to a headless-shell build that is not installed here).
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`      [pageerror] ${e.message}`));

  console.log('\n══ PHASE 0 · load the pristine seed ══');
  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await dismissModals(page);
  await closeDrawer(page);

  const seed = await dumpStore(page);
  const sold = docsOf(seed, 'inventoryUnits').filter(u => u.status === 'sold' && u.imei);
  const available = docsOf(seed, 'inventoryUnits').filter(u => u.status === 'available');
  record('the seed has sold units to return', sold.length >= 2, `${sold.length} sold, ${available.length} available`);
  if (sold.length < 2) {
    await shot(page, 'no-sold-units');
    await browser.close();
    return report();
  }
  await shot(page, 'phase0-loaded');

  // ── PHASE 1 · repair, with an invoice ──────────────────────────────────────
  console.log('\n══ PHASE 1 · repair records its invoice ══');
  const repairImei = String(sold[0].imei);
  const r1 = await processReturn(page, repairImei, 'Repair', 'Cracked screen');
  record('a repair return processes', r1.ok, r1.why || '');

  await gotoTab(page, 'Returns');
  const backBtn = page.getByRole('button', { name: /Back to Stock/i }).first();
  const hasBack = await backBtn.isVisible().catch(() => false);
  record('the repaired unit offers a way back to stock', hasBack);

  let repairCostEntered = false;
  if (hasBack) {
    await backBtn.click();
    await page.waitForTimeout(900);
    const m = modal(page);
    const costBox = m.locator('#repair-cost');
    repairCostEntered = await costBox.isVisible().catch(() => false);
    record('the Ready to Ship modal asks for the repair cost', repairCostEntered);
    await shot(page, 'phase1-repair-cost-modal');
    if (repairCostEntered) await costBox.fill('64.50');
    await m.getByRole('button', { name: /^Back to Stock$/i }).click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await dismissModals(page);
  }

  const afterRepair = await dumpStore(page);
  const repairedUnit = docsOf(afterRepair, 'inventoryUnits').find(u => String(u.imei) === repairImei);
  record('the repair invoice is stored on the unit',
    repairedUnit?.repairCost === 64.5,
    `repairCost=${JSON.stringify(repairedUnit?.repairCost)}`);
  record('the unit came back to stock',
    repairedUnit?.status === 'available',
    `status=${repairedUnit?.status}`);

  // ── PHASE 2 · replacement charges a second handset ────────────────────────
  console.log('\n══ PHASE 2 · replacement charges a second handset ══');
  // A replacement can only be finalised when matching stock exists, so pick
  // the pair out of the seed rather than hoping sold[1] happens to have one.
  const key = u => [u.brand, u.model, u.storage].map(v => String(v || '').trim().toLowerCase()).join('|');
  const availByKey = new Map();
  for (const a of available) if (!availByKey.has(key(a))) availByKey.set(key(a), a);
  const pair = sold.slice(1).map(sd => ({ sd, rep: availByKey.get(key(sd)) })).find(x => x.rep);

  let replImei = null;
  if (!pair) {
    note('no sold unit in the seed has matching available stock — replacement phase skipped');
  } else {
    replImei = String(pair.sd.imei);
    note(`returning ${replImei} (${pair.sd.model} ${pair.sd.storage || ''}), replacing with ${pair.rep.imei} @ £${pair.rep.buyPrice}`);
    const r2 = await processReturn(
      page, replImei, 'Back to Inventory', 'Faulty — replaced', 'Replacement', String(pair.rep.imei),
    );
    record('a replacement return processes', r2.ok, r2.why || '');
  }
  if (replImei) {

    const afterRepl = await dumpStore(page);
    const replUnit = docsOf(afterRepl, 'inventoryUnits').find(u => String(u.imei) === replImei);
    const linkedId = replUnit?.replacedByUnitId;
    const linked = linkedId
      ? docsOf(afterRepl, 'inventoryUnits').find(u => u.id === linkedId)
      : null;

    record('the outcome is recorded as a replacement',
      replUnit?.returnOutcome === 'replacement', `returnOutcome=${replUnit?.returnOutcome}`);
    record('the replacement handset is linked', !!linkedId, `replacedByUnitId=${linkedId || 'none'}`);
    record('its purchase price is snapshotted onto the return',
      typeof replUnit?.replacementUnitCost === 'number'
        && (!linked || replUnit.replacementUnitCost === linked.buyPrice),
      `replacementUnitCost=${JSON.stringify(replUnit?.replacementUnitCost)}`
      + (linked ? ` vs replacement buyPrice=${linked.buyPrice}` : ''));
    record('that cost dwarfs the carriage it used to be the only record of',
      typeof replUnit?.replacementUnitCost === 'number'
        && replUnit.replacementUnitCost > (replUnit.returnLegCost || 0) * 3,
      `handset £${replUnit?.replacementUnitCost} vs carriage £${((replUnit?.returnLegCost || 0) * 3).toFixed(2)}`);
    await shot(page, 'phase2-replacement-recorded');
  }

  // ── PHASE 3 · supplier credit ─────────────────────────────────────────────
  console.log('\n══ PHASE 3 · supplier settlement is bookable ══');
  let supplierOk = false;
  const usedImeis = new Set([repairImei, replImei].filter(Boolean).map(String));
  const supCandidate = sold.find(u => !usedImeis.has(String(u.imei)));
  if (supCandidate) {
    const supImei = String(supCandidate.imei);
    const r3 = await processReturn(page, supImei, 'Return to Supplier', 'DOA — back to supplier');
    record('a return-to-supplier processes', r3.ok, r3.why || '');

    await gotoTab(page, 'Returns');
    const creditBtn = page.getByRole('button', { name: /Credit Due/i }).first();
    const hasCredit = await creditBtn.isVisible().catch(() => false);
    record('the row offers to book the supplier settlement', hasCredit);
    await shot(page, 'phase3-credit-due-button');
    if (hasCredit) {
      await creditBtn.click();
      await page.waitForTimeout(900);
      const m = modal(page);
      const amt = m.locator('#supplier-credit-amount');
      const visible = await amt.isVisible().catch(() => false);
      record('the settlement modal opens with an amount to confirm', visible);
      await shot(page, 'phase3-supplier-credit-modal');
      if (visible) {
        await amt.fill('275');
        await m.getByRole('button', { name: /^Record$/i }).click({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1800);
        await dismissModals(page);
      }
      const afterCredit = await dumpStore(page);
      const supUnit = docsOf(afterCredit, 'inventoryUnits').find(u => String(u.imei) === supImei);
      supplierOk = supUnit?.supplierCreditAmount === 275;
      record('the credit is stored against the unit', supplierOk,
        `supplierCreditAmount=${JSON.stringify(supUnit?.supplierCreditAmount)}`
        + ` type=${supUnit?.supplierCreditType} date=${supUnit?.supplierCreditDate}`);
    }
  } else {
    note('no unused sold unit left in the seed — supplier phase skipped');
  }

  // ── PHASE 3b · the profit basis stamped on each voided sale ───────────────
  console.log('\n══ PHASE 3b · voided sales carry the right profit basis ══');
  {
    const st = await dumpStore(page);
    const units = docsOf(st, 'inventoryUnits');
    const byImei = i => units.find(u => String(u.imei) === String(i));
    const salesFor = imei => docsOf(st, 'sales').filter(x => String(x.imei) === String(imei) && x.voidedAt);

    // Repair inside the 30-day warranty window → the customer was refunded,
    // so the sale must lose its revenue.
    const rs = salesFor(repairImei)[0];
    record('the repair void is stamped with the corrected basis',
      rs?.gpBasis === 'returns_v2', `gpBasis=${rs?.gpBasis}`);
    const u = byImei(repairImei);
    const days = rs?.saleDate && rs?.voidedAt
      ? Math.round((Date.parse(rs.voidedAt) - Date.parse(rs.saleDate)) / 86400000) : null;
    record('a repair inside the warranty window counts as refunded',
      days !== null && days <= 30 ? rs?.customerRefunded === true : rs?.customerRefunded === false,
      `${days} days after sale · customerRefunded=${rs?.customerRefunded}`);
    void u;

    if (replImei) {
      // Replacement: the customer keeps what they paid, so the revenue stands.
      const vs = salesFor(replImei)[0];
      record('the replacement void is stamped with the corrected basis',
        vs?.gpBasis === 'returns_v2', `gpBasis=${vs?.gpBasis}`);
      record('a replacement is NOT recorded as a refund',
        vs?.customerRefunded === false, `customerRefunded=${vs?.customerRefunded}`);
    }
  }

  // ── PHASE 4 · the losses section shows the real number ────────────────────
  console.log('\n══ PHASE 4 · the Returns loss ledger reflects it ══');
  await gotoTab(page, 'Returns');
  await page.waitForTimeout(1200);
  const body = (await page.locator('body').innerText().catch(() => '')) || '';

  record('the loss ledger separates carriage from the rest',
    /Carriage £/i.test(body) && /Other £/i.test(body) && /Total £/i.test(body),
    'Carriage / Other / Total columns present');
  record('the header states what the total now includes',
    /carriage \+ repair invoices \+ replacement handsets/i.test(body));
  record('the repair invoice reaches the ledger',
    body.includes('64.50'),
    repairCostEntered ? 'entered 64.50' : 'repair cost box was never shown');
  await shot(page, 'phase4-loss-ledger');

  // Costs nobody has entered must be visible as outstanding, not blank.
  const store = await dumpStore(page);
  const returned = docsOf(store, 'inventoryUnits').filter(u => u.returnType);
  const outstanding = returned.filter(u =>
    (u.returnType === 'repair' && typeof u.repairCost !== 'number')
    || (u.returnOutcome === 'replacement' && typeof u.replacementUnitCost !== 'number')
    || (u.returnType === 'returned_to_supplier' && typeof u.supplierCreditAmount !== 'number'));
  if (outstanding.length > 0) {
    record('un-entered costs are flagged rather than shown as zero',
      /Awaiting/i.test(body) || /not yet entered/i.test(body),
      `${outstanding.length} return(s) missing a figure`);
  } else {
    note('every processed return had its cost entered — nothing outstanding to flag');
  }

  await browser.close();
  return report();
}

function report() {
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${pass}/${results.length}`);
  for (const r of results.filter(x => !x.ok)) console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  process.exit(pass === results.length ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
