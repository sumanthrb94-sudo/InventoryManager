/**
 * scripts/generateQuarterSimData.mjs — builds a realistic "one quarter of
 * business" dataset for the full-scale simulation requested by the
 * operator: ~90 days, ~20 new office units/day (+ SHS + accessories),
 * sold across all 5 marketplaces, with a realistic return rate baked in.
 *
 * Outputs (into OUT_DIR):
 *   - INVENTORY_REPORT_SIM.xlsx   — INVENTORY sheet (office+SHS) + Accessories sheet
 *   - SALES_REPORT_SIM.xlsx       — one sheet per marketplace (AMAZON/BM/EBAY/ONBUY/TEMU)
 *   - manifest.json               — every generated record, independent of the app,
 *                                    for the ground-truth calculator (groundTruthCalc.mjs)
 *
 * Design choices (see REPORT_SCHEMAS.md for the contract these follow):
 *   - IMEIs are real 15-digit numeric for ordinary Android phones; 11-char
 *     alphanumeric serials for Apple / Tab / Watch device families (matches
 *     isAppleDevice()'s substring detection so bulk import doesn't reject them).
 *   - Every sold unit's Sales Report row IMEI matches its Inventory Report
 *     row IMEI exactly — no orphan rows, so the bulk import never needs the
 *     manual "complete N records" audit-screen path (that's tested elsewhere;
 *     this script is about volume + cross-marketplace + return correctness).
 *   - A realistic ~6% of sold rows carry a baked-in return (Return Date /
 *     Outcome / Return Reason columns) split across refund/replacement/repair
 *     — these columns are read by parseRow regardless of whether the file is
 *     a fresh upload or a re-import of the app's own export (confirmed via
 *     SHEET_LAYOUTS in salesImport.ts), so a plain bulk file can carry them.
 *   - Models cover every PeriodicInventory.tsx SERIES_GROUPS bucket, plus one
 *     deliberately generic brand to prove real "Other" units still display
 *     correctly labelled (not silently miscounted).
 *
 * Run: node scripts/generateQuarterSimData.mjs [outDir]
 */
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.argv[2] || 'e2e-screenshots/quarter-simulation');
mkdirSync(OUT_DIR, { recursive: true });

// ── Deterministic PRNG (mulberry32) — same seed always produces the same
//    dataset, so a re-run reproduces exactly, and ground truth stays stable. ──
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260728);
const pick = arr => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => Math.floor(min + rand() * (max - min + 1));
const chance = p => rand() < p;

// ── Shape of the simulated business ─────────────────────────────────────────
//
// Every knob is an env var whose DEFAULT reproduces the original 90-day
// quarter dataset exactly — a re-run with no env set is byte-identical, so
// the quarter simulation and its ground truth are untouched by these.
//
//   SIM_DAYS            length of the window
//   SIM_INTAKE_PER_DAY  units bought per day
//   SIM_SALES_PER_DAY   units sold per day. Set → the run sells exactly this
//                       many per day, drawn from stock actually on the shelf
//                       that day. Unset → the original sell-through model
//                       (a % of each unit's own odds, days after its intake).
//   SIM_OPENING_STOCK   units already on the shelf the day the window opens.
//                       Needed whenever sales/day exceeds intake/day, which is
//                       a stock RUN-DOWN — the case the sales team's "what can
//                       I list" panels have to survive.
//   SIM_END_DATE        last day of the window (yyyy-mm-dd)
const num = (name, dflt) => {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${v}"`);
  return n;
};
const DAYS = num('SIM_DAYS', 90);
const INTAKE_PER_DAY = num('SIM_INTAKE_PER_DAY', 20);
const SALES_PER_DAY = process.env.SIM_SALES_PER_DAY ? num('SIM_SALES_PER_DAY', 0) : null;
const OPENING_STOCK = num('SIM_OPENING_STOCK', 0);
const END_DATE = new Date(`${process.env.SIM_END_DATE || '2026-07-28'}T00:00:00Z`);
const START_DATE = new Date(END_DATE.getTime() - (DAYS - 1) * 86400000);
const isoDate = d => d.toISOString().slice(0, 10);
const dateAt = offsetDays => isoDate(new Date(START_DATE.getTime() + offsetDays * 86400000));

// ── Models — one (or more) per PeriodicInventory SERIES_GROUPS bucket ───────
// bpRange = buy price range; appleSerial = uses alphanumeric serial not IMEI.
const MODELS = [
  { series: 'iPhone',        model: 'iPhone 13',              storages: ['128GB', '256GB'],  bpRange: [280, 340], appleSerial: true },
  { series: 'iPhone',        model: 'iPhone 14 Pro',           storages: ['128GB', '256GB'],  bpRange: [520, 620], appleSerial: true },
  { series: 'iPad',          model: 'iPad 9th Gen',            storages: ['64GB', '256GB'],   bpRange: [180, 260], appleSerial: true },
  { series: 'Apple Watch',   model: 'Watch Series 9 45mm GPS', storages: [],                  bpRange: [220, 300], appleSerial: true },
  { series: 'Apple Watch',   model: 'Watch SE 40mm GPS',       storages: [],                  bpRange: [150, 210], appleSerial: true },
  { series: 'MacBook',       model: 'MacBook Air M2',          storages: ['256GB'],           bpRange: [650, 780], appleSerial: true },
  { series: 'Galaxy S',      model: 'Galaxy S22',              storages: ['128GB', '256GB'],  bpRange: [260, 340], appleSerial: false },
  { series: 'Galaxy S',      model: 'S23 Ultra',               storages: ['256GB'],           bpRange: [480, 560], appleSerial: false },
  { series: 'Galaxy A',      model: 'Galaxy A54',              storages: ['128GB'],           bpRange: [140, 180], appleSerial: false },
  { series: 'Galaxy A',      model: 'A14 5G',                  storages: ['64GB', '128GB'],   bpRange: [100, 140], appleSerial: false },
  { series: 'Galaxy Note',   model: 'Note 20 Ultra',           storages: ['256GB'],           bpRange: [320, 380], appleSerial: false },
  { series: 'Galaxy Z',      model: 'Z Flip5',                 storages: ['256GB'],           bpRange: [420, 480], appleSerial: false },
  { series: 'Galaxy M',      model: 'M53',                     storages: ['128GB'],           bpRange: [150, 190], appleSerial: false },
  { series: 'Galaxy XCover', model: 'X Cover 6 Pro',            storages: ['128GB'],           bpRange: [220, 260], appleSerial: false },
  { series: 'Galaxy Tab',    model: 'Galaxy Tab A9',           storages: ['64GB', '128GB'],   bpRange: [90, 140],  appleSerial: true }, // TAB* unlocks serial family
  { series: 'Pixel',         model: 'Pixel 8',                 storages: ['128GB', '256GB'],  bpRange: [300, 380], appleSerial: false },
  // Deliberately generic/unclassifiable — proves a real "Other"-brand unit
  // still shows up correctly (as "Unclassified"), not silently miscounted.
  { series: 'Other',         model: 'AcmeMobile ZX200',         storages: ['64GB'],            bpRange: [60, 90],   appleSerial: false },
];

const SUPPLIERS = ['IMAX', 'NIHAL', 'MHL', 'GLOBALTECH', 'PRIME MOBILE'];
const GRADES = ['A', 'A', 'B', 'B', 'C', 'Brand new'];
const COLOURS = ['Black', 'White', 'Blue', 'Silver', 'Green', 'Graphite', 'Midnight'];
const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'];
// ── IMEI generation ──────────────────────────────────────────────────────────
let imeiCounter = 350000000000000n;
function nextImei() {
  imeiCounter += 1n;
  return imeiCounter.toString();
}
const SERIAL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
let serialCounter = 0;
function nextSerial() {
  serialCounter += 1;
  const base = serialCounter.toString(36).toUpperCase().padStart(6, '0');
  return `SN${base}${SERIAL_CHARS[serialCounter % SERIAL_CHARS.length]}${SERIAL_CHARS[(serialCounter * 7) % SERIAL_CHARS.length]}${SERIAL_CHARS[(serialCounter * 13) % SERIAL_CHARS.length]}`.slice(0, 11);
}

// ── Accessories ──────────────────────────────────────────────────────────────
const ACCESSORIES = [
  { sku: 'USB-C-20W', name: 'USB-C 20W Charger', bp: 3.50, supplier: 'IMAX' },
  { sku: 'USB-C-25W', name: 'USB-C 25W Charger', bp: 4.25, supplier: 'IMAX' },
  { sku: 'SIM-PIN-01', name: 'SIM Eject Pin', bp: 0.15, supplier: 'NIHAL' },
  { sku: 'SCR-PROT-UNI', name: 'Universal Screen Protector', bp: 0.80, supplier: 'MHL' },
  { sku: 'CBL-USBC-1M', name: 'USB-C to USB-C Cable 1m', bp: 1.90, supplier: 'GLOBALTECH' },
  { sku: 'CASE-CLR-UNI', name: 'Clear Silicone Case', bp: 1.20, supplier: 'PRIME MOBILE' },
];

// ══════════════════════════════════════════════════════════════════════════
// Generate office + SHS intake, 20/day office + ~2/day SHS, over 90 days
// ══════════════════════════════════════════════════════════════════════════
const officeUnits = [];
const shsUnits = [];

/** One unit bought on `dIn`. Split out of the intake loop so opening stock
 *  and daily intake mint units the same way — a second copy of this is how
 *  the two would drift apart. */
function mintUnit(dIn, m = pick(MODELS)) {
  const storage = m.storages.length ? pick(m.storages) : '';
  const bp = int(m.bpRange[0], m.bpRange[1]);
  const isShs = chance(0.09); // ~9% of intake goes SHS (supplier-held)
  const rec = {
    model: m.model, series: m.series, storage,
    grade: pick(GRADES), colour: pick(COLOURS),
    supplier: pick(SUPPLIERS), bp, dateIn: dIn,
    imei: isShs ? '' : (m.appleSerial ? nextSerial() : nextImei()),
    appleSerial: m.appleSerial,
    stockType: isShs ? 'SHS' : 'OFFICE',
  };
  if (isShs) shsUnits.push(rec); else officeUnits.push(rec);
  return rec;
}

// Opening stock — bought the day before the window opens, so day 1 has
// something to sell. Without it a run-down month (sales > intake) would sell
// units that do not exist yet.
const OPENING_DATE = isoDate(new Date(START_DATE.getTime() - 86400000));
for (let i = 0; i < OPENING_STOCK; i++) mintUnit(OPENING_DATE);

for (let day = 0; day < DAYS; day++) {
  const dIn = dateAt(day);
  for (let i = 0; i < INTAKE_PER_DAY; i++) mintUnit(dIn);
}

/**
 * The long tail — models stocked one or two at a time.
 *
 * Without it nothing ever runs out. The main catalog is picked uniformly, so
 * 1,900 units across ~28 model+storage buckets leaves ~68 in each and not one
 * of them empties. That made a month-long run display the intake team's
 * "Sold Out · Reorder" panel without ever putting a line in it — the panel
 * they act on most was shown, not proven.
 *
 * These arrive in ones and twos and are dated early, so the sell queue drains
 * them: some buckets end at zero (sold out, reorder) and some at one or two
 * (running low). Off by default, so the 90-day quarter dataset is unchanged.
 */
const TAIL_CATALOG = [
  { series: 'iPhone',      model: 'iPhone SE 2022',   storages: ['64GB'],   bpRange: [120, 160], appleSerial: true },
  { series: 'iPhone',      model: 'iPhone 12 mini',   storages: ['128GB'],  bpRange: [180, 220], appleSerial: true },
  { series: 'Galaxy A',    model: 'Galaxy A34',       storages: ['128GB'],  bpRange: [130, 170], appleSerial: false },
  { series: 'Galaxy S',    model: 'Galaxy S21 FE',    storages: ['128GB'],  bpRange: [200, 250], appleSerial: false },
  { series: 'Pixel',       model: 'Pixel 7a',         storages: ['128GB'],  bpRange: [230, 280], appleSerial: false },
  { series: 'Galaxy Tab',  model: 'Galaxy Tab S6 Lite', storages: ['64GB'], bpRange: [110, 150], appleSerial: true },
  { series: 'Apple Watch', model: 'Watch Series 7 41mm GPS', storages: [],  bpRange: [160, 200], appleSerial: true },
  { series: 'Other',       model: 'AcmeMobile QX10',  storages: ['64GB'],   bpRange: [50, 80],   appleSerial: false },
];
const TAIL_MODELS = num('SIM_TAIL_MODELS', 0);
for (let i = 0; i < TAIL_MODELS; i++) {
  const spec = TAIL_CATALOG[i % TAIL_CATALOG.length];
  const qty = int(1, 4);
  // Early in the window, so the queue reaches them and they genuinely run out
  // rather than sitting on the shelf because the month ended first.
  const day = int(0, Math.max(0, Math.floor(DAYS / 3)));
  for (let q = 0; q < qty; q++) mintUnit(dateAt(day), spec);
}

// ══════════════════════════════════════════════════════════════════════════
// Sell-through — ~92% of office units, ~70% of SHS units (SHS sells slower —
// supplier has to ship), spread 1-21 days after intake, across marketplaces.
//
// Returns are deliberately NOT baked into this bulk file. Baking Return
// Date/Outcome columns into a FRESH upload (no accompanying Returns Detail
// sheet) voids the Sale doc correctly but leaves the linked InventoryUnit
// stuck at status='sold' forever (restoreUnitReturnFromImport only runs when
// a Returns Detail row supplies a returnType — see SalesReportImport.tsx's
// `returnsNeedingType` bucket) — an ambiguous, only-half-processed state that
// doesn't match how returns actually happen in this app. Real returns are a
// LIVE action (ProcessReturnModal's two-step QC/CRM flow), so the master
// simulation script processes a representative, clean sample of real
// returns live instead — every return in this dataset is either "not
// returned" or "returned all the way through the real flow," never stuck
// in between. `returnCandidate` flags a subset of sold units the live
// script will pick from.
// ══════════════════════════════════════════════════════════════════════════
const sales = []; // { marketplace, orderNumber, sku, imei, supplier, quantity, bp, sp, saleDate }
let orderSeq = 1;
function nextOrderNumber(mp) {
  orderSeq += 1;
  return `SIM-${mp}-${String(orderSeq).padStart(6, '0')}`;
}
function saleDateFor(dIn, maxOffsetDays) {
  const offset = int(1, maxOffsetDays);
  const t = new Date(dIn + 'T00:00:00Z').getTime() + offset * 86400000;
  const capped = Math.min(t, END_DATE.getTime());
  return isoDate(new Date(capped));
}
function marginPct() { return 1 + int(15, 45) / 100; } // 15-45% markup over BP

function sellUnit(u, sellThroughRate, maxOffsetDays) {
  if (!chance(sellThroughRate)) { u.sold = false; return; }
  u.sold = true;
  const mp = pick(MARKETPLACES);
  const saleDate = saleDateFor(u.dateIn, maxOffsetDays);
  const sp = Number((u.bp * marginPct()).toFixed(2));
  const sale = {
    marketplace: mp, orderNumber: nextOrderNumber(mp),
    sku: '', imei: u.imei, supplier: u.supplier,
    quantity: 1, bp: u.bp, sp, saleDate,
    paymentMode: mp === 'BM' ? pick(['', 'Klarna', 'PayPal', 'Clear Pay']) : undefined,
    returnCandidate: chance(0.15), // ~15% of sold units are eligible; the
    // live script picks a fixed-size sample from these, not all of them.
  };
  sales.push(sale);
}
/**
 * Sell exactly N units on each day of the window, drawn from what is
 * genuinely on the shelf that morning.
 *
 * The sell-through model above asks each unit "do you sell?" independently,
 * which is fine for a steady quarter but cannot express a RUN-DOWN — 49 out
 * against 40 in, day after day, eating an opening pile. That is the shape the
 * sales team's panels have to survive, so it gets its own model: a queue of
 * units ordered by intake date, oldest first, drained N per day. A unit
 * cannot be sold before the day it arrives, and nothing is sold twice.
 *
 * When stock runs out the day simply sells fewer, and the shortfall is
 * recorded — a silently short month would look like the app losing sales.
 */
function sellFixedPerDay(perDay) {
  const shortfalls = [];
  // OFFICE stock only, oldest intake first.
  //
  // SHS is deliberately never bulk-sold here. A supplier-held unit has no
  // IMEI until the sale stamps one, so a bulk Sales Report row for it carries
  // a blank IMEI and imports as an ORPHAN needing manual completion. That is
  // a real flow with its own script (e2eOrphanCompletion), but mixing it in
  // would put hundreds of half-finished units into the very panels this run
  // exists to measure. SHS units stay on the books as supplier-held stock,
  // which is exactly what the sales team needs to see when deciding what can
  // be listed.
  const queue = officeUnits.slice().sort((a, b) => a.dateIn.localeCompare(b.dateIn));
  let cursor = 0;
  for (let day = 0; day < DAYS; day++) {
    const saleDate = dateAt(day);
    let soldToday = 0;
    while (soldToday < perDay) {
      // Skip past anything already sold, and stop at stock that has not
      // arrived yet rather than selling from the future.
      let idx = cursor;
      while (idx < queue.length && queue[idx].sold) idx++;
      if (idx >= queue.length || queue[idx].dateIn > saleDate) break;
      const u = queue[idx];
      cursor = idx;
      u.sold = true;
      const mp = pick(MARKETPLACES);
      const sp = Number((u.bp * marginPct()).toFixed(2));
      sales.push({
        marketplace: mp, orderNumber: nextOrderNumber(mp),
        sku: '', imei: u.imei, supplier: u.supplier,
        quantity: 1, bp: u.bp, sp, saleDate,
        paymentMode: mp === 'BM' ? pick(['', 'Klarna', 'PayPal', 'Clear Pay']) : undefined,
        returnCandidate: chance(0.15),
      });
      soldToday++;
    }
    if (soldToday < perDay) shortfalls.push({ date: saleDate, sold: soldToday, wanted: perDay });
  }
  for (const u of queue) if (!u.sold) u.sold = false;
  return shortfalls;
}

let salesShortfalls = [];
if (SALES_PER_DAY !== null) {
  salesShortfalls = sellFixedPerDay(SALES_PER_DAY);
} else {
  for (const u of officeUnits) sellUnit(u, 0.92, 21);
  for (const u of shsUnits) sellUnit(u, 0.70, 28);
}

// ══════════════════════════════════════════════════════════════════════════
// Accessories — topped up every ~2 weeks, sold at a steady clip, ~5% return.
// ══════════════════════════════════════════════════════════════════════════
const accessoryTopups = []; // { sku, name, supplier, bp, addedOn, qty }
const accessorySales = [];  // same Sale shape as `sales`, sku set, imei blank
const accessoryRunning = {}; // sku -> running quantity available (for realistic sell-through)
for (const a of ACCESSORIES) accessoryRunning[a.sku] = 0;

for (let day = 0; day < DAYS; day += 14) {
  const dIn = dateAt(day);
  for (const a of ACCESSORIES) {
    const qty = int(30, 60);
    accessoryTopups.push({ sku: a.sku, name: a.name, supplier: a.supplier, bp: a.bp, addedOn: dIn, qty });
    accessoryRunning[a.sku] += qty;
  }
}
// Sell-through: for each topup, spread sales of ~85% of that batch across the
// following ~13 days, each line 1-4 units, across marketplaces.
for (const topup of accessoryTopups) {
  let remaining = Math.round(topup.qty * 0.85);
  let cursor = 0;
  while (remaining > 0 && cursor < 13) {
    const mp = pick(MARKETPLACES);
    // ONBUY's schema has no Quantity column at all (always implicitly 1) —
    // a multi-unit accessory line there would have its BP/SP reflect N
    // units while the parser defaults quantity to 1, silently drifting the
    // pool decrement out of step with the GP figures. Cap to a single unit
    // per line on that marketplace only.
    const lineQty = mp === 'ONBUY' ? 1 : Math.min(remaining, int(1, 4));
    const saleDate = isoDate(new Date(Math.min(
      new Date(topup.addedOn + 'T00:00:00Z').getTime() + int(0, 13) * 86400000,
      END_DATE.getTime(),
    )));
    const sp = Number((topup.bp * lineQty * marginPct()).toFixed(2));
    const bpTotal = Number((topup.bp * lineQty).toFixed(2));
    const sale = {
      marketplace: mp, orderNumber: nextOrderNumber(mp),
      sku: topup.sku, imei: '', supplier: topup.supplier,
      quantity: lineQty, bp: bpTotal, sp, saleDate,
      paymentMode: mp === 'BM' ? pick(['', 'Klarna', 'PayPal']) : undefined,
      returnCandidate: chance(0.15), // same "live return only" convention as unit sales
    };
    accessorySales.push(sale);
    remaining -= lineQty;
    cursor++;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Write INVENTORY_REPORT_SIM.xlsx — INVENTORY sheet (office+SHS) + Accessories
// ══════════════════════════════════════════════════════════════════════════
async function buildInventoryWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INVENTORY');
  ws.addRow(['Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage', 'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes']);
  const allIntake = [...officeUnits, ...shsUnits];
  for (const u of allIntake) {
    ws.addRow([
      u.dateIn, u.model, u.imei, u.grade, u.storage || 'Not Applicable',
      u.appleSerial ? 'Not Applicable' : 'Physical SIM', u.colour, u.supplier,
      u.bp, u.stockType, '',
    ]);
  }
  const accSheet = wb.addWorksheet('Accessories');
  accSheet.addRow(['SKU', 'Name', 'Supplier', 'Total Added', 'BP', 'Notes']);
  const totalAddedBySku = {};
  for (const t of accessoryTopups) totalAddedBySku[t.sku] = (totalAddedBySku[t.sku] || 0) + t.qty;
  for (const a of ACCESSORIES) {
    accSheet.addRow([a.sku, a.name, a.supplier, totalAddedBySku[a.sku] || 0, a.bp, '']);
  }
  const file = resolve(OUT_DIR, 'INVENTORY_REPORT_SIM.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

// ══════════════════════════════════════════════════════════════════════════
// Write SALES_REPORT_SIM.xlsx — one sheet per marketplace, matching each
// marketplace's exact import column layout + trailing return columns.
// ══════════════════════════════════════════════════════════════════════════
const MARKETPLACE_LAYOUT = {
  AMAZON: ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'],
  BM:     ['Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'Payment Mode'],
  EBAY:   ['DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS', 'BP', 'SP'],
  ONBUY:  ['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP'], // no Quantity
  TEMU:   ['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP'],
};

function rowFor(mp, s) {
  switch (mp) {
    case 'AMAZON':
    case 'TEMU':
    case 'EBAY':
      return [s.saleDate, s.orderNumber, s.sku, s.imei, s.supplier, s.quantity, s.bp, s.sp];
    case 'BM':
      return [s.saleDate, s.orderNumber, s.sku, s.imei, s.supplier, s.quantity, s.bp, s.sp, s.paymentMode || ''];
    case 'ONBUY':
      return [s.saleDate, s.orderNumber, s.sku, s.imei, s.supplier, s.bp, s.sp];
  }
}

async function buildSalesWorkbook() {
  const wb = new ExcelJS.Workbook();
  const allSales = [...sales, ...accessorySales];
  const byMarketplace = {};
  for (const mp of MARKETPLACES) byMarketplace[mp] = [];
  for (const s of allSales) byMarketplace[s.marketplace].push(s);
  for (const mp of MARKETPLACES) {
    const ws = wb.addWorksheet(mp);
    ws.addRow(MARKETPLACE_LAYOUT[mp]);
    for (const s of byMarketplace[mp]) ws.addRow(rowFor(mp, s));
  }
  const file = resolve(OUT_DIR, 'SALES_REPORT_SIM.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function run() {
  const invFile = await buildInventoryWorkbook();
  const salesFile = await buildSalesWorkbook();

  const totalOfficeSold = officeUnits.filter(u => u.sold).length;
  const totalShsSold = shsUnits.filter(u => u.sold).length;
  const returnCandidates = sales.filter(s => s.returnCandidate).length;
  const accReturnCandidates = accessorySales.filter(s => s.returnCandidate).length;

  const manifest = {
    generatedAt: new Date().toISOString(),
    startDate: isoDate(START_DATE),
    endDate: isoDate(END_DATE),
    days: DAYS,
    // The shape this dataset was generated at, so an audit script can state
    // what it is measuring instead of assuming the 90-day defaults.
    shape: {
      intakePerDay: INTAKE_PER_DAY,
      salesPerDay: SALES_PER_DAY,
      openingStock: OPENING_STOCK,
      openingDate: OPENING_DATE,
      /** Days that could not fill their quota because stock ran out. Empty is
       *  the healthy case; entries mean the month outsold what it bought. */
      salesShortfalls,
    },
    files: { inventory: invFile, sales: salesFile },
    counts: {
      officeIntake: officeUnits.length,
      shsIntake: shsUnits.length,
      officeSold: totalOfficeSold,
      shsSold: totalShsSold,
      unitReturnCandidates: returnCandidates,
      accessorySkus: ACCESSORIES.length,
      accessoryTotalAdded: accessoryTopups.reduce((s, t) => s + t.qty, 0),
      accessorySalesLines: accessorySales.length,
      accessoryReturnCandidates: accReturnCandidates,
    },
    models: MODELS.map(m => ({ series: m.series, model: m.model })),
    suppliers: SUPPLIERS,
    accessories: ACCESSORIES,
    officeUnits, shsUnits, sales, accessoryTopups, accessorySales,
  };
  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('Quarter simulation data generated:');
  console.log(`  Office intake: ${officeUnits.length} (sold ${totalOfficeSold})`);
  console.log(`  SHS intake:    ${shsUnits.length} (sold ${totalShsSold})`);
  console.log(`  Unit sales:    ${sales.length} (${returnCandidates} eligible for a live return)`);
  console.log(`  Accessory SKUs: ${ACCESSORIES.length}, total added ${manifest.counts.accessoryTotalAdded}`);
  console.log(`  Accessory sales lines: ${accessorySales.length} (${accReturnCandidates} eligible for a live return)`);
  console.log(`  Files: ${invFile}`);
  console.log(`         ${salesFile}`);
  console.log(`         ${resolve(OUT_DIR, 'manifest.json')}`);
}

run().catch(e => { console.error(e); process.exit(1); });
