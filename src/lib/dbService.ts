/**
 * PRODUCTION Firestore database service — Single Source of Truth
 * No localStorage. All CRUD operations go directly to Firestore with real-time listeners.
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

const listeners: Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Seeding gate — prevents reads while seed/reset is in progress ──
let _seedingPromise: Promise<void> | null = null;
let _seedingResolve: (() => void) | null = null;

export function beginSeeding(): Promise<void> {
  if (!_seedingPromise) {
    _seedingPromise = new Promise((resolve) => { _seedingResolve = resolve; });
  }
  return _seedingPromise;
}

export function endSeeding() {
  if (_seedingResolve) { _seedingResolve(); _seedingResolve = null; }
  _seedingPromise = null;
}

export function isSeeding(): boolean {
  return _seedingPromise !== null;
}

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

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) {
    cb([...data]);
  }
}

async function ensureAuthReady() {
  // 15-second ceiling — slow mobile devices need more time
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Auth timeout')), 15000)
  );
  await Promise.race([auth.authStateReady(), timeout]);
  if (!auth.currentUser) throw new Error('Not authenticated.');
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const newItem = { ...data, id, createdAt: data.createdAt ?? timestamp, updatedAt: timestamp };

    // Update in-memory cache immediately for instant UI feedback
    const currentData = cachedData[collectionName] || [];
    const idx = currentData.findIndex(item => item.id === id);
    if (idx >= 0) {
      currentData[idx] = newItem;
    } else {
      currentData.push(newItem);
    }
    cachedData[collectionName] = currentData;
    emit(collectionName, currentData);

    // Firestore write
    void ensureAuthReady().then(() =>
      setDoc(doc(collectionRef(collectionName), id), newItem)
    ).catch(err => console.warn(`Firestore create failed [${collectionName}/${id}]:`, err));
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
    const currentData = cachedData[collectionName] || [];
    const idx = currentData.findIndex(item => item.id === id);
    const updatedItem = idx >= 0
      ? { ...currentData[idx], ...data, id, updatedAt: timestamp }
      : { ...data, id, updatedAt: timestamp };

    if (idx >= 0) {
      currentData[idx] = updatedItem;
    } else {
      currentData.push(updatedItem);
    }
    cachedData[collectionName] = currentData;
    emit(collectionName, currentData);

    // Firestore write
    void ensureAuthReady().then(() =>
      setDoc(doc(collectionRef(collectionName), id), updatedItem)
    ).catch(err => console.warn(`Firestore update failed [${collectionName}/${id}]:`, err));
  },

  async delete(collectionName: string, id: string) {
    const currentData = (cachedData[collectionName] || []).filter(item => item.id !== id);
    cachedData[collectionName] = currentData;
    emit(collectionName, currentData);

    void ensureAuthReady().then(() =>
      deleteDoc(doc(collectionRef(collectionName), id))
    ).catch(err => console.warn(`Firestore delete failed [${collectionName}/${id}]:`, err));
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(callback);

    let unsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    const connect = async (retryDelay = 0) => {
      if (destroyed) return;
      if (retryDelay) await new Promise(r => setTimeout(r, retryDelay));
      if (destroyed) return;

      // Serve from in-memory cache immediately if available
      if (cachedData[collectionName]) {
        callback([...cachedData[collectionName]]);
      }

      try {
        await ensureAuthReady();
        if (destroyed) return;

        const orderField = collectionName === 'inventoryUnits' ? 'dateIn' : 'createdAt';
        const q = query(collectionRef(collectionName), orderBy(orderField, 'desc'), limit(10000));

        unsub = onSnapshot(q, snap => {
          setSyncStatus(true);
          const fsData = snap.docs.map(d => ({ ...d.data() as Record<string, any>, id: d.id }));
          cachedData[collectionName] = fsData;
          emit(collectionName, fsData);
        }, error => {
          setSyncStatus(false);
          const isQuotaError = error?.message?.includes('quota') || error?.code === 'resource-exhausted';
          if (isQuotaError) {
            console.error(`[FATAL] Firestore quota exceeded. Enable billing or wait 24h.`);
            // Don't retry on quota errors - just stay offline
            return;
          }
          console.error(`Firestore [${collectionName}] error:`, error);
          // Auto-reconnect after 5 seconds on subscription error
          if (!destroyed) retryTimer = setTimeout(() => connect(0), 5000);
        });
      } catch (error) {
        setSyncStatus(false);
        console.error(`Firestore [${collectionName}] init failed:`, error);
        // Retry after 8 seconds (covers slow auth on first load)
        if (!destroyed) retryTimer = setTimeout(() => connect(0), 8000);
      }
    };

    void connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== callback);
      if (unsub) unsub();
    };
  },

  async readAll(collectionName: string) {
    if (cachedData[collectionName]) return [...cachedData[collectionName]];
    const snap = await getDocs(collectionRef(collectionName));
    const data = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    cachedData[collectionName] = data;
    return data;
  },

  async resetDatabase() {
    try {
      // Clear Firestore
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
      
      // Clear in-memory cache
      for (const colName of collections) {
        delete cachedData[colName];
      }
      
      // Reload to trigger complete re-seeding
      window.location.href = window.location.origin + '?reset=' + Date.now();
    } catch (err: any) {
      console.error('Reset failed:', err);
      window.location.href = window.location.origin + '?reset=' + Date.now();
    }
  }
};
