/**
 * scripts/loadMasterFilesToFirestore.mts
 *
 * Loads the client's two master Excel files into the production Firestore
 * project (`gen-lang-client-0457133744`, database
 * `ai-studio-730514a8-180c-42b9-8106-b9f5b89691b9`) using the Firebase Admin
 * SDK — exercising the SAME parser + data-shape pipeline the UI uses, but
 * from Node so we can prove the audit work end-to-end without a browser.
 *
 * Behaviour:
 *  1. Creates one `importBatches` doc per workbook with a real
 *     serverTimestamp() — B9 + B10 audit trail.
 *  2. Resolves parsed `sup_<slug>` ids against the existing `suppliers`
 *     collection (trimmed lower-case `name`); unmatched names create new
 *     supplier docs on the fly with stable slugs — B7 finish.
 *  3. Bulk-writes inventoryUnits / inventoryAggregates /
 *     supplierWhatsappUpdates / sales — sales using composite doc id
 *     `${marketplace}__${orderNumber}` for natural dedupe — B2 / B3.
 *
 * Run with:
 *   npx tsx scripts/loadMasterFilesToFirestore.mts
 *
 * Env:
 *   FIREBASE_SERVICE_ACCOUNT  path to admin key (defaults to repo root
 *                              firebase-service-account.json — gitignored)
 *   INV_PATH / SALES_PATH     override input files
 *   DRY_RUN=1                 parse + resolve + print plan, skip writes
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

import { parseInventoryWorkbook } from './smokeMasterFiles.mts';
import { parseSalesWorkbook } from '../src/lib/salesImport.ts';
import type { Sale, Supplier } from '../src/types.ts';

const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  resolve(process.cwd(), 'firebase-service-account.json');
const INV_PATH      = process.env.INV_PATH   ?? '/tmp/INVENTORY_REPORT_2026.xlsx';
const SALES_PATH    = process.env.SALES_PATH ?? '/tmp/SALES_REPORT_2026.xlsx';
const DRY_RUN       = process.env.DRY_RUN === '1';
const DATABASE_ID   = 'ai-studio-730514a8-180c-42b9-8106-b9f5b89691b9';
const OWNER_ID      = 'shared';
const BATCH_SIZE    = 400; // Firestore allows 500 writes per batch; stay under for headroom

// ── Firebase Admin init ───────────────────────────────────────────────────

const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
const app = initializeApp({ credential: cert(serviceAccount) });
const db  = getFirestore(app, DATABASE_ID);
// Mirror dbService.cleanForFirestore() — the parsed shapes carry undefined
// optional fields (e.g. supplierIds when there's only one supplier). The web
// SDK accepts these silently; the Admin SDK rejects them unless we opt in.
db.settings({ ignoreUndefinedProperties: true });

console.log(`▸ Firebase Admin initialised`);
console.log(`  project    : ${serviceAccount.project_id}`);
console.log(`  database   : ${DATABASE_ID}`);
console.log(`  dry run    : ${DRY_RUN ? 'YES (no writes)' : 'no'}`);

// ── Helpers ───────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return `sup_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;
}

async function readSuppliers(): Promise<Map<string, { id: string; name: string }>> {
  const snap = await db.collection('suppliers').get();
  const byNorm = new Map<string, { id: string; name: string }>();
  snap.forEach(doc => {
    const data = doc.data();
    const norm = String(data?.name ?? '').trim().toLowerCase();
    if (norm) byNorm.set(norm, { id: doc.id, name: data.name });
  });
  return byNorm;
}

async function bulkWrite(
  entries: Array<{ collection: string; id: string; data: Record<string, any> }>,
  label: string,
): Promise<void> {
  console.log(`▸ Writing ${entries.length} docs → ${label}…`);
  if (DRY_RUN) {
    console.log('  (dry run, skipping)');
    return;
  }
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const wb = db.batch();
    for (const entry of chunk) {
      wb.set(db.collection(entry.collection).doc(entry.id), entry.data, { merge: true });
    }
    await wb.commit();
    process.stdout.write(`  ↳ ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}\r`);
  }
  console.log(`  ↳ done`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('▸ Reading client master files');
  const invBuf   = readFileSync(INV_PATH);
  const salesBuf = readFileSync(SALES_PATH);

  console.log('▸ Parsing INVENTORY workbook');
  const inv = parseInventoryWorkbook(invBuf);
  console.log(`  ↳ ${inv.units.length} units, ${inv.aggregates.length} aggregates, ${inv.whatsapp.length} whatsapp, ${inv.suppliers.length} parsed suppliers`);

  console.log('▸ Parsing SALES workbook');
  const ab = salesBuf.buffer.slice(salesBuf.byteOffset, salesBuf.byteOffset + salesBuf.byteLength);
  const parsedSales = await parseSalesWorkbook(ab as ArrayBuffer, 'SALES_REPORT_2026.xlsx');
  console.log(`  ↳ ${parsedSales.sales.length} sales rows across:`);
  for (const [m, c] of Object.entries(parsedSales.perSheetCounts)) if (c > 0) console.log(`      ${m}: ${c}`);
  if (parsedSales.errors.length) console.log(`  ⚠ ${parsedSales.errors.length} rows skipped`);

  // ── Resolve suppliers against the live Firestore collection ────────────
  console.log('▸ Resolving suppliers against live suppliers/');
  const byNormName = await readSuppliers();
  console.log(`  ↳ ${byNormName.size} existing suppliers in Firestore`);

  // syntheticId → realId
  const idRemap = new Map<string, string>();
  // realId → supplier doc to upsert
  const suppliersToCreate = new Map<string, Omit<Supplier, 'createdAt'>>();

  for (const sup of inv.suppliers) {
    const name = sup.name.trim();
    const norm = name.toLowerCase();
    const existing = norm ? byNormName.get(norm) : undefined;
    if (existing) {
      idRemap.set(sup.id, existing.id);
    } else {
      const realId = slugify(name);
      idRemap.set(sup.id, realId);
      if (!suppliersToCreate.has(realId)) {
        suppliersToCreate.set(realId, {
          id: realId,
          name,
          portal: 'Wholesale',
          ownerId: OWNER_ID,
        });
        byNormName.set(norm, { id: realId, name });
      }
    }
  }
  console.log(`  ↳ ${suppliersToCreate.size} new suppliers will be created`);

  const remapId  = (id: string | undefined) => (id && idRemap.get(id)) || id || '';
  const remapIds = (ids: string[] | undefined) => (ids ?? []).map(remapId).filter(Boolean);

  // ── importBatches docs ──────────────────────────────────────────────────
  const invBatchRef   = db.collection('importBatches').doc();
  const salesBatchRef = db.collection('importBatches').doc();
  const invBatchId   = invBatchRef.id;
  const salesBatchId = salesBatchRef.id;
  console.log(`▸ Batch ids: inventory=${invBatchId} sales=${salesBatchId}`);

  const importedAtServer = FieldValue.serverTimestamp();

  // ── Assemble write payloads ─────────────────────────────────────────────
  const writes: Array<{ collection: string; id: string; data: Record<string, any> }> = [];

  // importBatches
  writes.push({
    collection: 'importBatches',
    id: invBatchId,
    data: {
      id: invBatchId,
      sourceFile: 'INVENTORY_REPORT_2026_1.xlsx',
      sourceSheet: 'INVENTORY + IMEI NUMBERS + SUPPLIER WHATSAPP UPDATES',
      rowCount: inv.units.length + inv.aggregates.length,
      importedBy: 'admin-loader',
      importedAt: importedAtServer,
      notes: `units=${inv.units.length} aggregates=${inv.aggregates.length} whatsapp=${inv.whatsapp.length}`,
      ownerId: OWNER_ID,
    },
  });
  writes.push({
    collection: 'importBatches',
    id: salesBatchId,
    data: {
      id: salesBatchId,
      sourceFile: 'SALES_REPORT_2026.xlsx',
      sourceSheet: 'AMAZON,BM,EBAY,ONBUY,PROJECT',
      rowCount: parsedSales.sales.length,
      importedBy: 'admin-loader',
      importedAt: importedAtServer,
      notes: Object.entries(parsedSales.perSheetCounts).map(([m, c]) => `${m}=${c}`).join(' '),
      ownerId: OWNER_ID,
    },
  });

  // suppliers (new only)
  for (const sup of suppliersToCreate.values()) {
    writes.push({
      collection: 'suppliers',
      id: sup.id,
      data: { ...sup, createdAt: importedAtServer },
    });
  }

  // inventoryUnits — stamped with provenance
  for (const u of inv.units) {
    const id = u.imei || u.id;
    writes.push({
      collection: 'inventoryUnits',
      id,
      data: {
        ...u,
        id,
        supplierId: remapId(u.supplierId),
        supplierIds: u.supplierIds ? remapIds(u.supplierIds) : undefined,
        importBatchId: invBatchId,
        sourceFile: 'INVENTORY_REPORT_2026_1.xlsx',
        importedAt: importedAtServer,
        createdAt: importedAtServer,
        updatedAt: importedAtServer,
        ownerId: OWNER_ID,
      },
    });
  }

  // inventoryAggregates
  for (const a of inv.aggregates) {
    writes.push({
      collection: 'inventoryAggregates',
      id: a.id,
      data: {
        ...a,
        supplierIds: remapIds(a.supplierIds),
        importBatchId: invBatchId,
        sourceFile: 'INVENTORY_REPORT_2026_1.xlsx',
        importedAt: importedAtServer,
        createdAt: importedAtServer,
        updatedAt: importedAtServer,
        ownerId: OWNER_ID,
      },
    });
  }

  // supplierWhatsappUpdates
  for (const w of inv.whatsapp) {
    writes.push({
      collection: 'supplierWhatsappUpdates',
      id: w.id,
      data: {
        ...w,
        postedAt: importedAtServer,
        ownerId: OWNER_ID,
      },
    });
  }

  // sales — composite doc id `${marketplace}__${orderNumber}`
  for (const s of parsedSales.sales as Omit<Sale, 'importBatchId'|'importedAt'|'createdAt'|'updatedAt'|'ownerId'>[]) {
    const id = `${s.marketplace}__${s.orderNumber}`;
    writes.push({
      collection: 'sales',
      id,
      data: {
        ...s,
        id,
        importBatchId: salesBatchId,
        sourceFile: 'SALES_REPORT_2026.xlsx',
        importedAt: importedAtServer,
        createdAt: importedAtServer,
        updatedAt: importedAtServer,
        ownerId: OWNER_ID,
      },
    });
  }

  console.log(`▸ Total ${writes.length} docs to write`);
  const byCol: Record<string, number> = {};
  for (const w of writes) byCol[w.collection] = (byCol[w.collection] ?? 0) + 1;
  for (const [c, n] of Object.entries(byCol)) console.log(`    ${c}: ${n}`);

  await bulkWrite(writes, 'Firestore');

  // ── Verify by querying a few docs back ──────────────────────────────────
  if (!DRY_RUN) {
    console.log('▸ Verifying writes by reading back');
    const counts: Record<string, number> = {};
    for (const c of ['importBatches', 'suppliers', 'inventoryUnits', 'inventoryAggregates', 'supplierWhatsappUpdates', 'sales']) {
      const s = await db.collection(c).count().get();
      counts[c] = s.data().count;
    }
    console.log('  ↳ collection counts now:');
    for (const [c, n] of Object.entries(counts)) console.log(`      ${c}: ${n}`);

    // Spot-check a known sale via composite id
    const sampleId = `AMAZON__206-6706055-5913968`;
    const sampleDoc = await db.collection('sales').doc(sampleId).get();
    if (sampleDoc.exists) {
      const d = sampleDoc.data()!;
      console.log(`  ↳ spot check sales/${sampleId}: imei=${d.imei} bp=${d.buyPrice} sp=${d.salePrice} gp=${d.grossProfit?.toFixed(2)} importedAt=${d.importedAt?.toDate?.()?.toISOString?.()}`);
    } else {
      console.log(`  ⚠ spot check FAILED: ${sampleId} not found`);
    }
  }

  console.log('\n✓ master files loaded');
  console.log(`  Audit batches: inventory=${invBatchId} sales=${salesBatchId}`);
  console.log(`  Open the live app, sign in, and the data should be visible immediately.`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n✗ loader FAILED');
    console.error(err);
    process.exit(1);
  });
