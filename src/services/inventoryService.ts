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
import type { AccessoryStock, AccessoryStockEvent, AccessoryEventType, AccessoryEventSource, DeviceCategory, InventoryAggregate, InventoryUnit, ListingSite, Marketplace, ReturnCategory, Sale, Notice } from '../types';
import { isAppleDevice, isValidImei, isValidImeiOrSerial } from '../lib/imeiValidation';
import { decodeSkuAttributes, DEFAULT_COLOUR } from '../lib/operatorSkuAttributes';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { auth, isAdmin } from '../lib/firebase';
import { calcSaleFinancials } from '../lib/platforms';
import { sanitiseFsIdSegment } from '../lib/salesImport';

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
  /** True when adding this unit CLOSED an open supplier holding.
   *  A supplier-shipped phone reaches us as an orphan sale — its IMEI is one
   *  we have never seen, because the holding never had one — so this is where
   *  most SHS fulfilments actually happen, and the Done screen needs to say
   *  so rather than reporting zero while supplier stock visibly drops. */
  shsFulfilled?: boolean;
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
    // Manual intake: the operator picks a colour from the dropdown, so this
    // fallback rarely fires — but it uses the same house placeholder as the
    // import path rather than 'Unknown', which the orphan check reads as
    // "nobody has touched this record".
    colour: (input.colour ?? '').trim() || DEFAULT_COLOUR,
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
      stockSource: (sale as any).stockSource ?? unit?.stockSource ?? 'office',
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

  // Reverse reconcile — link any orphan sales to the newly received units.
  for (const { imei } of accepted) {
    try {
      await reconcileOrphanSaleForImei(imei);
    } catch { /* non-critical */ }
  }

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
  simType?: string;
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
 *
 * GAP FIX — SHS Phantom Cleanup: When stockSource='shs', after creating
 * the sold unit we search for and delete the original SHS placeholder
 * (shs_* synthetic doc) and update/decrement the matching aggregate so
 * the SHS KPI tile doesn't carry phantom stock.
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
  // The sale's SKU is the ONLY place storage / colour can come from here —
  // the Sales Report's marketplace tabs carry neither column (only Returns
  // Detail does), so a sale for an IMEI that was never in stock has nothing
  // else to read. Decode before parsing so an Apple Watch SKU
  // ("AW SE 3-40-MN") becomes a real model name instead of the "3-40-MN"
  // fragment parseBrandModelStorage leaves behind when it mistakes the
  // leading "AW" for a brand.
  const decoded = decodeSkuAttributes(sale.sku ?? model);
  const effectiveModel = decoded.model || model;
  const parsed = parseBrandModelStorage(effectiveModel);
  const category = detectCategory(effectiveModel);
  const brand = parsed.brand !== 'Other'
    ? parsed.brand
    : (['iPhone', 'iPad', 'Apple Watch'].includes(category)
        ? 'Apple'
        : (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category) ? 'Samsung' : 'Other'));
  // A decoded name wins over the parser's split — for an Apple Watch the
  // parser has already been fooled by "AW", so parsed.model would undo it.
  const cleanModel = decoded.model || parsed.model || model;
  const storage = (input.storage ?? '').trim() || parsed.storage || decoded.storage || '';
  // Colour: operator's value, then whatever the SKU encodes, then the house
  // placeholder. Operator decision — colour isn't tracked; what must survive
  // an import is the pricing and the model name. See DEFAULT_COLOUR.
  const colour = (input.colour ?? '').trim() || decoded.colour || DEFAULT_COLOUR;
  const createdAt = new Date().toISOString();

  const newUnit: InventoryUnit = {
    id: rawImei,
    imei: rawImei,
    model: cleanModel,
    brand,
    category,
    colour,
    ...(storage ? { storage } : {}),
    ...((input.simType ?? '').trim() ? { simType: (input.simType ?? '').trim() } : {}),
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

  // When a unit is fulfilled from SHS (supplier held it, sold before we ever
  // received it), the holding and the master-file aggregate still exist and
  // would keep counting as stock we don't have.
  //
  // This used to fire only when the CALLER declared stockSource==='shs'. On
  // the import path nobody does: a supplier-shipped phone arrives as an
  // ordinary orphan sale, because its IMEI is one we have never seen — the
  // holding never had an IMEI to match against. So the flag was never set,
  // the holding was never closed, and supplier-held stock only ever grew.
  //
  // The operator marks it, on the import's audit row — there is an Office/SHS
  // toggle per orphan precisely for this.
  //
  // Inferring it instead ("an open holding for this model+supplier must mean
  // the supplier shipped it") is tempting and wrong. On a RESTORE every sale
  // re-imports as an orphan, because the sold units were never in the stock
  // report; any whose model+supplier happened to match an open holding then
  // closed it. Rebuilding from a backup silently ate three holdings.
  //
  // Only a human knows whether an unmatched sale is a supplier shipment or
  // history being replayed. So we ask, and act only when told.
  // Guarded for the same reason logInventoryEvent is: the unit is ALREADY
  // written by this point, so this runs on the success path. Letting it throw
  // would fly past the `{ ok, error }` contract this function otherwise
  // honours, and report a row as failed — or abort the caller entirely — for
  // a unit that exists and is correct. A holding that didn't close is a
  // reconciliation to redo, not a reason to lose the sale.
  let shsResult = { placeholdersRemoved: 0, aggregatesDecremented: 0 };
  if (input.stockSource === 'shs') {
    try {
      shsResult = await reconcileShsAfterFulfilment({
        model: cleanModel,
        supplierName,
        contextImei: rawImei,
      });
    } catch (err) {
      console.warn(`[addSoldUnitFromSale] SHS reconciliation failed for ${rawImei} (unit still created):`, err);
    }
  }

  await logInventoryEvent({
    type: 'sold',
    message: `Unit ${rawImei} added from sale ${sale.marketplace} ${sale.orderNumber || ''} — marked sold (${cleanModel}${storage ? ' ' + storage : ''})`,
    unitId: rawImei,
  });

  return { ok: true, id: rawImei, shsFulfilled: shsResult.placeholdersRemoved > 0 };
}

// ---------------------------------------------------------------------------
// restoreUnitReturnFromImport — replay a voided Sale's return state onto its unit
// ---------------------------------------------------------------------------

export type RestoreUnitReturnErrorCode =
  | 'not_voided'
  | 'missing_imei'
  | 'missing_model'
  | 'missing_buy_price'
  | 'missing_supplier'
  | 'superseded_by_newer_sale'
  | 'write_failed';

export interface RestoreUnitReturnResult {
  ok: boolean;
  error?: RestoreUnitReturnErrorCode;
  message?: string;
  unitId?: string;
  /** True when there was no matching unit at all and one was reconstructed
   *  directly in returned/available shape (as opposed to an existing unit
   *  that got patched). */
  created?: boolean;
}

/** Build the return-state patch shared by both restore paths below — the
 *  import-time equivalent of returnsService.ts's buildReturningUnitPatch,
 *  sourced from the Sale's own voided fields (voidedAt/voidReason/
 *  voidOutcome) instead of a live operator's modal inputs, since a
 *  re-imported workbook is all we have to go on. Postage-leg cost is
 *  recomputed from the sale's own postage/postageVat rather than
 *  returnsService's findLinkedSales query — the sale IS the linked sale
 *  here, no lookup needed. */
function buildRestoredReturnPatch(sale: Sale, returnType: ReturnCategory): Record<string, any> {
  const returnOutcome: 'refund' | 'replacement' | undefined =
    sale.voidOutcome === 'refund' || sale.voidOutcome === 'replacement' ? sale.voidOutcome : undefined;
  const postage = Number(sale.postage) || 0;
  const pVat = sale.postageVatExempt ? 0 : (Number(sale.postageVat) || postage * 0.2);
  const legCost = postage > 0 ? postage + pVat : null;

  const patch: Record<string, any> = {
    status: returnType === 'returned_to_inventory' ? 'available' : 'returned',
    returnType,
    returnDate: sale.voidedAt,
    returnReason: sale.voidReason ?? '',
    returnOutcome: returnOutcome ?? null,
    returnLegCost: legCost,
    pendingCrmReview: false,
    salePrice: null,
    saleDate: null,
    salePlatform: null,
    saleOrderId: null,
    postageCost: null,
  };
  if (returnType === 'returned_to_inventory') {
    patch.platformListed = false;
    patch.listingSites = [];
  }
  return patch;
}

/**
 * Restore a unit's return markers from a re-imported Sales Report whose
 * marketplace tab shows this sale as voided (voidedAt/voidOutcome/
 * voidReason — see salesImport.ts's return-block parsing) and whose
 * Returns tab supplied a Return Type for it (salesImport.ts's
 * parseReturnsTab / ParsedReturnRow).
 *
 * Two cases, both ending in the same buildRestoredReturnPatch shape:
 *   - `existingUnit` present (pre-existing in the DB, or just created
 *     'sold' by this same import batch) → patch it straight to returned.
 *   - No matching unit anywhere (a DB rebuilt from this workbook alone,
 *     so the unit was never re-created) → reuse addSoldUnitFromSale's
 *     validation/model-split/supplier-resolution to birth it, then patch
 *     the same patch on top. There is no live "sold" moment to preserve
 *     for a unit whose entire life this import is "it came back" — the
 *     intermediate create is just code reuse, not a semantic step.
 *
 * Never called for a sale with no returnType supplied (the caller only
 * invokes this once it has one from the Returns tab) — this function does
 * not guess Return Type, matching the same caution as the rest of the
 * returns write surface.
 */
export async function restoreUnitReturnFromImport(input: {
  sale: Sale;
  returnType: ReturnCategory;
  existingUnit?: InventoryUnit | null;
}): Promise<RestoreUnitReturnResult> {
  const { sale, returnType } = input;
  if (!sale.voidedAt) {
    return { ok: false, error: 'not_voided', message: 'Sale is not voided; nothing to restore.' };
  }
  const rawImei = (sale.imei || '').trim().toUpperCase();
  if (!rawImei) {
    return { ok: false, error: 'missing_imei', message: 'Sale has no IMEI to restore a unit against.' };
  }

  const returnPatch = buildRestoredReturnPatch(sale, returnType);
  const existingUnit = input.existingUnit ?? (await dbService.getByImei(rawImei) as InventoryUnit | null);

  try {
    if (existingUnit) {
      // Idempotent — re-running the same import (or a second file covering
      // the same period) shouldn't double-log or re-write an already
      // restored unit. Must also compare returnDate, not just status/type:
      // a unit returned twice (never resold in between, so the multi-cycle
      // guard below never fires) has TWO voided sales sharing the SAME
      // Return Type — the Returns Detail sheet only ever carries the
      // latest cycle's type (see parseReturnsTab), so both restore calls
      // for this unit are made with an identical returnType. Without the
      // date check, the FIRST (oldest) call would create the unit with
      // its own correct returnDate, then the SECOND (newest, actually-
      // current) call would see status+type already match and skip —
      // silently leaving the unit stuck on the older cycle's returnDate/
      // reason/outcome forever, with only the returnType happening to
      // look right.
      if (
        existingUnit.status === returnPatch.status
        && existingUnit.returnType === returnType
        && existingUnit.returnDate === returnPatch.returnDate
      ) {
        return { ok: true, unitId: existingUnit.id, created: false };
      }
      // Multi-cycle guard: sell → return → sell again, then the whole
      // history re-imports in one file. The unit's CURRENT state may
      // already reflect a NEWER sale (this same import batch's audit-
      // completion / sold-flip step runs before this one) — restoring an
      // older, now-superseded return here would silently overwrite that
      // newer sale's status/link. Only proceed when the unit's current
      // sale linkage still points at THIS sale, or there is none at all
      // (a plain returned-then-never-resold unit).
      const linkedToThisSale =
        !existingUnit.saleOrderId
        || (existingUnit.saleOrderId === sale.orderNumber && existingUnit.salePlatform === sale.marketplace);
      if (existingUnit.status === 'sold' && !linkedToThisSale) {
        return {
          ok: false, error: 'superseded_by_newer_sale', unitId: existingUnit.id,
          message: `Unit ${existingUnit.id} has since been re-sold (order ${existingUnit.saleOrderId}); this older return was not applied so the newer sale isn't overwritten.`,
        };
      }
      await dbService.update('inventoryUnits', existingUnit.id, returnPatch);
      dbService.applyCacheItem('inventoryUnits', existingUnit.id, returnPatch);
      await logInventoryEvent({
        type: 'returned',
        message: `Return restored from import · ${existingUnit.model}${existingUnit.storage ? ' ' + existingUnit.storage : ''} · ${returnType.replace(/_/g, ' ')}`,
        unitId: existingUnit.id,
        buyPrice: existingUnit.buyPrice,
      });
      return { ok: true, unitId: existingUnit.id, created: false };
    }

    // No unit anywhere — birth it sold (reusing addSoldUnitFromSale's
    // validation + model/supplier resolution), then immediately patch the
    // same return state on top.
    const created = await addSoldUnitFromSale({
      sale,
      imei: rawImei,
      model: (sale.model ?? sale.sku ?? '').trim(),
      buyPrice: sale.buyPrice,
      supplierName: sale.supplierName,
    });
    if (!created.ok || !created.id) {
      const code: RestoreUnitReturnErrorCode =
        created.error === 'missing_model' ? 'missing_model'
        : created.error === 'missing_buy_price' ? 'missing_buy_price'
        : created.error === 'missing_supplier' ? 'missing_supplier'
        : 'write_failed';
      return { ok: false, error: code, message: created.message };
    }

    await dbService.update('inventoryUnits', created.id, returnPatch);
    dbService.applyCacheItem('inventoryUnits', created.id, returnPatch);
    await logInventoryEvent({
      type: 'returned',
      message: `Unit ${created.id} reconstructed from import — restored as ${returnType.replace(/_/g, ' ')}`,
      unitId: created.id,
      buyPrice: sale.buyPrice,
    });
    return { ok: true, unitId: created.id, created: true };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Failed to restore return state.' };
  }
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
  simType?: string;
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
      ...(input.simType?.trim() ? { simType: input.simType.trim() } : {}),
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

/**
 * Update an inventory unit as Admin.
 * Handles swapping the unit ID if the IMEI changes, which is necessary since
 * the document ID in Firestore is the unit's IMEI.
 * Swapping the ID requires deleting the old document and creating a new one,
 * plus updating all foreign keys in sales, events, dailyUpdates, etc.
 */
export async function adminUpdateUnit(
  unit: InventoryUnit,
  patch: Partial<InventoryUnit>
): Promise<AddUnitResult> {
  if (!isAdmin(auth.currentUser)) {
    return { ok: false, error: 'write_failed', message: 'Admin access required.' };
  }

  const nextImei = patch.imei ? patch.imei.trim().toUpperCase() : '';
  const currentImei = (unit.imei || '').trim().toUpperCase();
  const idChanged = nextImei && nextImei !== currentImei;

  if (idChanged) {
    const apple = isAppleDevice(patch.model || unit.model);
    if (!isValidImei(nextImei, { isAppleSerial: apple })) {
      return {
        ok: false,
        error: 'invalid_imei',
        message: apple
          ? 'Enter a valid 15-digit IMEI or 10-12 char Apple serial.'
          : 'Enter a valid 15-digit IMEI (digits only — no letters).',
      };
    }

    // Check collision in DB
    const cached = await dbService.readAll('inventoryUnits');
    const collision = cached.find((u: any) => u.id !== unit.id && u.imei === nextImei);
    if (collision) {
      return {
        ok: false,
        error: 'duplicate_imei',
        message: `IMEI ${nextImei} is already in use by another unit.`,
      };
    }

    try {
      // 1. Fetch all associated collections to update
      const allSales = await dbService.readAll('sales');
      const allEvents = await dbService.readAll('inventoryEvents');
      const allUpdates = await dbService.readAll('dailyUpdates');
      const allUnits = await dbService.readAll('inventoryUnits');
      const allDocs = await dbService.readAll('sourceDocuments');

      const bulkUpdates: Array<{ collection: string; id: string; data: any }> = [];
      const bulkDeletes: Array<{ collection: string; id: string }> = [];

      // Create new unit doc (with new IMEI as ID)
      const newUnit = {
        ...unit,
        ...patch,
        id: nextImei,
        imei: nextImei,
        updatedAt: new Date().toISOString(),
      };
      bulkUpdates.push({ collection: 'inventoryUnits', id: nextImei, data: newUnit });

      // Delete old unit doc
      bulkDeletes.push({ collection: 'inventoryUnits', id: unit.id });

      // Update linked sales
      for (const s of allSales) {
        if (s.unitId === unit.id || s.imei === currentImei) {
          bulkUpdates.push({
            collection: 'sales',
            id: s.id,
            data: {
              ...s,
              unitId: nextImei,
              imei: nextImei,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // Update linked inventoryEvents
      for (const ev of allEvents) {
        if (ev.unitId === unit.id) {
          bulkUpdates.push({
            collection: 'inventoryEvents',
            id: ev.id,
            data: {
              ...ev,
              unitId: nextImei,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // Update dailyUpdates
      for (const du of allUpdates) {
        if (du.affectedUnitIds?.includes(unit.id)) {
          const nextIds = du.affectedUnitIds.map((id: string) => id === unit.id ? nextImei : id);
          bulkUpdates.push({
            collection: 'dailyUpdates',
            id: du.id,
            data: {
              ...du,
              affectedUnitIds: nextIds,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // Update replacement references in other units
      for (const u of allUnits) {
        if (u.id !== unit.id && (u.replacedByUnitId === unit.id || u.replacementForUnitId === unit.id)) {
          const uPatch: any = {};
          if (u.replacedByUnitId === unit.id) uPatch.replacedByUnitId = nextImei;
          if (u.replacementForUnitId === unit.id) uPatch.replacementForUnitId = nextImei;
          bulkUpdates.push({
            collection: 'inventoryUnits',
            id: u.id,
            data: {
              ...u,
              ...uPatch,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // Update linked sourceDocuments
      for (const doc of allDocs) {
        if (doc.linkedId === unit.id) {
          bulkUpdates.push({
            collection: 'sourceDocuments',
            id: doc.id,
            data: {
              ...doc,
              linkedId: nextImei,
              updatedAt: new Date().toISOString(),
            },
          });
        }
      }

      // Execute Firestore writes
      await dbService.bulkCreate(bulkUpdates);
      await dbService.bulkDelete(bulkDeletes);

      await logInventoryEvent({
        type: 'stock_adjusted',
        message: `IMEI changed by admin: ${currentImei} → ${nextImei}`,
        unitId: nextImei,
      });

      return { ok: true, id: nextImei };
    } catch (err: any) {
      return { ok: false, error: 'write_failed', message: err?.message || 'Failed to update IMEI.' };
    }
  } else {
    // Normal non-ID update
    try {
      await dbService.update('inventoryUnits', unit.id, patch);
      await logInventoryEvent({
        type: 'stock_adjusted',
        message: `Unit ${unit.id} updated by admin`,
        unitId: unit.id,
      });
      return { ok: true, id: unit.id };
    } catch (err: any) {
      return { ok: false, error: 'write_failed', message: err?.message || 'Update failed' };
    }
  }
}

/**
 * Delete an office (in-stock / non-sold) inventory unit as Admin.
 * Same audit trail + notice board posting behavior as shsService.deleteShsUnit.
 */
export async function deleteOfficeUnit(
  unit: InventoryUnit,
  reason: string
): Promise<AddUnitResult> {
  if (!isAdmin(auth.currentUser)) {
    return { ok: false, error: 'write_failed', message: 'Admin access required.' };
  }

  if (unit.status === 'sold') {
    return { ok: false, error: 'write_failed', message: 'Cannot delete a sold unit. Void the sale first.' };
  }

  try {
    // Delete the unit doc
    await dbService.delete('inventoryUnits', unit.id);

    const now = new Date().toISOString();
    const adminEmail = auth.currentUser?.email || 'admin';
    const parts = [
      'Office stock deleted',
      unit.model,
      unit.colour,
      unit.storage,
      unit.supplierName ? `supplier: ${unit.supplierName}` : undefined,
      `— ${reason}`,
      `(by ${adminEmail} · ${now.slice(0, 10)})`,
    ].filter(Boolean);

    const noticeId = `notice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const notice: Omit<Notice, 'id'> & { id: string } = {
      id: noticeId,
      content: parts.join(' · '),
      createdAt: now,
      createdBy: adminEmail,
      ownerId: 'shared',
    };

    await Promise.all([
      dbService.create('notices', noticeId, notice),
      logInventoryEvent({
        type: 'stock_adjusted',
        message: `Office unit deleted · ${unit.model}${unit.storage ? ' ' + unit.storage : ''}${unit.colour ? ' · ' + unit.colour : ''} · supplier: ${unit.supplierName} — ${reason}`,
        unitId: unit.id,
        buyPrice: unit.buyPrice,
      }),
    ]);

    return { ok: true, id: unit.id };
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Delete failed.' };
  }
}


/**
 * Clear the SHS trail behind a unit that has been fulfilled.
 *
 * A phone the supplier held for us is recorded in up to two places that
 * carry no IMEI of their own:
 *
 *   1. a parser-created placeholder unit (`shs_*`, status 'incoming')
 *   2. a master-file aggregate row (quantityText === 'SHS')
 *
 * Once the phone actually sells, both are stock we no longer have. Left
 * behind they inflate the SHS tile and the supplier-holding reports with
 * phantom units — the operator sees stock on order that shipped weeks ago.
 *
 * Called from BOTH fulfilment paths so they cannot drift:
 *   - addSoldUnitFromSale — an orphan sale completed as SHS at import time
 *   - the sales-import sync — a sale whose IMEI matched an incoming unit
 *
 * Matching is by model + supplier slug, the only keys these rows carry.
 * Best-effort: a failure here never fails the sale, it just leaves the
 * tidying for later.
 */
export async function reconcileShsAfterFulfilment(input: {
  model: string;
  supplierName: string;
  /** IMEI of the unit that sold — for the audit log only. */
  contextImei?: string;
}): Promise<{ placeholdersRemoved: number; aggregatesDecremented: number }> {
  const modelSlug = slugify(input.model || '');
  const supplierSlug = slugify(input.supplierName || '');
  if (!modelSlug) return { placeholdersRemoved: 0, aggregatesDecremented: 0 };

  let placeholdersRemoved = 0;
  let aggregatesDecremented = 0;

  try {
    const allUnits = await dbService.readAll('inventoryUnits');
    const allAggs = await dbService.readAll('inventoryAggregates');

    // 1. Open holdings for this model+supplier.
    //
    // This used to match on an id prefix — `shs_`, the shape the master-file
    // parser happens to mint. That quietly excluded every OTHER way a holding
    // gets created: the manual Add Stock screen writes `manual_shs_*`, and the
    // importer writes `manual_shs_imp_*`. Those holdings were never closed, so
    // supplier-held stock only ever grew.
    //
    // A holding is not an id prefix. It is a unit the supplier still has:
    // status 'incoming' with no IMEI, because there is no handset here to read
    // one off. Match on that, and every creation path is covered — including
    // ones nobody has written yet.
    //
    // Only ONE is closed per fulfilment: ten of the same model from one
    // supplier is a normal holding line, and one sale ships one phone.
    const holdings = allUnits.filter((u: any) => {
      const isOpenHolding = u.status === 'incoming' && !String(u.imei || '').trim();
      const isParserPlaceholder = String(u.id || '').startsWith('shs_');
      if (!isOpenHolding && !isParserPlaceholder) return false;
      return slugify(u.rawModel || u.model || '') === modelSlug
        && (slugify(u.supplierName || '') === supplierSlug
            || (u.supplierIds || []).some((sid: string) => slugify(sid) === supplierSlug));
    });
    const placeholders = holdings.slice(0, 1);
    for (const ph of placeholders) {
      await dbService.delete('inventoryUnits', ph.id).catch(() => {});
      placeholdersRemoved++;
      await logInventoryEvent({
        type: 'stock_adjusted',
        message: `SHS holding ${ph.id} closed after fulfilment${input.contextImei ? ` of ${input.contextImei}` : ''}`,
        unitId: input.contextImei,
      });
    }

    // 2. Master-file aggregate — decrement, and mark RECEIVED at zero so
    //    it stops being counted as supplier-held.
    for (const agg of allAggs) {
      const aggSupplierMatch = (agg.supplierIds || []).some((sid: string) => {
        const sname = (sid || '').toLowerCase();
        return sname.includes(supplierSlug) || slugify(sname) === supplierSlug;
      });
      if (slugify(agg.model || '') === modelSlug
          && aggSupplierMatch
          && (agg.quantityText || '').toUpperCase() === 'SHS') {
        const newQty = Math.max(0, (agg.quantityNum ?? 1) - 1);
        await dbService.update('inventoryAggregates', agg.id, {
          quantityNum: newQty,
          ...(newQty === 0 ? { quantityText: 'RECEIVED' } : {}),
        });
        aggregatesDecremented++;
        await logInventoryEvent({
          type: 'stock_adjusted',
          message: `SHS aggregate ${agg.id} decremented (${agg.quantityNum} → ${newQty}) after fulfilment`,
        });
      }
    }
  } catch (e) {
    console.warn('SHS fulfilment cleanup failed (non-critical)', e);
  }

  return { placeholdersRemoved, aggregatesDecremented };
}

// ---------------------------------------------------------------------------
// Accessory stock — no-IMEI quantity pools (chargers, SIM pins, cables)
// ---------------------------------------------------------------------------

/** Append one row to the accessoryStockEvents ledger — the transaction
 *  history behind AccessoryStock's running `quantity`, mirroring the
 *  traceability an IMEI gives a regular InventoryUnit for free. See
 *  AccessoryStockEvent in types.ts for the reconciliation caveat. */
async function logAccessoryStockEvent(input: {
  sku: string;
  skuId: string;
  type: AccessoryEventType;
  delta: number;
  quantityAfter: number;
  source: AccessoryEventSource;
  orderNumber?: string;
  marketplace?: string;
  reason?: string;
  refEventId?: string;
  notes?: string;
}): Promise<void> {
  const id = `acc_evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const payload: Partial<AccessoryStockEvent> = {
    sku: input.sku,
    skuId: input.skuId,
    type: input.type,
    delta: input.delta,
    quantityAfter: input.quantityAfter,
    source: input.source,
    orderNumber: input.orderNumber,
    marketplace: input.marketplace,
    reason: input.reason,
    refEventId: input.refEventId,
    notes: input.notes,
    createdBy: auth.currentUser?.email || undefined,
  };
  await dbService.create('accessoryStockEvents', id, payload);
}

export interface UpsertAccessoryStockInput {
  sku: string;
  name: string;
  supplierName?: string;
  /** Quantity to ADD to the pool (not the resulting total) — same as
   *  scanning in N more of an existing SKU at Add Stock. */
  quantity: number;
  buyPrice: number;
  notes?: string;
}

export interface UpsertAccessoryStockResult {
  ok: boolean;
  id?: string;
  quantity?: number;
  error?: string;
}

/** Create a new accessory SKU pool, or top up an existing one by SKU
 *  (doc id = slugified SKU, same convention as SHS's model+supplier slug
 *  matching). Quantity ADDS to whatever's already there; BP/name/supplier
 *  are refreshed to the latest values passed in. */
export async function upsertAccessoryStock(input: UpsertAccessoryStockInput): Promise<UpsertAccessoryStockResult> {
  const sku = (input.sku || '').trim();
  if (!sku) return { ok: false, error: 'missing_sku' };
  if (!(input.quantity > 0)) return { ok: false, error: 'invalid_quantity' };

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  const supplierId = input.supplierName ? await ensureSupplier(input.supplierName) : existing?.supplierId;
  const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
  // totalReceived tracks cumulative intake, never decremented by a sale —
  // this is the figure the Inventory Report exports and restores on
  // re-import. Falls back to the existing quantity for a doc that predates
  // this field, so older pools self-heal on their next top-up.
  const nextTotalReceived = (existing?.totalReceived ?? existing?.quantity ?? 0) + input.quantity;

  const payload: Partial<AccessoryStock> = {
    sku,
    name: (input.name || existing?.name || sku).trim(),
    supplierId,
    supplierName: input.supplierName || existing?.supplierName,
    quantity: nextQuantity,
    totalReceived: nextTotalReceived,
    buyPrice: input.buyPrice > 0 ? input.buyPrice : (existing?.buyPrice ?? 0),
    notes: input.notes ?? existing?.notes,
  };
  await dbService.create('accessoryStock', id, payload);
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: existing
      ? `Accessory "${sku}" topped up (+${input.quantity} → ${nextQuantity})`
      : `Accessory "${sku}" added to stock (${input.quantity})`,
  });
  await logAccessoryStockEvent({
    sku, skuId: id, type: 'topup', delta: input.quantity, quantityAfter: nextQuantity,
    source: 'manual',
  });
  return { ok: true, id, quantity: nextQuantity };
}

export interface RegisterAccessorySkuResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Pre-register an accessory SKU with no stock yet — the accessory
 * equivalent of seeding a device model in the `models` catalog before any
 * units arrive.
 *
 * Separate from `upsertAccessoryStock` because that one deliberately
 * rejects a non-positive quantity (it exists to ADD stock, and a 0 there
 * is a mistake). Here a zero pool is the whole point: it makes the SKU
 * pickable in Add Stock → Accessories so the first real intake tops up an
 * agreed name instead of inventing a new one. Nothing downstream needs
 * changing for it — the sell picker already filters to quantity > 0, and
 * the intake picker already renders a zero pool with an "out" badge.
 */
export async function registerAccessorySku(input: {
  sku: string; name: string; notes?: string;
}): Promise<RegisterAccessorySkuResult> {
  const sku = (input.sku || '').trim();
  if (!sku) return { ok: false, error: 'missing_sku' };

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  if (existing) return { ok: false, error: 'already_exists' };

  await dbService.create('accessoryStock', id, {
    sku,
    name: (input.name || sku).trim(),
    quantity: 0,
    totalReceived: 0,
    buyPrice: 0,
    notes: input.notes,
    ownerId: 'shared',
    createdAt: new Date().toISOString(),
  });
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Accessory "${sku}" registered in the catalog (no stock yet)`,
  });
  return { ok: true, id };
}

export interface DecrementAccessoryStockResult {
  /** True only when a matching SKU pool was found (whether or not it had
   *  enough quantity) — false means "this SKU isn't accessory-tracked",
   *  which is the normal case for every non-accessory sale. */
  matched: boolean;
  id?: string;
  remaining?: number;
}

/** Consume `quantity` units from the accessory pool matching `sku`, floored
 *  at 0 (a sale that outruns recorded stock still gets recorded — the pool
 *  just can't go negative — the operator can top it up after the fact).
 *  No-op (matched: false) when no pool exists for this SKU, which is the
 *  ordinary outcome for every non-accessory no-IMEI sale row.
 *  `orderNumber`/`marketplace` are optional context for the ledger row —
 *  the Sales Report import path has both; other future callers may not. */
export async function decrementAccessoryStock(
  sku: string,
  quantity: number,
  context?: { orderNumber?: string; marketplace?: string },
): Promise<DecrementAccessoryStockResult> {
  const s = (sku || '').trim();
  if (!s || !(quantity > 0)) return { matched: false };
  const id = slugify(s);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  if (!existing) return { matched: false };

  const remaining = Math.max(0, (existing.quantity ?? 0) - quantity);
  await dbService.update('accessoryStock', id, { quantity: remaining });
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Accessory "${existing.sku}" sold (-${quantity} → ${remaining})`,
  });
  await logAccessoryStockEvent({
    sku: existing.sku, skuId: id, type: 'sale', delta: -quantity, quantityAfter: remaining,
    source: 'sales_report_import',
    orderNumber: context?.orderNumber, marketplace: context?.marketplace,
  });
  return { matched: true, id, remaining };
}

export interface RecordAccessorySaleInput {
  sku: string;
  marketplace: Marketplace;
  orderNumber: string;
  /** Units sold in this one line — an accessory sale routinely covers more
   *  than one (e.g. 3 chargers on one order), unlike a phone sale which is
   *  always exactly 1. */
  quantity: number;
  /** Total sale price for this line (all `quantity` units combined) — same
   *  "line total, not per-unit" convention the Sales Report import already
   *  uses, so GP math (which never multiplies by quantity) stays correct. */
  salePrice: number;
  saleDate?: string;
  paymentMode?: string;
  postageOverride?: number;
  postageVatExempt?: boolean;
  comments?: string;
}

export type RecordAccessorySaleErrorCode =
  | 'missing_sku'
  | 'not_found'
  | 'missing_marketplace'
  | 'missing_order_number'
  | 'invalid_quantity'
  | 'insufficient_stock'
  | 'invalid_price'
  | 'write_failed';

export interface RecordAccessorySaleResult {
  ok: boolean;
  saleId?: string;
  /** Pool quantity remaining after the sale. */
  quantity?: number;
  error?: RecordAccessorySaleErrorCode;
  message?: string;
}

/**
 * Record one marketplace sale for a no-IMEI accessory pool, in-app —
 * the accessory counterpart to recordSale() (salesService.ts) for units.
 * Every real accessory sale still normally arrives via the Sales Report
 * import; this exists for the same reason SellOrderModal exists for phones:
 * so ops isn't forced to wait for the monthly bulk file just to log one
 * sale as it happens.
 *
 * Writes a genuine Sale doc (marketplace/orderNumber/sku, no imei/unitId —
 * same shape a Sales Report import produces for an accessory row) via the
 * same calcSaleFinancials formulas every other marketplace sale uses, then
 * decrements the pool by `quantity`. Rejects up front if `quantity` exceeds
 * what's on hand — a typed one-off entry should fail loudly rather than
 * silently floor at 0 the way a bulk historical import does.
 */
export async function recordAccessorySale(input: RecordAccessorySaleInput): Promise<RecordAccessorySaleResult> {
  const sku = (input.sku || '').trim();
  if (!sku) return { ok: false, error: 'missing_sku', message: 'SKU is required.' };
  if (!input.marketplace) return { ok: false, error: 'missing_marketplace', message: 'Marketplace is required.' };
  const orderNumber = (input.orderNumber || '').trim();
  if (!orderNumber) return { ok: false, error: 'missing_order_number', message: 'Order number is required.' };
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'invalid_quantity', message: 'Quantity must be greater than 0.' };
  }
  const sp = Number(input.salePrice);
  if (!Number.isFinite(sp) || sp <= 0) {
    return { ok: false, error: 'invalid_price', message: 'Sale price must be greater than £0.' };
  }

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id) as AccessoryStock | undefined;
  if (!existing) return { ok: false, error: 'not_found', message: 'This SKU no longer exists.' };
  if (quantity > (existing.quantity ?? 0)) {
    return { ok: false, error: 'insufficient_stock', message: `Only ${existing.quantity ?? 0} left in stock.` };
  }

  const bp = (existing.buyPrice || 0) * quantity;
  const hasPayPalKlarna = /paypal|klarna|clearpay|clear pay|applepay|apple pay/i.test(input.paymentMode || '');
  let eBayShippingTier: 1 | 2 | 8 | undefined;
  if (input.marketplace === 'EBAY'
      && (input.postageOverride === 1 || input.postageOverride === 2 || input.postageOverride === 8)) {
    eBayShippingTier = input.postageOverride as 1 | 2 | 8;
  }
  const fin = calcSaleFinancials({
    marketplace: input.marketplace,
    buyPrice: bp,
    salePrice: sp,
    postageOverride: input.postageOverride,
    eBayShippingTier,
    hasPayPalKlarna,
    postageVatExempt: input.postageVatExempt,
  });

  const saleDate = input.saleDate || today();
  const nowIso = new Date().toISOString();
  // Composite id matches the convention recordSale/salesImport use
  // (marketplace__orderNumber__discriminator), with sku as the
  // discriminator since there's no imei — so a later Sales Report import
  // of this same order naturally dedupes onto this row instead of
  // duplicating it.
  const saleId = `${input.marketplace}__${sanitiseFsIdSegment(orderNumber)}__${sanitiseFsIdSegment(sku)}`;

  const sale: Sale = {
    id: saleId,
    marketplace: input.marketplace,
    orderNumber,
    sku: existing.sku,
    supplierId: existing.supplierId,
    supplierName: existing.supplierName,
    saleDate,
    quantity,
    buyPrice: bp,
    salePrice: sp,
    paymentMode: input.paymentMode,
    spMinusBp: fin.spMinusBp,
    marginalTax: fin.marginalTax,
    commission: fin.commission,
    payPalKlarnaCom: fin.payPalKlarnaCom,
    rof: fin.rof,
    fvf: fin.fvf,
    twentyPercent: fin.twentyPercent,
    totalCom: fin.totalCom,
    vat20: fin.vat20,
    marVat: fin.marVat,
    postage: fin.postage,
    postageVat: fin.postageVat,
    postageVatExempt: input.postageVatExempt || undefined,
    grossProfit: fin.grossProfit,
    gpPercent: fin.gpPercent,
    netProfit: fin.netProfit,
    comments: input.comments,
    importBatchId: 'inapp',
    sourceFile: 'inapp-sell-flow',
    sourceRow: 0,
    importedAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
    ownerId: 'shared',
  } as Sale;

  try {
    await dbService.create('sales', saleId, sale);
  } catch (err: any) {
    return { ok: false, error: 'write_failed', message: err?.message || 'Save failed.' };
  }

  const remaining = Math.max(0, (existing.quantity ?? 0) - quantity);
  await dbService.update('accessoryStock', id, { quantity: remaining });
  await logInventoryEvent({
    type: 'sold',
    message: `Sold ${quantity}x ${existing.name} on ${input.marketplace} · order ${orderNumber} · £${sp}`,
  });
  await logAccessoryStockEvent({
    sku: existing.sku, skuId: id, type: 'sale', delta: -quantity, quantityAfter: remaining,
    source: 'manual', orderNumber, marketplace: input.marketplace,
  });

  return { ok: true, saleId, quantity: remaining };
}

export interface RestoreAccessoryStockInput {
  sku: string;
  name: string;
  supplierName?: string;
  /** Cumulative units ever added, read straight from the Inventory Report's
   *  Accessories sheet. */
  totalReceived: number;
  buyPrice: number;
  notes?: string;
}

export interface RestoreAccessoryStockResult {
  ok: boolean;
  id?: string;
  /** False when a pool for this SKU already exists — restore is a no-op in
   *  that case, by design (see comment below). */
  created: boolean;
}

/**
 * Recreate an accessory pool from the Inventory Report's Accessories sheet,
 * the counterpart to a wipe + re-upload — the same round trip that already
 * restores office stock, SHS stock and sales.
 *
 * CREATE-ONLY: if a pool for this SKU already exists, this is a no-op. A
 * live pool already reflects everything that's happened to it since the
 * report was generated (top-ups, sales) — overwriting it with a
 * point-in-time export would silently roll it back, exactly the kind of
 * clobber this whole reconciliation effort exists to prevent. This only
 * ever fires for the genuine restore case: the pool doesn't exist because
 * the database was wiped.
 *
 * Seeds `quantity = totalReceived` (as if nothing had sold yet) — the
 * accompanying Sales Report re-upload then nets it down via the ordinary
 * decrement-on-first-import path (decrementAccessoryStock, scoped to newly
 * created sales only), the exact same "Inventory Report gives the gross
 * baseline, Sales Report replay does the netting" pattern regular units
 * already use (see toRow in InventoryReportImport.tsx).
 */
export async function restoreAccessoryStockFromImport(input: RestoreAccessoryStockInput): Promise<RestoreAccessoryStockResult> {
  const sku = (input.sku || '').trim();
  if (!sku || !(input.totalReceived >= 0)) return { ok: false, created: false };

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  if (existing) return { ok: true, created: false, id };

  const supplierId = input.supplierName ? await ensureSupplier(input.supplierName) : undefined;
  const payload: Partial<AccessoryStock> = {
    sku,
    name: (input.name || sku).trim(),
    supplierId,
    supplierName: input.supplierName || undefined,
    quantity: input.totalReceived,
    totalReceived: input.totalReceived,
    buyPrice: input.buyPrice > 0 ? input.buyPrice : 0,
    notes: input.notes || undefined,
  };
  await dbService.create('accessoryStock', id, payload);
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Accessory "${sku}" restored from Inventory Report import (${input.totalReceived})`,
  });
  await logAccessoryStockEvent({
    sku, skuId: id, type: 'restore', delta: input.totalReceived, quantityAfter: input.totalReceived,
    source: 'manual',
    notes: 'Restored from Inventory Report import after a wipe',
  });
  return { ok: true, created: true, id };
}

// ---------------------------------------------------------------------------
// Accessory stock — manual ledger actions (adjust / return)
//
// decrementAccessoryStock only ever fires from the Sales Report import path
// (a real marketplace order row) — every real accessory sale flows through
// a marketplace, so that's the only sale path that exists. These two cover
// what it can't: a stock count correction (damaged, lost, found extra) and
// a customer return.
//
// Reconciliation caveat, deliberately NOT solved here: unlike
// upsertAccessoryStock (totalReceived) and decrementAccessoryStock (a real
// `sales` doc), neither of these two are replayed on a wipe + re-upload — a
// wipe loses this ledger. Documented on AccessoryStockEvent in types.ts.
// ---------------------------------------------------------------------------

export interface AdjustAccessoryStockInput {
  sku: string;
  /** Signed change to quantity — positive for "found more", negative for
   *  "damaged / lost / miscounted". */
  delta: number;
  /** Required — an adjustment with no stated reason is indistinguishable
   *  from a bug. */
  reason: string;
}

export interface AdjustAccessoryStockResult {
  ok: boolean;
  id?: string;
  quantity?: number;
  error?: string;
}

/** Correct a pool's quantity outside the normal sell/top-up flow (stock
 *  count found it short, or found extra). A positive delta counts as
 *  intake for reconciliation purposes (bumps totalReceived, same as a
 *  top-up); a negative delta only reduces `quantity` — the units WERE
 *  received, they're just gone now, which a wipe + re-upload has no way
 *  to know about (see the reconciliation caveat above). */
export async function adjustAccessoryStock(
  input: AdjustAccessoryStockInput,
): Promise<AdjustAccessoryStockResult> {
  const sku = (input.sku || '').trim();
  const reason = (input.reason || '').trim();
  if (!sku) return { ok: false, error: 'missing_sku' };
  if (!input.delta) return { ok: false, error: 'zero_delta' };
  if (!reason) return { ok: false, error: 'missing_reason' };

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  if (!existing) return { ok: false, error: 'not_found' };

  const nextQuantity = Math.max(0, (existing.quantity ?? 0) + input.delta);
  const appliedDelta = nextQuantity - (existing.quantity ?? 0);
  const payload: Partial<AccessoryStock> = { quantity: nextQuantity };
  if (input.delta > 0) {
    payload.totalReceived = (existing.totalReceived ?? existing.quantity ?? 0) + appliedDelta;
  }
  await dbService.update('accessoryStock', id, payload);
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Accessory "${existing.sku}" adjusted (${appliedDelta >= 0 ? '+' : ''}${appliedDelta} → ${nextQuantity}) — ${reason}`,
  });
  await logAccessoryStockEvent({
    sku: existing.sku, skuId: id, type: 'adjustment', delta: appliedDelta, quantityAfter: nextQuantity,
    source: 'manual', reason,
  });
  return { ok: true, id, quantity: nextQuantity };
}

export interface ReturnAccessoryStockInput {
  sku: string;
  /** Which sale is being reversed. Optional — when omitted, the most
   *  recent non-voided sale for this SKU is used (accessories are
   *  fungible, so picking the exact order rarely matters operationally),
   *  but a specific id ties the return to that sale's own quantity,
   *  marketplace and postage figures for exact reconciliation. */
  saleId?: string;
  /** Customer-facing outcome — same vocabulary as a unit return
   *  (Sale.voidOutcome). Drives the Postage Loss column on the Sales
   *  Report exactly like a phone return: refund/repair = 2 shipping legs,
   *  replacement = 3. */
  outcome: 'refund' | 'replacement' | 'repair';
  reason?: string;
  notes?: string;
}

export interface ReturnAccessoryStockResult {
  ok: boolean;
  id?: string;
  quantity?: number;
  /** The sale doc that got voided, so the caller can show what was
   *  reversed (order number, marketplace, quantity). */
  voidedSaleId?: string;
  error?: string;
}

/**
 * A sold accessory coming back — voids the original marketplace sale
 * (voidedAt/voidOutcome/voidReason, the exact same fields a unit return
 * sets on its Sale doc) and adds that sale's own quantity back to the
 * pool. Doesn't touch totalReceived (this isn't new intake from a
 * supplier, it's previously-sold stock returning).
 *
 * Voiding the real sale doc — rather than just bumping the pool — is what
 * makes this participate in the Sales Report exactly like a unit return
 * for free: postageLossFor/writeReturnBlock/writeReturnsSheets in
 * clientReport.ts all key off Sale.voidedAt/voidOutcome and never require
 * a linked InventoryUnit, so the Postage Loss column, the Returns Summary
 * counts, and GP exclusion on every Sell-side view all pick this up
 * without any accessory-specific code there.
 *
 * Restoring `sale.quantity` (not a caller-chosen amount) keeps the wipe +
 * re-upload reconciliation exact: decrementAccessoryStock skips voided
 * sales when replaying toCreate rows post-wipe, so a partial or
 * mismatched restore here would silently drift from the replayed total.
 */
export async function returnAccessoryStock(
  input: ReturnAccessoryStockInput,
): Promise<ReturnAccessoryStockResult> {
  const sku = (input.sku || '').trim();
  if (!sku) return { ok: false, error: 'missing_sku' };

  const id = slugify(sku);
  const existing = (await dbService.readAll('accessoryStock')).find((a: any) => a.id === id);
  if (!existing) return { ok: false, error: 'not_found' };

  const allSales = (await dbService.readAll('sales')) as Sale[];
  let sale: Sale | undefined;
  if (input.saleId) {
    sale = allSales.find(s => s.id === input.saleId && s.sku === sku && !s.voidedAt);
  } else {
    sale = allSales
      .filter(s => s.sku === sku && !(s.imei || '').trim() && !s.voidedAt)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''))[0];
  }
  if (!sale) return { ok: false, error: 'no_matching_sale' };

  const quantity = sale.quantity || 1;
  const nextQuantity = (existing.quantity ?? 0) + quantity;
  const reason = (input.reason || '').trim() || undefined;
  const voidedAt = today();

  await dbService.update('sales', sale.id, {
    voidedAt, voidOutcome: input.outcome, voidReason: reason,
  });
  await dbService.update('accessoryStock', id, { quantity: nextQuantity });
  await logInventoryEvent({
    type: 'stock_adjusted',
    message: `Accessory "${existing.sku}" returned (+${quantity} → ${nextQuantity}) · order ${sale.orderNumber || '—'} · ${input.outcome}`,
  });
  await logAccessoryStockEvent({
    sku: existing.sku, skuId: id, type: 'return', delta: quantity, quantityAfter: nextQuantity,
    source: 'manual', orderNumber: sale.orderNumber, marketplace: sale.marketplace,
    reason, notes: input.notes,
  });
  return { ok: true, id, quantity: nextQuantity, voidedSaleId: sale.id };
}
