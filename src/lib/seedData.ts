import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db, ensureAuthReady } from './firebase';
import { dbService } from './dbService';

type SeedInventory = {
  suppliers: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
};
type StoredUnit = Record<string, any>;

// ── Inference helpers ────────────────────────────────────────────────────────

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

async function firestoreCount(col: string) {
  const snap = await getDocs(collection(db, col));
  return snap.size;
}

function writeToFirestoreBackground(suppliers: Record<string, any>[], units: StoredUnit[]) {
  const CHUNK = 499;
  const now   = new Date().toISOString();
  const all   = [
    ...suppliers.map(s => ({ col: 'suppliers',     id: s.id, data: { ...s, createdAt: s.createdAt ?? now } })),
    ...units.map(u    => ({ col: 'inventoryUnits', id: u.id, data: { ...u, createdAt: u.createdAt ?? now, updatedAt: u.updatedAt ?? now } })),
  ];

  // Fire-and-forget — don't await, don't block UI
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
    } catch {
      // Firestore rules may not be deployed — localStorage covers local device
    }
  })();
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function seedDefaultInventoryData(
  onProgress?: (loaded: number, total: number) => void,
) {
  if (typeof window === 'undefined') return;

  // ── Already seeded locally? Done. ────────────────────────────────────────
  // onSnapshot will override this with live Firestore data once connected.
  const cachedUnits = (() => {
    try { return JSON.parse(localStorage.getItem('nexus_db_inventoryUnits') || '[]'); }
    catch { return []; }
  })();
  if (cachedUnits.length > 0) return;

  // ── Fetch seed file ───────────────────────────────────────────────────────
  // Don't check Firestore first — seed localStorage immediately so every
  // new device shows data right away. onSnapshot corrects it with live data.
  let suppliers: Record<string, any>[];
  let units: StoredUnit[];
  try {
    const res = await fetch('/imported_inventory.json');
    if (!res.ok) return;
    const seed: SeedInventory = await res.json();
    if (!seed?.suppliers?.length || !seed?.units?.length) return;
    suppliers = seed.suppliers;
    units     = normaliseUnits(seed.units);
  } catch { return; }

  const total = suppliers.length + units.length;

  // ── Write suppliers to localStorage (tiny, instant) ──────────────────────
  localStorage.setItem('nexus_db_suppliers', JSON.stringify(suppliers));
  dbService.refreshFromLocalCache('suppliers');
  onProgress?.(suppliers.length, total);

  // ── Write units in chunks — yield every 1000 so the browser stays live ───
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
  dbService.refreshFromLocalCache('inventoryUnits'); // triggers all dashboard listeners
  onProgress?.(total, total); // dismiss loading screen

  // ── Firestore write in background (non-blocking) ─────────────────────────
  // Lets other devices pick up data via onSnapshot once rules are deployed.
  writeToFirestoreBackground(suppliers, units);
}
