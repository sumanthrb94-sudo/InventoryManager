/**
 * Every Excel formula the Sales Report writes, checked against the formula
 * documented for it — for all five marketplaces, in one pass.
 *
 * Why this exists: the E2E run spot-checks a handful of formulas per
 * marketplace (Marginal Tax, Commission, a VAT line). AMAZON alone emits
 * twelve. A formula that nobody asserts can change silently, and because the
 * workbook carries live formulas rather than values, a wrong one is wrong for
 * every historical row the moment it ships.
 *
 * Ground truth is SALES_SCHEMA_AND_CALCULATIONS.md — PARSED, not transcribed.
 * That is deliberate: transcribing it here would create a third copy to keep
 * in step, and the doc is the artefact an accountant is handed. If the code
 * and the doc disagree, one of them is wrong and this fails either way.
 *
 * The assertion runs in both directions:
 *   - every documented formula appears in the report          (nothing dropped)
 *   - every report formula is documented                      (nothing undocumented)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { MARKETPLACES } from '../../types';
import type { InventoryUnit, Marketplace, Sale } from '../../types';

/** Doc heading → marketplace code. */
const SECTION_TO_MARKETPLACE: Record<string, Marketplace> = {
  'AMAZON': 'AMAZON',
  'BACK MARKET (BM)': 'BM',
  'EBAY': 'EBAY',
  'ONBUY': 'ONBUY',
  'TEMU': 'TEMU',
};

/**
 * Pull the per-marketplace formula tables out of the spec.
 * Rows look like:  | Marginal Tax | `(SP−BP) × 16.67%` | `I2*16.67%` |
 * The third cell is the Excel formula; the first is the column it belongs to.
 */
function parseDocumentedFormulas(): Record<Marketplace, Map<string, string>> {
  const md = readFileSync('SALES_SCHEMA_AND_CALCULATIONS.md', 'utf8');
  const out = {} as Record<Marketplace, Map<string, string>>;
  for (const m of MARKETPLACES) out[m] = new Map();

  let current: Marketplace | null = null;
  for (const line of md.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = SECTION_TO_MARKETPLACE[heading[1].trim()] ?? null;
      continue;
    }
    if (!current) continue;
    // | Line | maths | `excel` |
    // The middle cell is prose and carries markdown of its own (bold, inline
    // code). Don't try to parse it — only the third cell is machine-checked.
    const row = /^\|\s*([^|]+?)\s*\|[^|]*\|\s*`([^`]*)`\s*\|\s*$/.exec(line);
    if (!row) continue;
    const [, label, excel] = row;
    // "literal" / "literal cell" marks a value written straight in, not a
    // formula — there is nothing for the report to match.
    if (!excel.trim() || /^literal/i.test(excel.trim())) continue;
    out[current].set(label.trim(), excel.trim());
  }
  return out;
}

/** Column header → formula, for one marketplace tab of a generated report. */
function formulasByColumn(ws: ExcelJS.Worksheet): Map<string, string> {
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(h => String(h ?? '').trim());
  const found = new Map<string, string>();
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const v = cell.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || !v.formula) return;
      const key = headers[colNumber - 1] || `col${colNumber}`;
      // A TOTAL row repeats a column with SUM(); keep the first (data row).
      if (!found.has(key)) found.set(key, v.formula);
    });
  });
  return found;
}

const unit = (over: Partial<InventoryUnit> = {}): InventoryUnit => ({
  id: 'u1', imei: '350111000000011', model: 'Galaxy A21S', storage: '32GB',
  colour: 'Midnight', status: 'sold', buyPrice: 350, dateIn: '2026-07-01',
  flags: [], platformListed: false, supplierId: 'sup-1', supplierName: 'IMAX',
  ownerId: 'shared', createdAt: '2026-07-01', ...over,
} as InventoryUnit);

const sale = (m: Marketplace): Sale => ({
  id: `${m}__ORD-1__350111000000011`, marketplace: m, orderNumber: 'ORD-1',
  imei: '350111000000011', unitId: 'u1', sku: 'Samsung Galaxy A21S',
  saleDate: '2026-07-29', quantity: 1, buyPrice: 350, salePrice: 499.99,
  postage: 6.3, spMinusBp: 149.99, marginalTax: 25, commission: 35,
  grossProfit: 73.59, gpPercent: 21.03,
  importBatchId: 'b1', sourceFile: 'f', sourceRow: 1, importedAt: '',
  createdAt: '', updatedAt: '', ownerId: 'shared',
} as Sale);

async function generatedReport() {
  const buf = await buildSalesWorkbookBuffer({
    sales: MARKETPLACES.map(sale),
    units: [unit()],
    supplierMap: {},
    opts: {} as never,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

/** Column names in the doc that differ from the report's header text. */
const DOC_TO_HEADER: Record<string, string> = {
  'SP − BP': 'SP-BP',
  'DSF VAT': 'DSF. VAT',
  'P. VAT': 'P. VAT',
};
const headerFor = (docLabel: string) => DOC_TO_HEADER[docLabel] ?? docLabel;

/** Report columns whose formula is a row-total SUM(), not a calculation —
 *  they carry no per-line maths, so the spec has nothing to say about them. */
const isRowTotal = (f: string) => /^SUM\(/i.test(f);

describe('Sales Report formulas match SALES_SCHEMA_AND_CALCULATIONS.md', () => {
  it('parses a formula table for every marketplace', () => {
    const doc = parseDocumentedFormulas();
    for (const m of MARKETPLACES) {
      expect(doc[m].size, `${m} has no documented formulas — heading renamed?`).toBeGreaterThan(0);
    }
  });

  it('writes every documented formula, exactly as documented', async () => {
    const doc = parseDocumentedFormulas();
    const wb = await generatedReport();
    const mismatches: string[] = [];

    for (const m of MARKETPLACES) {
      const actual = formulasByColumn(wb.getWorksheet(m)!);
      for (const [label, expected] of doc[m]) {
        const got = actual.get(headerFor(label));
        if (got === undefined) {
          mismatches.push(`${m} · ${label}: documented "${expected}" but the report writes no formula for that column`);
        } else if (got !== expected) {
          mismatches.push(`${m} · ${label}: doc "${expected}" vs report "${got}"`);
        }
      }
    }
    expect(mismatches, `\n${mismatches.join('\n')}\n`).toEqual([]);
  });

  it('documents every formula it writes — no undocumented maths', async () => {
    const doc = parseDocumentedFormulas();
    const wb = await generatedReport();
    const undocumented: string[] = [];

    for (const m of MARKETPLACES) {
      const documented = new Set([...doc[m].keys()].map(headerFor));
      for (const [header, formula] of formulasByColumn(wb.getWorksheet(m)!)) {
        if (isRowTotal(formula)) continue;          // column totals, not maths
        if (documented.has(header)) continue;
        undocumented.push(`${m} · ${header} = ${formula}`);
      }
    }
    expect(undocumented, `\nFormulas in the report with no entry in the spec:\n${undocumented.join('\n')}\n`).toEqual([]);
  });
});
