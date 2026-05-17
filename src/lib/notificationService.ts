import { InventoryUnit } from '../types';
import { parseBrandModelStorage } from './modelStorage';

export type NotificationType = 'sold' | 'loss_sell' | 'new_stock' | 'return_processed' | 'shs_received' | 'shs_removed' | 'unit_repaired';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  unitId: string;
  model: string;
  read: boolean;
  profitAmount?: number;
  quantity?: number;
  /** SKU dedupe key — `${brand}|${model}|${storage}|${colour}` — set on stored
   *  notifications so the next addNotification can find & increment an
   *  existing same-SKU entry instead of pushing a new row. */
  skuKey?: string;
}

/** Window during which a new same-SKU notification is rolled into an existing
 *  one (incrementing its count rather than pushing a new entry).
 *  10 minutes — long enough to fold a 640-unit import (which trickles in over
 *  seconds) and a follow-up scan a few minutes later, but short enough that
 *  units scanned an hour later get their own fresh notification. */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
/** Only scan this far back through the notifications list when looking for a
 *  same-SKU entry to merge into — bounds the per-call work to O(30). */
const DEDUP_SCAN_DEPTH = 30;

/**
 * Build a stable SKU key for a unit so notifications can dedupe across the
 * "field-split" vs "single-string model" divide. Legacy units carry
 * `model: "SAMSUNG S21 128GB"` (everything in one string); new units carry
 * `brand: "Samsung", model: "S21", storage: "128GB"`. Both should produce the
 * same key so a batch containing a mix still groups under one notification.
 */
export function skuKeyOf(unit: InventoryUnit): string {
  // Prefer the pre-split fields when present — they're already normalised at
  // import time. Fall back to parseBrandModelStorage on the raw model string
  // for legacy docs that never got re-imported.
  const hasSplitFields = !!(unit.brand && unit.storage);
  let brand: string;
  let model: string;
  let storage: string;
  if (hasSplitFields) {
    brand = unit.brand;
    model = unit.model;
    storage = unit.storage || '';
  } else {
    const parsed = parseBrandModelStorage(unit.model);
    brand = unit.brand || parsed.brand;
    model = parsed.model || unit.model || '';
    storage = unit.storage || parsed.storage || '';
  }
  const colour = unit.colour || '';
  return `${brand}|${model}|${storage}|${colour}`.toUpperCase();
}

const SOUNDS = {
  sold:              'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',  // Success chime
  loss_sell:         'https://assets.mixkit.co/active_storage/sfx/2372/2372-preview.mp3',  // Alert/warning sound
  new_stock:         'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',  // Notification
  return_processed:  'https://assets.mixkit.co/active_storage/sfx/2811/2811-preview.mp3',  // Refresh/reload
  shs_received:      'https://assets.mixkit.co/active_storage/sfx/2892/2892-preview.mp3',  // Notification chime
  shs_removed:       'https://assets.mixkit.co/active_storage/sfx/2372/2372-preview.mp3',  // Alert/warning sound
  unit_repaired:     'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',  // Success chime
};

const NOTIFS_KEY_PREFIX = 'nexus_notifs_';
const FIRED_KEY_PREFIX  = 'nexus_notif_fired_';

class NotificationService {
  private listeners: ((notifications: Notification[]) => void)[] = [];
  private notifications: Notification[] = [];
  private userId = 'anon';
  private playSoundTimeout: any = null;
  private batchBuffer: { type: NotificationType; unit: InventoryUnit; profitAmount?: number }[] = [];
  private batchTimeout: any = null;
  private readonly BATCH_WINDOW_MS = 500;
  // Panel retention window: notifications older than this drop off
  // automatically. Loaded once on construction so the interval ticks even
  // if no one is interacting with the bell.
  private readonly RETENTION_HOURS = 24;
  private cleanupInterval: any = null;

  constructor() {
    // Browser-only: every 5 minutes prune anything older than the
    // retention window. saveToStorage + notify only run when something
    // actually changes, so this is cheap when there's nothing to drop.
    if (typeof window !== 'undefined') {
      this.cleanupInterval = setInterval(() => {
        this.pruneExpired();
      }, 5 * 60 * 1000);
    }
  }

  /** Drop notifications older than RETENTION_HOURS. Idempotent — only
   *  saves + notifies when something actually got removed. */
  private pruneExpired() {
    const cutoff = Date.now() - this.RETENTION_HOURS * 60 * 60 * 1000;
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(n => {
      const t = new Date(n.timestamp).getTime();
      return Number.isFinite(t) && t > cutoff;
    });
    if (this.notifications.length !== before) {
      this.saveToStorage();
      this.notify();
    }
  }

  // Called once login is confirmed — loads persisted notifications for this user
  setUser(uid: string) {
    if (this.userId === uid) return;
    this.userId = uid;
    this.loadFromStorage();
    this.notify();
  }

  private notifsKey() { return `${NOTIFS_KEY_PREFIX}${this.userId}`; }
  private firedKey()  { return `${FIRED_KEY_PREFIX}${this.userId}`; }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(this.notifsKey());
      if (!raw) {
        this.notifications = [];
        return;
      }
      const loaded = JSON.parse(raw);
      // Keep everything from the last 24h, read or unread. The banner toast
      // surfaces the unread ones briefly, but the panel keeps both for the
      // full 24h retention window. Older entries are pruned here on load
      // (and periodically by the cleanup interval below).
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.notifications = loaded.filter((n: Notification) => {
        const t = new Date(n.timestamp).getTime();
        return Number.isFinite(t) && t > cutoff;
      });
    } catch { this.notifications = []; }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(this.notifsKey(), JSON.stringify(this.notifications));
    } catch { /* storage quota */ }
  }

  // Returns the set of already-fired event keys (survives reloads)
  private getFiredSet(): Set<string> {
    try {
      const raw = localStorage.getItem(this.firedKey());
      if (!raw) return new Set();
      const entries: { key: string; date: string }[] = JSON.parse(raw);
      // Only keep last 7 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      return new Set(entries.filter(e => e.date >= cutoffStr).map(e => e.key));
    } catch { return new Set(); }
  }

  // Marks a notification event as fired so it won't re-trigger on reload
  private markFired(key: string) {
    try {
      const raw = localStorage.getItem(this.firedKey());
      const entries: { key: string; date: string }[] = raw ? JSON.parse(raw) : [];
      const today = new Date().toISOString().split('T')[0];
      if (!entries.some(e => e.key === key)) {
        entries.push({ key, date: today });
      }
      // Prune entries older than 7 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      localStorage.setItem(this.firedKey(), JSON.stringify(entries.filter(e => e.date >= cutoffStr)));
    } catch { /* ignore */ }
  }

  private notify() {
    this.listeners.forEach(l => l([...this.notifications]));
  }

  subscribe(callback: (notifications: Notification[]) => void) {
    this.listeners.push(callback);
    callback([...this.notifications]);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private processBatch() {
    if (this.batchBuffer.length === 0) return;

    const first = this.batchBuffer[0];
    const batchableTypes = ['new_stock', 'shs_received'];
    const isBatchable = batchableTypes.includes(first.type);

    if (isBatchable && this.batchBuffer.length > 1) {
      // Check if all items in batch are the same model and type
      const allSameModel = this.batchBuffer.every(b => b.unit.model === first.unit.model && b.type === first.type);
      if (allSameModel) {
        console.log('[Notification Batch] Processing batch:', { type: first.type, count: this.batchBuffer.length, model: first.unit.model });
        this.addNotificationDirect(first.type, first.unit, first.profitAmount, this.batchBuffer.length);
        this.batchBuffer = [];
        return;
      }
    }

    // Process items individually if not batchable
    console.log('[Notification Batch] Items not batchable, processing individually:', this.batchBuffer.length);
    for (const item of this.batchBuffer) {
      this.addNotificationDirect(item.type, item.unit, item.profitAmount, 1);
    }
    this.batchBuffer = [];
  }

  addNotification(type: NotificationType, unit: InventoryUnit, profitAmount?: number, count?: number) {
    // For bulk additions like new_stock and shs_received, use batching
    const batchableTypes = ['new_stock', 'shs_received'];
    if (batchableTypes.includes(type) && !count) {
      console.log('[Notification Batch] Adding to buffer:', { type, model: unit.model, bufferSize: this.batchBuffer.length + 1 });
      this.batchBuffer.push({ type, unit, profitAmount });

      if (this.batchTimeout) clearTimeout(this.batchTimeout);
      this.batchTimeout = setTimeout(() => this.processBatch(), this.BATCH_WINDOW_MS);
      return;
    }

    // For explicit counts or non-batchable types, process immediately
    console.log('[Notification Direct] Processing immediately:', { type, count, model: unit.model });
    this.addNotificationDirect(type, unit, profitAmount, count);
  }

  private addNotificationDirect(type: NotificationType, unit: InventoryUnit, profitAmount?: number, count?: number) {
    // Check if this notification was already fired (persisted across page reloads)
    const firedKey = `${unit.id}:${type}`;
    try {
      const raw = localStorage.getItem(this.firedKey());
      const entries: { key: string; date: string }[] = raw ? JSON.parse(raw) : [];
      const today = new Date().toISOString().split('T')[0];

      // Check if this specific unit+type was already fired today
      if (entries.some(e => e.key === firedKey && e.date === today)) {
        console.log(`[Notification] Already fired today: ${firedKey}`);
        return;
      }
    } catch { /* ignore */ }

    // In-memory guard for rapid duplicates within the same session (< 5s)
    // This prevents notification spam if the same action fires multiple times
    const now = new Date();
    const isDuplicate = this.notifications.some(n =>
      n.unitId === unit.id &&
      n.type === type &&
      now.getTime() - new Date(n.timestamp).getTime() < 5000,
    );
    if (isDuplicate) {
      console.log(`[Notification] Duplicate prevented: ${unit.id} ${type} (< 5s ago)`);
      return;
    }

    const incomingCount = count && count > 0 ? count : 1;
    const skuKey = skuKeyOf(unit);
    const todayIso = now.toISOString().split('T')[0];

    // Same-SKU dedupe: scan the most recent N notifications. If we find one
    // matching (type, skuKey) on the SAME day and within the dedupe window,
    // increment its count and bump its timestamp instead of pushing a new
    // entry. This is what collapses a 640-unit import down to a handful of
    // "N× <model>" rows, one per distinct SKU.
    //
    // Skipped for `sold` / `loss_sell` because those are explicitly
    // per-unit events (each sale carries its own profit/IMEI and the user
    // wants to see them separately).
    const mergeableTypes: NotificationType[] = ['new_stock', 'shs_received', 'shs_removed', 'return_processed', 'unit_repaired'];
    if (mergeableTypes.includes(type)) {
      const scanLimit = Math.min(this.notifications.length, DEDUP_SCAN_DEPTH);
      for (let i = 0; i < scanLimit; i++) {
        const existing = this.notifications[i];
        if (existing.type !== type) continue;
        if (existing.skuKey !== skuKey) continue;
        if (!existing.timestamp.startsWith(todayIso)) continue;
        const age = now.getTime() - new Date(existing.timestamp).getTime();
        if (age > DEDUP_WINDOW_MS) continue;

        // Found a recent same-SKU notification — fold this one into it.
        const newCount = (existing.quantity || 1) + incomingCount;
        const updated: Notification = {
          ...existing,
          quantity: newCount,
          timestamp: now.toISOString(),
          title: this.buildTitle(type, newCount),
          message: this.buildMessage(type, unit, newCount, profitAmount),
          read: false,
        };
        this.notifications = [
          updated,
          ...this.notifications.slice(0, i),
          ...this.notifications.slice(i + 1),
        ].slice(0, 100);
        this.saveToStorage();
        this.notify();
        this.markFired(firedKey);
        console.log(`[Notification] Merged into existing same-SKU entry: ${skuKey} now ${newCount}×`);
        // Don't replay the sound on every merged unit — keeps the import
        // from sounding like a slot machine.
        return;
      }
    }

    console.log(`[Notification] Adding ${type} for ${unit.model}`, { profitAmount, skuKey });

    const notification: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title: this.buildTitle(type, incomingCount),
      message: this.buildMessage(type, unit, incomingCount, profitAmount),
      timestamp: now.toISOString(),
      unitId: unit.id,
      model: unit.model,
      read: false,
      profitAmount,
      quantity: incomingCount,
      skuKey,
    };

    this.notifications = [notification, ...this.notifications].slice(0, 100);
    this.saveToStorage();
    this.notify();

    // Mark this notification as fired so it won't trigger again on reload
    this.markFired(firedKey);

    this.playSound(type);
  }

  private buildTitle(type: NotificationType, count: number): string {
    const plural = count > 1;
    switch (type) {
      case 'sold':             return '✅ Unit Sold!';
      case 'loss_sell':        return '⚠️ Loss Sell Alert';
      case 'new_stock':        return plural ? `📦 ${count} Units Added to Stock`  : '📦 New Stock Added';
      case 'return_processed': return plural ? `↩️ ${count} Returns Processed`     : '↩️ Return Processed';
      case 'shs_received':     return plural ? `🚚 ${count} SHS Units Received`    : '🚚 SHS Order Received';
      case 'shs_removed':      return plural ? `❌ ${count} SHS Units Removed`     : '❌ SHS Stock Removed';
      case 'unit_repaired':    return plural ? `🔧 ${count} Units Repaired`        : '🔧 Unit Repaired & Added to Inventory';
    }
  }

  private buildMessage(type: NotificationType, unit: InventoryUnit, count: number, profitAmount?: number): string {
    const plural = count > 1;
    switch (type) {
      case 'sold':             return `${unit.model} (${unit.imei ? unit.imei.slice(-4) : unit.id.slice(-4)}) has been sold - Profit: £${profitAmount?.toFixed(2) || '0.00'}`;
      case 'loss_sell':        return `⚠️ ${unit.model} sold at a LOSS of £${Math.abs(profitAmount || 0).toFixed(2)}`;
      case 'new_stock':        return plural ? `${count} × ${unit.model} units are now in stock and ready for listing.`        : `${unit.model} is now in stock and ready for listing.`;
      case 'return_processed': return plural ? `${count} × ${unit.model} units have been returned and restored to inventory.` : `${unit.model} has been returned and restored to inventory.`;
      case 'shs_received':     return plural ? `${count} × ${unit.model} units from SHS order have been received.`            : `${unit.model} from SHS order has been received.`;
      case 'shs_removed':      return plural ? `${count} × ${unit.model} SHS units removed from pending stock.`               : `${unit.model} SHS pending stock has been removed.`;
      case 'unit_repaired':    return plural ? `${count} × ${unit.model} units have been repaired and added back to inventory.` : `${unit.model} has been repaired and added back to inventory.`;
    }
  }

  /** Flag a notification as 'banner seen' / 'read' without removing it from
   *  the panel. Dismissing the toast (auto-hide or X button) calls this —
   *  the unread badge clears, but the entry stays in the panel for the
   *  full 24h retention window. To remove from the panel entirely, use
   *  dismissFromPanel(id). */
  markAsRead(id: string) {
    let changed = false;
    this.notifications = this.notifications.map(n => {
      if (n.id === id && !n.read) { changed = true; return { ...n, read: true }; }
      return n;
    });
    if (changed) {
      this.saveToStorage();
      this.notify();
    }
  }

  /** Mark every notification as read (kills the unread badge) but keeps
   *  them in the panel until the 24h cleanup or an explicit dismiss. */
  markAllAsRead() {
    let changed = false;
    this.notifications = this.notifications.map(n => {
      if (!n.read) { changed = true; return { ...n, read: true }; }
      return n;
    });
    // Drain any pending batch buffer so an in-flight 500ms flush can't
    // resurrect a notification the user just acknowledged.
    this.batchBuffer = [];
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    if (changed) {
      this.saveToStorage();
      this.notify();
    }
  }

  /** Remove a single notification from the panel entirely. Use for per-row
   *  dismiss in the bell dropdown; banner dismissals should use markAsRead. */
  dismissFromPanel(id: string) {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this.saveToStorage();
    this.notify();
  }

  private playSound(type: NotificationType) {
    if (this.playSoundTimeout) {
      console.warn('[Sound] Sound already playing, skipping');
      return;
    }
    const soundUrl = SOUNDS[type];
    console.log(`[Sound] Playing sound for ${type}: ${soundUrl}`);
    const audio = new Audio(soundUrl);
    audio.play()
      .then(() => console.log(`[Sound] ${type} sound played successfully`))
      .catch(e => console.warn(`[Sound] Audio playback failed for ${type}:`, e));
    this.playSoundTimeout = setTimeout(() => { this.playSoundTimeout = null; }, 1000);
  }

  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }

  clearAll() {
    this.notifications = [];
    this.batchBuffer = [];
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.saveToStorage();
    this.notify();
  }

  clearOldNotifications(hoursOld: number = 24) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursOld);
    this.notifications = this.notifications.filter(n => new Date(n.timestamp) > cutoff);
    this.saveToStorage();
    this.notify();
  }

  // Hard reset — used when mock data is loaded so per-day dedupe keys
  // (the firedKey set in localStorage) also get wiped, otherwise old
  // dedupe markers would suppress notifications for the freshly seeded
  // units.
  clear() {
    this.notifications = [];
    this.saveToStorage();
    try {
      localStorage.removeItem(this.firedKey());
    } catch { /* ignore */ }
    this.notify();
  }
}

export const notificationService = new NotificationService();
