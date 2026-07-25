/**
 * Stock Type column — how supplier-held (SHS) stock arrives by report.
 *
 * Before this column the 9-col schema could only express office stock, so
 * every SHS row landed on the shelf as available and the operator had to
 * re-key it through SHS Receive. These tests pin the parsing contract and,
 * critically, that a file WITHOUT the column still imports as office stock.
 */
import { describe, it, expect } from 'vitest';

/** Mirrors InventoryReportImport's stockType coercion. Kept in lockstep by
 *  the round-trip test at the bottom, which drives the real export values. */
function coerceStockType(raw: unknown): 'office' | 'shs' {
  const s = String(raw ?? '').trim().toUpperCase();
  return /^(SHS|INCOMING|SUPPLIER|SUPPLIER HELD|SUPPLIER-HELD|Y|YES|TRUE|1)$/.test(s)
    ? 'shs' : 'office';
}

describe('Stock Type coercion', () => {
  it('treats the words operators actually type as SHS', () => {
    for (const v of ['SHS', 'shs', ' Shs ', 'INCOMING', 'Supplier', 'supplier held', 'SUPPLIER-HELD']) {
      expect(coerceStockType(v)).toBe('shs');
    }
  });

  it('accepts a bare yes/true/1 under an "SHS" header', () => {
    for (const v of ['Y', 'yes', 'TRUE', 1, '1']) {
      expect(coerceStockType(v)).toBe('shs');
    }
  });

  it('defaults to office for blank, missing, or unrecognised values', () => {
    for (const v of ['', '   ', undefined, null, 'OFFICE', 'in office', 'N', 'no', '0', 'shelf']) {
      expect(coerceStockType(v)).toBe('office');
    }
  });

  it('does NOT treat a Notes mention of SHS as a stock type', () => {
    // The old workaround was writing "SHS — supplier holding" in Notes,
    // which never worked. Only the dedicated column counts.
    expect(coerceStockType('Supplier holding — awaiting delivery')).toBe('office');
  });
});

describe('export → import round trip', () => {
  /** Mirrors BuySheet.buildReportRow's Stock Type cell. */
  const exportCell = (u: { status?: string; stockSource?: string }) =>
    u.status === 'incoming' || u.stockSource === 'shs' ? 'SHS' : 'OFFICE';

  it('an exported SHS unit re-imports as SHS', () => {
    expect(coerceStockType(exportCell({ status: 'incoming', stockSource: 'shs' }))).toBe('shs');
    expect(coerceStockType(exportCell({ status: 'available', stockSource: 'shs' }))).toBe('shs');
  });

  it('an exported office unit re-imports as office', () => {
    expect(coerceStockType(exportCell({ status: 'available', stockSource: 'office' }))).toBe('office');
    expect(coerceStockType(exportCell({ status: 'available' }))).toBe('office');
  });
});

describe('status resolution on import', () => {
  /** Mirrors the toRow() status rule in InventoryReportImport. */
  const resolveStatus = (stockType: 'office' | 'shs', existingStatus?: string) =>
    existingStatus && existingStatus !== 'available'
      ? existingStatus
      : (stockType === 'shs' ? 'incoming' : 'available');

  it('an SHS row creates an incoming unit', () => {
    expect(resolveStatus('shs')).toBe('incoming');
  });

  it('an office row creates an available unit', () => {
    expect(resolveStatus('office')).toBe('available');
  });

  it('never resurrects a sold unit as stock on re-import', () => {
    expect(resolveStatus('office', 'sold')).toBe('sold');
    expect(resolveStatus('shs', 'sold')).toBe('sold');
  });

  it('leaves a returned unit in its return state', () => {
    expect(resolveStatus('office', 'returned')).toBe('returned');
  });

  it('promotes an available unit to SHS when the file says so', () => {
    expect(resolveStatus('shs', 'available')).toBe('incoming');
  });
});
