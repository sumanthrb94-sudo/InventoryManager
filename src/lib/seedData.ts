import { supabase } from './supabase';
import { dbService, clearAllLocalCaches } from './dbService';

const MASTER_SEED_VERSION = 'client-v1';
const SEED_VERSION_KEY    = 'nexus_seed_version';

type SeedInventory = {
  version?: string;
  suppliers: Array<Record<string, any>>;
  units: Array<Record<string, any>>;
};
type StoredUnit = Record<string, any>;

// ── Inference helpers ─────────────────────────────────────────────────────────

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
    const model  = String(raw.model || '').trim();
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

// ── Background Supabase sync — non-blocking, fails silently ───────────────────
// Called AFTER localStorage is already populated. App continues from localStorage
// if Supabase is temporarily unavailable.
function syncToSupabaseInBackground(suppliers: Record<string, any>[], units: StoredUnit[]) {
  const toSnake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
  const appToDb = (obj: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(obj)
        .filter(([k, v]) => v !== undefined && k !== 'supplierName')
        .map(([k, v]) => [toSnake(k), v]),
    );

  const CHUNK = 100;
  void (async () => {
    try {
      // Upsert suppliers
      for (let i = 0; i < suppliers.length; i += CHUNK) {
        const { error } = await supabase
          .from('suppliers')
          .upsert(suppliers.slice(i, i + CHUNK).map(appToDb));
        if (error) throw error;
      }
      // Upsert inventory units
      for (let i = 0; i < units.length; i += CHUNK) {
        const { error } = await supabase
          .from('inventory_units')
          .upsert(units.slice(i, i + CHUNK).map(appToDb));
        if (error) throw error;
      }
    } catch {
      // Supabase unavailable — localStorage is source of truth, that's fine
    }
  })();
}

// ── Return date migration (one-time fix) ──────────────────────────────────────

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
  } catch { /* ignore */ }
}

// ── Seed from bundled JSON → localStorage (no network dependency) ─────────────
// Returns true if data was successfully written, false if fetch failed.
async function seedFromMasterJSON(onProgress?: (loaded: number, total: number) => void): Promise<boolean> {
  let suppliers: Record<string, any>[];
  let units: StoredUnit[];
  try {
    const res = await fetch('/master_seed.json');
    if (!res.ok) { onProgress?.(1, 1); return false; }
    const seed: SeedInventory = await res.json();
    if (!seed?.suppliers?.length || !seed?.units?.length) { onProgress?.(1, 1); return false; }
    suppliers = seed.suppliers;
    units     = normaliseUnits(seed.units);
  } catch { onProgress?.(1, 1); return false; }

  const total = suppliers.length + units.length;

  // Suppliers first (small — instant)
  localStorage.setItem('nexus_db_suppliers', JSON.stringify(suppliers));
  dbService.refreshFromLocalCache('suppliers');
  onProgress?.(suppliers.length, total);

  // Units in chunks, yielding to the browser between each chunk
  const unitCache: StoredUnit[] = [];
  const CHUNK = 500;
  for (let i = 0; i < units.length; i++) {
    unitCache.push(units[i]);
    if ((i + 1) % CHUNK === 0 || i === units.length - 1) {
      localStorage.setItem('nexus_db_inventoryUnits', JSON.stringify(unitCache));
      dbService.refreshFromLocalCache('inventoryUnits');
      onProgress?.(suppliers.length + i + 1, total);
      await new Promise(r => setTimeout(r, 0)); // yield to browser
    }
  }

  onProgress?.(total, total);

  // Sync to Supabase after localStorage is already live (fire-and-forget)
  syncToSupabaseInBackground(suppliers, units);

  return true;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function seedDefaultInventoryData(
  onProgress?: (loaded: number, total: number) => void,
) {
  if (typeof window === 'undefined') return;

  migrateReturnDates();

  // Already on current version AND data exists — nothing to do
  if (localStorage.getItem(SEED_VERSION_KEY) === MASTER_SEED_VERSION) return;

  // Version mismatch — seed from bundled JSON into localStorage first.
  // Only mark as seeded if data was actually written successfully.
  const ok = await seedFromMasterJSON(onProgress);
  if (ok) localStorage.setItem(SEED_VERSION_KEY, MASTER_SEED_VERSION);
}

// Exported so clearAllLocalCaches is available to other modules
export { clearAllLocalCaches };
