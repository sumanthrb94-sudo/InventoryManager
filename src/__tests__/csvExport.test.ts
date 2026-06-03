import { describe, it, expect } from 'vitest';
import { toCsv } from '../lib/csv';

describe('toCsv', () => {
  it('writes a header row then one line per data row', () => {
    const csv = toCsv([
      { Date: '2026-06-03', Model: 'iPhone 13', 'Sale Price £': 150 },
      { Date: '2026-06-04', Model: 'Galaxy S22', 'Sale Price £': 140 },
    ]);
    expect(csv.split('\n')).toEqual([
      'Date,Model,Sale Price £',
      '2026-06-03,iPhone 13,150',
      '2026-06-04,Galaxy S22,140',
    ]);
  });

  it('FIX #8: emits a header-only file (not empty) when there are no rows but headers are supplied', () => {
    const csv = toCsv([], ['Date', 'Model', 'IMEI']);
    expect(csv).toBe('Date,Model,IMEI');
    expect(csv.length).toBeGreaterThan(0);
  });

  it('returns empty string only when there is nothing to describe (no rows, no headers)', () => {
    expect(toCsv([])).toBe('');
  });

  it('respects explicit header order even if row keys differ', () => {
    const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b']);
    expect(csv).toBe('a,b\n1,2');
  });

  it('escapes commas, quotes and newlines per RFC-4180', () => {
    const csv = toCsv([
      { note: 'a,b', q: 'say "hi"', multi: 'line1\nline2' },
    ]);
    expect(csv).toBe('note,q,multi\n"a,b","say ""hi""","line1\nline2"');
  });

  it('renders null/undefined as blank cells', () => {
    expect(toCsv([{ a: null, b: undefined, c: 0 }], ['a', 'b', 'c']))
      .toBe('a,b,c\n,,0');
  });
});
