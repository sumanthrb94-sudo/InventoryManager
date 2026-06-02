/**
 * Unit tests for `parseSaleDate` — the comparator backbone that fixed
 * the operator-reported "March 29 sorts before April 1" bug. Every
 * format any writer in the app might produce must collapse to a
 * sortable chronological number here.
 */
import { describe, it, expect } from 'vitest';
import { parseSaleDate } from '../lib/userLocale';

describe('parseSaleDate — chronological collapse for sale-date sorting', () => {
  describe('ISO yyyy-mm-dd (the canonical form)', () => {
    it('parses ISO dates and orders March 29 BEFORE April 1', () => {
      const mar29 = parseSaleDate('2026-03-29');
      const apr01 = parseSaleDate('2026-04-01');
      expect(mar29).toBeLessThan(apr01);
    });

    it('handles single-digit month and day (yyyy-m-d)', () => {
      expect(parseSaleDate('2026-3-29')).toBeLessThan(parseSaleDate('2026-4-1'));
    });

    it('ignores trailing time portion (yyyy-mm-ddTHH:MM)', () => {
      expect(parseSaleDate('2026-03-29T14:30:00')).toBeLessThan(parseSaleDate('2026-04-01T08:00:00'));
    });
  });

  describe('DMY with named month (the actual bug shape)', () => {
    it('sorts "29-Mar-2026" BEFORE "1-Apr-2026" — the reported failure mode', () => {
      const mar29 = parseSaleDate('29-Mar-2026');
      const apr01 = parseSaleDate('1-Apr-2026');
      expect(mar29).toBeLessThan(apr01);
    });

    it('handles full month names ("29-March-2026")', () => {
      expect(parseSaleDate('29-March-2026')).toBeLessThan(parseSaleDate('1-April-2026'));
    });

    it('handles space-separated DMY ("29 Mar 2026")', () => {
      expect(parseSaleDate('29 Mar 2026')).toBeLessThan(parseSaleDate('1 Apr 2026'));
    });

    it('handles slash-separated DMY ("29/Mar/2026")', () => {
      expect(parseSaleDate('29/Mar/2026')).toBeLessThan(parseSaleDate('1/Apr/2026'));
    });
  });

  describe('DMY all-numeric (UK convention)', () => {
    it('parses dd-mm-yyyy correctly', () => {
      expect(parseSaleDate('29-03-2026')).toBeLessThan(parseSaleDate('01-04-2026'));
    });

    it('parses dd/mm/yyyy correctly', () => {
      expect(parseSaleDate('29/03/2026')).toBeLessThan(parseSaleDate('01/04/2026'));
    });
  });

  describe('Date objects and Firestore Timestamps', () => {
    it('parses JS Date objects', () => {
      const mar29 = parseSaleDate(new Date(Date.UTC(2026, 2, 29)));
      const apr01 = parseSaleDate(new Date(Date.UTC(2026, 3, 1)));
      expect(mar29).toBeLessThan(apr01);
    });

    it('duck-types Firestore Timestamp objects via .toDate()', () => {
      const fakeTimestamp = { toDate: () => new Date(Date.UTC(2026, 2, 29)) };
      expect(parseSaleDate(fakeTimestamp)).toBeLessThan(parseSaleDate('2026-04-01'));
    });
  });

  describe('Null / undefined / empty (sort stably to one end)', () => {
    it('returns -Infinity for null', () => {
      expect(parseSaleDate(null)).toBe(-Infinity);
    });
    it('returns -Infinity for undefined', () => {
      expect(parseSaleDate(undefined)).toBe(-Infinity);
    });
    it('returns -Infinity for empty string', () => {
      expect(parseSaleDate('')).toBe(-Infinity);
    });
    it('returns -Infinity for whitespace-only string', () => {
      expect(parseSaleDate('   ')).toBe(-Infinity);
    });
  });

  describe('Sort end-to-end — the operator scenario', () => {
    it('descending sort puts April 1 before March 29 (was reversed before fix)', () => {
      const sales = [
        { id: 'a', saleDate: '2026-03-29' },
        { id: 'b', saleDate: '2026-04-01' },
        { id: 'c', saleDate: '2026-04-15' },
        { id: 'd', saleDate: '2026-03-15' },
      ];
      const sorted = [...sales].sort((a, b) => parseSaleDate(b.saleDate) - parseSaleDate(a.saleDate));
      expect(sorted.map(s => s.id)).toEqual(['c', 'b', 'a', 'd']);
    });

    it('sorts a MIXED format set chronologically (the real-world case)', () => {
      // What we'd see in the wild: in-app sales write ISO, imported sales
      // write ISO too, but a manually-edited sale or a re-imported export
      // could carry DMY. Ensure they merge into one chronological order.
      const sales = [
        { id: 'iso-mar29',   saleDate: '2026-03-29' },
        { id: 'dmy-apr01',   saleDate: '1-Apr-2026' },
        { id: 'word-apr15',  saleDate: '15 April 2026' },
        { id: 'iso-mar15',   saleDate: '2026-03-15' },
      ];
      const sorted = [...sales].sort((a, b) => parseSaleDate(b.saleDate) - parseSaleDate(a.saleDate));
      expect(sorted.map(s => s.id)).toEqual(['word-apr15', 'dmy-apr01', 'iso-mar29', 'iso-mar15']);
    });
  });
});
