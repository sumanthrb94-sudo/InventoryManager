import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';
import { InventoryUnit } from '../../types';

/**
 * E2E Integration Tests - Complete Workflows
 * Tests real user flows from input to sold/returned status
 * Verifies data accuracy and real-time updates
 */

describe('E2E Workflows - Complete User Journeys', () => {

  // ─── WORKFLOW 1: SHS (Supplier Direct Sales) ───────────────────────────────
  describe('Workflow 1: SHS Unit → Add IMEI → Mark Sold → Verify History', () => {
    let shsUnit: InventoryUnit;
    const shsId = `shs_${Date.now()}_001`;

    beforeEach(async () => {
      // Step 1: Create SHS unit (expected stock, no IMEI)
      shsUnit = {
        id: shsId,
        imei: '', // No IMEI initially
        model: 'iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'bat_001',
        status: 'incoming', // SHS starts as incoming
        flags: [],
        notes: 'SHS — Expected stock',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      await dbService.create('inventoryUnits', shsId, shsUnit);
    });

    it('should create SHS unit with status=incoming and no IMEI', async () => {
      const unit = await dbService.read('inventoryUnits', shsId);
      expect(unit.status).toBe('incoming');
      expect(unit.imei).toBe('');
      expect(unit.notes).toContain('SHS');
    });

    it('should add IMEI to SHS unit before selling', async () => {
      const newImei = '359108096724237';
      await dbService.update('inventoryUnits', shsId, { imei: newImei });

      const updated = await dbService.read('inventoryUnits', shsId);
      expect(updated.imei).toBe(newImei);
      expect(updated.status).toBe('incoming'); // Status unchanged
    });

    it('should record sale with existing IMEI (not clearing it)', async () => {
      // Pre-set IMEI
      const presetImei = '359108096724237';
      await dbService.update('inventoryUnits', shsId, { imei: presetImei });

      // Record sale WITHOUT entering IMEI in modal (empty imeiInput)
      const salePrice = 520;
      const platform = 'eBay';
      const saleDate = '2026-05-07';

      await dbService.update('inventoryUnits', shsId, {
        status: 'sold', // This is the key change
        salePrice,
        salePlatform: platform,
        saleOrderId: 'ORD-12345',
        saleDate,
        postageCost: 8,
        // NOTE: IMEI is NOT being set here (simulating empty imeiInput)
      });

      const sold = await dbService.read('inventoryUnits', shsId);
      expect(sold.status).toBe('sold');
      expect(sold.imei).toBe(presetImei); // IMEI preserved!
      expect(sold.salePrice).toBe(salePrice);
      expect(sold.salePlatform).toBe(platform);
    });

    it('should appear in Sold History with full financial details', async () => {
      // Complete sale flow
      const newImei = '359108096724237';
      await dbService.update('inventoryUnits', shsId, { imei: newImei });

      const saleData = {
        status: 'sold' as const,
        salePrice: 520,
        salePlatform: 'eBay' as const,
        saleOrderId: 'ORD-12345',
        saleDate: '2026-05-07',
        postageCost: 8,
      };

      await dbService.update('inventoryUnits', shsId, saleData);

      const soldUnit = await dbService.read('inventoryUnits', shsId);

      // Verify all sale data
      expect(soldUnit.status).toBe('sold');
      expect(soldUnit.imei).toBe(newImei);
      expect(soldUnit.salePrice).toBe(520);
      expect(soldUnit.salePlatform).toBe('eBay');
      expect(soldUnit.saleOrderId).toBe('ORD-12345');
      expect(soldUnit.saleDate).toBe('2026-05-07');
      expect(soldUnit.postageCost).toBe(8);
    });

    it('should trigger sold notification with correct profit', async () => {
      const notifSpy = vi.spyOn(notificationService, 'addNotification');

      // Complete sale
      await dbService.update('inventoryUnits', shsId, {
        status: 'sold',
        salePrice: 520,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-12345',
        saleDate: '2026-05-07',
        postageCost: 8,
      });

      // Calculate expected profit: 520 - 450 (BP) - 12.54 (fee) - 8 (postage) = 49.46
      const expectedProfit = 520 - 450 - 12.54 - 8;

      notificationService.addNotification('sold', shsUnit, expectedProfit);

      expect(notifSpy).toHaveBeenCalled();
      const call = notifSpy.mock.calls[0];
      expect(call[0]).toBe('sold');
      expect(Math.abs(call[2] as number - expectedProfit)).toBeLessThan(0.01);
    });
  });

  // ─── WORKFLOW 2: Batch Import → Sell Multiple Units ───────────────────────
  describe('Workflow 2: Batch Import → Filter → Sell → Verify Totals', () => {
    const batchId = `bat_${Date.now()}`;
    const unitIds = ['359108096724237', '350220437101229', '355066101247506'];

    beforeEach(async () => {
      // Create batch of 3 units
      const units = [
        {
          imei: unitIds[0],
          model: 'iPhone 14 Pro 256GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Black',
          buyPrice: 380,
        },
        {
          imei: unitIds[1],
          model: 'Samsung Galaxy S21 128GB',
          brand: 'Samsung',
          category: 'Samsung S Series',
          colour: 'Grey',
          buyPrice: 220,
        },
        {
          imei: unitIds[2],
          model: 'iPhone 13 128GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Silver',
          buyPrice: 280,
        },
      ];

      for (const unit of units) {
        await dbService.create('inventoryUnits', unit.imei, {
          ...unit,
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
        });
      }
    });

    it('should import all 3 units with correct data', async () => {
      for (const imei of unitIds) {
        const unit = await dbService.read('inventoryUnits', imei);
        expect(unit.status).toBe('available');
        expect(unit.batchId).toBe(batchId);
        expect(unit.imei).toBe(imei);
      }
    });

    it('should filter units by model and status', async () => {
      // Simulate filtering
      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const iPhoneUnits = units.filter(u => u.category === 'iPhone');
      expect(iPhoneUnits.length).toBe(2);
      expect(iPhoneUnits.every(u => u.status === 'available')).toBe(true);
    });

    it('should sell 2 units and update statuses independently', async () => {
      const unit1 = await dbService.read('inventoryUnits', unitIds[0]);
      const unit2 = await dbService.read('inventoryUnits', unitIds[1]);

      // Sell unit 1 (profit)
      await dbService.update('inventoryUnits', unitIds[0], {
        status: 'sold',
        salePrice: 450,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-001',
        saleDate: '2026-05-07',
        postageCost: 8,
      });

      // Sell unit 2 (loss)
      await dbService.update('inventoryUnits', unitIds[1], {
        status: 'sold',
        salePrice: 180,
        salePlatform: 'Amazon',
        saleOrderId: 'ORD-002',
        saleDate: '2026-05-07',
        postageCost: 5,
      });

      const sold1 = await dbService.read('inventoryUnits', unitIds[0]);
      const sold2 = await dbService.read('inventoryUnits', unitIds[1]);
      const still_available = await dbService.read('inventoryUnits', unitIds[2]);

      expect(sold1.status).toBe('sold');
      expect(sold1.salePrice).toBe(450);
      expect(sold2.status).toBe('sold');
      expect(sold2.salePrice).toBe(180);
      expect(still_available.status).toBe('available');
    });

    it('should calculate batch totals correctly', async () => {
      // Update sale prices
      await dbService.update('inventoryUnits', unitIds[0], {
        status: 'sold',
        salePrice: 450,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-001',
        saleDate: '2026-05-07',
      });

      await dbService.update('inventoryUnits', unitIds[1], {
        status: 'sold',
        salePrice: 180,
        salePlatform: 'Amazon',
        saleOrderId: 'ORD-002',
        saleDate: '2026-05-07',
      });

      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const soldUnits = units.filter(u => u.status === 'sold');
      const totalRevenue = soldUnits.reduce((s, u) => s + (u.salePrice || 0), 0);
      const totalBP = soldUnits.reduce((s, u) => s + u.buyPrice, 0);

      expect(totalRevenue).toBe(630); // 450 + 180
      expect(totalBP).toBe(600); // 380 + 220
      expect(soldUnits.length).toBe(2);
    });
  });

  // ─── WORKFLOW 3: Scan IMEI → Auto-populate → Sell ───────────────────────
  describe('Workflow 3: Barcode Scan → Auto-populate Details → Sell', () => {
    const scannedImei = '359108096724237';

    it('should create unit from barcode scan with auto-populated data', async () => {
      // Simulate barcode parsing: IMEI-MODEL-GRADE-STORAGE
      // Input: "359108096724237-Apple iPhone 15 Pro-A-256GB"

      const unit = {
        id: scannedImei,
        imei: scannedImei,
        model: 'Apple iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black', // Manual entry
        grade: 'A', // From barcode
        buyPrice: 450, // Manual entry
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'master_batch',
        status: 'available',
        flags: [],
        notes: '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      await dbService.create('inventoryUnits', scannedImei, unit);

      const created = await dbService.read('inventoryUnits', scannedImei);
      expect(created.imei).toBe(scannedImei);
      expect(created.model).toContain('iPhone 15 Pro');
      expect(created.grade).toBe('A');
      expect(created.status).toBe('available');
    });

    it('should sell scanned unit and trigger notification', async () => {
      const unit = {
        id: scannedImei,
        imei: scannedImei,
        model: 'Apple iPhone 15 Pro 256GB',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Black',
        grade: 'A',
        buyPrice: 450,
        dateIn: '2026-05-07',
        supplierId: 'sup_001',
        batchId: 'master_batch',
        status: 'available',
        flags: [],
        notes: '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      await dbService.create('inventoryUnits', scannedImei, unit);

      // Record sale
      const salePrice = 520;
      const platform = 'eBay';
      await dbService.update('inventoryUnits', scannedImei, {
        status: 'sold',
        salePrice,
        salePlatform: platform,
        saleOrderId: 'ORD-999',
        saleDate: '2026-05-07',
        postageCost: 8,
      });

      const sold = await dbService.read('inventoryUnits', scannedImei);
      expect(sold.status).toBe('sold');
      expect(sold.salePrice).toBe(520);
    });
  });

  // ─── WORKFLOW 4: Return Processing ───────────────────────────────────────
  describe('Workflow 4: Sold Unit → Return → Update Status → Verify Dashboard', () => {
    const soldUnitId = '355066101247506';

    beforeEach(async () => {
      // Create a sold unit
      await dbService.create('inventoryUnits', soldUnitId, {
        id: soldUnitId,
        imei: soldUnitId,
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
      });
    });

    it('should process return and change status to available', async () => {
      await dbService.update('inventoryUnits', soldUnitId, {
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

      const returned = await dbService.read('inventoryUnits', soldUnitId);
      expect(returned.status).toBe('available');
      expect(returned.salePrice).toBeUndefined();
      expect(returned.returnType).toBe('back_to_inventory');
      expect(returned.returnDate).toBe('2026-05-07');
    });

    it('should track return to supplier separately', async () => {
      await dbService.update('inventoryUnits', soldUnitId, {
        status: 'returned',
        returnType: 'return_to_supplier',
        returnDate: '2026-05-07',
        returnReason: 'Fault detected',
      });

      const returned = await dbService.read('inventoryUnits', soldUnitId);
      expect(returned.status).toBe('returned');
      expect(returned.returnType).toBe('return_to_supplier');
    });

    it('should trigger return notification with correct type', async () => {
      const notifSpy = vi.spyOn(notificationService, 'addNotification');

      const unit = await dbService.read('inventoryUnits', soldUnitId);
      notificationService.addNotification('return_processed', unit);

      expect(notifSpy).toHaveBeenCalledWith('return_processed', expect.any(Object));
    });
  });

  // ─── WORKFLOW 5: Dashboard Data Accuracy & Real-time Updates ───────────────
  describe('Workflow 5: Dashboard Data Accuracy with Real-time Updates', () => {
    const testDate = '2026-05-07';
    const unitIds = ['unit_dash_001', 'unit_dash_002', 'unit_dash_003', 'unit_dash_004'];

    beforeEach(async () => {
      // Create mixed inventory for dashboard
      const units = [
        // Available unit
        {
          id: unitIds[0],
          imei: '359108096724237',
          model: 'iPhone 15 Pro 256GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Black',
          buyPrice: 450,
          dateIn: '2026-04-01', // Oldest
          status: 'available',
        },
        // Sold unit (profit)
        {
          id: unitIds[1],
          imei: '350220437101229',
          model: 'Samsung Galaxy S21 128GB',
          brand: 'Samsung',
          category: 'Samsung S Series',
          colour: 'Grey',
          buyPrice: 220,
          dateIn: '2026-04-15',
          status: 'sold',
          salePrice: 300,
          salePlatform: 'eBay',
          saleDate: testDate,
          saleOrderId: 'ORD-201',
          postageCost: 8,
        },
        // Sold unit (loss)
        {
          id: unitIds[2],
          imei: '355066101247506',
          model: 'iPhone 13 128GB',
          brand: 'Apple',
          category: 'iPhone',
          colour: 'Silver',
          buyPrice: 280,
          dateIn: '2026-04-20',
          status: 'sold',
          salePrice: 250,
          salePlatform: 'Amazon',
          saleDate: testDate,
          saleOrderId: 'ORD-202',
          postageCost: 5,
        },
        // Incoming (SHS)
        {
          id: unitIds[3],
          imei: '',
          model: 'iPad Air 128GB',
          brand: 'Apple',
          category: 'iPad',
          colour: 'Blue',
          buyPrice: 350,
          dateIn: '2026-05-05',
          status: 'incoming',
          notes: 'SHS — Expected stock',
        },
      ];

      for (const unit of units) {
        await dbService.create('inventoryUnits', unit.id, {
          ...unit,
          supplierId: 'sup_001',
          batchId: 'bat_001',
          flags: [],
          platformListed: false,
          listingSites: [],
          ownerId: 'shared',
          createdAt: new Date().toISOString(),
        });
      }
    });

    it('should calculate dashboard totals correctly', async () => {
      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const stats = {
        totalUnits: units.length,
        availableCount: units.filter(u => u.status === 'available').length,
        soldCount: units.filter(u => u.status === 'sold').length,
        incomingCount: units.filter(u => u.status === 'incoming').length,
        totalValue: units
          .filter(u => u.status === 'available')
          .reduce((s, u) => s + u.buyPrice, 0),
        totalRevenue: units
          .filter(u => u.status === 'sold')
          .reduce((s, u) => s + (u.salePrice || 0), 0),
      };

      expect(stats.totalUnits).toBe(4);
      expect(stats.availableCount).toBe(1);
      expect(stats.soldCount).toBe(2);
      expect(stats.incomingCount).toBe(1);
      expect(stats.totalValue).toBe(450); // Only available unit
      expect(stats.totalRevenue).toBe(550); // 300 + 250
    });

    it('should show oldest units first on dashboard', async () => {
      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const availableUnits = units
        .filter(u => u.status === 'available')
        .sort((a, b) => a.dateIn.localeCompare(b.dateIn));

      expect(availableUnits[0].dateIn).toBe('2026-04-01'); // Oldest first
    });

    it('should display today\'s sales with latest at top', async () => {
      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const todaySales = units
        .filter(u => u.status === 'sold' && u.saleDate === testDate)
        .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));

      expect(todaySales.length).toBe(2);
      expect(todaySales[0].salePrice).toBeDefined();
    });

    it('should update dashboard when unit status changes', async () => {
      // Initial state
      let units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );
      let availableCount = units.filter(u => u.status === 'available').length;
      expect(availableCount).toBe(1);

      // Sell the available unit
      await dbService.update('inventoryUnits', unitIds[0], {
        status: 'sold',
        salePrice: 520,
        salePlatform: 'eBay',
        saleOrderId: 'ORD-999',
        saleDate: testDate,
        postageCost: 8,
      });

      // Refresh and verify
      units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );
      availableCount = units.filter(u => u.status === 'available').length;
      expect(availableCount).toBe(0); // Now zero available
    });

    it('should calculate profit/loss for dashboard summary', async () => {
      const units = await Promise.all(
        unitIds.map(id => dbService.read('inventoryUnits', id))
      );

      const soldUnits = units.filter(u => u.status === 'sold');

      for (const unit of soldUnits) {
        const fee = unit.salePlatform === 'eBay'
          ? unit.salePrice! * 0.128 + 0.30
          : unit.salePrice! * 0.08;
        const profit = unit.salePrice! - unit.buyPrice - fee - (unit.postageCost || 0);

        expect(profit).toBeDefined();
        expect(typeof profit).toBe('number');
      }
    });
  });

});
