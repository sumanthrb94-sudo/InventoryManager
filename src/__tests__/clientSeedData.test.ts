import { describe, it, expect } from 'vitest';
import { toCamel } from '../lib/dbService';
import seedData from '../lib/clientSeedData.json';

// `clientSeedData.json` powers the LoadMockDataModal.
// These tests make sure the file is well-formed and that the camelCase
// conversion in LoadMockDataModal produces objects that match the
// InventoryUnit / Supplier shapes the rest of the app expects.

function toAppObj(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [toCamel(k), v])
  );
}

const rawSuppliers = (seedData as any).suppliers as any[];
const rawUnits     = (seedData as any).units     as any[];

describe('clientSeedData.json', () => {
  describe('top-level structure', () => {
    it('contains both suppliers and units arrays', () => {
      expect(Array.isArray(rawSuppliers)).toBe(true);
      expect(Array.isArray(rawUnits)).toBe(true);
    });

    it('contains at least one supplier', () => {
      expect(rawSuppliers.length).toBeGreaterThan(0);
    });

    it('contains at least one unit', () => {
      expect(rawUnits.length).toBeGreaterThan(0);
    });
  });

  describe('suppliers', () => {
    it('every supplier has a unique id', () => {
      const ids = rawSuppliers.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every supplier has a non-empty name', () => {
      for (const s of rawSuppliers) {
        expect(typeof s.name).toBe('string');
        expect(s.name.length).toBeGreaterThan(0);
      }
    });

    it('every supplier has ownerId "shared" (multi-device sync)', () => {
      for (const s of rawSuppliers) {
        expect(s.ownerId).toBe('shared');
      }
    });
  });

  describe('units', () => {
    it('every unit has a non-empty id', () => {
      for (const u of rawUnits) {
        expect(typeof u.id).toBe('string');
        expect(u.id.length).toBeGreaterThan(0);
      }
    });

    it('every unit has a status of available, sold, incoming, or returned', () => {
      // 'returned' was added when the Returns lifecycle landed; supplier
      // returns + repairs flip the status to 'returned' alongside
      // returnType. The seed file mirrors live data shapes.
      const allowed = new Set(['available', 'sold', 'incoming', 'returned']);
      for (const u of rawUnits) {
        expect(allowed.has(u.status)).toBe(true);
      }
    });

    it('every unit has a positive buyPrice (or null for SHS)', () => {
      for (const u of rawUnits) {
        if (u.buyPrice !== null && u.buyPrice !== undefined) {
          expect(u.buyPrice).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('every unit references a supplierId that exists', () => {
      const supplierIds = new Set(rawSuppliers.map(s => s.id));
      for (const u of rawUnits) {
        expect(supplierIds.has(u.supplierId)).toBe(true);
      }
    });

    it('every unit has ownerId "shared"', () => {
      for (const u of rawUnits) {
        expect(u.ownerId).toBe('shared');
      }
    });

    it('all unit ids are unique', () => {
      const ids = rawUnits.map(u => u.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('every unit has a dateIn field formatted as ISO date', () => {
      for (const u of rawUnits) {
        expect(u.dateIn).toMatch(/^\d{4}-\d{2}-\d{2}/);
      }
    });

    it('every unit has flags as an array', () => {
      for (const u of rawUnits) {
        expect(Array.isArray(u.flags)).toBe(true);
      }
    });

    it('every unit has listingSites as an array', () => {
      for (const u of rawUnits) {
        expect(Array.isArray(u.listingSites)).toBe(true);
      }
    });
  });

  describe('camelCase conversion (matches LoadMockDataModal)', () => {
    it('converts buy_price → buyPrice', () => {
      const converted = toAppObj({ buy_price: 100 });
      expect(converted.buyPrice).toBe(100);
      expect(converted.buy_price).toBeUndefined();
    });

    it('converts every supplier without losing any fields', () => {
      const converted = rawSuppliers.map(toAppObj);
      expect(converted.length).toBe(rawSuppliers.length);
      for (const s of converted) {
        expect(s.id).toBeDefined();
        expect(s.name).toBeDefined();
        expect(s.ownerId).toBe('shared');
      }
    });

    it('converts every unit and produces expected camelCase fields', () => {
      const converted = rawUnits.map(toAppObj);
      for (const u of converted) {
        expect(u.id).toBeDefined();
        expect(u.dateIn).toBeDefined();
        expect(u.supplierId).toBeDefined();
        expect(u.ownerId).toBe('shared');
        expect(Array.isArray(u.flags)).toBe(true);
        expect(Array.isArray(u.listingSites)).toBe(true);
      }
    });

    it('preserves status values through conversion', () => {
      const sample = rawUnits.find(u => u.status === 'available');
      if (sample) {
        const converted = toAppObj(sample);
        expect(converted.status).toBe('available');
      }
    });
  });

  describe('inventory mix (visible in LoadMockDataModal stats)', () => {
    it('reports counts that sum to the total unit count', () => {
      const available = rawUnits.filter(u => u.status === 'available').length;
      const incoming  = rawUnits.filter(u => u.status === 'incoming').length;
      const sold      = rawUnits.filter(u => u.status === 'sold').length;
      const returned  = rawUnits.filter(u => u.status === 'returned').length;
      expect(available + incoming + sold + returned).toBe(rawUnits.length);
    });

    it('contains at least one available unit (otherwise UI would look broken)', () => {
      const available = rawUnits.filter(u => u.status === 'available');
      expect(available.length).toBeGreaterThan(0);
    });
  });
});
