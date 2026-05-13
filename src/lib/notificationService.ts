import { InventoryUnit } from '../types';

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
      const loaded: Notification[] = JSON.parse(raw);
      // Keep the past 24 hours regardless of read/unread state so the
      // bell preserves history. Anything older is dropped (the bell's
      // own Clear button explicitly trims to <24h too).
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      this.notifications = loaded.filter(n => {
        const ts = new Date(n.timestamp).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
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

    console.log(`[Notification] Adding ${type} for ${unit.model}`, { profitAmount });

    const titles: Record<NotificationType, string> = {
      sold: '✅ Unit Sold!',
      loss_sell: '⚠️ Loss Sell Alert',
      new_stock: count && count > 1 ? `📦 ${count} Units Added to Stock` : '📦 New Stock Added',
      return_processed: '↩️ Return Processed',
      shs_received: count && count > 1 ? `🚚 ${count} SHS Units Received` : '🚚 SHS Order Received',
      shs_removed: count && count > 1 ? `❌ ${count} SHS Units Removed` : '❌ SHS Stock Removed',
      unit_repaired: '🔧 Unit Repaired & Added to Inventory',
    };

    const messages: Record<NotificationType, string> = {
      sold: `${unit.model} (${unit.imei ? unit.imei.slice(-4) : unit.id.slice(-4)}) has been sold - Profit: £${profitAmount?.toFixed(2) || '0.00'}`,
      loss_sell: `⚠️ ${unit.model} sold at a LOSS of £${Math.abs(profitAmount || 0).toFixed(2)}`,
      new_stock: count && count > 1 ? `${count} × ${unit.model} units are now in stock and ready for listing.` : `${unit.model} is now in stock and ready for listing.`,
      return_processed: `${unit.model} has been returned and restored to inventory.`,
      shs_received: count && count > 1 ? `${count} × ${unit.model} units from SHS order have been received.` : `${unit.model} from SHS order has been received.`,
      shs_removed: count && count > 1 ? `${count} × ${unit.model} SHS units removed from pending stock.` : `${unit.model} SHS pending stock has been removed.`,
      unit_repaired: `${unit.model} has been repaired and added back to inventory.`,
    };

    const notification: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title: titles[type],
      message: messages[type],
      timestamp: now.toISOString(),
      unitId: unit.id,
      model: unit.model,
      read: false,
      profitAmount,
      quantity: count,
    };

    this.notifications = [notification, ...this.notifications].slice(0, 100);
    this.saveToStorage();
    this.notify();

    // Mark this notification as fired so it won't trigger again on reload
    this.markFired(firedKey);

    this.playSound(type);
  }

  // Flip the read flag rather than deleting — the bell's "Today /
  // Yesterday / Earlier" list shows read notifications too, so we
  // preserve the 24-hour history. Counters drop because they filter
  // on !n.read.
  markAsRead(id: string) {
    let changed = false;
    this.notifications = this.notifications.map(n => {
      if (n.id !== id || n.read) return n;
      changed = true;
      return { ...n, read: true };
    });
    if (changed) {
      this.saveToStorage();
      this.notify();
    }
  }

  markAllAsRead() {
    let changed = false;
    this.notifications = this.notifications.map(n => {
      if (n.read) return n;
      changed = true;
      return { ...n, read: true };
    });
    if (changed) {
      this.saveToStorage();
      this.notify();
    }
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
