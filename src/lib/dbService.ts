/**
 * PRODUCTION Firestore database service — Single Source of Truth
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  limit,
  writeBatch,
} from 'firebase/firestore';

import { auth, db } from './firebase';

const LOCAL_CACHE_PREFIX = 'nexus_db_';
const listeners: Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Sync status ───────────────────────────────────────────────────────────────
let _syncConnected = false;
const _syncListeners: Array<(connected: boolean) => void> = [];
function setSyncStatus(connected: boolean) {
  if (_syncConnected === connected) return;
  _syncConnected = connected;
  _syncListeners.forEach(cb => cb(connected));
}

export function subscribeToSyncStatus(cb: (connected: boolean) => void) {
  _syncListeners.push(cb);
  cb(_syncConnected);
  return () => { const i = _syncListeners.indexOf(cb); if (i >= 0) _syncListeners.splice(i, 1); };
}

function collectionRef(collectionName: string) {
  return collection(db, collectionName);
}

function nowIso() {
  return new Date().toISOString();
}

function readLocalTable(collectionName: string): any[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_CACHE_PREFIX}${collectionName}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLocalTable(collectionName: string, data: any[]) {
  try {
    localStorage.setItem(`${LOCAL_CACHE_PREFIX}${collectionName}`, JSON.stringify(data));
  } catch {
    // Quota exceeded
  }
}

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) {
    cb([...data]);
  }
}

async function ensureAuthReady() {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Auth timeout')), 5000)
  );
  await Promise.race([auth.authStateReady(), timeout]);
  if (!auth.currentUser) throw new Error('Not authenticated.');
}

export function clearAllLocalCaches() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_CACHE_PREFIX));
  for (const key of keys) localStorage.removeItem(key);
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const ownerId = auth.currentUser?.uid || 'system';
    const newItem = {
      ...data,
      id,
      ownerId: data.ownerId || ownerId,
      createdAt: data.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    // 1. Instant local write
    const localTable = readLocalTable(collectionName);
    const idx = localTable.findIndex(item => item.id === id);
    if (idx >= 0) localTable[idx] = newItem; else localTable.push(newItem);
    writeLocalTable(collectionName, localTable);
    cachedData[collectionName] = localTable;
    emit(collectionName, localTable);

    // 2. Direct Firestore create
    await setDoc(doc(collectionRef(collectionName), id), newItem);
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void
  ) {
    await ensureAuthReady();
    const ownerId = auth.currentUser?.uid || 'system';
    const timestamp = nowIso();

    const byCollection: Record<string, { id: string; data: any }[]> = {};
    for (const entry of entries) {
      if (!byCollection[entry.collection]) byCollection[entry.collection] = [];
      byCollection[entry.collection].push({ id: entry.id, data: entry.data });
    }

    let done = 0;
    const total = entries.length;

    try {
      for (const [collectionName, items] of Object.entries(byCollection)) {
        const BATCH_LIMIT = 499;
        for (let offset = 0; offset < items.length; offset += BATCH_LIMIT) {
          const chunk = items.slice(offset, offset + BATCH_LIMIT);
          const batch = writeBatch(db);
          for (const item of chunk) {
            batch.set(doc(collectionRef(collectionName), item.id), {
              ...item.data,
              id: item.id,
              ownerId: item.data.ownerId || ownerId,
              createdAt: item.data.createdAt ?? timestamp,
              updatedAt: timestamp,
            });
            done++;
            if (onProgress && done % 50 === 0) {
              onProgress(done, total);
              await new Promise(r => setTimeout(r, 0));
            }
          }
          await batch.commit();
        }
      }
    } catch (err: any) {
      console.error('Failed to bulk save to database', err);
      throw err;
    }
    if (onProgress) onProgress(total, total);
  },

  async update(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const localTable = readLocalTable(collectionName);
    const idx = localTable.findIndex(item => item.id === id);
    let updatedItem: any = null;

    if (idx >= 0) {
      updatedItem = { ...localTable[idx], ...data, id, updatedAt: timestamp };
      localTable[idx] = updatedItem;
      writeLocalTable(collectionName, localTable);
      cachedData[collectionName] = localTable;
      emit(collectionName, localTable);
    } else {
      updatedItem = { ...data, id, updatedAt: timestamp };
    }

    // Direct Firestore update
    await setDoc(doc(collectionRef(collectionName), id), updatedItem);
  },

  async delete(collectionName: string, id: string) {
    // 1. Instant local delete
    const localTable = readLocalTable(collectionName).filter(item => item.id !== id);
    writeLocalTable(collectionName, localTable);
    cachedData[collectionName] = localTable;
    emit(collectionName, localTable);

    // 2. Direct Firestore delete
    await deleteDoc(doc(collectionRef(collectionName), id));
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(callback);

    let unsub: (() => void) | null = null;

    // Load fast from local cache first to prevent any initial UI flicker
    const cached = readLocalTable(collectionName);
    if (cached.length > 0) {
      cachedData[collectionName] = cached;
      callback(cached);
    }

    void (async () => {
      try {
        await ensureAuthReady();
        const orderField = collectionName === 'inventoryUnits' ? 'dateIn' : 'createdAt';
        const q = query(
          collectionRef(collectionName),
          orderBy(orderField, 'desc'),
          limit(12000)
        );

        unsub = onSnapshot(q, snap => {
          setSyncStatus(true);
          const fsData = snap.docs.map(d => ({ ...d.data(), id: d.id }));

          // Save perfectly to cache
          cachedData[collectionName] = fsData;
          writeLocalTable(collectionName, fsData);
          emit(collectionName, fsData);
        }, error => {
          setSyncStatus(false);
          console.error(`Firestore subscription error for ${collectionName}:`, error);
        });
      } catch (error) {
        setSyncStatus(false);
        console.error(`Firestore subscribe init failed for ${collectionName}:`, error);
        const cached = readLocalTable(collectionName);
        callback(cached);
      }
    })();

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== callback);
      if (unsub) unsub();
    };
  },

  async readAll(collectionName: string) {
    if (cachedData[collectionName]) return cachedData[collectionName];
    const cached = readLocalTable(collectionName);
    if (cached.length > 0) {
      cachedData[collectionName] = cached;
      return cached;
    }
    const snap = await getDocs(collectionRef(collectionName));
    const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    cachedData[collectionName] = data;
    writeLocalTable(collectionName, data);
    return data;
  },

  refreshFromLocalCache(collectionName: string) {
    const data = readLocalTable(collectionName);
    emit(collectionName, data);
  },

  async resetDatabase() {
    try {
      // 1. Clear ALL local caches first
      clearAllLocalCaches();
      
      // 2. Clear Firestore
      const collections = ['inventoryUnits', 'suppliers', 'inventoryEvents', 'dailyUpdates', 'activeListings', 'sourceDocuments'];
      for (const colName of collections) {
        const q = query(collectionRef(colName), limit(500));
        const snap = await getDocs(q);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      
      // 3. Reload to trigger complete re-seeding
      window.location.href = window.location.origin + '?reset=' + Date.now();
    } catch (err: any) {
      console.error('Reset failed:', err);
      clearAllLocalCaches();
      window.location.href = window.location.origin + '?reset=' + Date.now();
    }
  }
};
