/**
 * Tests for ReportRangeMenu.resolvePeriod — the date-range computation
 * that powers the Today / Week / Month / Custom / All-Time presets.
 *
 * The 'week' preset used to find the most-recent Sunday via
 * `today.getDay()`; on Sundays getDay() === 0 → the window collapsed to
 * a single day, and every Sunday's "This Week" export was silently a
 * 1-day export (operator report 2026-06-14). The fix uses a rolling
 * 7-day window (today and the six calendar days before it, inclusive)
 * which matches the in-app "Last 7d" pill semantics.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { resolvePeriod } from '../../components/ReportRangeMenu';

function withFrozenDate(iso: string, fn: () => void) {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso + 'T12:00:00Z')); });
  afterAll(()  => { vi.useRealTimers(); });
  fn();
}

describe('resolvePeriod', () => {
  describe('today', () => {
    withFrozenDate('2026-06-14', () => {
      it('from = to = today; label includes today', () => {
        const r = resolvePeriod('today');
        expect(r.from).toBe('2026-06-14');
        expect(r.to).toBe('2026-06-14');
        expect(r.label).toBe('today-2026-06-14');
      });
    });
  });

  describe('week (rolling 7 days)', () => {
    // The regression: today is Sunday 2026-06-14. Old code collapsed the
    // range to [today, today]; new code yields a true 7-day window.
    withFrozenDate('2026-06-14', () => {
      it('on Sunday: window spans the previous 6 days + today (7 calendar days)', () => {
        const r = resolvePeriod('week');
        expect(r.from).toBe('2026-06-08');
        expect(r.to).toBe('2026-06-14');
        expect(r.label).toBe('week-2026-06-08-to-2026-06-14');
      });
    });
  });

  describe('week (mid-week)', () => {
    withFrozenDate('2026-06-10', () => {
      it('on Wednesday: still a true 7-day window, not "since Sunday"', () => {
        const r = resolvePeriod('week');
        expect(r.from).toBe('2026-06-04');   // 6 days back
        expect(r.to).toBe('2026-06-10');
      });
    });
  });

  describe('week (mid-week, month boundary)', () => {
    withFrozenDate('2026-06-03', () => {
      it('crosses month boundary cleanly', () => {
        const r = resolvePeriod('week');
        expect(r.from).toBe('2026-05-28');   // crosses into May
        expect(r.to).toBe('2026-06-03');
      });
    });
  });

  describe('month', () => {
    withFrozenDate('2026-06-14', () => {
      it('starts on the 1st of the current month', () => {
        const r = resolvePeriod('month');
        expect(r.from).toBe('2026-06-01');
        expect(r.to).toBe('2026-06-14');
        expect(r.label).toBe('2026-06');
      });
    });
  });

  describe('all', () => {
    it('returns no bounds + label "all-time"', () => {
      const r = resolvePeriod('all');
      expect(r.from).toBeUndefined();
      expect(r.to).toBeUndefined();
      expect(r.label).toBe('all-time');
    });
  });

  describe('custom', () => {
    it('passes through the operator-typed bounds', () => {
      const r = resolvePeriod('custom', { from: '2026-01-01', to: '2026-03-31' });
      expect(r.from).toBe('2026-01-01');
      expect(r.to).toBe('2026-03-31');
      expect(r.label).toBe('2026-01-01-to-2026-03-31');
    });
  });
});
