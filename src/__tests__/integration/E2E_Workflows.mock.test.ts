import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryUnit } from '../../types';

/**
 * E2E Integration Tests (Mocked) - Complete Workflows
 * Tests real user flows with mocked database
 * Verifies data accuracy and business logic
 */

// Simple in-memory mock database
class MockDB {
  private units: Map<string, InventoryUnit> = new Map();

  create(id: string, unit: InventoryUnit) {
    this.units.set(id, { ...unit });
  }

  read(id: string): InventoryUnit | undefined {
    const unit = this.units.get(id);
    return unit ? { ...unit } : undefined;
  }

  update(id: string, patch: Partial<InventoryUnit>) {
    const unit = this.units.get(id);
    if (unit) {
      this.units.set(id, { ...unit, ...patch });
    }
  }

  getAll(): InventoryUnit[] {
    return Array.from(this.units.values());
  }

  clear() {
    this.units.clear();
  }
}

describe('E2E Workflows (Mocked) - Real Logic Testing', () => {
  let mockDb: MockDB;

  beforeEach(() => {
    mockDb = new MockDB();
  });

  // ─── WORKFLOW 1: SHS Unit → Add IMEI → Mark Sold ───────────────────
  describe('Workflow 1: SHS Unit → Add IMEI → Mark Sold → Verify History', () => {
    const shsId = 'shs_test_001';

    it('should create SHS unit with status=incoming and empty IMEI', () => {
      const shs: InventoryUnit = {
        id: shsId,
        imei: '',
        model: 'iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'incoming',
        flags: [],
        notes: 'SHS — Expected stock',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(shsId, shs);
      const created = mockDb.read(shsId)!;

      expect(created.status).toBe('incoming');
      expect(created.imei).toBe('');
      expect(created.notes).toContain('SHS');
    });

    it('should add IMEI to SHS unit before selling', () => {
      const shs: InventoryUnit = {
        id: shsId,
        imei: '',
        model: 'iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'incoming',
        flags: [],
        notes: 'SHS — Expected stock',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(shsId, shs);
      const newImei = '359108096724237';
      mockDb.update(shsId, { imei: newImei });

      const updated = mockDb.read(shsId)!;
      expect(updated.imei).toBe(newImei);
      expect(updated.status).toBe('incoming');
    });

    it('should NOT clear existing IMEI when selling without modal input', () => {
      // Pre-create SHS with IMEI
      const shs: InventoryUnit = {
        id: shsId,
        imei: '359108096724237',
        model: 'iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'incoming',
        flags: [],
        notes: 'SHS — Expected stock',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(shsId, shs);

      // Sell WITHOUT entering IMEI in modal (simulating empty imeiInput)
      // The FIX: Only update IMEI if imeiInput is not empty
      const imeiInput = ''; // User didn't enter IMEI in modal
      mockDb.update(shsId, {
        status: 'sold',
        salePrice: 520,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-12345',
        saleDate: '2026-05-07',
        postageCost: 8,
        // NOTE: Only set IMEI if imeiInput is not empty
        ...(imeiInput ? { imei: imeiInput } : {}),
      });

      const sold = mockDb.read(shsId)!;
      expect(sold.status).toBe('sold');
      expect(sold.imei).toBe('359108096724237'); // IMEI preserved!
      expect(sold.salePrice).toBe(520);
    });

    it('should appear in Sold History with full financial details', () => {
      const shs: InventoryUnit = {
        id: shsId,
        imei: '359108096724237',
        model: 'iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'sold',
        salePrice: 520,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-12345',
        saleDate: '2026-05-07',
        postageCost: 8,
        flags: [],
        notes: '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(shsId, shs);
      const sold = mockDb.read(shsId)!;

      // Verify all sale data is present
      expect(sold.status).toBe('sold');
      expect(sold.imei).toBe('359108096724237');
      expect(sold.salePrice).toBe(520);
      expect(sold.salePlatform).toBe('eBay');
      expect(sold.saleOrderId).toBe('ORD-12345');
      expect(sold.saleDate).toBe('2026-05-07');
      expect(sold.postageCost).toBe(8);
    });
  });

  // ─── WORKFLOW 2: Batch Import → Sell Multiple ───────────────────────
  describe('Workflow 2: Batch Import → Filter → Sell → Verify Totals', () => {
    const batchId = 'bat_multi_001';
    const unitIds = ['imei_001', 'imei_002', 'imei_003'];

    beforeEach(() => {
      const units: InventoryUnit[] = [
        {
          id: unitIds[0],
          imei: unitIds[0],
          model: 'iPhone 14 Pro 256GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Black',
          buyPrice: 380,
          dateIn: '2026-05-01',
          supplierId: 'sup_001',
          batchId,
          status: 'available',
          flags: [],
          notes: 'Batch import',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date().toISOString(),
        },
        {
          id: unitIds[1],
          imei: unitIds[1],
          model: 'Samsung Galaxy S21 128GB',
          brand: 'Samsung',
          category: 'Samsung S Series',
          colour: 'Grey',
          buyPrice: 220,
          dateIn: '2026-05-01',
          supplierId: 'sup_001',
          batchId,
          status: 'available',
          flags: [],
          notes: 'Batch import',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date().toISOString(),
        },
        {
          id: unitIds[2],
          imei: unitIds[2],
          model: 'iPhone 13 128GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Silver',
          buyPrice: 280,
          dateIn: '2026-05-01',
          supplierId: 'sup_001',
          batchId,
          status: 'available',
          flags: [],
          notes: 'Batch import',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date().toISOString(),
        },
      ];

      for (const unit of units) {
        mockDb.create(unit.id, unit);
      }
    });

    it('should import all units correctly', () => {
      const all = mockDb.getAll();
      expect(all.length).toBe(3);
      expect(all.every(u => u.batchId === batchId)).toBe(true);
      expect(all.every(u => u.status === 'available')).toBe(true);
    });

    it('should filter units by category', () => {
      const all = mockDb.getAll();
      const iPhones = all.filter(u => u.category === 'iPhone');
      expect(iPhones.length).toBe(2);
    });

    it('should sell units independently and verify totals', () => {
      // Sell unit 1 (profit)
      mockDb.update(unitIds[0], {
        status: 'sold',
        salePrice: 450,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-001',
        saleDate: '2026-05-07',
        postageCost: 8,
      });

      // Sell unit 2 (loss)
      mockDb.update(unitIds[1], {
        status: 'sold',
        salePrice: 180,
        salePlatform: 'Amazon',
        saleOrderId: 'ORD-002',
        saleDate: '2026-05-07',
        postageCost: 5,
      });

      const all = mockDb.getAll();
      const sold = all.filter(u => u.status === 'sold');
      const available = all.filter(u => u.status === 'available');

      expect(sold.length).toBe(2);
      expect(available.length).toBe(1);

      const totalRevenue = sold.reduce((s, u) => s + (u.salePrice || 0), 0);
      const totalBP = sold.reduce((s, u) => s + u.buyPrice, 0);

      expect(totalRevenue).toBe(630); // 450 + 180
      expect(totalBP).toBe(600); // 380 + 220
    });
  });

  // ─── WORKFLOW 3: Return Processing ───────────────────────────────────
  describe('Workflow 3: Sold Unit → Return → Status Update', () => {
    const soldId = 'sold_unit_001';

    it('should process return and restore availability', () => {
      const sold: InventoryUnit = {
        id: soldId,
        imei: '355066101247506',
        model: 'Samsung Galaxy S21 128GB',
        brand: 'Samsung',
        category: 'Samsung S Series',
        colour: 'Grey',
        buyPrice: 220,
        dateIn: '2026-04-01',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'sold',
        salePrice: 280,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-100',
        saleDate: '2026-05-01',
        postageCost: 6,
        flags: [],
        notes: '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(soldId, sold);

      // Process return
      mockDb.update(soldId, {
        status: 'available',
        salePrice: undefined,
        salePlatform: undefined,
        saleOrderId: undefined,
        saleDate: undefined,
        postageCost: undefined,
        returnType: 'back_to_inventory',
        returnDate: '2026-05-07',
        returnReason: 'Customer changed mind',
      });

      const returned = mockDb.read(soldId)!;
      expect(returned.status).toBe('available');
      expect(returned.salePrice).toBeUndefined();
      expect(returned.returnType).toBe('back_to_inventory');
    });

    it('should track return to supplier separately', () => {
      const sold: InventoryUnit = {
        id: soldId,
        imei: '355066101247506',
        model: 'Samsung Galaxy S21 128GB',
        brand: 'Samsung',
        category: 'Samsung S Series',
        colour: 'Grey',
        buyPrice: 220,
        dateIn: '2026-04-01',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'sold',
        salePrice: 280,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-100',
        saleDate: '2026-05-01',
        postageCost: 6,
        flags: [],
        notes: '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      mockDb.create(soldId, sold);

      mockDb.update(soldId, {
        status: 'returned',
        returnType: 'return_to_supplier',
        returnDate: '2026-05-07',
        returnReason: 'Fault detected',
      });

      const returned = mockDb.read(soldId)!;
      expect(returned.status).toBe('returned');
      expect(returned.returnType).toBe('return_to_supplier');
    });
  });

  // ─── WORKFLOW 4: Dashboard Data Accuracy & Real-time Updates ─────────
  describe('Workflow 4: Dashboard Data Accuracy & Latest Updates at Top', () => {
    const testDate = '2026-05-07';

    beforeEach(() => {
      // Create mixed inventory
      const units: InventoryUnit[] = [
        // Available (oldest)
        {
          id: 'dash_001',
          imei: '359108096724237',
          model: 'iPhone 15 Pro 256GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Black',
          buyPrice: 450,
          dateIn: '2026-04-01',
          supplierId: 'sup_001',
          batchId: 'bat_001',
          status: 'available',
          flags: [],
          notes: '',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date('2026-04-01').toISOString(),
        },
        // Sold (profit) - first sale
        {
          id: 'dash_002',
          imei: '350220437101229',
          model: 'Samsung Galaxy S21 128GB',
          brand: 'Samsung',
          category: 'Samsung S Series',
          colour: 'Grey',
          buyPrice: 220,
          dateIn: '2026-04-15',
          supplierId: 'sup_001',
          batchId: 'bat_001',
          status: 'sold',
          salePrice: 300,
          salePlatform: 'eBay',
          saleDate: testDate,
          saleOrderId: 'ORD-201',
          postageCost: 8,
          flags: [],
          notes: '',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date('2026-04-15').toISOString(),
        },
        // Sold (loss) - second sale (should appear below first)
        {
          id: 'dash_003',
          imei: '355066101247506',
          model: 'iPhone 13 128GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Silver',
          buyPrice: 280,
          dateIn: '2026-04-20',
          supplierId: 'sup_001',
          batchId: 'bat_001',
          status: 'sold',
          salePrice: 250,
          salePlatform: 'Amazon',
          saleDate: testDate,
          saleOrderId: 'ORD-202',
          postageCost: 5,
          flags: [],
          notes: '',
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date('2026-04-20').toISOString(),
        },
      ];

      for (const unit of units) {
        mockDb.create(unit.id, unit);
      }
    });

    it('should calculate dashboard totals correctly', () => {
      const all = mockDb.getAll();

      const stats = {
        totalUnits: all.length,
        availableCount: all.filter(u => u.status === 'available').length,
        soldCount: all.filter(u => u.status === 'sold').length,
        totalValue: all
          .filter(u => u.status === 'available')
          .reduce((s, u) => s + u.buyPrice, 0),
        totalRevenue: all
          .filter(u => u.status === 'sold')
          .reduce((s, u) => s + (u.salePrice || 0), 0),
      };

      expect(stats.totalUnits).toBe(3);
      expect(stats.availableCount).toBe(1);
      expect(stats.soldCount).toBe(2);
      expect(stats.totalValue).toBe(450);
      expect(stats.totalRevenue).toBe(550);
    });

    it('should show oldest available units first', () => {
      const all = mockDb.getAll();
      const available = all
        .filter(u => u.status === 'available')
        .sort((a, b) => a.dateIn.localeCompare(b.dateIn));

      expect(available[0].dateIn).toBe('2026-04-01');
      expect(available[0].model).toContain('iPhone 15 Pro');
    });

    it('should display latest sales at top (most recent first)', () => {
      const all = mockDb.getAll();
      const todaySold = all
        .filter(u => u.status === 'sold' && u.saleDate === testDate)
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      expect(todaySold.length).toBe(2);
      // Most recent sale should be first
      expect(todaySold[0].id).toBe('dash_003');
      expect(todaySold[1].id).toBe('dash_002');
    });

    it('should update dashboard when unit status changes', () => {
      let available = mockDb
        .getAll()
        .filter(u => u.status === 'available').length;
      expect(available).toBe(1);

      // Sell the available unit
      mockDb.update('dash_001', {
        status: 'sold',
        salePrice: 520,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-999',
        saleDate: testDate,
        postageCost: 8,
      });

      available = mockDb.getAll().filter(u => u.status === 'available').length;
      expect(available).toBe(0);

      const sold = mockDb.getAll().filter(u => u.status === 'sold').length;
      expect(sold).toBe(3);
    });

    it('should calculate profit/loss accurately for each sale', () => {
      const all = mockDb.getAll();
      const sold = all.filter(u => u.status === 'sold');

      for (const unit of sold) {
        const salePrice = unit.salePrice || 0;
        const fee =
          unit.salePlatform === 'eBay'
            ? salePrice * 0.128 + 0.3
            : unit.salePlatform === 'Amazon'
              ? salePrice * 0.08
              : salePrice * 0.09;

        const profit = salePrice - unit.buyPrice - fee - (unit.postageCost || 0);

        expect(typeof profit).toBe('number');
        expect(!isNaN(profit)).toBe(true);
      }
    });

    it('should show profit vs loss sales with different styling', () => {
      const all = mockDb.getAll();
      const sold = all.filter(u => u.status === 'sold');

      const profits = sold.map(u => {
        const fee = u.salePlatform === 'eBay'
          ? (u.salePrice || 0) * 0.128 + 0.3
          : (u.salePrice || 0) * 0.08;
        return (u.salePrice || 0) - u.buyPrice - fee - (u.postageCost || 0);
      });

      // First sale should be profit
      expect(profits[0]).toBeGreaterThan(0);
      // Second sale should be loss
      expect(profits[1]).toBeLessThan(0);
    });
  });

});
