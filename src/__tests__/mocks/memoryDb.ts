/**
 * memoryDb — an in-memory stand-in for dbService + the Firestore bits the
 * service layer touches, so a whole operator session can be simulated in
 * one process.
 *
 * The existing service tests each hand-roll their own mock inside a
 * vi.mock factory; that works for one service but can't be shared across
 * a lifecycle test that drives inventory → sales import → returns in
 * sequence against ONE dataset. This module owns that dataset.
 *
 * Deliberately faithful to the real dbService semantics that matter for
 * correctness:
 *   - bulkCreate merges (setDoc merge:true) rather than replacing
 *   - `undefined` values are dropped on write, exactly like
 *     cleanForFirestore, so "field absent from the patch" behaves the
 *     same here as in Firestore
 *   - `null` in bulkUpdate clears the field (deleteField semantics)
 */

export const store: Record<string, Record<string, any>> = {};

export function col(name: string): Record<string, any> {
  return (store[name] ??= {});
}

export function all<T = any>(name: string): T[] {
  return Object.values(col(name)) as T[];
}

export function seed(name: string, docs: any[]): void {
  for (const d of docs) col(name)[d.id] = { ...d };
}

export function clearStore(): void {
  for (const k of Object.keys(store)) delete store[k];
}

/** Mirrors dbService.cleanForFirestore: undefined never reaches the doc. */
function clean(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function merge(name: string, id: string, data: Record<string, any>): void {
  const existing = col(name)[id] || {};
  col(name)[id] = { ...existing, ...clean(data), id };
}

export const memoryDbService = {
  async create(name: string, id: string, data: any) {
    merge(name, id, { ...data, ownerId: data.ownerId || 'shared' });
  },

  async update(name: string, id: string, data: any) {
    merge(name, id, data);
  },

  async delete(name: string, id: string) {
    delete col(name)[id];
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void,
  ) {
    let done = 0;
    for (const e of entries) {
      merge(e.collection, e.id, e.data);
      onProgress?.(++done, entries.length);
    }
    return { created: entries.length, failed: 0 };
  },

  async bulkDelete(entries: Array<{ collection: string; id: string }>) {
    for (const e of entries) delete col(e.collection)[e.id];
    return { deleted: entries.length, failed: 0 };
  },

  async bulkUpdate(entries: Array<{ collection: string; id: string; data: Record<string, any> }>) {
    for (const e of entries) {
      const existing = col(e.collection)[e.id] || {};
      const next = { ...existing };
      for (const [k, v] of Object.entries(e.data)) {
        if (v === null) delete next[k]; else next[k] = v;
      }
      col(e.collection)[e.id] = { ...next, id: e.id };
    }
    return { updated: entries.length, failed: 0 };
  },

  async readAll(name: string) {
    return all(name);
  },

  async imeiExists(imei: string) {
    const k = (imei || '').trim().toUpperCase();
    return all('inventoryUnits').some((u: any) => (u.imei || '').trim().toUpperCase() === k);
  },

  async getByImei(imei: string) {
    const k = (imei || '').trim().toUpperCase();
    return all('inventoryUnits').find((u: any) => (u.imei || '').trim().toUpperCase() === k) ?? null;
  },

  async querySalesByUnitId(unitId: string) {
    return all('sales')
      .filter((s: any) => s.unitId === unitId)
      .sort((a: any, b: any) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  },

  async querySalesByImei(imei: string) {
    const k = (imei || '').trim().toUpperCase();
    return all('sales')
      .filter((s: any) => (s.imei || '').trim().toUpperCase() === k)
      .sort((a: any, b: any) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  },

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    // Single-threaded simulation: apply writes directly. Reads see the
    // live store, which matches Firestore's read-your-own-writes inside
    // a transaction closely enough for lifecycle assertions.
    const tx = {
      get: async (ref: any) => {
        const [name, id] = ref.path.split('/');
        const data = col(name)[id];
        return { exists: () => !!data, data: () => data };
      },
      update: (ref: any, data: Record<string, any>) => {
        const [name, id] = ref.path.split('/');
        merge(name, id, data);
      },
      set: (ref: any, data: Record<string, any>) => {
        const [name, id] = ref.path.split('/');
        merge(name, id, data);
      },
      delete: (ref: any) => {
        const [name, id] = ref.path.split('/');
        delete col(name)[id];
      },
    };
    return fn(tx);
  },

  applyCacheItem(name: string, id: string, data: any) {
    merge(name, id, data);
  },

  async setSkuListingSites() { /* not exercised by the lifecycle sim */ },

  subscribeToCollection(name: string, cb: (data: any[]) => void) {
    cb(all(name));
    return () => {};
  },
};

/** Minimal `firebase/firestore` surface used by the service layer. */
export const firestoreMock = {
  doc: (_db: any, name: string, id: string) => ({ path: `${name}/${id}`, id }),
  serverTimestamp: () => '__SERVER_TIMESTAMP__',
};
