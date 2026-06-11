import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockDB } from '../mocks/MockDB';
import { notificationService } from '../../lib/notificationService';

// Mock Audio for test environment
class MockAudio {
  constructor(src?: string) {}
  play() {
    return Promise.resolve();
  }
}
global.Audio = MockAudio as any;

describe('API Data Population & Integration Tests', () => {
  let mockDb: MockDB;

  beforeEach(() => {
    mockDb = new MockDB();
    mockDb.loadSeedData();
    notificationService.setUser('test-user-' + Date.now());
  });

  describe('Suppliers Component', () => {
    it('should have suppliers loaded with correct structure', () => {
      const suppliers = mockDb.getSuppliers();
      expect(suppliers.length).toBeGreaterThan(0);
      suppliers.forEach(supplier => {
        expect(supplier).toHaveProperty('id');
        expect(supplier).toHaveProperty('name');
      });
    });

    it('should allow creating new suppliers', () => {
      const newSupplier = mockDb.createSupplier({
        name: 'Test Supplier ' + Date.now(),
      });
      expect(newSupplier).toHaveProperty('id');
      expect(newSupplier.name).toContain('Test Supplier');
    });

    it('should retrieve supplier by ID', () => {
      const suppliers = mockDb.getSuppliers();
      if (suppliers.length > 0) {
        const retrieved = mockDb.getSupplierById(suppliers[0].id);
        expect(retrieved?.id).toBe(suppliers[0].id);
      }
    });
  });

  describe('Inventory - Available Units', () => {
    it('should load 200 units with 120 available', () => {
      const available = mockDb.getUnits({ status: 'available' });
      expect(available.length).toBe(120);
    });

    it('should have available units with all required fields', () => {
      const available = mockDb.getUnits({ status: 'available' });
      available.forEach(unit => {
        expect(unit).toHaveProperty('id');
        expect(unit).toHaveProperty('model');
        expect(unit).toHaveProperty('status');
        expect(unit.status).toBe('available');
        expect(unit).toHaveProperty('imei');
        expect(unit).toHaveProperty('grade');
        expect(unit).toHaveProperty('storage');
        expect(unit).toHaveProperty('colour');
        expect(unit).toHaveProperty('buyPrice');
        expect(unit).toHaveProperty('supplierId');
      });
    });

    it('should support filtering by model', () => {
      const iphones = mockDb.getUnits({ status: 'available', model: 'iPhone' });
      expect(iphones.length).toBeGreaterThan(0);
      iphones.forEach(unit => {
        expect(unit.model).toContain('iPhone');
      });
    });

    it('should support pagination', () => {
      const page1 = mockDb.getUnits({ status: 'available', limit: 10, offset: 0 });
      const page2 = mockDb.getUnits({ status: 'available', limit: 10, offset: 10 });
      expect(page1.length).toBeLessThanOrEqual(10);
      expect(page2.length).toBeLessThanOrEqual(10);
      if (page1.length > 0 && page2.length > 0) {
        expect(page1[0].id).not.toBe(page2[0].id);
      }
    });

    it('should support retrieval by ID', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 1 });
      if (available.length > 0) {
        const unit = mockDb.getUnitById(available[0].id);
        expect(unit?.id).toBe(available[0].id);
      }
    });

    it('should create new available units', () => {
      const newUnit = mockDb.createUnit({
        model: 'iPhone 15 Pro',
        status: 'available',
        imei: 'NEW' + Date.now(),
        grade: 'Excellent',
        storage: '256GB',
        colour: 'Black',
        buyPrice: 450,
        supplierId: mockDb.getSuppliers()[0].id,
      });
      expect(newUnit).toHaveProperty('id');
      expect(newUnit.status).toBe('available');
      expect(newUnit.model).toBe('iPhone 15 Pro');
    });
  });

  describe('Inventory - Sold Units', () => {
    it('should have 60 sold units', () => {
      const sold = mockDb.getUnits({ status: 'sold' });
      expect(sold.length).toBe(60);
    });

    it('should have sold units with financial data', () => {
      const sold = mockDb.getUnits({ status: 'sold', limit: 10 });
      sold.forEach(unit => {
        expect(unit).toHaveProperty('salePrice');
        expect(unit).toHaveProperty('salePlatform');
        expect(unit).toHaveProperty('saleDate');
        expect(['eBay', 'Amazon', 'OnBuy', 'Backmarket']).toContain(unit.salePlatform);
      });
    });

    it('should have correct profit calculations for sold units', () => {
      const sold = mockDb.getUnits({ status: 'sold', limit: 20 });
      sold.forEach(unit => {
        if (unit.salePrice && unit.buyPrice) {
          const expectedProfit =
            unit.salePrice - unit.buyPrice - (unit.postageCost || 8) - (unit.platformFee || 0);
          const actualProfit = unit.profit || 0;
          expect(Math.abs(expectedProfit - actualProfit)).toBeLessThan(1);
        }
      });
    });

    it('should have realistic profit margin distribution', () => {
      const sold = mockDb.getUnits({ status: 'sold' });
      const profitable = sold.filter(u => (u.profit || 0) > 0);
      const unprofitable = sold.filter(u => (u.profit || 0) < 0);
      expect(profitable.length).toBeGreaterThanOrEqual(20); // Mix of profitable
      expect(unprofitable.length).toBeGreaterThanOrEqual(5); // Some loss-making
      expect(profitable.length + unprofitable.length).toBeGreaterThan(0);
    });

    it('should calculate platform fees correctly', () => {
      const sold = mockDb.getUnits({ status: 'sold', limit: 50 });
      sold.forEach(unit => {
        if (unit.salePlatform) {
          const feeRates: Record<string, number> = {
            eBay: 0.128,
            Amazon: 0.08,
            OnBuy: 0.09,
            Backmarket: 0.1,
          };
          const expectedFee = (unit.salePrice || 0) * feeRates[unit.salePlatform] + (unit.salePlatform === 'eBay' ? 0.3 : 0);
          expect(Math.abs((unit.platformFee || 0) - expectedFee)).toBeLessThan(0.5);
        }
      });
    });
  });

  describe('Inventory - Returned Units', () => {
    it('should have 16 returned units', () => {
      const returned = mockDb.getUnits({ status: 'returned' });
      expect(returned.length).toBe(16);
    });

    it('should have returned units with return metadata', () => {
      const returned = mockDb.getUnits({ status: 'returned' });
      returned.forEach(unit => {
        expect(unit).toHaveProperty('returnType');
        expect(['Return to Inventory', 'Return to Supplier']).toContain(unit.returnType);
        expect(unit).toHaveProperty('returnReason');
        expect(['Defective', 'Change of Mind', 'Wrong Item', 'Damaged on Delivery']).toContain(
          unit.returnReason
        );
      });
    });
  });

  describe('SHS (Incoming) Units', () => {
    it('should have 4 SHS/incoming units', () => {
      const incoming = mockDb.getUnits({ status: 'incoming' });
      expect(incoming.length).toBe(4);
    });

    it('should have SHS units with empty IMEIs', () => {
      const incoming = mockDb.getUnits({ status: 'incoming' });
      incoming.forEach(unit => {
        expect(unit.status).toBe('incoming');
        expect(!unit.imei || unit.imei === '').toBe(true);
      });
    });

    it('should allow adding IMEI to SHS unit to mark as available', () => {
      const incoming = mockDb.getUnits({ status: 'incoming', limit: 1 });
      if (incoming.length > 0) {
        const updated = mockDb.updateUnit(incoming[0].id, {
          imei: 'CONVERTED' + Date.now(),
          status: 'available',
        });
        expect(updated?.imei).toContain('CONVERTED');
        expect(updated?.status).toBe('available');
      }
    });

    it('should create new SHS units', () => {
      const newShs = mockDb.createUnit({
        model: 'Samsung Galaxy S24',
        status: 'incoming',
        supplierId: mockDb.getSuppliers()[0].id,
        buyPrice: 380,
      });
      expect(newShs.status).toBe('incoming');
      expect(!newShs.imei || newShs.imei === '').toBe(true);
    });
  });

  describe('Analytics & Reporting', () => {
    it('should calculate total revenue from sold units', () => {
      const stats = mockDb.getStats();
      expect(stats.totalRevenue).toBeGreaterThan(0);
      const sold = mockDb.getUnits({ status: 'sold' });
      const expectedRevenue = sold.reduce((sum, u) => sum + (u.salePrice || 0), 0);
      expect(Math.abs(stats.totalRevenue - expectedRevenue)).toBeLessThan(1);
    });

    it('should calculate total cost from all units', () => {
      const stats = mockDb.getStats();
      expect(stats.totalCost).toBeGreaterThan(0);
      const allUnits = mockDb.getUnits({ limit: 1000 });
      const expectedCost = allUnits.reduce((sum, u) => sum + (u.buyPrice || 0), 0);
      expect(Math.abs(stats.totalCost - expectedCost)).toBeLessThan(1);
    });

    it('should calculate stock value correctly', () => {
      const stats = mockDb.getStats();
      expect(stats.stockValue).toBeGreaterThan(0);
      const available = mockDb.getUnits({ status: 'available' });
      const expectedStock = available.reduce((sum, u) => sum + (u.buyPrice || 0), 0);
      expect(Math.abs(stats.stockValue - expectedStock)).toBeLessThan(1);
    });

    it('should calculate gross profit correctly', () => {
      const stats = mockDb.getStats();
      const expectedProfit = stats.totalRevenue - stats.totalCost - stats.totalPostage;
      expect(Math.abs(stats.grossProfit - expectedProfit)).toBeLessThan(1);
    });

    it('should have unit distribution statistics', () => {
      const stats = mockDb.getStats();
      expect(stats.available).toBe(120);
      expect(stats.sold).toBe(60);
      expect(stats.returned).toBe(16);
      expect(stats.incoming).toBe(4);
      expect(stats.available + stats.sold + stats.returned + stats.incoming).toBe(200);
    });

    it('should provide top models breakdown', () => {
      const stats = mockDb.getStats();
      expect(stats.topModels).toBeDefined();
      expect(stats.topModels!.length).toBeGreaterThan(0);
      stats.topModels!.forEach(item => {
        expect(item).toHaveProperty('model');
        expect(item).toHaveProperty('count');
      });
    });
  });

  describe('Data Integrity Checks', () => {
    it('should have no duplicate IMEIs in available units', () => {
      const available = mockDb.getUnits({ status: 'available' });
      const imeis = available.filter(u => u.imei).map(u => u.imei);
      const uniqueImeis = new Set(imeis);
      expect(imeis.length).toBe(uniqueImeis.size);
    });

    it('should have all units with valid status', () => {
      const allUnits = mockDb.getUnits({ limit: 1000 });
      const validStatuses = ['available', 'sold', 'returned', 'incoming'];
      allUnits.forEach(unit => {
        expect(validStatuses).toContain(unit.status);
      });
    });

    it('should have realistic date distribution', () => {
      const allUnits = mockDb.getUnits({ limit: 1000 });
      const today = new Date();
      const futureUnits = allUnits.filter(u => {
        const unitDate = new Date(u.dateIn);
        return unitDate > today;
      });
      expect(futureUnits.length).toBe(0); // No future dates
    });

    it('should have diverse models in inventory', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 200 });
      const models = new Set(available.map(u => u.model));
      expect(models.size).toBeGreaterThanOrEqual(10);
    });

    it('should have suppliers assigned to all units', () => {
      const allUnits = mockDb.getUnits({ limit: 100 });
      allUnits.forEach(unit => {
        expect(unit.supplierId).toBeDefined();
        expect(unit.supplierId).not.toBe('');
      });
    });
  });

  describe('Search & Filter Operations', () => {
    it('should filter units by status', () => {
      const sold = mockDb.getUnits({ status: 'sold', limit: 100 });
      sold.forEach(unit => {
        expect(unit.status).toBe('sold');
      });
    });

    it('should filter units by model with partial matching', () => {
      const iphones = mockDb.getUnits({ model: 'iPhone', limit: 50 });
      iphones.forEach(unit => {
        expect(unit.model).toContain('iPhone');
      });
    });

    it('should support complex filters combining status and model', () => {
      const soldIphones = mockDb.getUnits({ status: 'sold', model: 'iPhone', limit: 50 });
      soldIphones.forEach(unit => {
        expect(unit.status).toBe('sold');
        expect(unit.model).toContain('iPhone');
      });
    });
  });

  describe('Notification System Integration', () => {
    it('should trigger notification when unit is sold', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 1 });
      if (available.length > 0) {
        const unit = available[0];
        notificationService.addNotification('sold', {
          id: unit.id,
          model: unit.model,
          imei: unit.imei,
        } as any, 50);

        const unreadCount = notificationService.getUnreadCount();
        expect(unreadCount).toBeGreaterThan(0);
      }
    });

    it('should trigger notification for loss sales', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 1 });
      if (available.length > 0) {
        const unit = available[0];
        notificationService.addNotification('loss_sell', {
          id: unit.id,
          model: unit.model,
          imei: unit.imei,
        } as any, -50);

        const unreadCount = notificationService.getUnreadCount();
        expect(unreadCount).toBeGreaterThan(0);
      }
    });

    it('should trigger notification for new stock', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 1 });
      if (available.length > 0) {
        const unit = available[0];
        // new_stock is batched (500 ms setTimeout) when called without a
        // count; pass count=1 to take the synchronous path so the unread
        // tally reflects this call before the assertion runs.
        notificationService.addNotification('new_stock', {
          id: unit.id,
          model: unit.model,
          imei: unit.imei,
        } as any, undefined, 1);

        const unreadCount = notificationService.getUnreadCount();
        expect(unreadCount).toBeGreaterThan(0);
      }
    });
  });

  describe('Bulk Operations', () => {
    it('should handle batch unit updates', () => {
      const available = mockDb.getUnits({ status: 'available', limit: 5 });
      available.forEach(unit => {
        mockDb.updateUnit(unit.id, { status: 'sold', salePrice: 300 });
      });
      const updated = mockDb.getUnits({ status: 'sold', limit: 100 });
      expect(updated.length).toBeGreaterThanOrEqual(5);
    });

    it('should support concurrent operations', async () => {
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          Promise.resolve().then(() =>
            mockDb.createUnit({
              model: 'Test Phone ' + i,
              status: 'available',
              buyPrice: 300 + i * 10,
              supplierId: mockDb.getSuppliers()[0].id,
            })
          )
        );
      }
      const results = await Promise.all(promises);
      expect(results.length).toBe(5);
    });
  });

  describe('Performance Metrics', () => {
    it('should retrieve 100 units in reasonable time', () => {
      const start = performance.now();
      mockDb.getUnits({ limit: 100 });
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should be < 100ms
    });

    it('should calculate analytics in reasonable time', () => {
      const start = performance.now();
      mockDb.getStats();
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50); // Should be < 50ms
    });
  });
});
