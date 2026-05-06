import { describe, it, expect } from 'vitest';
import { buildStableUnitId } from '../lib/inventoryMaintenance';

// `buildStableUnitId` is the cornerstone of import deduplication.
// Same physical unit imported twice should produce the same ID
// so the second import updates instead of duplicating.

describe('buildStableUnitId', () => {
  describe('with valid IMEI', () => {
    it('returns unit_<imei> when IMEI is 15 digits', () => {
      expect(buildStableUnitId({ imei: '353209102768686' })).toBe('unit_353209102768686');
    });

    it('strips non-digit characters from IMEI', () => {
      expect(buildStableUnitId({ imei: '353-209-102-768-686' })).toBe('unit_353209102768686');
      expect(buildStableUnitId({ imei: '353 209 102 768 686' })).toBe('unit_353209102768686');
    });

    it('accepts shorter IMEIs (≥ 8 digits) for older devices/serials', () => {
      expect(buildStableUnitId({ imei: '12345678' })).toBe('unit_12345678');
    });

    it('produces same ID regardless of other fields when IMEI is present', () => {
      const a = buildStableUnitId({ imei: '353209102768686', model: 'iPhone 15', buyPrice: 500 });
      const b = buildStableUnitId({ imei: '353209102768686', model: 'iPhone 14', buyPrice: 800 });
      expect(a).toBe(b);
    });
  });

  describe('without IMEI (fallback slug)', () => {
    it('builds slug from model + dateIn + supplierId + buyPrice + status', () => {
      const id = buildStableUnitId({
        model: 'iPhone 15 Pro Max 256GB',
        dateIn: '2025-01-15',
        supplierId: 'sup_001',
        buyPrice: 800,
        status: 'available',
      });
      expect(id).toBe('unit_iphone_15_pro_max_256gb_2025_01_15_sup_001_800_available');
    });

    it('produces identical IDs for identical input (idempotent)', () => {
      const input = {
        model: 'Samsung Galaxy S24',
        dateIn: '2025-03-01',
        supplierId: 'sup_002',
        buyPrice: 600,
        status: 'available',
      };
      expect(buildStableUnitId(input)).toBe(buildStableUnitId(input));
    });

    it('produces different IDs for different models (no collision)', () => {
      const a = buildStableUnitId({ model: 'iPhone 15', dateIn: '2025-01-01', supplierId: 's1' });
      const b = buildStableUnitId({ model: 'iPhone 14', dateIn: '2025-01-01', supplierId: 's1' });
      expect(a).not.toBe(b);
    });

    it('falls back to imported when no fields are provided', () => {
      expect(buildStableUnitId({})).toBe('unit_imported');
    });

    it('triggers slug fallback when IMEI has fewer than 8 digits', () => {
      const id = buildStableUnitId({ imei: 'SHS', model: 'iPhone 15', dateIn: '2025-01-01' });
      expect(id).not.toContain('SHS');
      expect(id.startsWith('unit_iphone_15')).toBe(true);
    });

    it('lowercases and replaces non-alphanumerics with underscores', () => {
      const id = buildStableUnitId({ model: 'iPhone 15 Pro (256GB)', dateIn: '2025-01-01' });
      expect(id).toMatch(/^unit_iphone_15_pro_256gb/);
    });

    it('trims trailing underscores from the slug', () => {
      const id = buildStableUnitId({ model: 'iPhone' });
      expect(id).not.toMatch(/_$/);
    });

    it('handles undefined fields gracefully', () => {
      const id = buildStableUnitId({ model: 'iPhone 15', dateIn: undefined, supplierId: 'sup_001' });
      expect(id).toBe('unit_iphone_15_sup_001');
    });
  });

  describe('IMEI edge cases', () => {
    it('falls back to slug when IMEI is empty string', () => {
      const id = buildStableUnitId({ imei: '', model: 'iPhone 15', dateIn: '2025-01-01' });
      expect(id).toBe('unit_iphone_15_2025_01_01');
    });

    it('falls back to slug when IMEI is only non-digits', () => {
      const id = buildStableUnitId({ imei: 'PENDING', model: 'iPhone 15' });
      expect(id).toBe('unit_iphone_15');
    });

    it('uses IMEI when undefined fields exist alongside it', () => {
      const id = buildStableUnitId({
        imei: '353209102768686',
        model: undefined,
        dateIn: undefined,
      });
      expect(id).toBe('unit_353209102768686');
    });
  });
});
