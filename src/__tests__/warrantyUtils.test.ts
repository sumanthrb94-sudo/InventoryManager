import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getWarrantyStatus } from '../lib/warrantyUtils';

// Pin "now" to a known date so daysLeft assertions are deterministic.
const FIXED_NOW = new Date('2026-05-06T12:00:00Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

describe('getWarrantyStatus', () => {
  describe('without sale date', () => {
    it('returns no-warranty result when saleDate is undefined', () => {
      const result = getWarrantyStatus(undefined);
      expect(result).toEqual({
        isExpired: false,
        daysLeft: 0,
        hasWarranty: false,
        endDate: null,
      });
    });

    it('returns no-warranty result when saleDate is null', () => {
      const result = getWarrantyStatus(null);
      expect(result.hasWarranty).toBe(false);
      expect(result.endDate).toBeNull();
    });

    it('returns no-warranty result when saleDate is empty string', () => {
      const result = getWarrantyStatus('');
      expect(result.hasWarranty).toBe(false);
    });
  });

  describe('with sale date', () => {
    it('marks unit as having warranty', () => {
      const result = getWarrantyStatus('2026-01-01');
      expect(result.hasWarranty).toBe(true);
    });

    it('computes warranty end as exactly 1 year after sale date', () => {
      const result = getWarrantyStatus('2026-01-01');
      expect(result.endDate).toBe('2027-01-01');
    });

    it('returns positive daysLeft when warranty is still active', () => {
      // Sold today (FIXED_NOW = 2026-05-06) → warranty ends 2027-05-06
      const result = getWarrantyStatus('2026-05-06');
      expect(result.daysLeft).toBeGreaterThan(0);
      expect(result.isExpired).toBe(false);
    });

    it('returns negative daysLeft when warranty has expired', () => {
      // Sold 2 years ago — warranty ended 1 year ago
      const result = getWarrantyStatus('2024-05-06');
      expect(result.daysLeft).toBeLessThan(0);
      expect(result.isExpired).toBe(true);
    });

    it('returns approximately 365 daysLeft when sold today', () => {
      const result = getWarrantyStatus('2026-05-06');
      expect(result.daysLeft).toBe(365);
    });

    it('returns daysLeft just shy of 365 when sold yesterday', () => {
      const result = getWarrantyStatus('2026-05-05');
      expect(result.daysLeft).toBe(364);
    });

    it('isExpired is false on the exact expiry day (boundary)', () => {
      // Sold one year ago today → warranty ends today
      const result = getWarrantyStatus('2025-05-06');
      expect(result.isExpired).toBe(false);
      // -0 and 0 are both acceptable here (JS Math.ceil quirk on exactly 0ms diff)
      expect(Math.abs(result.daysLeft)).toBe(0);
    });

    it('returns daysLeft of -1 when warranty expired one day ago', () => {
      // Sold 2025-05-05 → warranty ended 2026-05-05 (yesterday)
      const result = getWarrantyStatus('2025-05-05');
      expect(result.isExpired).toBe(true);
      expect(result.daysLeft).toBe(-1);
    });

    it('handles leap-year February correctly', () => {
      // 2024 was a leap year. Selling on 2024-02-29 → warranty ends 2025-02-28 in JS.
      const result = getWarrantyStatus('2024-02-29');
      expect(result.endDate).toMatch(/^2025-(02|03)-/);
      expect(result.hasWarranty).toBe(true);
    });
  });
});
