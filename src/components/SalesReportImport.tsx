/**
 * SalesReportImport — preview-then-confirm importer for the 4-platform
 * SALES_REPORT.xlsx workbook (AMAZON / BM / EBAY / ONBUY). Mirrors the
 * InventoryReportImport flow so the operator's muscle memory carries:
 * upload → preview → confirm. Nothing writes to Firestore until the
 * preview is acknowledged.
 *
 * Parsing reuses `parseSalesWorkbook` from `lib/salesImport`, which
 * already understands the master file's per-sheet column layouts and
 * routes everything through `calcSaleFinancials` for the derived
 * financial fields. The ALL sheet our exporter writes (and any extra
 * sheets in the workbook) are silently ignored — only the 4 platform
 * sheets are consumed. Composite Sale ID
 * (`${marketplace}__${orderNumber}__${imei|sku|row}`) gives natural
 * upsert semantics so re-importing the same file is safe, while
 * keeping multiple phones on the same order as distinct docs.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2,
  PlusCircle, RefreshCw, AlertCircle, ArrowUpRight,
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import type { Sale, Marketplace, ReturnCategory } from '../types';
import { MARKETPLACES } from '../types';
import { parseSalesWorkbook, type ParsedSales } from '../lib/salesImport';
import { buildPostImportSyncPatches } from '../services/salesService';
import { addSoldUnitFromSale, completeUnitBuyInfo, reconcileShsAfterFulfilment, decrementAccessoryStock, restoreUnitReturnFromImport, restoreAccessoryReturnFromImport, ensureSupplier } from '../services/inventoryService';
import { normalizeOperatorSku, parseBrandModelStorage } from '../lib/modelStorage';
import { buildCatalogIndex, canonicaliseModel } from '../lib/modelReconciliation';
import { normalizeBucketModel } from '../lib/modelStorage';
import { findModelNearMiss, type ModelNearMiss } from '../lib/modelNearMiss';
import { findSupplierNearMiss, type SupplierNearMiss } from '../lib/supplierNearMiss';
import type { ModelSeed } from '../lib/deviceCatalog';
import { SIM_TYPE_OPTIONS } from '../lib/unitConstants';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { auth, isAdmin } from '../lib/firebase';
import DeviceComboBox from './DeviceComboBox';
import { buildSupplierIndex, resolveSupplier } from '../lib/supplierIdentity';
import TemplateDownload, { SALES_TEMPLATES } from './TemplateDownload';

interface Props { onClose: () => void; }

// Shared with Add Stock / Bulk Order — keep the audit-completion row's
// colour + storage dropdowns on the same option set so a unit created
// here is indistinguishable from a normally-received one.
const COLOUR_PRESETS = ['Black', 'White', 'Grey', 'Blue', 'Gold', 'Green', 'Purple', 'Red', 'Cream', 'Silver'];
const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', 'Not Applicable'];

// Mirrors clientReport.ts's (unexported) returnTypeLabel — display text for
// the preview's return-restoration panels.
const RETURN_TYPE_LABELS: Record<ReturnCategory, string> = {
  returned_to_inventory: 'Back to Inventory',
  repair: 'In Repair',
  returned_to_supplier: 'To Supplier',
};

type Phase = 'upload' | 'preview' | 'loading' | 'done';

export interface PreviewBuckets {
  total: number;
  perSheet: Record<Marketplace, number>;
  toCreate: ParsedSales['sales'];   // composite ID not seen in DB
  toUpdate: ParsedSales['sales'];   // composite ID already in DB
  invalid:  ParsedSales['errors'];  // parser-side validation failures
  duplicatesInFile: { id: string; rows: number[] }[];
  /** Inventory-side side effect of confirming this import: for every
   *  non-voided sale whose IMEI matches a currently-in-stock unit, that
   *  unit will be flipped to `status: 'sold'` by buildPostImportSyncPatches.
   *  Surface this BEFORE the write so the operator sees the impact
   *  (round-5 follow-up: a 215 → 198 stock drop was confusing because
   *  the side effect was buried in code). */
  inventoryFlips: Array<{
    unitId: string;
    imei: string;
    model: string;
    saleOrderId: string;
    marketplace: Marketplace;
    salePrice: number;
  }>;
  /** Stale combined multi-IMEI docs already in the DB that the per-IMEI split
   *  rows in this upload supersede. The old parser stored every IMEI of a
   *  bulk order in ONE doc (imei field = "IMEI1 / IMEI2 / ..."); the new
   *  parser emits one doc per IMEI. Those combined docs share the order
   *  number with the split rows but have a different composite ID, so they'd
   *  linger as orphans (double-counting revenue + showing a 4-unit order as
   *  1-2 rows). We delete them on confirm so re-importing the same report is
   *  idempotent and self-healing. */
  staleCombined: Array<{ id: string; orderNumber: string; imei: string; salePrice: number }>;
  /** Sold records that aren't yet audit-complete and must be finished before
   *  the import can confirm. Two kinds:
   *    - orphan (existingUnitId undefined): the sale's IMEI has no inventory
   *      unit; one will be CREATED from the row's values.
   *    - matched-incomplete (existingUnitId set): a unit matches the IMEI but
   *      is missing audit fields (model / supplier / BP); it will be PATCHED.
   *  Each row is editable in the preview; Confirm is hard-blocked until every
   *  row's required fields are present (see auditRowMissing). */
  recordsToComplete: Array<AuditCompletionRow>;
  /** Voided sales in this upload whose linked unit will be restored to its
   *  return state on confirm — the Returns tab supplied a Return Type for
   *  them (see salesImport.ts's parseReturnsTab), so
   *  restoreUnitReturnFromImport can act without guessing. `alreadyRestored`
   *  means the matched unit is already in that returned/available state
   *  (a re-import of the same file, or the return was processed live since
   *  the last import) — still listed for visibility but confirm is a no-op
   *  for it. */
  returnsToRestore: Array<{
    saleId: string;
    imei: string;
    marketplace: Marketplace;
    orderNumber: string;
    returnType: ReturnCategory;
    existingUnitId?: string;
    alreadyRestored: boolean;
  }>;
  /** Accessory (no-IMEI) sales whose quantity must be added back to their
   *  pool on confirm — the rows that go from NOT voided to voided in THIS
   *  upload. Computed here, where both the stored doc and the incoming row
   *  are in hand; by confirm time the void has already been written, so the
   *  transition is no longer visible.
   *
   *  A row that arrives voided with NO stored sale behind it is deliberately
   *  excluded: nothing ever decremented the pool for it. That is exactly the
   *  post-wipe replay, where the Inventory Report has already restored the
   *  gross baseline and decrementAccessoryStock skips voided rows — adding
   *  the quantity there would overshoot by one return's worth. */
  accessoryReturnsToRestore: string[];
  /** Voided sales in this upload with NO Return Type available — either the
   *  workbook predates the Returns tab, or the operator never filled that
   *  row in. The Sale doc still imports voided (voidedAt/voidOutcome/
   *  voidReason land normally via the sale write), but the UNIT side is
   *  left untouched: never silently guessed, same caution as the rest of
   *  the returns write surface. Non-blocking — surfaced so the operator
   *  knows which units still need a manual Process Return. */
  returnsNeedingType: Array<{
    saleId: string;
    imei: string;
    marketplace: Marketplace;
    orderNumber: string;
  }>;
}

/** Editable row in the audit-completeness panel. */
export interface AuditCompletionRow {
  saleId: string;
  orderNumber: string;
  marketplace: Marketplace;
  salePrice: number;
  /** Set when an inventory unit already matches the IMEI (PATCH path);
   *  undefined for orphan sales (CREATE path). */
  existingUnitId?: string;
  /** IMEI/serial. Editable only for no-IMEI sales (imeiReadOnly=false);
   *  for everything else it's fixed from the sale. */
  imei: string;
  imeiReadOnly: boolean;
  sku: string;
  model: string;
  /** The model name as the FILE gave it, before parseBrandModelStorage split
   *  a brand off the front of it.
   *
   *  That split is right for a well-formed name and destructive for a
   *  misspelt one: "Samsung Galaxy A32" correctly becomes brand Samsung +
   *  model "Galaxy A32", but "iPhoen 13" matches no brand rule, so the
   *  generic fallback takes the first token as a brand LABEL and leaves the
   *  model as "13" — and a near-miss check run on "13" has nothing to work
   *  with. The suggestion is about what the operator typed, so it needs what
   *  the operator typed. */
  modelRaw: string;
  /** What the MATCHED unit already stores, when the IMEI resolved to one.
   *  These are what let the catalog gate tell "a name read back out of the
   *  database" apart from "a name typed into a spreadsheet" — only the second
   *  can create anything, and only the second is gated. */
  unitModel?: string;
  unitSupplierName?: string;
  colour: string;
  storage: string;
  simType: string;
  supplierName: string;
  buyPrice: number;
  /** Per-unit fulfilment source — operator picks Office Stock or SHS so the
   *  sold unit is classified and SHS stays filterable as its own component. */
  stockSource: 'office' | 'shs';
  /** Sale-level facts the panel can't edit (must be fixed in the sheet);
   *  used to show un-editable blockers. */
  saleDate: string;
}

/** Is this model name in the admin catalog?
 *
 *  `buildCatalogIndex` stores every entry twice — once under `brand||model`
 *  and once under a brand-less `||model` — precisely so a lookup can succeed
 *  without knowing the brand. The audit row carries only a model name, so the
 *  brand-less key is the one to use, and reusing the index keeps this on the
 *  same normalisation as the rest of the app instead of inventing a second. */
function catalogHasModel(catalogIndex: Map<string, string>, model: string): boolean {
  if (catalogIndex.size === 0) return true;   // no catalog loaded — cannot judge
  return catalogIndex.has(`||${normalizeBucketModel(model)}`);
}

/** Required-field audit check for a sold record. Returns the list of missing
 *  field labels — empty array means audit-complete. The single source of
 *  truth for both the preview's blocker list and the live Confirm gate. */
export interface KnownRefs {
  /** Admin model catalog, indexed by `buildCatalogIndex`. A row whose model
   *  is not in it is rejected. Omit to skip the check — callers that do not
   *  hold the catalog keep the pre-2026-08 presence-only behaviour rather
   *  than rejecting everything. */
  catalogIndex?: Map<string, string>;
  /** Supplier names already on file, lower-cased and trimmed. Same
   *  omit-to-skip rule. */
  supplierNames?: ReadonlySet<string>;
  /** Catalog model names in the catalog's OWN spelling. Used only to word the
   *  "did you mean…" recommendation on a held row — the gate itself decides
   *  with `catalogIndex`, which is normalised and cannot say what to type. */
  catalogModelNames?: string[];
  /** Supplier names in their own spelling, for the same reason: the gate
   *  compares lower-cased, but the suggestion has to be the real name. */
  supplierDisplayNames?: string[];
}

/** What the operator most likely MEANT on a row the gate is holding.
 *
 *  The gate rejects an unknown model or supplier, which is right — a typo must
 *  not be able to mint a second catalog entry under a name one character off
 *  the real one. But a rejection with no way forward invites the worst
 *  available fix: adding "iPhoen 13" to the catalog so the row goes through.
 *  So say what the near match is, and let one click take it.
 *
 *  Recommendation, never automatic correction. "MHL" and "MKL" really could be
 *  two different companies, and only the operator knows. */
export function suggestRowFixes(
  r: {
    model: string; supplierName: string; modelRaw?: string;
    unitModel?: string; unitSupplierName?: string;
  },
  known: KnownRefs = {},
): { model: ModelNearMiss | null; supplier: SupplierNearMiss | null } {
  const modelName = (r.model || '').trim();
  const supplier = (r.supplierName || '').trim();
  // Nothing to correct on a value the database itself supplied and the gate is
  // therefore letting through — "did you mean" on a matched unit's own legacy
  // spelling is an invitation to rename stock from a sales import. Judged per
  // FIELD, not per row: a matched unit can carry a legacy model that is fine
  // and still have had a bad supplier typed over it.
  const modelIsStored = Boolean(modelName && r.unitModel)
    && normalizeBucketModel(modelName) === normalizeBucketModel(r.unitModel!);
  const supplierIsStored = Boolean(supplier && r.unitSupplierName)
    && supplier.toLowerCase() === r.unitSupplierName!.trim().toLowerCase();
  // Try the row's model, then the name the file actually carried. They differ
  // exactly when parseBrandModelStorage ate an unrecognised first token as a
  // brand — which is the misspelt case, i.e. the one this exists for.
  const modelCandidates = [modelName, (r.modelRaw || '').trim()]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
  const modelHit = known.catalogIndex && known.catalogModelNames
    && modelName && !modelIsStored && !catalogHasModel(known.catalogIndex, modelName)
    ? modelCandidates
        .map(c => findModelNearMiss(c, known.catalogModelNames!))
        .find(Boolean) ?? null
    : null;
  return {
    model: modelHit,
    supplier:
      supplier.length >= 2 && !supplierIsStored
      && known.supplierNames && known.supplierDisplayNames
      && !known.supplierNames.has(supplier.toLowerCase())
        ? findSupplierNearMiss(supplier, known.supplierDisplayNames)
        : null,
  };
}

export function auditRowMissing(r: {
  imei: string; model: string; supplierName: string;
  buyPrice: number; salePrice: number; saleDate: string;
  marketplace: string; orderNumber: string;
  /** The model and supplier the MATCHED inventory unit already carries, when
   *  the IMEI resolved to one. Absent on an orphan, which has no unit yet and
   *  is therefore always gated. See the catalog check below for why these
   *  exempt a row. */
  unitModel?: string; unitSupplierName?: string;
}, known: KnownRefs = {}): string[] {
  const missing: string[] = [];
  // The gate checks PRESENCE of required audit fields, plus — for IMEI —
  // that what's present actually looks like a real device identifier.
  // Placeholder text ("GENERIC", "not mentioned in App") or the pre-splitter
  // legacy combined-serial format ("SERIAL1 / SERIAL2") satisfied a bare
  // presence check, letting an operator complete the row without ever
  // supplying a usable IMEI — the record then sits in the database
  // permanently unmatchable. Same validator the Inventory importer already
  // uses at unit creation time, run here too so the gap can't reopen.
  const imei = (r.imei || '').trim();
  if (!imei) missing.push('IMEI');
  else if (!isValidImei(imei, { isAppleSerial: isAppleDevice(r.model) })) missing.push('IMEI (invalid format)');
  if (!(r.model || '').trim()) missing.push('model');
  // At least two characters. A single letter is a half-typed name, not a
  // supplier, and treating it as complete let the row satisfy the audit gate
  // mid-word — so an interrupted keystroke could be confirmed as real data.
  if ((r.supplierName || '').trim().length < 2) missing.push('supplier');
  if (!(Number(r.buyPrice) > 0)) missing.push('buy price');
  if (!(Number(r.salePrice) > 0)) missing.push('sale price');
  if (!(r.saleDate || '').trim()) missing.push('sale date');
  if (!(r.marketplace || '').trim()) missing.push('marketplace');
  if (!(r.orderNumber || '').trim()) missing.push('order number');

  // PRESENT IS NOT THE SAME AS KNOWN.
  //
  // Everything above asks whether a field was filled in. That let a typo
  // through: "iPhoen 13" is present, well-formed, and mints a unit under a
  // model nobody stocks — invisible in every model-grouped report thereafter.
  // A supplier invented at the keyboard did the same to the supplier reports.
  //
  // Every other route into inventory is already gated to the admin catalog
  // (the strict DeviceComboBox on Add Stock). Import was the exception, and
  // it is the one route where data arrives in bulk.
  //
  // Both checks are skipped when the caller does not supply the reference
  // data, so a caller without the catalog to hand degrades to the old
  // presence-only gate rather than rejecting every row.
  // A MATCHED UNIT'S OWN NAMES ARE NOT FREE TEXT, AND MUST NOT BE GATED.
  //
  // The check exists to stop a name TYPED INTO A FILE creating a unit or a
  // catalog entry nobody vetted. When the IMEI already resolves to a unit in
  // inventory, the model and supplier on this row were read back OUT of the
  // database — nothing is being created, and the value is by definition one
  // the business already holds.
  //
  // Gating those too was a real and immediately visible failure: on the
  // operator's first live upload, 131 of 132 rows blocked, most of them units
  // already in stock whose models predate the catalog and are spelled the old
  // way ("IPAD 11TG GEN"). The import became unusable, and the only way out
  // would have been to add every legacy spelling to the catalog — which is the
  // exact duplication this gate is supposed to prevent.
  //
  // Cleaning up legacy names is real work, but a SALES import is the wrong
  // place to force it: the sale is not what introduced the name. So the check
  // is skipped only while the value is UNCHANGED from what the unit already
  // carries; edit the field to something new and the gate applies again.
  const unchanged = (typed: string, stored: string | undefined, fold: (s: string) => string) =>
    Boolean(stored) && fold(typed) === fold(stored!);

  const modelName = (r.model || '').trim();
  if (modelName && known.catalogIndex
      && !unchanged(modelName, r.unitModel, normalizeBucketModel)
      && !catalogHasModel(known.catalogIndex, modelName)) {
    missing.push('model not in catalog');
  }
  const supplier = (r.supplierName || '').trim();
  if (supplier.length >= 2 && known.supplierNames
      && !unchanged(supplier, r.unitSupplierName, s => s.trim().toLowerCase())
      && !known.supplierNames.has(supplier.toLowerCase())) {
    missing.push('supplier not on file');
  }
  return missing;
}

export function buildPreview(
  parsed: ParsedSales,
  existingSales: Sale[],
  units: ReturnType<typeof useInventoryStore>['units'],
  /** Admin model catalog. Optional so existing callers/tests keep working;
   *  when supplied, seeded model names are snapped to the catalog spelling
   *  the same way InventoryReportImport already does. */
  models: ModelSeed[] = [],
): PreviewBuckets {
  // Snap every seeded model name to the admin catalog on the way in, so the
  // data arrives consistent instead of needing a cleanup pass afterwards —
  // the same treatment InventoryReportImport gives units. Unknown models
  // pass through exactly as parsed.
  const catalogIndex = buildCatalogIndex(models);
  // Reference data the audit gate rejects against. Suppliers come from the
  // units already on file — buildPreview is not handed the suppliers
  // collection, and the names on existing stock are the same set in practice.
  const knownSupplierNames = new Set(
    units.map(u => (u.supplierName || '').trim().toLowerCase()).filter(Boolean),
  );
  const knownRefs: KnownRefs = {
    catalogIndex,
    // Only gate on suppliers once some exist; an empty set on a fresh
    // database would reject every row with no way to satisfy it.
    supplierNames: knownSupplierNames.size > 0 ? knownSupplierNames : undefined,
    catalogModelNames: models.map(m => m.model).filter(Boolean),
    supplierDisplayNames: Array.from(
      new Map(units.map(u => [(u.supplierName || '').trim().toLowerCase(), (u.supplierName || '').trim()]))
        .values(),
    ).filter(Boolean),
  };
  const existingIds = new Set(existingSales.map(s => s.id));
  const toCreate: ParsedSales['sales'] = [];
  const toUpdate: ParsedSales['sales'] = [];

  // File-internal dupes — same composite ID appearing more than once in
  // the upload. Surfaces operator-side data corruption (same order number
  // re-pasted under two sheets) before it lands in the DB.
  const seenInFile = new Map<string, number>();
  const dupes: PreviewBuckets['duplicatesInFile'] = [];
  for (const s of parsed.sales) {
    const count = (seenInFile.get(s.id) ?? 0) + 1;
    seenInFile.set(s.id, count);
  }
  for (const [id, count] of seenInFile.entries()) {
    if (count > 1) dupes.push({ id, rows: [count] });
  }

  // First occurrence wins so the upload count matches what'll actually
  // land in Firestore.
  const firstSeen = new Set<string>();
  for (const s of parsed.sales) {
    if (firstSeen.has(s.id)) continue;
    firstSeen.add(s.id);
    if (existingIds.has(s.id)) toUpdate.push(s);
    else                       toCreate.push(s);
  }

  // Inventory-flip dry run — mirror buildPostImportSyncPatches' filter
  // (non-voided + matching IMEI + unit not already sold/returned/incoming)
  // so what the preview shows is exactly what the post-import sync will
  // do. Keep the formula in one place by replicating the gate literally
  // here; a regression test pins them in sync.
  const unitsByImei = new Map<string, typeof units[number]>();
  for (const u of units) {
    const k = (u.imei || '').trim().toUpperCase();
    if (k && !unitsByImei.has(k)) unitsByImei.set(k, u);
  }
  const inventoryFlips: PreviewBuckets['inventoryFlips'] = [];
  const seenUnitIds = new Set<string>();
  for (const s of [...toCreate, ...toUpdate]) {
    if (s.voidedAt) continue;
    const imeiKey = (s.imei || '').trim().toUpperCase();
    if (!imeiKey) continue;
    const u = unitsByImei.get(imeiKey);
    if (!u) continue;
    // Mirror buildPostImportSyncPatches exactly: returned units are skipped
    // (re-sale cycle), already-sold units are no-ops, but SHS / incoming
    // units DO flip — selling supplier-held stock fulfils it.
    if (u.status === 'returned') continue;
    if (u.status === 'sold') continue;     // already sold — not a flip
    if (seenUnitIds.has(u.id)) continue;   // one row per unit
    seenUnitIds.add(u.id);
    inventoryFlips.push({
      unitId: u.id,
      imei: u.imei || '',
      model: u.model || '—',
      saleOrderId: s.orderNumber || '',
      marketplace: s.marketplace,
      salePrice: s.salePrice ?? 0,
    });
  }

  // Stale combined multi-IMEI docs to purge. The new parser splits a bulk
  // order's IMEI cell into one doc per IMEI, but any combined doc written by
  // the OLD parser (imei field still holds "IMEI1 / IMEI2 / ...") keeps a
  // different composite ID and would linger as an orphan. Target only orders
  // present in THIS upload, and only docs whose stored IMEI actually contains
  // a "/" (the unmistakable signature of the legacy combined form) — single-
  // IMEI sales are never touched.
  // Stale legacy docs to purge. Two stale shapes are targeted:
  //  (a) IMEI contains "/" — the original combined form from the pre-splitter
  //      parser (one doc holding all IMEIs of a bulk order separated by " / ").
  //  (b) IMEI is blank — duplicates created by an earlier import attempt where
  //      a bulk-order row arrived with the IMEI cell missing (the parser
  //      fell back to a source-row discriminator, producing N indistinguishable
  //      docs per order). Confirmed in the field: orders 026-6081380-8104355
  //      with 2 rows and 204-0877891-0211532 with 4 rows, all blank-IMEI.
  //
  // Either way: when the same order has per-IMEI rows in the NEW upload, the
  // legacy ones are stale. Restrict deletion to orders covered by this
  // upload, never delete a doc we're rewriting, and skip orphan blank rows
  // when the new upload has nothing better for that order (otherwise the
  // operator would lose a partial record).
  const importedOrderKeys = new Set(
    parsed.sales
      .filter(s => s.orderNumber)
      .map(s => `${s.marketplace}__${(s.orderNumber || '').trim()}`),
  );
  // For the blank-IMEI gate: only purge a legacy blank-IMEI doc when the
  // upload provides at least one DIFFERENT (per-IMEI) replacement for that
  // order. Built from the upload set; sale.imei here is the per-IMEI form
  // emitted by the splitter, so a non-empty IMEI means "real replacement".
  const ordersWithReplacements = new Set<string>();
  for (const s of parsed.sales) {
    if ((s.imei || '').trim()) {
      ordersWithReplacements.add(`${s.marketplace}__${(s.orderNumber || '').trim()}`);
    }
  }
  // IDs we're about to (re)write — never delete a doc we're also writing.
  const writingIds = new Set([...toCreate, ...toUpdate].map(s => s.id));
  const staleCombined: PreviewBuckets['staleCombined'] = [];
  for (const ex of existingSales) {
    const imei = (ex.imei || '').trim();
    const isCombined = imei.includes('/');
    const isBlank = imei === '';
    if (!isCombined && !isBlank) continue;                   // single-IMEI doc — never touch
    const key = `${ex.marketplace}__${(ex.orderNumber || '').trim()}`;
    if (!importedOrderKeys.has(key)) continue;               // order not in this upload
    if (writingIds.has(ex.id)) continue;                     // being rewritten, keep
    if (isBlank && !ordersWithReplacements.has(key)) continue; // no per-IMEI replacement → keep
    staleCombined.push({
      id: ex.id,
      orderNumber: ex.orderNumber || '',
      imei: imei || '(blank)',
      salePrice: ex.salePrice ?? 0,
    });
  }

  // Audit-completeness scan. Every NON-VOIDED sale that will be marked sold
  // must produce a record carrying the full audit schema (IMEI, model,
  // supplier, BP, SP, date, marketplace, order, linked unit). Two kinds of
  // record need completion before confirm:
  //   - orphan: the IMEI has no inventory unit → CREATE one from the row.
  //   - matched-incomplete: a unit matches but is missing model / supplier /
  //     BP → PATCH it.
  // Matched units that are already complete just flip (inventoryFlips) and
  // don't appear here. Deduped by IMEI. Scoped to DEVICE sales — a sale with
  // no IMEI (accessory / data not yet entered) isn't a unit-tracked record,
  // so it's out of the audit gate; only IMEI-bearing sales must resolve to a
  // complete inventory unit.
  const recordsToComplete: AuditCompletionRow[] = [];
  const seenAuditKey = new Set<string>();
  for (const s of [...toCreate, ...toUpdate]) {
    if (s.voidedAt) continue;
    const imeiKey = (s.imei || '').trim().toUpperCase();
    if (!imeiKey) continue;                    // non-device sale — out of scope
    if (seenAuditKey.has(imeiKey)) continue;

    const matched = unitsByImei.get(imeiKey);
    // Defaults: a matched unit's own buy-side data, falling back to the sale.
    // Model NEVER defaults to a raw OPERATOR CODE (e.g. "ASI-SG-A24-128") —
    // the operator picks a clean model from the catalog in the preview. If
    // the SKU normalises to a known clean name we seed that (likely matches
    // a catalog entry). normalizeOperatorSku itself bails on anything
    // containing whitespace, on the assumption that a spaced-out string is
    // already a real name rather than a dash-delimited code — that's exactly
    // what our own Sales Report export writes into the SKU column (e.g.
    // "Samsung Galaxy A32 64GB"), so a downloaded-then-reimported file must
    // use it as-is rather than leaving every row blank. Anything else (no
    // match, no space) leaves it blank so the strict picker forces a
    // deliberate selection. The raw SKU is still preserved separately on
    // `sku` for provenance.
    const rawSku = (s.sku || '').trim();
    // Precedence: the matched unit's own model, then the file's MODEL column,
    // then whatever can be recovered from the SKU. The Model column comes
    // second rather than first because a matched unit is what the database
    // already believes and the file must not silently rewrite it; it comes
    // ahead of the SKU because it is the column actually named Model, and an
    // operator file routinely carries a product code in SKU and the real name
    // there. Before it was read, those rows arrived blank.
    const seededModel = (matched?.model || (s.model || '').trim()
      || normalizeOperatorSku(rawSku) || (/\s/.test(rawSku) ? rawSku : '') || '').trim();
    // Run the seed through the same pipeline the inventory importer uses:
    //   1. parseBrandModelStorage — splits the brand off, lifts the storage
    //      out into its own field, and re-separates a qualifier that got
    //      fused onto the model number ("S205G" → "Galaxy S20 5G"). Without
    //      this the seed keeps shapes like "Samsung Galaxy A32 64GB", whose
    //      trailing storage stops it matching the catalog entry at all.
    //   2. canonicaliseModel — snaps to the admin catalog's spelling.
    // Both are no-ops for a name that is already clean and uncatalogued, so
    // an unknown device still imports exactly as parsed.
    const parsedSeed = parseBrandModelStorage(seededModel);
    const model = seededModel
      ? canonicaliseModel(parsedSeed.model || seededModel, parsedSeed.brand || '', catalogIndex)
      : '';
    // What this row STARTED with, when the IMEI resolved to a real unit.
    //
    // It is the model AFTER the pipeline above, not the unit's raw string,
    // and the difference is the whole point. Comparing the row's parsed model
    // against the unit's raw one fails the moment the parse actually does
    // something — and it usually does: a great deal of legacy stock carries
    // its storage inside the model ("SAMSUNG GALAXY A32 64GB"), which step 1
    // lifts out into its own field. The row then reads "GALAXY A32", the unit
    // still reads "SAMSUNG GALAXY A32 64GB", and a raw comparison calls that
    // an edit by the operator when nothing was edited at all.
    //
    // Taking the derived value makes the two sides like-for-like: unchanged
    // at build time, and different the moment the operator actually types
    // something, which is exactly when the gate should come back.
    const unitModel = matched ? model : undefined;
    const supplierName = (matched?.supplierName || s.supplierName || '').trim();
    const buyPrice = matched?.buyPrice ?? s.buyPrice ?? 0;
    // Colour / storage precedence: the matched unit, then whatever the FILE
    // carried. Our own export writes Storage + Colour onto the marketplace
    // tabs from 2026-08, so a report exported from this app and re-imported
    // restores both without the operator retyping them — the round trip is
    // self-healing. Older files simply don't have the columns and fall
    // through exactly as before.
    const colour = (matched?.colour && matched.colour !== 'Unknown' ? matched.colour : '')
      || (s.colour || '').trim();
    // Storage also has a SKU fallback: step 1 lifted it off the SKU, so an
    // ORPHAN row (no matched unit) no longer arrives with the storage blank
    // just because nothing in inventory could supply it.
    const storage = matched?.storage || (s.storage || '').trim() || parsedSeed.storage || '';
    const simType = matched?.simType || '';

    const missing = auditRowMissing({
      imei: s.imei || '', model, supplierName, buyPrice,
      salePrice: s.salePrice ?? 0, saleDate: s.saleDate || '',
      marketplace: s.marketplace, orderNumber: s.orderNumber || '',
      unitModel,
      unitSupplierName: matched?.supplierName || undefined,
    }, knownRefs);

    // A matched, already-complete unit needs no completion row — it just
    // flips. Only surface matched units when something's missing. Orphans
    // (no matched unit) ALWAYS need a row (a unit must be created).
    if (matched && missing.length === 0) continue;

    seenAuditKey.add(imeiKey);
    const imeiTrimmed = (s.imei || '').trim();
    recordsToComplete.push({
      saleId: s.id,
      orderNumber: s.orderNumber || '',
      marketplace: s.marketplace,
      salePrice: s.salePrice ?? 0,
      existingUnitId: matched?.id,
      imei: imeiTrimmed,
      // Locked when the source file's IMEI is already a real identifier —
      // nothing to fix. Unlocked when it's malformed (placeholder text,
      // legacy combined-serial format, a typo), so the operator can actually
      // correct it here instead of being stuck against a row that can never
      // pass the format check above.
      imeiReadOnly: isValidImei(imeiTrimmed, { isAppleSerial: isAppleDevice(model) }),
      sku: s.sku || '',
      model,
      modelRaw: seededModel,
      unitModel,
      unitSupplierName: matched?.supplierName || undefined,
      colour,
      storage,
      simType,
      supplierName,
      buyPrice,
      // Matched units (IMEI already in inventory) are office stock by
      // definition — auto, no operator input. Orphans default to office but
      // the operator can flip to SHS in the panel (supplier-held unit never
      // tracked in our system).
      stockSource: matched?.stockSource ?? 'office',
      saleDate: s.saleDate || '',
    });
  }

  // Return restoration dry run — every voided sale in this upload whose
  // Returns Detail tab row supplied a Return Type gets a unit-side restore
  // on confirm (restoreUnitReturnFromImport). A voided sale with no Return
  // Type still imports fine (the Sale doc carries voidedAt regardless) —
  // it just can't safely touch the unit, so it's split into its own
  // non-blocking bucket instead. Deduped by sale id, same as the other
  // scans. Keyed by marketplace + IMEI — the Returns Detail sheet is
  // unit-scoped (one row per unit's latest cycle) and carries no Order
  // Number to join on.
  const returnRowByKey = new Map<string, ParsedSales['returnRows'][number]>();
  for (const r of parsed.returnRows ?? []) {
    const key = `${r.marketplace}__${(r.imei || '').trim().toUpperCase()}`;
    returnRowByKey.set(key, r);
  }
  const existingSaleById = new Map(existingSales.map(s => [s.id, s]));
  const accessoryReturnsToRestore: string[] = [];
  for (const s of [...toCreate, ...toUpdate]) {
    if (!s.voidedAt) continue;
    if ((s.imei || '').trim()) continue;          // has a unit — the IMEI path below
    if (!(s.sku || '').trim()) continue;
    const stored = existingSaleById.get(s.id);
    if (!stored || stored.voidedAt) continue;     // never decremented, or already restored
    accessoryReturnsToRestore.push(s.id);
  }

  const returnsToRestore: PreviewBuckets['returnsToRestore'] = [];
  const returnsNeedingType: PreviewBuckets['returnsNeedingType'] = [];
  const seenReturnSaleId = new Set<string>();
  for (const s of [...toCreate, ...toUpdate]) {
    if (!s.voidedAt) continue;
    if (seenReturnSaleId.has(s.id)) continue;
    seenReturnSaleId.add(s.id);
    const imeiKey = (s.imei || '').trim().toUpperCase();
    if (!imeiKey) continue; // no unit to restore without an IMEI
    const orderNumber = s.orderNumber || '';
    const existingUnit = unitsByImei.get(imeiKey);
    const key = `${s.marketplace}__${imeiKey}`;
    const returnType = returnRowByKey.get(key)?.returnType;
    if (!returnType) {
      returnsNeedingType.push({ saleId: s.id, imei: imeiKey, marketplace: s.marketplace, orderNumber });
      continue;
    }
    const alreadyRestored = !!existingUnit && existingUnit.status !== 'sold' && existingUnit.returnType === returnType;
    returnsToRestore.push({
      saleId: s.id, imei: imeiKey, marketplace: s.marketplace, orderNumber,
      returnType, existingUnitId: existingUnit?.id, alreadyRestored,
    });
  }

  return {
    total: parsed.sales.length,
    accessoryReturnsToRestore,
    perSheet: parsed.perSheetCounts,
    toCreate,
    toUpdate,
    invalid: parsed.errors,
    duplicatesInFile: dupes,
    inventoryFlips,
    staleCombined,
    recordsToComplete,
    returnsToRestore,
    returnsNeedingType,
  };
}

/**
 * Is this failure Firestore refusing work because the project's daily free-tier
 * allowance is spent, rather than anything wrong with the import?
 *
 * It matters because the two demand OPPOSITE responses. Every other failure
 * says "fix it and press Load again"; this one says "pressing Load again will
 * fail identically and spend tomorrow's allowance too". Shown Google's raw
 * text — several lines of quota-metric names and a project number — an
 * operator reasonably reads it as a glitch and retries, which is precisely the
 * loop it needs to break.
 *
 * Matched on the gRPC status name and on the message, since the SDK surfaces
 * this as a bare message string on a batch commit rather than a typed code.
 */
export function isQuotaError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('resource-exhausted')
    || m.includes('resource_exhausted')
    || m.includes('quota exceeded')
    || m.includes('quota limit exceeded');
}

export default function SalesReportImport({ onClose }: Props) {
  const { sales, units, suppliers, models } = useInventoryStore();
  /** Reference data the audit gate rejects unknown models and suppliers
   *  against. Computed ONCE here and passed to PreviewPhase rather than
   *  derived in both: two derivations of "what counts as known" could
   *  disagree, and the disagreement would show as a Confirm button that
   *  stays disabled with no row explaining why. */
  /** Models and suppliers an admin has created from INSIDE this preview.
   *
   *  Held rows have to be released the moment the missing name exists, with no
   *  re-upload — that is the whole point of being able to add it from here. The
   *  store's own list is the authority, but it refreshes on its own schedule,
   *  and a gate that keeps blocking for a second or two after the admin has
   *  visibly added the model reads as the button not having worked. Merged in
   *  below so the release is immediate and does not depend on that timing.
   *
   *  Held in the PARENT, not in the preview panel: the same missing model
   *  usually appears on several rows, and adding it once must free all of
   *  them. */
  const [justCreatedModels, setJustCreatedModels] = useState<ModelSeed[]>([]);
  const [justCreatedSuppliers, setJustCreatedSuppliers] = useState<string[]>([]);

  const knownRefs = useMemo<KnownRefs>(() => {
    const supplierNames = [
      ...suppliers.map(x => (x.name || '').trim()),
      ...justCreatedSuppliers,
    ].filter(Boolean);
    const names = new Set(supplierNames.map(n => n.toLowerCase()));
    const catalogModels = [
      ...models.map(m => ({ brand: m.brand, model: m.model })),
      ...justCreatedModels.map(m => ({ brand: m.brand, model: m.model })),
    ].filter(m => m.model);
    return {
      catalogIndex: buildCatalogIndex(catalogModels),
      // Skip the supplier check entirely until some exist — on a fresh or
      // just-wiped database an empty set would reject every row with no way
      // to satisfy it.
      supplierNames: names.size > 0 ? names : undefined,
      catalogModelNames: catalogModels.map(m => m.model),
      supplierDisplayNames: supplierNames,
    };
  }, [models, suppliers, justCreatedModels, justCreatedSuppliers]);
  const userIsAdmin = isAdmin(auth.currentUser);

  /** Add a model to the admin catalogue without leaving the import.
   *
   *  Admin-only, and it has to be: this is the one route that can put a name
   *  into the catalogue in bulk-import context, and the catalogue is the thing
   *  every other intake path is gated against. An employee facing an unknown
   *  model is meant to reach an admin, not to invent the entry that makes
   *  their row go through. */
  const createModel = userIsAdmin ? async (draft: { brand: string; model: string }) => {
    const id = `model_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await dbService.create('models', id, {
      brand: draft.brand,
      model: draft.model,
      ownerId: 'shared',
      createdAt: new Date().toISOString(),
      createdBy: auth.currentUser?.email || 'admin',
    });
    setJustCreatedModels(prev => [...prev, { id, brand: draft.brand, model: draft.model }]);
    return {
      brand: draft.brand, model: draft.model, count: 0, latestDateIn: '',
      storages: [], colours: [], source: 'seed' as const,
    };
  } : undefined;

  /** Same, for a supplier the file names and the database has never seen.
   *
   *  Before this existed the message told the operator to go and add it in
   *  Admin — which means abandoning a preview they may have spent ten minutes
   *  correcting, since nothing about it survives the round trip. That is the
   *  kind of instruction people work around, and the workaround here is to
   *  bend the name onto an existing supplier so the row passes, which is
   *  exactly the corrupted ledger the gate exists to prevent.
   *
   *  ensureSupplier is idempotent by name, so a double-click or two rows
   *  naming the same new supplier resolve to one document. */
  const createSupplier = userIsAdmin ? async (name: string) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    await ensureSupplier(trimmed);
    setJustCreatedSuppliers(prev =>
      prev.some(n => n.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed]);
  } : undefined;
  const [phase, setPhase] = useState<Phase>('upload');
  const [parsed, setParsed] = useState<ParsedSales | null>(null);
  const [fileName, setFileName] = useState('');
  /** Progress for the write phase. `label` matters: the confirm does the bulk
   *  sales write FIRST and then loops per-unit over every audit row, and the
   *  indicator used to be wired only to the former. So after the sales landed
   *  the screen sat on a full bar reading "Writing 494 / 494 sales…" for the
   *  entire per-unit phase — minutes, on a phone — looking frozen while it was
   *  in fact working. Every phase now names itself and reports its own count. */
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>(
    { done: 0, total: 0, label: 'sales' },
  );
  /** Seconds the write phase has sat on the SAME progress reading.
   *
   *  A Firestore `batch.commit()` does not resolve until the server
   *  acknowledges the write, and it does NOT reject when the client loses its
   *  connection — the write is queued locally and the promise simply stays
   *  pending. The importer awaits that promise, so a stalled connection
   *  presents as an eternal spinner with no error: precisely the "forever
   *  loading" report. This counter resets on every tick of real progress, so a
   *  slow-but-working import never trips it, and only a genuinely stuck one
   *  crosses the threshold and gets explained on screen. */
  const [stalledSecs, setStalledSecs] = useState(0);
  useEffect(() => {
    if (phase !== 'loading') { setStalledSecs(0); return; }
    setStalledSecs(0);
    const t = setInterval(() => setStalledSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase, progress.done, progress.total, progress.label]);
  const [error, setError] = useState('');
  /** Counts populated after a successful import. `unitsMarkedSold` is
   *  the side-effect from the import → inventory sync (Bug B); shown
   *  on the Done screen so the operator sees the buy-side reconciled.
   *  `unitsAddedFromOrphanSales` counts the inventory rows the operator
   *  opted to auto-create from sales that had no matching IMEI.
   *  `staleDeleteFailed` counts stale-combined deletions that Firestore
   *  rules denied (e.g. non-admin user trying to delete sales) — surfaced
   *  to the operator so the Done screen doesn't lie about the cleanup. */
  /** Created/updated counts SNAPSHOTTED at confirm time. The preview memo
   *  recomputes off live `sales`, so by the time the Done screen renders
   *  every row already exists and it reported "0 created · N updated" for
   *  a file of brand-new sales. */
  /** Which marketplace this upload is. null = combined four-sheet workbook. */
  const [channel, setChannel] = useState<Marketplace | null>(null);
  const [writeStats, setWriteStats] = useState<{ created: number; updated: number; skipped: number }>(
    { created: 0, updated: 0, skipped: 0 },
  );
  const [syncStats, setSyncStats] = useState<{
    /** Incoming (supplier-held) units a sale fulfilled in this import. */
    shsFulfilled: number;
    shsPlaceholdersCleared: number;
    shsAggregatesDecremented: number;
    unitsMarkedSold: number;
    salesLinked: number;
    unitsAddedFromOrphanSales: number;
    unitsAddFailed: number;
    /** Specific IMEI + reason for each orphan that couldn't be auto-added.
     *  Surfaced on the Done screen so the operator knows exactly which
     *  sale needs a manual badge-click instead of seeing a vague count. */
    unitsAddFailedDetails: Array<{ imei: string; orderNumber: string; reason: string }>;
    staleDeleted: number;
    staleDeleteFailed: number;
    /** No-IMEI sale rows (chargers, SIM pins, ...) whose SKU matched an
     *  accessoryStock pool and were decremented. Every other no-IMEI row
     *  (no matching SKU) is silently out of scope, same as before. */
    accessoriesDecremented: number;
    /** No-IMEI sale rows arriving VOIDED whose SKU matched a pool and had
     *  their quantity added back (restoreAccessoryReturnFromImport). */
    accessoriesReturned: number;
    /** Units restored to their return state (returnType/returnDate/etc.)
     *  via restoreUnitReturnFromImport, keyed off preview.returnsToRestore. */
    unitsRestoredFromImport: number;
    unitsRestoreFailed: number;
    unitsRestoreFailedDetails: Array<{ imei: string; orderNumber: string; reason: string }>;
  }>({
    shsFulfilled: 0, shsPlaceholdersCleared: 0, shsAggregatesDecremented: 0, unitsMarkedSold: 0, salesLinked: 0,
    unitsAddedFromOrphanSales: 0, unitsAddFailed: 0, unitsAddFailedDetails: [], staleDeleted: 0, staleDeleteFailed: 0,
    accessoriesDecremented: 0, accessoriesReturned: 0, unitsRestoredFromImport: 0, unitsRestoreFailed: 0, unitsRestoreFailedDetails: [],
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [auditEdits, setAuditEdits] = useState<AuditCompletionRow[]>([]);

  // Deliberately excludes 'loading': the write-in-progress screen only
  // reads `progress` (see the phase === 'loading' block below), never
  // `preview`. sales/units are live store values that change on every
  // batch the bulk write commits, so keeping 'loading' in this condition
  // meant buildPreview() — an O(sales × units) match — reran on every
  // intermediate store update for the whole duration of the write, turning
  // a multi-thousand-row import into a many-second UI freeze for no benefit.
  const preview = useMemo(
    () => phase === 'preview' || phase === 'done'
      ? (parsed ? buildPreview(parsed, sales, units, models) : null)
      : null,
    // `models` belongs here: it arrives from its own Firestore subscription,
    // independently of sales/units. Leaving it out meant a preview computed
    // before the catalog resolved would keep a stale, un-snapped set of model
    // names and never recompute once it landed.
    [parsed, sales, units, models, phase],
  );
  // Acknowledgement gate — when the import would flip in-stock units to
  // 'sold' as a side effect, force the operator to tick a checkbox before
  // the Confirm button enables. Resets every time a new file is parsed
  // (the IMEI list changes) or the operator goes back to the upload step.
  const [flipsAcked, setFlipsAcked] = useState(false);
  React.useEffect(() => { setFlipsAcked(false); }, [parsed]);

  // Seed audit-completion rows whenever the preview's recordsToComplete list
  // changes (parsed a different file, or live sales/units state shifted). Each
  // row starts pre-filled from the matched unit (or the sale, for orphans) and
  // the operator completes the missing fields inline. Tracked by saleId so a
  // partial edit survives re-renders.
  const auditKey = preview?.recordsToComplete.map(o => o.saleId).sort().join('|') ?? '';
  React.useEffect(() => {
    if (!preview) { setAuditEdits([]); return; }
    setAuditEdits(prev => {
      const prevById = new Map(prev.map(p => [p.saleId, p]));
      return preview.recordsToComplete.map(o => prevById.get(o.saleId) ?? { ...o });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditKey]);

  // Hard-block gate: any audit-completion row still missing a required field
  // disables Confirm. Recomputed live from the operator's inline edits.
  const auditBlockers = auditEdits.filter(r => auditRowMissing(r, knownRefs).length > 0).length;

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const out = await parseSalesWorkbook(file, file.name, {
        onlyMarketplace: channel ?? undefined,
      });
      if (out.sales.length === 0 && out.errors.length === 0) {
        throw new Error(channel
          ? `No readable ${channel} rows in this file.`
          : 'No AMAZON / BM / EBAY / ONBUY sheets found in this workbook.');
      }
      if (out.sales.length === 0 && channel) {
        throw new Error(`No ${channel} rows parsed — check the header row matches the ${channel} layout.`);
      }
      setParsed(out);
      setPhase('preview');
    } catch (e: any) {
      setError(e?.message || 'Failed to read file');
    }
  };

  const handleConfirm = async () => {
    if (!preview || !parsed) return;
    setPhase('loading');
    setWriteStats({
      created: preview.toCreate.length,
      updated: preview.toUpdate.length,
      skipped: preview.invalid.length,
    });
    // Resolve every sale's supplier NAME to a supplier record before writing.
    //
    // The parser only ever produced supplierName — the Supplier column as
    // typed. Nothing downstream could group sales with the units that came
    // from the same supplier, because units key on supplierId. Analytics
    // grouped by `supplierId || 'unknown'` and dropped EVERY imported sale
    // into one catch-all row wearing the first sale's supplier name.
    //
    // Resolving here fixes it at the source rather than per screen: every
    // consumer, present and future, gets the id. Sales whose supplier isn't
    // in the catalog keep name-only attribution, which the display-side
    // resolver still handles.
    // Provenance for the Operations Hub's "Last Import" panel, and a batch id
    // on each sale that points at a row that actually exists.
    //
    // This used to stamp `inv-${Date.now()}` — a synthetic id with no matching
    // importBatches document, because createImportBatch was only ever called
    // by ImportModal, which is no longer rendered. So the audit field referred
    // to nothing and the panel read "No imports yet" after every import. The
    // id is minted first, stamped on every sale, and the batch row written
    // only once the sales land.
    const importBatchId = dbService.newImportBatchId();
    const supplierIndex = buildSupplierIndex(suppliers);
    const entries = [...preview.toCreate, ...preview.toUpdate].map(s => {
      const resolved = resolveSupplier(s, supplierIndex);
      return {
      collection: 'sales',
      id: s.id,
      data: {
        ...s,
        ...(resolved.known ? { supplierId: resolved.key } : {}),
        importBatchId,
        sourceFile: fileName,
        importedAt: new Date().toISOString(),
        // MUST be the literal 'shared' — firestore.rules gates every
        // sales create/update on ownsShared() (ownerId == 'shared').
        // Writing the user's UID here (the old value) made every import
        // write fail with "Missing or insufficient permissions". The
        // whole dataset is shared-team-owned; there is no per-user
        // ownership for sales.
        ownerId: 'shared',
      },
    };
    });
    setProgress({ done: 0, total: entries.length, label: 'sales' });
    // Names the phase currently running, purely so a throw can say WHERE it
    // died. The confirm does seven distinct things in sequence and every one
    // of them can fail; a bare "Missing or insufficient permissions" with no
    // stage attached is nearly impossible to act on.
    let stage = 'writing sales';
    try {
      await dbService.bulkCreate(entries, (done, total) => setProgress({ done, total, label: 'sales' }));
      // Purge stale combined multi-IMEI docs that the per-IMEI split rows
      // above supersede. Without this, re-importing a report whose bulk
      // orders were previously stored as one combined doc leaves orphans
      // (double-counted revenue + a 4-unit order rendering as 1-2 rows).
      // Deleting after the new rows land keeps the order's sales intact.
      //
      // firestore.rules grants `sales` delete to admin only — if the
      // importer isn't admin, the bulkDelete batches fail server-side.
      // bulkDelete reports the actual deleted/failed split so the Done
      // screen can show "N of M cleaned · K denied (admin required)".
      stage = 'purging superseded combined rows';
      let staleDeleted = 0;
      let staleFailed = 0;
      if (preview.staleCombined.length) {
        const res = await dbService.bulkDelete(
          preview.staleCombined.map(s => ({ collection: 'sales', id: s.id })),
        );
        staleDeleted = res.deleted;
        staleFailed = res.failed;
      }

      // Accessory stock — no-IMEI sale rows (chargers, SIM pins, cables) whose
      // SKU matches a pool consume it here. Scoped to preview.toCreate (brand
      // new sale docs) only — a re-import of the same file re-lands the same
      // sales as toUpdate, which must NOT decrement the pool a second time.
      // Every other no-IMEI row (no matching SKU) is a silent no-op, same as
      // before this feature existed.
      //
      // Grouped by SKU rather than one flat sequential loop: decrementAccessoryStock
      // does its own read-then-write against the pool doc, so two rows for the
      // SAME sku must still run one-after-another (interleaving would race on
      // a stale read and lose a decrement) — but rows for DIFFERENT skus touch
      // different docs and have no such race, so those groups run concurrently.
      // A large import with many accessory-sale lines spread across a handful
      // of skus previously serialized every single row end-to-end; grouping
      // collapses the wall-clock time to roughly the size of the biggest
      // single-sku group instead of the sum of all rows.
      stage = 'decrementing accessory stock';
      let accessoriesDecremented = 0;
      const accessoryRows = preview.toCreate.filter(s => !s.voidedAt && !(s.imei || '').trim() && (s.sku || '').trim());
      const accessoryRowsBySku = new Map<string, typeof accessoryRows>();
      for (const s of accessoryRows) {
        const key = (s.sku || '').trim();
        const bucket = accessoryRowsBySku.get(key);
        if (bucket) bucket.push(s); else accessoryRowsBySku.set(key, [s]);
      }
      await Promise.all(Array.from(accessoryRowsBySku.values()).map(async rows => {
        for (const s of rows) {
          const res = await decrementAccessoryStock(s.sku!, s.quantity || 1, {
            orderNumber: s.orderNumber, marketplace: s.marketplace,
          });
          if (res.matched) accessoriesDecremented++;
        }
      }));

      // The mirror image: an accessory row that arrives VOIDED (Return Date /
      // Outcome / Return Reason filled) has to put its quantity back.
      //
      // The parser already writes the void onto the Sale doc, so GP, the
      // Returns Summary and the Postage Loss column corrected themselves —
      // but nothing restored the pool, so the sale read "refunded" while the
      // stock stayed sold. It hid behind two things: decrementAccessoryStock
      // skips voided rows when replaying after a wipe, so a full wipe +
      // re-upload always produced the right number, and the manual Return
      // button on the Accessory Stock panel used to cover the live case until
      // it was removed in 2026-08.
      //
      // Which rows qualify is decided in buildPreview
      // (accessoryReturnsToRestore) and NOT re-derived here, because by this
      // point the void has already been written to the doc and the "was it
      // voided before?" transition is no longer visible. The gate is: a sale
      // already on file that was NOT voided and now is. A row that arrives
      // voided with no stored sale behind it is skipped — that is the
      // post-wipe replay, where the Inventory Report already restored the
      // gross baseline and decrementAccessoryStock skips voided rows, so
      // adding here would overshoot by one return's worth (caught by
      // e2eAccessoryReturnReconcile's full round trip: 53 instead of 50).
      // Grouped by sku for the same read-then-write reason as the decrement.
      stage = 'restoring accessory returns';
      let accessoriesReturned = 0;
      const toRestoreIds = new Set(preview.accessoryReturnsToRestore);
      const accessoryReturnRows = [...preview.toCreate, ...preview.toUpdate]
        .filter(s => toRestoreIds.has(s.id));
      const accessoryReturnsBySku = new Map<string, typeof accessoryReturnRows>();
      for (const s of accessoryReturnRows) {
        const key = (s.sku || '').trim();
        const bucket = accessoryReturnsBySku.get(key);
        if (bucket) bucket.push(s); else accessoryReturnsBySku.set(key, [s]);
      }
      await Promise.all(Array.from(accessoryReturnsBySku.values()).map(async rows => {
        for (const s of rows) {
          const res = await restoreAccessoryReturnFromImport(s);
          if (res.ok && !res.skipped) accessoriesReturned++;
        }
      }));

      // Audit completion — make every incomplete sold record whole using the
      // OPERATOR'S REVIEWED VALUES (auditEdits). Confirm is hard-blocked until
      // all rows are complete, so these should all succeed; failures are still
      // tallied defensively. Two paths:
      //   - existingUnitId set → PATCH the matched unit's buy-side fields
      //     (completeUnitBuyInfo); the sync below applies the sale fields.
      //   - existingUnitId unset → CREATE the unit from the sale + row
      //     (addSoldUnitFromSale), which also marks it sold + links the sale.
      // For a no-IMEI sale the operator typed an IMEI in the row; we patch the
      // sale's imei too so its audit record carries the device id.
      stage = 'creating / patching inventory units';
      let unitsAddedFromOrphanSales = 0;
      let orphanShsFulfilled = 0;
      let unitsAddFailed = 0;
      const unitsAddFailedDetails: Array<{ imei: string; orderNumber: string; reason: string }> = [];
      if (preview.recordsToComplete.length > 0) {
        const allImportedSales = [...preview.toCreate, ...preview.toUpdate];
        const saleById = new Map(allImportedSales.map(s => [s.id, s]));
        // Each row is its own round-trip, so this phase dominates the wall
        // clock on a large import — report it rather than leaving the sales
        // bar sitting at 100%.
        let auditDone = 0;
        setProgress({ done: 0, total: auditEdits.length, label: 'inventory units' });
        for (const row of auditEdits) {
          setProgress({ done: auditDone++, total: auditEdits.length, label: 'inventory units' });
          const sale = saleById.get(row.saleId);
          if (!sale) {
            unitsAddFailed++;
            unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: 'sale lookup failed (id missing)' });
            continue;
          }
          const stillMissing = auditRowMissing(row, knownRefs);
          if (stillMissing.length > 0) {
            unitsAddFailed++;
            unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: `missing ${stillMissing.join(', ')}` });
            continue;
          }
          const imei = row.imei.trim();
          let res;
          // Per-row isolation. Without it, ONE throwing row killed the whole
          // remaining pass: the exception escaped this loop, hit the confirm's
          // outer catch, and ran setPhase('preview') — so the operator was
          // dropped back on the audit screen with the rows after the failure
          // never created, which then legitimately re-appeared as still needing
          // completion on the next upload. That is the "I filled the supplier,
          // pressed Load, and got the same screen back" loop.
          //
          // A throw is genuinely reachable here even though the services return
          // result objects: addSoldUnitFromSale's own try/catch covers only its
          // two dbService writes, while reconcileShsAfterFulfilment and
          // logInventoryEvent run AFTER it and are unguarded. Either one
          // rejecting (rules, connection) throws straight past the result
          // contract — after the unit has already been written.
          //
          // Now a bad row is tallied like any other failure and the pass
          // carries on, so 449 good rows are never lost to one bad one.
          try {
            if (row.existingUnitId) {
              // PATCH the matched unit's buy-side info for audit completeness.
              res = await completeUnitBuyInfo({
                unitId: row.existingUnitId,
                model: row.model.trim(),
                colour: row.colour.trim() || undefined,
                storage: row.storage.trim() || undefined,
                simType: row.simType.trim() || undefined,
                supplierName: row.supplierName.trim(),
                buyPrice: row.buyPrice,
                stockSource: row.stockSource,
              });
            } else {
              // CREATE a sold unit from the sale + reviewed values. When the
              // sale had no IMEI, back-fill it onto the sale doc too.
              if (!row.imeiReadOnly && (sale.imei || '').trim() !== imei) {
                await dbService.update('sales', sale.id, { imei });
              }
              res = await addSoldUnitFromSale({
                sale: { ...(sale as Sale), imei },
                imei,
                model: row.model.trim(),
                colour: row.colour.trim() || undefined,
                storage: row.storage.trim() || undefined,
                simType: row.simType.trim() || undefined,
                supplierName: row.supplierName.trim(),
                buyPrice: row.buyPrice,
                stockSource: row.stockSource,
              });
            }
            if (res.ok) {
              unitsAddedFromOrphanSales++;
              // A supplier-shipped phone arrives as an ORPHAN — its IMEI is one
              // we have never seen, because the holding never had one. So this
              // path, not the IMEI-matching one, is where most SHS fulfilments
              // actually happen; counting only the latter reported zero while
              // supplier stock visibly dropped.
              if (res.shsFulfilled) orphanShsFulfilled++;
            } else {
              unitsAddFailed++;
              unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: res.message || res.error || 'unknown' });
            }
          } catch (rowErr: any) {
            console.error(`[sales import] row threw · ${row.imei} · ${row.orderNumber}:`, rowErr);
            unitsAddFailed++;
            unitsAddFailedDetails.push({
              imei: row.imei,
              orderNumber: row.orderNumber,
              reason: rowErr?.message || 'unexpected error',
            });
          }
        }
      }

      // Bug B sync — after sales land in Firestore, mark every matching
      // InventoryUnit as sold and link sale.unitId. Operator no longer
      // has to manually flip statuses to reconcile inventory with
      // imported sales. Skipped sales (voided, no-imei, returned/incoming
      // unit) are silently ignored, see buildPostImportSyncPatches docs.
      // The just-added orphan units are picked up here too — their sale
      // is already back-linked + status='sold', so the patch is a no-op
      // for them and the count below stays accurate to the in-stock
      // units that genuinely flipped.
      // Merge each parsed row OVER its stored doc before syncing. The
      // workbook has no void column, so a parsed row carries no voidedAt —
      // passing the raw rows made the "skip voided sales" guard blind to
      // returns processed since the last import. Stored-first spread keeps
      // voidedAt / voidOutcome while the fresh values still win.
      const storedById = new Map(sales.map(s => [s.id, s]));
      const allImported = [...preview.toCreate, ...preview.toUpdate]
        .map(s => ({ ...(storedById.get(s.id) ?? {}), ...s }) as Sale);
      stage = 'syncing sold flags back to inventory';
      const { unitPatches, salePatches, shsFulfilled } = buildPostImportSyncPatches(allImported, units);
      if (unitPatches.length || salePatches.length) {
        await dbService.bulkCreate([...unitPatches, ...salePatches]);
      }

      // SHS trail. Flipping an incoming unit to sold is only half the job:
      // the parser placeholder and the master-file aggregate that recorded
      // "the supplier is holding this" carry no IMEI, so nothing above can
      // reach them and they keep counting as stock we no longer have.
      // Same helper the orphan-completion path uses, so both agree.
      // Grouped by model+supplier for the same reason the accessory-decrement
      // loop below is: reconcileShsAfterFulfilment reads-then-writes a SHARED
      // aggregate/placeholder for that model+supplier pair ("only ONE closed
      // per fulfilment"), so two fulfilments of the same model+supplier must
      // stay sequential — but different model+supplier pairs touch different
      // docs and can run concurrently.
      let shsPlaceholdersCleared = 0;
      let shsAggregatesDecremented = 0;
      const shsFulfilledByKey = new Map<string, typeof shsFulfilled>();
      for (const f of shsFulfilled) {
        const key = `${(f.model || '').trim().toLowerCase()}__${(f.supplierName || '').trim().toLowerCase()}`;
        const bucket = shsFulfilledByKey.get(key);
        if (bucket) bucket.push(f); else shsFulfilledByKey.set(key, [f]);
      }
      await Promise.all(Array.from(shsFulfilledByKey.values()).map(async fs => {
        for (const f of fs) {
          const res = await reconcileShsAfterFulfilment({
            model: f.model,
            supplierName: f.supplierName,
            contextImei: f.unitId,
          });
          shsPlaceholdersCleared += res.placeholdersRemoved;
          shsAggregatesDecremented += res.aggregatesDecremented;
        }
      }));

      // Return restoration — replay each voided sale's return state onto its
      // unit (returnType/returnDate/status/etc.), matching processReturn's
      // write shape. Only for rows the preview already resolved a Return
      // Type for (preview.returnsNeedingType is left untouched here — never
      // guessed). Uses `allImported` (fresh parse merged over the stored
      // doc) so voidedAt/voidOutcome/voidReason are present even when this
      // sale already existed before the import.
      let unitsRestoredFromImport = 0;
      let unitsRestoreFailed = 0;
      const unitsRestoreFailedDetails: Array<{ imei: string; orderNumber: string; reason: string }> = [];
      stage = 'restoring returns';
      if (preview.returnsToRestore.length > 0) {
        const importedById = new Map(allImported.map(s => [s.id, s]));
        // Grouped by IMEI, same reasoning as above: a unit returned more than
        // once in the same import must restore its cycles in original order
        // (restoreUnitReturnFromImport's own multi-cycle guard depends on
        // oldest-to-newest ordering against a shared unit doc) — but rows for
        // DIFFERENT imeis touch different docs and can run concurrently.
        const rowsByImei = new Map<string, typeof preview.returnsToRestore>();
        for (const row of preview.returnsToRestore) {
          const key = (row.imei || '').trim().toUpperCase() || `__saleid_${row.saleId}`;
          const bucket = rowsByImei.get(key);
          if (bucket) bucket.push(row); else rowsByImei.set(key, [row]);
        }
        await Promise.all(Array.from(rowsByImei.values()).map(async rows => {
          for (const row of rows) {
            const sale = importedById.get(row.saleId);
            if (!sale) {
              unitsRestoreFailed++;
              unitsRestoreFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: 'sale lookup failed (id missing)' });
              continue;
            }
            const res = await restoreUnitReturnFromImport({ sale, returnType: row.returnType });
            if (res.ok) {
              unitsRestoredFromImport++;
            } else {
              unitsRestoreFailed++;
              unitsRestoreFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: res.message || res.error || 'unknown' });
            }
          }
        }));
      }

      setSyncStats({
        shsFulfilled: shsFulfilled.length + orphanShsFulfilled,
        shsPlaceholdersCleared,
        shsAggregatesDecremented,
        unitsMarkedSold: unitPatches.length,
        salesLinked: salePatches.length,
        unitsAddedFromOrphanSales,
        unitsAddFailed,
        unitsAddFailedDetails,
        staleDeleted,
        staleDeleteFailed: staleFailed,
        accessoriesDecremented,
        accessoriesReturned,
        unitsRestoredFromImport,
        unitsRestoreFailed,
        unitsRestoreFailedDetails,
      });
      // Written last, and only on success — see the note where importBatchId
      // is minted.
      if (entries.length > 0) {
        await dbService.createImportBatch({
          id: importBatchId,
          sourceFile: fileName || 'Sales Report',
          rowCount: entries.length,
          notes: `${preview.toCreate.length} created · ${preview.toUpdate.length} updated`,
        });
      }
      setPhase('done');
    } catch (e: any) {
      console.error(`[sales import] failed while ${stage}:`, e);
      setError(`${e?.message || 'Import failed during write'} — failed while ${stage}.`);
      setPhase('preview');
    }
  };

  const resetToUpload = () => {
    setPhase('upload');
    setParsed(null);
    setFileName('');
    setError('');
    setProgress({ done: 0, total: 0, label: 'sales' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-6xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight">Import Sales Report</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              5-platform xlsx · upload → preview → confirm
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {phase === 'upload' && (
            <UploadPhase
              error={error}
              fileInputRef={fileInputRef}
              onPick={handleFile}
              channel={channel}
              onChannelChange={setChannel}
            />
          )}

          {phase === 'preview' && preview && (
            <PreviewPhase
              preview={preview}
              fileName={fileName}
              error={error}
              flipsAcked={flipsAcked}
              onAckChange={setFlipsAcked}
              auditEdits={auditEdits}
              onAuditEdit={(saleId, patch) => {
                setAuditEdits(prev => prev.map(o => o.saleId === saleId ? { ...o, ...patch } : o));
              }}
              units={units}
              suppliers={suppliers}
              isAdmin={userIsAdmin}
              knownRefs={knownRefs}
              justCreatedModels={justCreatedModels}
              onCreateModel={createModel}
              onCreateSupplier={createSupplier}
            />
          )}

          {phase === 'loading' && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 size={32} className="animate-spin text-emerald-600" />
              <p className="text-[12px] font-bold">
                Writing {progress.done.toLocaleString()} / {progress.total.toLocaleString()} {progress.label}…
              </p>
              <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
                />
              </div>
              {stalledSecs >= 20 && (
                <div className="mt-3 w-full max-w-sm rounded-lg border border-amber-300 bg-amber-50 p-3 text-left">
                  <p className="text-[11px] font-black text-amber-900">
                    No progress for {stalledSecs}s — the connection to the database has stalled.
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-amber-800 leading-relaxed">
                    The write is queued on this device and will finish on its own once the
                    connection recovers, so keep this tab open and give it a moment.
                  </p>
                  <p className="mt-1.5 text-[10px] font-semibold text-amber-800 leading-relaxed">
                    If it still hasn’t moved, close this and re-upload the same file — nothing is
                    lost or double-counted. Every row is written under its own fixed id, so rows
                    that already landed come back as updates rather than duplicates.
                  </p>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && preview && (() => {
            // Same "nothing actually changed" detection as the preview's
            // allReconciled panel, but also gated on the post-confirm sync
            // having been a no-op (no flips, no sales linked, no orphans
            // added). When every signal is zero, surface a clear "no
            // changes were needed" message instead of "0 created · N
            // updated", which always confuses on re-uploads.
            const noChanges =
              preview.toCreate.length === 0
              && syncStats.staleDeleted === 0
              && syncStats.unitsMarkedSold === 0
              && syncStats.salesLinked === 0
              && syncStats.unitsAddedFromOrphanSales === 0
              && syncStats.unitsAddFailed === 0
              && syncStats.accessoriesDecremented === 0
              && syncStats.accessoriesReturned === 0
              && syncStats.unitsRestoredFromImport === 0
              && syncStats.unitsRestoreFailed === 0;
            if (noChanges) {
              return (
                <div className="py-8 flex flex-col items-center gap-3 text-center">
                  <CheckCircle2 size={36} className="text-emerald-600" />
                  <p className="text-sm font-bold text-slate-900">No changes needed</p>
                  <p className="text-[11px] font-mono text-slate-500 max-w-sm">
                    All {preview.toUpdate.length.toLocaleString()} {preview.toUpdate.length === 1 ? 'sale was' : 'sales were'} already in the database,
                    and no inventory units needed updating — every IMEI in this file already resolves to an existing unit.
                  </p>
                </div>
              );
            }
            return (
              <div className="py-8 flex flex-col items-center gap-3 text-center">
                <CheckCircle2 size={36} className="text-emerald-600" />
                <p className="text-sm font-bold text-slate-900">Import complete</p>
                <p className="text-[11px] font-mono text-slate-500">
                  {writeStats.created} created · {writeStats.updated} updated
                  {writeStats.skipped > 0 && <> · {writeStats.skipped} skipped</>}
                  {syncStats.staleDeleted > 0 && <> · {syncStats.staleDeleted} stale rows cleaned</>}
                </p>
                {syncStats.staleDeleteFailed > 0 && (
                  <p className="text-[10px] font-mono text-rose-700 mt-1">
                    ⚠ {syncStats.staleDeleteFailed} stale row{syncStats.staleDeleteFailed === 1 ? '' : 's'} could not be deleted (Firestore rules require admin for sales delete). They'll reappear on the next snapshot.
                  </p>
                )}
                {syncStats.shsFulfilled > 0 && (
                  <p className="text-[11px] font-mono text-amber-700">
                    SHS fulfilled · {syncStats.shsFulfilled} supplier-held unit{syncStats.shsFulfilled === 1 ? '' : 's'} shipped &amp; sold
                    {syncStats.shsAggregatesDecremented > 0 && <> · {syncStats.shsAggregatesDecremented} master row{syncStats.shsAggregatesDecremented === 1 ? '' : 's'} decremented</>}
                    {syncStats.shsPlaceholdersCleared > 0 && <> · {syncStats.shsPlaceholdersCleared} placeholder{syncStats.shsPlaceholdersCleared === 1 ? '' : 's'} cleared</>}
                  </p>
                )}
                {syncStats.accessoriesDecremented > 0 && (
                  <p className="text-[11px] font-mono text-indigo-700">
                    Accessory stock updated · {syncStats.accessoriesDecremented} sale{syncStats.accessoriesDecremented === 1 ? '' : 's'} matched a SKU pool and decremented it
                  </p>
                )}
                {syncStats.accessoriesReturned > 0 && (
                  <p className="text-[11px] font-mono text-indigo-700">
                    Accessory stock restored · {syncStats.accessoriesReturned} returned sale{syncStats.accessoriesReturned === 1 ? '' : 's'} put {syncStats.accessoriesReturned === 1 ? 'its' : 'their'} quantity back into the pool
                  </p>
                )}
                {(syncStats.unitsMarkedSold > 0 || syncStats.salesLinked > 0) && (
                  <p className="text-[10px] font-mono text-emerald-700 mt-1">
                    Inventory synced ·{' '}
                    {syncStats.unitsMarkedSold > 0 && <>{syncStats.unitsMarkedSold} unit{syncStats.unitsMarkedSold === 1 ? '' : 's'} marked sold</>}
                    {syncStats.unitsMarkedSold > 0 && syncStats.salesLinked > 0 && ' · '}
                    {syncStats.salesLinked > 0 && <>{syncStats.salesLinked} sale{syncStats.salesLinked === 1 ? '' : 's'} linked</>}
                  </p>
                )}
                {(syncStats.unitsRestoredFromImport > 0 || syncStats.unitsRestoreFailed > 0) && (
                  <p className="text-[10px] font-mono text-blue-700 mt-1">
                    Returns restored ·{' '}
                    {syncStats.unitsRestoredFromImport > 0 && <>{syncStats.unitsRestoredFromImport} unit{syncStats.unitsRestoredFromImport === 1 ? '' : 's'} restored to return state</>}
                    {syncStats.unitsRestoredFromImport > 0 && syncStats.unitsRestoreFailed > 0 && ' · '}
                    {syncStats.unitsRestoreFailed > 0 && <span className="text-rose-700">{syncStats.unitsRestoreFailed} failed (see below)</span>}
                  </p>
                )}
                {syncStats.unitsRestoreFailedDetails.length > 0 && (
                  <div className="mt-2 w-full max-w-md bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-left">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-rose-900 mb-1">Returns needing manual Process Return</p>
                    <ul className="space-y-0.5 text-[10px] font-mono text-rose-800">
                      {syncStats.unitsRestoreFailedDetails.slice(0, 10).map((f, i) => (
                        <li key={`${f.imei}-${i}`} className="truncate" title={`${f.imei} — ${f.orderNumber} — ${f.reason}`}>
                          {f.imei || '(blank)'} · {f.orderNumber} · <span className="text-rose-600">{f.reason}</span>
                        </li>
                      ))}
                      {syncStats.unitsRestoreFailedDetails.length > 10 && (
                        <li className="text-rose-500">+{syncStats.unitsRestoreFailedDetails.length - 10} more</li>
                      )}
                    </ul>
                  </div>
                )}
                {(syncStats.unitsAddedFromOrphanSales > 0 || syncStats.unitsAddFailed > 0) && (
                  <p className="text-[10px] font-mono text-orange-700 mt-1">
                    Audit records completed ·{' '}
                    {syncStats.unitsAddedFromOrphanSales > 0 && <>{syncStats.unitsAddedFromOrphanSales} unit{syncStats.unitsAddedFromOrphanSales === 1 ? '' : 's'} created / patched &amp; marked sold</>}
                    {syncStats.unitsAddedFromOrphanSales > 0 && syncStats.unitsAddFailed > 0 && ' · '}
                    {syncStats.unitsAddFailed > 0 && <span className="text-rose-700">{syncStats.unitsAddFailed} failed (see below)</span>}
                  </p>
                )}
                {syncStats.unitsAddFailedDetails.length > 0 && (
                  <div className="mt-2 w-full max-w-md bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-left">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-900 mb-1">Sales needing manual fix</p>
                    <ul className="space-y-0.5 text-[10px] font-mono text-amber-800">
                      {syncStats.unitsAddFailedDetails.slice(0, 10).map((f, i) => (
                        <li key={`${f.imei}-${i}`} className="truncate" title={`${f.imei} — ${f.orderNumber} — ${f.reason}`}>
                          {f.imei || '(blank)'} · {f.orderNumber} · <span className="text-amber-600">{f.reason}</span>
                        </li>
                      ))}
                      {syncStats.unitsAddFailedDetails.length > 10 && (
                        <li className="text-amber-500">+{syncStats.unitsAddFailedDetails.length - 10} more — see Sell tab for orange "No Inventory" badges</li>
                      )}
                      {/* With the hard-block gate these should be zero; shown defensively. */}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
          {phase === 'preview' && preview && (
            <>
              <button
                onClick={resetToUpload}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
              >
                Pick another file
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={
                  preview.toCreate.length + preview.toUpdate.length === 0
                  || (preview.inventoryFlips.length > 0 && !flipsAcked)
                  || auditBlockers > 0
                }
                title={
                  auditBlockers > 0
                    ? `Complete ${auditBlockers} sold record${auditBlockers === 1 ? '' : 's'} (model / supplier / BP / IMEI) before confirming — required for the audit trail.`
                    : preview.inventoryFlips.length > 0 && !flipsAcked
                      ? `Tick the acknowledgement to confirm ${preview.inventoryFlips.length} in-stock unit${preview.inventoryFlips.length === 1 ? '' : 's'} will be flipped to sold.`
                      : undefined
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} />
                {auditBlockers > 0
                  ? <>Complete {auditBlockers} record{auditBlockers === 1 ? '' : 's'} to continue</>
                  : preview.toCreate.length === 0
                    && preview.recordsToComplete.length === 0
                    && preview.inventoryFlips.length === 0
                    && preview.staleCombined.length === 0
                    ? <>Re-confirm {preview.toUpdate.length.toLocaleString()} sales</>
                    : <>Load {(preview.toCreate.length + preview.toUpdate.length).toLocaleString()} sales</>}
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
            >
              Close
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Phase: upload ───────────────────────────────────────────────────────────
function UploadPhase({
  error, fileInputRef, onPick, channel, onChannelChange,
}: {
  error: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
  /** null = combined workbook with one sheet per marketplace. */
  channel: Marketplace | null;
  onChannelChange: (m: Marketplace | null) => void;
}) {
  return (
    <>
      {/* Marketplace picker. Channels send their reports separately, so a
          one-file-per-marketplace upload is the common case; the combined
          four-sheet workbook is the exception, not the default shape. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
          What are you uploading?
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => onChannelChange(null)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all ${
              channel === null
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
            }`}
          >
            All marketplaces
          </button>
          {MARKETPLACES.map(m => (
            <button
              key={m}
              onClick={() => onChannelChange(m)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all ${
                channel === m
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
          {channel === null
            ? 'Combined workbook — one sheet per marketplace, named AMAZON / BM / EBAY / ONBUY.'
            : `Single ${channel} export. The sheet does not have to be named ${channel} — the first sheet is used when there is no match, so a file straight from ${channel} works as-is.`}
        </p>
      </div>

      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-2xl py-12 flex flex-col items-center gap-2 text-slate-500 hover:text-emerald-700 transition-all"
      >
        <Upload size={28} />
        <p className="text-[12px] font-bold">
          {channel === null ? 'Drop a SALES_REPORT.xlsx, or click to pick' : `Drop your ${channel} export, or click to pick`}
        </p>
        <p className="text-[10px] font-mono text-slate-400">
          {channel === null
            ? 'AMAZON / BM / EBAY / ONBUY sheets · the ALL sheet is ignored'
            : `Parsed with the ${channel} column layout`}
        </p>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="hidden"
      />
      {/* Offer the template that matches the picked channel — a blank
          four-sheet workbook is no help to someone uploading an Amazon
          export, and the wrong layout is the single most common reason an
          upload lands with £0 prices. */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <TemplateDownload
          templates={channel === null
            ? SALES_TEMPLATES
            : SALES_TEMPLATES.filter(t => t.file === `SALES_${channel}_TEMPLATE.xlsx`)}
          heading={channel === null
            ? 'Not sure of the format? Start from'
            : `Not sure of the ${channel} layout? Start from`}
        />
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
          <FileSpreadsheet size={11} /> Expected sheets
        </p>
        <ul className="text-[11px] font-mono text-slate-600 leading-relaxed space-y-0.5">
          <li><strong>AMAZON</strong> · 15 cols including Date · Order Number · SKU · IMEI · BP · SP · Postage</li>
          <li><strong>BM</strong> · 17 cols (adds Payment Mode for PayPal/Klarna 2.5%)</li>
          <li><strong>EBAY</strong> · 19 cols (adds ROF · FVF · 20% VAT · T.COM · Shipping tier · NP)</li>
          <li><strong>ONBUY</strong> · 15 cols (BP/SP shifted left — no Quantity column)</li>
        </ul>
        <p className="text-[10px] text-slate-500">
          Sales are matched by composite ID <span className="font-mono">marketplace__orderNumber__imei</span> (falls
          back to SKU then row number when IMEI is missing) — one order can legitimately ship multiple phones,
          so each line gets its own ID. Rows matching an existing ID will UPDATE; new rows will CREATE. Nothing writes until you
          confirm the preview. Every derived field (Tax, Commission, GP, NP) is recomputed via
          the master formulas — the file's derived columns are ignored on read.
        </p>
      </div>
      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-[11px] text-rose-700">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </>
  );
}

// ── Phase: preview ──────────────────────────────────────────────────────────
function PreviewPhase({
  preview, fileName, error, flipsAcked, onAckChange,
  auditEdits, onAuditEdit, units, suppliers, isAdmin, knownRefs,
  justCreatedModels, onCreateModel, onCreateSupplier,
}: {
  preview: PreviewBuckets;
  fileName: string;
  error: string;
  flipsAcked: boolean;
  onAckChange: (v: boolean) => void;
  auditEdits: AuditCompletionRow[];
  onAuditEdit: (saleId: string, patch: Partial<AuditCompletionRow>) => void;
  units: import('../types').InventoryUnit[];
  suppliers: import('../types').Supplier[];
  isAdmin: boolean;
  /** Passed down rather than re-derived here: the parent's Confirm gate and
   *  this panel's per-row messages must agree on what counts as a known model
   *  or supplier, and two derivations could drift into a disabled Confirm with
   *  no row explaining itself. */
  knownRefs: KnownRefs;
  /** Models the admin has added from inside this preview, so the picker
   *  offers them on every other row too — not just the one they were added
   *  from. Owned by the parent, which also folds them into knownRefs. */
  justCreatedModels: ModelSeed[];
  /** Admin-only, undefined for an employee. Adds the name to the catalogue /
   *  the supplier list, which releases every row waiting on it. */
  onCreateModel?: (draft: { brand: string; model: string }) => Promise<import('../lib/deviceCatalog').DeviceCatalogEntry>;
  onCreateSupplier?: (name: string) => Promise<void>;
}) {
  // Clean re-import = nothing to create, nothing to flip, no orphan IMEIs,
  // no stale combined docs to purge. The file has already been imported and
  // every IMEI in it already resolves to an inventory unit — surface this
  // loudly so the operator doesn't second-guess a "nothing happened" press
  // of Confirm. Errors / duplicate-in-file rows still get their own panels;
  // we don't hide those even when reconciled, because they need attention.
  const allReconciled =
    preview.toCreate.length === 0
    && preview.recordsToComplete.length === 0
    && preview.inventoryFlips.length === 0
    && preview.staleCombined.length === 0
    && preview.toUpdate.length > 0;

  // The model picker on an audit row must only ever suggest models that
  // actually exist under the row's own Office/SHS toggle — office stock
  // for an Office row, SHS holdings for an SHS row. Offering the other
  // bucket's models (or the combined catalog) lets an operator pick
  // "Galaxy A32 · 88 in stock" for a row marked SHS when none of those 88
  // are SHS holdings at all, which is exactly the mismatch that made the
  // stock-count badges meaningless. Pre-existing admin seeds (no real
  // stock in either bucket) are dropped from every row's picker for the
  // same reason — when neither bucket has the model, the picker shows
  // nothing rather than a seed that can't reconcile against anything,
  // and the operator falls through to the "+ Add" / "ask an admin" empty
  // state below.
  const officeUnits = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  const shsUnits = useMemo(() => units.filter(u => u.status === 'incoming'), [units]);

  // Split "To update" into active sales vs. sales that are ALREADY voided
  // in the database — re-confirming a voided row is a safe no-op re-write
  // (it's already reflected in Returns), not a new change. Surfaced
  // separately so "354 to update" doesn't read as 354 fresh changes when
  // it's really 349 active re-confirmations + 5 already-recorded returns.
  const alreadyRecordedReturns = useMemo(
    () => preview.toUpdate.filter(s => !!s.voidedAt).length,
    [preview.toUpdate],
  );
  const activeToUpdate = preview.toUpdate.length - alreadyRecordedReturns;

  // Models created via "+ Add" DURING this import session are tracked in the
  // PARENT (see justCreatedModels there) and arrive here as a prop, alongside
  // the knownRefs they were folded into. They used to live in this panel,
  // which meant the picker offered a newly created model immediately while the
  // GATE went on rejecting rows that named it — the operator watched the model
  // appear and the row stay red. One owner, one answer.

  /** Scrolls a failed write's banner into view. Returning to this panel
   *  leaves the operator wherever the browser puts them — typically far from
   *  the top — so rendering the banner is not by itself enough to be seen. */
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  // Most rows in a large orphan batch auto-complete from SKU→model
  // parsing and need no attention at all. Defaulting to "incomplete only"
  // lets the operator jump straight to the handful of rows that genuinely
  // need a manual fill instead of scrolling past hundreds of already-done
  // ones.
  const [showIncompleteOnly, setShowIncompleteOnly] = useState(true);

  /** Supplier names offered as suggestions on every audit row. Drawn from
   *  the live supplier list plus any name already present on a row, so a
   *  supplier that exists only in this file is still suggestible. */
  const auditSupplierNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of suppliers) if (s.name?.trim()) names.add(s.name.trim());
    for (const o of auditEdits) if (o.supplierName?.trim()) names.add(o.supplierName.trim());
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [suppliers, auditEdits]);

  /** Lower-cased lookup of the above, for the "is this a supplier you already
   *  have?" check on each row. Built from `suppliers` ONLY — deriving it from
   *  auditEdits too would make a typo vouch for itself the moment it is typed. */
  const knownSupplierSet = useMemo(
    () => new Set(suppliers.map(s => (s.name || '').trim().toLowerCase()).filter(Boolean)),
    [suppliers],
  );

  /** Which rows the "only incomplete" filter is holding in view.
   *
   *  Recomputed when the filter is switched on, or when a new file is
   *  parsed — deliberately NOT on every keystroke. Filtering live meant that
   *  typing the FIRST character of a supplier name completed the row, which
   *  dropped it out of the filtered list and unmounted the input mid-word.
   *  To the operator that read as the field auto-saving after one letter,
   *  with no way to finish typing. Rows now stay put until the filter is
   *  re-toggled, so a row can be completed without it vanishing underfoot. */
  const [pinnedRows, setPinnedRows] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!showIncompleteOnly) { setPinnedRows(new Set()); return; }
    setPinnedRows(new Set(
      auditEdits.filter(o => auditRowMissing(o, knownRefs).length > 0).map(o => o.saleId),
    ));
    // Keyed on the SIZE of the audit set (a new file re-seeds it), never on
    // its contents — which is exactly what would reintroduce the bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIncompleteOnly, auditEdits.length]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
        <span>
          <FileSpreadsheet size={11} className="inline mr-1" />
          {fileName} · {preview.total.toLocaleString()} {preview.total === 1 ? 'row' : 'rows'}
        </span>
      </div>

      {/* A write that throws mid-confirm lands back here via
          `setPhase('preview')`. Until now the only rendering of `error` was
          the small strip at the very BOTTOM of this panel — below the audit
          table and the returns list, thousands of pixels down on a phone. The
          operator pressed Load, got the audit screen back, and had no visible
          reason why: it read as the button simply not working, which is
          exactly how it was reported. Repeat it at the top and pull it into
          view so a failed write always announces itself. */}
      {error && (
        <div
          ref={errorRef}
          className="border-2 border-rose-300 bg-rose-50 rounded-2xl p-3 flex items-start gap-2.5"
        >
          <AlertTriangle size={20} className="text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-rose-900">
              {isQuotaError(error)
                ? 'Out of database quota for today — retrying will not help'
                : 'The import didn’t finish — nothing further was written'}
            </p>
            {isQuotaError(error) ? (
              <>
                <p className="text-[11px] text-rose-800 mt-1 leading-relaxed">
                  This is not a problem with the file or with anything you filled in. The database
                  has a daily free-tier allowance and today’s is spent, so it is refusing further
                  work until it resets. It resets at <strong>midnight US Pacific time</strong>.
                </p>
                <p className="text-[11px] text-rose-800 mt-1.5 leading-relaxed">
                  Pressing Load again now will fail the same way and eat into the next allowance.
                  Close the app in any other browser tabs — each open tab keeps its own live
                  connection and quietly consumes the same allowance — then run the import once,
                  after the reset.
                </p>
              </>
            ) : (
              <p className="text-[10px] text-rose-700 mt-1.5 leading-relaxed">
                Your reviewed values are still here. Fix the cause and press Load again — rows that
                already landed come back as updates, so re-running is safe.
              </p>
            )}
            <details className="mt-2">
              <summary className="text-[10px] font-bold text-rose-700 cursor-pointer">
                Technical detail
              </summary>
              <p className="text-[10px] text-rose-700 mt-1 break-words leading-relaxed">{error}</p>
            </details>
          </div>
        </div>
      )}

      {allReconciled && (
        <div className="border-2 border-emerald-300 bg-emerald-50 rounded-2xl p-3 flex items-start gap-2.5">
          <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-emerald-900">
              Already up to date — nothing to change
            </p>
            <p className="text-[11px] text-emerald-800 mt-0.5">
              All {preview.toUpdate.length.toLocaleString()} {preview.toUpdate.length === 1 ? 'sale is' : 'sales are'} already in the database.
              No inventory units need updating — every IMEI in this file already resolves to an existing unit.
              You can close this dialog, or confirm to refresh the import timestamps and source-file provenance.
            </p>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <SummaryTile
          icon={<PlusCircle size={14} className="text-emerald-600" />}
          label="To create"
          value={preview.toCreate.length}
          tone="emerald"
        />
        <SummaryTile
          icon={<RefreshCw size={14} className="text-blue-600" />}
          label="To update"
          value={preview.toUpdate.length}
          tone="blue"
        />
        <SummaryTile
          icon={<AlertCircle size={14} className="text-rose-600" />}
          label="Invalid"
          value={preview.invalid.length}
          tone="rose"
        />
      </div>

      {/* "To update" breakdown — a report exported "All Time" legitimately
          includes voided/returned sales (see the Returns tab), so the
          update count is a mix of active re-confirmations and already-
          recorded returns. Spelling that out here is what stops "354 to
          update" from reading as 354 fresh changes about to happen. */}
      {alreadyRecordedReturns > 0 && (
        <div className="border border-slate-200 bg-slate-50 rounded-xl px-3 py-2 text-[11px] text-slate-600 flex items-start gap-2">
          <RefreshCw size={12} className="text-slate-400 flex-shrink-0 mt-0.5" />
          <span>
            Of the {preview.toUpdate.length.toLocaleString()} rows to update,{' '}
            <strong>{activeToUpdate.toLocaleString()}</strong> {activeToUpdate === 1 ? 'is an active sale' : 'are active sales'} being
            re-confirmed and <strong>{alreadyRecordedReturns.toLocaleString()}</strong> {alreadyRecordedReturns === 1 ? 'is a return' : 'are returns'} already
            recorded in this database (see the Returns tab in the file) — re-confirming them changes nothing, their
            void/refund history is preserved exactly as it is now.
          </span>
        </div>
      )}

      {/* Per-platform counts — confirms every sheet was found and parsed */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {MARKETPLACES.map(m => (
          <div key={m} className="bg-white border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{m}</p>
            <p className="text-base font-bold text-slate-900">{(preview.perSheet[m] ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* ── GAP FIX 3: Import Order Warning ────────────────────────────
          When orphan IMEIs are detected (recordsToComplete contains
          NEW rows with no matching inventory unit), show a prominent
          warning suggesting the operator import the Inventory Report
          first. This enforces the agreed workflow: inventory first,
          sales last — reducing manual orphan resolution work. */}
      {preview.recordsToComplete.filter(r => !r.existingUnitId).length > 0 && (
        <div className="border-2 border-amber-300 bg-amber-50 rounded-2xl p-3 flex items-start gap-2.5">
          <ArrowUpRight size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-bold text-amber-900">
              {preview.recordsToComplete.filter(r => !r.existingUnitId).length} orphan IMEI{preview.recordsToComplete.filter(r => !r.existingUnitId).length === 1 ? '' : 's'} — import inventory first?
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              These sold IMEIs have no matching inventory unit. If you haven't
              yet imported today's Inventory Report, consider doing that first —
              the units will auto-match, saving you from manually filling model /
              supplier / BP for each orphan. The agreed workflow is:
              <strong> Inventory Report → SHS Receive → Manual Stock → Sales Report</strong>.
            </p>
            <p className="text-[10px] font-mono text-amber-600 mt-1">
              Or continue now — each orphan will be created from the sale data
              after you fill in the missing fields below.
            </p>
          </div>
        </div>
      )}

      {/* ── Inventory impact gate ────────────────────────────────────────
          When the import would flip in-stock units to status='sold' as a
          side effect, surface the impact AND require an explicit
          acknowledgement before Confirm enables. Loaded the eye-icon
          prompt from QA round 5 ("when I add inventory stock it's 215
          but when I load sales report it's showing 198 — why"). */}
      {preview.inventoryFlips.length > 0 && (
        <div className="border-2 border-amber-300 bg-amber-50 rounded-2xl p-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-amber-900">
                {preview.inventoryFlips.length} office-stock unit{preview.inventoryFlips.length === 1 ? '' : 's'} will be fulfilled &amp; marked SOLD
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                These IMEIs match units already in inventory (office stock), so each
                sale is fulfilled from its real unit — full model / supplier / BP
                intact. If any IMEI is wrong, fix the sheet first or void the sale
                after import.
              </p>
            </div>
          </div>

          <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-amber-100 text-[9px] font-mono uppercase tracking-widest text-amber-900 bg-amber-50/60">
              Units that will be fulfilled
            </div>
            <ul className="max-h-48 overflow-auto divide-y divide-amber-50 text-[11px]">
              {preview.inventoryFlips.slice(0, 50).map(f => (
                <li key={f.unitId} className="px-3 py-1.5 flex items-center justify-between gap-3">
                  <span className="font-mono text-slate-700 truncate" title={`${f.imei} — ${f.model}`}>
                    {f.imei || '—'} <span className="text-slate-400">·</span> <span className="text-slate-500">{f.model}</span>
                  </span>
                  <span className="flex-shrink-0 text-[10px] font-mono text-slate-600">
                    {f.marketplace} · {f.saleOrderId} · £{Number(f.salePrice).toFixed(2)}
                  </span>
                </li>
              ))}
              {preview.inventoryFlips.length > 50 && (
                <li className="px-3 py-1.5 text-amber-700 text-[10px] font-mono">
                  +{preview.inventoryFlips.length - 50} more not shown
                </li>
              )}
            </ul>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none text-[11px] font-semibold text-amber-900">
            <input
              type="checkbox"
              checked={flipsAcked}
              onChange={e => onAckChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-amber-600 cursor-pointer"
            />
            I've reviewed the list — fulfil &amp; mark the {preview.inventoryFlips.length} unit{preview.inventoryFlips.length === 1 ? '' : 's'} sold.
          </label>
        </div>
      )}

      {/* Positive confirmation that every sale IMEI resolved to a unit.
          Suppressed when allReconciled fires (the bigger panel above
          already conveys this) and when there's literally nothing in the
          file to evaluate (total=0). */}
      {!allReconciled && preview.recordsToComplete.length === 0 && (preview.toCreate.length + preview.toUpdate.length) > 0 && (
        <div className="border border-emerald-200 bg-emerald-50/60 rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] text-emerald-800">
          <CheckCircle2 size={12} className="text-emerald-600 flex-shrink-0" />
          <span>Every sold record is audit-complete — model, supplier, BP, IMEI all present.</span>
        </div>
      )}

      {/* Audit-completeness panel — sold records missing required fields.
          HARD-BLOCKS Confirm until every row is complete (model, supplier,
          BP, IMEI). Two kinds: orphans (NEW — no unit yet, will be created)
          and matched-incomplete (IN STOCK — unit exists but missing audit
          data, will be patched). */}
      {preview.recordsToComplete.length > 0 && (() => {
        const incomplete = auditEdits.filter(o => auditRowMissing(o, knownRefs).length > 0).length;
        const ready = auditEdits.length - incomplete;
        // Reconciliation against the reference data, reported separately from
        // the blank-field count. They are different problems with different
        // fixes: a missing buy price is data the operator types, an unknown
        // model is a name that has to become a catalog entry or be corrected
        // onto one — and conflating the two under "still blocking" was what
        // made a held row look like a form the operator had failed to fill in.
        const heldOnModel = auditEdits.filter(
          o => auditRowMissing(o, knownRefs).includes('model not in catalog'),
        ).length;
        const heldOnSupplier = auditEdits.filter(
          o => auditRowMissing(o, knownRefs).includes('supplier not on file'),
        ).length;
        const withSuggestion = auditEdits.filter(o => {
          const s = suggestRowFixes(o, knownRefs);
          return s.model || s.supplier;
        }).length;
        return (
        <div className="border-2 border-orange-300 bg-orange-50 rounded-2xl p-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-orange-900">
                {preview.recordsToComplete.length} sold record{preview.recordsToComplete.length === 1 ? '' : 's'} need completing for the audit trail
              </p>
              <p className="text-[11px] text-orange-800 mt-0.5">
                Every unit marked sold must carry full audit data — IMEI, model,
                supplier, buy price. Rows tagged <span className="font-bold">NEW</span> get
                created as fresh stock; <span className="font-bold">IN&nbsp;STOCK</span> rows
                patch an existing unit that was missing data. Confirm stays
                locked until all rows are complete.
              </p>
              <p className="text-[10px] font-mono text-orange-900 mt-1">
                <span className="font-bold">{ready}</span> of {auditEdits.length} complete · <span className={`font-bold ${incomplete > 0 ? 'text-rose-700' : ''}`}>{incomplete}</span> still blocking
              </p>
              {/* Which of the blocked rows are blocked on a NAME rather than
                  on a blank field. The operator's question at this point is
                  "did this file land on my existing models or not", and the
                  count above cannot answer it. */}
              {(heldOnModel > 0 || heldOnSupplier > 0) && (
                <p className="text-[10px] font-mono text-orange-900 mt-1">
                  <span className="font-bold text-rose-700">
                    {heldOnModel > 0 && `${heldOnModel} row${heldOnModel === 1 ? '' : 's'} on a model not in your catalog`}
                    {heldOnModel > 0 && heldOnSupplier > 0 && ' · '}
                    {heldOnSupplier > 0 && `${heldOnSupplier} row${heldOnSupplier === 1 ? '' : 's'} on a supplier not on file`}
                  </span>
                  {withSuggestion > 0 && (
                    <span className="text-amber-800">
                      {' '}— {withSuggestion} look{withSuggestion === 1 ? 's' : ''} like a typo of an existing name; the row shows the suggestion.
                    </span>
                  )}
                </p>
              )}
              <p className="text-[10px] text-orange-800 mt-1">
                A model or supplier the app has never seen is <span className="font-bold">held</span>, not
                created. Nothing here can invent a catalog entry — correct the
                name onto an existing one, or add the real model in Configuration
                and the supplier in Admin first.
              </p>
              <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none text-[10px] font-bold text-orange-900">
                <input
                  type="checkbox"
                  checked={showIncompleteOnly}
                  onChange={e => setShowIncompleteOnly(e.target.checked)}
                  className="w-3.5 h-3.5 accent-orange-600 cursor-pointer"
                />
                Show only rows still needing attention{incomplete > 0 ? ` (${incomplete})` : ''}
              </label>
            </div>
          </div>

          {/* Scrolls sideways rather than squeezing 14 columns into a phone
              width. Unconstrained, every field collapsed to ~20px — headers
              overlapped into "COLOSTORAGE" and each input showed three
              characters, so the operator could not read, let alone fix, what
              was blocking a row. Desktop is unaffected: the min-width is
              below a normal viewport, so the grid lays out exactly as before. */}
          <p className="md:hidden mb-1 text-[10px] font-mono text-orange-800">
            Scroll the table sideways to reach every column →
          </p>
          {/* Known supplier names, offered to every supplier cell below. */}
          <datalist id="audit-supplier-names">
            {auditSupplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
          <div className="bg-white border border-orange-200 rounded-xl overflow-x-auto">
            <div className="min-w-[56rem] px-3 py-1.5 border-b border-orange-100 text-[9px] font-mono uppercase tracking-widest text-orange-900 bg-orange-50/60 grid grid-cols-14 gap-2">
              <span className="col-span-3">IMEI · Source · Order</span>
              <span className="col-span-3">Model</span>
              <span className="col-span-1">Colour</span>
              <span className="col-span-1">Storage</span>
              <span className="col-span-2">SIM Type</span>
              <span className="col-span-2">Supplier</span>
              <span className="col-span-1 text-right">BP £</span>
              <span className="col-span-1 text-right">SP £</span>
            </div>
            <ul className="min-w-[56rem] max-h-[32rem] overflow-y-auto divide-y divide-orange-50 text-[11px]">
              {showIncompleteOnly && incomplete === 0 && (
                <li className="px-3 py-4 text-center text-emerald-700 font-semibold">
                  All {auditEdits.length} rows are complete.
                </li>
              )}
              {(showIncompleteOnly ? auditEdits.filter(o => pinnedRows.has(o.saleId)) : auditEdits).map(o => {
                const missing = auditRowMissing(o, knownRefs);
                const rowIncomplete = missing.length > 0;
                const suggestions = rowIncomplete
                  ? suggestRowFixes(o, knownRefs)
                  : { model: null, supplier: null };
                const needImei = !/^\d{15}$/.test((o.imei || '').trim().toUpperCase()) && !/^[A-Z0-9]{10,12}$/.test((o.imei || '').trim().toUpperCase());
                return (
                  <li
                    key={o.saleId}
                    className={`px-3 py-1.5 grid grid-cols-14 gap-2 items-center ${rowIncomplete ? 'bg-rose-50/70' : ''}`}
                  >
                    <span className="col-span-3 min-w-0">
                      <span className="flex items-center gap-1">
                        <span className={`flex-shrink-0 text-[7px] font-bold uppercase tracking-widest px-1 py-px rounded border ${o.existingUnitId ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          {o.existingUnitId ? 'In stock' : 'New'}
                        </span>
                        {o.imeiReadOnly ? (
                          <span className="block font-mono text-slate-700 truncate" title={o.imei}>{o.imei}</span>
                        ) : (
                          <input
                            className={`flex-1 min-w-0 border rounded px-1.5 py-1 text-[10px] font-mono focus:outline-none focus:border-orange-500 ${needImei ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
                            value={o.imei}
                            placeholder="IMEI required"
                            onChange={e => onAuditEdit(o.saleId, { imei: e.target.value })}
                          />
                        )}
                      </span>
                      <span className="block text-[9px] font-mono text-slate-500 truncate mt-0.5">{o.marketplace} · {o.orderNumber}</span>
                      {/* Per-unit fulfilment source. Matched units (IMEI in
                          inventory) are office stock automatically — only
                          orphans (NEW) need the operator to pick office/SHS. */}
                      {o.existingUnitId ? (
                        <span className="block text-[8px] font-bold uppercase tracking-wide text-slate-400 mt-1">Office (auto)</span>
                      ) : (
                        <span className="inline-flex mt-1 rounded border border-slate-200 overflow-hidden">
                          {(['office', 'shs'] as const).map(src => (
                            <button
                              key={src}
                              type="button"
                              onClick={() => onAuditEdit(o.saleId, { stockSource: src })}
                              className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 ${
                                o.stockSource === src
                                  ? (src === 'shs' ? 'bg-teal-600 text-white' : 'bg-slate-700 text-white')
                                  : 'bg-white text-slate-500 hover:bg-slate-50'
                              }`}
                              title={src === 'shs' ? 'Supplier-held (SHS) stock' : 'Office stock'}
                            >
                              {src === 'shs' ? 'SHS' : 'Office'}
                            </button>
                          ))}
                        </span>
                      )}
                      {/* Name the blocking fields. auditRowMissing already
                          computes exactly this list on every row, but it was
                          only ever used to tint the row pink — so a operator
                          facing "1 still blocking" had to scroll a 14-column
                          table hunting for which cell was the problem, and on
                          a phone the offending column is off-screen entirely.
                          Printed in the FIRST column so it is readable without
                          scrolling at all. */}
                      {rowIncomplete && (
                        <span className="block text-[9px] font-mono font-bold text-rose-700 mt-1 whitespace-normal">
                          Needs: {missing.join(', ')}
                        </span>
                      )}
                      {/* "Did you mean…" — the way out of a held row that
                          isn't "add a second catalog entry spelled slightly
                          differently", which is the exact failure the gate
                          above exists to prevent. One click puts the row on
                          the name that already exists. Never automatic: MHL
                          and MKL really could be two companies, and only the
                          operator knows which. */}
                      {suggestions.model && (
                        <button
                          type="button"
                          onClick={() => onAuditEdit(o.saleId, { model: suggestions.model!.match })}
                          className="block text-left text-[9px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 mt-1 hover:bg-amber-200 whitespace-normal"
                          title={
                            suggestions.model.kind === 'punctuation'
                              ? 'Same name, different spacing — click to use the catalog spelling'
                              : 'Close to a model already in your catalog — click to use it'
                          }
                        >
                          Model: did you mean “{suggestions.model.match}”?
                        </button>
                      )}
                      {suggestions.supplier && (
                        <button
                          type="button"
                          onClick={() => onAuditEdit(o.saleId, { supplierName: suggestions.supplier!.match })}
                          className="block text-left text-[9px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded px-1.5 py-0.5 mt-1 hover:bg-amber-200 whitespace-normal"
                          title={
                            suggestions.supplier.kind === 'punctuation'
                              ? 'Same name, different spacing — click to use the spelling on file'
                              : 'Close to a supplier already on file — click to use it'
                          }
                        >
                          Supplier: did you mean “{suggestions.supplier.match}”?
                        </button>
                      )}
                      {/* The other half of the answer. A correction only helps
                          when the name IS a typo; sometimes it is a genuinely
                          new supplier, and before this the message said to go
                          and add it in Admin — which means abandoning a
                          preview that may have taken ten minutes to correct.
                          People work around instructions like that, and the
                          workaround is to bend the name onto an existing
                          supplier so the row passes, which is the corrupted
                          ledger this whole gate exists to prevent.

                          Admin only, deliberately: an employee facing an
                          unknown supplier is meant to reach an admin, not to
                          create the record that makes their own row go
                          through. They get the reason instead of the button. */}
                      {missing.includes('supplier not on file') && (
                        onCreateSupplier ? (
                          <button
                            type="button"
                            onClick={async () => {
                              await onCreateSupplier(o.supplierName.trim());
                            }}
                            className="block text-left text-[9px] font-mono font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 mt-1 hover:bg-emerald-200 whitespace-normal"
                            title="Adds this supplier for real, and releases every row in this file waiting on it"
                          >
                            + Add “{o.supplierName.trim()}” as a new supplier
                          </button>
                        ) : (
                          <span className="block text-[9px] font-mono text-slate-500 mt-1 whitespace-normal">
                            Genuinely new? An admin has to add this supplier.
                          </span>
                        )
                      )}
                      {/* Same, for the model. The picker below carries the
                          admin "+ Add" affordance itself, so this only has to
                          say so — and has to say the other thing to an
                          employee, who will otherwise sit on a red row with
                          no idea what is expected of them. */}
                      {missing.includes('model not in catalog') && !onCreateModel && (
                        <span className="block text-[9px] font-mono text-slate-500 mt-1 whitespace-normal">
                          Genuinely new? An admin has to add this model to the catalog.
                        </span>
                      )}
                    </span>
                    {/* Model — searchable catalog picker, NOT free text.
                        The raw SKU is preserved on o.sku; the operator
                        selects a clean model by searching ONLY the models
                        that exist under this row's own Office/SHS toggle
                        (officeUnits / shsUnits above) — no admin seeds, no
                        cross-bucket suggestions. Strict mode blocks free
                        text; admins get the "+ Add" affordance when the
                        filtered catalog has no match at all. On pick we
                        also pre-fill storage from the catalog entry's
                        dominant value when the row's storage is still
                        blank. */}
                    <div className={`col-span-3 ${!o.model.trim() ? 'rounded ring-1 ring-rose-400 bg-rose-50' : ''}`}>
                      <DeviceComboBox
                        units={o.stockSource === 'shs' ? shsUnits : officeUnits}
                        seeds={justCreatedModels}
                        strict
                        isAdmin={isAdmin}
                        brand=""
                        model={o.model}
                        onModelChange={m => onAuditEdit(o.saleId, { model: m })}
                        onPick={entry => onAuditEdit(o.saleId, {
                          model: entry.model,
                          ...(!o.storage && entry.storages?.[0] ? { storage: entry.storages[0] } : {}),
                          ...((!o.colour || o.colour === 'Unknown') && entry.colours?.[0] ? { colour: entry.colours[0] } : {}),
                        })}
                        onCreateModel={onCreateModel}
                        placeholder="Search model…"
                        inputClassName="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    {/* Colour — dropdown. Preserve any non-preset value
                        the matched unit already carried by surfacing it as
                        the first option so it isn't silently dropped. */}
                    <select
                      className="col-span-1 border border-slate-200 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-orange-500 bg-white"
                      value={o.colour}
                      onChange={e => onAuditEdit(o.saleId, { colour: e.target.value })}
                    >
                      <option value="">—</option>
                      {o.colour && !COLOUR_PRESETS.some(c => c.toLowerCase() === o.colour.toLowerCase()) && (
                        <option value={o.colour}>{o.colour}</option>
                      )}
                      {COLOUR_PRESETS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    {/* Storage — dropdown. Same non-preset preservation. */}
                    <select
                      className="col-span-1 border border-slate-200 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-orange-500 bg-white"
                      value={o.storage}
                      onChange={e => onAuditEdit(o.saleId, { storage: e.target.value })}
                    >
                      <option value="">—</option>
                      {o.storage && !STORAGE_OPTIONS.includes(o.storage) && (
                        <option value={o.storage}>{o.storage}</option>
                      )}
                      {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {/* SIM Type — optional, same as the Inventory Report import
                        schema. Not a completion blocker (auditRowMissing
                        doesn't check it) but a unit created from this screen
                        used to skip it entirely, unlike every other intake
                        path (Add Stock, Bulk Order, Inventory Report). */}
                    <select
                      className="col-span-2 border border-slate-200 rounded px-1 py-1 text-[10px] focus:outline-none focus:border-orange-500 bg-white"
                      value={o.simType}
                      onChange={e => onAuditEdit(o.saleId, { simType: e.target.value })}
                    >
                      <option value="">—</option>
                      {o.simType && !SIM_TYPE_OPTIONS.includes(o.simType as any) && (
                        <option value={o.simType}>{o.simType}</option>
                      )}
                      {SIM_TYPE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {/* Typing is free-text, but the known suppliers are
                        offered as suggestions — the operator was otherwise
                        expected to recall the exact spelling with no list in
                        sight, on the one screen where a typo silently creates
                        a second supplier.
                        Three states: rose = still missing (under 2 chars),
                        amber = a real entry that matches no known supplier
                        (probably a typo, but a genuinely new supplier is
                        legitimate so this warns rather than blocks), plain =
                        matches one you already have. */}
                    <input
                      list="audit-supplier-names"
                      className={`col-span-2 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500 ${
                        o.supplierName.trim().length < 2
                        || (knownSupplierSet.size > 0
                            && !knownSupplierSet.has(o.supplierName.trim().toLowerCase()))
                          ? 'border-rose-400 bg-rose-50'
                          : 'border-slate-200'
                      }`}
                      value={o.supplierName}
                      placeholder="Supplier required"
                      title={
                        o.supplierName.trim().length >= 2
                        && knownSupplierSet.size > 0
                        && !knownSupplierSet.has(o.supplierName.trim().toLowerCase())
                          ? 'Not one of your suppliers — pick an existing one. A genuinely new supplier has to be added in Admin first, so a typo cannot invent one here.'
                          : undefined
                      }
                      onChange={e => onAuditEdit(o.saleId, { supplierName: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.01"
                      className={`col-span-1 border rounded px-1.5 py-1 text-[10px] font-mono text-right focus:outline-none focus:border-orange-500 ${o.buyPrice <= 0 ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
                      value={o.buyPrice}
                      onChange={e => onAuditEdit(o.saleId, { buyPrice: Number(e.target.value) || 0 })}
                    />
                    <span className={`col-span-1 text-right font-mono text-[10px] ${o.salePrice > 0 ? 'text-slate-500' : 'text-rose-600 font-bold'}`}>
                      £{Number(o.salePrice).toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-[10px] font-mono text-orange-700">
            Rose-tinted inputs are missing a required audit field. Confirm unlocks
            only when all {auditEdits.length} record{auditEdits.length === 1 ? ' is' : 's are'} complete. A £0.00 sale price
            must be fixed in the sheet and re-uploaded.
          </p>
        </div>
        );
      })()}

      {preview.duplicatesInFile.length > 0 && (
        <DetailPanel title={`Duplicate IDs in file · ${preview.duplicatesInFile.length}`} tone="rose">
          <ul className="space-y-1 text-[10px] font-mono">
            {preview.duplicatesInFile.slice(0, 10).map(d => (
              <li key={d.id} className="text-rose-700">{d.id} — appears {d.rows[0]} times</li>
            ))}
            {preview.duplicatesInFile.length > 10 && (
              <li className="text-rose-500">+{preview.duplicatesInFile.length - 10} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.returnsToRestore.filter(r => !r.alreadyRestored).length > 0 && (
        <DetailPanel
          title={`Returns to restore · ${preview.returnsToRestore.filter(r => !r.alreadyRestored).length}`}
          tone="blue"
        >
          <p className="text-[10px] text-blue-800 mb-1.5">
            These voided sales carry a Return Type in the file's Returns tab, so
            on confirm each linked unit will be patched back to its return state
            (status, return date/reason/outcome) — exactly what Process Return
            would have written, replayed from the file instead of typed again.
          </p>
          <ul className="space-y-1 text-[10px] font-mono text-blue-700">
            {preview.returnsToRestore.filter(r => !r.alreadyRestored).slice(0, 15).map(r => (
              <li key={r.saleId} className="truncate" title={r.imei}>
                {r.marketplace} {r.orderNumber} · {r.imei} · {RETURN_TYPE_LABELS[r.returnType]}
                {!r.existingUnitId && ' · unit will be reconstructed'}
              </li>
            ))}
            {preview.returnsToRestore.filter(r => !r.alreadyRestored).length > 15 && (
              <li className="text-blue-500">+{preview.returnsToRestore.filter(r => !r.alreadyRestored).length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.returnsNeedingType.length > 0 && (
        <DetailPanel title={`Returns with no Return Type · ${preview.returnsNeedingType.length}`} tone="amber">
          <p className="text-[10px] text-amber-800 mb-1.5">
            These voided sales have no Return Type in the file's Returns tab —
            either the file predates that column, or the row was left blank.
            The sale still imports as voided, but the unit is left untouched:
            Return Type is never guessed. Process Return manually for these
            once the import completes.
          </p>
          <ul className="space-y-1 text-[10px] font-mono text-amber-700">
            {preview.returnsNeedingType.slice(0, 15).map(r => (
              <li key={r.saleId} className="truncate" title={r.imei}>
                {r.marketplace} {r.orderNumber} · {r.imei}
              </li>
            ))}
            {preview.returnsNeedingType.length > 15 && (
              <li className="text-amber-500">+{preview.returnsNeedingType.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.staleCombined.length > 0 && (
        <DetailPanel title={`Stale legacy rows to clean up · ${preview.staleCombined.length}`} tone="amber">
          <p className="text-[10px] text-amber-800 mb-1.5">
            These rows are duplicates of bulk orders the new upload supersedes
            — either an old "all IMEIs in one cell" combined doc, or a blank-
            IMEI row created when the import previously couldn't extract the
            IMEI. The per-IMEI rows from this upload replace them, so the old
            ones below are deleted on confirm (fixes double-counted revenue,
            blank-IMEI dupes, and 4-unit orders rendering as 1-2 rows).
          </p>
          <ul className="space-y-1 text-[10px] font-mono text-amber-700">
            {preview.staleCombined.slice(0, 15).map(s => (
              <li key={s.id} className="truncate" title={s.imei}>
                {s.orderNumber} · £{Number(s.salePrice).toFixed(2)} · {s.imei}
              </li>
            ))}
            {preview.staleCombined.length > 15 && (
              <li className="text-amber-500">+{preview.staleCombined.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.invalid.length > 0 && (
        <DetailPanel title={`Parser errors · ${preview.invalid.length}`} tone="rose">
          <ul className="space-y-1 text-[10px] font-mono">
            {preview.invalid.slice(0, 15).map((e, i) => (
              <li key={`${e.sheet}-${e.row}-${i}`} className="text-rose-700">
                {e.sheet} row {e.row} — {e.message}
              </li>
            ))}
            {preview.invalid.length > 15 && (
              <li className="text-rose-500">+{preview.invalid.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.toUpdate.length > 0 && (
        <DetailPanel title={`Will update existing sales · ${preview.toUpdate.length}`} tone="blue">
          <ul className="space-y-1 text-[10px] font-mono text-blue-700">
            {preview.toUpdate.slice(0, 15).map(s => (
              <li key={s.id}>{s.marketplace} · {s.orderNumber}{s.imei ? ` · IMEI ${s.imei}` : ''}</li>
            ))}
            {preview.toUpdate.length > 15 && (
              <li className="text-blue-500">+{preview.toUpdate.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-[11px] text-rose-700">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'emerald' | 'blue' | 'rose';
}) {
  const toneCls = (
    tone === 'emerald' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' :
    tone === 'blue'    ? 'bg-blue-50 border-blue-100 text-blue-900' :
                         'bg-rose-50 border-rose-100 text-rose-900'
  );
  return (
    <div className={`${toneCls} border rounded-xl p-3 flex flex-col gap-1`}>
      <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest opacity-80">
        {icon} {label}
      </div>
      <p className="text-2xl font-bold leading-none">{value.toLocaleString()}</p>
    </div>
  );
}

function DetailPanel({
  title, tone, children,
}: {
  title: string;
  tone: 'rose' | 'blue' | 'amber';
  children: React.ReactNode;
}) {
  const toneCls = (
    tone === 'rose'  ? 'bg-rose-50/60 border-rose-200' :
    tone === 'amber' ? 'bg-amber-50/60 border-amber-200' :
                       'bg-blue-50/60 border-blue-200'
  );
  return (
    <div className={`${toneCls} border rounded-xl p-3 space-y-1.5`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700">{title}</p>
      {children}
    </div>
  );
}
