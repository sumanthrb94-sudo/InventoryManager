/**
 * clear_firestore.cjs
 * Deletes ALL documents from every inventory-related Firestore collection.
 * Run with: node clear_firestore.cjs
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
const { getAuth, signInAnonymously } = require('firebase/auth');

const config = {
  apiKey: "AIzaSyADYz4DwF-GUSzHqjfLrtS2pG2NC-IY4gU",
  authDomain: "gen-lang-client-0457133744.firebaseapp.com",
  projectId: "gen-lang-client-0457133744",
  storageBucket: "gen-lang-client-0457133744.firebasestorage.app",
  messagingSenderId: "203142040541",
  appId: "1:203142040541:web:d30f20bfd48a0cb6f24434",
};

const COLLECTIONS = [
  'inventoryUnits',
  'suppliers',
  'batches',
  'sourceDocuments',
  'inventoryEvents',
  'dailyUpdates',
];

const DB_ID = 'ai-studio-730514a8-180c-42b9-8106-b9f5b89691b9';

async function clearAll() {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app, DB_ID);

  console.log('🔐 Signing in as admin...');
  await signInAnonymously(auth);
  console.log('✅ Signed in anonymously.\n');

  let grandTotal = 0;

  for (const col of COLLECTIONS) {
    const snap = await getDocs(collection(db, col));
    if (snap.empty) {
      console.log(`  ⬜ ${col}: already empty`);
      continue;
    }

    let count = 0;
    for (const d of snap.docs) {
      await deleteDoc(doc(db, col, d.id));
      count++;
    }
    grandTotal += count;
    console.log(`  🗑️  ${col}: deleted ${count} documents`);
  }

  console.log(`\n✅ Done. ${grandTotal} total documents removed from Firestore.`);
  process.exit(0);
}

clearAll().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
