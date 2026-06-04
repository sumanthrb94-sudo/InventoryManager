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
import type { DeviceCategory, InventoryAggregate, InventoryUnit, ListingSite } from '../types';
import { isAppleDevice, isValidImei } from '../lib/imeiValidation';
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
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
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

  // 5. Duplicate check against in-DB units — only ACTIVE stock blocks a re-add;
  //    a previously sold / returned unit can be re-intaken (matches the inline
  //    Add-Stock check, so the row and the save agree).
  if (await dbService.imeiExists(rawImei, { activeOnly: true })) {
    return {
      ok: false,
      error: 'duplicate_imei',
      message: `IMEI ${rawImei} is already in active inventory.`,
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

  return { ok: true, id: rawImei };
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
    if (await dbService.imeiExists(imei, { activeOnly: true })) {
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
  // Part of the SHS receive — allowed for the whole team via { as: 'shs' }.
  await dbService.delete('inventoryUnits', placeholderId, { as: 'shs' }).catch(() => {});

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
