/**
 * Firestore-backed database service with local fallback cache.
 *
 * Firestore is the shared source of truth when available, but the app also
 * keeps a browser cache so the UI can still show master data if Firestore auth,
 * rules, or network access fail.
 */

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, ensureAnonymousAuth } from './firebase';

const LOCAL_CACHE_PREFIX = 'nexus_db_';
const listeners: Record<string, Array<(data: any[]) => void>> = {};
const cacheLoaded: Record<string, boolean> = {};
let bundledInventoryPromise: Promise<{ suppliers?: any[]; units?: any[] }> | null = null;

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
  localStorage.setItem(`${LOCAL_CACHE_PREFIX}${collectionName}`, JSON.stringify(data));
}

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) {
    cb([...data]);
  }
}

function normalizeDoc<T extends Record<string, any>>(snapshotData: T, id: string): T {
  return {
    ...snapshotData,
    id,
  };
}

async function loadBundledInventory() {
  if (!bundledInventoryPromise) {
    bundledInventoryPromise = import('../../imported_inventory.json').then(mod => mod.default as {
      suppliers?: any[];
      units?: any[];
    });
  }

  return bundledInventoryPromise;
}

async function getBundledSeed(collectionName: string) {
  const bundled = await loadBundledInventory();
  if (collectionName === 'suppliers') {
    return bundled.suppliers ?? [];
  }
  if (collectionName === 'inventoryUnits') {
    return bundled.units ?? [];
  }
  return [];
}

function ensureLocalCache(collectionName: string) {
  if (cacheLoaded[collectionName]) {
    return readLocalTable(collectionName);
  }

  const existing = readLocalTable(collectionName);
  if (existing.length > 0) {
    cacheLoaded[collectionName] = true;
    return existing;
  }

  cacheLoaded[collectionName] = true;
  return existing;
}

async function ensureLocalCacheAsync(collectionName: string) {
  const existing = ensureLocalCache(collectionName);
  if (existing.length > 0) {
    return existing;
  }

  const seeded = await getBundledSeed(collectionName);
  if (seeded.length > 0) {
    writeLocalTable(collectionName, seeded);
    cacheLoaded[collectionName] = true;
    return seeded;
  }

  return existing;
}

function saveLocalCollection(collectionName: string, data: any[]) {
  writeLocalTable(collectionName, data);
  cacheLoaded[collectionName] = true;
  emit(collectionName, data);
}

async function ensureAuthReady() {
  await ensureAnonymousAuth();
  if (!auth.currentUser) {
    throw new Error('Firebase authentication is not available.');
  }
}

async function readCollectionOnce(collectionName: string) {
  try {
    await ensureAuthReady();
    const snap = await getDocs(query(collectionRef(collectionName)));
    const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
    if (data.length > 0) {
      saveLocalCollection(collectionName, data);
      return data;
    }
  } catch {
    // fall through to local cache
  }

  return ensureLocalCache(collectionName);
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const localTable = ensureLocalCache(collectionName);
    const newItem = {
      ...data,
      id,
      createdAt: data.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const existingIdx = localTable.findIndex(item => item.id === id);
    if (existingIdx >= 0) {
      localTable[existingIdx] = newItem;
    } else {
      localTable.push(newItem);
    }
    saveLocalCollection(collectionName, localTable);

    try {
      await ensureAuthReady();
      await setDoc(doc(collectionRef(collectionName), id), newItem);
    } catch (error) {
      console.warn(`Firestore create failed for ${collectionName}/${id}; kept local cache only.`, error);
    }
  },

  /**
   * Bulk create/update documents. Local cache is updated first so the UI never
   * goes blank if Firestore is slow or unavailable.
   */
  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void
  ) {
    const byCollection: Record<string, { id: string; data: any }[]> = {};
    for (const entry of entries) {
      if (!byCollection[entry.collection]) byCollection[entry.collection] = [];
      byCollection[entry.collection].push({ id: entry.id, data: entry.data });
    }

    let done = 0;
    const total = entries.length;

    for (const [collectionName, items] of Object.entries(byCollection)) {
      const localTable = ensureLocalCache(collectionName);
      const timestamp = nowIso();

      for (const item of items) {
        const newItem = {
          ...item.data,
          id: item.id,
          createdAt: item.data.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        const existingIdx = localTable.findIndex(r => r.id === item.id);
        if (existingIdx >= 0) {
          localTable[existingIdx] = newItem;
        } else {
          localTable.push(newItem);
        }
        done++;
        if (onProgress && done % 50 === 0) {
          onProgress(done, total);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      saveLocalCollection(collectionName, localTable);

      try {
        await ensureAuthReady();
        const batch = writeBatch(db);
        for (const item of items) {
          batch.set(doc(collectionRef(collectionName), item.id), {
            ...item.data,
            id: item.id,
            createdAt: item.data.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
        }
        await batch.commit();
      } catch (error) {
        console.warn(`Firestore bulk create failed for ${collectionName}; kept local cache only.`, error);
      }
    }

    if (onProgress) onProgress(total, total);
  },

  async update(collectionName: string, id: string, data: any) {
    const localTable = ensureLocalCache(collectionName);
    const existingIdx = localTable.findIndex(item => item.id === id);
    if (existingIdx >= 0) {
      localTable[existingIdx] = {
        ...localTable[existingIdx],
        ...data,
        updatedAt: nowIso(),
      };
      saveLocalCollection(collectionName, localTable);
    }

    try {
      await ensureAuthReady();
      await updateDoc(doc(collectionRef(collectionName), id), {
        ...data,
        updatedAt: nowIso(),
      });
    } catch (error) {
      console.warn(`Firestore update failed for ${collectionName}/${id}; kept local cache only.`, error);
    }
  },

  async delete(collectionName: string, id: string) {
    const localTable = ensureLocalCache(collectionName).filter(item => item.id !== id);
    saveLocalCollection(collectionName, localTable);

    try {
      await ensureAuthReady();
      await deleteDoc(doc(collectionRef(collectionName), id));
    } catch (error) {
      console.warn(`Firestore delete failed for ${collectionName}/${id}; kept local cache only.`, error);
    }
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) {
      listeners[collectionName] = [];
    }
    listeners[collectionName].push(callback);

    // Immediate render from cache so the dashboard is never blank.
    void ensureLocalCacheAsync(collectionName).then(data => callback(data));

    let unsub: (() => void) | null = null;

    void (async () => {
      try {
        await ensureAuthReady();
        unsub = onSnapshot(collectionRef(collectionName), snap => {
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          saveLocalCollection(collectionName, data);
        }, error => {
          console.warn(`Firestore subscription failed for ${collectionName}; using local cache.`, error);
        });
      } catch (error) {
        console.warn(`Firestore subscribe init failed for ${collectionName}; using local cache.`, error);
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

    if (!listeners[collectionName]) {
      listeners[collectionName] = [];
    }
    listeners[collectionName].push(wrappedCallback);

    void ensureLocalCacheAsync(collectionName).then(data => wrappedCallback(data));

    let unsub: (() => void) | null = null;

    void (async () => {
      try {
        await ensureAuthReady();
        const q = query(collectionRef(collectionName));
        unsub = onSnapshot(q, snap => {
          const data = snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
          saveLocalCollection(collectionName, data);
        }, error => {
          console.warn(`Firestore ordered subscription failed for ${collectionName}; using local cache.`, error);
        });
      } catch (error) {
        console.warn(`Firestore ordered subscription init failed for ${collectionName}; using local cache.`, error);
      }
    })();

    return () => {
      listeners[collectionName] = listeners[collectionName].filter(cb => cb !== wrappedCallback);
      if (unsub) unsub();
    };
  },

  async count(collectionName: string) {
    try {
      await ensureAuthReady();
      const snap = await getCountFromServer(collectionRef(collectionName));
      return snap.data().count;
    } catch {
      return ensureLocalCache(collectionName).length;
    }
  },

  async readAll(collectionName: string) {
    return readCollectionOnce(collectionName);
  },
};
