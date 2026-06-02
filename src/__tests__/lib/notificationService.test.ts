// @vitest-environment jsdom
// notificationService spies on HTMLMediaElement.prototype.play — that
// global only exists under the jsdom env, not vitest's default 'node'.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { notificationService, NotificationType } from '../../lib/notificationService';
import { InventoryUnit } from '../../types';

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
    // Hard reset both the in-memory notifications AND localStorage's
    // dedupe keys, otherwise a prior test's notification bleeds into the
    // current one and the order-sensitive 'expected X to be Y' assertions
    // throw on the wrong notification.
    notificationService.clear();
    localStorage.clear();
    notificationService.setUser('test_user_001');
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
        notifications.length = 0; notifications.push(...notifs);
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
        notifications.length = 0; notifications.push(...notifs);
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
    it('should handle new_stock notification', async () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.length = 0; notifications.push(...notifs);
      });

      notificationService.addNotification('new_stock', mockUnit);
      // new_stock is batched (500ms window) — wait for the buffer to flush.
      await new Promise(r => setTimeout(r, 600));

      const notif = notifications[0];
      expect(notif?.type).toBe('new_stock');
      expect(notif?.title).toContain('New Stock');
    });

    it('should handle return_processed notification', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0; notifications.push(...notifs);
      });

      notificationService.addNotification('return_processed', mockUnit);

      const notif = notifications[0];
      expect(notif.type).toBe('return_processed');
      expect(notif.title).toBe('↩️ Return Processed');
    });

    it('should handle shs_received notification', async () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.length = 0; notifications.push(...notifs);
      });

      notificationService.addNotification('shs_received', mockUnit);
      // shs_received is batched too — wait for the buffer to flush.
      await new Promise(r => setTimeout(r, 600));

      const notif = notifications[0];
      expect(notif?.type).toBe('shs_received');
      expect(notif?.title).toContain('SHS');
    });
  });

  describe('Deduplication', () => {
    it('should not fire duplicate notifications on same day for same unit', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0; notifications.push(...notifs);
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
        notifications.length = 0; notifications.push(...notifs);
      });

      // First notification
      notificationService.addNotification('sold', mockUnit, 520);
      const after1st = notifications.length;

      // Simulate a fresh day — clear BOTH the persisted fired-set in
      // localStorage AND the in-memory state via clear(). localStorage
      // alone leaves the in-memory dedupe set populated, so the second
      // addNotification is silently swallowed without clear().
      notificationService.clear();
      localStorage.clear();

      notificationService.addNotification('sold', mockUnit, 520);
      const after2nd = notifications.length;

      expect(after2nd).toBeGreaterThanOrEqual(after1st);
    });
  });

  describe('Subscription Management', () => {
    it('should notify all subscribers of new notification', () => {
      const sub1: any[] = [];
      const sub2: any[] = [];

      const unsub1 = notificationService.subscribe((notifs) => {
        sub1.push(...notifs);
      });
      const unsub2 = notificationService.subscribe((notifs) => {
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
        notifications.length = 0; notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);
      const firstCount = notifications.length;

      unsub();
      notificationService.addNotification('sold', { ...mockUnit, id: 'unit_002' }, 500);

      expect(notifications.length).toBe(firstCount);
    });
  });

  describe('Mark as Read', () => {
    it('should mark notification as read', () => {
      const notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications.length = 0;
        notifications.length = 0; notifications.push(...notifs);
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
        notifications.length = 0; notifications.push(...notifs);
      });

      notificationService.addNotification('sold', mockUnit, 500);
      notificationService.addNotification('new_stock', mockUnit);

      notificationService.markAllAsRead();

      notifications.forEach(n => {
        expect(n.read).toBe(true);
      });
    });
  });

  describe('Unread Count', () => {
    it('should return correct unread count', async () => {
      notificationService.subscribe(() => {});

      notificationService.addNotification('sold', mockUnit, 500);
      // new_stock is batched (500ms window) — wait for the buffer to flush.
      notificationService.addNotification('new_stock', mockUnit);
      await new Promise(r => setTimeout(r, 600));

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

  describe('Sound Playing', () => {
    // The sound-on-notification feature was removed from notificationService —
    // grep for `Audio` / `play()` in src/lib/notificationService.ts now returns
    // nothing. Skipping until either the feature returns or the test is
    // rewritten against the new audio mechanism.
    it.skip('should attempt to play sound on notification (feature removed)', () => {
      const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      notificationService.subscribe(() => {});
      notificationService.addNotification('sold', mockUnit, 500);
      expect(playSpy).toHaveBeenCalled();
    });
  });

  describe('User Switching', () => {
    it('should handle user changes', () => {
      let notifications: any[] = [];
      notificationService.subscribe((notifs) => {
        notifications = notifs;
      });

      notificationService.setUser('user_001');
      notificationService.addNotification('sold', mockUnit, 500);

      const count1 = notifications.length;

      notificationService.setUser('user_002');
      const count2 = notifications.length;

      expect(count1).toBeGreaterThan(0);
    });
  });
});
