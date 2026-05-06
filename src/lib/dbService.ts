/**
 * Supabase database service — pure Supabase, no localStorage cache.
 * In-memory cache (cachedData) is used for instant re-renders within the session only.
 * All columns are snake_case in Supabase; app uses camelCase — converted automatically.
 */

import { supabase } from './supabase';

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

// ── camelCase ↔ snake_case (exported for testing) ────────────────────────────
export function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}
export function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
export function dbToApp(row: Record<string, any>): Record<string, any> {
  const obj = Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
  if (!Array.isArray(obj.flags)) obj.flags = [];
  if (!Array.isArray(obj.listingSites)) obj.listingSites = [];
  return obj;
}
export function appToDb(obj: Record<string, any>): Record<string, any> {
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

function emit(collectionName: string, data: any[]) {
  for (const cb of listeners[collectionName] || []) cb([...data]);
}

function nowIso() { return new Date().toISOString(); }

// ── dbService ─────────────────────────────────────────────────────────────────
export const dbService = {

  async create(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const newItem = { ...data, id, createdAt: data.createdAt ?? timestamp, updatedAt: timestamp };

    // Optimistic in-memory update so UI is instant
    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(item => item.id === id);
    if (idx >= 0) current[idx] = newItem; else current.push(newItem);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    const { error } = await supabase
      .from(tableName(collectionName))
      .upsert(appToDb(newItem));
    if (error) console.warn(`Supabase create [${collectionName}/${id}]:`, error.message);
  },

  async update(collectionName: string, id: string, data: any) {
    const timestamp = nowIso();
    const current = [...(cachedData[collectionName] || [])];
    const idx = current.findIndex(item => item.id === id);
    const updated = idx >= 0
      ? { ...current[idx], ...data, id, updatedAt: timestamp }
      : { ...data, id, updatedAt: timestamp };

    if (idx >= 0) current[idx] = updated; else current.push(updated);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    const { error } = await supabase
      .from(tableName(collectionName))
      .upsert(appToDb(updated));
    if (error) console.warn(`Supabase update [${collectionName}/${id}]:`, error.message);
  },

  async delete(collectionName: string, id: string) {
    const current = (cachedData[collectionName] || []).filter(item => item.id !== id);
    cachedData[collectionName] = current;
    emit(collectionName, current);

    const { error } = await supabase
      .from(tableName(collectionName))
      .delete()
      .eq('id', id);
    if (error) console.warn(`Supabase delete [${collectionName}/${id}]:`, error.message);
  },

  async bulkCreate(
    entries: Array<{ collection: string; id: string; data: any }>,
    onProgress?: (done: number, total: number) => void,
  ) {
    const timestamp = nowIso();
    const total = entries.length;
    let done = 0;

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

    // Sync to Supabase in chunks
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

    // Serve in-memory cache immediately if we already fetched this session
    if (cachedData[collectionName]?.length) {
      callback([...cachedData[collectionName]]);
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

        cachedData[collectionName] = appData;
        emit(collectionName, appData);
        setSyncStatus(true);

        channel = supabase
          .channel(`rt_${collectionName}_${Date.now()}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: tableName(collectionName) }, async () => {
            if (destroyed) return;
            try {
              const fresh = await fetchLatest();
              cachedData[collectionName] = fresh;
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
    const orderCol = collectionName === 'inventoryUnits' ? 'date_in' : 'created_at';
    const { data } = await supabase
      .from(tableName(collectionName))
      .select('*')
      .order(orderCol, { ascending: false });
    const appData = (data || []).map(dbToApp);
    cachedData[collectionName] = appData;
    return appData;
  },

  async resetDatabase() {
    Object.keys(cachedData).forEach(k => delete cachedData[k]);
    window.location.href = window.location.origin + '?reset=' + Date.now();
  },

  async imeiExists(imei: string): Promise<boolean> {
    if (!imei || imei.length < 14) return false;
    const { data } = await supabase
      .from('inventory_units')
      .select('imei')
      .eq('imei', imei)
      .single();
    return !!data;
  },

  async getByImei(imei: string): Promise<any | null> {
    const cached = (cachedData['inventoryUnits'] || []).find((u: any) => u.imei === imei);
    if (cached) return cached;
    const { data, error } = await supabase
      .from('inventory_units')
      .select('*')
      .eq('imei', imei)
      .single();
    if (error) return null;
    return data ? dbToApp(data) : null;
  },

  async updateByImei(imei: string, data: any) {
    const timestamp = nowIso();
    const current = [...(cachedData['inventoryUnits'] || [])];
    const idx = current.findIndex((item: any) => item.imei === imei);
    const updated = idx >= 0
      ? { ...current[idx], ...data, imei, updatedAt: timestamp }
      : { ...data, imei, updatedAt: timestamp };
    if (idx >= 0) current[idx] = updated;
    cachedData['inventoryUnits'] = current;
    emit('inventoryUnits', current);
    const { error } = await supabase
      .from('inventory_units')
      .update(appToDb(updated))
      .eq('imei', imei);
    if (error) console.warn(`Supabase updateByImei [${imei}]:`, error.message);
  },
};
