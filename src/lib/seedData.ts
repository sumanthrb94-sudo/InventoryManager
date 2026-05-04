import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db, ensureAuthReady } from './firebase';
import { dbService, beginSeeding, endSeeding } from './dbService';

type SeedInventory = {
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

async function writeToFirestore(suppliers: Record<string, any>[], units: StoredUnit[]) {
  const CHUNK = 499;
  const now   = new Date().toISOString();
  const all   = [
    ...suppliers.map(s => ({ col: 'suppliers',     id: s.id, data: { ...s, createdAt: s.createdAt ?? now } })),
    ...units.map(u    => ({ col: 'inventoryUnits', id: u.id, data: { ...u, createdAt: u.createdAt ?? now, updatedAt: u.updatedAt ?? now } })),
  ];

  await ensureAuthReady();
  for (let i = 0; i < all.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const { col, id, data } of all.slice(i, i + CHUNK)) {
      batch.set(doc(db, col, id), data);
    }
    await batch.commit();
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function seedDefaultInventoryData(
  onProgress?: (loaded: number, total: number) => void,
) {
  if (typeof window === 'undefined') return;

  // Lock the gate FIRST so no subscriber can read stale cache
  beginSeeding();

  // Always try Firestore first — guarantees all devices see identical data
  try {
    await ensureAuthReady();
    const [sSnap, uSnap] = await Promise.all([
      getDocs(collection(db, 'suppliers')),
      getDocs(collection(db, 'inventoryUnits')),
    ]);

    if (uSnap.size > 0) {
      const suppliers = sSnap.docs.map(d => ({ ...d.data() as Record<string, any>, id: d.id }));
      const units     = uSnap.docs.map(d => ({ ...d.data() as Record<string, any>, id: d.id }));
      const total     = suppliers.length + units.length;

      // Update in-memory cache directly
      // dbService handles this via onSnapshot, but we can pre-populate for faster first paint
      onProgress?.(total, total);
      endSeeding(); // Release gate — onSnapshot will keep data live from here
      return;
    }
  } catch {
    // Not authenticated yet or Firestore unavailable — fall through to JSON seed
  }

  // ── Firestore empty / unreachable — seed from bundled master JSON ─────────
  let suppliers: Record<string, any>[];
  let units: StoredUnit[];
  try {
    const res = await fetch('/imported_inventory.json');
    if (!res.ok) { onProgress?.(1, 1); return; }
    const seed: SeedInventory = await res.json();
    if (!seed?.suppliers?.length || !seed?.units?.length) { onProgress?.(1, 1); return; }
    suppliers = seed.suppliers;
    units     = normaliseUnits(seed.units);
  } catch {
    endSeeding();
    onProgress?.(1, 1);
    return;
  }

  const total = suppliers.length + units.length;

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

  onProgress?.(total, total);

  // Push to Firestore so other devices pick it up via onSnapshot
  try {
    await writeToFirestore(suppliers, units);
  } catch (err) {
    console.warn('Failed to seed Firestore:', err);
  }

  // Release the gate so subscribers can now read the fresh data via onSnapshot
  endSeeding();
}
