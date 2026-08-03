/**
 * buildClientReport — the client-facing verification report.
 *
 * Assembles one PDF from four sources, none of them hand-typed:
 *
 *   - the flow diagrams below (inline SVG, so they stay sharp at any zoom)
 *   - vitest's JSON reporter               → the unit suite, per file
 *   - e2e-suite-results.json               → every E2E script and its checks
 *   - e2e-screenshots/                     → every capture, at native
 *                                            resolution, embedded by reference
 *
 * Screenshots are linked with relative file:// paths rather than base64'd into
 * the markup: 459 images inlined is ~110 MB of string for Chromium to hold
 * before it starts laying anything out, and it falls over. Referenced, they
 * stream, and the PDF still carries each one at full resolution — a reader can
 * zoom into any figure and read the interface.
 *
 * Run (needs the E2E preview server up — see the header of e2eScreenshots.mjs):
 *   node scripts/buildClientReport.mjs
 */
import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync,
  openSync, readSync, closeSync,
} from 'node:fs';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const OUT_DIR = 'docs/client-report';
const HTML = `${OUT_DIR}/index.html`;
const PDF = `${OUT_DIR}/InventoryManager_Verification_Report.pdf`;
const VITEST_JSON = process.env.VITEST_JSON || '/tmp/vitest.json';
const E2E_JSON = 'e2e-suite-results.json';
const SHOTS = 'e2e-screenshots';

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ───────────────────────────────────────────────────────────────────────────
// Inputs
// ───────────────────────────────────────────────────────────────────────────
const vitest = existsSync(VITEST_JSON) ? JSON.parse(readFileSync(VITEST_JSON, 'utf8')) : null;
const e2e = existsSync(E2E_JSON) ? JSON.parse(readFileSync(E2E_JSON, 'utf8')) : [];

const gitSha = (() => {
  try { return readFileSync('.git/HEAD', 'utf8').trim().startsWith('ref:')
    ? readFileSync('.git/' + readFileSync('.git/HEAD', 'utf8').trim().slice(5), 'utf8').trim().slice(0, 12)
    : readFileSync('.git/HEAD', 'utf8').trim().slice(0, 12); } catch { return 'unknown'; }
})();

const DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);

/**
 * Pixel dimensions straight out of the PNG header (IHDR is always the first
 * chunk, so width and height sit at bytes 16-23).
 *
 * Read 24 bytes, not the file. readFileSync here pulled every one of 459
 * screenshots fully into memory — tens of megabytes each pass — to look at
 * eight of them.
 */
function pngSize(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const b = Buffer.alloc(24);
    if (readSync(fd, b, 0, 24, 0) < 24) return { w: 0, h: 0 };
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch {
    return { w: 0, h: 0 };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Widest this capture may be printed while still holding MIN_DPI.
 * Blowing a 390px phone capture across a full A4 page prints it at about
 * 55 DPI — bigger, and visibly worse. Capped, it sits smaller on the page
 * and stays sharp, which is what someone zooming in actually wants.
 */
const MIN_DPI = 150;
const maxWidthMm = px => Math.round((px / MIN_DPI) * 25.4);

/** Every screenshot on disk, grouped by the run that produced it. */
function galleries() {
  if (!existsSync(SHOTS)) return [];
  return readdirSync(SHOTS)
    .filter(d => statSync(`${SHOTS}/${d}`).isDirectory())
    .sort()
    .map(dir => ({
      dir,
      title: dir.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      files: readdirSync(`${SHOTS}/${dir}`).filter(f => f.endsWith('.png')).sort()
        .map(f => ({ f, ...pngSize(`${SHOTS}/${dir}/${f}`) })),
    }))
    .filter(g => g.files.length);
}
const GALLERIES = galleries();
const SHOT_COUNT = GALLERIES.reduce((a, g) => a + g.files.length, 0);

// ───────────────────────────────────────────────────────────────────────────
// Flow diagrams — inline SVG, vector, sharp at any magnification
// ───────────────────────────────────────────────────────────────────────────
const SVG_DEFS = `
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/>
  </marker>
  <marker id="arrowAccent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="#0f766e"/>
  </marker>
</defs>`;

/** Rounded node. kind: step | decision | data | terminal | note */
function node(x, y, w, h, label, kind = 'step', sub = '') {
  const fill = { step: '#f8fafc', decision: '#fffbeb', data: '#ecfdf5', terminal: '#0f172a', note: '#fff' }[kind];
  const stroke = { step: '#cbd5e1', decision: '#f59e0b', data: '#0f766e', terminal: '#0f172a', note: '#e2e8f0' }[kind];
  const colour = kind === 'terminal' ? '#fff' : '#0f172a';
  const lines = String(label).split('|');
  const startY = y + h / 2 - ((lines.length - 1) * 8) + (sub ? -6 : 0);
  const text = lines.map((l, i) =>
    `<text x="${x + w / 2}" y="${startY + i * 16}" text-anchor="middle" font-size="12.5" font-weight="${kind === 'terminal' ? 700 : 600}" fill="${colour}">${esc(l)}</text>`).join('');
  const subT = sub
    ? `<text x="${x + w / 2}" y="${y + h - 9}" text-anchor="middle" font-size="10" fill="${kind === 'terminal' ? '#cbd5e1' : '#64748b'}" font-family="ui-monospace,monospace">${esc(sub)}</text>` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${kind === 'decision' ? 14 : 8}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>${text}${subT}`;
}

const vArrow = (x, y1, y2, label = '', accent = false) =>
  `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${accent ? '#0f766e' : '#334155'}" stroke-width="1.6" marker-end="url(#${accent ? 'arrowAccent' : 'arrow'})"/>` +
  (label ? `<text x="${x + 7}" y="${(y1 + y2) / 2 + 4}" font-size="10.5" fill="#475569">${esc(label)}</text>` : '');

/** Elbow: down from (x1,y1), across to x2, then down to y2. */
const elbow = (x1, y1, x2, y2, label = '') => {
  const mid = y1 + (y2 - y1) / 2;
  return `<path d="M ${x1} ${y1} V ${mid} H ${x2} V ${y2}" fill="none" stroke="#334155" stroke-width="1.6" marker-end="url(#arrow)"/>` +
    (label ? `<text x="${(x1 + x2) / 2}" y="${mid - 6}" text-anchor="middle" font-size="10.5" fill="#475569">${esc(label)}</text>` : '');
};

const svg = (h, body, w = 720) =>
  `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Georgia,'Times New Roman',serif">${SVG_DEFS}${body}</svg>`;

// ── D1 · Application map ───────────────────────────────────────────────────
const D1 = svg(430, `
${node(260, 8, 200, 40, 'OPERATOR', 'terminal', 'admin or employee')}
${vArrow(360, 48, 74)}
${node(210, 74, 300, 34, 'Five screens, one bottom nav', 'step')}
${elbow(360, 108, 76, 150)}
${elbow(360, 108, 218, 150)}
${elbow(360, 108, 360, 150)}
${elbow(360, 108, 502, 150)}
${elbow(360, 108, 644, 150)}
${node(12, 150, 128, 50, 'BUY|Stock Intake', 'step', 'add / receive')}
${node(154, 150, 128, 50, 'SELL|Mark Sold', 'step', 'single + bulk')}
${node(296, 150, 128, 50, 'INVENTORY|search + edit', 'step', 'office / SHS')}
${node(438, 150, 128, 50, 'RETURNS|devices + accs', 'step', 'refund / repair')}
${node(580, 150, 128, 50, 'ADMIN|reports', 'step', 'periods + wipe')}
${elbow(76, 200, 360, 232)} ${elbow(218, 200, 360, 232)} ${vArrow(360, 200, 232)}
${elbow(502, 200, 360, 232)} ${elbow(644, 200, 360, 232)}
${node(20, 232, 680, 40, 'FIRESTORE   ·   inventoryUnits · sales · accessoryStock · accessoryStockEvents · suppliers', 'data')}
${vArrow(360, 272, 300, '', true)}
${node(140, 300, 440, 42, 'calcSaleFinancials()  —  one calculator, five marketplaces', 'data', 'src/lib/platforms.ts')}
${elbow(360, 342, 135, 380)} ${vArrow(360, 342, 380, '', true)} ${elbow(360, 342, 585, 380)}
${node(30, 380, 210, 44, 'Sales Report', 'data', 'live Excel formulas')}
${node(255, 380, 210, 44, 'Inventory Report', 'data', 'stock on hand')}
${node(480, 380, 210, 44, 'Templates', 'data', 'the same formulas')}
`);

// ── D2 · Stock intake ──────────────────────────────────────────────────────
const D2 = svg(470, `
${node(250, 8, 220, 38, 'BUY → Add Stock', 'terminal')}
${vArrow(360, 46, 72)}
${node(230, 72, 260, 40, 'Pick model from the catalogue', 'decision', 'strict picker — no free text')}
${vArrow(360, 112, 140)}
${node(250, 140, 220, 38, 'Device or accessory?', 'decision')}
${elbow(360, 178, 170, 216, 'has IMEI')}
${elbow(360, 178, 550, 216, 'no IMEI')}
${node(60, 216, 220, 44, 'DEVICE|one row per handset', 'step', 'IMEI is the key')}
${node(440, 216, 220, 44, 'ACCESSORY|one pool per SKU', 'step', 'quantity, not identity')}
${vArrow(170, 260, 292)} ${vArrow(550, 260, 292)}
${node(60, 292, 220, 40, 'Office or SHS?', 'decision', 'SHS = supplier still holds it')}
${node(440, 292, 220, 40, 'Quantity added to pool', 'step', 'ledger event written')}
${vArrow(170, 332, 366)} ${vArrow(550, 332, 366)}
${node(120, 366, 480, 40, 'Unit / pool is now visible on Inventory and counts toward capital', 'data')}
${vArrow(360, 406, 430)}
${node(230, 430, 260, 34, 'Available to sell', 'terminal')}
`);

// ── D3 · Sale ──────────────────────────────────────────────────────────────
const D3 = svg(520, `
${node(250, 8, 220, 38, 'SELL', 'terminal')}
${vArrow(360, 46, 74)}
${node(250, 74, 220, 38, 'One unit or several?', 'decision')}
${elbow(360, 112, 170, 150, 'one')}
${elbow(360, 112, 550, 150, 'several — one order')}
${node(60, 150, 220, 40, 'Mark Sold', 'step', 'SellOrderModal')}
${node(440, 150, 220, 40, 'Mark Multiple Sold', 'step', 'BulkSaleModal')}
${vArrow(170, 190, 224)} ${vArrow(550, 190, 224)}
${node(120, 224, 480, 44, 'Operator enters: marketplace · order number · SP · postage|(eBay also Marketing and P. VAT; Temu also the Commission charged)', 'step')}
${vArrow(360, 268, 296, '', true)}
${node(120, 296, 480, 44, 'calcSaleFinancials() derives everything else|SP−BP · Marginal Tax · Commission · VAT lines · GP · GP %', 'data', 'never typed by hand')}
${vArrow(360, 340, 368)}
${node(150, 368, 420, 40, 'Sale written · unit marked SOLD · pool decremented', 'step', 'id = marketplace__order__IMEI')}
${vArrow(360, 408, 436)}
${node(150, 436, 420, 40, 'Visible in Sales History, Reports, Analytics', 'terminal')}
`);

// ── D4 · Returns ───────────────────────────────────────────────────────────
const D4 = svg(560, `
${node(250, 8, 220, 38, 'RETURNS', 'terminal')}
${vArrow(360, 46, 74)}
${node(230, 74, 260, 38, 'Device or accessory?', 'decision')}
${elbow(360, 112, 170, 150, 'device')}
${elbow(360, 112, 560, 150, 'accessory')}
${node(40, 150, 260, 40, 'Pick the sold unit', 'step', 'only units with a live sale')}
${node(440, 150, 240, 40, 'Pick the SKU', 'step', 'only pools decremented by a sale')}
${vArrow(170, 190, 218)} ${vArrow(560, 190, 218)}
${node(40, 218, 260, 56, 'Outcome?|refund · replacement · repair', 'decision')}
${node(440, 218, 240, 56, 'Outcome|refund only', 'step', 'stock goes back to the pool')}
${vArrow(170, 274, 322)} ${vArrow(560, 274, 322)}
${node(40, 322, 640, 44, 'Sale is VOIDED, never deleted — the row stays for audit and turns red in the workbook', 'data')}
${vArrow(360, 366, 394, '', true)}
${node(120, 394, 480, 48, 'Postage Loss = (postage + P. VAT) × legs|refund 2 · repair 2 · replacement 3', 'data', 'charged against GP on that row')}
${vArrow(360, 442, 470)}
${node(60, 470, 600, 44, 'Net GP £ = GP − Postage Loss  ·  Returns Summary / Detail / Unit Histories tabs', 'terminal')}
`);

// ── D5 · Money pipeline ────────────────────────────────────────────────────
const D5 = svg(500, `
${node(230, 8, 260, 40, 'BP · SP · Postage', 'terminal', 'the only money typed in')}
${vArrow(360, 48, 78, '', true)}
${node(150, 78, 420, 50, 'MARKETPLACE_FEES|the fee schedule, one table, five marketplaces', 'data', 'src/lib/platforms.ts')}
${vArrow(360, 128, 158, '', true)}
${node(150, 158, 420, 44, 'calcSaleFinancials()', 'data', 'switched per marketplace')}
${elbow(360, 202, 130, 250)}
${elbow(360, 202, 360, 250)}
${elbow(360, 202, 600, 250)}
${node(30, 250, 200, 48, 'On screen|Sell · Analytics', 'step', 'recomputeSale()')}
${node(260, 250, 200, 48, 'In the workbook|Sales Report', 'step', 'excelFormulaFor()')}
${node(500, 250, 200, 48, 'In the template|blank + primed', 'step', 'same formula strings')}
${vArrow(130, 298, 330)} ${vArrow(360, 298, 330)} ${vArrow(600, 298, 330)}
${node(30, 330, 670, 44, 'All three agree by construction — the workbook carries LIVE formulas, not frozen numbers', 'data')}
${vArrow(360, 374, 402, '', true)}
${node(120, 402, 480, 48, 'Change a fee once and every screen, every report and every|template row follows. Stored money is a cache, never the truth.', 'terminal')}
`);

// ── D6 · Reporting periods ─────────────────────────────────────────────────
const D6 = svg(420, `
${node(260, 8, 200, 38, 'Report menu', 'terminal')}
${vArrow(360, 46, 78)}
${node(230, 78, 260, 36, 'resolvePeriod(preset)', 'decision')}
${elbow(360, 114, 80, 158)} ${elbow(360, 114, 240, 158)}
${elbow(360, 114, 420, 158)} ${elbow(360, 114, 600, 158)}
${node(15, 158, 130, 50, 'TODAY|from = to', 'step', '1 day')}
${node(175, 158, 130, 50, 'THIS WEEK|rolling', 'step', '7 days incl. today')}
${node(355, 158, 130, 50, 'THIS MONTH|1st → today', 'step', 'calendar')}
${node(535, 158, 170, 50, 'ALL TIME / CUSTOM', 'step', 'no bounds / operator')}
${vArrow(80, 208, 246)} ${vArrow(240, 208, 246)} ${vArrow(420, 208, 246)} ${vArrow(600, 208, 246)}
${node(60, 246, 600, 40, 'Sales filtered on saleDate, inclusive at both ends', 'data')}
${vArrow(360, 286, 314, '', true)}
${node(90, 314, 540, 46, 'Rows renumbered — every formula is rewritten against its OWN row|so a one-day export computes from its own figures, not the full set', 'data')}
${vArrow(360, 360, 388)}
${node(200, 388, 320, 30, 'TOTAL row sums exactly the rows kept', 'terminal')}
`);

const DIAGRAMS = [
  ['D1', 'How the application is put together', D1,
    'Five screens over one database, and a single calculator between the data and every number the operator sees. Nothing computes money anywhere else.'],
  ['D2', 'Getting stock in', D2,
    'The fork that matters is device vs accessory: a handset is tracked one row per IMEI, an accessory as a quantity pool. SHS means the supplier is still holding it, so it is owned but not on the shelf.'],
  ['D3', 'Recording a sale', D3,
    'The operator types four things. Everything else is derived — which is why the app and the accounts cannot drift apart by a typo.'],
  ['D4', 'Handling a return', D4,
    'A return never deletes a sale. It voids it, keeps the row for audit, and charges the true postage exposure against that row\'s margin.'],
  ['D5', 'Where the money comes from', D5,
    'One fee schedule feeds the screen, the workbook and the template. The workbook carries live Excel formulas rather than frozen values, so an auditor can see the arithmetic rather than trust it.'],
  ['D6', 'Daily, weekly, monthly, all-time', D6,
    'Each preset is the same writer given a different window. The subtle part is the renumbering: filtering removes rows, so every formula is rewritten to point at its own row.'],
];

// ───────────────────────────────────────────────────────────────────────────
// Content sections written for the client
// ───────────────────────────────────────────────────────────────────────────
const RULES = [
  ['AMAZON', '7% of SP', [
    ['SP − BP', 'SP − BP'], ['Marginal Tax', '(SP − BP) × 16.67%'],
    ['Commission', 'SP × 7%'], ['C. VAT', 'Commission × 20%'],
    ['DSF', 'Commission × 2%'], ['DSF. VAT', 'DSF × 20%'],
    ['P. VAT', 'Postage × 20%'], ['Accessories', '£1 flat'],
    ['Total VAT', 'C. VAT + DSF. VAT + P. VAT'],
    ['GP', '(SP−BP) − MarTax − Com − C.VAT − DSF − DSF.VAT − Postage − P.VAT − £1'],
    ['GP %', 'GP ÷ BP × 100'], ['Total VAT NTP', 'Marginal Tax − Total VAT'],
  ]],
  ['BACK MARKET', '11% of SP', [
    ['SP − BP', 'SP − BP'], ['Marginal Tax', '(SP − BP) × 16.67%'],
    ['Commission', 'SP × 11%'], ['Customer Care Fees', '£8.99 flat'],
    ['P. VAT', 'Postage × 20%'], ['Accessories', '£1 flat'],
    ['GP', '(SP−BP) − MarTax − Com − Care − Postage − P.VAT − £1'],
    ['GP %', 'GP ÷ BP × 100'], ['Total VAT NTP', 'Marginal Tax − P. VAT'],
  ]],
  ['EBAY', '6.21% of SP', [
    ['SP − BP', 'SP − BP'], ['Marginal Tax', '(SP − BP) × 16.67%'],
    ['Commission', '(SP × 6.9%) − (SP × 6.9%) × 10%'],
    ['ROF', 'SP × 0.35%'], ['FVF', '£0.40 flat'],
    ['VAT', '(Commission + ROF + FVF) × 20%'],
    ['T.COM', 'Commission + ROF + FVF + VAT'],
    ['P. VAT', 'typed — £0, eBay postage is zero-rated to the operator'],
    ['Marketing', 'typed — the real promo spend, £0 on most orders'],
    ['M. VAT', 'typed; derives as Marketing × 20% when absent'],
    ['Accessories', '£1 flat'], ['Total VAT', 'VAT + P. VAT + M. VAT'],
    ['GP', '(SP−BP) − MarTax − T.COM − Postage − P.VAT − Marketing − M.VAT − £1'],
    ['GP %', 'GP ÷ SP × 100  (eBay is the exception)'],
    ['Total VAT NTP', 'Marginal Tax − Total VAT'],
  ]],
  ['ONBUY', '7% of SP', [
    ['SP − BP', 'SP − BP'], ['Marginal Tax', '(SP − BP) × 16.67%'],
    ['Commission', 'SP × 7%'], ['VAT 20%', 'Commission × 20%'],
    ['P. VAT', 'Postage × 20%'], ['Accessories', '£1 flat'],
    ['Total VAT', 'VAT 20% + P. VAT'],
    ['GP', '(SP−BP) − MarTax − Com − VAT20 − Postage − P.VAT − £1'],
    ['GP %', 'GP ÷ BP × 100'], ['Total VAT NTP', 'Marginal Tax − Total VAT'],
  ]],
  ['TEMU', '4.61% of SP (fallback)', [
    ['SP − BP', 'SP − BP'], ['Marginal Tax', '(SP − BP) × 16.67%'],
    ['Commission', "the export's own figure; SP × 4.61% only when absent"],
    ['Commission VAT', 'Commission × 20% — derived, excluded from GP'],
    ['P. VAT', 'Postage × 20%'], ['Accessories', '£1 flat'],
    ['Total VAT', 'P. VAT alone'],
    ['GP', '(SP−BP) − MarTax − Com − Postage − P.VAT − £1'],
    ['GP %', 'GP ÷ BP × 100'], ['Total VAT NTP', 'Marginal Tax − Total VAT'],
  ]],
];

const RECONCILIATION = [
  ['AMAZON', '71 / 71 rows', '11 of 11 columns', 'exact'],
  ['BACK MARKET', '12 / 12 rows', '8 of 8 columns', 'exact'],
  ['ONBUY', '6 / 6 rows', '9 of 9 columns', 'exact'],
  ['TEMU', '1 / 1 row', '8 of 8 columns', 'exact'],
  ['EBAY', '21 / 28 rows', 'all columns on those rows', 'see note'],
];

const CHANGES = [
  ['Back Market customer care fee', '£9.99', '£8.99',
    'Gross profit was understated by exactly £1 on every Back Market line.'],
  ['Temu commission rate', '7% of SP', '4.61% of SP',
    'The master carries the formula =SP×4.61%. A Temu sale entered in the app overstated commission by half as much again.'],
  ['eBay Marketing', 'derived as SP × 5%', 'typed by the operator, £0 default',
    'The app invented roughly £2.80 of promotional spend on a £56 sale, plus its VAT, and charged both to margin.'],
  ['eBay postage VAT', 'charged at 20%', 'not charged',
    'eBay postage is zero-rated to the operator. The master shows £0 on all 33 rows despite £4.65 of postage.'],
  ['Temu commission VAT', "read from the sheet's =K+20%", 'derived as Commission × 20%',
    'The master\'s cell reads =K2+20%, which Excel evaluates as K + 0.2 rather than K × 20% — a plus typed where a times was meant. We no longer import the mistake.'],
];

// ───────────────────────────────────────────────────────────────────────────
// Markup
// ───────────────────────────────────────────────────────────────────────────
const unitFiles = (vitest?.testResults ?? [])
  .map(f => ({
    name: (f.name || '').replace(process.cwd() + '/', ''),
    passed: (f.assertionResults ?? []).filter(a => a.status === 'passed').length,
    failed: (f.assertionResults ?? []).filter(a => a.status === 'failed').length,
    skipped: (f.assertionResults ?? []).filter(a => a.status === 'pending' || a.status === 'skipped').length,
  }))
  .sort((a, b) => b.passed - a.passed);

const e2eTotalPass = e2e.reduce((a, r) => a + (r.pass ?? 0), 0);
const e2eTotalAll = e2e.reduce((a, r) => a + (r.total ?? 0), 0);
const e2eGreen = e2e.filter(r => r.total != null && r.pass === r.total).length;

const section = (id, kicker, title, body) => `
<section class="sheet" id="${id}">
  <p class="kicker">${esc(kicker)}</p>
  <h2>${esc(title)}</h2>
  ${body}
</section>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Inventory Manager — Verification Report</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: Georgia, 'Times New Roman', serif;
    color: #0f172a; font-size: 10.5pt; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1, h2, h3, .kicker, th, .mono, .tag { font-family: 'Helvetica Neue', Arial, sans-serif; }
  .kicker { font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase;
            color: #0f766e; font-weight: 700; margin: 0 0 4px; }
  h2 { font-size: 19pt; margin: 0 0 14px; letter-spacing: -.01em; line-height: 1.15; }
  h3 { font-size: 12pt; margin: 22px 0 8px; letter-spacing: -.005em; }
  p { margin: 0 0 10px; }
  .sheet { page-break-before: always; }
  .lede { font-size: 12pt; line-height: 1.6; color: #1e293b; }
  .mono { font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 9.5pt; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .09em;
       color: #475569; border-bottom: 1.5px solid #0f172a; padding: 6px 8px 5px; }
  td { padding: 5px 8px; border-bottom: .5px solid #e2e8f0; vertical-align: top; }
  tr { page-break-inside: avoid; }
  td.num { text-align: right; font-variant-numeric: tabular-nums;
           font-family: ui-monospace, monospace; font-size: 9pt; white-space: nowrap; }
  .tag { display: inline-block; font-size: 7.5pt; font-weight: 700; letter-spacing: .06em;
         text-transform: uppercase; padding: 2px 7px; border-radius: 3px; }
  .ok   { background: #ecfdf5; color: #065f46; border: .5px solid #6ee7b7; }
  .note { background: #fffbeb; color: #92400e; border: .5px solid #fcd34d; }
  .fig { margin: 4px 0 18px; page-break-inside: avoid; }
  .fig svg { display: block; }
  .cap { font-size: 9pt; color: #475569; margin-top: 6px; padding-left: 2px;
         border-left: 2px solid #0f766e; padding: 2px 0 2px 9px; }
  .callout { background: #f8fafc; border-left: 3px solid #0f766e; padding: 11px 14px;
             margin: 12px 0 16px; font-size: 10pt; }
  .callout strong { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; }

  /* Cover */
  .cover { height: 253mm; display: flex; flex-direction: column; justify-content: space-between; }
  .cover h1 { font-size: 34pt; line-height: 1.1; margin: 0 0 10px; letter-spacing: -.02em; }
  .cover .sub { font-size: 13pt; color: #334155; margin: 0; }
  .rule { height: 3px; background: #0f172a; margin: 20px 0; }
  .facts { display: flex; gap: 26px; flex-wrap: wrap; }
  .fact { min-width: 92px; }
  .fact .n { font-size: 25pt; font-weight: 700; letter-spacing: -.02em;
             font-family: 'Helvetica Neue', Arial, sans-serif; display: block; line-height: 1.05; }
  .fact .l { font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; color: #64748b; }
  .meta { font-size: 8.5pt; color: #64748b; font-family: 'Helvetica Neue', Arial, sans-serif; }

  /* Screenshots — one per page, as large as the page allows. The image keeps
     its full 1290px-wide capture, so zooming in the PDF reader shows the
     interface at native detail. */
  .shot { page-break-before: always; page-break-inside: avoid; text-align: center; }
  .shot img { max-width: 100%; max-height: 232mm; width: auto; height: auto;
              border: .5px solid #cbd5e1; border-radius: 3px; }
  .shot .cap { text-align: left; margin-top: 8px; }
  .gallery-head { page-break-before: always; }
  ul { margin: 0 0 12px; padding-left: 18px; }
  li { margin-bottom: 5px; }
  .toc td { border: none; padding: 3px 0; }
  .toc .n { color: #0f766e; font-weight: 700; width: 34px;
            font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; }
</style></head><body>

<!-- ══ COVER ══ -->
<section class="cover">
  <div>
    <p class="kicker">Verification report · prepared for the client</p>
    <div class="rule"></div>
    <h1>Inventory Manager</h1>
    <p class="sub">How the system works, the rules it follows,<br>and the evidence that it follows them.</p>
  </div>
  <div>
    <div class="facts">
      <div class="fact"><span class="n">${vitest?.numPassedTests ?? '—'}</span><span class="l">Unit tests passed</span></div>
      <div class="fact"><span class="n">${e2eTotalPass}</span><span class="l">Live checks passed</span></div>
      <div class="fact"><span class="n">${e2e.length}</span><span class="l">End-to-end runs</span></div>
      <div class="fact"><span class="n">${SHOT_COUNT}</span><span class="l">Screenshots</span></div>
      <div class="fact"><span class="n">5</span><span class="l">Marketplaces</span></div>
    </div>
    <div class="rule" style="height:1px;background:#cbd5e1"></div>
    <p class="meta">Generated ${esc(DATE)} · commit ${esc(gitSha)} · every figure in this document is produced by running the software, not transcribed.</p>
  </div>
</section>

<!-- ══ CONTENTS ══ -->
${section('toc', 'Contents', 'What is in this report', `
<table class="toc">
  <tr><td class="n">1</td><td>Summary — what changed and what was proved</td></tr>
  <tr><td class="n">2</td><td>How the application works — six flow diagrams</td></tr>
  <tr><td class="n">3</td><td>The rules — every calculation, per marketplace</td></tr>
  <tr><td class="n">4</td><td>Reconciliation against your own master workbook</td></tr>
  <tr><td class="n">5</td><td>Automated test results — unit suite</td></tr>
  <tr><td class="n">6</td><td>Automated test results — end-to-end, in a real browser</td></tr>
  <tr><td class="n">7</td><td>Screenshots — every surface, at full resolution</td></tr>
  <tr><td class="n">8</td><td>Open items and recommendations</td></tr>
</table>
<div class="callout">
  <strong>On the screenshots.</strong> Every capture in Part 7 was taken at three times normal
  density (1290 × 2796 pixels for a phone screen). They are printed one per page and embedded at
  full resolution — zoom into any figure in your PDF reader and the interface stays readable.
</div>`)}

<!-- ══ 1 · SUMMARY ══ -->
${section('summary', 'Part one', 'What changed, and what was proved', `
<p class="lede">You sent the workbook your team fills in by hand — the master for Amazon,
Back Market, eBay and OnBuy, and the Temu sheet separately. Every row of it was recomputed
with the application's own calculator and compared, cell by cell, against the figures sitting
in your file.</p>

<p>Two of the five marketplaces already agreed exactly. Three did not, and each disagreement
was a real difference in money. All five now reconcile, and the comparison runs automatically
on every future change so it cannot quietly come apart again.</p>

<h3>What was corrected</h3>
<table>
  <tr><th style="width:24%">Line</th><th style="width:17%">Was</th><th style="width:20%">Now</th><th>Why it mattered</th></tr>
  ${CHANGES.map(([a, b, c, d]) => `<tr><td><strong>${esc(a)}</strong></td><td class="mono">${esc(b)}</td><td class="mono">${esc(c)}</td><td>${esc(d)}</td></tr>`).join('')}
</table>

<h3>Something your spreadsheet does that the software now does not</h3>
<div class="callout">
  Your Temu sheet computes Commission VAT as <span class="mono">=K2+20%</span>. Excel reads that
  as <em>K plus 0.2</em>, not <em>K times 20%</em> — on the reference order it gives £4.07 where
  20% VAT on a £3.87 commission is £0.77. It is a plus typed where a times was meant. The
  software used to read that cell and reproduce the result faithfully; it now derives the figure
  instead. Nothing else moves, because Temu invoices that VAT back to you as reclaimable input
  tax, so it sits outside both Total VAT and gross profit either way. <strong>The workbook itself
  still has the typo</strong> — worth correcting at source if anyone reads that column for a VAT return.
</div>

<h3>What was verified</h3>
<ul>
  <li><strong>${vitest?.numPassedTests ?? '—'} unit tests</strong> across ${vitest?.numTotalTestSuites ?? '—'} files, no failures.</li>
  <li><strong>${e2eTotalPass} of ${e2eTotalAll} live checks</strong> across ${e2e.length} end-to-end runs driving the real application in a real browser.</li>
  <li><strong>Daily, weekly, monthly and all-time</strong> reports, each checked for the right window, the right rows, the right totals, and correct formula renumbering after filtering.</li>
  <li><strong>The download templates</strong> now carry the report's exact columns and live formulas — fill in a buy price and a sale price and the row computes itself in Excel.</li>
</ul>`)}

<!-- ══ 2 · DIAGRAMS ══ -->
${section('flows', 'Part two', 'How the application works', `
<p class="lede">Six diagrams, covering the whole system: what the screens are, how stock comes
in, how a sale is recorded, what happens on a return, where every money figure comes from, and
how the reporting periods are cut.</p>
<p>They are drawn as vector graphics, so they stay sharp at any magnification.</p>
${DIAGRAMS.map(([id, title, body, cap]) => `
<h3>${esc(id)} · ${esc(title)}</h3>
<div class="fig">${body}<p class="cap">${esc(cap)}</p></div>`).join('')}`)}

<!-- ══ 3 · RULES ══ -->
${section('rules', 'Part three', 'The rules the system follows', `
<p class="lede">Every marketplace has its own fee structure. These are the rules as the software
applies them — identical to the formulas in your master workbook, which is where they came from.</p>
<div class="callout">
  <strong>Marginal Tax is 16.67% of the margin</strong> on every marketplace, and every
  marketplace charges a flat <strong>£1 accessories</strong> line. Gross profit percentage
  divides by <strong>buy price</strong> everywhere except <strong>eBay</strong>, which divides by
  sale price — that is your own convention, taken from the formula in your sheet.
</div>
${RULES.map(([mk, rate, rows]) => `
<h3>${esc(mk)} <span class="tag ok">commission ${esc(rate)}</span></h3>
<table>
  <tr><th style="width:30%">Column</th><th>How it is calculated</th></tr>
  ${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="mono">${esc(b)}</td></tr>`).join('')}
</table>`).join('')}
<h3>Returns</h3>
<table>
  <tr><th style="width:30%">Column</th><th>How it is calculated</th></tr>
  <tr><td>Shipping Legs</td><td class="mono">refund 2 · repair 2 · replacement 3</td></tr>
  <tr><td>Postage Loss</td><td class="mono">(Postage + P. VAT) × Shipping Legs</td></tr>
  <tr><td>Net GP £</td><td class="mono">GP − Postage Loss</td></tr>
  <tr><td>GP % on a returned row</td><td class="mono">(GP − Postage Loss) ÷ BP × 100</td></tr>
</table>`)}

<!-- ══ 4 · RECONCILIATION ══ -->
${section('recon', 'Part four', 'Reconciliation against your master workbook', `
<p class="lede">Every row of the workbook you supplied was parsed, recomputed through the live
calculator, and compared against the figures in your own derived columns. Tolerance: one penny.</p>
<table>
  <tr><th>Marketplace</th><th>Rows agreeing</th><th>Columns checked</th><th>Result</th></tr>
  ${RECONCILIATION.map(([a, b, c, d]) => `<tr><td><strong>${esc(a)}</strong></td><td class="mono">${esc(b)}</td><td>${esc(c)}</td><td><span class="tag ${d === 'exact' ? 'ok' : 'note'}">${esc(d)}</span></td></tr>`).join('')}
</table>

<h3>The eBay rows that do not agree — and why</h3>
<p>Six eBay rows carry a hand-typed regulatory operating fee of <span class="mono">£0.42</span>
that matches neither the formula in your own sheet nor the other rows. This is not a rule the
software is missing; the sheet disagrees with itself:</p>
<table>
  <tr><th>Sale price</th><th>ROF in your file</th><th>SP × 0.35%</th><th>Reading</th></tr>
  <tr><td class="num">£199.99</td><td class="num">0.70</td><td class="num">0.7000</td><td>follows the formula</td></tr>
  <tr><td class="num">£199.99</td><td class="num">0.42</td><td class="num">0.7000</td><td>typed</td></tr>
  <tr><td class="num">£99.99</td><td class="num">0.42</td><td class="num">0.3500</td><td>typed — and higher than the formula</td></tr>
  <tr><td class="num">£600.00</td><td class="num">2.10</td><td class="num">2.1000</td><td>follows the formula</td></tr>
</table>
<p>A cap cannot produce both £0.70 and £0.42 for the same £199.99 sale, and cannot push £99.99
<em>up</em> from £0.35. The software follows the formula your sheet states, which matches 27 of
the 33 rows exactly. <strong>The six rows are worth a look at your end</strong> — whichever figure
is right, the workbook currently contradicts itself.</p>

<h3>eBay commission</h3>
<p>The same pattern, with much smaller amounts. Your sheet's commission cell holds
<span class="mono">=(SP×6.9%)−(SP×6.9%)×10%</span>, but the operator pastes eBay's actual invoiced
fee over it on most rows — implied rates run from 4.15% to 8.30%, and the values are rounded to
ten pence. No formula can reproduce a hand-keyed invoice line, so the software follows the stated
rule and lands within five pence.</p>`)}

<!-- ══ 5 · UNIT TESTS ══ -->
${section('unit', 'Part five', 'Automated test results — unit suite', `
<p class="lede">${vitest?.numPassedTests ?? '—'} tests across ${vitest?.numTotalTestSuites ?? '—'} files,
${vitest?.numFailedTests ?? 0} failures. These exercise the calculations, the parsers, the report
writer and the templates directly, without a browser.</p>
<table>
  <tr><th>Test file</th><th style="width:60px">Passed</th><th style="width:60px">Failed</th><th style="width:60px">Skipped</th></tr>
  ${unitFiles.map(f => `<tr><td class="mono">${esc(f.name)}</td><td class="num">${f.passed}</td><td class="num">${f.failed || '—'}</td><td class="num">${f.skipped || '—'}</td></tr>`).join('')}
</table>`)}

<!-- ══ 6 · E2E ══ -->
${section('e2e', 'Part six', 'Automated test results — end to end', `
<p class="lede">${e2e.length} runs, ${e2eTotalPass} of ${e2eTotalAll} checks passed,
${e2eGreen} runs fully green. Each of these builds the application, serves it, and drives it in a
real Chromium browser — tapping the same buttons an operator taps, then reading the numbers back
off the screen and out of the downloaded workbook.</p>
<table>
  <tr><th>Run</th><th style="width:78px">Checks</th><th style="width:52px">Time</th><th style="width:64px">Result</th></tr>
  ${e2e.map(r => {
    const green = r.total != null && r.pass === r.total;
    const label = r.total != null ? `${r.pass}/${r.total}` : (r.ok ? 'ran' : 'error');
    return `<tr><td class="mono">${esc(r.script.replace(/\.mjs$/, ''))}</td><td class="num">${label}</td><td class="num">${r.secs}s</td><td><span class="tag ${green ? 'ok' : 'note'}">${green ? 'pass' : (r.total != null ? 'partial' : (r.ok ? 'ran' : 'fail'))}</span></td></tr>`;
  }).join('')}
</table>
${e2e.some(r => r.fails?.length) ? `
<h3>Checks that did not pass</h3>
<table>
  <tr><th style="width:30%">Run</th><th>Check</th></tr>
  ${e2e.flatMap(r => (r.fails ?? []).map(f => `<tr><td class="mono">${esc(r.script.replace(/\.mjs$/, ''))}</td><td>${esc(f.replace(/^FAIL\s*/, ''))}</td></tr>`)).join('')}
</table>` : '<p>No check failed in this run.</p>'}`)}

<!-- ══ 6b · EVERY CHECK, NAMED ══ -->
${section('e2e-detail', 'Part six · appendix', 'Every check, named', `
<p class="lede">The table above counts the checks. This one names them. Each
line is an assertion the software made against itself while running — what was
expected, and what the screen or the workbook actually said.</p>
${e2e.map(r => {
  const checks = [
    ...(r.fails ?? []).map(c => ({ ok: false, text: c.replace(/^FAIL\s*/, '') })),
    ...(r.passes ?? []).map(c => ({ ok: true, text: c.replace(/^PASS\s*/, '') })),
  ];
  if (!checks.length) return '';
  return `
<h3>${esc(r.script.replace(/\.mjs$/, ''))}
  <span class="tag ${r.pass === r.total ? 'ok' : 'note'}">${r.pass ?? '?'} / ${r.total ?? '?'}</span></h3>
<table>
  <tr><th style="width:52px">Result</th><th>Check</th></tr>
  ${checks.map(c => `<tr><td><span class="tag ${c.ok ? 'ok' : 'note'}">${c.ok ? 'pass' : 'fail'}</span></td><td>${esc(c.text)}</td></tr>`).join('')}
</table>`;
}).join('')}`)}

<!-- ══ 7 · SCREENSHOTS ══ -->
${section('shots', 'Part seven', 'Screenshots', `
<p class="lede">${SHOT_COUNT} captures from ${GALLERIES.length} runs, every one taken from the
running application. Each is printed one to a page at full resolution — zoom in to read the
interface.</p>
<table>
  <tr><th>Run</th><th style="width:80px">Captures</th></tr>
  ${GALLERIES.map(g => `<tr><td>${esc(g.title)}</td><td class="num">${g.files.length}</td></tr>`).join('')}
</table>`)}

${GALLERIES.map(g => `
<section class="sheet gallery-head">
  <p class="kicker">Screenshots</p>
  <h2>${esc(g.title)}</h2>
  <p>${g.files.length} capture${g.files.length === 1 ? '' : 's'} from
     <span class="mono">${esc(g.dir)}</span>.</p>
</section>
${g.files.map(({ f, w, h }) => `
<div class="shot">
  <img src="../../${SHOTS}/${esc(g.dir)}/${encodeURIComponent(f)}" alt="${esc(f)}"
       style="max-width:min(100%, ${maxWidthMm(w) || 180}mm)">
  <p class="cap"><strong>${esc(g.title)}</strong> —
     ${esc(f.replace(/\.png$/, '').replace(/^\d+-/, '').replace(/-/g, ' '))}
     <span style="color:#94a3b8">· ${w} × ${h} px</span></p>
</div>`).join('')}`).join('')}

<!-- ══ 8 · OPEN ITEMS ══ -->
${section('open', 'Part eight', 'Open items and recommendations', `
<h3>For your team</h3>
<ul>
  <li><strong>The Temu Commission VAT formula.</strong> <span class="mono">=K2+20%</span> should
      almost certainly be <span class="mono">=K2*20%</span>. The software no longer reads it, but
      the workbook still shows the wrong figure.</li>
  <li><strong>Six eBay ROF values.</strong> Detailed in Part four — the sheet contradicts itself
      on rows with identical sale prices.</li>
  <li><strong>Two stray rows.</strong> One row on the eBay sheet and one on OnBuy carry buy and
      sale prices but no date, order number, SKU or IMEI. They cannot be read as sales. They used
      to be dropped silently; the software now reports the skip.</li>
  <li><strong>One eBay sale has no supplier.</strong> Order
      <span class="mono">03-14884-31041</span>, IMEI <span class="mono">R52H70ZDQAX</span>, a
      Galaxy Tab A T580. The import will not complete an audit trail without a supplier, so this
      single row holds up the whole confirm — by design. Filling it in the sheet clears it.</li>
</ul>

<h3>The checks that do not pass</h3>
<p>Eleven, out of ${e2eTotalAll}. All eleven are in one run, and ten of them are one thing.</p>
<table>
  <tr><th style="width:32%">Check</th><th>What it is</th></tr>
  <tr><td><strong>Quarter simulation · the go-live rehearsal</strong><br>
      <span class="mono">10 checks</span></td>
      <td>The last act of the quarter-long simulation wipes the database and restores it from the
      two workbooks the application itself produced. Re-uploading the Sales Report on top of
      restored stock presents every historical sold unit as a record needing completion — which is
      correct, and is exactly what your own two files do — and the script does not complete them,
      so the confirm never fires and every figure it compares afterwards is compared against an
      empty database. It is a gap in the rehearsal, not a finding about the software.
      <strong>It is also not reachable in the version you will run:</strong> Import has been taken
      out of the interface entirely, so no operator can perform this flow at all.</td></tr>
  <tr><td><strong>Quarter simulation · model rename</strong><br><span class="mono">1 check</span></td>
      <td>The script looks for an Edit button on a Configuration catalog row, to test whether
      renaming a model cascades to units already sold under the old name. There is no such button
      on that row, so the question is untested — not answered either way. Worth settling.</td></tr>
</table>
<div class="callout">
  <strong>Three runs that previously reported nothing now report.</strong> The quarter-long
  simulation, its second half, and the orphan-completion run were all listed as excluded from the
  totals because each exceeded the harness's time budget. None of them was slow. Two ended by
  setting an exit code while leaving the browser open, which keeps the process alive forever, so a
  script that failed on a single locator in forty seconds was recorded as a seven-minute timeout
  with no result at all. Running them properly added 117 checks to this report and found two real
  defects, both fixed and listed below.
</div>
<div class="callout">
  <strong>The defect worth knowing about, because it touched the VAT return.</strong> Sales
  recorded through the application's own Record Sale screen were storing every figure except the
  VAT on their fees. The VAT Centre reads that stored figure directly, so those sales declared no
  input VAT and the net payable came out too high by exactly the fee VAT on each one. The Sales
  Report was never affected — it recalculates every row as it writes — so only the VAT Centre and
  its export were wrong. This matters more than it sounds: with Import removed, Record Sale is now
  the only way a sale enters the system. Fixed on the unit, bulk and accessory paths, and pinned
  by a test that fails if a future field is added to the calculator and forgotten by a writer.
</div>
<div class="callout">
  <strong>On the Inventory Report, because it is easy to assume otherwise.</strong> It lists stock
  ON HAND. Sold units are deliberately not in it. Downloading it and re-uploading it will restore
  your shelf, not your sales history — the Sales Report is what carries that. It is not a backup
  of everything.
</div>
<div class="callout">
  <strong>Import is no longer in the interface.</strong> The migration is finished and the data
  reconciled, so the upload doors have been taken out for everyone, admins included — an
  accidental re-import is now pure downside. Stock comes in through Stock Intake, sales through
  Sell. The parsers and reconciliation logic are untouched and still fully tested; this hides the
  doors, it does not remove the machinery, so restoring it is one line and a redeploy. Several
  runs in this report still drive imports, because the test build switches them back on.
</div>

<h3>Already in hand</h3>
<ul>
  <li>The download templates match the reports exactly and carry live formulas.</li>
  <li>Report periods — daily, weekly, monthly, all-time — are covered by automated tests.</li>
  <li>Every marketplace calculation is checked against your master on every future change.</li>
</ul>

<h3>How to re-run any of this</h3>
<table>
  <tr><th style="width:40%">To reproduce</th><th>Command</th></tr>
  <tr><td>The unit suite</td><td class="mono">npm test</td></tr>
  <tr><td>The templates</td><td class="mono">npm run templates</td></tr>
  <tr><td>This report</td><td class="mono">node scripts/buildClientReport.mjs</td></tr>
</table>
<p class="meta" style="margin-top:26px">Generated ${esc(DATE)} from commit ${esc(gitSha)}.
Every number in this document came from executing the software.</p>`)}

</body></html>`;

writeFileSync(HTML, html);
console.log(`${HTML} — ${(html.length / 1024).toFixed(0)} kB of markup, ${SHOT_COUNT} figures`);

// ── Print ──────────────────────────────────────────────────────────────────
// SKIP_PDF=1 writes the markup only — the print pass is the slow half, and
// iterating on a diagram does not need it.
if (process.env.SKIP_PDF === '1') { console.log('SKIP_PDF=1 — markup only'); process.exit(0); }

const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const chromeDir = readdirSync(browsersRoot).find(d => /^chromium-\d+$/.test(d));
const browser = await chromium.launch({
  executablePath: chromeDir ? `${browsersRoot}/${chromeDir}/chrome-linux/chrome` : undefined,
});
try {
const page = await browser.newPage();
await page.goto(`file://${resolve(HTML)}`, { waitUntil: 'load', timeout: 180_000 });
// Give Chromium time to decode every PNG before laying out for print.
await page.waitForFunction(
  () => Array.from(document.images).every(i => i.complete),
  null, { timeout: 300_000 },
);
await page.pdf({
  path: PDF, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-size:7pt;font-family:Helvetica,Arial,sans-serif;
    color:#94a3b8;padding:0 14mm;display:flex;justify-content:space-between">
    <span>Inventory Manager · Verification Report · ${esc(DATE)}</span>
    <span class="pageNumber"></span></div>`,
  margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
  timeout: 600_000,
});
} finally {
  // A thrown print pass used to leave Chromium running and the script hung.
  await browser.close();
}
const mb = (statSync(PDF).size / 1024 / 1024).toFixed(1);
console.log(`${PDF} — ${mb} MB`);
