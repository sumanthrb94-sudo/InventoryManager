/**
 * Firestore database service.
 * Collections are camelCase; data is stored as-is (no snake_case conversion).
 * In-memory cache provides instant re-renders within the session.
 */

import {
  collection, doc, setDoc, deleteDoc, getDocs,
  onSnapshot, query, where, writeBatch, getDoc,
  serverTimestamp, orderBy, Timestamp,
  QuerySnapshot, DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';

const listeners:  Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Collection name map (app name → Firestore collection) ─────────────────────
const COL: Record<string, string> = {
  inventoryUnits:          'inventoryUnits',
  suppliers:               'suppliers',
  batches:                 'batches',
  inventoryEvents:         'inventoryEvents',
  dailyUpdates:            'dailyUpdates',
  activeListings:          'activeListings',
  sourceDocuments:         'sourceDocuments',
  // Master-files audit (Wave 2): client master file support
  importBatches:           'importBatches',
  sales:                   'sales',
  inventoryAggregates:     'inventoryAggregates',
  marketplaceFees:         'marketplaceFees',
  supplierWhatsappUpdates: 'supplierWhatsappUpdates',
  // Append-only audit trail of mutating ops — who/when/what/where.
  // Admin-only viewer surfaces this; non-admins never read it.
  auditLog:                'auditLog',
  // Per-IMEI lifecycle of returns — every return action lands here so
  // the operator can answer "have we returned this IMEI before?" on
  // re-intake and audit the full chain of custody. See `ReturnEvent` in
  // types.ts for the lifecycle vocabulary.
  returnEvents:            'returnEvents',
};

/** Every Firestore collection the app owns — the single source of truth used
 *  by full backup, restore, AND the Wipe-DB reset, so none can drift and leave
 *  stale data behind (e.g. returnEvents lingering after a wipe). */
export const ALL_COLLECTION_NAMES: string[] = Object.values(COL);

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
      .filter(([, v]) => v !== undefined)
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
    if (v === undefined) continue;
    out[k] = SERVER_TS_FIELDS.has(k) && typeof v === 'string' ? serverTimestamp() : v;
  }
  return out;
}

// ── Audit log ────────────────────────────────────────────────────────────────
// Fire-and-forget writer recording who edited what. Every mutating method
// (create / update / delete / bulkCreate / bulkDelete) calls this. Never
// throws — audit failures must never block the original write. The admin
// audit-log viewer reads from the `auditLog` collection.
//
// Schema:
//   { id, actorUid, actorEmail, action, collection, docId?, count?, ts }
// `action` is one of: create | update | delete | bulk_create | bulk_delete
// `count` is only set for bulk_*, gives the number of affected docs.

import { auth, isAdmin, canTeamWrite } from './firebase';

// ── Write-permission guard ───────────────────────────────────────────────────
// Every mutating dbService method calls one of these guards BEFORE any cache
// emit or Firestore write. Throwing here (rather than relying only on
// Security Rules) keeps the local cache and Firestore consistent — a denied
// write never leaves the optimistic cache patched ahead of a server reject.
//
// Two tiers:
//   • assertCanWrite — OPERATIONAL writes (stock intake, selling, processing
//     returns). These reduce to create / update / bulk-create and are the
//     team's everyday workflows, so any signed-in team member may perform
//     them (see canTeamWrite in firebase.ts).
//   • assertCanEdit  — DESTRUCTIVE / admin operations (delete, bulk-delete,
//     restore, purge, database reset, backup restore). Admin-only.
class ReadOnlyRoleError extends Error {
  constructor(action: string) {
    super(`Read-only role — you don't have permission to ${action}. Ask the admin to make this change.`);
    this.name = 'ReadOnlyRoleError';
  }
}

/** Admin-only gate — used by destructive / admin operations. */
function assertCanEdit(action: string): void {
  if (!isAdmin(auth.currentUser)) throw new ReadOnlyRoleError(action);
}

/** Operational-write gate — stock intake (office + SHS), selling, and
 *  processing returns are day-to-day team workflows, so any signed-in team
 *  member may perform the create / update / bulk-create writes they produce.
 *  Destructive and admin-only operations keep using assertCanEdit instead. */
function assertCanWrite(action: string): void {
  if (isAdmin(auth.currentUser) || canTeamWrite(auth.currentUser)) return;
  throw new ReadOnlyRoleError(action);
}

// `as` is retained for call-site self-documentation (e.g. the sell / return /
// shs write paths). All operational writes resolve to the same team-level
// permission; plain destructive ops call assertCanEdit directly.
type WriteOpts = { as?: 'edit' | 'sell' | 'return' | 'shs' };
function assertWrite(opts: WriteOpts | undefined, editAction: string, _sellAction: string): void {
  void opts;
  assertCanWrite(editAction);
}

// Deletes are destructive and admin-only by default. The ONE exception is
// receiving SHS ("supplier has stock") into inventory: that flow swaps a
// synthetic SHS placeholder unit for the real received units, so the
// placeholder cleanup is part of an operational intake the whole team does.
// Those call sites pass { as: 'shs' } to opt that single delete into the
// team-level permission, without unlocking general deletes.
function assertDelete(opts: WriteOpts | undefined, action: string): void {
  if (opts?.as === 'shs') assertCanWrite(action);
  else assertCanEdit(action);
}

export type AuditAction = 'create' | 'update' | 'delete' | 'bulk_create' | 'bulk_delete';

function recordAudit(
  action: AuditAction,
  collectionName: string,
  details: { docId?: string; count?: number } = {},
): void {
  const user = auth.currentUser;
  // Skip self-referential audit writes — otherwise every audit entry
  // would generate another audit entry in an infinite loop.
  if (collectionName === 'auditLog' || collectionName === COL.auditLog) return;
  // Skip pre-auth bootstrap writes (e.g. anonymous import seed).
  if (!user) return;
  const id = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const entry = {
    id,
    actorUid:   user.uid,
    actorEmail: user.email ?? '(unknown)',
    action,
    collection: collectionName,
    docId:      details.docId,
    count:      details.count,
    ts:         serverTimestamp(),
  };
  // Optimistic cache update so the admin viewer reflects the entry instantly.
  const current = [entry, ...(cachedData['auditLog'] || [])].slice(0, 5000);
  cachedData['auditLog'] = current;
  emit('auditLog', current);
  // Background write — failures get logged but never block the caller.
  setDoc(docRef('auditLog', id), cleanForFirestore(entry)).catch((err: any) => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[audit] write failed:', err?.message || err);
    }
  });
}

// ── dbService ─────────────────────────────────────────────────────────────────
export const dbService = {

  async create(collectionName: string, id: string, data: any, opts?: WriteOpts) {
    assertWrite(opts, 'create records', 'record sales');
    const timestamp = nowIso();
    // `create` semantics = full insert / overwrite. If a previously
    // soft-deleted doc exists at this id, this call brings it back —
    // explicitly null `deletedAt` / `deletedBy` so the tombstone fields
    // get CLEARED on Firestore (merge:true would otherwise preserve them).
    const item = {
      ...data,
      id,
      deletedAt: data.deletedAt ?? null,
      deletedBy: data.deletedBy ?? null,
      deletedByEmail: data.deletedByEmail ?? null,
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
    recordAudit('create', collectionName, { docId: id });
  },

  async update(collectionName: string, id: string, data: any, opts?: WriteOpts) {
    assertWrite(opts, 'edit records', 'record sales');
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
    recordAudit('update', collectionName, { docId: id });
  },

  /** Soft-delete a doc — tombstones it with `{ deletedAt, deletedBy }`
   *  instead of removing it from Firestore. All read paths
   *  (subscribeToCollection, readAll) filter tombstoned docs out by
   *  default. Use restore() to undelete, or purgeSoftDeleted() to
   *  permanently remove after a retention window.
   *
   *  Audit log entries are immutable — calls targeting the auditLog
   *  collection are a no-op so the trail can't be tampered with. */
  async delete(collectionName: string, id: string, opts?: WriteOpts) {
    // Admin-only, except the SHS-receive placeholder cleanup (see assertDelete).
    assertDelete(opts, 'delete records');
    if (collectionName === 'auditLog' || collectionName === COL.auditLog) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[soft-delete] auditLog is append-only — delete refused');
      }
      return;
    }
    const ts = nowIso();
    const actorUid   = auth.currentUser?.uid   ?? null;
    const actorEmail = auth.currentUser?.email ?? null;
    const tombstone = { id, deletedAt: ts, deletedBy: actorUid, deletedByEmail: actorEmail, updatedAt: ts };

    // Optimistic local: stamp the doc in place so views that DO read
    // tombstones (admin recycle bin) keep the data, but the default
    // filtering at emit time strips it from regular views.
    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(x => x.id === id);
    if (idx >= 0) current[idx] = { ...current[idx], ...tombstone };
    cachedData[collectionName] = current;
    emit(collectionName, current);

    try {
      await setDoc(docRef(collectionName, id), cleanForFirestore(tombstone), { merge: true });
    } catch (err: any) {
      console.warn(`Firestore soft-delete [${collectionName}/${id}]:`, err.message);
    }
    recordAudit('delete', collectionName, { docId: id });
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void,
  ) {
    // Operational write — bulk stock intake / sale + return imports run
    // through here, so the whole team may perform it.
    assertCanWrite('bulk-create records');
    const timestamp = nowIso();
    const total = entries.length;
    let done = 0;
    // Firestore doc ids cannot contain '/'. Sanitise defensively so a single bad
    // id (e.g. a sales row whose IMEI cell pasted "imeiA / imeiB") can never make
    // the entire import throw "document reference must have an even number of
    // segments". Applied to both the cache and the Firestore write.
    const safeId = (id: string) => id.replace(/\//g, '-');

    // Build per-collection items
    const byCollection: Record<string, any[]> = {};
    for (const entry of entries) {
      // Same semantics as the single-doc create — bulk-create explicitly
      // clears any prior tombstone unless the entry itself carries one.
      // Re-importing a sale that was previously soft-deleted brings it back.
      const item = {
        ...entry.data,
        id: safeId(entry.id),
        deletedAt: entry.data?.deletedAt ?? null,
        deletedBy: entry.data?.deletedBy ?? null,
        deletedByEmail: entry.data?.deletedByEmail ?? null,
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
          id: safeId(entry.id),
          ownerId: entry.data.ownerId || 'shared',
          // Explicit nulls clear any prior soft-delete tombstone on
          // re-import. Without these, merge:true would leave a previously-
          // tombstoned doc invisible after re-creation.
          deletedAt:      entry.data.deletedAt ?? null,
          deletedBy:      entry.data.deletedBy ?? null,
          deletedByEmail: entry.data.deletedByEmail ?? null,
          createdAt: entry.data.createdAt ?? timestamp,
          updatedAt: timestamp,
        });
        batch.set(docRef(entry.collection, safeId(entry.id)), item, { merge: true });
      }
      await batch.commit();
      done += chunk.length;
      onProgress?.(done, total);
      await new Promise(r => setTimeout(r, 0));
    }

    onProgress?.(total, total);
    // One audit entry per affected collection — chunking 1k+ rows into
    // 1k+ audit entries would drown the viewer.
    for (const [col, items] of Object.entries(byCollection)) {
      recordAudit('bulk_create', col, { count: items.length });
    }
  },

  /**
   * Soft-delete a batch of docs from a single collection. Tombstones each
   * doc with `{ deletedAt, deletedBy }` instead of removing it from
   * Firestore. Uses writeBatch under the 500-write limit. Audit-log
   * deletes are refused (the collection is append-only).
   *
   * @param onProgress  Called per-chunk with (done, total). Optional.
   * @returns           Number of docs soft-deleted (== ids.length when the
   *                    collection isn't auditLog, 0 otherwise).
   */
  async bulkDelete(
    collectionName: string,
    ids: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<number> {
    assertCanEdit('bulk-delete records');
    if (ids.length === 0) return 0;
    if (collectionName === 'auditLog' || collectionName === COL.auditLog) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[soft-delete] auditLog is append-only — bulkDelete refused');
      }
      return 0;
    }
    const total = ids.length;
    const ts = nowIso();
    const actorUid   = auth.currentUser?.uid   ?? null;
    const actorEmail = auth.currentUser?.email ?? null;

    // Optimistic local: stamp every targeted doc with the tombstone in the
    // cache and emit so subscribers refresh before the network round-trip.
    const idSet = new Set(ids);
    const current = [...(cachedData[collectionName] || [])];
    for (let i = 0; i < current.length; i++) {
      if (idSet.has(current[i].id)) {
        current[i] = { ...current[i], deletedAt: ts, deletedBy: actorUid, deletedByEmail: actorEmail, updatedAt: ts };
      }
    }
    cachedData[collectionName] = current;
    emit(collectionName, current);

    const BATCH_SIZE = 400;
    let done = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.set(
          docRef(collectionName, id),
          cleanForFirestore({ id, deletedAt: ts, deletedBy: actorUid, deletedByEmail: actorEmail, updatedAt: ts }),
          { merge: true },
        );
      }
      try {
        await batch.commit();
      } catch (err: any) {
        console.warn(`Firestore bulk soft-delete [${collectionName}] chunk ${i}:`, err.message);
      }
      done += chunk.length;
      onProgress?.(done, total);
      await new Promise(r => setTimeout(r, 0));
    }
    onProgress?.(total, total);
    recordAudit('bulk_delete', collectionName, { count: total });
    return total;
  },

  // ── Restore + permanent purge ────────────────────────────────────────────────
  //
  // Restore = clear `deletedAt` / `deletedBy` so the doc shows up in
  // default views again. Bulk variants for the recycle-bin "Restore N"
  // button. Permanent purge = the actual hard-delete, gated on admin
  // intent (operator runs it deliberately on rows that have aged out).

  /** Clear the soft-delete tombstone on a single doc. */
  async restore(collectionName: string, id: string): Promise<void> {
    assertCanEdit('restore records');
    if (collectionName === 'auditLog' || collectionName === COL.auditLog) return;
    const ts = nowIso();
    const patch = { id, deletedAt: null as any, deletedBy: null as any, deletedByEmail: null as any, updatedAt: ts };

    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(x => x.id === id);
    if (idx >= 0) {
      const { deletedAt: _da, deletedBy: _db, deletedByEmail: _dbe, ...rest } = current[idx];
      current[idx] = { ...rest, updatedAt: ts };
      cachedData[collectionName] = current;
      emit(collectionName, current);
    }
    try {
      await setDoc(docRef(collectionName, id), patch, { merge: true });
    } catch (err: any) {
      console.warn(`Firestore restore [${collectionName}/${id}]:`, err.message);
    }
    recordAudit('update', collectionName, { docId: id });
  },

  /** Bulk-restore variant for the recycle-bin "Restore N" action. */
  async bulkRestore(collectionName: string, ids: string[]): Promise<number> {
    assertCanEdit('bulk-restore records');
    if (ids.length === 0) return 0;
    if (collectionName === 'auditLog' || collectionName === COL.auditLog) return 0;
    const ts = nowIso();
    const idSet = new Set(ids);

    const current = [...(cachedData[collectionName] || [])];
    for (let i = 0; i < current.length; i++) {
      if (idSet.has(current[i].id)) {
        const { deletedAt: _da, deletedBy: _db, deletedByEmail: _dbe, ...rest } = current[i];
        current[i] = { ...rest, updatedAt: ts };
      }
    }
    cachedData[collectionName] = current;
    emit(collectionName, current);

    const BATCH_SIZE = 400;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.set(
          docRef(collectionName, id),
          { id, deletedAt: null, deletedBy: null, deletedByEmail: null, updatedAt: ts },
          { merge: true },
        );
      }
      try { await batch.commit(); } catch (err: any) {
        console.warn(`Firestore bulkRestore [${collectionName}] chunk ${i}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 0));
    }
    return ids.length;
  },

  /** Permanently hard-delete docs that were already soft-deleted at least
   *  `olderThanDays` days ago. Intended for an admin "purge recycle bin"
   *  action — frees Firestore quota once an operator-set retention window
   *  has passed. */
  async purgeSoftDeleted(collectionName: string, olderThanDays: number = 30): Promise<number> {
    assertCanEdit('purge records');
    const cutoff = Date.now() - olderThanDays * 86400000;
    const all = (cachedData[collectionName] || []);
    const targets = all
      .filter((d: any) => d.deletedAt && new Date(d.deletedAt).getTime() < cutoff)
      .map((d: any) => d.id);
    if (targets.length === 0) return 0;
    // True hard-delete here — these have aged out of the soft-delete window.
    const BATCH_SIZE = 400;
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const chunk = targets.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      for (const id of chunk) batch.delete(docRef(collectionName, id));
      try { await batch.commit(); } catch (err: any) {
        console.warn(`Firestore purge [${collectionName}] chunk ${i}:`, err.message);
      }
    }
    const idSet = new Set(targets);
    cachedData[collectionName] = all.filter((d: any) => !idSet.has(d.id));
    emit(collectionName, cachedData[collectionName]);
    recordAudit('bulk_delete', collectionName, { count: targets.length });
    return targets.length;
  },

  // ── Disaster-recovery backup / restore ──────────────────────────────────────
  //
  // Layer-3 backup path (Layer 1 = Firestore PITR, Layer 2 = scheduled GCS
  // exports). Admin-only — exposed via Dashboard's "Download backup" button.
  // Restores merge per-doc, so they're safe to apply on a live DB without
  // losing concurrent edits made after the backup was taken.

  /** Read every known collection from Firestore and return a single JSON
   *  payload suitable for offsite storage. Bypasses the cache to guarantee
   *  the snapshot reflects the actual server state (no stale optimistic
   *  in-memory writes). Heavy — pulls every doc across collections. */
  async exportFullBackup(): Promise<{
    project:     string;
    exportedAt:  string;
    counts:      Record<string, number>;
    collections: Record<string, any[]>;
  }> {
    const collections: Record<string, any[]> = {};
    const counts: Record<string, number> = {};
    for (const name of Object.keys(COL)) {
      try {
        const snap = await getDocs(colRef(name));
        const data = snapToItems(snap);
        collections[name] = data;
        counts[name] = data.length;
      } catch (err: any) {
        // Don't bail the whole backup on one bad collection — log and
        // continue. Caller sees the partial counts in the result.
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(`[backup] failed to read ${name}:`, err?.message || err);
        }
        collections[name] = [];
        counts[name] = 0;
      }
    }
    return {
      project:    'gen-lang-client-0457133744',
      exportedAt: nowIso(),
      counts,
      collections,
    };
  },

  /** Restore from an exportFullBackup() payload. Writes every doc back via
   *  bulkCreate (merge:true under the hood) so existing docs get patched
   *  with the backup state, missing docs get created, and any docs that
   *  exist now but were absent at backup time are preserved.
   *
   *  Returns per-collection counts of docs written. Audit log entries
   *  appear automatically via bulkCreate's existing recordAudit() call. */
  async restoreFullBackup(
    backup: { collections: Record<string, any[]> },
    onProgress?: (collection: string, done: number, total: number) => void,
  ): Promise<Record<string, number>> {
    const written: Record<string, number> = {};
    for (const [collectionName, docs] of Object.entries(backup.collections ?? {})) {
      if (!Array.isArray(docs) || docs.length === 0) continue;
      const entries = docs
        .filter((d: any) => d && d.id)
        .map((d: any) => ({ collection: collectionName, id: d.id, data: d }));
      if (entries.length === 0) continue;
      await this.bulkCreate(entries, (done, total) => onProgress?.(collectionName, done, total));
      written[collectionName] = entries.length;
    }
    return written;
  },

  /**
   * Subscribe to a collection. By default, soft-deleted docs (those with
   * a `deletedAt` timestamp) are filtered out — the caller never sees
   * tombstones. The admin recycle-bin viewer opts in with
   * `subscribeToCollection(name, cb, { includeSoftDeleted: true })`.
   */
  subscribeToCollection(
    collectionName: string,
    callback: (data: any[]) => void,
    opts?: { includeSoftDeleted?: boolean },
  ) {
    const filterFn = opts?.includeSoftDeleted
      ? (rows: any[]) => rows
      : (rows: any[]) => rows.filter(r => !r.deletedAt);

    const wrapped = (rows: any[]) => callback(filterFn(rows));
    (listeners[collectionName] ??= []).push(wrapped);

    // Serve in-memory cache immediately
    if (cachedData[collectionName]?.length) {
      wrapped([...cachedData[collectionName]]);
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
      listeners[collectionName] = (listeners[collectionName] || []).filter(cb => cb !== wrapped);
    };
  },

  /** One-shot read. Soft-deleted docs are filtered out by default; pass
   *  `{ includeSoftDeleted: true }` to see tombstoned docs too. */
  async readAll(collectionName: string, opts?: { includeSoftDeleted?: boolean }) {
    if (cachedData[collectionName]?.length) {
      return opts?.includeSoftDeleted
        ? cachedData[collectionName]
        : cachedData[collectionName].filter((d: any) => !d.deletedAt);
    }
    const snap = await getDocs(colRef(collectionName));
    const data = snapToItems(snap);
    cachedData[collectionName] = data;
    return opts?.includeSoftDeleted ? data : data.filter((d: any) => !d.deletedAt);
  },

  /** Subscribe to only the SOFT-DELETED docs in a collection — powers the
   *  admin Recycle Bin. Convenience wrapper around subscribeToCollection. */
  subscribeToSoftDeleted(collectionName: string, callback: (data: any[]) => void) {
    return this.subscribeToCollection(
      collectionName,
      (rows) => callback(rows.filter(r => r.deletedAt)),
      { includeSoftDeleted: true },
    );
  },

  async resetDatabase() {
    Object.keys(cachedData).forEach(k => delete cachedData[k]);
    window.location.href = window.location.origin + '?reset=' + Date.now();
  },

  /** Empty every in-memory cache and notify all live listeners with [].
   *  Called right after a full wipe (ResetDataModal deletes Firestore docs
   *  directly, bypassing this cache) so the live UI — notably the Add Stock
   *  duplicate-IMEI check, which matches against cached `units` — immediately
   *  reflects the now-empty database instead of flagging false "IMEI exists". */
  clearLocalCache() {
    for (const k of Object.keys(cachedData)) {
      cachedData[k] = [];
      emit(k, []);
    }
  },

  // Accept any non-empty IMEI/serial verbatim — client data includes alphanumeric Apple
  // serials (e.g. "NL6CMQCYTD", "SKC9P3QVP6F") that are shorter than 14 chars.
  //
  // `activeOnly` (used by stock-intake paths) counts ONLY units that are still
  // live stock (status available/reserved). A previously sold / returned / lost
  // unit then does NOT count as a duplicate, so it can be re-intaken — its sale
  // and return history live in the `sales` / `returnEvents` collections keyed by
  // IMEI, so overwriting the unit doc loses nothing. Without this the inline
  // Add-Stock check (which already ignores sold/returned) and the save-path
  // check disagreed: the row looked fine but the save threw `duplicate_imei`.
  async imeiExists(imei: string, opts?: { activeOnly?: boolean }): Promise<boolean> {
    if (!imei) return false;
    // "Inactive" = the unit has left live stock and its IMEI is free to re-use.
    const INACTIVE = new Set(['sold', 'returned', 'lost']);
    const isLive = (u: any) =>
      !u?.deletedAt && (!opts?.activeOnly || !INACTIVE.has(u?.status));
    // For stock intake (activeOnly) be AUTHORITATIVE — read Firestore directly.
    // The local cache can hold a stale/optimistic record that no longer exists
    // in the database (e.g. left over from an earlier session or a wipe that
    // hadn't propagated), and trusting it here is what produced the bogus
    // "IMEI already in inventory" for units that aren't really there. Only the
    // non-intake collision checks keep the cache fast-path.
    if (!opts?.activeOnly) {
      const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei && isLive(u));
      if (cached) return true;
    }
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', imei)));
    return snap.docs.some(d => isLive(d.data()));
  },

  /** Authoritative (Firestore-direct) lookup of an ACTIVE unit by IMEI, with the
   *  identifying details for a duplicate warning. Returns null when no live unit
   *  carries that IMEI — used by Add Stock so the inline duplicate warning
   *  reflects the real database, never a stale/phantom cache entry. IMEI is
   *  upper-cased to match how intake stores it. */
  async findActiveByImei(imei: string): Promise<{ id: string; model: string; status: string; supplierName?: string; dateIn: string } | null> {
    const key = (imei || '').trim().toUpperCase();
    if (!key) return null;
    const INACTIVE = new Set(['sold', 'returned', 'lost']);
    const snap = await getDocs(query(colRef('inventoryUnits'), where('imei', '==', key)));
    for (const d of snap.docs) {
      const u: any = d.data();
      if (u?.deletedAt) continue;
      if (INACTIVE.has(u?.status)) continue;
      return { id: d.id, model: u.model || '?', status: u.status || '?', supplierName: u.supplierName, dateIn: u.dateIn || '?' };
    }
    return null;
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

  async updateByImei(imei: string, data: any) {
    // Operational write — IMEI backfill during stock intake routes here.
    assertCanWrite('edit unit by IMEI');
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
   * Log one event to the per-IMEI return lifecycle. Caller passes the
   * core fields (imei, type, date, comment) and we fill the actor,
   * timestamp, and id. Soft-fails on auth-less callers (returns null).
   */
  async createReturnEvent(input: {
    imei: string;
    type: import('../types').ReturnEventType;
    date: string;
    unitId?: string;
    comment?: string;
    supplierId?: string;
    supplierName?: string;
  }): Promise<string | null> {
    // Operational write — logging a return event is part of processing a
    // return, which the whole team may do.
    assertCanWrite('record return event');
    const user = auth.currentUser;
    if (!user) return null;
    const id = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const ts = nowIso();
    const entry = {
      id,
      imei: input.imei.trim().toUpperCase(),
      unitId: input.unitId,
      type: input.type,
      date: input.date,
      comment: input.comment?.trim() || undefined,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      actorUid: user.uid,
      actorEmail: user.email ?? '(unknown)',
      ownerId: 'shared',
      createdAt: ts,
    };
    await this.create('returnEvents', id, entry);
    return id;
  },

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
    // Operational write — stock-intake imports open a batch through here.
    assertCanWrite('create import batch');
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
    sales: Array<any & { marketplace: string; orderNumber: string }>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    // Prefer the parser's line-unique id (marketplace__orderNumber__<imei|sku>)
    // so a single order with multiple phones/SKUs creates one row PER line. Fall
    // back to the legacy (marketplace, orderNumber) key only when no id is set.
    const entries = sales.map(s => ({
      collection: 'sales',
      id: (s as any).id || `${s.marketplace}__${s.orderNumber}`,
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
