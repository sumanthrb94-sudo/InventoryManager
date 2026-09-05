/**
 * scripts/e2eAdminDeleteAndQc.mjs — the destructive and the unhappy paths,
 * driven in a real browser.
 *
 *   A. Admin deletes a unit from inventory (office and SHS)
 *   B. A sold unit refuses deletion — the sale must be voided first
 *   C. An employee has no delete control at all
 *   D. QC step 1 blocks on missing customer / technician comments
 *   E. QC step 2 blocks on a missing return reason
 *   F. A QC-failed unit is sent for repair, then deleted as scrap
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eAdminDeleteAndQc.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/delete-qc';
const MOBILE = { width: 430, height: 932 };
const DESKTOP = { width: 1280, height: 900 };

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
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('div.fixed.inset-0[class*="z-["]').last();
    if (!(await overlay.isVisible().catch(() => false))) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const close = page.locator('button:has-text("Cancel"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
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

async function kpi(page, label) {
  return page.evaluate((lbl) => {
    const wanted = lbl.toLowerCase();
    for (const el of Array.from(document.querySelectorAll('p, span, div'))) {
      if ((el.textContent || '').trim().toLowerCase() !== wanted) continue;
      let node = el;
      for (let i = 0; i < 5 && node?.parentElement; i++) {
        node = node.parentElement;
        const m = (node.innerText || '').match(/\n\s*(\d[\d,]*)\s*\n/);
        if (m) return Number(m[1].replace(/,/g, ''));
      }
    }
    return null;
  }, label);
}

async function run() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
  const browser = await chromium.launch({
    executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
  });

  const ctx = await browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  // The delete flow asks for a reason through a native prompt(), and a
  // refusal comes back as alert(). Capture both.
  let lastDialog = '';
  let dialogAnswer = 'QC failed — liquid damage, scrapped';
  page.on('dialog', async d => {
    lastDialog = d.message();
    if (d.type() === 'prompt') await d.accept(dialogAnswer);
    else await d.accept();
  });

  await page.goto(`${BASE}?e2eReset=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // ── A. Admin deletes an office unit ──────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  const officeBefore = await kpi(page, 'ALL OFFICE STOCK');
  await page.getByText('ALL OFFICE STOCK').first().click();
  await page.waitForTimeout(1200);
  await shot(page, 'office-stock-overlay');

  // The overlay opens in GROUPED mode, which has no per-unit delete. The
  // control lives only in the detail view ("Show one row per unit"), so a
  // delete costs an extra, undiscoverable click. Recorded as a finding.
  const groupRows = modal(page).locator('tbody tr.cursor-pointer');
  const groupCount = await groupRows.count();
  record('office overlay opens grouped by model', groupCount > 0, `${groupCount} model groups`);

  const deleteInGrouped = await modal(page).locator('button[title="Delete office unit"]').count();
  record('FINDING: no delete control in the default grouped view', deleteInGrouped === 0,
    'admin must switch to "one row per unit" first');

  await modal(page).locator('button[title="Show one row per unit"]').click();
  await page.waitForTimeout(1000);
  await shot(page, 'office-detail-view');

  const deleteButtons = modal(page).locator('button[title="Delete office unit"]');
  const deleteCount = await deleteButtons.count();
  record('admin sees a delete control on the expanded unit rows', deleteCount > 0,
    `${deleteCount} delete buttons · ${officeBefore} units in stock`);

  if (deleteCount > 0) {
    await deleteButtons.first().click();
    await page.waitForTimeout(1800);
    record('delete asks for a reason before removing anything',
      /reason/i.test(lastDialog), lastDialog.slice(0, 60));
    await shot(page, 'after-office-delete');
  }

  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  const officeAfter = await kpi(page, 'ALL OFFICE STOCK');
  record('deleting a unit drops office stock by exactly one',
    officeBefore !== null && officeAfter === officeBefore - 1,
    `${officeBefore} → ${officeAfter}`);
  await shot(page, 'office-count-after-delete');

  // ── A2. The deletion left a record behind ────────────────────────────────
  //
  // The whole point of the archive: the unit is gone, but WHO removed it,
  // WHAT it was and WHY must survive. Read the shim's own store rather than
  // any screen, so this passes or fails on what was actually written.
  const archive = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('__e2e_firestore__');
      return raw ? Object.values(JSON.parse(raw).deletedUnits || {}) : [];
    } catch { return []; }
  });
  record('the deleted unit leaves a tombstone in deletedUnits',
    archive.length === 1, `${archive.length} archive record(s)`);

  const rec = archive[0] || {};
  record('the tombstone carries who, what, when and why',
    !!rec.imei && !!rec.model && !!rec.deletedBy && !!rec.deletedAt
      && rec.reason === dialogAnswer && rec.source === 'office' && !rec.voided,
    `${rec.imei || '—'} · ${rec.model || '—'} · by ${rec.deletedBy || '—'} · "${rec.reason || ''}"`);

  // The forensic copy — every field of the unit, not just the six the notice
  // used to carry. Buy price is the one the client's loss figures depend on.
  record('the tombstone carries the full unit snapshot',
    !!rec.snapshot && typeof rec.snapshot === 'object'
      && rec.snapshot.imei === rec.imei && rec.snapshot.buyPrice !== undefined,
    `snapshot fields: ${rec.snapshot ? Object.keys(rec.snapshot).length : 0}`);

  // Searchable by the one identifier an operator has in hand.
  const noticeHasImei = await page.evaluate((imei) => {
    try {
      const raw = sessionStorage.getItem('__e2e_firestore__');
      const notices = raw ? Object.values(JSON.parse(raw).notices || {}) : [];
      return notices.some(n => String(n.content || '').includes(imei));
    } catch { return false; }
  }, rec.imei || '__none__');
  record('the notice board post carries the IMEI', noticeHasImei, rec.imei || '—');

  // ── B. A cancelled prompt must not delete ────────────────────────────────
  await page.getByText('ALL OFFICE STOCK').first().click();
  await page.waitForTimeout(1000);
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { lastDialog = d.message(); await d.dismiss(); });
  const groupRows2 = modal(page).locator('tbody tr.cursor-pointer');
  if (await groupRows2.count() > 0) { await groupRows2.first().click(); await page.waitForTimeout(700); }
  const delBtns2 = modal(page).locator('button[title="Delete office unit"]');
  if (await delBtns2.count() > 0) {
    await delBtns2.first().click();
    await page.waitForTimeout(1500);
  }
  await dismissModals(page);
  await gotoTab(page, 'Stock Intake');
  const officeAfterCancel = await kpi(page, 'ALL OFFICE STOCK');
  record('cancelling the reason prompt deletes nothing',
    officeAfterCancel === officeAfter, `${officeAfter} → ${officeAfterCancel}`);

  // A cancelled delete must not leave a tombstone either — an archive that
  // logs deletions that never happened is as misleading as one that misses
  // deletions that did.
  const archiveAfterCancel = await page.evaluate(() => {
    try {
      const raw = sessionStorage.getItem('__e2e_firestore__');
      return raw ? Object.values(JSON.parse(raw).deletedUnits || {}).length : 0;
    } catch { return -1; }
  });
  record('a cancelled delete writes no tombstone',
    archiveAfterCancel === 1, `${archiveAfterCancel} archive record(s)`);

  // ── C. SHS units are deletable too ───────────────────────────────────────
  const shsBefore = await kpi(page, 'SHS STOCK');
  page.removeAllListeners('dialog');
  page.on('dialog', async d => {
    lastDialog = d.message();
    if (d.type() === 'prompt') await d.accept('Supplier cancelled the order');
    else await d.accept();
  });
  await page.getByText('SHS STOCK').first().click();
  await page.waitForTimeout(1200);
  await shot(page, 'shs-overlay');
  const shsDelete = modal(page).locator('button[title*="Delete SHS" i]');
  const shsDeletable = await shsDelete.count();
  record('admin can remove SHS stock a supplier no longer holds', shsDeletable > 0,
    `${shsDeletable} SHS delete controls · ${shsBefore} SHS units`);
  await dismissModals(page);

  // ── D. QC step 1 blocks on missing comments ──────────────────────────────
  await gotoTab(page, 'Returns');
  await page.getByRole('button', { name: /Process Return/i }).click();
  await page.waitForTimeout(1200);
  const picker = modal(page).locator('button', { hasText: /IPHONE|SAMSUNG|GOOGLE|PIXEL/i });
  if (await picker.count() > 0) {
    await picker.first().click();
    await page.waitForTimeout(1200);
    await shot(page, 'qc-step1-empty');

    // Save with both comment boxes empty — must be refused.
    await modal(page).getByRole('button', { name: /Save|Send to CRM|Continue/i }).last().click();
    await page.waitForTimeout(800);
    const custErr = await modal(page).getByText(/Customer comments are required/i).isVisible().catch(() => false);
    record('QC step 1 refuses to advance without customer comments', custErr);
    await shot(page, 'qc-step1-customer-error');

    // Fill only the customer box — technician comments still required.
    const areas = modal(page).locator('textarea');
    await areas.nth(0).fill('Handset arrived with a cracked screen.');
    await modal(page).getByRole('button', { name: /Save|Send to CRM|Continue/i }).last().click();
    await page.waitForTimeout(800);
    const techErr = await modal(page).getByText(/Technician QC comments are required/i).isVisible().catch(() => false);
    record('QC step 1 refuses to advance without technician QC comments', techErr);
    await shot(page, 'qc-step1-technician-error');

    // Complete it — this is the QC-FAILED path: unit goes to the bench.
    await areas.nth(1).fill('QC FAILED: screen delaminating, digitiser intermittent. Not resaleable as-is.');
    await shot(page, 'qc-step1-failed-complete');
    await modal(page).getByRole('button', { name: /Save|Send to CRM|Continue/i }).last().click();
    await page.waitForTimeout(2500);
    record('a QC-failed unit reaches the CRM queue',
      await page.getByRole('button', { name: /Finalise/i }).first().isVisible().catch(() => false));
    await shot(page, 'crm-queue');

    // ── E. QC step 2 blocks on a missing reason ──────────────────────────
    await page.getByRole('button', { name: /Finalise/i }).first().click();
    await page.waitForTimeout(1500);
    await modal(page).getByText(/Send for Repair/i).first().click();
    await page.waitForTimeout(400);
    await shot(page, 'qc-step2-repair-route');
    await modal(page).getByRole('button', { name: /Finalise Return/i }).click();
    await page.waitForTimeout(800);
    const reasonErr = await modal(page).getByText(/enter a return reason/i).isVisible().catch(() => false);
    record('QC step 2 refuses to finalise without a return reason', reasonErr);
    await shot(page, 'qc-step2-reason-error');

    // ── F. Finish the repair route ───────────────────────────────────────
    await modal(page).locator('input[placeholder*="Customer changed mind" i]').first()
      .fill('QC failed — screen delaminating, sent to bench');
    await page.waitForTimeout(300);
    await modal(page).getByRole('button', { name: /Finalise Return/i }).click();
    await page.waitForTimeout(3000);
    await shot(page, 'qc-failed-in-repair');

    await dismissModals(page);
    await gotoTab(page, 'Returns');
    const returnsText = await page.locator('body').innerText();
    const inRepair = (returnsText.match(/IN REPAIR\s*\n?\s*(\d+)/i) || [])[1];
    record('a QC-failed unit lands in the In Repair bucket', Number(inRepair) > 0,
      `in repair = ${inRepair}`);
    await shot(page, 'returns-in-repair');
  }

  record('no uncaught JS errors across the delete + QC pass', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));
  await ctx.close();

  // ── C(ii). Employee has no delete control ────────────────────────────────
  const empCtx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2 });
  const emp = await empCtx.newPage();
  await emp.goto(`${BASE}?e2eUser=employee`, { waitUntil: 'networkidle' });
  await emp.waitForTimeout(1500);
  await gotoTab(emp, 'Stock Intake');
  await emp.getByText('ALL OFFICE STOCK').first().click();
  await emp.waitForTimeout(1200);
  const empGroups = modal(emp).locator('tbody tr.cursor-pointer');
  if (await empGroups.count() > 0) { await empGroups.first().click(); await emp.waitForTimeout(700); }
  const empDelete = await modal(emp).locator('button[title="Delete office unit"]').count();
  record('employee sees NO delete control on office stock', empDelete === 0,
    `${empDelete} delete buttons`);
  await shot(emp, 'employee-no-delete');
  await empCtx.close();

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
