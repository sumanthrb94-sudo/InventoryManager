/**
 * The positive GP % on a returned unit.
 *
 * THE COMPLAINT
 *
 * "A unit is returned after being marked sold, it still shows in the Sales
 *  Report, we lose postage only and the unit is back in inventory — so
 *  technically we made a loss. Why is GP % positive?"
 *
 * WHAT WAS ACTUALLY HAPPENING
 *
 * The returned row carried the SAME GP formula as a clean sale. GP % is
 * (GP − Postage Loss) / SP, so on a typical unit it read
 *
 *      (£41 gross profit − £19.20 postage) / £400  =  +5.5%
 *
 * when the truth was −£19.20. The report was not under-recording the loss; it
 * was keeping a profit that had been refunded. And because the TOTAL row is
 * SUM(GP:GP), every returned row pushed its phantom profit into the
 * marketplace total as well.
 *
 * THE RULE
 *
 * Zero the GP cell when — and only when — the customer actually got their
 * money back. Two routes leave the payment with us and must keep their profit:
 * a replacement (the customer keeps what they paid and receives a handset)
 * and a repair after the warranty refund window.
 *
 * Returns recorded before the correction are untouched: the operator chose to
 * apply this from today onward, so the cutoff is stamped on each return as
 * gpBasis rather than inferred from a deploy date.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import {
  processReturnSalePatch,
  customerWasRefunded,
  WARRANTY_REFUND_DAYS,
} from '../../lib/processReturnSalePatch';
import { saleKeptItsRevenue } from '../../lib/returnLoss';

const base = {
  marketplace: 'AMAZON', saleDate: '2026-08-01', orderNumber: 'A1',
  sku: 'IPHONE 13', imei: '111', buyPrice: 300, salePrice: 400,
  commission: 40, commissionVat: 8, dsf: 0.8, dsfVat: 0.16,
  postage: 8, postageVat: 1.6, grossProfit: 60, gpPercent: 15,
} as any;

/** Read the AMAZON tab back out of a generated workbook. */
async function amazonTab(sales: any[]) {
  const buf = await buildSalesWorkbookBuffer(
    { sales, units: [], suppliers: [], accessories: [] } as any,
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const sh = wb.getWorksheet('AMAZON')!;
  const hdr = sh.getRow(1).values as any[];
  const cell = (row: number, name: string) => sh.getRow(row).getCell(hdr.indexOf(name)).value;
  return { sh, cell };
}

describe('a refunded return keeps no profit on the marketplace tab', () => {
  it('zeroes the GP cell', async () => {
    const { cell } = await amazonTab([
      { ...base, id: 's1' },
      {
        ...base, id: 's2', orderNumber: 'A2', imei: '222',
        voidedAt: '2026-08-05', voidOutcome: 'refund', voidReason: 'Refund — changed mind',
        customerRefunded: true, gpBasis: 'returns_v2',
      },
    ]);
    // Row 2 is the clean sale and keeps its formula; row 3 was refunded.
    expect(cell(2, 'GP')).toHaveProperty('formula');
    expect(cell(3, 'GP')).toBe(0);
  });

  it('still records the postage as the real loss', async () => {
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-08-05', voidOutcome: 'refund',
      customerRefunded: true, gpBasis: 'returns_v2',
    }]);
    // 2 legs x (postage 8 + P.VAT 1.6).
    expect(cell(2, 'Postage Loss')).toBeCloseTo(19.2, 2);
  });

  it('leaves GP % and Net GP as formulas, so both follow the zeroed GP', async () => {
    // The point of zeroing the GP cell rather than overwriting three cells:
    // GP % is already (GP − Postage Loss)/SP and Net GP is GP − Postage Loss,
    // so both turn negative on their own. If a future change froze either into
    // a literal, this catches it.
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-08-05', voidOutcome: 'refund',
      customerRefunded: true, gpBasis: 'returns_v2',
    }]);
    expect(cell(2, 'GP %')).toHaveProperty('formula');
    expect(cell(2, 'Net GP £')).toHaveProperty('formula');
  });
});

describe('returns that kept the money keep their profit', () => {
  it('a replacement does not lose its GP', async () => {
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-08-05', voidOutcome: 'replacement',
      customerRefunded: false, gpBasis: 'returns_v2',
    }]);
    expect(cell(2, 'GP')).toHaveProperty('formula');
  });

  it('a repair after the warranty window does not lose its GP', async () => {
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-10-01', voidOutcome: 'repair',
      customerRefunded: false, gpBasis: 'returns_v2',
    }]);
    expect(cell(2, 'GP')).toHaveProperty('formula');
  });
});

describe('returns recorded before the correction are untouched', () => {
  it('a void with no gpBasis keeps the old behaviour', async () => {
    // This is what "apply it from today onward" has to mean in the data: a
    // return already on file must export exactly as it did yesterday, or the
    // operator's previously issued reports stop reproducing.
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-07-01', voidOutcome: 'refund',
    }]);
    expect(cell(2, 'GP')).toHaveProperty('formula');
  });

  it('gpBasis without customerRefunded does not zero anything', async () => {
    const { cell } = await amazonTab([{
      ...base, id: 's2', voidedAt: '2026-08-05', voidOutcome: 'refund', gpBasis: 'returns_v2',
    }]);
    expect(cell(2, 'GP')).toHaveProperty('formula');
  });
});

describe('the warranty window decides whether a repair was refunded', () => {
  const call = (saleDate: string, returnDate: string) =>
    customerWasRefunded({ returnType: 'repair', outcome: 'refund', returnDate, reason: 'x', saleDate });

  it('is a refund on the last day of the window', () => {
    expect(WARRANTY_REFUND_DAYS).toBe(30);
    expect(call('2026-08-01', '2026-08-31')).toBe(true);   // exactly 30 days
  });

  it('is not a refund the day after', () => {
    expect(call('2026-08-01', '2026-09-01')).toBe(false);  // 31 days
  });

  it('treats a missing sale date as a refund', () => {
    // The conservative direction: assume the money went back rather than
    // credit the business with profit it may not have kept.
    expect(customerWasRefunded({
      returnType: 'repair', outcome: 'refund', returnDate: '2026-09-01', reason: 'x',
    })).toBe(true);
  });

  it('a replacement is never a refund, however long after the sale', () => {
    expect(customerWasRefunded({
      returnType: 'returned_to_inventory', outcome: 'replacement',
      returnDate: '2027-01-01', reason: 'x', saleDate: '2026-08-01',
    })).toBe(false);
  });

  it('a refund outcome is a refund regardless of date', () => {
    expect(customerWasRefunded({
      returnType: 'returned_to_inventory', outcome: 'refund',
      returnDate: '2027-01-01', reason: 'x', saleDate: '2026-08-01',
    })).toBe(true);
  });
});

describe('the sale patch records the basis it was written under', () => {
  it('stamps customerRefunded and gpBasis', () => {
    const p = processReturnSalePatch({
      returnType: 'returned_to_inventory', outcome: 'refund',
      returnDate: '2026-08-05', reason: 'changed mind', saleDate: '2026-08-01',
    });
    expect(p.customerRefunded).toBe(true);
    expect(p.gpBasis).toBe('returns_v2');
    expect(p.voidOutcome).toBe('refund');
  });

  it('marks a replacement as not refunded', () => {
    const p = processReturnSalePatch({
      returnType: 'returned_to_inventory', outcome: 'replacement',
      returnDate: '2026-08-05', reason: 'faulty', saleDate: '2026-08-01',
    });
    expect(p.customerRefunded).toBe(false);
    expect(p.voidOutcome).toBe('replacement');
  });
});

describe('which sales the in-app revenue surfaces should count', () => {
  it('counts a live sale', () => {
    expect(saleKeptItsRevenue({ } as any)).toBe(true);
  });

  it('drops a refunded return', () => {
    expect(saleKeptItsRevenue({
      voidedAt: '2026-08-05', gpBasis: 'returns_v2', customerRefunded: true,
    })).toBe(false);
  });

  it('keeps a replacement', () => {
    expect(saleKeptItsRevenue({
      voidedAt: '2026-08-05', gpBasis: 'returns_v2', customerRefunded: false,
    })).toBe(true);
  });

  it('drops a pre-correction void, whatever its outcome', () => {
    expect(saleKeptItsRevenue({ voidedAt: '2026-07-01' })).toBe(false);
  });
});
