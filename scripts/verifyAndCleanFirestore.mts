/**
 * scripts/verifyAndCleanFirestore.mts
 *
 * Post-load admin maintenance:
 *   1. Sample 5 sales per marketplace, print SP/BP/GP so we can SEE the
 *      parser fix landed and no row is silently £0.
 *   2. Find inventoryAggregates orphaned from older import batches (their
 *      synthetic ids accumulate because we don't upsert by stable key);
 *      delete those that aren't from the LATEST inventory batch id.
 *   3. Find inventoryUnits with unparseable id (fallback `unit_<row>` from
 *      old loader runs); delete them.
 *
 * Run with: npx tsx scripts/verifyAndCleanFirestore.mts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const KEY = resolve(process.cwd(), 'firebase-service-account.json');
const DATABASE_ID = 'ai-studio-730514a8-180c-42b9-8106-b9f5b89691b9';

const svc = JSON.parse(readFileSync(KEY, 'utf8'));
const app = initializeApp({ credential: cert(svc) });
const db = getFirestore(app, DATABASE_ID);
db.settings({ ignoreUndefinedProperties: true });

console.log('▸ Firestore admin connected · project', svc.project_id);
console.log('');

// ── 1. Verify sales numbers ─────────────────────────────────────────────────
console.log('▸ Sample sales SP/BP/GP per marketplace (5 each)');
const MARKETS = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'PROJECT'] as const;
let totalZeroSP = 0;
for (const m of MARKETS) {
  const snap = await db.collection('sales').where('marketplace', '==', m).limit(5).get();
  console.log(`  ${m}:`);
  for (const d of snap.docs) {
    const s = d.data();
    if (!s.salePrice || s.salePrice === 0) totalZeroSP++;
    console.log(`    ${d.id.padEnd(35)} SP=£${(s.salePrice ?? 0).toFixed(2)} BP=£${(s.buyPrice ?? 0).toFixed(2)} GP=£${(s.grossProfit ?? 0).toFixed(2)}`);
  }
}
console.log(`  → ${totalZeroSP === 0 ? '✓' : '⚠'} ${totalZeroSP} rows with SP=£0 in the sampled 25 rows`);
console.log('');

// Wider scan: count zero-SP rows across the full sales collection
console.log('▸ Full-collection zero-SP audit');
const allSales = await db.collection('sales').get();
const zeroSP = allSales.docs.filter(d => !d.data().salePrice || d.data().salePrice === 0);
const zeroBP = allSales.docs.filter(d => !d.data().buyPrice || d.data().buyPrice === 0);
console.log(`  ${allSales.size} sales · ${zeroSP.length} with SP=£0 · ${zeroBP.length} with BP=£0`);
console.log('');

// ── 2. Identify the latest inventory + sales batches ────────────────────────
console.log('▸ Identifying latest import batches');
const batches = await db.collection('importBatches')
  .orderBy('importedAt', 'desc')
  .limit(10)
  .get();
console.log(`  ${batches.size} recent batches:`);
let latestInvBatchId: string | null = null;
let latestSalesBatchId: string | null = null;
for (const d of batches.docs) {
  const b = d.data();
  console.log(`    ${d.id}  ${b.sourceFile}  rows=${b.rowCount}`);
  if (!latestInvBatchId && /INVENTORY_REPORT/.test(b.sourceFile || '')) latestInvBatchId = d.id;
  if (!latestSalesBatchId && /SALES_REPORT/.test(b.sourceFile || '')) latestSalesBatchId = d.id;
}
console.log(`  → latest inventory batch: ${latestInvBatchId}`);
console.log(`  → latest sales batch:    ${latestSalesBatchId}`);
console.log('');

// ── 3. Cleanup duplicate aggregates ─────────────────────────────────────────
console.log('▸ Cleaning inventoryAggregates orphaned from older batches');
const aggs = await db.collection('inventoryAggregates').get();
const orphanAggs = aggs.docs.filter(d => {
  const b = d.data().importBatchId;
  return latestInvBatchId && b && b !== latestInvBatchId;
});
console.log(`  ${aggs.size} total aggregates · ${orphanAggs.length} orphaned`);
if (orphanAggs.length > 0) {
  const BATCH = 400;
  for (let i = 0; i < orphanAggs.length; i += BATCH) {
    const chunk = orphanAggs.slice(i, i + BATCH);
    const wb = db.batch();
    for (const d of chunk) wb.delete(d.ref);
    await wb.commit();
    process.stdout.write(`  ↳ deleted ${Math.min(i + BATCH, orphanAggs.length)}/${orphanAggs.length}\r`);
  }
  console.log(`\n  ✓ removed ${orphanAggs.length} orphaned aggregates`);
}
console.log('');

// ── 4. Cleanup synthetic / orphaned inventoryUnits ──────────────────────────
console.log('▸ Cleaning legacy inventoryUnits with id prefix `unit_` (no IMEI capture)');
const allUnits = await db.collection('inventoryUnits').get();
const synthetic = allUnits.docs.filter(d => /^unit_\d+$/.test(d.id));
console.log(`  ${allUnits.size} total units · ${synthetic.length} synthetic placeholders`);
if (synthetic.length > 0) {
  const BATCH = 400;
  for (let i = 0; i < synthetic.length; i += BATCH) {
    const chunk = synthetic.slice(i, i + BATCH);
    const wb = db.batch();
    for (const d of chunk) wb.delete(d.ref);
    await wb.commit();
    process.stdout.write(`  ↳ deleted ${Math.min(i + BATCH, synthetic.length)}/${synthetic.length}\r`);
  }
  console.log(`\n  ✓ removed ${synthetic.length} synthetic placeholders`);
}

// ── 5. Final counts ─────────────────────────────────────────────────────────
console.log('');
console.log('▸ Final collection counts:');
for (const c of ['importBatches', 'suppliers', 'inventoryUnits', 'inventoryAggregates', 'supplierWhatsappUpdates', 'sales']) {
  const s = await db.collection(c).count().get();
  console.log(`    ${c.padEnd(28)} ${s.data().count}`);
}

console.log('\n✓ verify + clean complete');
process.exit(0);
