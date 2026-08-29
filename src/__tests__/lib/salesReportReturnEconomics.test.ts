/**
 * The return block carries the WHOLE cost of the return, per marketplace row.
 *
 * Operator, 2026-08-29: "returns or replacement data should be shown in the
 * sales report by marketplace". Before this, a returned row showed only its
 * carriage (Postage Loss) — the fees the channel kept, the repair invoice and
 * the supplier credit lived on the Returns sheets alone, so the marketplace
 * tab's Net GP forgave ~£27 of kept fees on every refunded BM handset.
 *
 * Four columns close that gap: Fees Kept, Repair Cost, Supplier Credit, and
 * Return Cost — a live formula summing them with Postage Loss. Net GP £
 * subtracts Return Cost. Each test pins one rule of the design.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { salesCol } from '../../lib/platforms';
import type { InventoryUnit, Sale } from '../../types';

const sale = (over: Partial<Sale>): Sale => ({
  id: 'S1', marketplace: 'AMAZON', orderNumber: 'O1', imei: '350000000000001',
  saleDate: '2026-08-01', quantity: 1, buyPrice: 250, salePrice: 308,
  createdAt: '', updatedAt: '', ownerId: 'shared',
  ...over,
} as Sale);

const at = (ws: ExcelJS.Worksheet, row: number, name: string) =>
  ws.getRow(row).getCell(salesCol(ws.name as any, name));

async function build(sales: Sale[], units: InventoryUnit[] = []) {
  const buf = await buildSalesWorkbookBuffer({ sales, units, supplierMap: {}, opts: {} as never });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

describe('Fees Kept — the marketplace-wise refund fee, on the marketplace tab', () => {
  it('a refunded AMAZON row carries the £5.17 admin fee from the real statement', async () => {
    const wb = await build([sale({
      commission: 21.56,
      voidedAt: '2026-08-04', voidOutcome: 'refund', voidReason: 'faulty',
      postage: 6.30, postageVat: 1.26,
    })]);
    const ws = wb.getWorksheet('AMAZON')!;
    // min(20% × £21.56, £5) × 1.2 = £5.17 — order 203-5323406-8518721.
    expect(at(ws, 2, 'Fees Kept').value).toBeCloseTo(5.17, 2);
  });

  it('a replacement row carries NO fees — no refund reached the marketplace', async () => {
    // Deliberately a LEGACY void (no gpBasis stamp): the fee rule follows
    // the outcome, not the era. Operator: "not for any replacement".
    const wb = await build([sale({
      marketplace: 'EBAY', commission: 5.28, salePrice: 84.99,
      voidedAt: '2026-08-04', voidOutcome: 'replacement', voidReason: 'faulty',
      postage: 4.65, postageVat: 0,
    })]);
    const ws = wb.getWorksheet('EBAY')!;
    expect(at(ws, 2, 'Fees Kept').value ?? null).toBeNull();
  });
});

describe('Repair Cost and Supplier Credit — unit-side facts, day-guarded', () => {
  const repairUnit = (over: Partial<InventoryUnit> = {}): InventoryUnit => ({
    id: 'u1', imei: '350000000000001', model: 'Galaxy A32', status: 'returned',
    returnType: 'repair', returnDate: '2026-08-04', repairCost: 64.5,
    buyPrice: 250, dateIn: '2026-07-01', ownerId: 'shared',
    ...over,
  } as InventoryUnit);

  it('an entered repair invoice lands on the row', async () => {
    const wb = await build(
      [sale({ unitId: 'u1', voidedAt: '2026-08-04', voidOutcome: 'repair', voidReason: 'screen' })],
      [repairUnit()],
    );
    const ws = wb.getWorksheet('AMAZON')!;
    expect(at(ws, 2, 'Repair Cost').value).toBeCloseTo(64.5, 2);
  });

  it('an un-entered invoice stays BLANK — absent is not zero', async () => {
    const wb = await build(
      [sale({ unitId: 'u1', voidedAt: '2026-08-04', voidOutcome: 'repair', voidReason: 'screen' })],
      [repairUnit({ repairCost: undefined })],
    );
    const ws = wb.getWorksheet('AMAZON')!;
    expect(at(ws, 2, 'Repair Cost').value ?? null).toBeNull();
  });

  /** The unit's return fields are its CURRENT state. A unit returned, resold
   *  and returned again carries only the latest cycle — attaching that
   *  cycle's invoice to an older sale's row would bill it twice. */
  it('a different-day return cycle does NOT attach its costs to this row', async () => {
    const wb = await build(
      [sale({ unitId: 'u1', voidedAt: '2026-06-01', voidOutcome: 'repair', voidReason: 'old cycle' })],
      [repairUnit()],   // unit's cycle is 2026-08-04, not this sale's
    );
    const ws = wb.getWorksheet('AMAZON')!;
    expect(at(ws, 2, 'Repair Cost').value ?? null).toBeNull();
  });

  it('a supplier credit lands on the row and reduces the Return Cost formula', async () => {
    const wb = await build(
      [sale({ unitId: 'u1', voidedAt: '2026-08-04', voidOutcome: 'refund', voidReason: 'dead' })],
      [repairUnit({ returnType: 'returned_to_supplier', repairCost: undefined, supplierCreditAmount: 120 })],
    );
    const ws = wb.getWorksheet('AMAZON')!;
    expect(at(ws, 2, 'Supplier Credit').value).toBeCloseTo(120, 2);
  });
});

describe('Return Cost — one live formula, and Net GP subtracts it', () => {
  it('sums Postage Loss + Fees Kept + Repair Cost − Supplier Credit', async () => {
    const wb = await build([sale({
      commission: 21.56,
      voidedAt: '2026-08-04', voidOutcome: 'refund', voidReason: 'faulty',
      postage: 6.30, postageVat: 1.26,
    })]);
    const ws = wb.getWorksheet('AMAZON')!;
    const L = (n: string) => {
      const c = salesCol('AMAZON', n);
      let s = ''; let x = c;
      while (x > 0) { s = String.fromCharCode(65 + ((x - 1) % 26)) + s; x = Math.floor((x - 1) / 26); }
      return s;
    };
    const rc = at(ws, 2, 'Return Cost').value as { formula?: string };
    expect(rc.formula).toBe(`${L('Postage Loss')}2+${L('Fees Kept')}2+${L('Repair Cost')}2-${L('Supplier Credit')}2`);
    const ng = at(ws, 2, 'Net GP £').value as { formula?: string };
    expect(ng.formula).toBe(`${L('GP')}2-${L('Return Cost')}2`);
  });

  it('an ACTIVE row leaves the whole block blank — SUM over the period is unpolluted', async () => {
    const wb = await build([sale({})]);
    const ws = wb.getWorksheet('AMAZON')!;
    for (const c of ['Postage Loss', 'Fees Kept', 'Repair Cost', 'Supplier Credit', 'Return Cost']) {
      const v = at(ws, 2, c).value ?? null;
      expect(v, c).toBeNull();
    }
  });
});
