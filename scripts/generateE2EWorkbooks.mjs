/**
 * generateE2EWorkbooks — writes the two SAMPLE .xlsx files the upload E2E
 * drives. Bigger siblings of templates/*.xlsx: same schemas, realistic
 * volume, and deliberately messy in the ways real files are.
 *
 * Both match the schemas the app itself exports, so this exercises the
 * daily round trip the operator actually does: export → edit → re-import.
 *
 *   templates/samples/INVENTORY_REPORT_SAMPLE.xlsx
 *     Stock In Date · Model · IMEI · Grade · Storage · SIM Type ·
 *     Colour · Supplier · BP · Notes           (InventoryReportImport)
 *
 *   templates/samples/SALES_REPORT_SAMPLE.xlsx
 *     AMAZON / BM / EBAY / ONBUY sheets, per-marketplace column order
 *                                              (salesImport SHEET_LAYOUTS)
 *
 * 120 inventory units; 100 sales spread over the four marketplaces. The
 * sales deliberately include shapes that exercise the reconciliation
 * paths: units that should flip to sold, SHS units fulfilled by a sale,
 * orphan sales with no matching unit, and one duplicated order row.
 *
 * Run: node scripts/generateE2EWorkbooks.mjs
 */
import * as XLSX from 'xlsx';
import { mkdirSync, existsSync } from 'node:fs';

const OUT = 'templates/samples';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// Deterministic PRNG so every run produces byte-identical fixtures —
// a screenshot diff should mean the UI changed, not the data.
let seed = 20260725;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const money = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

const MODELS = [
  { model: 'IPHONE 12', storage: '64GB',  bp: [185, 215] },
  { model: 'IPHONE 12', storage: '128GB', bp: [205, 240] },
  { model: 'IPHONE 13', storage: '128GB', bp: [300, 340] },
  { model: 'IPHONE 13 PRO', storage: '256GB', bp: [495, 545] },
  { model: 'IPHONE 14', storage: '256GB', bp: [455, 505] },
  { model: 'SAMSUNG GALAXY S22', storage: '128GB', bp: [225, 265] },
  { model: 'SAMSUNG GALAXY S23', storage: '256GB', bp: [405, 455] },
  { model: 'GOOGLE PIXEL 7', storage: '128GB', bp: [255, 295] },
];
const COLOURS = ['BLACK', 'WHITE', 'BLUE', 'GREEN', 'MIDNIGHT', 'STARLIGHT', 'GRAPHITE', 'PURPLE'];
const GRADES = ['A', 'A+', 'B', 'B+', 'C'];
const SIM = ['Physical SIM', 'eSIM', 'Dual SIM'];
const SUPPLIERS = ['MOBILE WHOLESALE LTD', 'PHONEBOX DIRECT', 'CELLHUB TRADING', 'NORTHSIDE STOCK'];

/** 15-digit IMEIs — the format isValidImei accepts. Sequential so a
 *  failing row is trivial to trace back to its source line. */
const imeiFor = i => `35${String(100000000000 + i * 7919).padStart(13, '0')}`.slice(0, 15);

const dateFor = i => {
  const d = new Date(Date.UTC(2026, 5, 1));       // 2026-06-01 onwards
  d.setUTCDate(d.getUTCDate() + (i % 50));
  return d.toISOString().slice(0, 10);
};

// ── Inventory report ─────────────────────────────────────────────────────────
const INVENTORY_HEADERS = [
  'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
  'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
];

const UNIT_COUNT = 120;
const units = [];
for (let i = 0; i < UNIT_COUNT; i++) {
  const m = MODELS[i % MODELS.length];
  units.push({
    dateIn: dateFor(i),
    model: m.model,
    imei: imeiFor(i),
    grade: pick(GRADES),
    storage: m.storage,
    simType: pick(SIM),
    colour: pick(COLOURS),
    supplier: pick(SUPPLIERS),
    bp: money(m.bp[0], m.bp[1]),
    // Every 12th row is SHS — supplier holds it, no physical stock yet
    stockType: i % 12 === 0 ? 'SHS' : 'OFFICE',
    notes: i % 12 === 0 ? 'Supplier holding — awaiting delivery' : '',
  });
}

const invRows = [
  INVENTORY_HEADERS,
  ...units.map(u => [u.dateIn, u.model, u.imei, u.grade, u.storage, u.simType, u.colour, u.supplier, u.bp, u.stockType, u.notes]),
];
const invWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(invWb, XLSX.utils.aoa_to_sheet(invRows), 'INVENTORY');
XLSX.writeFile(invWb, `${OUT}/INVENTORY_REPORT_SAMPLE.xlsx`);

// ── Sales report ─────────────────────────────────────────────────────────────
// Column order per marketplace comes from salesImport.SHEET_LAYOUTS.
const LAYOUTS = {
  AMAZON: ['nw', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'SP-BP', 'Marginal Tax', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'],
  BM:     ['Date', 'Order No', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP', 'Payment Mode', 'SP-BP', 'Marginal Tax', 'PayPal/Klarna Com', 'Commission', 'Postage', 'GP', 'GP %', 'Comments'],
  EBAY:   ['DATE', 'ORDER NUMBER', 'SKU', 'IMEI NUMBER', 'SUPPLIER', 'UNITS', 'BP', 'SP', 'SP-BP', 'MAR TAX', 'COM', 'ROF', 'FVF', '0.2', 'T.COM', 'SHIPPING', 'GP', 'GP%', 'NP(incl. PROMOTION)'],
  ONBUY:  ['DATE', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'BP', 'SP', 'SP-BP', 'MAR VAT', 'COM 7%', 'VAT 20%', 'SHIP', 'GP', 'GP%', 'Comments'],
};

function salesRow(marketplace, s) {
  const skuOf = u => `${u.model.split(' ')[0].slice(0, 3)}-${u.storage}-${u.colour.slice(0, 3)}`.toUpperCase();
  const sku = skuOf(s.unit);
  switch (marketplace) {
    case 'AMAZON': return [s.date, s.order, sku, s.imei, s.unit.supplier, 1, s.bp, s.sp, s.sp - s.bp, '', '', s.postage, '', '', ''];
    case 'BM':     return [s.date, s.order, sku, s.imei, s.unit.supplier, 1, s.bp, s.sp, pick(['Paypal', 'Klarna', 'Card']), s.sp - s.bp, '', '', '', s.postage, '', '', ''];
    case 'EBAY':   return [s.date, s.order, sku, s.imei, s.unit.supplier, 1, s.bp, s.sp, s.sp - s.bp, '', '', '', '', '', '', s.postage, '', '', ''];
    case 'ONBUY':  return [s.date, s.order, sku, s.imei, s.unit.supplier, s.bp, s.sp, s.sp - s.bp, '', '', '', s.postage, '', '', ''];
    default: throw new Error(`unknown marketplace ${marketplace}`);
  }
}

const SALE_COUNT = 100;
const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY'];
const bySheet = { AMAZON: [], BM: [], EBAY: [], ONBUY: [] };

const saleDate = i => {
  const d = new Date(Date.UTC(2026, 6, 1));       // July 2026
  d.setUTCDate(d.getUTCDate() + (i % 24));
  return d.toISOString().slice(0, 10);
};

for (let i = 0; i < SALE_COUNT; i++) {
  const marketplace = MARKETPLACES[i % MARKETPLACES.length];
  // First 90 sales map onto real inventory units (so they flip to sold);
  // the last 10 are orphans the operator must complete at import time.
  const isOrphan = i >= 90;
  // Skip SHS rows when picking a unit to sell — the E2E asserts SHS
  // survives the sales import as supplier-held stock.
  let unit = units[i % units.length];
  if (unit.stockType === 'SHS') unit = units[(i + 1) % units.length];
  const imei = isOrphan ? imeiFor(900 + i) : unit.imei;
  const bp = unit.bp;
  bySheet[marketplace].push(salesRow(marketplace, {
    date: saleDate(i),
    order: `${marketplace.slice(0, 3)}-${5000 + i}`,
    imei,
    unit,
    bp,
    sp: Math.round((bp * (1.25 + rnd() * 0.25)) * 100) / 100,
    postage: pick([8, 8, 8, 6.3, 2]),
  }));
}

// One duplicated order row — the preview must catch it as a file dupe.
bySheet.AMAZON.push([...bySheet.AMAZON[0]]);

// One sale against a SUPPLIER-HELD unit: the supplier shipped it directly.
// Proves SHS stock drops when a sales report says an SHS phone sold.
const shsUnit = units.find(u => u.stockType === 'SHS');
bySheet.AMAZON.push(salesRow('AMAZON', {
  date: '2026-07-24',
  order: 'AMA-SHS-1',
  imei: shsUnit.imei,
  unit: shsUnit,
  bp: shsUnit.bp,
  sp: Math.round(shsUnit.bp * 1.3 * 100) / 100,
  postage: 8,
}));

const salesWb = XLSX.utils.book_new();
for (const m of MARKETPLACES) {
  XLSX.utils.book_append_sheet(salesWb, XLSX.utils.aoa_to_sheet([LAYOUTS[m], ...bySheet[m]]), m);
}
XLSX.writeFile(salesWb, `${OUT}/SALES_REPORT_SAMPLE.xlsx`);

// ── Per-marketplace sample files ─────────────────────────────────────────────
// One file per channel, the shape marketplaces actually send. Same rows as
// the combined workbook's matching sheet, so a per-channel upload and a
// combined upload produce identical records.
for (const m of MARKETPLACES) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([LAYOUTS[m], ...bySheet[m]]), m);
  XLSX.writeFile(wb, `${OUT}/SALES_${m}_SAMPLE.xlsx`);
}

// ── Returns report reference ────────────────────────────────────────────────
// EXPORT ONLY — there is no returns importer. Returns are created in-app
// through Process Return (Tech-QC → CRM). This file documents the shape the
// app produces so a report can be checked against it.
const RETURNS_HEADERS = [
  'Return Date', 'Unit IMEI', 'Model', 'Storage', 'Colour', 'Supplier',
  'Original Sale Date', 'Original Sale Price', 'Marketplace',
  'Return Type', 'Outcome', 'Reason', 'Comments',
  'Leg Cost £', 'Shipping Legs', 'Postage Loss £',
];
const RETURNS_ROWS = [
  ['2026-07-21', '350100000000000', 'IPHONE 13', '128GB', 'MIDNIGHT', 'MOBILE WHOLESALE LTD',
   '2026-07-15', 425.00, 'AMAZON', 'returned_to_inventory', 'refund', 'Battery health below 85%',
   'QC confirmed 79% — restocked', 9.60, 2, 19.20],
  ['2026-07-22', '350100000015838', 'SAMSUNG GALAXY S22', '128GB', 'GREEN', 'PHONEBOX DIRECT',
   '2026-07-16', 375.00, 'EBAY', 'repair', 'repair', 'Cracked rear glass in transit',
   'QC FAILED — sent to bench', 9.60, 2, 19.20],
  ['2026-07-23', '350100000023757', 'IPHONE 14', '256GB', 'PURPLE', 'CELLHUB TRADING',
   '2026-07-19', 605.00, 'AMAZON', 'returned_to_inventory', 'replacement', 'Face ID intermittent',
   'Replacement shipped from stock', 9.60, 3, 28.80],
];
const returnsWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(returnsWb, XLSX.utils.aoa_to_sheet([RETURNS_HEADERS, ...RETURNS_ROWS]), 'Returns Detail');
XLSX.utils.book_append_sheet(returnsWb, XLSX.utils.aoa_to_sheet([
  ['RETURNS REPORT — reference (EXPORT ONLY)'],
  [],
  ['There is no returns importer. Returns are created in-app via Returns → Process Return'],
  ['(step 1 Tech-QC, step 2 CRM finalise). This file shows the shape the app EXPORTS so a'],
  ['downloaded report can be checked against it.'],
  [],
  ['The live export has three sheets: Summary, Returns Detail, Unit Histories.'],
  ['Return Type', 'returned_to_inventory | repair | returned_to_supplier'],
  ['Outcome', 'refund | replacement | repair'],
  ['Shipping Legs', 'refund and repair = 2 (out + back), replacement = 3 (out + back + replacement out)'],
  ['Postage Loss £', 'Leg Cost × Shipping Legs'],
]), 'README');
XLSX.writeFile(returnsWb, `${OUT}/RETURNS_REPORT_REFERENCE.xlsx`);

const shsCount = units.filter(u => u.stockType === 'SHS').length;
console.log(`inventory: ${units.length} units (${shsCount} tagged SHS) → ${OUT}/INVENTORY_REPORT_E2E.xlsx`);
console.log(`sales:     ${SALE_COUNT} rows + 1 duplicate across ${MARKETPLACES.join('/')} → ${OUT}/SALES_REPORT_E2E.xlsx`);
for (const m of MARKETPLACES) console.log(`  ${m}: ${bySheet[m].length} rows`);
console.log(`orphan sales (no matching unit): 10`);
console.log(`SHS fulfilment: 1 sale against a supplier-held unit`);
for (const m of MARKETPLACES) console.log(`per-channel: ${OUT}/SALES_${m}_SAMPLE.xlsx (${bySheet[m].length} rows)`);
console.log(`returns:    ${OUT}/RETURNS_REPORT_REFERENCE.xlsx (export-only reference)`);
