/**
 * firestoreShim — an in-memory stand-in for the Firestore SDK, aliased
 * over `firebase/firestore` when the app is built with VITE_E2E=1.
 *
 * Purpose: drive the REAL UI in a browser (Playwright screenshots,
 * click-through verification) without credentials or a network. Every
 * layer above this shim is production code — dbService, the service
 * layer, every component — so what the screenshots show is what ships.
 *
 * Scope is deliberately narrow: the exact surface src/ imports, with the
 * semantics that change behaviour (merge writes, serverTimestamp,
 * deleteField, live onSnapshot). It is NOT a Firestore emulator, and it
 * is never bundled into a normal build.
 */
import { E2E_SEED } from './seedData';

type Doc = Record<string, any>;
const store: Record<string, Record<string, Doc>> = {};
const listeners: Record<string, Array<(snap: any) => void>> = {};

const SERVER_TS = '__E2E_SERVER_TIMESTAMP__';
const DELETE_FIELD = '__E2E_DELETE_FIELD__';

function col(name: string): Record<string, Doc> {
  return (store[name] ??= {});
}

function nowIso() { return new Date().toISOString(); }

function resolveValues(data: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = v === SERVER_TS ? nowIso() : v;
  }
  return out;
}

// Core write, no persist/emit — used directly by writeBatch so a 400-doc
// batch does ONE persist+emit at the end instead of 400. Real Firestore's
// batch commit is a single atomic op with a single listener update; doing
// it per-doc here (as applyWrite/removeDoc below still do, for the
// single-doc setDoc/deleteDoc paths) turned a multi-hundred-row bulk import
// into a full-store JSON.stringify + snapshot rebuild + listener fan-out
// PER ROW — minutes of UI-blocking work for an import that's a handful of
// batched network calls against real Firestore.
function applyWriteCore(name: string, id: string, data: Doc, merge: boolean): void {
  const resolved = resolveValues(data);
  const base = merge ? { ...(col(name)[id] || {}) } : {};
  for (const [k, v] of Object.entries(resolved)) {
    if (v === DELETE_FIELD) delete base[k];
    else base[k] = v;
  }
  col(name)[id] = { ...base, id };
}

function removeDocCore(name: string, id: string): void {
  delete col(name)[id];
}

function applyWrite(name: string, id: string, data: Doc, merge: boolean): void {
  applyWriteCore(name, id, data, merge);
  persist();
  emit(name);
}

function removeDoc(name: string, id: string): void {
  removeDocCore(name, id);
  persist();
  emit(name);
}

function snapshotOf(name: string) {
  const docs = Object.values(col(name)).map(d => ({
    id: d.id,
    data: () => ({ ...d }),
    exists: () => true,
    ref: { path: `${name}/${d.id}`, id: d.id, __col: name },
  }));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (fn: (d: any) => void) => docs.forEach(fn),
  };
}

function emit(name: string): void {
  for (const cb of listeners[name] || []) cb(snapshotOf(name));
}

// ── Persistence ──────────────────────────────────────────────────────────────
// The store survives reloads via sessionStorage. Without this a wipe would
// be undone by the reload ResetDataModal triggers, and any multi-page flow
// (import → confirm → reload → verify) would silently test the seed data
// instead of the operator's writes.
const STORAGE_KEY = '__e2e_firestore__';

function persist(): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* quota — fine */ }
}

function restore(): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    Object.assign(store, JSON.parse(raw));
    return true;
  } catch { return false; }
}

// ── Seeding ──────────────────────────────────────────────────────────────────
let seeded = false;
function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;
  // ?e2eReset=1 forces the pristine dataset back, for a repeatable run.
  const forceReset = new URLSearchParams(window.location.search).get('e2eReset') === '1';
  if (!forceReset && restore()) return;
  for (const k of Object.keys(store)) delete store[k];
  for (const [name, docs] of Object.entries(E2E_SEED)) {
    for (const d of docs as Doc[]) col(name)[d.id] = { ...d };
  }
  persist();
}

// ── SDK surface ──────────────────────────────────────────────────────────────
export function initializeApp(config: any) { return { name: '[DEFAULT]', options: config }; }
export function getFirestore(_app?: any, _id?: string) { ensureSeeded(); return { __e2e: true }; }
export function getStorage(_app?: any, _bucket?: string) { return { __e2e: true }; }

export function collection(_db: any, name: string) { return { __col: name, path: name }; }
/**
 * Firestore's `doc()` has three call shapes, and this stand-in only
 * implemented one of them.
 *
 *   doc(db, 'collection', 'id')   — used by docRef() everywhere
 *   doc(collectionRef)            — mint an auto id
 *   doc(collectionRef, 'id')      — target an id in that collection
 *
 * The last two are what `createImportBatch` uses. Under this shim they
 * produced `{ __col: <the collection ref object>, id: undefined }`, so the
 * write went nowhere: importBatches was always empty in E2E, and the
 * Operations Hub's "Last Import" panel could never be verified here — the
 * harness silently swallowed the very code path a test would be checking.
 *
 * Auto ids are minted from a counter rather than randomness so a run stays
 * reproducible.
 */
let autoIdSeq = 0;
export function doc(dbOrColRef: any, name?: string, id?: string) {
  // doc(db, name, id)
  if (typeof name === 'string' && typeof id === 'string') {
    return { __col: name, id, path: `${name}/${id}` };
  }
  // doc(collectionRef) / doc(collectionRef, id)
  const col = dbOrColRef?.__col;
  if (typeof col === 'string') {
    const docId = typeof name === 'string' ? name : `e2e_auto_${++autoIdSeq}`;
    return { __col: col, id: docId, path: `${col}/${docId}` };
  }
  throw new Error('e2e firestoreShim: doc() called with an unrecognised reference');
}

export async function getDocs(ref: any) {
  ensureSeeded();
  const name = ref.__col;
  const snap = snapshotOf(name);
  if (!ref.__constraints?.length) return snap;
  let docs = snap.docs;
  for (const c of ref.__constraints) {
    if (c.type === 'where') {
      docs = docs.filter(d => {
        const v = d.data()[c.field];
        switch (c.op) {
          case '==': return v === c.value;
          case '!=': return v !== c.value;
          case 'in': return Array.isArray(c.value) && c.value.includes(v);
          case '>':  return v > c.value;
          case '>=': return v >= c.value;
          case '<':  return v < c.value;
          case '<=': return v <= c.value;
          default:   return true;
        }
      });
    }
    if (c.type === 'orderBy') {
      docs = [...docs].sort((a, b) => {
        const av = a.data()[c.field], bv = b.data()[c.field];
        const cmp = av > bv ? 1 : av < bv ? -1 : 0;
        return c.dir === 'desc' ? -cmp : cmp;
      });
    }
  }
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn: any) => docs.forEach(fn) };
}

export async function getDoc(ref: any) {
  ensureSeeded();
  const d = col(ref.__col)[ref.id];
  return { exists: () => !!d, data: () => (d ? { ...d } : undefined), id: ref.id, ref };
}

export async function setDoc(ref: any, data: Doc, options?: { merge?: boolean }) {
  applyWrite(ref.__col, ref.id, data, options?.merge !== false);
}

export async function deleteDoc(ref: any) { removeDoc(ref.__col, ref.id); }

/**
 * `?e2eSnapshotError=1` makes every listener fail instead of emitting.
 *
 * WHY A TEST-ONLY SWITCH FOR THIS
 *
 * A Firestore snapshot ERROR — denied rules, blown read quota, a dead
 * connection — is the one failure that makes the app render a complete,
 * confident zero: every collection serves an empty cache, so All Office Stock,
 * Sold Today and Stock Alerts all read 0 and Stock Alerts announces "all stock
 * levels healthy". It is pixel-identical to a wiped database, and the operator
 * hit it for real and reasonably concluded their data was gone.
 *
 * This shim ignored its onError argument entirely, so that state could not be
 * reached in a test and nothing guarded it. Being unreachable in the harness is
 * precisely why it shipped. One flag makes the worst screen in the app
 * reproducible on demand.
 */
function snapshotsShouldFail(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('e2eSnapshotError') === '1';
}

export function onSnapshot(ref: any, onNext: (snap: any) => void, onError?: (e: any) => void) {
  ensureSeeded();
  const name = ref.__col;
  if (snapshotsShouldFail()) {
    // Shaped like the real thing: the SDK hands back a FirebaseError whose
    // `code` is what dbService logs and a human would paste back.
    setTimeout(() => onError?.(Object.assign(
      new Error('Missing or insufficient permissions.'),
      { code: 'permission-denied', name: 'FirebaseError' },
    )), 0);
    return () => {};
  }
  (listeners[name] ??= []).push(onNext);
  // Async first emit mirrors the real SDK, so components see a loading tick.
  setTimeout(() => onNext(snapshotOf(name)), 0);
  return () => {
    listeners[name] = (listeners[name] || []).filter(cb => cb !== onNext);
  };
}

export function query(ref: any, ...constraints: any[]) {
  return { ...ref, __constraints: constraints };
}
export function where(field: string, op: string, value: any) { return { type: 'where', field, op, value }; }
export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc') { return { type: 'orderBy', field, dir }; }
export function limit(n: number) { return { type: 'limit', n }; }

export function writeBatch(_db: any) {
  const ops: Array<() => void> = [];
  const touched = new Set<string>();
  return {
    set: (ref: any, data: Doc, options?: { merge?: boolean }) => {
      touched.add(ref.__col);
      ops.push(() => applyWriteCore(ref.__col, ref.id, data, options?.merge !== false));
    },
    update: (ref: any, data: Doc) => {
      touched.add(ref.__col);
      ops.push(() => applyWriteCore(ref.__col, ref.id, data, true));
    },
    delete: (ref: any) => {
      touched.add(ref.__col);
      ops.push(() => removeDocCore(ref.__col, ref.id));
    },
    commit: async () => {
      for (const op of ops) op();
      persist();
      for (const name of touched) emit(name);
    },
  };
}

export async function runTransaction<T>(_db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  const tx = {
    get: async (ref: any) => getDoc(ref),
    set: (ref: any, data: Doc, options?: { merge?: boolean }) =>
      applyWrite(ref.__col, ref.id, data, options?.merge !== false),
    update: (ref: any, data: Doc) => applyWrite(ref.__col, ref.id, data, true),
    delete: (ref: any) => removeDoc(ref.__col, ref.id),
  };
  return fn(tx);
}

export function serverTimestamp() { return SERVER_TS; }
export function deleteField() { return DELETE_FIELD; }

export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  static now() { return new Timestamp(Math.floor(Date.now() / 1000), 0); }
  static fromDate(d: Date) { return new Timestamp(Math.floor(d.getTime() / 1000), 0); }
  toDate() { return new Date(this.seconds * 1000); }
}

export type QuerySnapshot<T = any> = ReturnType<typeof snapshotOf>;
export type DocumentData = Record<string, any>;
export type Transaction = any;
export type DocumentReference = any;
export type CollectionReference = any;

// ── Auth ─────────────────────────────────────────────────────────────────────
/** Which persona the harness is signed in as — set via ?e2eUser=employee. */
function currentPersona(): { uid: string; email: string; displayName: string } {
  const param = new URLSearchParams(window.location.search).get('e2eUser');
  return param === 'employee'
    ? { uid: 'e2e-employee', email: 'ops1@inventorymanager.com', displayName: 'Ops One' }
    : { uid: 'e2e-admin', email: 'admin@inventorymanager.com', displayName: 'Admin' };
}

export function getAuth(_app?: any) {
  const user = currentPersona();
  return {
    currentUser: user,
    authStateReady: async () => {},
    signOut: async () => {},
  };
}

export function onAuthStateChanged(auth: any, cb: (u: any) => void) {
  setTimeout(() => cb(auth?.currentUser ?? currentPersona()), 0);
  return () => {};
}

export async function signInWithEmailAndPassword(_auth: any, email: string) {
  return { user: { uid: 'e2e', email } };
}
export async function signOut(_auth: any) {}
export type User = any;
