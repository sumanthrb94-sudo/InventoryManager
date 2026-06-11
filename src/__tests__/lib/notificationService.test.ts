// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { notificationService, NotificationType } from '../../lib/notificationService';
import { InventoryUnit } from '../../types';

// notificationService is a process-wide singleton: its in-memory notifications
// list survives across tests, and the localStorage `fired` key dedupes same-day
// repeats. Two consequences for the test setup:
//   1) `notificationService.clear()` resets the in-memory list AND wipes the
//      per-user fired key, so each test starts from a clean slate.
//   2) `new_stock` / `shs_received` are batched (500 ms setTimeout) when called
//      without an explicit count. Tests that want a synchronous notification
//      pass `count = 1` to take the direct path.

describe('NotificationService', () => {
  const mockUnit: InventoryUnit = {
    id: 'unit_001',
    imei: '359108096724237',
    model: 'iPhone 15 Pro',
    brand: 'Apple',
    category: 'iPhone',
    colour: 'Black',
    buyPrice: 450,
    dateIn: '2026-05-06',
    supplierId: 'sup_001',
    status: 'sold',
    flags: [],
    notes: '',
    platformListed: false,
    listingSites: [],
    ownerId: 'shared',
    createdAt: new Date().toISOString(),
    batchId: 'master_batch',
  };

  beforeEach(() => {
    localStorage.clear();
    notificationService.setUser('test_user_001');
    notificationService.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    notificationService.clear();
    localStorage.clear();
  });

  describe('Notification Creation', () => {
    it('should create a profit notification for positive profit', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 520.46);

      expect(notifications.length).toBeGreaterThan(0);
      const notif = notifications[0];
      expect(notif.type).toBe('sold');
      expect(notif.title).toBe('✅ Unit Sold!');
      expect(notif.profitAmount).toBe(520.46);
      expect(notif.read).toBe(false);
    });

    it('should create a loss notification for negative profit', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('loss_sell', mockUnit, -70.54);

      expect(notifications.length).toBeGreaterThan(0);
      const notif = notifications[0];
      expect(notif.type).toBe('loss_sell');
      expect(notif.title).toBe('⚠️ Loss Sell Alert');
      expect(notif.profitAmount).toBe(-70.54);
    });
  });

  describe('Notification Types', () => {
    // new_stock + shs_received are batched (500 ms setTimeout) when called
    // without an explicit count — pass count=1 to take the synchronous path.
    it('should handle new_stock notification', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('new_stock', mockUnit, undefined, 1);

      const notif = notifications[0];
      expect(notif.type).toBe('new_stock');
      expect(notif.title).toBe('📦 New Stock Added');
    });

    it('should handle return_processed notification', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('return_processed', mockUnit);

      const notif = notifications[0];
      expect(notif.type).toBe('return_processed');
      expect(notif.title).toBe('↩️ Return Processed');
    });

    it('should handle shs_received notification', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('shs_received', mockUnit, undefined, 1);

      const notif = notifications[0];
      expect(notif.type).toBe('shs_received');
      expect(notif.title).toBe('🚚 SHS Order Received');
    });
  });

  describe('Deduplication', () => {
    it('should not fire duplicate notifications on same day for same unit', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 520);
      const firstNotif = notifications.length;

      notificationService.addNotification('sold', mockUnit, 520);
      const secondNotif = notifications.length;

      expect(secondNotif).toBe(firstNotif);
    });

    it('should allow duplicate notifications on different days', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 520);
      const after1st = notifications.length;

      // Simulate a new day by wiping the fired-key set (clear() also wipes
      // notifications, so we re-add to verify the dedupe gate is what was
      // blocking the second add).
      notificationService.clear();
      notificationService.addNotification('sold', mockUnit, 520);
      const after2nd = notifications.length;

      expect(after1st).toBeGreaterThan(0);
      expect(after2nd).toBeGreaterThan(0);
    });
  });

  describe('Subscription Management', () => {
    it('should notify all subscribers of new notification', () => {
      const sub1: any[] = [];
      const sub2: any[] = [];

      notificationService.subscribe((notifs) => {
        sub1.length = 0;
        sub1.push(...notifs);
      });
      notificationService.subscribe((notifs) => {
        sub2.length = 0;
        sub2.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);

      expect(sub1.length).toBeGreaterThan(0);
      expect(sub2.length).toBeGreaterThan(0);
      expect(sub1[0].id).toBe(sub2[0].id);
    });

    it('should unsubscribe listeners', () => {
      const notifications: any[] = [];
      const unsub = notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);
      const firstCount = notifications.length;

      unsub();
      notificationService.addNotification('sold', { ...mockUnit, id: 'unit_002' }, 500);

      // After unsubscribing, the captured array no longer receives updates.
      expect(notifications.length).toBe(firstCount);
    });
  });

  describe('Mark as Read', () => {
    it('should mark notification as read', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);
      const notifId = notifications[0].id;

      notificationService.markAsRead(notifId);

      expect(notifications[0].read).toBe(true);
    });

    it('should mark all as read', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);
      notificationService.addNotification('new_stock', mockUnit, undefined, 1);

      notificationService.markAllAsRead();

      notifications.forEach(n => {
        expect(n.read).toBe(true);
      });
    });
  });

  describe('Unread Count', () => {
    it('should return correct unread count', () => {
      notificationService.subscribe(() => {});

      notificationService.addNotification('sold', mockUnit, 500);
      notificationService.addNotification('new_stock', mockUnit, undefined, 1);

      expect(notificationService.getUnreadCount()).toBe(2);
    });

    it('should decrease unread count when marking as read', () => {
      let notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications = notifs;
      });

      notificationService.addNotification('sold', mockUnit, 500);
      expect(notificationService.getUnreadCount()).toBe(1);

      notificationService.markAsRead(notifications[0].id);
      expect(notificationService.getUnreadCount()).toBe(0);
    });
  });

  describe('User Switching', () => {
    it('should handle user changes', () => {
      let notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications = notifs;
      });

      notificationService.setUser('user_switch_001');
      notificationService.addNotification('sold', mockUnit, 500);

      const count1 = notifications.length;

      notificationService.setUser('user_switch_002');

      expect(count1).toBeGreaterThan(0);
    });
  });
});
