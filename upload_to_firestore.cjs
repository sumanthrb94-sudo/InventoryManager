/**
 * upload_to_firestore.cjs
 * 
 * Reads imported_inventory.json and uploads all suppliers and units
 * to Firestore in batches of 500.
 * 
 * Run: node upload_to_firestore.cjs
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, writeBatch, serverTimestamp } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const firebaseConfig = {
  projectId: "gen-lang-client-0457133744",
  appId: "1:203142040541:web:d30f20bfd48a0cb6f24434",
  apiKey: "AIzaSyADYz4DwF-GUSzHqjfLrtS2pG2NC-IY4gU",
  authDomain: "gen-lang-client-0457133744.firebaseapp.com",
};

const FIRESTORE_DB_ID = "ai-studio-730514a8-180c-42b9-8106-b9f5b89691b9";
const OWNER_ID = "anonymous";

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app, FIRESTORE_DB_ID);

  const dataPath = path.join(__dirname, 'imported_inventory.json');
  const { suppliers, units } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  console.log(`📦 Uploading ${suppliers.length} suppliers and ${units.length} units...`);

  // ── 1. Upload suppliers ──
  console.log('\n→ Uploading suppliers...');
  for (const s of suppliers) {
    await setDoc(doc(db, 'suppliers', s.id), {
      ...s,
      ownerId: OWNER_ID,
      createdAt: new Date(),
    });
  }
  console.log(`  ✓ ${suppliers.length} suppliers done`);

  // ── 2. Upload units in batches of 499 ──
  console.log('\n→ Uploading inventory units...');
  const BATCH_SIZE = 499;
  let batchCount = 0;
  let uploaded = 0;

  for (let i = 0; i < units.length; i += BATCH_SIZE) {
    const chunk = units.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const unit of chunk) {
      const { supplierName, ...cleanUnit } = unit; // remove helper field
      const ref = doc(db, 'inventoryUnits', unit.id);
      batch.set(ref, {
        ...cleanUnit,
        ownerId: OWNER_ID,
        createdAt: new Date(),
      });
    }

    await batch.commit();
    uploaded += chunk.length;
    batchCount++;
    console.log(`  Batch ${batchCount}: uploaded ${uploaded}/${units.length} units`);
  }

  console.log(`\n✅ Upload complete!`);
  console.log(`   Suppliers: ${suppliers.length}`);
  console.log(`   Units:     ${units.length}`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Upload failed:', err.message);
  process.exit(1);
});
