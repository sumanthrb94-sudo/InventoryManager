/**
 * quarterlyReport.test.ts — verifies the quarter helpers and the
 * end-to-end round-trip: the operator drops the client master file in
 * (catch-up import) → app generates a quarterly SALES_REPORT in the
 * same byte-equivalent format → re-parsing that file yields the same
 * sale records (within float noise).
 */
import { describe, it, expect } from 'vitest';
import {
  quarterDateRange,
  salesReportFilenameForQuarter,
  buildSalesWorkbookBuffer,
} from '../../lib/clientReport';
import { parseSalesWorkbook } from '../../lib/salesImport';
import { calcSaleFinancials } from '../../lib/platforms';
import type { Sale } from '../../types';

describe('quarterDateRange', () => {
  it('Q1 → Jan 1 – Mar 31', () => {
    expect(quarterDateRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });
  it('Q2 → Apr 1 – Jun 30', () => {
    expect(quarterDateRange(2026, 2)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });
  it('Q3 → Jul 1 – Sep 30', () => {
    expect(quarterDateRange(2026, 3)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });
  it('Q4 → Oct 1 – Dec 31', () => {
    expect(quarterDateRange(2026, 4)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });
  it('handles leap-year February correctly via Q1', () => {
    // 2024 Feb has 29 days but Q1 still ends Mar 31 — sanity that we use
    // last-day-of-quarter-month, not last-day-of-Feb.
    expect(quarterDateRange(2024, 1).to).toBe('2024-03-31');
  });
});

describe('salesReportFilenameForQuarter', () => {
  it('formats as SALES_REPORT_${year}_Q${q}.xlsx', () => {
    expect(salesReportFilenameForQuarter(2026, 2)).toBe('SALES_REPORT_2026_Q2.xlsx');
    expect(salesReportFilenameForQuarter(2025, 4)).toBe('SALES_REPORT_2025_Q4.xlsx');
  });
});

describe('round-trip: build SALES_REPORT → reparse → same Sale records', () => {
  it('preserves BP/SP/postage/accessories and recomputes derived fields identically', async () => {
    // Synthesize 4 sales — one per marketplace, all in Q2-2026, that exercise
    // each tab's column layout.
    const baseSale = {
      saleDate: '2026-04-15',
      quantity: 1,
      paymentMode: undefined,
      pVat: 0, totalVat: 0, totalVatNtp: 0,
      spMinusBp: 0, marginalTax: 0, commission: 0,
      grossProfit: 0, gpPercent: 0,
      importBatchId: 'test', sourceFile: 'fixture', sourceRow: 0,
      importedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      ownerId: 'shared',
    };
    const sales: Sale[] = [
      {
        ...baseSale, id: 'AMAZON__A1', marketplace: 'AMAZON', orderNumber: 'A1',
        sku: 'SKU-A', imei: '353209102768686', supplierName: 'NIHAL',
        buyPrice: 100, salePrice: 130.03, postage: 6.30, accessories: 1,
      },
      {
        ...baseSale, id: 'BM__B1', marketplace: 'BM', orderNumber: 'B1',
        sku: 'SKU-B', imei: 'NL6CMQCYTD', supplierName: 'MHL',
        buyPrice: 85, salePrice: 134, postage: 6.30, accessories: 1,
        paymentMode: 'Google Pay',
      },
      {
        ...baseSale, id: 'EBAY__E1', marketplace: 'EBAY', orderNumber: 'E1',
        sku: 'SKU-E', imei: 'SKC9P3QVP6F', supplierName: 'NANAK',
        buyPrice: 130, salePrice: 159.99, postage: 6.30, accessories: 1,
      },
      {
        ...baseSale, id: 'ONBUY__O1', marketplace: 'ONBUY', orderNumber: 'O1',
        sku: 'SKU-O', imei: '358015978047153', supplierName: 'MHL',
        buyPrice: 150, salePrice: 189.99, postage: 6.30, accessories: 1,
      },
    ];

    const buf = await buildSalesWorkbookBuffer({
      sales,
      opts: { from: '2026-04-01', to: '2026-06-30' },
    });
    const reparsed = await parseSalesWorkbook(buf, 'roundtrip.xlsx');

    // SheetJS doesn't evaluate formulas on read, so the reparser will see
    // null for SP-BP / Commission / etc. — that's expected. The check here is
    // that the BASE columns (BP / SP / Postage / Acc / IMEI / Order#) survive.
    expect(reparsed.perSheetCounts).toEqual({ AMAZON: 1, BM: 1, EBAY: 1, ONBUY: 1 });
    expect(reparsed.errors).toEqual([]);

    for (const original of sales) {
      const round = reparsed.sales.find(s => s.marketplace === original.marketplace);
      expect(round, `missing reparsed row for ${original.marketplace}`).toBeDefined();
      expect(round!.buyPrice).toBeCloseTo(original.buyPrice, 9);
      expect(round!.salePrice).toBeCloseTo(original.salePrice, 9);
      expect(round!.postage).toBeCloseTo(original.postage, 9);
      expect(round!.accessories).toBeCloseTo(original.accessories, 9);
      expect(round!.imei).toBe(original.imei);
      expect(round!.orderNumber).toBe(original.orderNumber);
      // Reparser recomputes GP from BP/SP/postage/accessories. Verify it
      // matches a fresh calcSaleFinancials call with the same inputs to ≤1e-9.
      const fresh = calcSaleFinancials({
        marketplace: original.marketplace,
        buyPrice: original.buyPrice,
        salePrice: original.salePrice,
        postage: original.postage,
        accessories: original.accessories,
      });
      expect(round!.grossProfit).toBeCloseTo(fresh.grossProfit, 9);
      expect(round!.commission).toBeCloseTo(fresh.commission, 9);
    }
    // BM payment mode survives the round trip.
    const bm = reparsed.sales.find(s => s.marketplace === 'BM')!;
    expect(bm.paymentMode).toBe('Google Pay');
  });
});
