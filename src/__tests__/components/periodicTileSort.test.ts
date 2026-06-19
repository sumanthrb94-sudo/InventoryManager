/**
 * Locks the periodic-table tile display order (descending by series number)
 * against the exact data from the operator's Out-of-Stock screenshot, which
 * appeared in raw bucket-insertion order (S22, S21 FE, S20, S24, S24U, …).
 * The comparator is pure + exported so the visible-order contract is testable
 * without mounting the component.
 */
import { describe, it, expect } from 'vitest';
import {
  compareTilesDescending,
  tileSeriesNumber,
  type TileSortShape,
} from '../../components/PeriodicInventory';

describe('tileSeriesNumber', () => {
  it('reads the digit run from the displayed symbol first', () => {
    expect(tileSeriesNumber({ symbol: 'S24U', model: 'Galaxy S24 Ultra' })).toBe(24);
    expect(tileSeriesNumber({ symbol: 'S21 FE', model: 'Galaxy S21 FE' })).toBe(21);
    expect(tileSeriesNumber({ symbol: 'A52S', model: 'Galaxy A52s' })).toBe(52);
  });

  it('falls back to the model string when the symbol has no digit', () => {
    // Raw SKU bucket: shortCode truncates "ASI-SG-S20-128-CN-EX" to "ASI-SG-S"
    // (8-char cap) which has no digit — the model still yields 20.
    expect(tileSeriesNumber({ symbol: 'ASI-SG-S', model: 'ASI-SG-S20-128-CN-EX' })).toBe(20);
  });

  it('returns -1 when nothing numeric exists (sinks to end)', () => {
    expect(tileSeriesNumber({ symbol: 'iPad', model: 'iPad' })).toBe(-1);
  });
});

describe('compareTilesDescending — Galaxy S row from the screenshot', () => {
  it('orders tiles descending by series number, not bucket-insertion order', () => {
    // Exact tiles + the order they appeared in the operator screenshot
    // (raw bucket order — the bug we are fixing).
    const screenshotOrder: TileSortShape[] = [
      { symbol: 'S22',      model: 'Galaxy S22',            storage: '128GB' },
      { symbol: 'S21 FE',   model: 'Galaxy S21 FE',         storage: '128GB' },
      { symbol: 'S20',      model: 'Galaxy S20',            storage: '128GB' },
      { symbol: 'S24',      model: 'Galaxy S24',            storage: '256GB' },
      { symbol: 'S24U',     model: 'Galaxy S24 Ultra',      storage: '512GB' },
      { symbol: 'ASI-SG-S', model: 'ASI-SG-S20-128-CN-EX',  storage: undefined },
      { symbol: 'S21 FE',   model: 'Galaxy S21 FE',         storage: '256GB' },
    ];

    const sorted = [...screenshotOrder].sort(compareTilesDescending);
    const labels = sorted.map(t => `${t.symbol}${t.storage ? ` ${t.storage}` : ''}`);

    // Descending by series number; 64<128<256<512 storage tiebreak within a
    // series; the no-digit "ASI-SG-S" (resolves to 20 via model) sits with S20.
    expect(labels).toEqual([
      'S24 256GB',   // 24
      'S24U 512GB',  // 24, larger storage after S24's 256
      'S22 128GB',   // 22
      'S21 FE 128GB',// 21, 128 before 256
      'S21 FE 256GB',// 21
      'S20 128GB',   // 20, 128 before unknown
      'ASI-SG-S',    // 20 (from model), unknown storage sinks last
    ]);
  });

  it('is a stable, total order (no reshuffle on re-sort)', () => {
    const tiles: TileSortShape[] = [
      { symbol: 'A25', model: 'Galaxy A25', storage: '128GB' },
      { symbol: 'A52S', model: 'Galaxy A52s', storage: '128GB' },
      { symbol: 'A32', model: 'Galaxy A32', storage: '64GB' },
      { symbol: 'SG-A14-1', model: 'SG-A14-128-VT', storage: undefined },
    ];
    const once = [...tiles].sort(compareTilesDescending).map(t => t.symbol);
    const twice = [...tiles].sort(compareTilesDescending).sort(compareTilesDescending).map(t => t.symbol);
    expect(once).toEqual(twice);
    // A52S(52) > A32(32) > A25(25) > A14(14)
    expect(once).toEqual(['A52S', 'A32', 'A25', 'SG-A14-1']);
  });
});
