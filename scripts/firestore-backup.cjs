#!/usr/bin/env node
/**
 * Schedule-friendly Firestore backup runner.
 *
 * Two modes:
 *
 *   1) JSON snapshot to a local file (no GCP setup required):
 *        node scripts/firestore-backup.cjs
 *      → writes ./backups/firestore-backup-YYYY-MM-DDTHH-MM-SS.json
 *
 *   2) Native Firestore export to a GCS bucket (production DR path):
 *        gcloud firestore export gs://YOUR-BUCKET/$(date -u +%Y-%m-%dT%H-%M-%SZ)
 *      → restorable via `gcloud firestore import`
 *
 * Run mode (1) on a cron / GitHub Actions schedule for offsite snapshots.
 * Run mode (2) via Cloud Scheduler + Cloud Functions for managed,
 * incremental backups stored in your own GCS bucket.
 *
 * Requirements:
 *   - ./firebase-service-account.json (gitignored), or
 *   - FIREBASE_SERVICE_ACCOUNT=/abs/path.json env var.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVICE_ACCOUNT_PATH =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  path.join(REPO_ROOT, 'firebase-service-account.json');
const BACKUP_DIR = path.join(REPO_ROOT, 'backups');

// Keep in sync with src/lib/dbService.ts COL map.
const COLLECTIONS = [
  'inventoryUnits',
  'suppliers',
  'inventoryEvents',
  'dailyUpdates',
  'activeListings',
  'sourceDocuments',
  'importBatches',
  'sales',
  'inventoryAggregates',
  'marketplaceFees',
  'supplierWhatsappUpdates',
  'auditLog',
];

function bail(msg) {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}

async function main() {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    bail('firebase-admin is not installed. Run:\n    npm install --save-dev firebase-admin');
  }
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    bail(`Service account key not found at ${SERVICE_ACCOUNT_PATH}.`);
  }
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  // App uses a non-default Firestore database — match firebase-applet-config.json.
  // `databaseId` is read by the Firestore Admin SDK to target the correct DB.
  const config = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'firebase-applet-config.json'), 'utf8'),
  );
  const databaseId = config.firestoreDatabaseId || '(default)';
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  // Admin SDK uses `(default)` unless we set databaseId via settings().
  if (databaseId && databaseId !== '(default)') {
    db.settings({ databaseId });
  }

  console.log(`\nFirestore JSON backup · project=${serviceAccount.project_id}\n`);

  const out = {
    project:     serviceAccount.project_id,
    exportedAt:  new Date().toISOString(),
    counts:      {},
    collections: {},
  };

  for (const name of COLLECTIONS) {
    process.stdout.write(`  reading ${name.padEnd(25)} `);
    try {
      const snap = await db.collection(name).get();
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      out.collections[name] = docs;
      out.counts[name] = docs.length;
      console.log(`${docs.length.toString().padStart(6)} docs`);
    } catch (err) {
      console.log(`✗ ${err.message || err}`);
      out.collections[name] = [];
      out.counts[name] = 0;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(BACKUP_DIR, `firestore-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const total = Object.values(out.counts).reduce((s, n) => s + n, 0);
  console.log(`\n✓ Wrote ${total.toLocaleString()} docs → ${path.relative(REPO_ROOT, file)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
