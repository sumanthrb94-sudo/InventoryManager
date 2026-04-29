/**
 * Firestore-backed database service.
 *
 * The app still uses local admin sign-in for gating access, but the inventory
 * data itself lives in Firestore so every logged-in browser sees the same
 * shared source of truth.
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

function collectionRef(collectionName: string) {
  return collection(db, collectionName);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeDoc<T extends Record<string, any>>(snapshotData: T, id: string): T {
  return {
    ...snapshotData,
    id,
  };
}

async function ensureAuthReady() {
  await ensureAnonymousAuth();
  if (!auth.currentUser) {
    throw new Error('Firebase authentication is not available.');
  }
}

async function readCollectionOnce(collectionName: string) {
  await ensureAuthReady();
  const snap = await getDocs(query(collectionRef(collectionName)));
  return snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id));
}

export const dbService = {
  async create(collectionName: string, id: string, data: any) {
    await ensureAuthReady();
    const timestamp = nowIso();
    await setDoc(doc(collectionRef(collectionName), id), {
      ...data,
      id,
      createdAt: data.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  },

  /**
   * Bulk create/update documents using a single batched Firestore write.
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

    for (const [collectionName, items] of Object.entries(byCollection)) {
      const batch = writeBatch(db);
      const timestamp = nowIso();

      for (const item of items) {
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

    if (onProgress) onProgress(total, total);
  },

  async update(collectionName: string, id: string, data: any) {
    await ensureAuthReady();
    await updateDoc(doc(collectionRef(collectionName), id), {
      ...data,
      updatedAt: nowIso(),
    });
  },

  async delete(collectionName: string, id: string) {
    await ensureAuthReady();
    await deleteDoc(doc(collectionRef(collectionName), id));
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      await ensureAuthReady();
      if (cancelled) return;

      unsub = onSnapshot(collectionRef(collectionName), snap => {
        callback(snap.docs.map(d => normalizeDoc(d.data() as Record<string, any>, d.id)));
      });
    })().catch(() => {
      callback([]);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  },

  subscribeToCollectionOrdered(
    collectionName: string,
    orderField: string,
    direction: 'asc' | 'desc' = 'desc',
    callback: (data: any[]) => void
  ) {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      await ensureAuthReady();
      if (cancelled) return;

      const q = query(collectionRef(collectionName));
      unsub = onSnapshot(q, snap => {
        const sorted = snap.docs
          .map(d => normalizeDoc(d.data() as Record<string, any>, d.id))
          .sort((a, b) => {
            const valA = a[orderField];
            const valB = b[orderField];
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
          });
        callback(sorted);
      });
    })().catch(() => {
      callback([]);
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  },

  async count(collectionName: string) {
    await ensureAuthReady();
    const snap = await getCountFromServer(collectionRef(collectionName));
    return snap.data().count;
  },

  async readAll(collectionName: string) {
    return readCollectionOnce(collectionName);
  },
};
