import { collection, doc, getDoc, getDocs, setDoc, writeBatch, query, limit } from 'firebase/firestore';
import { db, ensureAuthReady } from './firebase';
import { dbService, clearAllLocalCaches } from './dbService';

// Increment this string whenever you upload a new master Excel file.
// Every device that sees a version mismatch will wipe + re-seed automatically.
const MASTER_SEED_VERSION = 'client-v1';
const SEED_VERSION_KEY    = 'nexus_seed_version';
const META_DOC            = '_meta/seedVersion';

type SeedInventory = {
  version?: string;
  suppliers: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
};
type StoredUnit = Record<string, any>;

// ── Inference helpers ────────────────────────────────────────────────────────

function inferBrand(model: string, fallback?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPHONE') || m.includes('IPAD') || m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('MACBOOK') || m.includes('AIRPODS')) return 'Apple';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) return 'Samsung';
  return fallback || 'Other';
}

function inferCategory(model: string, fallback?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('IPHONE')) return 'iPhone';
  if (m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE')) return 'Apple Watch';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S')) return 'Galaxy Tab';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    if (m.includes(' A') || /\bA\d{2}\b/.test(m) || /\bA\d{3}\b/.test(m)) return 'Galaxy A Series';
    return 'Galaxy S Series';
  }
  return fallback || 'Other';
}

function inferColour(model: string, fallback?: string) {
  if (fallback && fallback !== 'Unknown') return fallback;
  const upper = model.toUpperCase();
  const colours = [
    'NATURAL TITANIUM','BLACK TITANIUM','WHITE TITANIUM','BLUE TITANIUM','DESERT TITANIUM',
    'PACIFIC BLUE','SIERRA BLUE','ALPINE GREEN','SPACE GREY','SPACE GRAY','GRAPHITE',
    'STARLIGHT','MIDNIGHT','BLACK','WHITE','BLUE','GOLD','SILVER','ROSE GOLD','ROSE',
    'RED','GREEN','YELLOW','PURPLE','CORAL','MINT','PINK','TEAL','ORANGE','CREAM',
    'LAVENDER','PHANTOM BLACK','PHANTOM WHITE','PHANTOM SILVER',
  ];
  for (const c of colours) {
    if (upper.includes(c)) {
      if (c === 'SPACE GREY' || c === 'SPACE GRAY') return 'Space Grey';
      return c.charAt(0) + c.slice(1).toLowerCase();
    }
  }
  return fallback || 'Unknown';
}

function normaliseUnits(units: StoredUnit[]): StoredUnit[] {
  const deduped = new Map<string, StoredUnit>();
  for (const raw of units) {
    if (!raw?.id) continue;
    const model = String(raw.model || '').trim();
    const isSold = raw.status === 'sold';
    deduped.set(raw.id, {
      ...raw,
      model,
      brand:    inferBrand(model, raw.brand),
      category: inferCategory(model, raw.category),
      colour:   inferColour(model, raw.colour),
      status:   isSold ? 'sold' : raw.status || 'available',
      platformListed: isSold ? false : Boolean(raw.platformListed),
      ...(isSold && (raw.saleDate || raw.dateIn) ? { saleDate: raw.saleDate || raw.dateIn } : {}),
    });
  }
  return Array.from(deduped.values());
}

// ── Firestore helpers ────────────────────────────────────────────────────────

function writeToFirestoreBackground(suppliers: Record<string, any>[], units: StoredUnit[]) {
  const CHUNK = 499;
  const now   = new Date().toISOString();
  const all   = [
    ...suppliers.map(s => ({ col: 'suppliers',     id: s.id, data: { ...s, createdAt: s.createdAt ?? now } })),
    ...units.map(u    => ({ col: 'inventoryUnits', id: u.id, data: { ...u, createdAt: u.createdAt ?? now, updatedAt: u.updatedAt ?? now } })),
  ];

  (async () => {
    try {
      await ensureAuthReady();
      for (let i = 0; i < all.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const { col, id, data } of all.slice(i, i + CHUNK)) {
          batch.set(doc(db, col, id), data);
        }
        await batch.commit();
      }
      // Write meta doc so other devices know Firestore is already at this version
      await setDoc(doc(db, META_DOC.split('/')[0], META_DOC.split('/')[1]), { version: MASTER_SEED_VERSION });
    } catch {
      // Firestore rules may not be deployed — localStorage covers local device
    }
  })();
}

async function wipeFirestoreCollections() {
  const colNames = ['inventoryUnits', 'suppliers'];
  for (const colName of colNames) {
    while (true) {
      const snap = await getDocs(query(collection(db, colName), limit(499)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      if (snap.docs.length < 499) break;
    }
  }
}

// ── One-time migration ────────────────────────────────────────────────────────

function migrateReturnDates() {
  const KEY = 'nexus_db_inventoryUnits';
  try {
    const units: StoredUnit[] = JSON.parse(localStorage.getItem(KEY) || '[]');
    let dirty = false;
    const fixed = units.map(u => {
      if (u.status === 'returned' && u.returnDate && u.createdAt === u.updatedAt) {
        dirty = true;
        const { returnDate: _r, ...rest } = u;
        return rest;
      }
      return u;
    });
    if (dirty) {
      localStorage.setItem(KEY, JSON.stringify(fixed));
      dbService.refreshFromLocalCache('inventoryUnits');
    }
  } catch { /* ignore parse errors */ }
}

// ── JSON seed helper ─────────────────────────────────────────────────────────

async function seedFromMasterJSON(onProgress?: (loaded: number, total: number) => void) {
  let suppliers: Record<string, any>[];
  let units: StoredUnit[];
  try {
    const res = await fetch('/master_seed.json');
    if (!res.ok) { onProgress?.(1, 1); return; }
    const seed: SeedInventory = await res.json();
    if (!seed?.suppliers?.length || !seed?.units?.length) { onProgress?.(1, 1); return; }
    suppliers = seed.suppliers;
    units     = normaliseUnits(seed.units);
  } catch { onProgress?.(1, 1); return; }

  const total = suppliers.length + units.length;

  localStorage.setItem('nexus_db_suppliers', JSON.stringify(suppliers));
  dbService.refreshFromLocalCache('suppliers');
  onProgress?.(suppliers.length, total);

  const unitCache: StoredUnit[] = [];
  const YIELD_EVERY = 1000;
  for (let i = 0; i < units.length; i++) {
    unitCache.push(units[i]);
    if ((i + 1) % YIELD_EVERY === 0 || i === units.length - 1) {
      onProgress?.(suppliers.length + i + 1, total);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  localStorage.setItem('nexus_db_inventoryUnits', JSON.stringify(unitCache));
  dbService.refreshFromLocalCache('inventoryUnits');
  onProgress?.(total, total);

  // Push to Firestore in background so all other devices pick it up via onSnapshot
  writeToFirestoreBackground(suppliers, units);
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function seedDefaultInventoryData(
  onProgress?: (loaded: number, total: number) => void,
) {
  if (typeof window === 'undefined') return;

  migrateReturnDates();

  const localVersion = localStorage.getItem(SEED_VERSION_KEY);

  // ── Fast path: this device already seeded the current master version ─────────
  if (localVersion === MASTER_SEED_VERSION) {
    // Firestore subscription (onSnapshot) handles all future sync — nothing to do
    return;
  }

  // ── Version mismatch — need to force-reseed ──────────────────────────────────
  // First check: has ANOTHER device already seeded Firestore to this version?
  let firestoreAlreadySeeded = false;
  try {
    await ensureAuthReady();
    const metaSnap = await getDoc(doc(db, '_meta', 'seedVersion'));
    if (metaSnap.exists() && metaSnap.data()?.version === MASTER_SEED_VERSION) {
      firestoreAlreadySeeded = true;
    }
  } catch {
    // Auth not ready or Firestore unavailable
  }

  if (firestoreAlreadySeeded) {
    // Firestore already has master-v1 data — wipe local cache so onSnapshot
    // overwrites it with the canonical Firestore data
    clearAllLocalCaches();
    localStorage.setItem(SEED_VERSION_KEY, MASTER_SEED_VERSION);
    // onSnapshot in dbService will fire shortly with the Firestore data
    onProgress?.(1, 1);
    return;
  }

  // ── This device is first — wipe Firestore and seed from master JSON ──────────
  clearAllLocalCaches();

  try {
    await ensureAuthReady();
    await wipeFirestoreCollections();
  } catch {
    // Firestore unavailable — seed locally only; Firestore sync happens in background
  }

  await seedFromMasterJSON(onProgress);
  localStorage.setItem(SEED_VERSION_KEY, MASTER_SEED_VERSION);
}
