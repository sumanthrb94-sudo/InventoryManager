/**
 * Inventory write surface. Every UI that creates / mutates an
 * inventoryUnits doc routes through here. Centralises:
 *   - IMEI / Apple-serial validation (strict)
 *   - In-DB duplicate detection
 *   - Brand / model / storage / series split via parseBrandModelStorage
 *   - Server-stamped timestamps + provenance fields
 *   - Audit-log inventoryEvents emission
 *
 * Owned business rules (matrix):
 *   - IMEI strict format  → addUnitManual / receiveShsAggregate / backfillImei
 *   - Buy price > 0       → addUnitManual
 *   - Duplicate IMEI      → addUnitManual / receiveShsAggregate / backfillImei
 *   - SHS qty cap         → receiveShsAggregate
 *
 * IMPORTANT: This module is the only place these rules live for per-unit
 * writes. UI components MUST NOT call dbService.create('inventoryUnits', …)
 * or dbService.bulkCreate(...) for inventoryUnits directly — they must
 * route through here so a future tightening of the rules updates every
 * surface at once.
 */

import { dbService } from '../lib/dbService';
import type { DeviceCategory, InventoryAggregate, InventoryUnit, ListingSite, Sale } from '../types';
import { isAppleDevice, isValidImei, isValidImeiOrSerial } from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { logInventoryEvent } from '../lib/inventoryEvents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddUnitInput {
  /** REQUIRED. Validated strict against {@link isValidImei}; Apple devices
   *  unlock the 10-12 char alphanumeric serial form. */
  imei: string;
  /** REQUIRED. Free-text model string; brand/storage/series split downstream. */
  model: string;
  /** REQUIRED. Must be strictly greater than 0 (£0 BP is rejected — the
   *  audit found unit docs with BP=£0 leaking through inline writes). */
  buyPrice: number;
  /** REQUIRED. Will be `ensureSupplier`-d if it does not already exist. */
  supplierName: string;
  colour?: string;
  storage?: string;
  grade?: string;
  simType?: string;
  notes?: string;
  /** ISO yyyy-mm-dd; defaults to today. */
  dateIn?: string;
  batchId?: string;
}

export type AddUnitErrorCode =
  | 'invalid_imei'
  | 'duplicate_imei'
  | 'missing_model'
  | 'missing_buy_price'
  | 'missing_supplier'
  | 'write_failed';

export interface AddUnitResult {
  ok: boolean;
  /** The newly written unit's doc id (= IMEI) when ok. */
  id?: string;
  error?: AddUnitErrorCode;
  /** Friendly copy for the toast / inline error display. */
  message?: string;
}

export interface ReceiveShsInput {
  aggregate: InventoryAggregate;
  scanned: Array<{ imei: string; colour: string }>;
}

export interface ReceiveShsResult {
  ok: boolean;
  receivedCount: number;
  remainingQty: number;
  errors: Array<{ imei: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().split('T')[0];
const uid = () => Math.random().toString(36).slice(2, 9);

/** Same heuristic as ScanInModal / AddStockManualModal / ReceiveShsAggregateModal.
 *  Mirrors the UI-side detector so categorisation stays consistent regardless
 *  of which surface created the unit. */
function detectCategory(model: string): DeviceCategory {
  const m = (model || '').toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d|TABA\d|TABS\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

/** Slugify identical to the SHS placeholder id encoding used at import time
 *  (src/components/ImportModal.tsx — keep in sync). */
function slugify(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

// ---------------------------------------------------------------------------
// ensureSupplier — idempotent supplier upsert by name
// ---------------------------------------------------------------------------

/**
 * Resolve a supplier name to a supplier doc id. Reads the existing
 * suppliers cache via dbService and creates a new doc when needed. Safe to
 * call concurrently for the same name within a session — collisions write
 * the same payload so the merge is a no-op.
 */
export async function ensureSupplier(name: string): Promise<string> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  const key = trimmed.toUpperCase();

  const existing = await dbService.readAll('suppliers');
  const match = existing.find((s: any) => (s.name || '').trim().toUpperCase() === key);
  if (match) return match.id;

  const newId = `sup_${Date.now()}_${uid()}`;
  await dbService.create('suppliers', newId, {
    name: trimmed,
    portal: 'Wholesale',
    ownerId: 'shared',
    createdAt: new Date().toISOString(),
  });
  return newId;
}

// ---------------------------------------------------------------------------
// addUnitManual — single-unit manual entry
// ---------------------------------------------------------------------------

/**
 * Add one physical unit by IMEI. Owned rules:
 *  - IMEI strict format (model-aware Apple-serial bypass)
 *  - Buy price strictly > 0
 *  - Required model + supplier
 *  - Duplicate IMEI rejection against the live inventory cache
 *  - Brand/model/storage split via {@link parseBrandModelStorage}
 *  - Defaults: status='available', platformListed=false, flags=[], listingSites=[]
 *  - Emits an `inventoryEvents` row (`available` or `batch_created`).
 */
export async function addUnitManual(input: AddUnitInput): Promise<AddUnitResult> {
  // 1. Model present.
  const model = (input.model ?? '').trim();
  if (!model) {
    return { ok: false, error: 'missing_model', message: 'Model is required.' };
  }

  // 2. IMEI strict — model-aware (Apple unlocks the alphanumeric serial format).
  const rawImei = (input.imei ?? '').trim().toUpperCase();
  const apple = isAppleDevice(model);
  if (!isValidImei(rawImei, { isAppleSerial: apple })) {
    return {
      ok: false,
      error: 'invalid_imei',
      message: apple
        ? 'Enter a valid 15-digit IMEI or 10-12 char Apple serial.'
        : 'Enter a valid 15-digit IMEI (digits only — no letters).',
    };
  }

  // 3. Buy price strictly > 0. (audit: BP=£0 was leaking through.)
  const bp = Number(input.buyPrice);
  if (!Number.isFinite(bp) || bp <= 0) {
    return {
      ok: false,
      error: 'missing_buy_price',
      message: 'Buy price must be greater than £0.',
    };
  }

  // 4. Supplier required.
  const supplierName = (input.supplierName ?? '').trim();
  if (!supplierName) {
    return { ok: false, error: 'missing_supplier', message: 'Supplier is required.' };
  }

  // 5. Duplicate check against in-DB units.
  if (await dbService.imeiExists(rawImei)) {
    return {
      ok: false,
      error: 'duplicate_imei',
      message: `IMEI ${rawImei} is already in inventory.`,
    };
  }

  // 6. Resolve / create supplier.
  const supplierId = await ensureSupplier(supplierName);

  // 7. Brand / model / storage / series split. Caller-supplied storage takes
  //    precedence over parsed storage.
  const parsed = parseBrandModelStorage(model);
  const category = detectCategory(model);
  const brand = parsed.brand !== 'Other'
    ? parsed.brand
    : (['iPhone', 'iPad', 'Apple Watch'].includes(category)
        ? 'Apple'
        : (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)
            ? 'Samsung' : 'Other'));
  const cleanModel = parsed.model || model;
  const storage = (input.storage ?? '').trim() || parsed.storage;

  const dateIn = input.dateIn || today();
  const createdAt = new Date().toISOString();

  const newUnit: InventoryUnit = {
    id: rawImei, // doc id = IMEI for natural upsert semantics
    imei: rawImei,
    model: cleanModel,
    brand,
    category,
    colour: (input.colour ?? '').trim() || 'Unknown',
    ...(storage ? { storage } : {}),
    ...(parsed.series ? ({ series: parsed.series } as any) : {}),
    ...(input.grade?.trim() ? { grade: input.grade.trim() } : {}),
    ...(input.simType?.trim() ? { simType: input.simType.trim() } : {}),
    buyPrice: bp,
    dateIn,
    supplierId,
    supplierName: supplierName || undefined,
    ...(input.batchId ? { batchId: input.batchId } : {}),
    status: 'available',
    flags: [],
    notes: (input.notes ?? '').trim(),
    platformListed: false,
    listingSites: [] as ListingSite[],
    ownerId: 'shared',
    createdAt,
  };

  try {
    await dbService.create('inventoryUnits', rawImei, newUnit);
  } catch (err: any) {
    return {
      ok: false,
      error: 'write_failed',
      message: err?.message || 'Save failed. Check connection.',
    };
  }

  // 8. Audit-log emission. Use 'batch_created' when a batchId was supplied,
  //    otherwise the generic 'available' bucket.
  await logInventoryEvent({
    type: input.batchId ? 'batch_created' : 'available',
    message: input.batchId
      ? `Manual add: 1 unit added by IMEI (${rawImei})`
      : `Unit ${rawImei} added — ${cleanModel}${storage ? ' ' + storage : ''}`,
    unitId: rawImei,
    batchId: input.batchId,
    buyPrice: bp,
  });

  // 9. Post-create reconcile — close the loop in the reverse direction
  //    from the import-time sync. If a sales report landed BEFORE this
  //    unit was added, the matching sale is sitting orphaned with this
  //    IMEI on it. Auto-link now so the operator doesn't have to make a
  //    second trip through the Orphans modal. Mirrors the rules
  //    buildPostImportSyncPatches applies at import:
  //      - skip voided sales
  //      - skip sales already linked to a different unit
  //      - on match: sale.unitId = unit.id, unit.status = 'sold' with
  //        sale provenance (price, date, platform, order #)
  //    Wrapped in try/catch — the unit create already succeeded; a
  //    reconcile failure shouldn't fail the whole call. Operator can
  //    still resolve via the Orphans modal manually.
  try {
    const reconciledSaleId = await reconcileOrphanSaleForImei(rawImei);
    if (reconciledSaleId) {
      await logInventoryEvent({
        type: 'sold',
        message: `Unit ${rawImei} auto-linked to orphan sale ${reconciledSaleId}`,
        unitId: rawImei,
      });
    }
  } catch (e) {
    console.warn('addUnitManual post-create reconcile failed', e);
  }

  return { ok: true, id: rawImei };
}

/** Look up any orphan sale (non-voided, no unitId, IMEI matches) and
 *  link it to the just-added unit. IMEI match is the authoritative
 *  signal — auto-flip always happens here, regardless of whether the
 *  unit's other fields are filled (supplier / stockSource / buyPrice
 *  may still be missing and that's fine; the operator can complete
 *  them via the unit detail editor afterwards). Returns the saleId
 *  that got linked, or null if nothing matched. Picks the most recent
 *  sale when several match (refurb/restock cycles can produce >1). */
export async function reconcileOrphanSaleForImei(rawImei: string): Promise<string | null> {
  const allSales = await dbService.readAll('sales');
  const candidates = (allSales as Sale[]).filter(s =>
    !s.voidedAt
    && !s.unitId
    && (s.imei || '').trim().toUpperCase() === rawImei
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  const sale = candidates[0];
  const unit = await dbService.getByImei(rawImei) as InventoryUnit | null;
  await Promise.all([
    dbService.update('sales', sale.id, {
      unitId: rawImei,
      stockSource: sale.stockSource ?? unit?.stockSource ?? 'office',
    }),
    dbService.update('inventoryUnits', rawImei, {
      status: 'sold',
      saleDate: sale.saleDate,
      salePrice: sale.salePrice,
      salePlatform: sale.marketplace,
      saleOrderId: sale.orderNumber,
      stockSource: unit?.stockSource ?? 'office',
    }),
  ]);
  return sale.id;
}

// ---------------------------------------------------------------------------
// receiveShsAggregate — convert SHS aggregate into per-unit inventoryUnits
// ---------------------------------------------------------------------------

/**
 * Receive scanned IMEIs against an SHS aggregate. Hard-caps the receive at
 * `aggregate.quantityNum ?? 1` — extra scans beyond that are returned as
 * `{ reason: 'cap' }` errors and never written. Validates each IMEI
 * (model-aware) and skips duplicates already in inventory.
 *
 * Side effects on success:
 *  - Bulk-creates one inventoryUnits doc per accepted scan.
 *  - Decrements `aggregate.quantityNum`; if it reaches 0 sets
 *    `quantityText='RECEIVED'`.
 *  - Deletes the synthetic `shs_*` placeholder unit (if present).
 *  - Emits an `inventoryEvents` row.
 */
export async function receiveShsAggregate(input: ReceiveShsInput): Promise<ReceiveShsResult> {
  const { aggregate, scanned } = input;
  // Expected quantity = sum of coloursMap values when the aggregate breaks
  // down by colour, otherwise the raw quantityNum, otherwise 1. The
  // master sheet often carries "SHS" as the QUANTITY string (quantityNum
  // undefined) but spells out colours like "PINK 1 BLUE 1 SILVER 1
  // YELLOW 1" — sum to 4. Using `?? 1` here silently caps that receive
  // at 1 unit, dropping the other 3.
  const coloursMapSum = aggregate.coloursMap
    ? Object.values(aggregate.coloursMap).reduce<number>((s, n) => s + (n ?? 0), 0)
    : 0;
  const expectedQty = coloursMapSum > 0 ? coloursMapSum : (aggregate.quantityNum ?? 1);
  const originalQty = (aggregate as any).originalQuantityNum ?? expectedQty;
  const apple = isAppleDevice(aggregate.model);

  const errors: Array<{ imei: string; reason: string }> = [];
  const accepted: Array<{ imei: string; colour: string }> = [];

  // Inline + DB dedup, model-aware IMEI validation, hard quantity cap.
  const seen = new Set<string>();
  for (const row of scanned) {
    const imei = (row.imei ?? '').trim().toUpperCase();
    if (!imei) {
      errors.push({ imei, reason: 'empty' });
      continue;
    }
    if (accepted.length >= expectedQty) {
      errors.push({ imei, reason: 'cap' });
      continue;
    }
    if (!isValidImei(imei, { isAppleSerial: apple })) {
      errors.push({ imei, reason: 'invalid_imei' });
      continue;
    }
    if (seen.has(imei)) {
      errors.push({ imei, reason: 'duplicate_in_batch' });
      continue;
    }
    if (await dbService.imeiExists(imei)) {
      errors.push({ imei, reason: 'duplicate_imei' });
      continue;
    }
    seen.add(imei);
    accepted.push({ imei, colour: row.colour || 'Unknown' });
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      receivedCount: 0,
      remainingQty: Math.max(0, expectedQty),
      errors,
    };
  }

  // Build the inventoryUnits docs.
  const importedAt = new Date().toISOString();
  const dateIn = importedAt.slice(0, 10);
  const category = detectCategory(aggregate.model);
  const brand = (aggregate as any).brand ?? parseBrandModelStorage(aggregate.model).brand ?? 'Other';
  const supplierId = aggregate.supplierIds?.[0] ?? '';

  const newUnits: InventoryUnit[] = accepted.map(({ imei, colour }) => ({
    id: imei,
    imei,
    model: aggregate.model,
    brand,
    category,
    storage: aggregate.storage,
    colour: colour || 'Unknown',
    ...((aggregate as any).simType ? { simType: (aggregate as any).simType } : {}),
    buyPrice: aggregate.buyPrice ?? 0,
    dateIn,
    supplierId,
    supplierIds: aggregate.supplierIds,
    status: 'available',
    statusRaw: 'Received from SHS',
    flags: [],
    notes: aggregate.notes ?? '',
    platformListed: false,
    listingSites: [],
    importBatchId: aggregate.importBatchId,
    sourceFile: 'shs-receive',
    importedAt,
    ownerId: 'shared',
    createdAt: importedAt,
  } as InventoryUnit));

  try {
    await dbService.bulkCreate(
      newUnits.map(u => ({ collection: 'inventoryUnits', id: u.id, data: u })),
    );
  } catch (err: any) {
    return {
      ok: false,
      receivedCount: 0,
      remainingQty: Math.max(0, expectedQty),
      errors: [
        ...errors,
        ...accepted.map(a => ({ imei: a.imei, reason: err?.message || 'write_failed' })),
      ],
    };
  }

  // Clean up the synthetic SHS placeholder unit if it exists.
  const supplierName = (aggregate as any).supplierName
    || (aggregate.supplierIds && aggregate.supplierIds[0])
    || '';
  const placeholderId = `shs_${slugify(aggregate.model)}_${slugify(supplierName)}_${aggregate.sourceRow}`;
  await dbService.delete('inventoryUnits', placeholderId).catch(() => {});

  // Decrement aggregate quantity — fully received vs partial. Also subtract
  // per-colour counts from coloursMap so subsequent receives show only the
  // remaining colours; stash a one-time snapshot in originalColoursMap so
  // the modal can render "X/Y received" against the original breakdown.
  const acceptedByColour: Record<string, number> = {};
  for (const a of accepted) {
    acceptedByColour[a.colour] = (acceptedByColour[a.colour] ?? 0) + 1;
  }
  const prevMap = aggregate.coloursMap ?? {};
  const newColoursMap: Record<string, number> = { ...prevMap };
  for (const [c, n] of Object.entries(acceptedByColour)) {
    newColoursMap[c] = Math.max(0, (newColoursMap[c] ?? 0) - n);
  }
  const originalColoursMap = (aggregate as any).originalColoursMap ?? prevMap;
  const newRemaining = Math.max(0, expectedQty - accepted.length);
  if (newRemaining === 0) {
    await dbService.update('inventoryAggregates', aggregate.id, {
      quantityNum: 0,
      quantityText: 'RECEIVED',
      receivedAt: new Date().toISOString(),
      originalQuantityNum: originalQty,
      coloursMap: newColoursMap,
      originalColoursMap,
    });
  } else {
    await dbService.update('inventoryAggregates', aggregate.id, {
      quantityNum: newRemaining,
      originalQuantityNum: originalQty,
      coloursMap: newColoursMap,
      originalColoursMap,
    });
  }

  // Audit log.
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Received ${accepted.length} unit${accepted.length === 1 ? '' : 's'} from SHS · ${aggregate.model}`,
    batchId: aggregate.importBatchId,
  });

  return {
    ok: true,
    receivedCount: accepted.length,
    remainingQty: newRemaining,
    errors,
  };
}

// ---------------------------------------------------------------------------
// backfillImei — set/replace IMEI on an existing unit
// ---------------------------------------------------------------------------

/**
 * Set or replace the IMEI of an existing unit. Validates against the unit's
 * model (Apple bypass) and rejects collisions with other units. Used by the
 * Missing IMEIs backfill flow in StockInPage.
 */
export async function backfillImei(unitId: string, imei: string): Promise<AddUnitResult> {
  const next = (imei ?? '').trim().toUpperCase();
  if (!next) {
    return { ok: false, error: 'invalid_imei', message: 'IMEI is required.' };
  }

  // Look up the unit to learn its model so we can apply the Apple bypass.
  const cached = await dbService.readAll('inventoryUnits');
  const unit = cached.find((u: any) => u.id === unitId) as InventoryUnit | undefined;
  if (!unit) {
    return { ok: false, error: 'write_failed', message: `Unit ${unitId} not found.` };
  }

  const apple = isAppleDevice(unit.model);
  if (!isValidImei(next, { isAppleSerial: apple })) {
    return {
      ok: false,
      error: 'invalid_imei',
      message: apple
        ? 'Enter a valid 15-digit IMEI or 10-12 char Apple serial.'
        : 'Enter a valid 15-digit IMEI (digits only — no letters).',
    };
  }

  // Collision check — exclude self so re-saving the same IMEI is a no-op.
  const collision = cached.find((u: any) => u.id !== unitId && u.imei === next);
  if (collision) {
    return {
      ok: false,
      error: 'duplicate_imei',
      message: `IMEI ${next} is already on another unit.`,
    };
  }

  try {
    await dbService.update('inventoryUnits', unitId, { imei: next });
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Save failed' };
  }

  await logInventoryEvent({
    type: 'available',
    message: `IMEI backfilled on ${unitId} → ${next}`,
    unitId,
  });

  return { ok: true, id: unitId };
}

// ---------------------------------------------------------------------------
// addSoldUnitFromSale — create a fresh-stock unit directly in SOLD state
// ---------------------------------------------------------------------------

export interface AddSoldUnitFromSaleInput {
  /** The orphan Sale that has no matching inventory unit. Provides the
   *  sale provenance (SP / marketplace / order / date / postage) and the
   *  default BP, supplier, model and IMEI. */
  sale: Sale;
  /** Confirmed / filled IMEI or serial. Defaults to the sale's own IMEI
   *  when the operator doesn't change it. */
  imei: string;
  /** Human-readable model. Defaults to the sale's SKU when blank. */
  model: string;
  /** Defaults to the sale's buyPrice. Must be > 0. */
  buyPrice?: number;
  /** Defaults to the sale's supplierName. */
  supplierName?: string;
  colour?: string;
  storage?: string;
  /** Fulfilment source — office stock or SHS (supplier-held). Defaults to
   *  'office'. Persisted so the sold unit stays filterable as SHS. */
  stockSource?: 'office' | 'shs';
}

/**
 * Create an inventory unit that is already SOLD, derived from an imported
 * Sale that had no matching unit (e.g. a bulk order whose IMEIs were
 * combined in one cell, or a tablet sold under an Amazon serial). The unit
 * is written with the sale's provenance (status='sold', salePrice, saleDate,
 * salePlatform, saleOrderId, postageCost) and the Sale doc is back-linked
 * via `unitId`. After this runs the unit appears in "Sold" surfaces and the
 * "No Inventory IMEI" flag clears on the next report/render.
 *
 * Reuses the same validation + supplier-resolution + model-split rules as
 * addUnitManual so a unit born here is indistinguishable from a normally
 * received-then-sold unit.
 */
export async function addSoldUnitFromSale(
  input: AddSoldUnitFromSaleInput,
): Promise<AddUnitResult> {
  const { sale } = input;

  // 1. Model present (default to the sale's SKU so the operator at least
  //    has something to confirm/edit).
  const model = (input.model ?? '').trim() || (sale.sku ?? '').trim();
  if (!model) {
    return { ok: false, error: 'missing_model', message: 'Model is required.' };
  }

  // 2. IMEI / serial — permissive on this path. We accept anything that
  //    looks like a real device identifier (15-digit IMEI or 10-12 char
  //    alphanumeric serial) without re-applying the device-family gate.
  //    The marketplace has already accepted this sale; trusting their
  //    identifier is safer than rejecting because the SKU happens to use
  //    a fused-token convention this app's regex doesn't recognise yet.
  //    Manual stock add (`addUnitManual`) keeps the strict device-aware
  //    gate so fat-fingers can't sneak garbage in there.
  const rawImei = (input.imei ?? sale.imei ?? '').trim().toUpperCase();
  if (!isValidImeiOrSerial(rawImei)) {
    return {
      ok: false,
      error: 'invalid_imei',
      message: 'Enter a 15-digit IMEI or 10-12 char alphanumeric serial.',
    };
  }

  // 3. Buy price strictly > 0 (default to the sale's BP).
  const bp = Number(input.buyPrice ?? sale.buyPrice);
  if (!Number.isFinite(bp) || bp <= 0) {
    return { ok: false, error: 'missing_buy_price', message: 'Buy price must be greater than £0.' };
  }

  // 4. Supplier required (default to the sale's supplier).
  const supplierName = (input.supplierName ?? sale.supplierName ?? '').trim();
  if (!supplierName) {
    return { ok: false, error: 'missing_supplier', message: 'Supplier is required.' };
  }

  // 5. Duplicate check — the whole point is that no unit exists yet, but a
  //    concurrent add or a typo could collide.
  if (await dbService.imeiExists(rawImei)) {
    return { ok: false, error: 'duplicate_imei', message: `IMEI ${rawImei} is already in inventory.` };
  }

  // 6. Resolve / create supplier + split brand/model/storage.
  const supplierId = await ensureSupplier(supplierName);
  const parsed = parseBrandModelStorage(model);
  const category = detectCategory(model);
  const brand = parsed.brand !== 'Other'
    ? parsed.brand
    : (['iPhone', 'iPad', 'Apple Watch'].includes(category)
        ? 'Apple'
        : (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category) ? 'Samsung' : 'Other'));
  const cleanModel = parsed.model || model;
  const storage = (input.storage ?? '').trim() || parsed.storage;
  const createdAt = new Date().toISOString();

  const newUnit: InventoryUnit = {
    id: rawImei,
    imei: rawImei,
    model: cleanModel,
    brand,
    category,
    colour: (input.colour ?? '').trim() || 'Unknown',
    ...(storage ? { storage } : {}),
    ...(parsed.series ? ({ series: parsed.series } as any) : {}),
    ...(sale.sku ? { sku: sale.sku } : {}),
    buyPrice: bp,
    dateIn: sale.saleDate || today(),
    supplierId,
    supplierName: supplierName || undefined,
    status: 'sold',
    stockSource: input.stockSource ?? 'office',
    flags: [],
    notes: '',
    platformListed: true,
    listingSites: [] as ListingSite[],
    // Sale provenance — mirrors buildPostImportSyncPatches' sold-unit shape.
    salePrice: sale.salePrice,
    saleDate: sale.saleDate,
    salePlatform: sale.marketplace,
    saleOrderId: sale.orderNumber,
    ...(sale.postage != null ? { postageCost: sale.postage } : {}),
    ownerId: 'shared',
    createdAt,
  };

  try {
    await dbService.create('inventoryUnits', rawImei, newUnit);
    // Back-link the sale so the Sales Report ALL-sheet join + the
    // "No Inventory IMEI" flag both resolve to this unit.
    await dbService.update('sales', sale.id, { unitId: rawImei });
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Save failed. Check connection.' };
  }

  await logInventoryEvent({
    type: 'sold',
    message: `Unit ${rawImei} added from sale ${sale.marketplace} ${sale.orderNumber || ''} — marked sold (${cleanModel}${storage ? ' ' + storage : ''})`,
    unitId: rawImei,
  });

  return { ok: true, id: rawImei };
}

// ---------------------------------------------------------------------------
// completeUnitBuyInfo — fill missing buy-side fields on an EXISTING unit
// ---------------------------------------------------------------------------

export interface CompleteUnitBuyInfoInput {
  unitId: string;
  /** Required, non-blank. Re-split via parseBrandModelStorage. */
  model: string;
  /** Required, non-blank. ensureSupplier-d. */
  supplierName: string;
  /** Required, > 0. */
  buyPrice: number;
  colour?: string;
  storage?: string;
  /** Fulfilment source — office stock or SHS. Persisted on the unit. */
  stockSource?: 'office' | 'shs';
}

/**
 * Patch an EXISTING inventory unit's buy-side / audit fields (model, brand,
 * category, colour, storage, supplier, buyPrice). Used by the import's
 * audit-completeness gate to fix a matched unit whose record was missing the
 * data required to mark it sold for internal audit (e.g. BP=£0, blank
 * supplier, raw-SKU model). Does NOT touch sale fields — the post-import sync
 * applies status/SP/date/order. Same validation as addUnitManual so a
 * completed unit is indistinguishable from a properly-received one.
 */
export async function completeUnitBuyInfo(
  input: CompleteUnitBuyInfoInput,
): Promise<AddUnitResult> {
  const model = (input.model ?? '').trim();
  if (!model) return { ok: false, error: 'missing_model', message: 'Model is required.' };

  const bp = Number(input.buyPrice);
  if (!Number.isFinite(bp) || bp <= 0) {
    return { ok: false, error: 'missing_buy_price', message: 'Buy price must be greater than £0.' };
  }

  const supplierName = (input.supplierName ?? '').trim();
  if (!supplierName) return { ok: false, error: 'missing_supplier', message: 'Supplier is required.' };

  const cached = await dbService.readAll('inventoryUnits');
  const unit = cached.find((u: any) => u.id === input.unitId) as InventoryUnit | undefined;
  if (!unit) return { ok: false, error: 'write_failed', message: `Unit ${input.unitId} not found.` };

  const supplierId = await ensureSupplier(supplierName);
  const parsed = parseBrandModelStorage(model);
  const category = detectCategory(model);
  const brand = parsed.brand !== 'Other'
    ? parsed.brand
    : (['iPhone', 'iPad', 'Apple Watch'].includes(category)
        ? 'Apple'
        : (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category) ? 'Samsung' : 'Other'));
  const cleanModel = parsed.model || model;
  const storage = (input.storage ?? '').trim() || parsed.storage;

  try {
    await dbService.update('inventoryUnits', input.unitId, {
      model: cleanModel,
      brand,
      category,
      ...(input.colour?.trim() ? { colour: input.colour.trim() } : {}),
      ...(storage ? { storage } : {}),
      ...(parsed.series ? ({ series: parsed.series } as any) : {}),
      ...(input.stockSource ? { stockSource: input.stockSource } : {}),
      supplierId,
      supplierName,
      buyPrice: bp,
    });
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Save failed. Check connection.' };
  }

  await logInventoryEvent({
    type: 'notes_updated',
    message: `Unit ${input.unitId} buy-side info completed for audit (${cleanModel}${storage ? ' ' + storage : ''}, ${supplierName}, £${bp})`,
    unitId: input.unitId,
  });

  return { ok: true, id: input.unitId };
}
