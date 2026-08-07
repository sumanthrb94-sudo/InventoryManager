/**
 * The shipped upload templates must always be valid input.
 *
 * templates/*.xlsx are what the team builds every future report from. If a
 * parser's schema moves and the templates don't, operators find out by
 * having a real upload rejected. These tests run the templates through the
 * REAL parsers on every test run, so the drift is caught here instead.
 *
 * Regenerate with: node scripts/generateImportTemplates.mjs
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { parseSalesWorkbook } from '../../lib/salesImport';
import { parseStockWorkbook } from '../../lib/inventoryImportParse';
import { GRADE_OPTIONS, SIM_TYPE_OPTIONS } from '../../lib/unitConstants';


const INVENTORY_TEMPLATE = 'templates/INVENTORY_REPORT_TEMPLATE.xlsx';
const SALES_TEMPLATE = 'templates/SALES_REPORT_TEMPLATE.xlsx';

describe('INVENTORY_REPORT_TEMPLATE.xlsx', () => {
  let rows: any[][];

  beforeAll(() => {
    expect(existsSync(INVENTORY_TEMPLATE), `${INVENTORY_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(INVENTORY_TEMPLATE), { type: 'buffer', cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1, raw: true }) as any[][];
  });

  it('carries every column the importer knows about, in export order', () => {
    expect(rows[0]).toEqual([
      'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
      'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
    ]);
  });

  it('ships example rows that would import cleanly', () => {
    const body = rows.slice(1).filter(r => r?.length);
    expect(body.length).toBeGreaterThan(0);
    for (const r of body) {
      const [, model, imei, , , , , supplier, bp, stockType] = r;
      expect(String(model || '').trim()).not.toBe('');
      expect(String(supplier || '').trim()).not.toBe('');
      expect(Number(bp)).toBeGreaterThan(0);
      // Same rule as isValidImei: 15 digits, or a 10-12 char Apple serial
      // SHS rows carry NO IMEI — supplier-held stock has not shipped, so
      // there is nothing to read one off. Office rows must have one.
      const isShs = String(stockType || '').trim().toUpperCase() === 'SHS';
      if (isShs) expect(String(imei || '').trim()).toBe('');
      else       expect(String(imei)).toMatch(/^(\d{15}|[A-Z0-9]{10,12})$/);
    }
  });

  it('demonstrates BOTH stock types so SHS is discoverable', () => {
    const stockTypes = rows.slice(1).filter(r => r?.length).map(r => String(r[9] || '').toUpperCase());
    expect(stockTypes).toContain('OFFICE');
    expect(stockTypes).toContain('SHS');
  });

  it('documents every column on a README sheet', () => {
    const wb = XLSX.read(readFileSync(INVENTORY_TEMPLATE), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    const readme = XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][];
    const documented = readme.flat().filter(Boolean).map(String).join(' | ');
    for (const col of ['Stock In Date', 'Model', 'IMEI', 'Supplier', 'BP', 'Stock Type', 'Notes']) {
      expect(documented).toContain(col);
    }
  });
});

describe('template dropdowns match what the app actually offers', () => {
  // A template offering values the app doesn't is worse than no dropdown:
  // the operator picks one, the import accepts it, and the data quietly
  // disagrees with every screen. Grade shipped as "A+ / B+" for a while —
  // neither exists in the app.
  const TEMPLATE_GRADES = ['A', 'B', 'C', 'ONU', 'Brand new'];
  const TEMPLATE_SIM = ['Physical SIM', 'Physical SIM + eSIM', 'Dual Physical SIM', 'Not Applicable'];

  it('the generator mirrors GRADE_OPTIONS exactly', () => {
    expect(TEMPLATE_GRADES).toEqual([...GRADE_OPTIONS]);
  });

  it('the generator mirrors SIM_TYPE_OPTIONS exactly', () => {
    expect(TEMPLATE_SIM).toEqual([...SIM_TYPE_OPTIONS]);
  });

  it('every example Grade in a template is a real option', () => {
    for (const path of ['templates/INVENTORY_REPORT_TEMPLATE.xlsx', 'templates/SHS_STOCK_TEMPLATE.xlsx']) {
      const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
      const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
        .slice(1).filter(r => r?.length);
      for (const r of rows) {
        const grade = String(r[3] || '').trim();
        if (grade) expect(GRADE_OPTIONS as readonly string[]).toContain(grade);
      }
    }
  });

  it('every example SIM Type in a template is a real option', () => {
    for (const path of ['templates/INVENTORY_REPORT_TEMPLATE.xlsx', 'templates/SHS_STOCK_TEMPLATE.xlsx']) {
      const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
      const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
        .slice(1).filter(r => r?.length);
      for (const r of rows) {
        const sim = String(r[5] || '').trim();
        if (sim) expect(SIM_TYPE_OPTIONS as readonly string[]).toContain(sim);
      }
    }
  });

  it('the sample data uses real options too', () => {
    const wb = XLSX.read(readFileSync('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx'), { type: 'buffer' });
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(GRADE_OPTIONS as readonly string[]).toContain(String(r[3]).trim());
      expect(SIM_TYPE_OPTIONS as readonly string[]).toContain(String(r[5]).trim());
    }
  });

  it('the README sheet documents the real grades, not invented ones', () => {
    const wb = XLSX.read(readFileSync('templates/INVENTORY_REPORT_TEMPLATE.xlsx'), { type: 'buffer' });
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    expect(readme).toContain('ONU');
    expect(readme).toContain('Brand new');
    expect(readme).not.toContain('A+');
  });
});

describe('SHS_STOCK_TEMPLATE.xlsx — the report that marks supplier-held stock', () => {
  const SHS_TEMPLATE = 'templates/SHS_STOCK_TEMPLATE.xlsx';

  it('uses the same schema as the inventory importer', () => {
    expect(existsSync(SHS_TEMPLATE), `${SHS_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(SHS_TEMPLATE), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][];
    expect(rows[0]).toEqual([
      'Stock In Date', 'Model', 'IMEI', 'Grade', 'Storage',
      'SIM Type', 'Colour', 'Supplier', 'BP', 'Stock Type', 'Notes',
    ]);
  });

  it('marks EVERY row SHS — that is the whole point of the file', () => {
    const wb = XLSX.read(readFileSync(SHS_TEMPLATE), { type: 'buffer' });
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r[9]).toUpperCase()).toBe('SHS');
  });

  it('ships rows that would import cleanly', () => {
    const wb = XLSX.read(readFileSync(SHS_TEMPLATE), { type: 'buffer' });
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    for (const [, model, imei, , , , , supplier, bp, stockType] of rows) {
      expect(String(model || '').trim()).not.toBe('');
      expect(String(supplier || '').trim()).not.toBe('');
      expect(Number(bp)).toBeGreaterThan(0);
      // SHS rows carry NO IMEI — supplier-held stock has not shipped, so
      // there is nothing to read one off. Office rows must have one.
      const isShs = String(stockType || '').trim().toUpperCase() === 'SHS';
      if (isShs) expect(String(imei || '').trim()).toBe('');
      else       expect(String(imei)).toMatch(/^(\d{15}|[A-Z0-9]{10,12})$/);
    }
  });

  it('documents the three ways a unit leaves SHS', () => {
    const wb = XLSX.read(readFileSync(SHS_TEMPLATE), { type: 'buffer' });
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    expect(readme).toMatch(/Receive/i);        // 1. it arrives
    expect(readme).toMatch(/Sales Report/i);   // 2. supplier ships direct
    expect(readme).toMatch(/cancel/i);         // 3. supplier cancels
    // And the trap that cost us a bug
    expect(readme).toMatch(/Writing "SHS" here does NOT mark the row/i);
  });

  it('the SHS sample carries only supplier-held rows', () => {
    const path = 'templates/samples/SHS_STOCK_SAMPLE.xlsx';
    expect(existsSync(path), `${path} missing — run scripts/generateE2EWorkbooks.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
    const rows = (XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][])
      .slice(1).filter(r => r?.length);
    expect(rows).toHaveLength(10);
    for (const r of rows) expect(String(r[9]).toUpperCase()).toBe('SHS');
  });
});

describe('ACCESSORIES_TEMPLATE.xlsx — the no-IMEI quantity-pool schema', () => {
  const ACCESSORIES_TEMPLATE = 'templates/ACCESSORIES_TEMPLATE.xlsx';

  it('carries every column the importer knows about, in export order', () => {
    expect(existsSync(ACCESSORIES_TEMPLATE), `${ACCESSORIES_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const wb = XLSX.read(readFileSync(ACCESSORIES_TEMPLATE), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['ACCESSORIES'], { header: 1 }) as any[][];
    expect(rows[0]).toEqual(['SKU', 'Name', 'Supplier', 'Total Added', 'BP', 'Notes']);
  });

  it('parses through the real stock importer as accessory rows, not stock rows', () => {
    const wb = XLSX.read(readFileSync(ACCESSORIES_TEMPLATE), { type: 'buffer' });
    const parsed = parseStockWorkbook(wb);
    expect(parsed.rows).toEqual([]); // no office/SHS rows in this file
    expect(parsed.accessoryRows.length).toBeGreaterThan(0);
    for (const r of parsed.accessoryRows) {
      expect(r.sku.trim()).not.toBe('');
      expect(r.totalReceived).toBeGreaterThan(0);
      expect(r.buyPrice).toBeGreaterThan(0);
    }
  });

  it('documents every column on a README sheet', () => {
    const wb = XLSX.read(readFileSync(ACCESSORIES_TEMPLATE), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    for (const col of ['SKU', 'Name', 'Supplier', 'Total Added', 'BP', 'Notes']) {
      expect(readme).toContain(col);
    }
    expect(readme).toMatch(/quantity pool/i);
  });
});

describe('per-marketplace SALES templates', () => {
  const MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY'] as const;

  it.each(MARKETPLACES)('SALES_%s_TEMPLATE.xlsx parses as that marketplace alone', async (m) => {
    const path = `templates/SALES_${m}_TEMPLATE.xlsx`;
    expect(existsSync(path), `${path} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const file = new File([readFileSync(path)], `SALES_${m}_TEMPLATE.xlsx`);

    const parsed = await parseSalesWorkbook(file, `SALES_${m}_TEMPLATE.xlsx`, { onlyMarketplace: m });

    // No row errors AND no "missing sheet" noise for the other three.
    expect(parsed.errors).toEqual([]);
    expect(parsed.sales.length).toBeGreaterThan(0);
    expect(parsed.sales.every(s => s.marketplace === m)).toBe(true);
  });

  it.each(MARKETPLACES)('SALES_%s_TEMPLATE.xlsx documents its columns', (m) => {
    const wb = XLSX.read(readFileSync(`templates/SALES_${m}_TEMPLATE.xlsx`), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    expect(wb.SheetNames).toContain(m);
  });
});

describe('sample files parse as shipped', () => {
  // Must list every marketplace the generator emits a sample for. TEMU
  // landed in 2026-07 and this list was not extended, so the Temu sample was
  // never checked — and the combined sample did not even contain a TEMU sheet.
  const SAMPLE_MARKETPLACES = ['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU'] as const;

  it.each(SAMPLE_MARKETPLACES)('SALES_%s_SAMPLE.xlsx parses as a single-channel upload', async (m) => {
    const path = `templates/samples/SALES_${m}_SAMPLE.xlsx`;
    expect(existsSync(path), `${path} missing — run scripts/generateE2EWorkbooks.mjs`).toBe(true);
    const parsed = await parseSalesWorkbook(
      new File([readFileSync(path)], `SALES_${m}_SAMPLE.xlsx`),
      `SALES_${m}_SAMPLE.xlsx`,
      { onlyMarketplace: m },
    );
    expect(parsed.errors.filter(e => e.row > 0)).toEqual([]);
    expect(parsed.sales.every(s => s.marketplace === m)).toBe(true);

    // The per-channel sample must carry EXACTLY that marketplace's rows from
    // the combined workbook — the two are generated from one dataset, so a
    // divergence means the generator dropped or duplicated rows on one path.
    // (This replaced a bare `> 20` floor, which silently encoded "100 sales
    // across 4 channels" and broke the moment TEMU made it five.)
    const combined = await parseSalesWorkbook(
      new File([readFileSync('templates/samples/SALES_REPORT_SAMPLE.xlsx')], 'combined.xlsx'),
      'combined.xlsx',
    );
    const inCombined = combined.sales.filter(s => s.marketplace === m);
    expect(inCombined.length, `${m} rows in the combined sample`).toBeGreaterThan(0);
    expect(parsed.sales.length).toBe(inCombined.length);
  });

  it('per-channel samples produce the SAME ids as the combined sample', async () => {
    // The guarantee that lets a team upload per-channel now and a combined
    // file later without duplicating a single record.
    const combined = await parseSalesWorkbook(
      new File([readFileSync('templates/samples/SALES_REPORT_SAMPLE.xlsx')], 'combined.xlsx'),
      'combined.xlsx',
    );
    const amazonOnly = await parseSalesWorkbook(
      new File([readFileSync('templates/samples/SALES_AMAZON_SAMPLE.xlsx')], 'amazon.xlsx'),
      'amazon.xlsx',
      { onlyMarketplace: 'AMAZON' },
    );
    const combinedAmazonIds = new Set(combined.sales.filter(s => s.marketplace === 'AMAZON').map(s => s.id));
    for (const s of amazonOnly.sales) expect(combinedAmazonIds.has(s.id)).toBe(true);
  });

  it('the inventory sample carries both stock types', () => {
    const wb = XLSX.read(readFileSync('templates/samples/INVENTORY_REPORT_SAMPLE.xlsx'), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['INVENTORY'], { header: 1 }) as any[][];
    const stockTypes = rows.slice(1).map(r => String(r[9] || '').toUpperCase());
    expect(stockTypes.filter(t => t === 'SHS')).toHaveLength(10);
    expect(stockTypes.filter(t => t === 'OFFICE')).toHaveLength(110);
  });

  it('the returns reference documents that it is export-only', () => {
    const path = 'templates/samples/RETURNS_REPORT_REFERENCE.xlsx';
    expect(existsSync(path)).toBe(true);
    const wb = XLSX.read(readFileSync(path), { type: 'buffer' });
    expect(wb.SheetNames).toContain('Returns Detail');
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    expect(readme).toMatch(/no returns importer/i);
  });
});

describe('SALES_REPORT_TEMPLATE.xlsx', () => {
  it('parses through the production parser with no row errors', async () => {
    expect(existsSync(SALES_TEMPLATE), `${SALES_TEMPLATE} missing — run scripts/generateImportTemplates.mjs`).toBe(true);
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');

    // Row-level errors mean an example row is not valid input.
    expect(parsed.errors.filter(e => e.row > 0)).toEqual([]);
    // All four marketplace sheets present, so none reports "missing".
    expect(parsed.errors.filter(e => /missing from workbook/.test(e.message))).toEqual([]);
    expect(parsed.sales.length).toBeGreaterThan(0);
  });

  it('covers all five marketplaces with at least one example each', async () => {
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx');
    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');
    const seen = new Set(parsed.sales.map(s => s.marketplace));
    expect([...seen].sort()).toEqual(['AMAZON', 'BM', 'EBAY', 'ONBUY', 'TEMU']);
  });

  it('recomputes derived money columns rather than trusting the sheet', async () => {
    // The template leaves GP / commission blank on purpose; the parser must
    // still produce real figures, which is what makes that safe to document.
    const buf = readFileSync(SALES_TEMPLATE);
    const file = new File([buf], 'SALES_REPORT_TEMPLATE.xlsx');
    const parsed = await parseSalesWorkbook(file, 'SALES_REPORT_TEMPLATE.xlsx');
    for (const s of parsed.sales) {
      expect(s.commission).toBeGreaterThan(0);
      expect(Number.isFinite(s.grossProfit)).toBe(true);
      expect(s.grossProfit).toBeLessThan(s.salePrice - s.buyPrice);
    }
  });

  it('keeps the per-marketplace column order the parsers expect', () => {
    const wb = XLSX.read(readFileSync(SALES_TEMPLATE), { type: 'buffer' });
    const headerOf = (name: string) =>
      (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }) as any[][])[0];

    // The handset is described in one block right after IMEI, then Supplier,
    // then the money columns open on the quantity column.
    expect(headerOf('AMAZON').slice(0, 11))
      .toEqual(['Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour', 'Storage',
                'Supplier', 'Quantity', 'BP', 'SP']);
    expect(headerOf('BM').slice(0, 11))
      .toEqual(['Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour', 'Storage',
                'Supplier', 'Quantity', 'BP', 'SP']);
    // OnBuy has NO quantity column — BP/SP shift left by one. This is the one
    // real trap in the sales schemas, so pin it explicitly.
    expect(headerOf('ONBUY').slice(0, 10))
      .toEqual(['Date', 'Order Number', 'SKU', 'IMEI', 'Model', 'Colour', 'Storage',
                'Supplier', 'BP', 'SP']);
    // 2026-08: the templates are generated from the report writer, so eBay
    // carries the report's names — 'Postage', not the retired 'SHIPPING',
    // and the Marketing / P. VAT pair that replaced NP(incl. PROMOTION).
    expect(headerOf('EBAY')).toContain('Postage');
    expect(headerOf('EBAY')).toContain('Marketing');
    expect(headerOf('EBAY')).toContain('P. VAT');
    expect(headerOf('EBAY')).not.toContain('NP(incl. PROMOTION)');
  });

  it('documents that the formulas are live, and which cells the operator owns', () => {
    // The template used to say "leave the money columns blank, the app
    // recomputes them". It no longer does: the columns carry live formulas,
    // so the promise to document is that typing BP and SP fills the row in —
    // and, just as important, which cells are the operator's to type.
    const wb = XLSX.read(readFileSync(SALES_TEMPLATE), { type: 'buffer' });
    expect(wb.SheetNames).toContain('README');
    const readme = (XLSX.utils.sheet_to_json(wb.Sheets['README'], { header: 1 }) as any[][])
      .flat().filter(Boolean).map(String).join(' ');
    expect(readme).toMatch(/live/i);
    expect(readme).toMatch(/formula/i);
    expect(readme).toMatch(/IMEI/);
    expect(readme).toMatch(/BP and an SP/i);
  });
});

/**
 * The app hands these files out from public/templates/ via the "Blank
 * template" buttons on the report menus and in the import modals. Those
 * copies are written by the same generator run — but a copy is a copy, and
 * a stale one would hand an operator a schema the importer no longer
 * accepts. That is worse than having no button: it looks authoritative.
 */
describe('templates served by the app match the templates under test', () => {
  const PUBLIC_DIR = resolve('public/templates');

  const SERVED = [
    'INVENTORY_REPORT_TEMPLATE.xlsx',
    'SHS_STOCK_TEMPLATE.xlsx',
    'ACCESSORIES_TEMPLATE.xlsx',
    'SALES_REPORT_TEMPLATE.xlsx',
    'SALES_AMAZON_TEMPLATE.xlsx',
    'SALES_BM_TEMPLATE.xlsx',
    'SALES_EBAY_TEMPLATE.xlsx',
    'SALES_ONBUY_TEMPLATE.xlsx',
    'SALES_TEMU_TEMPLATE.xlsx',
  ];

  it.each(SERVED)('%s is published for the in-app download', (file) => {
    expect(existsSync(resolve(PUBLIC_DIR, file)), `${file} missing from public/templates`).toBe(true);
  });

  it.each(SERVED)('%s is byte-identical to templates/', (file) => {
    const served = readFileSync(resolve(PUBLIC_DIR, file));
    const tested = readFileSync(resolve('templates', file));
    expect(served.equals(tested)).toBe(true);
  });

  it('offers every template the UI links to, and nothing it does not', () => {
    // Read the links out of TemplateDownload.tsx rather than keeping a second
    // copy of them here. The copy went stale the first time a template was
    // added, which is the whole failure mode this file exists to catch — a
    // test that has to be hand-edited to stay true is not a guard.
    const src = readFileSync('src/components/TemplateDownload.tsx', 'utf8');
    const linked = [...src.matchAll(/file:\s*'([A-Z0-9_]+\.xlsx)'/g)].map(m => m[1]).sort();
    expect(linked.length, 'no template links found — has the file moved?').toBeGreaterThan(4);
    const published = readdirSync(PUBLIC_DIR).filter(f => f.endsWith('.xlsx')).sort();
    expect(published).toEqual(linked);
  });
});
