import { InventoryUnit } from '../types';

export type NotificationType = 'sold' | 'loss_sell' | 'new_stock' | 'return_processed' | 'shs_received';

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
}

const SOUNDS = {
  sold:              'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',  // Success chime
  loss_sell:         'https://assets.mixkit.co/active_storage/sfx/2372/2372-preview.mp3',  // Alert/warning sound
  new_stock:         'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3',  // Notification
  return_processed:  'https://assets.mixkit.co/active_storage/sfx/2811/2811-preview.mp3',  // Refresh/reload
  shs_received:      'https://assets.mixkit.co/active_storage/sfx/2892/2892-preview.mp3',  // Notification chime
};

const NOTIFS_KEY_PREFIX = 'nexus_notifs_';
const FIRED_KEY_PREFIX  = 'nexus_notif_fired_';

class NotificationService {
  private listeners: ((notifications: Notification[]) => void)[] = [];
  private notifications: Notification[] = [];
  private userId = 'anon';
  private playSoundTimeout: any = null;

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
      this.notifications = raw ? JSON.parse(raw) : [];
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

  addNotification(type: NotificationType, unit: InventoryUnit, profitAmount?: number) {
    const today   = new Date().toISOString().split('T')[0];
    // Key includes date so a re-sold unit on a different day fires again
    const firedKey = `${unit.id}_${type}_${today}`;

    // Already shown today — don't fire again on reload or real-time re-fetch
    if (this.getFiredSet().has(firedKey)) return;

    // In-memory guard for rapid duplicates within the same session (< 10s)
    const now = new Date();
    const isDuplicate = this.notifications.some(n =>
      n.unitId === unit.id &&
      n.type === type &&
      now.getTime() - new Date(n.timestamp).getTime() < 10000,
    );
    if (isDuplicate) return;

    const titles: Record<NotificationType, string> = {
      sold: '✅ Unit Sold!',
      loss_sell: '⚠️ Loss Sell Alert',
      new_stock: '📦 New Stock Added',
      return_processed: '↩️ Return Processed',
      shs_received: '🚚 SHS Order Received',
    };

    const messages: Record<NotificationType, string> = {
      sold: `${unit.model} (${unit.imei ? unit.imei.slice(-4) : unit.id.slice(-4)}) has been sold - Profit: £${profitAmount?.toFixed(2) || '0.00'}`,
      loss_sell: `⚠️ ${unit.model} sold at a LOSS of £${Math.abs(profitAmount || 0).toFixed(2)}`,
      new_stock: `${unit.model} is now in stock and ready for listing.`,
      return_processed: `${unit.model} has been returned and restored to inventory.`,
      shs_received: `${unit.model} from SHS order has been received.`,
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
    };

    this.notifications = [notification, ...this.notifications].slice(0, 50);
    this.markFired(firedKey);  // Persist so reload doesn't re-fire
    this.saveToStorage();
    this.notify();
    this.playSound(type);
  }

  markAsRead(id: string) {
    this.notifications = this.notifications.map(n => n.id === id ? { ...n, read: true } : n);
    this.saveToStorage();
    this.notify();
  }

  markAllAsRead() {
    this.notifications = this.notifications.map(n => ({ ...n, read: true }));
    this.saveToStorage();
    this.notify();
  }

  private playSound(type: NotificationType) {
    if (this.playSoundTimeout) return;
    const audio = new Audio(SOUNDS[type]);
    audio.play().catch(e => console.warn('Audio playback failed:', e));
    this.playSoundTimeout = setTimeout(() => { this.playSoundTimeout = null; }, 1000);
  }

  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }
}

export const notificationService = new NotificationService();
