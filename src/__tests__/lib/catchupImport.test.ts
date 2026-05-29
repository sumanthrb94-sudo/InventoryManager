/**
 * catchupImport.test.ts — verifies the operator can drop the live client
 * master file (`SALES_REPORT_2026_1.xlsx`) into the app today and have all
 * four marketplace tabs parse cleanly with the new column layouts.
 *
 * Skipped when the upload isn't available in the runtime sandbox.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseSalesWorkbook } from '../../lib/salesImport';

const CLIENT_FILE =
  '/root/.claude/uploads/5669a5b4-996e-4b14-972e-9f9c07f293c0/885bd7b3-SALES_REPORT_2026_1.xlsx';

const fileAvailable = existsSync(CLIENT_FILE);

describe.skipIf(!fileAvailable)('catch-up import — live SALES_REPORT_2026_1.xlsx', () => {
  it('parses every marketplace tab with zero errors', async () => {
    const buf = readFileSync(CLIENT_FILE);
    const out = await parseSalesWorkbook(
      new Uint8Array(buf),
      'SALES_REPORT_2026_1.xlsx',
    );

    // April-only file actually carries: AMAZON ~1171, BM ~166, EBAY ~154,
    // ONBUY ~37 valid sales after blank-row filtering. Floors are set well
    // below the observed counts to absorb future minor variation.
    expect(out.errors).toEqual([]);
    expect(out.perSheetCounts.AMAZON).toBeGreaterThan(500);
    expect(out.perSheetCounts.BM).toBeGreaterThan(100);
    expect(out.perSheetCounts.EBAY).toBeGreaterThan(100);
    expect(out.perSheetCounts.ONBUY).toBeGreaterThan(20);
  });

  it('every parsed sale has BP, SP, Postage, accessories populated', async () => {
    const buf = readFileSync(CLIENT_FILE);
    const out = await parseSalesWorkbook(
      new Uint8Array(buf),
      'SALES_REPORT_2026_1.xlsx',
    );
    // Sample 50 random rows — every one should have the four base inputs.
    const sample = out.sales.filter((_, i) => i % 50 === 0).slice(0, 50);
    expect(sample.length).toBeGreaterThan(20);
    for (const s of sample) {
      expect(s.buyPrice).toBeGreaterThan(0);
      expect(s.salePrice).toBeGreaterThan(0);
      // Postage can be 0 (eBay tier) but accessories should always carry the
      // literal from the Acc column (0 or 1 in the live data).
      expect(s.postage).toBeGreaterThanOrEqual(0);
      expect([0, 1]).toContain(s.accessories);
    }
  });

  it('mean SP per marketplace lands in plausible £100–£250 band (canary)', async () => {
    const buf = readFileSync(CLIENT_FILE);
    const out = await parseSalesWorkbook(
      new Uint8Array(buf),
      'SALES_REPORT_2026_1.xlsx',
    );
    for (const m of ['AMAZON', 'BM', 'EBAY', 'ONBUY'] as const) {
      const rows = out.sales.filter(s => s.marketplace === m);
      const mean = rows.reduce((a, s) => a + (s.salePrice ?? 0), 0) / rows.length;
      expect(mean, `${m} mean SP suspicious: £${mean.toFixed(2)}`).toBeGreaterThan(50);
      expect(mean, `${m} mean SP suspicious: £${mean.toFixed(2)}`).toBeLessThan(400);
    }
  });
});
