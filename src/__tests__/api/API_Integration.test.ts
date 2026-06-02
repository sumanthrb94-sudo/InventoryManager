import { describe as describeBase, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// These tests hit a live HTTP API at BASE_URL. CI / dev machines don't
// have that server running by default — skip the whole suite unless the
// operator opts in with `RUN_API_TESTS=1 npx vitest run src/__tests__/api/`.
// Keeps the green-path test loop fast and avoids noise from a service
// that isn't part of this client-side bundle.
const describe = process.env.RUN_API_TESTS === '1' ? describeBase : describeBase.skip;

interface Unit {
  id: string;
  model: string;
  status: 'available' | 'sold' | 'returned' | 'incoming';
  imei?: string;
  buyPrice?: number;
  salePrice?: number;
  profit?: number;
  salePlatform?: string;
  postageCost?: number;
}

interface Supplier {
  id: string;
  name: string;
  createdAt: string;
}

interface Analytics {
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  stockValue: number;
  availableCount: number;
  soldCount: number;
  returnedCount: number;
  incomingCount: number;
  totalPostage: number;
  topModels: Array<{ model: string; count: number }>;
}

describe('API Integration Tests - All Components', () => {
  let testSupplierId: string;
  let testUnitId: string;
  let testShsId: string;

  // Test Suppliers API
  describe('Suppliers API', () => {
    it('should get all suppliers', async () => {
      const res = await fetch(`${BASE_URL}/api/suppliers`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        testSupplierId = data[0].id;
        expect(data[0]).toHaveProperty('id');
        expect(data[0]).toHaveProperty('name');
      }
    });

    it('should create a new supplier', async () => {
      const res = await fetch(`${BASE_URL}/api/suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Test Supplier ${Date.now()}` }),
      });
      expect(res.status).toBe(201);
      const data: Supplier = await res.json();
      expect(data.name).toContain('Test Supplier');
      expect(data).toHaveProperty('id');
    });

    it('should validate supplier creation requires name', async () => {
      const res = await fetch(`${BASE_URL}/api/suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // Test Inventory API - Available Units
  describe('Inventory API - Available Units', () => {
    it('should get all available units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=available&limit=100`);
      expect(res.status).toBe(200);
      const data: Unit[] = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach(unit => {
        expect(unit.status).toBe('available');
      });
      if (data.length > 0) {
        testUnitId = data[0].id;
      }
    });

    it('should get unit by ID', async () => {
      if (!testUnitId) {
        const res = await fetch(`${BASE_URL}/api/inventory?status=available&limit=1`);
        const data: Unit[] = await res.json();
        if (data.length > 0) testUnitId = data[0].id;
      }
      if (testUnitId) {
        const res = await fetch(`${BASE_URL}/api/inventory/${testUnitId}`);
        expect(res.status).toBe(200);
        const unit: Unit = await res.json();
        expect(unit.id).toBe(testUnitId);
      }
    });

    it('should create available unit with required fields', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'iPhone 15 Pro',
          status: 'available',
          imei: `TEST${Date.now()}`,
          grade: 'Excellent',
          storage: '256GB',
          colour: 'Black',
          buyPrice: 450,
          supplierId: testSupplierId || 'test-supplier',
        }),
      });
      expect(res.status).toBe(200);
      const unit: Unit = await res.json();
      expect(unit.model).toBe('iPhone 15 Pro');
      expect(unit.status).toBe('available');
      expect(unit).toHaveProperty('id');
    });

    it('should validate unit creation requires model and status', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // Test Inventory API - Sold Units
  describe('Inventory API - Sold Units', () => {
    it('should get all sold units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=100`);
      expect(res.status).toBe(200);
      const data: Unit[] = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach(unit => {
        expect(unit.status).toBe('sold');
      });
    });

    it('should verify sold units have financial data', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=50`);
      const data: Unit[] = await res.json();
      if (data.length > 0) {
        data.forEach(unit => {
          expect(unit).toHaveProperty('salePrice');
          expect(unit).toHaveProperty('salePlatform');
        });
      }
    });

    it('should verify profit calculations for sold units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=50`);
      const data: Unit[] = await res.json();
      data.forEach(unit => {
        if (unit.salePrice && unit.buyPrice) {
          const expectedProfit =
            unit.salePrice - unit.buyPrice - (unit.postageCost || 8);
          expect(Math.abs((unit.profit || 0) - expectedProfit)).toBeLessThan(1);
        }
      });
    });
  });

  // Test Inventory API - Returned Units
  describe('Inventory API - Returned Units', () => {
    it('should get all returned units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=returned&limit=100`);
      expect(res.status).toBe(200);
      const data: Unit[] = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach(unit => {
        expect(unit.status).toBe('returned');
      });
    });
  });

  // Test SHS API
  describe('SHS (Incoming) Units API', () => {
    it('should get all SHS units', async () => {
      const res = await fetch(`${BASE_URL}/api/shs`);
      expect(res.status).toBe(200);
      const data: Unit[] = await res.json();
      expect(Array.isArray(data)).toBe(true);
      data.forEach(unit => {
        expect(unit.status).toBe('incoming');
      });
      if (data.length > 0) {
        testShsId = data[0].id;
      }
    });

    it('should create SHS unit with empty IMEI', async () => {
      const res = await fetch(`${BASE_URL}/api/shs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'Samsung Galaxy S24',
          supplierId: testSupplierId || 'test-supplier',
          buyPrice: 380,
        }),
      });
      expect([200, 201]).toContain(res.status);
      const unit: Unit = await res.json();
      expect(unit.status).toBe('incoming');
      expect(!unit.imei || unit.imei === '').toBe(true);
    });

    it('should validate SHS creation requires model', async () => {
      const res = await fetch(`${BASE_URL}/api/shs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  // Test Analytics API
  describe('Analytics API', () => {
    it('should get overall analytics', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics`);
      expect(res.status).toBe(200);
      const data: Analytics = await res.json();
      expect(data).toHaveProperty('totalRevenue');
      expect(data).toHaveProperty('totalCost');
      expect(data).toHaveProperty('grossProfit');
      expect(data).toHaveProperty('stockValue');
      expect(data).toHaveProperty('availableCount');
      expect(data).toHaveProperty('soldCount');
    });

    it('should verify analytics profit calculation', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics`);
      const data: Analytics = await res.json();
      const expectedProfit = data.totalRevenue - data.totalCost - data.totalPostage;
      expect(Math.abs(data.grossProfit - expectedProfit)).toBeLessThan(1);
    });

    it('should get analytics with date range', async () => {
      const res = await fetch(
        `${BASE_URL}/api/analytics?from=2026-01-01&to=2026-05-08`
      );
      expect(res.status).toBe(200);
      const data: Analytics = await res.json();
      expect(typeof data.soldCount).toBe('number');
      expect(typeof data.totalRevenue).toBe('number');
    });

    it('should provide top models data', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics`);
      const data: Analytics = await res.json();
      if (data.topModels) {
        expect(Array.isArray(data.topModels)).toBe(true);
        data.topModels.forEach(item => {
          expect(item).toHaveProperty('model');
          expect(item).toHaveProperty('count');
        });
      }
    });
  });

  // Test Data Integrity
  describe('Data Integrity Checks', () => {
    it('should verify no duplicate IMEIs in available units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=available&limit=500`);
      const data: Unit[] = await res.json();
      const imeis = data.filter(u => u.imei).map(u => u.imei);
      const uniqueImeis = new Set(imeis);
      expect(imeis.length).toBe(uniqueImeis.size);
    });

    it('should verify all units have valid status', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?limit=500`);
      const data: Unit[] = await res.json();
      const validStatuses = ['available', 'sold', 'returned', 'incoming'];
      data.forEach(unit => {
        expect(validStatuses).toContain(unit.status);
      });
    });

    it('should verify stock value matches between inventory and analytics', async () => {
      const invRes = await fetch(`${BASE_URL}/api/inventory?status=available&limit=500`);
      const units: Unit[] = await invRes.json();
      const stockValue = units.reduce((sum, u) => sum + (u.buyPrice || 0), 0);

      const analyticsRes = await fetch(`${BASE_URL}/api/analytics`);
      const analytics: Analytics = await analyticsRes.json();
      expect(Math.abs(stockValue - analytics.stockValue)).toBeLessThan(1);
    });

    it('should verify available unit count matches analytics', async () => {
      const invRes = await fetch(`${BASE_URL}/api/inventory?status=available&limit=1000`);
      const units: Unit[] = await invRes.json();

      const analyticsRes = await fetch(`${BASE_URL}/api/analytics`);
      const analytics: Analytics = await analyticsRes.json();
      expect(units.length).toBe(analytics.availableCount);
    });

    it('should verify sold unit count matches analytics', async () => {
      const invRes = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=1000`);
      const units: Unit[] = await invRes.json();

      const analyticsRes = await fetch(`${BASE_URL}/api/analytics`);
      const analytics: Analytics = await analyticsRes.json();
      expect(units.length).toBe(analytics.soldCount);
    });
  });

  // Test Pagination
  describe('API Pagination', () => {
    it('should respect limit parameter', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=available&limit=10`);
      const data: Unit[] = await res.json();
      expect(data.length).toBeLessThanOrEqual(10);
    });

    it('should handle offset parameter', async () => {
      const res1 = await fetch(`${BASE_URL}/api/inventory?status=available&limit=10&offset=0`);
      const data1: Unit[] = await res1.json();

      const res2 = await fetch(`${BASE_URL}/api/inventory?status=available&limit=10&offset=10`);
      const data2: Unit[] = await res2.json();

      if (data1.length > 0 && data2.length > 0) {
        expect(data1[0].id).not.toBe(data2[0].id);
      }
    });
  });

  // Test Search/Filter
  describe('API Search & Filter', () => {
    it('should filter by model', async () => {
      const res = await fetch(
        `${BASE_URL}/api/inventory?status=available&model=iPhone&limit=100`
      );
      const data: Unit[] = await res.json();
      data.forEach(unit => {
        expect(unit.model).toContain('iPhone');
      });
    });

    it('should search by IMEI', async () => {
      const listRes = await fetch(`${BASE_URL}/api/inventory?status=available&limit=1`);
      const list: Unit[] = await listRes.json();
      if (list.length > 0 && list[0].imei) {
        const searchRes = await fetch(
          `${BASE_URL}/api/inventory?search=${list[0].imei.slice(0, 4)}`
        );
        const results: Unit[] = await searchRes.json();
        expect(results.length).toBeGreaterThan(0);
      }
    });
  });

  // Component Data Population Tests
  describe('Data Population Verification', () => {
    it('should have sufficient available units for inventory display', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=available&limit=1`);
      const data: Unit[] = await res.json();
      expect(data.length).toBeGreaterThan(0);
    });

    it('should have diverse models in inventory', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?limit=100`);
      const data: Unit[] = await res.json();
      const models = new Set(data.map(u => u.model));
      expect(models.size).toBeGreaterThanOrEqual(5);
    });

    it('should have sold units with complete transaction data', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=1`);
      const data: Unit[] = await res.json();
      if (data.length > 0) {
        const unit = data[0];
        expect(unit).toHaveProperty('salePrice');
        expect(unit).toHaveProperty('salePlatform');
        expect(unit.profit).toBeDefined();
      }
    });

    it('should have suppliers linked to units', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?limit=10`);
      const data: Unit[] = await res.json();
      const hasSuppliers = data.some(u => u && Object.keys(u).includes('supplierId'));
      expect(hasSuppliers).toBe(true);
    });

    it('should populate analytics dashboard correctly', async () => {
      const res = await fetch(`${BASE_URL}/api/analytics`);
      const data: Analytics = await res.json();
      expect(data.totalRevenue).toBeGreaterThanOrEqual(0);
      expect(data.stockValue).toBeGreaterThanOrEqual(0);
      expect(data.availableCount + data.soldCount + data.returnedCount + data.incomingCount).toBeGreaterThan(0);
    });

    it('should have realistic profit distribution', async () => {
      const res = await fetch(`${BASE_URL}/api/inventory?status=sold&limit=100`);
      const data: Unit[] = await res.json();
      const profitable = data.filter(u => (u.profit || 0) > 0).length;
      const unprofitable = data.filter(u => (u.profit || 0) < 0).length;
      expect(profitable + unprofitable).toBeGreaterThan(0);
    });
  });
});
