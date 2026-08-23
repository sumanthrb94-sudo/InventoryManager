/**
 * What may come in through a file, and what may not.
 *
 * This replaces noImportSurface.test.ts, which asserted that both importers
 * stayed deleted. Half of that is still true and still guarded here; the other
 * half changed, and the reason it changed is the whole point of this file.
 *
 * WHY THE INVENTORY IMPORTER WAS DELETED (2026-08)
 *
 *   Import was the only way to create an inventory unit from free text. Every
 *   other intake path goes through a picker bound to the admin model catalogue
 *   — DeviceComboBox on Add Stock, AccessoryComboBox on the accessory tab — so
 *   a model that is not in Configuration cannot be typed into existence. The
 *   importer had no such gate: it took whatever the Model column said and
 *   created the unit.
 *
 *   That put supplier product codes into production as model names, e.g.
 *   "SG TABA (10.1)(T580) 16GB". Nothing can classify those, so they bucket as
 *   their own SKU everywhere, never join the real one, and surface as an
 *   unlabelled tile in the periodic table with a matching phantom row in Stock
 *   Alerts telling the operator to reorder a phone they never stocked.
 *
 * WHY IT IS BACK (2026-08-23)
 *
 *   The operator asked for it, with that hole closed. It is closed in
 *   buildPreview rather than in the UI, because a gate in the interface is a
 *   suggestion: a row whose Model is not in the catalogue is HELD — never
 *   created, never updated, and its supplier is not created either. The rest
 *   of the file imports normally.
 *
 *   The tests below are behavioural, not structural. "The importer exists" is
 *   worth almost nothing; "an unknown model cannot reach the database through
 *   it" is the property that was missing, so that is what is asserted.
 *
 * SALES import did NOT come back. Only the inventory route did.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildPreview } from '../../components/InventoryReportImport';
import { buildCatalogIndex } from '../../lib/modelReconciliation';
import type { ParsedRow } from '../../lib/inventoryImportParse';
import type { InventoryUnit, Supplier } from '../../types';

const session = vi.hoisted(() => ({
  currentUser: { email: 'ops1@inventorymanager.com', uid: 'emp-1' } as { email: string; uid: string } | null,
}));

vi.mock('firebase/firestore', async () => {
  const { firestoreMock } = await import('../mocks/memoryDb');
  return firestoreMock;
});

vi.mock('../../lib/firebase', async () => {
  const ADMIN_EMAILS = new Set(['admin@inventorymanager.com', 'sumanthbolla97@gmail.com', 'sai@inventorymanager.com']);
  return {
    db: { app: { name: '[DEFAULT]' } },
    auth: { get currentUser() { return session.currentUser; } },
    isAdmin: (u: any) => !!u?.email && ADMIN_EMAILS.has(String(u.email).toLowerCase().trim()),
  };
});

vi.mock('../../lib/dbService', async () => {
  const { memoryDbService } = await import('../mocks/memoryDb');
  return { dbService: memoryDbService };
});

vi.mock('../../lib/inventoryEvents', () => ({ logInventoryEvent: vi.fn(async () => {}) }));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const row = (over: Partial<ParsedRow> & { rowNum: number }): ParsedRow => ({
  dateIn: '2026-08-01', model: 'iPhone 13', imei: '', grade: 'A', storage: '128GB',
  simType: '', colour: 'Midnight', supplier: 'MOBILE WHOLESALE LTD', buyPrice: 200,
  stockType: 'office', notes: '', errors: [],
  ...over,
});

/** The catalogue as Configuration holds it: brand + model, nothing else. */
const catalogue = (...entries: { brand: string; model: string }[]) =>
  buildCatalogIndex(entries as any);

const NO_UNITS: InventoryUnit[] = [];
const NO_SUPPLIERS: Supplier[] = [];
const preview = (rows: ParsedRow[], index = catalogue({ brand: 'Apple', model: 'iPhone 13' })) =>
  buildPreview(rows, NO_UNITS, NO_SUPPLIERS, new Set<string>(), index);

// ── The gate ─────────────────────────────────────────────────────────────────

describe('an unknown model cannot reach the database through import', () => {
  it('holds a row whose model is not in the catalogue', () => {
    const p = preview([
      row({ rowNum: 2, model: 'iPhone 13', imei: '350000000000001' }),
      row({ rowNum: 3, model: 'SG TABA (10.1)(T580) 16GB', imei: '350000000000002' }),
    ]);
    expect(p.heldUnknownModel.map(r => r.rowNum)).toEqual([3]);
    // And it is genuinely out of the write, not merely also-listed.
    expect(p.toCreate.map(r => r.rowNum)).toEqual([2]);
    expect(p.toUpdate).toEqual([]);
  });

  it('is the real supplier product code that caused the deletion', () => {
    // Named explicitly so the regression is recognisable if it ever returns.
    const p = preview([row({ rowNum: 2, model: 'SG TABA (10.1)(T580) 16GB', imei: '350000000000009' })]);
    expect(p.toCreate).toEqual([]);
    expect(p.heldUnknownModel).toHaveLength(1);
  });

  it('does not create a held row\'s supplier either', () => {
    // A held row must leave NOTHING behind. Creating its supplier would be a
    // write performed on behalf of a row that was refused.
    const p = preview([
      row({ rowNum: 2, model: 'Nokia 3310', imei: '350000000000003', supplier: 'BRAND NEW SUPPLIER LTD' }),
    ]);
    expect(p.heldUnknownModel).toHaveLength(1);
    expect(p.newSuppliers).toEqual([]);
  });

  it('holds an IMEI-less SHS row on the same rule', () => {
    // SHS rows take a different path through the matcher (no IMEI to look up),
    // so the gate has to sit ahead of that fork rather than inside one branch.
    const p = preview([
      row({ rowNum: 2, model: 'Some Supplier Code X99', imei: '', stockType: 'shs' }),
    ]);
    expect(p.heldUnknownModel).toHaveLength(1);
    expect(p.toCreate).toEqual([]);
  });

  it('lets a known model straight through', () => {
    const p = preview([row({ rowNum: 2, model: 'iPhone 13', imei: '350000000000004' })]);
    expect(p.heldUnknownModel).toEqual([]);
    expect(p.toCreate).toHaveLength(1);
    expect(p.newSuppliers).toEqual(['MOBILE WHOLESALE LTD']);
  });

  it('matches the catalogue without needing the brand to have parsed', () => {
    // buildCatalogIndex indexes brand-less too, so a model whose brand the
    // parser could not infer still finds its entry. Without this, ordinary
    // catalogue models would be held and the gate would be unusable.
    const p = preview(
      [row({ rowNum: 2, model: 'Reno 8T', imei: '350000000000005' })],
      catalogue({ brand: 'OPPO', model: 'Reno 8T' }),
    );
    expect(p.heldUnknownModel).toEqual([]);
    expect(p.toCreate).toHaveLength(1);
  });

  it('groups the rows waiting on each distinct model', () => {
    // The operator resolves a model once, not once per row.
    const p = preview([
      row({ rowNum: 2, model: 'Mystery A', imei: '350000000000006' }),
      row({ rowNum: 3, model: 'Mystery A', imei: '350000000000007' }),
      row({ rowNum: 4, model: 'Mystery B', imei: '350000000000008' }),
    ]);
    expect(p.unknownModels.map(m => [m.raw, m.rowNums])).toEqual([
      ['Mystery A', [2, 3]],
      ['Mystery B', [4]],
    ]);
  });

  it('releases the held rows once the model is in the catalogue', () => {
    // The whole resolution path in one assertion: same rows, same file, one
    // more catalogue entry. This is what the in-preview "Add to catalogue"
    // button does — it writes the model and the memo re-runs.
    const rows = [row({ rowNum: 2, model: 'Pixel 8a', imei: '350000000000010' })];
    expect(preview(rows).heldUnknownModel).toHaveLength(1);

    const after = preview(rows, catalogue(
      { brand: 'Apple', model: 'iPhone 13' },
      { brand: 'Google', model: 'Pixel 8a' },
    ));
    expect(after.heldUnknownModel).toEqual([]);
    expect(after.toCreate).toHaveLength(1);
  });

  it('holds everything when the catalogue is empty rather than falling open', () => {
    // The failure mode that matters: a gate that opens when its reference data
    // is missing is not a gate. An empty catalogue means nothing is known.
    const p = preview([
      row({ rowNum: 2, model: 'iPhone 13', imei: '350000000000011' }),
      row({ rowNum: 3, model: 'Galaxy S23', imei: '350000000000012' }),
    ], new Map());
    expect(p.toCreate).toEqual([]);
    expect(p.heldUnknownModel).toHaveLength(2);
  });

  it('still rejects an invalid row as invalid, not as held', () => {
    // Precedence: a row with a broken IMEI is a file error the operator fixes,
    // not a catalogue question. Reporting it as "held" would send them to
    // Configuration to solve something Configuration cannot solve.
    const p = preview([
      row({ rowNum: 2, model: 'Unknown Thing', imei: 'NOTANIMEI', errors: ['Invalid IMEI'] }),
    ]);
    expect(p.invalid).toHaveLength(1);
    expect(p.heldUnknownModel).toEqual([]);
  });
});

// ── The sales importer stays gone ────────────────────────────────────────────

const STILL_DELETED = [
  'src/components/SalesReportImport.tsx',
  'src/components/ImportModal.tsx',
  'src/components/MasterDataLinkedImport.tsx',
  'src/lib/salesImport.ts',
];

function srcFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('only the inventory route came back', () => {
  it.each(STILL_DELETED)('%s is still deleted', (path) => {
    expect(existsSync(path), `${path} is back`).toBe(false);
  });

  it('no source file imports a sales-import module', () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const mod of ['salesImport', 'SalesReportImport', 'ImportModal', 'MasterDataLinkedImport']) {
        if (new RegExp(`from '[^']*/${mod}'`).test(text)) offenders.push(`${file} -> ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('App.tsx opens the inventory importer behind the admin gate', () => {
    // Two conditions, both required: an employee must not reach a route that
    // can create units in bulk from a file.
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('InventoryReportImport');
    expect(app).toMatch(/SHOW_IMPORT_UI && userIsAdmin/);
    // And the sales route has no state left behind to switch back on.
    expect(app).not.toContain('isSalesImportOpen');
  });
});

// ── The other intake routes are unchanged ────────────────────────────────────

describe('the surviving intake routes are catalogue-gated', () => {
  it('Add Stock and the accessory tab both go through a picker, not a text field', () => {
    const modal = readFileSync('src/components/AddStockManualModal.tsx', 'utf8');
    expect(modal).toContain('DeviceComboBox');
    expect(modal).toContain('AccessoryComboBox');
  });
});

// ── Employee permissions — carried over from the deleted lifecycle sim ────────

describe('an employee is still not an admin', () => {
  it('every admin-gated service call is refused', async () => {
    const { seed, clearStore, col } = await import('../mocks/memoryDb');
    clearStore();
    seed('inventoryUnits', [{
      id: 'u-office-a', imei: '350000000000001', model: 'IPHONE 12', storage: '64GB',
      colour: 'BLACK', status: 'available', buyPrice: 200, dateIn: '2026-06-01',
      flags: [], platformListed: false, ownerId: 'shared', createdAt: '2026-06-01',
    } as any]);

    const { isAdmin, auth } = await import('../../lib/firebase');
    expect(isAdmin(auth.currentUser)).toBe(false);

    const { adminUpdateUnit, deleteOfficeUnit } = await import('../../services/inventoryService');
    const unit = col('inventoryUnits')['u-office-a'] as any;

    expect((await adminUpdateUnit(unit, { buyPrice: 1 })).message).toMatch(/admin access required/i);
    expect((await deleteOfficeUnit(unit, 'test')).message).toMatch(/admin access required/i);
  });
});
