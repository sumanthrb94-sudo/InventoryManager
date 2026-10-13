/**
 * Import stock gate — the 12-Oct upload, as a test.
 *
 * 85 sales; office stock fell by 63, not 85. The 22 sold IMEIs that matched
 * no stock were created as already-sold units without a word: 20 had never
 * been stocked in, 2 had been deleted as "QC Fail - RTS (Return to Supplier)".
 * The preview must now name every one of them and say why.
 */
import { describe, it, expect } from 'vitest';
import { classifyStockGate, imeisToLookUp, isRtsReason } from '../../lib/importStockGate';
import type { DeletedUnitRecord, InventoryUnit } from '../../types';

const unit = (o: Partial<InventoryUnit> & { imei: string }): InventoryUnit => ({
  id: o.imei, model: 'Galaxy A32', status: 'available', supplierName: 'NANAK', ...o,
} as unknown as InventoryUnit);

const deleted = (o: Partial<DeletedUnitRecord> & { imei: string; reason: string }): DeletedUnitRecord => ({
  id: `del_${o.imei}`, unitId: o.imei, source: 'office', deletedAt: '2026-10-08T16:35:00Z',
  deletedBy: 'ops@example.com', model: 'GALAXY S21 Fe', ...o,
} as DeletedUnitRecord);

const sale = (id: string, imei: string, o: Record<string, any> = {}) => ({
  id, imei, marketplace: 'TEMU' as const, orderNumber: `PO-${id}`, saleDate: '2026-10-10', ...o,
});

describe('RTS reasons', () => {
  it('matches the spellings the team actually types', () => {
    expect(isRtsReason('QC Fail - RTS (Return to Supplier)')).toBe(true);
    expect(isRtsReason('rts')).toBe(true);
    expect(isRtsReason('Returned to supplier')).toBe(true);
    expect(isRtsReason('return back to supplier')).toBe(true);
  });
  it('does not fire on other reasons or on words that merely contain the letters', () => {
    expect(isRtsReason('QC Fail - cracked screen')).toBe(false);
    expect(isRtsReason('duplicate entry')).toBe(false);
    expect(isRtsReason('SHIRTS')).toBe(false);
    expect(isRtsReason('')).toBe(false);
  });
});

describe('stock gate', () => {
  const units = [
    unit({ imei: '351554743843170' }),                                          // in stock
    unit({ imei: '350000000000009', status: 'returned', returnType: 'returned_to_supplier',
           returnDate: '2026-10-05', supplierName: 'MHL' } as any),             // live RTS record
  ];
  const archive = new Map<string, DeletedUnitRecord>([
    ['351844421137601', deleted({ imei: '351844421137601', reason: 'QC Fail - RTS (Return to Supplier)' })],
    ['350000000000077', deleted({ imei: '350000000000077', reason: 'Scrapped - water damage' })],
  ]);

  it('names every sold phone that was not in stock, and why', () => {
    const rows = classifyStockGate([
      sale('a', '351554743843170'),               // fine — in stock
      sale('b', '351844421137601'),               // deleted as RTS, then sold on Temu
      sale('c', '351554748612349'),               // NANAK A32 never stocked in
      sale('d', '350000000000077'),               // deleted, not RTS
      sale('e', '350000000000009'),               // still with the supplier
    ], units, archive);
    expect(rows.map(r => [r.imei, r.kind])).toEqual([
      ['351844421137601', 'rts'],
      ['350000000000009', 'rts'],
      ['350000000000077', 'deleted'],
      ['351554748612349', 'not_in_stock'],
    ]);
    expect(rows[0].detail).toMatch(/QC Fail - RTS/);
    expect(rows[1].detail).toMatch(/Returned to supplier \(MHL\)/);
    expect(rows[3].detail).toMatch(/Never stocked in/);
  });

  it('ignores voided sales and counts a repeated IMEI once', () => {
    const rows = classifyStockGate([
      sale('a', '351554748612349', { voidedAt: '2026-10-11' }),
      sale('b', '351554748591584'),
      sale('c', '351554748591584'),
    ], units, new Map());
    expect(rows.map(r => r.saleId)).toEqual(['b']);
  });

  it('does not flag the sale that led to an RTS (sold, came back, sent to supplier)', () => {
    const rows = classifyStockGate([sale('a', '350000000000009', { saleDate: '2026-10-01' })], units, new Map());
    expect(rows).toEqual([]);
  });

  it('does not flag a unit already sold, even if it once went to a supplier', () => {
    const rows = classifyStockGate(
      [sale('a', '350000000000009')],
      [unit({ imei: '350000000000009', status: 'sold', returnType: 'returned_to_supplier' } as any)],
      new Map(),
    );
    expect(rows).toEqual([]);
  });

  it('asks the deleted archive only about IMEIs with no stock record', () => {
    expect(imeisToLookUp([
      sale('a', '351554743843170'),
      sale('b', ' 351554748612349 '),
      sale('c', '351554748591584', { voidedAt: '2026-10-11' }),
    ], units)).toEqual(['351554748612349']);
  });
});
