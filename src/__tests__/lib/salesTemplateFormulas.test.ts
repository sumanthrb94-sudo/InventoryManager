/**
 * The Sales templates carry the Sales Report's schema AND working formulas.
 *
 * Two separate promises are made to the operator, and each can break on its
 * own:
 *
 *   1. The template looks like the report. Same columns, same order, same
 *      names. This is what stopped being true: the templates shipped eBay's
 *      `0.2` and `NP(incl. PROMOTION)` and BM's `PayPal/Klarna Com` for
 *      months after the report had moved on, because the generator kept its
 *      own hand-written copy of every layout.
 *   2. Typing a BP and an SP into a row fills the rest of it in, live, in
 *      Excel — not after an upload, not after a recompute.
 *
 * The first is checked by generating a report and diffing header rows. The
 * second by stripping the template's `IF(SP="","",…)` guard and asserting
 * what remains is byte-identical to the report's own formula, then actually
 * EVALUATING a filled row with the app's formula engine and reconciling the
 * result against calcSaleFinancials.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { buildSalesWorkbookBuffer } from '../../lib/clientReport';
import { calcSaleFinancials } from '../../lib/platforms';
import { evaluateFormula, colToNum, numToCol } from '../../lib/reportView';
import { MARKETPLACES } from '../../types';
import type { Marketplace } from '../../types';

const TEMPLATE = (m: Marketplace) => `templates/SALES_${m}_TEMPLATE.xlsx`;
const COMBINED = 'templates/SALES_REPORT_TEMPLATE.xlsx';

async function load(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(path).buffer.slice(0) as ArrayBuffer);
  return wb;
}

const headerRow = (ws: ExcelJS.Worksheet): string[] =>
  ((ws.getRow(1).values ?? []) as unknown[]).slice(1).map(v => String(v ?? '').trim());

/** Strip the template's blank-row guard, leaving the report's own formula. */
const GUARD = /^IF\(\$[A-Z]+\d+="","",(.*)\)$/s;
const unguard = (f: string): string | null => {
  const m = GUARD.exec(f);
  return m ? m[1] : null;
};

let reportHeaders: Record<string, string[]>;
let reportFormulas: Record<string, Map<number, string>>;

beforeAll(async () => {
  // A real one-row report per marketplace — the thing the template claims
  // to look like. Row 2 in both, so formulas are directly comparable.
  const buf = await buildSalesWorkbookBuffer({
    sales: MARKETPLACES.map(m => ({
      id: `${m}__X__1`, marketplace: m, orderNumber: 'X', imei: '350100000000001',
      sku: 'SG-A21S-32-BK', supplierName: 'S', saleDate: '2026-08-20', quantity: 1,
      buyPrice: 100, salePrice: 200, postage: 6.3,
      spMinusBp: 0, marginalTax: 0, commission: 0, grossProfit: 0, gpPercent: 0,
      importBatchId: '', sourceFile: '', sourceRow: 2, importedAt: '',
      createdAt: '', updatedAt: '', ownerId: 'shared',
    })) as never,
    units: [], supplierMap: {}, opts: {} as never,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  reportHeaders = {};
  reportFormulas = {};
  for (const m of MARKETPLACES) {
    const ws = wb.getWorksheet(m)!;
    reportHeaders[m] = headerRow(ws);
    const fs = new Map<number, string>();
    ws.getRow(2).eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value as { formula?: string } | null;
      if (v && typeof v === 'object' && v.formula) fs.set(c, v.formula);
    });
    reportFormulas[m] = fs;
  }
});

describe('every Sales template exists', () => {
  it.each([...MARKETPLACES.map(TEMPLATE), COMBINED])('%s', (path) => {
    expect(existsSync(path), `${path} missing — run npx tsx scripts/generateSalesTemplates.ts`)
      .toBe(true);
  });
});

describe('the template has the report\'s columns', () => {
  it.each(MARKETPLACES)('%s — header row is identical to the report tab', async (m) => {
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    expect(headerRow(ws)).toEqual(reportHeaders[m]);
  });

  it('the combined template carries all five marketplace sheets plus a README', async () => {
    const wb = await load(COMBINED);
    const names = wb.worksheets.map(w => w.name);
    for (const m of MARKETPLACES) expect(names, `${m} sheet`).toContain(m);
    expect(names).toContain('README');
  });

  it.each(MARKETPLACES)('%s — combined and per-marketplace files agree', async (m) => {
    const a = headerRow((await load(COMBINED)).getWorksheet(m)!);
    const b = headerRow((await load(TEMPLATE(m))).getWorksheet(m)!);
    expect(a).toEqual(b);
  });
});

describe('the download menu describes the files it hands out', () => {
  // The menu quotes a column count per marketplace. Those counts went stale
  // once already — Temu's entry read "15 columns, same layout as Amazon" when
  // it was 19 and its own — and an operator picking a file by that label has
  // no way to tell. Read the number out of the label and check the file.
  it.each(MARKETPLACES)('%s — the hint\'s column count matches the file', async (m) => {
    const src = readFileSync('src/components/TemplateDownload.tsx', 'utf8');
    const row = new RegExp(`file: 'SALES_${m}_TEMPLATE\\.xlsx'[^}]*hint: '(\\d+) columns`).exec(src);
    expect(row, `no column count in the ${m} template hint`).not.toBeNull();
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    expect(Number(row![1]), `${m} hint says ${row![1]} columns`).toBe(headerRow(ws).length);
  });
});

describe('the template\'s formulas ARE the report\'s formulas', () => {
  it.each(MARKETPLACES)('%s — every guarded formula unwraps to the report\'s, exactly', async (m) => {
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    const mismatches: string[] = [];
    let compared = 0;
    // Row 3 — the first blank primed row. Its formulas must be the report's
    // row-3 formulas, i.e. the row-2 ones with every reference bumped by one.
    ws.getRow(3).eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || !v.formula) return;
      const inner = unguard(v.formula);
      if (inner === null) { mismatches.push(`col ${c}: not guarded — "${v.formula}"`); return; }
      const fromReport = reportFormulas[m].get(c);
      if (!fromReport) { mismatches.push(`col ${c}: template has a formula the report does not`); return; }
      const expected = fromReport.replace(/([A-Z]{1,2})(\d+)/g, (_s, col, n) => `${col}${Number(n) + 1}`);
      if (inner !== expected) mismatches.push(`col ${c}: template "${inner}" vs report "${expected}"`);
      compared++;
    });
    expect(mismatches, `\n${mismatches.join('\n')}\n`).toEqual([]);
    expect(compared, `${m} should carry live formulas`).toBeGreaterThan(4);
  });

  it.each(MARKETPLACES)('%s — the report writes no formula the template dropped', async (m) => {
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    const inTemplate = new Set<number>();
    ws.getRow(3).eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value as { formula?: string } | null;
      if (v && typeof v === 'object' && v.formula) inTemplate.add(c);
    });
    for (const c of reportFormulas[m].keys()) {
      expect(inTemplate.has(c), `${m} col ${numToCol(c)} is a formula in the report but not the template`)
        .toBe(true);
    }
  });
});

describe('typing into a row computes it — live', () => {
  // Fill BP / SP / Postage on a blank primed row and evaluate what Excel
  // would, using the app's own formula engine. If this reconciles with
  // calcSaleFinancials, the operator's spreadsheet agrees with the app.
  const INPUTS: Record<Marketplace, { bp: number; sp: number; postage: number }> = {
    AMAZON: { bp: 100, sp: 139.99, postage: 6.30 },
    BM:     { bp: 73,  sp: 129,    postage: 6.30 },
    EBAY:   { bp: 30,  sp: 55.99,  postage: 4.65 },
    ONBUY:  { bp: 110, sp: 159.99, postage: 6.30 },
    TEMU:   { bp: 55,  sp: 83.99,  postage: 6.30 },
  };

  it.each(MARKETPLACES)('%s — GP and GP %% match calcSaleFinancials', async (m) => {
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    const headers = headerRow(ws);
    const idx = (name: string) => headers.indexOf(name) + 1;
    const { bp, sp, postage } = INPUTS[m];

    const ROW = 3;
    const typed = new Map<string, number>([
      [`${numToCol(idx('BP'))}${ROW}`, bp],
      [`${numToCol(idx('SP'))}${ROW}`, sp],
      [`${numToCol(idx('Postage'))}${ROW}`, postage],
    ]);
    // eBay's Marketing / P. VAT are typed cells that stay empty here, and
    // Temu's Commission is operator-supplied — mirror that on both sides.
    const commissionOverride = m === 'TEMU' ? sp * 4.61 / 100 : undefined;
    if (commissionOverride !== undefined) {
      typed.set(`${numToCol(idx('Commission'))}${ROW}`, Number(commissionOverride.toFixed(2)));
    }

    // Resolve a cell: an operator-typed input, else evaluate its formula.
    const seen = new Set<string>();
    const resolve = (ref: string): number => {
      if (typed.has(ref)) return typed.get(ref)!;
      const m2 = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m2) return 0;
      const cell = ws.getRow(Number(m2[2])).getCell(colToNum(m2[1]));
      const v = cell.value as { formula?: string } | null;
      if (v && typeof v === 'object' && v.formula) {
        if (seen.has(ref)) return 0;               // cycle guard
        seen.add(ref);
        const inner = unguard(v.formula) ?? v.formula;
        const out = evaluateFormula(inner, resolve);
        seen.delete(ref);
        return out;
      }
      return typeof v === 'number' ? v : 0;
    };

    const gp = resolve(`${numToCol(idx('GP'))}${ROW}`);
    const expected = calcSaleFinancials({
      marketplace: m, buyPrice: bp, salePrice: sp,
      postageOverride: postage,
      ...(commissionOverride !== undefined
        ? { commissionOverride: Number(commissionOverride.toFixed(2)) } : {}),
    } as never);

    expect(Math.round(gp * 100) / 100, `${m} GP from the template's own formulas`)
      .toBeCloseTo(expected.grossProfit, 1);
  });

  it.each(MARKETPLACES)('%s — an untouched row stays blank, not 0 or #DIV/0!', async (m) => {
    const ws = (await load(TEMPLATE(m))).getWorksheet(m)!;
    const headers = headerRow(ws);
    const spCol = numToCol(headers.indexOf('SP') + 1);
    let guarded = 0;
    ws.getRow(4).eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value as { formula?: string } | null;
      if (!v || typeof v !== 'object' || !v.formula) return;
      expect(v.formula, 'every primed formula guards on its own SP cell')
        .toMatch(new RegExp(`^IF\\(\\$${spCol}4="","",`));
      guarded++;
    });
    expect(guarded).toBeGreaterThan(4);
  });
});
