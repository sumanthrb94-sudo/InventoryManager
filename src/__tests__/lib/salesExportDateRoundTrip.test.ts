/**
 * Sale dates must survive the app's own export → re-import round trip.
 *
 * This is the disaster-recovery path: the only way back from a wipe is to
 * re-upload a downloaded Sales Report. If a date does not survive it, every
 * period-scoped number in the app — Sold Today, This Month, the VAT Centre's
 * quarters, the ageing buckets — silently reports against garbage after a
 * restore, and nothing about the import screen would say so.
 *
 * The specific hazard: clientReport.ts writes the Date column as a REAL Excel
 * date cell (ExcelJS type 4, numFmt "[$-409]d-mmm-yyyy"), while the marketplace
 * files the operator normally uploads carry dates as TEXT. salesImport.ts reads
 * with `XLSX.read(..., { raw: true })` and deliberately NO `cellDates`, so a
 * real date cell arrives as a bare numeric serial (46204) and is only rescued
 * by `XLSX.SSF.parse_date_code`. Text dates never touch that branch — so the
 * everyday upload path exercises none of this, and a regression here would go
 * unnoticed until the day someone actually needed to restore.
 *
 * Worth stating plainly, because it cost time to establish: under Node's CJS
 * interop `XLSX.SSF` resolves to undefined, and the serial then falls through
 * to `new Date("46204")` — the year 46204. Under Vite's resolver, which is what
 * both the app and this test use, SSF is present and the serial resolves
 * correctly. So the failure is real but reachable only from the wrong module
 * resolution; this test locks in the behaviour the app actually ships.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseSalesWorkbook } from '../../lib/salesImport';

/** Build a minimal AMAZON sheet whose Date column holds REAL date cells,
 *  exactly as clientReport.ts writes them. */
async function workbookWithRealDateCells(dates: Date[]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('AMAZON');
  ws.addRow(['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP']);
  dates.forEach((d, i) => {
    const row = ws.addRow([d, `026-000000-000000${i}`, 'Samsung Galaxy A32 64GB',
      `35064748196742${i}`, 'NIHAL', 1, 100, 150]);
    const cell = row.getCell(1);
    cell.value = d;
    cell.numFmt = '[$-409]d-mmm-yyyy';
  });
  const buf = await wb.xlsx.writeBuffer();
  return {
    name: 'sales-report-roundtrip.xlsx',
    arrayBuffer: async () => buf,
  } as unknown as File;
}

describe('sale dates survive export → re-import', () => {
  it('reads a real Excel date cell back as the same calendar day', async () => {
    const file = await workbookWithRealDateCells([new Date(Date.UTC(2026, 6, 29, 12, 0, 0))]);
    const out = await parseSalesWorkbook(file, file.name);

    // A single-sheet fixture legitimately reports the four absent marketplace
    // sheets; only ROW-level problems would mean the date failed to read.
    expect(out.errors.filter(e => e.row > 0)).toEqual([]);
    expect(out.sales).toHaveLength(1);
    expect(out.sales[0].saleDate).toBe('2026-07-29');
  });

  it('never yields an out-of-range year — the raw-serial failure signature', async () => {
    // 46204 read as text rather than as a serial becomes the year 46204. Any
    // year outside a sane trading window means the serial branch broke.
    const file = await workbookWithRealDateCells([
      new Date(Date.UTC(2026, 0, 1, 12)),
      new Date(Date.UTC(2026, 11, 31, 12)),
      new Date(Date.UTC(2025, 5, 15, 12)),
    ]);
    const out = await parseSalesWorkbook(file, file.name);

    expect(out.sales).toHaveLength(3);
    for (const s of out.sales) {
      const year = Number((s.saleDate || '').slice(0, 4));
      expect(year).toBeGreaterThanOrEqual(2000);
      expect(year).toBeLessThanOrEqual(2100);
    }
    expect(out.sales.map(s => s.saleDate).sort())
      .toEqual(['2025-06-15', '2026-01-01', '2026-12-31']);
  });

  it('a year-boundary date does not drift a day either way', async () => {
    // Timezone handling is the usual culprit for off-by-one on 1 Jan / 31 Dec.
    const file = await workbookWithRealDateCells([new Date(Date.UTC(2026, 0, 1, 12))]);
    const out = await parseSalesWorkbook(file, file.name);
    expect(out.sales[0].saleDate).toBe('2026-01-01');
  });

  it('still reads TEXT dates, which is what marketplace files carry', async () => {
    // The everyday path must not regress while fixing the export path.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('AMAZON');
    ws.addRow(['Date', 'Order Number', 'SKU', 'IMEI', 'Supplier', 'Quantity', 'BP', 'SP']);
    ws.addRow(['2026-07-29', '026-0000000-0000001', 'Samsung Galaxy A32 64GB',
      '350647481967424', 'NIHAL', 1, 100, 150]);
    const buf = await wb.xlsx.writeBuffer();
    const file = { name: 'text-dates.xlsx', arrayBuffer: async () => buf } as unknown as File;

    const out = await parseSalesWorkbook(file, file.name);
    expect(out.sales[0].saleDate).toBe('2026-07-29');
  });
});
