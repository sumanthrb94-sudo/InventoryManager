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
  updateDoc,
  limit,
  writeBatch,
} from 'firebase/firestore';

import { auth, db } from './firebase';

const LOCAL_CACHE_PREFIX = 'nexus_db_';
const listeners: Record<string, Array<(data: any[]) => void>> = {};

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

function normalizeDoc<T extends Record<string, any>>(snapshotData: T, id: string): T {
  return { ...snapshotData, id };
}

async function ensureAuthReady() {
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw new Error('Not authenticated. Please sign in.');
  }
}

export function clearAllLocalCaches() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(LOCAL_CACHE_PREFIX));
  for (const key of keys) localStorage.removeItem(key);
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const newItem = { ...data, id, createdAt: data.createdAt ?? timestamp, updatedAt: timestamp };

    // Write locally first — instant, always succeeds
    const localTable = readLocalTable(collectionName);
    const idx = localTable.findIndex(item => item.id === id);
    if (idx >= 0) localTable[idx] = newItem; else localTable.push(newItem);
    writeLocalTable(collectionName, localTable);
    emit(collectionName, localTable);

    // Sync to Firestore in background
    try {
      await ensureAuthReady();
      await setDoc(doc(collectionRef(collectionName), id), newItem);
    } catch (err: any) {
      console.warn(`Firestore create failed for ${collectionName}/${id}; saved locally.`, err);
    }
  },

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
      showErrorToast(err?.message || 'Failed to bulk save to database');
      throw err;
    }
    if (onProgress) onProgress(total, total);
  },

  async update(collectionName: string, id: string, data: any) {
    const update = { ...data, updatedAt: nowIso() };

    // Write locally first — instant, always succeeds
    const localTable = readLocalTable(collectionName);
    const idx = localTable.findIndex(item => item.id === id);
    if (idx >= 0) {
      localTable[idx] = { ...localTable[idx], ...update };
      writeLocalTable(collectionName, localTable);
      emit(collectionName, localTable);
    }

    // Sync to Firestore in background
    try {
      await ensureAuthReady();
      await updateDoc(doc(collectionRef(collectionName), id), update);
    } catch (err: any) {
      console.warn(`Firestore update failed for ${collectionName}/${id}; saved locally.`, err);
    }
  },

  async delete(collectionName: string, id: string) {
    // Delete locally first — instant, always succeeds
    const localTable = readLocalTable(collectionName).filter(item => item.id !== id);
    writeLocalTable(collectionName, localTable);
    emit(collectionName, localTable);

    // Sync to Firestore in background
    try {
      await ensureAuthReady();
      await deleteDoc(doc(collectionRef(collectionName), id));
    } catch (err: any) {
      console.warn(`Firestore delete failed for ${collectionName}/${id}; deleted locally.`, err);
    }
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(callback);

    let unsub: (() => void) | null = null;

    void (async () => {
      try {
        await ensureAuthReady();
        const orderField = collectionName === 'inventoryUnits' ? 'dateIn' : 'createdAt';
        const q = query(
          collectionRef(collectionName),
          orderBy(orderField, 'desc'),
          limit(12000)
        );

        const cached = readLocalTable(collectionName);
        if (cached.length > 0) callback(cached);

        unsub = onSnapshot(q, snap => {
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          writeLocalTable(collectionName, data);
          emit(collectionName, data);
        }, error => {
          console.error(`Firestore subscription error for ${collectionName}:`, error);
        });
      } catch (error) {
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
    return readLocalTable(collectionName);
  },

  refreshFromLocalCache(collectionName: string) {
    const data = readLocalTable(collectionName);
    emit(collectionName, data);
  },

  async resetDatabase() {
    try {
      // 1. Clear ALL local storage first
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith(LOCAL_CACHE_PREFIX)) {
          localStorage.removeItem(key);
        }
      }
      
      // 2. Try to clear Firestore if authenticated
      if (auth.currentUser) {
        const collections = ['inventoryUnits', 'suppliers'];
        for (const colName of collections) {
          const q = query(collectionRef(colName), limit(500));
          const snap = await getDocs(q);
          if (!snap.empty) {
            const batch = writeBatch(db);
            snap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
        }
      }
      
      // 3. Force a hard reload to trigger re-seeding
      window.location.href = window.location.origin + '?reset=' + Date.now();
    } catch (err: any) {
      console.error('Reset failed:', err);
      // Even if Firestore delete fails, clear local and reload
      clearAllLocalCaches();
      window.location.href = window.location.origin + '?reset=' + Date.now();
    }
  }
};
