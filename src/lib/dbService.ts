/**
 * Firestore database service.
 * Collections are camelCase; data is stored as-is (no snake_case conversion).
 * In-memory cache provides instant re-renders within the session.
 */

import {
  collection, doc, setDoc, deleteDoc, getDocs,
  onSnapshot, query, where, writeBatch, getDoc,
  QuerySnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

const listeners:  Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Collection name map (app name → Firestore collection) ─────────────────────
const COL: Record<string, string> = {
  inventoryUnits:  'inventoryUnits',
  suppliers:       'suppliers',
  inventoryEvents: 'inventoryEvents',
  dailyUpdates:    'dailyUpdates',
  activeListings:  'activeListings',
  sourceDocuments: 'sourceDocuments',
  shsRemovals:     'shsRemovals',
};

function colRef(name: string) {
  return collection(db, COL[name] ?? name);
}
function docRef(name: string, id: string) {
  return doc(db, COL[name] ?? name, id);
}

// ── Snapshot → app objects ────────────────────────────────────────────────────
function snapToItems(snap: QuerySnapshot<DocumentData>): any[] {
  return snap.docs.map(d => {
    const item: any = { ...d.data(), id: d.id };
    if (!Array.isArray(item.flags)) item.flags = [];
    if (!Array.isArray(item.listingSites)) item.listingSites = [];
    return item;
  });
}

// ── Legacy conversion helpers — kept for backward-compat & tests ──────────────
export function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
export function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
export function dbToApp(row: Record<string, any>): Record<string, any> {
  if (!row || typeof row !== 'object') return { flags: [], listingSites: [] };
  const obj = Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
  if (!Array.isArray(obj.flags)) obj.flags = [];
  if (!Array.isArray(obj.listingSites)) obj.listingSites = [];
  return obj;
}
export function appToDb(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k, v]) => v !== undefined && k !== 'supplierName')
      .map(([k, v]) => [toSnake(k), v]),
  );
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
  return () => {
    const i = _syncListeners.indexOf(cb);
    if (i >= 0) _syncListeners.splice(i, 1);
  };
}

function emit(name: string, data: any[]) {
  for (const cb of listeners[name] || []) cb([...data]);
}

function nowIso() { return new Date().toISOString(); }

function cleanForFirestore(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k, v]) => v !== undefined && k !== 'supplierName')
  );
}

// ── dbService ─────────────────────────────────────────────────────────────────
export const dbService = {

  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const item = { ...data, id, createdAt: data.createdAt ?? timestamp, updatedAt: timestamp };

    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(x => x.id === id);
    if (idx >= 0) current[idx] = item; else current.push(item);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    try {
      await setDoc(docRef(collectionName, id), cleanForFirestore(item), { merge: true });
    } catch (err: any) {
      console.warn(`Firestore create [${collectionName}/${id}]:`, err.message);
    }
  },

  async update(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(x => x.id === id);
    const updated = idx >= 0
      ? { ...current[idx], ...data, id, updatedAt: timestamp }
      : { ...data, id, updatedAt: timestamp };

    if (idx >= 0) current[idx] = updated; else current.push(updated);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    try {
      await setDoc(docRef(collectionName, id), cleanForFirestore(updated), { merge: true });
    } catch (err: any) {
      console.warn(`Firestore update [${collectionName}/${id}]:`, err.message);
    }
  },

  async delete(collectionName: string, id: string) {
    const current = (cachedData[collectionName] || []).filter(x => x.id !== id);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    try {
      await deleteDoc(docRef(collectionName, id));
    } catch (err: any) {
      console.warn(`Firestore delete [${collectionName}/${id}]:`, err.message);
    }
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void,
  ) {
    const timestamp = nowIso();
    const total = entries.length;
    let done = 0;

    // Build per-collection items
    const byCollection: Record<string, any[]> = {};
    for (const entry of entries) {
      const item = {
        ...entry.data,
        id: entry.id,
        ownerId: entry.data.ownerId || 'shared',
        createdAt: entry.data.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      (byCollection[entry.collection] ??= []).push(item);
    }

    // Optimistic in-memory update
    for (const [col, items] of Object.entries(byCollection)) {
      const existing = [...(cachedData[col] || [])];
      for (const item of items) {
        const idx = existing.findIndex(e => e.id === item.id);
        if (idx >= 0) existing[idx] = item; else existing.push(item);
      }
      cachedData[col] = existing;
      emit(col, existing);
    }

    // Write to Firestore in batches of 400 (under the 500-write limit)
    const BATCH_SIZE = 400;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const item = cleanForFirestore({
          ...entry.data,
          id: entry.id,
          ownerId: entry.data.ownerId || 'shared',
          createdAt: entry.data.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        batch.set(docRef(entry.collection, entry.id), item, { merge: true });
      }
      await batch.commit();
      done += chunk.length;
      onProgress?.(done, total);
      await new Promise(r => setTimeout(r, 0));
    }

    onProgress?.(total, total);
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    (listeners[collectionName] ??= []).push(callback);

    // Serve in-memory cache immediately
    if (cachedData[collectionName]?.length) {
      callback([...cachedData[collectionName]]);
    }

    const unsub = onSnapshot(
      colRef(collectionName),
      snap => {
        const data = snapToItems(snap);
        cachedData[collectionName] = data;
        emit(collectionName, data);
        setSyncStatus(true);
      },
      err => {
        setSyncStatus(false);
        console.warn(`Firestore [${collectionName}] snapshot error:`, err.message);
      },
    );

    return () => {
      unsub();
      listeners[collectionName] = (listeners[collectionName] || []).filter(cb => cb !== callback);
    };
  },

  async readAll(collectionName: string) {
    if (cachedData[collectionName]?.length) return cachedData[collectionName];
    const snap = await getDocs(colRef(collectionName));
    const data = snapToItems(snap);
    cachedData[collectionName] = data;
    return data;
  },

  async resetDatabase() {
    Object.keys(cachedData).forEach(k => delete cachedData[k]);
    window.location.href = window.location.origin + '?reset=' + Date.now();
  },

  async imeiExists(imei: string): Promise<boolean> {
    if (!imei || imei.length < 14) return false;
    const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei);
    if (cached) return true;
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
    return !snap.empty;
  },

  async getByImei(imei: string): Promise<any | null> {
    const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei);
    if (cached) return cached;
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
    if (snap.empty) return null;
    return snapToItems(snap)[0];
  },

  async updateByImei(imei: string, data: any) {
    const timestamp = nowIso();
    const current = [...(cachedData['inventoryUnits'] || [])];
    const idx = current.findIndex((x: any) => x.imei === imei);
    const updated = idx >= 0
      ? { ...current[idx], ...data, imei, updatedAt: timestamp }
      : { ...data, imei, updatedAt: timestamp };

    if (idx >= 0) current[idx] = updated;
    cachedData['inventoryUnits'] = current;
    emit('inventoryUnits', current);

    // Find and update the Firestore document
    try {
      const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
      if (!snap.empty) {
        await setDoc(snap.docs[0].ref, cleanForFirestore(updated), { merge: true });
      }
    } catch (err: any) {
      console.warn(`Firestore updateByImei [${imei}]:`, err.message);
    }
  },
};
