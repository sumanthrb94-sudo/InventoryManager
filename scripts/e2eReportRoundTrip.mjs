/**
 * scripts/e2eReportRoundTrip.mjs — does what you SEE match what you UPLOADED?
 *
 * Upload a report, then open the app's own View of that report and check
 * the two agree, cell by cell:
 *
 *   1. Wipe, upload the 120-row inventory sample
 *   2. Open Inventory Report → View, compare every row against the file
 *   3. Upload the sales sample, open Sales Report → View, compare totals
 *
 * This is the loop the operator actually trusts — they upload a file and
 * read the report back. A silent column shift or a dropped row would
 * never show up in the import's own success message, only here.
 *
 * Run after: VITE_E2E=1 vite build --outDir dist-e2e && vite preview
 *   node scripts/e2eReportRoundTrip.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4173';
const OUT = 'e2e-screenshots/report-round-trip';
const INVENTORY_FILE = resolve('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx');
const SALES_FILE = resolve('templates/samples/SALES_REPORT_SAMPLE.xlsx');

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
    const close = page.locator('button:has-text("Cancel"), button:has-text("Close"), button[aria-label*="lose" i]').last();
    if (await close.isVisible().catch(() => false)) {
      await close.click().catch(() => {});
    } else {
      // The report viewer's close is an unlabelled X in its header, and
      // it doesn't listen for Escape — click the overlay's own X.
      // The report viewer closes on a backdrop click; its X carries no
      // accessible name to target.
      await overlay.click({ position: { x: 5, y: 5 } }).catch(() => {});
    }
    await page.waitForTimeout(400);
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
  const byLabel = page.getByRole('button', { name: /^Import$/i }).first();
  if (await byLabel.isVisible().catch(() => false)) await byLabel.click();
  else await page.locator('button[aria-haspopup="menu"]').first().click();
  await page.waitForTimeout(500);
}

/**
 * Rows currently rendered in the viewer. The grid is virtualised, so this
 * is a window onto the data, not all of it — use viewerRowCount() for the
 * total and downloadReport() to check every row.
 */
async function readViewerGrid(page) {
  return page.evaluate(() => {
    const grid = (t) => Array.from(t.querySelectorAll('tr')).map(tr =>
      Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim()));
    // The report grid is the one whose rows carry an IMEI header.
    for (const t of Array.from(document.querySelectorAll('table'))) {
      const rows = grid(t);
      if (rows.some(r => r.includes('IMEI'))) return rows;
    }
    return [];
  });
}

/** The viewer's own footer tally: "121 ROWS × 12 COLS". */
async function viewerRowCount(page) {
  const text = await page.locator('body').innerText();
  const m = text.match(/([\d,]+)\s*ROWS?\s*[×x]\s*([\d,]+)\s*COLS?/i);
  return m ? { rows: Number(m[1].replace(/,/g, '')), cols: Number(m[2].replace(/,/g, '')) } : null;
}

/**
 * Click the viewer's DOWNLOAD and parse what comes back. The viewer
 * claims "preview matches the .xlsx download" — this checks that claim
 * AND gives us every row, not just the virtualised window.
 */
async function downloadReport(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /Download/i }).first().click(),
  ]);
  const path = await download.path();
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', raw: true, cellText: true });
  const sheets = {};
  for (const name of wb.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })
      .filter(r => r.some(c => String(c).trim() !== ''));
  }
  return { sheetNames: wb.SheetNames, sheets, path };
}

/** The uploaded workbook, as rows of strings, for comparison. */
function sourceRows(path, sheet) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', raw: true, cellText: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: false, defval: '' });
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

  // ── 1. Wipe, then upload the inventory report ────────────────────────────
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
  await gotoTab(page, 'Stock Intake');

  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(INVENTORY_FILE);
  await page.waitForTimeout(3500);
  await modal(page).getByRole('button', { name: /Load [\d,]+ rows/i }).click();
  await page.waitForTimeout(7000);
  await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
  await page.waitForTimeout(1500);
  await dismissModals(page);

  // ── 2. Open the app's View of the inventory report ───────────────────────
  await gotoTab(page, 'Stock Intake');
  await page.getByRole('button', { name: /Inventory Report/i }).first().click();
  await page.waitForTimeout(600);
  await shot(page, 'report-menu');
  await page.locator('button[title="View All Time in browser"]').click();
  await page.waitForTimeout(4500);
  await shot(page, 'inventory-report-view');

  const src = sourceRows(INVENTORY_FILE, 'INVENTORY');
  const srcBody = src.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
  const isShsRow = (r) => String(r[9]).trim().toUpperCase() === 'SHS';
  const srcOffice = srcBody.filter(r => !isShsRow(r));
  const srcShs = srcBody.filter(r => isShsRow(r));

  /**
   * Compare the rendered grid against the file, row by row. Only rows whose
   * IMEI is in `expected` are compared — a row from the other sheet showing
   * up here is caught separately, by the leakage check below.
   */
  const compareGrid = async (expected) => {
    const byImei = new Map(expected.map(r => [
      String(r[2]).trim() || ['SHS', r[1], r[7], r[8]].join('|').toUpperCase(), r,
    ]));
    const viewRows = await readViewerGrid(page);
    const header = viewRows.find(r => r.includes('IMEI')) || [];
    const col = (name) => header.indexOf(name);
    let compared = 0;
    const mismatches = [];
    const strangers = [];
    for (const r of viewRows) {
      const shownImei = r[col('IMEI')];
      // Skip the grid's own furniture: the column-letter row the viewer
      // renders above the data ('A', 'B', 'C'…) and the header row itself.
      if (shownImei === 'IMEI' || /^[A-Z]{1,2}$/.test(shownImei || '')) continue;
      // A holding has no IMEI; fall back to its identity, as above.
      const imei = (shownImei || '').trim()
        || ['SHS', r[col('Model')], r[col('Supplier')], r[col('BP')]].join('|').toUpperCase();
      if (!r[col('Model')]) continue;
      if (!byImei.has(imei)) { strangers.push(imei); continue; }
      const srcRow = byImei.get(imei);
      compared++;
      const checks = [
        ['Model', r[col('Model')], String(srcRow[1]).trim()],
        ['Grade', r[col('Grade')], String(srcRow[3]).trim()],
        ['Storage', r[col('Storage')], String(srcRow[4]).trim()],
        ['SIM Type', r[col('SIM Type')], String(srcRow[5]).trim()],
        ['Colour', r[col('Colour')], String(srcRow[6]).trim()],
        ['Supplier', r[col('Supplier')], String(srcRow[7]).trim()],
        ['BP', Number(r[col('BP')]), Number(srcRow[8])],
        ['Stock Type', r[col('Stock Type')], isShsRow(srcRow) ? 'SHS' : 'OFFICE'],
      ];
      for (const [field, got, want] of checks) {
        if (String(got) !== String(want)) mismatches.push(`${imei} ${field}: view "${got}" ≠ file "${want}"`);
      }
    }
    return { compared, mismatches, strangers };
  };

  const sheetTab = (name) => modal(page).getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first();

  // 1. The preview has the same two tabs as the download. Flattened into one
  //    list, the preview disagreed with the file the operator gets — and hid
  //    the split that decides whether stock is on the shelf or with a supplier.
  const hasOffice = await sheetTab('Office Stock').isVisible().catch(() => false);
  const hasShs = await sheetTab('SHS Stock').isVisible().catch(() => false);
  record('inventory view has a separate sheet for Office and SHS', hasOffice && hasShs,
    `Office Stock ${hasOffice ? '✓' : '✗'} · SHS Stock ${hasShs ? '✓' : '✗'}`);

  // 2. Office Stock tab — tally and every rendered cell.
  if (hasOffice) { await sheetTab('Office Stock').click(); await page.waitForTimeout(1200); }
  const officeTally = await viewerRowCount(page);
  record('Office Stock sheet row count matches the uploaded office rows',
    !!officeTally && officeTally.rows === srcOffice.length + 1,
    `uploaded ${srcOffice.length} office rows · view reports ${officeTally?.rows ?? '?'} (incl. header)`);

  const officeGrid = await compareGrid(srcOffice);
  record('every rendered Office Stock cell matches the uploaded file',
    officeGrid.compared > 0 && officeGrid.mismatches.length === 0 && officeGrid.strangers.length === 0,
    officeGrid.mismatches.length ? officeGrid.mismatches.slice(0, 3).join(' | ')
      : officeGrid.strangers.length ? `${officeGrid.strangers.length} non-office rows on the office sheet`
      : `${officeGrid.compared} rows × 8 fields compared`);

  // 3. SHS Stock tab — the 10 supplier-held rows, and nothing else.
  if (hasShs) { await sheetTab('SHS Stock').click(); await page.waitForTimeout(1200); }
  await shot(page, 'inventory-report-view-shs-sheet');
  const shsTally = await viewerRowCount(page);
  record('SHS Stock sheet row count matches the uploaded SHS rows',
    !!shsTally && shsTally.rows === srcShs.length + 1,
    `uploaded ${srcShs.length} SHS rows · view reports ${shsTally?.rows ?? '?'} (incl. header)`);

  const shsGrid = await compareGrid(srcShs);
  record('every rendered SHS Stock cell matches the uploaded file',
    shsGrid.compared > 0 && shsGrid.mismatches.length === 0 && shsGrid.strangers.length === 0,
    shsGrid.mismatches.length ? shsGrid.mismatches.slice(0, 3).join(' | ')
      : shsGrid.strangers.length ? `${shsGrid.strangers.length} non-SHS rows on the SHS sheet`
      : `${shsGrid.compared} rows × 8 fields compared`);

  // 4. The download — every row, and the viewer's own "preview matches
  //    the .xlsx download" claim.
  const dl = await downloadReport(page);
  record('downloaded report splits Office and SHS into their own sheets',
    dl.sheetNames.includes('Office Stock') && dl.sheetNames.includes('SHS Stock'),
    dl.sheetNames.join(', '));

  // SHS holdings have NO IMEI — the supplier hasn't shipped, so there is no
  // handset to read one off. Keying them by IMEI collapses all ten onto the
  // empty string and the sheet appears to hold one row. They key on the same
  // identity the importer uses to recognise a holding: model + supplier + BP.
  const keyOf = (r) => String(r[2]).trim()
    || ['shs', r[1], r[7], r[8]].join('|').toUpperCase();
  const keysIn = (sheet) => new Set((dl.sheets[sheet] ?? []).slice(1).map(keyOf));
  const officeImeis = keysIn('Office Stock');
  const shsImeis = keysIn('SHS Stock');

  const missingOffice = srcOffice.filter(r => !officeImeis.has(keyOf(r)));
  record('every uploaded OFFICE row lands in the Office Stock sheet',
    missingOffice.length === 0 && officeImeis.size === srcOffice.length,
    `uploaded ${srcOffice.length} · sheet has ${officeImeis.size}` +
    (missingOffice.length ? ` · missing ${missingOffice.length}` : ''));

  const missingShs = srcShs.filter(r => !shsImeis.has(keyOf(r)));
  record('every uploaded SHS row lands in the SHS Stock sheet',
    missingShs.length === 0 && shsImeis.size === srcShs.length,
    `uploaded ${srcShs.length} · sheet has ${shsImeis.size}` +
    (missingShs.length ? ` · missing ${missingShs.length}` : ''));

  // No leakage between the two sheets — an SHS row on the office shelf
  // would overstate stock we actually hold.
  const crossover = [...officeImeis].filter(i => shsImeis.has(i));
  record('no row appears on both sheets', crossover.length === 0,
    crossover.length ? `${crossover.length} duplicated` : 'office and SHS are disjoint');

  await dismissModals(page);

  // ── 2b. The full circle: feed the downloaded report back in ──────────────
  // The importer used to read SheetNames[0] only, so a report downloaded
  // from the app and re-uploaded silently lost every SHS row — the exact
  // "export → edit in Excel → re-import" loop the templates README promises.
  const roundTripFile = resolve(OUT, 'downloaded-inventory-report.xlsx');
  copyFileSync(dl.path, roundTripFile);

  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Inventory Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(roundTripFile);
  await page.waitForTimeout(4000);
  await shot(page, 'reimport-downloaded-report');

  const reimportText = await modal(page).innerText().catch(() => '');
  const loadCount = reimportText.match(/Load\s+([\d,]+)\s+rows/i);
  record('re-importing the downloaded report reads every row from both sheets',
    !!loadCount && Number(loadCount[1].replace(/,/g, '')) === srcBody.length,
    `downloaded report re-reads ${loadCount ? loadCount[1] : '?'} of ${srcBody.length} rows`);

  const lands = reimportText.match(/Lands as\s*([\d,]+)\s*office stock\s*·?\s*([\d,]+)\s*SHS/i);
  record('re-imported rows keep their office / SHS split',
    !!lands && Number(lands[1].replace(/,/g, '')) === srcOffice.length
            && Number(lands[2].replace(/,/g, '')) === srcShs.length,
    lands ? `lands as ${lands[1]} office · ${lands[2]} SHS (expected ${srcOffice.length} · ${srcShs.length})`
          : 'no office/SHS split shown');

  await dismissModals(page);

  // ── 3. Sales report round trip ───────────────────────────────────────────
  await gotoTab(page, 'Stock Intake');
  await openImportMenu(page);
  await page.getByRole('menuitem', { name: /Sales Report/i }).click();
  await page.waitForTimeout(700);
  await page.locator('input[type="file"]').first().setInputFiles(SALES_FILE);
  await page.waitForTimeout(5000);

  const ackBox = modal(page).locator('input[type="checkbox"]').first();
  if (await ackBox.isVisible().catch(() => false)) { await ackBox.check(); await page.waitForTimeout(400); }

  // Complete the orphan audit rows so the import can land.
  const fill = async (selector, value) => {
    const loc = modal(page).locator(selector);
    for (let i = 0; i < await loc.count(); i++) {
      const box = loc.nth(i);
      if ((await box.inputValue().catch(() => 'x')) === '') {
        await box.fill(value); await box.press('Tab'); await page.waitForTimeout(120);
      }
    }
  };
  await fill('input[placeholder="IMEI required"]', '350190000009999');
  await fill('input[placeholder="Search model…"]', 'IPHONE 12');
  await fill('input[placeholder="Supplier required"]', 'MOBILE WHOLESALE LTD');
  const numeric = modal(page).locator('input[type="number"]');
  for (let i = 0; i < await numeric.count(); i++) {
    const box = numeric.nth(i);
    const v = await box.inputValue().catch(() => '1');
    if (!v || Number(v) === 0) { await box.fill('200'); await box.press('Tab'); await page.waitForTimeout(120); }
  }
  await page.waitForTimeout(800);

  const confirm = modal(page).getByRole('button', { name: /Load|Confirm|record/i }).last();
  if (!(await confirm.isDisabled().catch(() => true))) {
    await confirm.click();
    await page.waitForTimeout(9000);
    await modal(page).getByRole('button', { name: /Close|Done/i }).last().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  await dismissModals(page);

  // The Sales Report lives on the Sell page.
  await gotoTab(page, 'Inventory');
  await page.waitForTimeout(1200);
  const salesReportBtn = page.getByRole('button', { name: /Sales Report/i }).first();
  if (await salesReportBtn.isVisible().catch(() => false)) {
    await salesReportBtn.click();
    await page.waitForTimeout(600);
    const viewBtn = page.locator('button[title="View All Time in browser"]').first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await viewBtn.click();
      await page.waitForTimeout(5500);
      await shot(page, 'sales-report-view');

      // The Sales Report opens on a SUMMARY sheet; the per-marketplace
      // rows live on their own tabs. Check the headline the operator
      // actually reads first, then every row via the download.
      const summary = await page.evaluate(() => {
        for (const t of Array.from(document.querySelectorAll('table'))) {
          const rows = Array.from(t.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('td, th')).map(td => (td.textContent || '').trim()));
          if (rows.some(r => r.includes('Marketplace'))) return rows;
        }
        return [];
      });
      // The grid renders a row-number gutter as cell 0, so read the first
      // number AFTER the marketplace name rather than the first in the row.
      const numberAfter = (row, label) => {
        if (!row) return null;
        const at = row.indexOf(label);
        if (at < 0) return null;
        const cell = row.slice(at + 1).find(c => /^\d[\d,]*$/.test(c));
        return cell === undefined ? null : Number(cell.replace(/,/g, ''));
      };
      const summaryCount = (mkt) => numberAfter(summary.find(r => r.includes(mkt)), mkt);

      // What the uploaded workbook actually contains, per sheet.
      const uploaded = {};
      for (const m of ['AMAZON', 'BM', 'EBAY', 'ONBUY']) {
        const rows = sourceRows(SALES_FILE, m).slice(1)
          .filter(r => String(r[1] ?? '').trim() !== '');
        // Dedupe on marketplace__order__imei, the record key the importer uses.
        uploaded[m] = new Set(rows.map(r => `${m}__${String(r[1]).trim()}__${String(r[3]).trim()}`)).size;
      }

      const perMarket = ['AMAZON', 'BM', 'EBAY', 'ONBUY']
        .map(m => `${m} ${summaryCount(m)}/${uploaded[m]}`).join(' · ');
      record('summary sheet counts match the uploaded file per marketplace',
        ['AMAZON', 'BM', 'EBAY', 'ONBUY'].every(m => summaryCount(m) === uploaded[m]),
        perMarket);

      const total = numberAfter(summary.find(r => r.includes('TOTAL')), 'TOTAL');
      const uploadedTotal = Object.values(uploaded).reduce((a, b) => a + b, 0);
      record('summary total matches the uploaded row count', total === uploadedTotal,
        `report ${total} · uploaded ${uploadedTotal}`);

      // Every row, from the download — the grid is virtualised.
      const dlSales = await downloadReport(page);
      record('downloaded sales report has a sheet per marketplace',
        ['AMAZON', 'BM', 'EBAY', 'ONBUY'].every(m => dlSales.sheetNames.includes(m)),
        dlSales.sheetNames.join(', '));

      let orderMismatch = [];
      let priceMismatch = [];
      for (const m of ['AMAZON', 'BM', 'EBAY', 'ONBUY']) {
        const sheet = dlSales.sheets[m] ?? [];
        const text = sheet.flat().map(String).join(' | ');
        const srcRows = sourceRows(SALES_FILE, m).slice(1)
          .filter(r => String(r[1] ?? '').trim() !== '');
        for (const r of srcRows) {
          const order = String(r[1]).trim();
          if (!text.includes(order)) orderMismatch.push(`${m} ${order}`);
        }
        // Spot-check the money on the first row of each sheet.
        const first = srcRows[0];
        if (first) {
          const sp = Number(m === 'ONBUY' ? first[6] : first[7]);
          if (!text.includes(String(sp)) && !text.includes(sp.toFixed(2))) {
            priceMismatch.push(`${m} ${String(first[1]).trim()} SP ${sp}`);
          }
        }
      }
      record('every uploaded order appears in the downloaded report',
        orderMismatch.length === 0,
        orderMismatch.length ? `missing ${orderMismatch.length}: ${orderMismatch.slice(0, 3).join(', ')}` : 'all 4 marketplaces complete');
      record('sale prices in the report match the file', priceMismatch.length === 0,
        priceMismatch.length ? priceMismatch.join(' | ') : 'spot-checked all 4 marketplaces');
    } else {
      record('sales report offers a View option', false, 'no View button');
    }
  } else {
    record('sales report is reachable from the Sell page', false, 'no Sales Report button');
  }

  record('no uncaught JS errors during the round trip', jsErrors.length === 0,
    jsErrors.slice(0, 2).join(' | '));

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
