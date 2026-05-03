/**
 * PRODUCTION Firestore database service — Single Source of Truth
 *
 * - Firestore is the ONLY write target. All writes go to Firestore first.
 * - localStorage is a read-only offline cache. It is updated BY Firestore onSnapshot,
 *   never written to directly.
 * - If a Firestore write fails, the error is THROWN so the UI can show it.
 * - Real-time sync: onSnapshot pushes live updates to all connected devices.
 */

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  writeBatch,
} from 'firebase/firestore';

import { auth, db } from './firebase';

const LOCAL_CACHE_PREFIX = 'nexus_db_';
const listeners: Record<string, Array<(data: any[]) => void>> = {};

/* ── Error toast helper ────────────────────────────────────────────────── */

function showErrorToast(message: string) {
  const existing = document.getElementById('db-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'db-error-toast';
  toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl text-sm font-bold flex items-center gap-3 animate-bounce';
  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.5s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 5000);
}

function collectionRef(collectionName: string) {
  return collection(db, collectionName);
}

function nowIso() {
  return new Date().toISOString();
}

/* ── localStorage: READ-ONLY offline cache ─────────────────────────────── */

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
    // Quota exceeded — ignore
  }
}

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) {
    cb([...data]);
  }
}

function normalizeDoc<T extends Record<string, any>>(snapshotData: T, id: string): T {
  return { ...snapshotData, id };
}

async function ensureAuthReady() {
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('Not authenticated. Please sign in.');
  }
}

/* ── Cache invalidation helpers ────────────────────────────────────────── */

function clearLocalCache(collectionName: string) {
  localStorage.removeItem(`${LOCAL_CACHE_PREFIX}${collectionName}`);
}

export function clearAllLocalCaches() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_CACHE_PREFIX));
  for (const key of keys) localStorage.removeItem(key);
}

/* ── Production dbService ──────────────────────────────────────────────── */

export const dbService = {
  /**
   * Create a document in Firestore. Throws on failure.
   * onSnapshot will automatically update localStorage and all listeners.
   */
  async create(collectionName: string, id: string, data: any) {
    await ensureAuthReady();
    const timestamp = nowIso();
    const newItem = {
      ...data,
      id,
      createdAt: data.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    try {
      await setDoc(doc(collectionRef(collectionName), id), newItem);
    } catch (err: any) {
      const msg = err?.message || 'Failed to save to database';
      showErrorToast(msg);
      throw err;
    }
    // onSnapshot will propagate to listeners + localStorage
  },

  /**
   * Bulk create documents in Firestore. Throws on failure.
   */
  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void
  ) {
    await ensureAuthReady();
    const byCollection: Record<string, { id: string; data: any }[]> = {};
    for (const entry of entries) {
      if (!byCollection[entry.collection]) byCollection[entry.collection] = [];
      byCollection[entry.collection].push({ id: entry.id, data: entry.data });
    }

    let done = 0;
    const total = entries.length;
    const timestamp = nowIso();

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
      const msg = err?.message || 'Failed to bulk save to database';
      showErrorToast(msg);
      throw err;
    }

    if (onProgress) onProgress(total, total);
  },

  /**
   * Update a document in Firestore. Throws on failure.
   */
  async update(collectionName: string, id: string, data: any) {
    await ensureAuthReady();
    try {
      await updateDoc(doc(collectionRef(collectionName), id), {
        ...data,
        updatedAt: nowIso(),
      });
    } catch (err: any) {
      const msg = err?.message || 'Failed to update database';
      showErrorToast(msg);
      throw err;
    }
  },

  /**
   * Delete a document from Firestore. Throws on failure.
   */
  async delete(collectionName: string, id: string) {
    await ensureAuthReady();
    try {
      await deleteDoc(doc(collectionRef(collectionName), id));
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete from database';
      showErrorToast(msg);
      throw err;
    }
  },

  /**
   * Subscribe to a collection via real-time onSnapshot.
   * Data flows: Firestore → localStorage cache → UI listeners
   * All devices see the same data instantly.
   */
  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(callback);

    let unsub: (() => void) | null = null;
    let hasReceivedFirstSnapshot = false;

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
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          writeLocalTable(collectionName, data);
          emit(collectionName, data);
          hasReceivedFirstSnapshot = true;
        }, error => {
          console.error(`Firestore subscription error for ${collectionName}:`, error);
          if (!hasReceivedFirstSnapshot) {
            // First snapshot failed — serve from cache as fallback
            const cached = readLocalTable(collectionName);
            callback(cached);
          }
        });
      } catch (error) {
        console.error(`Firestore subscribe init failed for ${collectionName}:`, error);
        // Not authenticated or network issue — serve from cache
        const cached = readLocalTable(collectionName);
        callback(cached);
      }
    })();

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== callback);
      if (unsub) unsub();
    };
  },

  subscribeToCollectionOrdered(
    collectionName: string,
    orderField: string,
    direction: 'asc' | 'desc' = 'desc',
    callback: (data: any[]) => void
  ) {
    const sortData = (data: any[]) => {
      return [...data].sort((a, b) => {
        const valA = a[orderField];
        const valB = b[orderField];
        if (valA < valB) return direction === 'asc' ? -1 : 1;
        if (valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    };

    const wrappedCallback = (data: any[]) => callback(sortData(data));

    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(wrappedCallback);

    let unsub: (() => void) | null = null;
    let hasReceivedFirstSnapshot = false;

    void (async () => {
      try {
        await ensureAuthReady();
        const q = query(collectionRef(collectionName));
        unsub = onSnapshot(q, snap => {
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          writeLocalTable(collectionName, data);
          emit(collectionName, data);
          hasReceivedFirstSnapshot = true;
        }, error => {
          console.error(`Firestore ordered subscription error for ${collectionName}:`, error);
          if (!hasReceivedFirstSnapshot) {
            const cached = readLocalTable(collectionName);
            wrappedCallback(cached);
          }
        });
      } catch (error) {
        console.error(`Firestore ordered subscribe init failed for ${collectionName}:`, error);
        const cached = readLocalTable(collectionName);
        wrappedCallback(cached);
      }
    })();

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== wrappedCallback);
      if (unsub) unsub();
    };
  },

  async count(collectionName: string) {
    await ensureAuthReady();
    const snap = await getCountFromServer(collectionRef(collectionName));
    return snap.data().count;
  },

  async readAll(collectionName: string) {
    await ensureAuthReady();
    const snap = await getDocs(query(collectionRef(collectionName)));
    return snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
  },

  subscribeToDateRange(
    collectionName: string,
    fromDate: string,
    toDate: string,
    callback: (data: any[]) => void
  ) {
    let unsub: (() => void) | null = null;
    void (async () => {
      try {
        await ensureAuthReady();
        const q = query(
          collectionRef(collectionName),
          where('dateIn', '>=', fromDate),
          where('dateIn', '<=', toDate),
          orderBy('dateIn', 'desc'),
          limit(2000)
        );
        unsub = onSnapshot(q, snap => {
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          callback(data);
        }, err => {
          console.error('subscribeToDateRange error:', err);
          callback([]);
        });
      } catch (err) {
        console.error('subscribeToDateRange init failed:', err);
        callback([]);
      }
    })();
    return () => { if (unsub) unsub(); };
  },

  async getPage(
    collectionName: string,
    pageSize = 100,
    lastDoc?: QueryDocumentSnapshot
  ): Promise<{ data: any[]; lastDoc: QueryDocumentSnapshot | null }> {
    await ensureAuthReady();
    const constraints: any[] = [orderBy('dateIn', 'desc'), limit(pageSize)];
    if (lastDoc) constraints.push(startAfter(lastDoc));
    const q = query(collectionRef(collectionName), ...constraints);
    const snap = await getDocs(q);
    const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
    const last = snap.docs[snap.docs.length - 1] ?? null;
    return { data, lastDoc: last };
  },

  async countWhere(collectionName: string, field: string, value: string): Promise<number> {
    await ensureAuthReady();
    const q = query(collectionRef(collectionName), where(field, '==', value));
    const snap = await getCountFromServer(q);
    return snap.data().count;
  },

  async resetDatabase() {
    await ensureAuthReady();
    const collections = ['inventoryUnits', 'suppliers', 'batches', 'inventoryEvents', 'dailyUpdates', 'activeListings', 'sourceDocuments'];
    for (const coll of collections) {
      clearLocalCache(coll);
      const snap = await getDocs(query(collectionRef(coll)));
      if (snap.size > 0) {
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  },
};
