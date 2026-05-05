/**
 * Supabase database service with localStorage cache.
 * Pattern: localStorage served immediately; Supabase syncs in background.
 * All columns are snake_case in Supabase; app uses camelCase — converted automatically.
 */

import { supabase } from './supabase';

const LOCAL_CACHE_PREFIX = 'nexus_db_';
const listeners: Record<string, Array<(data: any[]) => void>> = {};
const cachedData: Record<string, any[]> = {};

// ── Table name mapping ────────────────────────────────────────────────────────
const TABLE_MAP: Record<string, string> = {
  inventoryUnits:  'inventory_units',
  suppliers:       'suppliers',
  inventoryEvents: 'inventory_events',
  dailyUpdates:    'daily_updates',
  activeListings:  'active_listings',
  sourceDocuments: 'source_documents',
};

function tableName(col: string): string {
  return TABLE_MAP[col] ?? col;
}

// ── camelCase ↔ snake_case ────────────────────────────────────────────────────
function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
// DB row → app object (snake_case keys → camelCase)
function dbToApp(row: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
}
// App object → DB row (camelCase → snake_case, strips fields not in schema)
function appToDb(obj: Record<string, any>): Record<string, any> {
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
  return () => { const i = _syncListeners.indexOf(cb); if (i >= 0) _syncListeners.splice(i, 1); };
}

// ── localStorage helpers ──────────────────────────────────────────────────────
function readLocalTable(collectionName: string): any[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_CACHE_PREFIX}${collectionName}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeLocalTable(collectionName: string, data: any[]) {
  try {
    localStorage.setItem(`${LOCAL_CACHE_PREFIX}${collectionName}`, JSON.stringify(data));
  } catch { /* quota exceeded */ }
}

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) cb([...data]);
}

function nowIso() { return new Date().toISOString(); }

export function clearAllLocalCaches() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(LOCAL_CACHE_PREFIX))
    .forEach(k => localStorage.removeItem(k));
}

// ── dbService ─────────────────────────────────────────────────────────────────
export const dbService = {

  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const newItem = { ...data, id, createdAt: data.createdAt ?? timestamp, updatedAt: timestamp };

    // Instant local write — UI never waits for Supabase
    const local = readLocalTable(collectionName);
    const idx = local.findIndex(item => item.id === id);
    if (idx >= 0) local[idx] = newItem; else local.push(newItem);
    writeLocalTable(collectionName, local);
    cachedData[collectionName] = local;
    emit(collectionName, local);

    // Background Supabase sync
    void supabase
      .from(tableName(collectionName))
      .upsert(appToDb(newItem))
      .then(({ error }) => {
        if (error) console.warn(`Supabase create [${collectionName}/${id}]:`, error.message);
      });
  },

  async update(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const local = readLocalTable(collectionName);
    const idx = local.findIndex(item => item.id === id);
    const updated = idx >= 0
      ? { ...local[idx], ...data, id, updatedAt: timestamp }
      : { ...data, id, updatedAt: timestamp };

    if (idx >= 0) local[idx] = updated; else local.push(updated);
    writeLocalTable(collectionName, local);
    cachedData[collectionName] = local;
    emit(collectionName, local);

    void supabase
      .from(tableName(collectionName))
      .upsert(appToDb(updated))
      .then(({ error }) => {
        if (error) console.warn(`Supabase update [${collectionName}/${id}]:`, error.message);
      });
  },

  async delete(collectionName: string, id: string) {
    const local = readLocalTable(collectionName).filter(item => item.id !== id);
    writeLocalTable(collectionName, local);
    cachedData[collectionName] = local;
    emit(collectionName, local);

    void supabase
      .from(tableName(collectionName))
      .delete()
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.warn(`Supabase delete [${collectionName}/${id}]:`, error.message);
      });
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void,
  ) {
    const timestamp = nowIso();
    const total = entries.length;
    let done = 0;

    // Group by collection
    const byCollection: Record<string, any[]> = {};
    for (const entry of entries) {
      const item = {
        ...entry.data,
        id: entry.id,
        ownerId: entry.data.ownerId || 'shared',
        createdAt: entry.data.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (!byCollection[entry.collection]) byCollection[entry.collection] = [];
      byCollection[entry.collection].push(item);
    }

    // 1. Write to localStorage instantly so UI never waits
    for (const [col, items] of Object.entries(byCollection)) {
      const existing = readLocalTable(col);
      for (const item of items) {
        const idx = existing.findIndex(e => e.id === item.id);
        if (idx >= 0) existing[idx] = item; else existing.push(item);
      }
      writeLocalTable(col, existing);
      cachedData[col] = existing;
      emit(col, existing);
    }

    // 2. Sync to Supabase in chunks of 100
    const CHUNK = 100;
    for (const [col, items] of Object.entries(byCollection)) {
      const rows = items.map(appToDb);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from(tableName(col)).upsert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(`Supabase bulkCreate [${col}]: ${error.message}`);
        done += Math.min(CHUNK, rows.length - i);
        onProgress?.(done, total);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    onProgress?.(total, total);
  },

  subscribeToCollection(collectionName: string, callback: (data: any[]) => void) {
    if (!listeners[collectionName]) listeners[collectionName] = [];
    listeners[collectionName].push(callback);

    let destroyed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: any = null;

    // Serve local cache immediately so UI is never blank
    const cached = readLocalTable(collectionName);
    if (cached.length > 0) {
      cachedData[collectionName] = cached;
      callback(cached);
    }

    const orderCol = collectionName === 'inventoryUnits' ? 'date_in' : 'created_at';

    const fetchLatest = async () => {
      const { data, error } = await supabase
        .from(tableName(collectionName))
        .select('*')
        .order(orderCol, { ascending: false })
        .limit(15000);
      if (error) throw error;
      return (data || []).map(dbToApp);
    };

    const connect = async () => {
      if (destroyed) return;
      try {
        const appData = await fetchLatest();
        if (destroyed) return;

        // Only update if Supabase has data (don't overwrite seed with empty)
        if (appData.length > 0) {
          cachedData[collectionName] = appData;
          writeLocalTable(collectionName, appData);
          emit(collectionName, appData);
        }
        setSyncStatus(true);

        // Real-time subscription — updates the local cache on any DB change
        channel = supabase
          .channel(`rt_${collectionName}_${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: tableName(collectionName) }, async () => {
            if (destroyed) return;
            try {
              const fresh = await fetchLatest();
              cachedData[collectionName] = fresh;
              writeLocalTable(collectionName, fresh);
              emit(collectionName, fresh);
            } catch { /* ignore mid-session refresh errors */ }
          })
          .subscribe(status => {
            if (status === 'SUBSCRIBED') setSyncStatus(true);
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              setSyncStatus(false);
              if (!destroyed) retryTimer = setTimeout(connect, 30000);
            }
          });

      } catch (err) {
        setSyncStatus(false);
        console.warn(`Supabase [${collectionName}] connection failed:`, err);
        if (!destroyed) retryTimer = setTimeout(connect, 30000);
      }
    };

    void connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
      listeners[collectionName] = (listeners[collectionName] || []).filter(cb => cb !== callback);
    };
  },

  async readAll(collectionName: string) {
    if (cachedData[collectionName]?.length) return cachedData[collectionName];
    const cached = readLocalTable(collectionName);
    if (cached.length > 0) {
      cachedData[collectionName] = cached;
      return cached;
    }
    const orderCol = collectionName === 'inventoryUnits' ? 'date_in' : 'created_at';
    const { data } = await supabase
      .from(tableName(collectionName))
      .select('*')
      .order(orderCol, { ascending: false });
    const appData = (data || []).map(dbToApp);
    cachedData[collectionName] = appData;
    writeLocalTable(collectionName, appData);
    return appData;
  },

  refreshFromLocalCache(collectionName: string) {
    const data = readLocalTable(collectionName);
    emit(collectionName, data);
  },

  async resetDatabase() {
    clearAllLocalCaches();
    window.location.href = window.location.origin + '?reset=' + Date.now();
  },
};
