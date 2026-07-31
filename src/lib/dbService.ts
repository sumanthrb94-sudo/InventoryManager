/**
 * Firestore database service.
 * Collections are camelCase; data is stored as-is (no snake_case conversion).
 * In-memory cache provides instant re-renders within the session.
 */

import {
  collection, doc, setDoc, deleteDoc, getDocs,
  onSnapshot, query, where, writeBatch, getDoc,
  serverTimestamp, deleteField, orderBy, Timestamp, runTransaction,
  QuerySnapshot, DocumentData, type Transaction,
} from 'firebase/firestore';
import { db } from './firebase';

const listeners:  Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Collection name map (app name → Firestore collection) ─────────────────────
const COL: Record<string, string> = {
  inventoryUnits:          'inventoryUnits',
  suppliers:               'suppliers',
  inventoryEvents:         'inventoryEvents',
  dailyUpdates:            'dailyUpdates',
  activeListings:          'activeListings',
  sourceDocuments:         'sourceDocuments',
  // Master-files audit (Wave 2): client master file support
  importBatches:           'importBatches',
  sales:                   'sales',
  inventoryAggregates:     'inventoryAggregates',
  accessoryStock:          'accessoryStock',
  accessoryStockEvents:    'accessoryStockEvents',
  marketplaceFees:         'marketplaceFees',
  supplierWhatsappUpdates: 'supplierWhatsappUpdates',
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

/** Server-stamped fields swapped into the Firestore payload at write time.
 *  In-memory cache keeps the local ISO string so optimistic UI keeps working
 *  before Firestore round-trips the real Timestamp back via the snapshot listener. */
const SERVER_TS_FIELDS = new Set([
  'createdAt', 'updatedAt', 'importedAt', 'postedAt',
]);

function cleanForFirestore(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    // Drop undefined fields (Firestore writes treat them as deletes
    // under merge:true). Everything else passes through — earlier
    // versions also stripped `supplierName` here, which was the
    // root cause of empty Supplier cells in every downloaded Sales
    // Report and every inline overlay row. The Sale and
    // InventoryUnit types both legitimately carry supplierName as
    // a denormalised display field; preserve it.
    if (v === undefined) continue;
    out[k] = SERVER_TS_FIELDS.has(k) && typeof v === 'string' ? serverTimestamp() : v;
  }
  return out;
}

// ── dbService ─────────────────────────────────────────────────────────────────
export const dbService = {

  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    // Auto-stamp ownerId='shared' when the caller forgot — the tightened
    // firestore.rules block writes whose ownerId isn't 'shared', and a
    // handful of legacy client call sites omit it (NewBatchModal,
    // ScanInModal, etc). Same behaviour as bulkCreate. Callers that pass
    // an explicit ownerId still win.
    const item = {
      ...data,
      id,
      ownerId: data.ownerId || 'shared',
      createdAt: data.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

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

    // Optimistic in-memory update. MERGE into the existing cached row when
    // one is present — never replace. The Firestore write below uses
    // `{ merge: true }` so the server doc keeps every field that's not in
    // this payload; the local cache must mirror that or readers see a
    // stubbed doc until the snapshot listener round-trips.
    //
    // Concrete reproduction: post-import sync writes a partial salePatch
    // like `{ unitId: 'IMEI' }` for each orphan-added row. The OLD code
    // replaced the cached sale with just {unitId, id, ownerId, createdAt,
    // updatedAt} — every other field (imei, marketplace, orderNumber, BP,
    // SP, …) vanished from the cache until Firestore's snapshot listener
    // refilled it. During that window, IMEI search on the Sell tab missed
    // the row because cache.imei was undefined.
    for (const [col, items] of Object.entries(byCollection)) {
      const existing = [...(cachedData[col] || [])];
      for (const item of items) {
        const idx = existing.findIndex(e => e.id === item.id);
        if (idx >= 0) existing[idx] = { ...existing[idx], ...item };
        else          existing.push(item);
      }
      cachedData[col] = existing;
      emit(col, existing);
    }

    // Write to Firestore in batches, well under the 500-op batch limit.
    //
    // Sized at 100 rather than the old 400 for FEEDBACK, not correctness. A
    // 494-sale import was two commits, so onProgress fired for the first time
    // only after the first 400 landed — the operator stared at a spinner
    // reading "Writing 0 / 494 sales…" for the entire duration of a single
    // round trip. On a phone with a weak connection that is indistinguishable
    // from a crash, and it is exactly what was reported. Five smaller commits
    // move the bar five times for the same work; the extra round trips cost
    // well under a second on a healthy connection.
    const BATCH_SIZE = 100;
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

  /** Delete many docs in batches (mirrors bulkCreate's 400-per-batch chunking).
   *  Used by the sales importer to purge stale combined multi-IMEI docs that
   *  the per-IMEI split rows supersede.
   *
   *  Returns the count of docs that were actually deleted by Firestore.
   *  When a batch fails (e.g. firestore.rules denies `sales` delete to
   *  non-admin users), the affected IDs are NOT counted. The caller can
   *  surface a "deleted N of M" tally instead of falsely claiming all M
   *  were cleaned. Errors are still logged to the console for debugging.
   *
   *  Note on optimistic cache: removed entries reappear on the next
   *  Firestore snapshot when the delete was denied server-side. This is
   *  intentional — the live store stays consistent with Firestore. */
  async bulkDelete(
    entries: Array<{ collection: string; id: string }>,
  ): Promise<{ deleted: number; failed: number }> {
    if (entries.length === 0) return { deleted: 0, failed: 0 };

    // Optimistic in-memory removal
    const byCollection: Record<string, Set<string>> = {};
    for (const e of entries) (byCollection[e.collection] ??= new Set()).add(e.id);
    for (const [col, ids] of Object.entries(byCollection)) {
      const next = (cachedData[col] || []).filter(x => !ids.has(x.id));
      cachedData[col] = next;
      emit(col, next);
    }

    const BATCH_SIZE = 400;
    let deleted = 0;
    let failed = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) batch.delete(docRef(entry.collection, entry.id));
      try {
        await batch.commit();
        deleted += chunk.length;
      } catch (err: any) {
        console.warn(`Firestore bulkDelete:`, err.message);
        failed += chunk.length;
      }
      await new Promise(r => setTimeout(r, 0));
    }
    return { deleted, failed };
  },

  /**
   * Batched partial updates — the write side of a scoped wipe.
   *
   * A `null` value means "clear this field": it goes to Firestore as
   * deleteField() and the key is dropped from the in-memory cache, so no
   * consumer ever sees a null where an optional field used to be.
   */
  async bulkUpdate(
    entries: Array<{ collection: string; id: string; data: Record<string, any> }>,
  ): Promise<{ updated: number; failed: number }> {
    if (entries.length === 0) return { updated: 0, failed: 0 };

    // Optimistic in-memory patch so the grid empties immediately
    const byCollection: Record<string, Map<string, Record<string, any>>> = {};
    for (const e of entries) (byCollection[e.collection] ??= new Map()).set(e.id, e.data);
    for (const [col, patches] of Object.entries(byCollection)) {
      const next = (cachedData[col] || []).map(row => {
        const patch = patches.get(row.id);
        if (!patch) return row;
        const merged = { ...row };
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete merged[k]; else merged[k] = v;
        }
        return merged;
      });
      cachedData[col] = next;
      emit(col, next);
    }

    const BATCH_SIZE = 400;
    let updated = 0;
    let failed = 0;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const chunk = entries.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const entry of chunk) {
        const payload: Record<string, any> = { updatedAt: serverTimestamp() };
        for (const [k, v] of Object.entries(entry.data)) {
          payload[k] = v === null ? deleteField() : v;
        }
        batch.set(docRef(entry.collection, entry.id), payload, { merge: true });
      }
      try {
        await batch.commit();
        updated += chunk.length;
      } catch (err: any) {
        console.warn(`Firestore bulkUpdate:`, err.message);
        failed += chunk.length;
      }
      await new Promise(r => setTimeout(r, 0));
    }
    return { updated, failed };
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

  // Accept any non-empty IMEI/serial verbatim — client data includes alphanumeric Apple
  // serials (e.g. "NL6CMQCYTD", "SKC9P3QVP6F") that are shorter than 14 chars.
  async imeiExists(imei: string): Promise<boolean> {
    if (!imei) return false;
    const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei);
    if (cached) return true;
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
    return !snap.empty;
  },

  // Accept any non-empty IMEI/serial verbatim — see imeiExists() comment above.
  async getByImei(imei: string): Promise<any | null> {
    if (!imei) return null;
    const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei);
    if (cached) return cached;
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
    if (snap.empty) return null;
    return snapToItems(snap)[0];
  },

  // ── Targeted sales queries for returns processing ───────────────────────────
  // Replaces readAll('sales') + client-side filter in ProcessReturnModal /
  // QuickRepairModal. Firestore composite indexes required:
  //   sales: unitId ASC, saleDate DESC
  //   sales: imei ASC, saleDate DESC
  async querySalesByUnitId(unitId: string): Promise<any[]> {
    if (!unitId) return [];
    const cached = (cachedData['sales'] || []).filter((s: any) => s.unitId === unitId);
    if (cached.length) return [...cached].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
    const snap = await getDocs(query(
      colRef('sales'),
      where('unitId', '==', unitId),
      orderBy('saleDate', 'desc'),
    ));
    return snapToItems(snap);
  },

  async querySalesByImei(imei: string): Promise<any[]> {
    if (!imei) return [];
    const key = imei.trim().toUpperCase();
    const cached = (cachedData['sales'] || []).filter((s: any) =>
      (s.imei || '').trim().toUpperCase() === key
    );
    if (cached.length) return [...cached].sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
    const snap = await getDocs(query(
      colRef('sales'),
      where('imei', '==', key),
      orderBy('saleDate', 'desc'),
    ));
    return snapToItems(snap);
  },

  // ── Generic transaction runner ───────────────────────────────────────────────
  // Returns processing updates inventoryUnits + sales atomically. The callback
  // receives a Firestore Transaction; all reads must precede all writes.
  async runTransaction<T>(fn: (transaction: Transaction) => Promise<T>): Promise<T> {
    return runTransaction(db, fn);
  },

  // Apply an in-memory cache update after a transaction commits. Transaction
  // writes bypass create/update above, so callers must refresh the cache
  // explicitly to keep the UI reactive.
  applyCacheItem(collectionName: string, id: string, data: any) {
    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(x => x.id === id);
    const updated = idx >= 0
      ? { ...current[idx], ...data, id }
      : { ...data, id };
    if (idx >= 0) current[idx] = updated; else current.push(updated);
    cachedData[collectionName] = current;
    emit(collectionName, current);
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

  // ── Master-files audit (Wave 2) ───────────────────────────────────────────
  // Specialised writers/readers for the new collections introduced to support
  // round-tripping the client's INVENTORY_REPORT and SALES_REPORT workbooks.

  /**
   * Create a single importBatches row and return its id.
   * Every imported unit / sale / aggregate must carry this id for audit trail.
   * Pass omitting `id` to let Firestore auto-assign.
   */
  async createImportBatch(meta: {
    sourceFile: string;
    sourceSheet?: string;
    rowCount: number;
    supplierId?: string;
    importedBy?: string;
    notes?: string;
  }): Promise<string> {
    const ref = doc(colRef('importBatches'));
    const id = ref.id;
    const payload: any = {
      id,
      sourceFile: meta.sourceFile,
      sourceSheet: meta.sourceSheet,
      rowCount: meta.rowCount,
      supplierId: meta.supplierId,
      importedBy: meta.importedBy ?? 'shared',
      importedAt: serverTimestamp(),
      notes: meta.notes,
      ownerId: 'shared',
    };
    // Mirror in cache with ISO so optimistic UI works
    const cacheItem = { ...payload, importedAt: nowIso() };
    const current = [...(cachedData['importBatches'] || []), cacheItem];
    cachedData['importBatches'] = current;
    emit('importBatches', current);
    try {
      await setDoc(ref, cleanForFirestore(payload));
    } catch (err: any) {
      console.warn(`Firestore createImportBatch:`, err.message);
    }
    return id;
  },

  /**
   * Upsert sales using the composite doc id `${marketplace}__${orderNumber}`
   * so re-importing the same sales workbook deduplicates naturally
   * (Firestore has no UNIQUE constraint — composite ids are the idiom).
   */
  async bulkUpsertSales(
    sales: Array<any & { id: string; marketplace: string; orderNumber: string }>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    // Use the composite id the parser already set on each row
    // (`marketplace__orderNumber__imei|sku|row`). Don't re-derive
    // from marketplace + orderNumber here — the old 2-part form
    // collapsed multi-phone orders into a single doc, silently
    // overwriting N-1 of the N rows on every import. See
    // src/lib/salesImport.ts and src/services/salesService.ts for
    // the canonical scheme; both paths set s.id, so we just trust
    // it here.
    const entries = sales.map(s => ({
      collection: 'sales',
      id: s.id,
      data: s,
    }));
    await this.bulkCreate(entries, onProgress);
  },

  /**
   * Query inventoryUnits modified within a date range (server importedAt or
   * updatedAt). Used by the daily-report exporter to scope a snapshot.
   * Both `from` and `to` are ISO date strings (yyyy-mm-dd); the server-side
   * Timestamp comparison is inclusive on both ends.
   */
  async getInventoryChangesInRange(from: string, to: string): Promise<any[]> {
    const fromTs = Timestamp.fromDate(new Date(`${from}T00:00:00.000Z`));
    const toTs   = Timestamp.fromDate(new Date(`${to}T23:59:59.999Z`));
    const snap = await getDocs(query(
      colRef('inventoryUnits'),
      where('importedAt', '>=', fromTs),
      where('importedAt', '<=', toTs),
      orderBy('importedAt', 'desc'),
    ));
    return snapToItems(snap);
  },

  /**
   * Same as above for the sales collection (uses saleDate string, not server timestamp).
   */
  async getSalesInRange(from: string, to: string): Promise<any[]> {
    const snap = await getDocs(query(
      colRef('sales'),
      where('saleDate', '>=', from),
      where('saleDate', '<=', to),
      orderBy('saleDate', 'desc'),
    ));
    return snapToItems(snap);
  },

  /**
   * Apply a listing-sites change to every available unit matching the given SKU.
   * Used by the SKU-level listing editor (Pending IMEIs / Inventory group rows).
   * Pass `[]` to clear all sites for the SKU; pass an array to replace.
   *
   * Writes the same `listingSites` value to every unit so the derived SKU
   * union (see `deriveSkuListing`) collapses back to that exact set. Also
   * stamps `platformListed` so the Pending IMEIs query drops the unit out of
   * its "awaiting listing" bucket the moment any marketplace is selected.
   */
  async setSkuListingSites(
    units: import('../types').InventoryUnit[],
    next: import('../types').ListingSite[],
  ): Promise<void> {
    const writes = units.map(u => ({
      collection: 'inventoryUnits',
      id: u.id,
      data: {
        listingSites: next,
        platformListed: next.length > 0,
        // updatedAt is server-stamped automatically by cleanForFirestore()
        updatedAt: nowIso(),
      },
    }));
    await this.bulkCreate(writes);
  },
};
