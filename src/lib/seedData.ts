import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db, ensureAuthReady } from './firebase';
import { dbService } from './dbService';

type SeedInventory = {
  suppliers: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
};

type StoredUnit = Record<string, any>;

function parseLocalCollection(key: string): any[] {
  try {
    const raw = localStorage.getItem(`nexus_db_${key}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function inferBrand(model: string, fallback?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPHONE') || m.includes('IPAD') || m.includes('APPLE WATCH') || m.includes('IWATCH')) return 'Apple';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) return 'Samsung';
  return fallback || 'Other';
}

function inferCategory(model: string, fallback?: string) {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('IPHONE')) return 'iPhone';
  if (m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE')) return 'Apple Watch';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S') || m.includes('TAB')) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    if (m.includes(' A') || /\bA\d{2}\b/.test(m) || /\bA\d{3}\b/.test(m)) return 'Samsung A Series';
    return 'Samsung S Series';
  }
  return fallback || 'Other';
}

function inferColour(model: string, fallback?: string) {
  if (fallback && fallback !== 'Unknown') return fallback;
  const upper = model.toUpperCase();
  const colours = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM', 'DESERT TITANIUM',
    'PACIFIC BLUE', 'SIERRA BLUE', 'ALPINE GREEN', 'SPACE GREY', 'SPACE GRAY', 'GRAPHITE',
    'STARLIGHT', 'MIDNIGHT', 'BLACK', 'WHITE', 'BLUE', 'GOLD', 'SILVER', 'ROSE GOLD', 'ROSE',
    'RED', 'GREEN', 'YELLOW', 'PURPLE', 'CORAL', 'MINT', 'PINK', 'TEAL', 'ORANGE', 'CREAM',
    'LAVENDER', 'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
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
      brand: inferBrand(model, raw.brand),
      category: inferCategory(model, raw.category),
      colour: inferColour(model, raw.colour),
      status: isSold ? 'sold' : raw.status || 'available',
      platformListed: isSold ? false : Boolean(raw.platformListed),
      ...(isSold && (raw.saleDate || raw.dateIn) ? { saleDate: raw.saleDate || raw.dateIn } : {}),
    });
  }
  return Array.from(deduped.values());
}

async function firestoreCount(collectionName: string): Promise<number> {
  const snap = await getDocs(collection(db, collectionName));
  return snap.size;
}

async function writeToFirestore(suppliers: Record<string, any>[], units: StoredUnit[]) {
  const CHUNK = 499;
  const now = new Date().toISOString();
  const all = [
    ...suppliers.map(s => ({ col: 'suppliers',     id: s.id, data: { ...s, createdAt: s.createdAt ?? now } })),
    ...units.map(u    => ({ col: 'inventoryUnits', id: u.id, data: { ...u, createdAt: u.createdAt ?? now, updatedAt: u.updatedAt ?? now } })),
  ];
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const { col, id, data } of all.slice(i, i + CHUNK)) batch.set(doc(db, col, id), data);
    await batch.commit();
  }
}

export async function seedDefaultInventoryData() {
  if (typeof window === 'undefined') return;

  // ── 1. Already seeded into localStorage? Done. ────────────────────────────
  // dbService serves localStorage to all components instantly on subscribe,
  // so if data is here the UI is already populated.
  if (parseLocalCollection('inventoryUnits').length > 0) return;

  // ── 2. Try to read Firestore count (may fail if rules not deployed yet) ───
  try {
    await ensureAuthReady();
    const [sc, uc] = await Promise.all([
      firestoreCount('suppliers'),
      firestoreCount('inventoryUnits'),
    ]);
    if (sc > 0 && uc > 0) {
      // Firestore has data — onSnapshot will pull it; nothing to do.
      return;
    }
  } catch {
    // Firestore not readable (rules not yet deployed or network offline).
    // Continue — we'll seed localStorage so the UI shows data immediately.
  }

  // ── 3. Load seed file ─────────────────────────────────────────────────────
  let suppliers: Record<string, any>[];
  let units: StoredUnit[];
  try {
    const res = await fetch('/imported_inventory.json');
    if (!res.ok) return;
    const seed: SeedInventory = await res.json();
    if (!seed?.suppliers?.length || !seed?.units?.length) return;
    suppliers = seed.suppliers;
    units = normaliseUnits(seed.units);
  } catch {
    return;
  }

  // ── 4. Write via dbService.bulkCreate ────────────────────────────────────
  // This writes to localStorage FIRST (triggering all active subscribeToCollection
  // listeners immediately so the UI updates), then tries Firestore best-effort.
  // If Firestore rules aren't deployed yet the localStorage write still succeeds.
  await dbService.bulkCreate([
    ...suppliers.map(s => ({ collection: 'suppliers',     id: s.id, data: s })),
    ...units.map(u    => ({ collection: 'inventoryUnits', id: u.id, data: u })),
  ]);

  // ── 5. Also try a direct Firestore write so other devices pick it up ──────
  // Best-effort — ignore failures (rules may not be deployed yet).
  try {
    await ensureAuthReady();
    await writeToFirestore(suppliers, units);
  } catch {
    // Silent — localStorage is serving as the data source for now.
  }
}
