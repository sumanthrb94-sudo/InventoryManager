/**
 * The import surface is gone, and must stay gone.
 *
 * WHY THIS FILE EXISTS
 *
 * The two spreadsheet importers were deleted in 2026-08. The reason was not
 * "nothing left to import" — an earlier round had already tried that and the
 * operator asked for them back. The reason is that the route was unsound:
 *
 *   Import was the only way to create an inventory unit from free text. Every
 *   other intake path goes through a picker bound to the admin model catalogue
 *   — DeviceComboBox on Add Stock, AccessoryComboBox on the accessory tab — so
 *   a model that is not in Configuration cannot be typed into existence. The
 *   importers had no such gate: they took whatever the Model column said and
 *   created the unit.
 *
 * That put supplier product codes into production as model names (e.g.
 * "SG TABA (10.1)(T580) 16GB"). Nothing can classify those, so they bucket as
 * their own SKU everywhere, never join the real one, and surface as an
 * unlabelled tile in the periodic table with a matching phantom row in Stock
 * Alerts telling the operator to reorder a phone they never stocked.
 *
 * This file replaces EmployeeReportLifecycle.sim.test.ts, which simulated the
 * upload → confirm → reconcile → re-upload chain and went with the importers.
 * Two things from it were worth keeping: the employee-permission check, and a
 * standing guard that the deletion holds. Both are below.
 *
 * WHAT WAS DELIBERATELY GIVEN UP, recorded so it is a known cost and not a
 * surprise later: wipe → re-upload → "go live" is no longer a recovery route,
 * for stock or for sales. A wipe is not undoable through the UI any more.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

// ── The modules themselves ───────────────────────────────────────────────────

const DELETED = [
  'src/components/SalesReportImport.tsx',
  'src/components/InventoryReportImport.tsx',
  'src/components/ImportModal.tsx',
  'src/components/MasterDataLinkedImport.tsx',
  'src/lib/salesImport.ts',
  'src/lib/inventoryImportParse.ts',
];

describe('the importers are deleted, not merely hidden', () => {
  it.each(DELETED)('%s does not exist', (path) => {
    expect(existsSync(path), `${path} is back`).toBe(false);
  });

  it('no source file imports a deleted module', () => {
    // A dangling import would fail the build, but this names the offender
    // instead of leaving a resolver error to be decoded.
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      const text = readFileSync(file, 'utf8');
      for (const mod of ['salesImport', 'inventoryImportParse', 'SalesReportImport',
                         'InventoryReportImport', 'ImportModal', 'MasterDataLinkedImport']) {
        if (new RegExp(`from '[^']*/${mod}'`).test(text)) offenders.push(`${file} -> ${mod}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no feature flag pretends the surface is merely switched off', () => {
    // Gating was the previous round's answer. Leaving a dead flag behind
    // invites someone to "just turn it back on" against modules that no
    // longer exist.
    const flags = readFileSync('src/lib/featureFlags.ts', 'utf8');
    expect(flags).not.toContain('SHOW_IMPORT_UI');
    expect(flags).not.toContain('SHOW_SALES_IMPORT_UI');
  });

  it('App.tsx has no import menu, modal or state left behind', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    for (const token of ['SHOW_IMPORT_UI', 'SHOW_SALES_IMPORT_UI', 'isImportModalOpen',
                         'isSalesImportOpen', 'importMenuOpen', 'onOpenImport']) {
      expect(app, `App.tsx still references ${token}`).not.toContain(token);
    }
  });
});

// ── The intake routes that remain ────────────────────────────────────────────

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

/** Every .ts/.tsx under src/, excluding tests. */
function srcFiles(dir = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}
