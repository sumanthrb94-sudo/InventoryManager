/**
 * EMERGENCY DATA RECOVERY
 * 
 * Run this in the browser console (F12 → Console) on the device that has data.
 * It will push all localStorage data to Firestore.
 * 
 * Steps:
 * 1. Open the app on the device with data (DO NOT REFRESH)
 * 2. Press F12 to open DevTools
 * 3. Go to Console tab
 * 4. Paste this entire script and press Enter
 * 5. Wait for it to complete (may take a few minutes for large datasets)
 * 6. Once done, refresh the page - data will now sync from Firestore
 */

(async function recoverData() {
  const LOCAL_CACHE_PREFIX = 'nexus_db_';
  
  // Check if Firebase is available
  if (typeof firebase === 'undefined') {
    console.error('Firebase not loaded. Make sure you are on the app page.');
    return;
  }
  
  const db = firebase.firestore();
  const auth = firebase.auth();
  
  // Wait for auth
  await auth.authStateReady();
  if (!auth.currentUser) {
    console.error('You must be logged in to recover data.');
    return;
  }
  
  console.log('Starting data recovery...');
  
  const collections = ['inventoryUnits', 'suppliers', 'batches', 'inventoryEvents', 'dailyUpdates', 'activeListings', 'sourceDocuments'];
  let totalUploaded = 0;
  
  for (const collectionName of collections) {
    const key = `${LOCAL_CACHE_PREFIX}${collectionName}`;
    const raw = localStorage.getItem(key);
    
    if (!raw) {
      console.log(`No local data for ${collectionName}`);
      continue;
    }
    
    try {
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0) {
        console.log(`Empty data for ${collectionName}`);
        continue;
      }
      
      console.log(`Uploading ${items.length} items to ${collectionName}...`);
      
      // Upload in batches of 400 (Firestore limit is 500)
      const BATCH_SIZE = 400;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = items.slice(i, i + BATCH_SIZE);
        
        for (const item of chunk) {
          if (!item.id) continue;
          const ref = db.collection(collectionName).doc(item.id);
          batch.set(ref, item);
        }
        
        await batch.commit();
        console.log(`  Uploaded ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`);
        
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      }
      
      totalUploaded += items.length;
      console.log(`✅ Completed ${collectionName}: ${items.length} items`);
    } catch (err) {
      console.error(`❌ Failed to upload ${collectionName}:`, err);
    }
  }
  
  console.log(`\n🎉 RECOVERY COMPLETE! Total items uploaded: ${totalUploaded}`);
  console.log('You can now refresh the page. Data will sync from Firestore.');
})();
