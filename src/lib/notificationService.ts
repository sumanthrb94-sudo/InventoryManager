
import { InventoryUnit } from '../types';

export type NotificationType = 'sold' | 'new_stock';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  unitId: string;
  model: string;
  read: boolean;
}

const SOUNDS = {
  sold: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3', // Success/Cashier
  new_stock: 'https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3', // Ding
};

class NotificationService {
  private listeners: ((notifications: Notification[]) => void)[] = [];
  private notifications: Notification[] = [];

  constructor() {
    // Load today's notifications from localStorage
    const today = new Date().toISOString().split('T')[0];
    const saved = localStorage.getItem(`notifications_${today}`);
    if (saved) {
      try {
        this.notifications = JSON.parse(saved);
      } catch (e) {
        this.notifications = [];
      }
    }
  }

  private save() {
    const today = new Date().toISOString().split('T')[0];
    localStorage.setItem(`notifications_${today}`, JSON.stringify(this.notifications));
    this.notify();
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

  addNotification(type: NotificationType, unit: InventoryUnit) {
    // Check if we already have this notification for this unit in the last 10 seconds (to prevent duplicates from snapshots)
    const now = new Date();
    const isDuplicate = this.notifications.some(n => 
      n.unitId === unit.id && 
      n.type === type && 
      (now.getTime() - new Date(n.timestamp).getTime() < 10000)
    );

    if (isDuplicate) return;

    const notification: Notification = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title: type === 'sold' ? 'Unit Sold!' : 'New Stock Added',
      message: `${unit.model} (${unit.imei.slice(-4)}) ${type === 'sold' ? 'has been marked as sold.' : 'is now in stock.'}`,
      timestamp: now.toISOString(),
      unitId: unit.id,
      model: unit.model,
      read: false,
    };

    this.notifications = [notification, ...this.notifications].slice(0, 50); // Keep last 50
    this.save();
    this.playSound(type);
  }

  markAsRead(id: string) {
    this.notifications = this.notifications.map(n => n.id === id ? { ...n, read: true } : n);
    this.save();
  }

  markAllAsRead() {
    this.notifications = this.notifications.map(n => ({ ...n, read: true }));
    this.save();
  }

  private playSoundTimeout: any = null;

  private playSound(type: NotificationType) {
    // Debounce sound to play only once per burst (especially for bulk imports)
    if (this.playSoundTimeout) return;
    
    const audio = new Audio(SOUNDS[type]);
    audio.play().catch(e => console.warn('Audio playback failed:', e));
    
    this.playSoundTimeout = setTimeout(() => {
      this.playSoundTimeout = null;
    }, 1000); // Only play sound once per second
  }

  getUnreadCount() {
    return this.notifications.filter(n => !n.read).length;
  }
}

export const notificationService = new NotificationService();
