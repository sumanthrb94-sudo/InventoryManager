/**
 * scripts/findDuplicates.mts
 *
 * Scans the client master Excel files and reports every place where the
 * Firestore loader / importer will collapse rows via its dedup keys:
 *   inventoryUnits  → doc id = IMEI (alphanumeric ok)
 *   sales           → doc id = `${marketplace}__${orderNumber}`
 *   suppliers       → resolved by case-insensitive trimmed `name`
 *   inventoryAggrs  → emitted one-per-row, can collide by (model, supplier)
 *
 * Run:  npx tsx scripts/findDuplicates.mts
 */

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../src/lib/salesImport.ts';
import { parseBrandModelStorage } from '../src/lib/modelStorage.ts';

const INV_PATH   = process.env.INV_PATH   ?? '/tmp/INVENTORY_REPORT_2026.xlsx';
const SALES_PATH = process.env.SALES_PATH ?? '/tmp/SALES_REPORT_2026.xlsx';

function bucket<T, K extends string>(items: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of items) {
    const k = key(x);
    const arr = m.get(k);
    if (arr) arr.push(x); else m.set(k, [x]);
  }
  return m;
}

function fmtList(rows: number[]): string {
  return rows.length <= 6 ? rows.join(', ') : `${rows.slice(0, 5).join(', ')}, … (${rows.length} total)`;
}

console.log('▸ Reading master files…\n');
const invBuf   = readFileSync(INV_PATH);
const salesBuf = readFileSync(SALES_PATH);
const wb = XLSX.read(invBuf, { type: 'buffer', raw: true, cellText: true, cellDates: true });

// ───────────────────────────────────────────────────────────────────────────
// 1. IMEI duplicates (IMEI NUMBERS sheet)
// ───────────────────────────────────────────────────────────────────────────

const imeiSheet = wb.Sheets['IMEI NUMBERS'];
const imeiRows = XLSX.utils.sheet_to_json<any[]>(imeiSheet, { header: 1, defval: '' });
type ImeiRow = { row: number; imei: string; model: string; supplier: string; status: string };
const imeiData: ImeiRow[] = [];
for (let r = 1; r < imeiRows.length; r++) {
  const row = imeiRows[r] ?? [];
  const rawImei = row[2];
  const imei = rawImei == null ? '' : (typeof rawImei === 'number' ? rawImei.toFixed(0) : String(rawImei).trim());
  if (!imei) continue;
  imeiData.push({
    row: r + 1,
    imei,
    model: String(row[1] ?? '').trim(),
    supplier: String(row[5] ?? '').trim(),
    status: String(row[7] ?? '').trim(),
  });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('1. DUPLICATE IMEIs in IMEI NUMBERS sheet');
console.log('   (loader will collapse to one Firestore doc per IMEI)');
console.log('═══════════════════════════════════════════════════════════════');
const imeiBuckets = bucket(imeiData, x => x.imei as any);
const imeiDupes = [...imeiBuckets.entries()].filter(([, rs]) => rs.length > 1);
console.log(`Found ${imeiDupes.length} IMEIs that appear more than once (out of ${imeiBuckets.size} unique IMEIs / ${imeiData.length} rows).\n`);
for (const [imei, rs] of imeiDupes.slice(0, 30)) {
  console.log(`  IMEI ${imei}  ×${rs.length}  rows ${rs.map(r => r.row).join(', ')}`);
  for (const r of rs) {
    console.log(`     row ${r.row}: ${r.model.padEnd(40)} · ${r.supplier.padEnd(12)} · ${r.status}`);
  }
}
if (imeiDupes.length > 30) console.log(`  … and ${imeiDupes.length - 30} more.`);

// ───────────────────────────────────────────────────────────────────────────
// 2. Sales (marketplace, orderNumber) duplicates
// ───────────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('2. DUPLICATE (marketplace, orderNumber) in SALES sheets');
console.log('   (loader collapses to one Firestore doc per composite id)');
console.log('═══════════════════════════════════════════════════════════════');
const ab = salesBuf.buffer.slice(salesBuf.byteOffset, salesBuf.byteOffset + salesBuf.byteLength);
const parsedSales = await parseSalesWorkbook(ab as ArrayBuffer, 'SALES_REPORT_2026.xlsx');
const saleBuckets = bucket(parsedSales.sales, s => `${s.marketplace}__${s.orderNumber}` as any);
const saleDupes = [...saleBuckets.entries()].filter(([, rs]) => rs.length > 1);
console.log(`Found ${saleDupes.length} composite ids that appear more than once (out of ${saleBuckets.size} unique / ${parsedSales.sales.length} rows).\n`);
for (const [key, rs] of saleDupes.slice(0, 30)) {
  console.log(`  ${key}  ×${rs.length}`);
  for (const s of rs) {
    console.log(`     SP £${s.salePrice}  BP £${s.buyPrice}  IMEI ${s.imei || '—'}  date ${s.saleDate}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Supplier-name variants (case / whitespace / punctuation)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('3. SUPPLIER NAMES that differ only by case / whitespace / "/"');
console.log('   (loader case-insensitively dedupes against existing suppliers/)');
console.log('═══════════════════════════════════════════════════════════════');
const allSupplierNames = new Set<string>();
for (const r of imeiData) {
  // Split on / so "MHL / ABC / NIHAL" yields 3 names
  for (const n of r.supplier.split('/').map(s => s.trim()).filter(Boolean)) {
    allSupplierNames.add(n);
  }
}
const invSheet = wb.Sheets['INVENTORY'];
if (invSheet) {
  const invRows = XLSX.utils.sheet_to_json<any[]>(invSheet, { header: 1, defval: '' });
  for (let r = 1; r < invRows.length; r++) {
    const sup = String(invRows[r]?.[6] ?? '').trim();
    for (const n of sup.split('/').map(s => s.trim()).filter(Boolean)) {
      allSupplierNames.add(n);
    }
  }
}
const supByNorm = bucket([...allSupplierNames], n => n.toLowerCase().replace(/\s+/g, ' ') as any);
const supDupes = [...supByNorm.entries()].filter(([, vs]) => vs.length > 1);
console.log(`${allSupplierNames.size} distinct supplier-name spellings across both sheets.\n`);
if (supDupes.length === 0) {
  console.log('  No case/whitespace variants found — every supplier name is unique even before normalisation.');
} else {
  for (const [norm, variants] of supDupes) {
    console.log(`  normalised "${norm}":  variants = ${variants.map(v => JSON.stringify(v)).join(', ')}`);
  }
}
console.log(`\n  All supplier names:  ${[...allSupplierNames].sort().join(' · ')}`);

// ───────────────────────────────────────────────────────────────────────────
// 4. INVENTORY-sheet aggregate collisions (same model + same supplier set)
// ───────────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('4. INVENTORY-sheet rows with same (model, supplier-set)');
console.log('   (different rows for the same SKU+supplier — usually a data');
console.log('    quality issue or two-buy records that should merge)');
console.log('═══════════════════════════════════════════════════════════════');
if (invSheet) {
  const invRows = XLSX.utils.sheet_to_json<any[]>(invSheet, { header: 1, defval: '' });
  type AggRow = { row: number; model: string; supplier: string; qtyRaw: any; bp: any };
  const aggData: AggRow[] = [];
  for (let r = 1; r < invRows.length; r++) {
    const row = invRows[r] ?? [];
    const rawModel = String(row[0] ?? '').trim();
    if (!rawModel) continue;
    aggData.push({
      row: r + 1,
      model: rawModel,
      supplier: String(row[6] ?? '').trim(),
      qtyRaw: row[2],
      bp: row[1],
    });
  }
  // Key uses parseBrandModelStorage so "iPad 7 32GB" and "IPAD 7TH GEN 32GB" still differ when they're distinct SKUs.
  const aggBuckets = bucket(aggData, a => {
    const p = parseBrandModelStorage(a.model);
    return `${p.brand}|${p.model.toLowerCase()}|${(p.storage || '').toUpperCase()}|${a.supplier.toLowerCase()}` as any;
  });
  const aggDupes = [...aggBuckets.entries()].filter(([, rs]) => rs.length > 1);
  console.log(`Found ${aggDupes.length} (brand, model, storage, supplier) keys that appear in multiple rows.\n`);
  for (const [key, rs] of aggDupes.slice(0, 20)) {
    console.log(`  ${key}`);
    for (const a of rs) {
      console.log(`     row ${a.row}: qty=${JSON.stringify(a.qtyRaw)}  bp=${a.bp}  raw model="${a.model}"`);
    }
  }
  if (aggDupes.length > 20) console.log(`  … and ${aggDupes.length - 20} more.`);
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Sale rows that have the same IMEI but different orderNumber
// ───────────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('5. SALES with same IMEI sold twice');
console.log('   (could be legitimate returns + resale, or a data error)');
console.log('═══════════════════════════════════════════════════════════════');
const byImei = bucket(parsedSales.sales.filter(s => s.imei), s => s.imei as any);
const imeiSoldTwice = [...byImei.entries()].filter(([, rs]) => rs.length > 1);
console.log(`Found ${imeiSoldTwice.length} IMEIs that appear in more than one sale row.\n`);
for (const [imei, rs] of imeiSoldTwice.slice(0, 15)) {
  console.log(`  IMEI ${imei}  ×${rs.length}`);
  for (const s of rs) {
    console.log(`     ${s.marketplace.padEnd(8)} order ${s.orderNumber}  date ${s.saleDate}  SP £${s.salePrice}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Final summary
// ───────────────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  IMEI sheet rows           : ${imeiData.length}`);
console.log(`  Unique IMEIs              : ${imeiBuckets.size}`);
console.log(`  IMEIs duplicated          : ${imeiDupes.length}  (loader collapses these)`);
console.log('');
console.log(`  Sales rows parsed         : ${parsedSales.sales.length}`);
console.log(`  Unique (marketplace,order): ${saleBuckets.size}`);
console.log(`  Sales collisions          : ${saleDupes.length}  (loader keeps last write)`);
console.log('');
console.log(`  Supplier spellings        : ${allSupplierNames.size}`);
console.log(`  Case/whitespace variants  : ${supDupes.length}`);
console.log('');
console.log(`  Same-IMEI sales rows      : ${imeiSoldTwice.length}`);
