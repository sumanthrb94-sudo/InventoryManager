/**
 * InventoryReportImport — the 9-column master importer.
 *
 * Replaces the legacy multi-sheet ImportModal. Accepts the same schema the
 * "Inventory Report" button exports, so a daily round-trip is possible:
 *
 *   Stock In Date · Model · IMEI · Grade · Storage · Colour · Supplier ·
 *   BP · Stock Type · Notes
 *
 * Stock Type is how supplier-held (SHS) stock arrives by report. Without
 * it the schema could only express office stock, so every SHS row landed
 * on the shelf as available — the operator then had to re-key it through
 * SHS Receive. 'SHS' / 'INCOMING' / 'SUPPLIER' mean the supplier still
 * holds the unit (status='incoming'); anything else, including a blank,
 * is office stock, so existing files keep importing unchanged.
 *
 * Flow: upload → preview → confirm → write. Per the operator's spec,
 * NOTHING writes until the preview is confirmed; the preview verifies
 * each IMEI against Firestore and reports what would happen — new vs.
 * existing IMEI, invalid rows, file-internal duplicates — so a bad
 * file is caught before any units change.
 */
import React, { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2,
  PlusCircle, RefreshCw, AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import type { InventoryUnit, Supplier } from '../types';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { buildCatalogIndex, canonicaliseModel, resolveCatalogModel, modelBucketKey } from '../lib/modelReconciliation';
import { normaliseGrade, normaliseSimType } from '../lib/unitConstants';
import { parseStockWorkbook, type ParsedRow, type ParsedAccessoryRow } from '../lib/inventoryImportParse';
import { isOfficeStockUnit, isShsUnit } from '../lib/wipeScopes';
import { restoreAccessoryStockFromImport } from '../services/inventoryService';
import { findSupplierNearMisses, type SupplierNearMiss } from '../lib/supplierNearMiss';
import { auth } from '../lib/firebase';

interface Props { onClose: () => void; }

type Phase = 'upload' | 'preview' | 'loading' | 'done';

interface PreviewBuckets {
  total: number;
  toCreate: ParsedRow[];   // imei not in DB
  toUpdate: ParsedRow[];   // imei found in DB, in the SAME bucket the row declares
  invalid:  ParsedRow[];   // missing required / invalid imei / dup-in-file
  newSuppliers: string[];  // distinct supplier names not in DB
  duplicates: { imei: string; rows: number[] }[];
  // IMEI matches an existing unit, but that unit lives in a different bucket
  // than this row declares (an OFFICE row hitting an SHS unit, or an SHS row
  // hitting an already-sold one). Neither created nor updated — updating
  // would rewrite a unit this report has no business touching, and creating
  // would mint a second unit for a real IMEI that already exists. The
  // operator resolves these through the flow that actually owns that bucket
  // (SHS Receive, the sales-orphan completion, etc.), not a bulk re-upload.
  bucketConflicts: { row: ParsedRow; existingBucket: string }[];
  // rowNum -> the SPECIFIC existing SHS unit this row matched, one-to-one.
  // IMEI-less rows can only be told apart by (model, supplier, BP, dateIn),
  // and a bulk order of N identical phones is an entirely ordinary case —
  // 5 real units can share that exact tuple. A plain Map<key, unit> only
  // ever remembers the LAST of them, so every one of the N matching rows
  // would resolve to the SAME single doc: N-1 real units silently never
  // written to (or, when the file has MORE rows than existing units for
  // that key, extra genuinely-new units silently never created at all,
  // because they misclassify as "update" against an already-claimed doc
  // instead of falling through to "create"). This map is built by
  // consuming one distinct existing unit per matching row, in file order,
  // so each row gets its own target — handleConfirm MUST use this same
  // map rather than re-deriving its own, or the two can drift apart again.
  shsMatches: Map<number, InventoryUnit>;
  // Rows whose Model is not in the admin catalogue. NOT written — not created,
  // not updated, and their suppliers are not created either, so nothing about a
  // held row reaches the database.
  //
  // This is the gate whose absence got this importer deleted in 2026-08. Every
  // other intake route is bound to the catalogue by a picker, so a model that
  // is not in Configuration cannot be typed into existence; import took
  // whatever the Model column said and created the unit, which is how supplier
  // product codes like "SG TABA (10.1)(T580) 16GB" became permanent model
  // names — unclassifiable, bucketing as their own SKU everywhere, and showing
  // up in Stock Alerts as a phone to reorder that was never stocked.
  //
  // The rest of the file still imports. These rows come back as a downloadable
  // workbook in the same schema, to be fixed and re-uploaded — or the admin
  // adds the model to the catalogue on the spot and they stop being held.
  heldUnknownModel: ParsedRow[];
  // One entry per distinct unknown model, with the rows waiting on it, so the
  // operator resolves a model once rather than row by row.
  unknownModels: { raw: string; brand: string; rowNums: number[] }[];
  // How many distinct models the file covers, counted the way the app buckets
  // them — brand prefix and casing folded away, so "SAMSUNG GALAXY S21",
  // "Galaxy S21" and "S21" are one model. A row count alone says how much
  // stock is in the file and nothing about how much VARIETY, which is the
  // number that tells the operator whether they are looking at the right
  // export at all.
  distinctModels: number;
  // New supplier names that closely resemble one already on file. A WARNING,
  // not a block: the importer creates any supplier it has not seen, which is
  // right — onboarding one is ordinary and there is no curated supplier list to
  // gate against. The cost is that a typo becomes a real supplier and splits
  // that supplier's history in two with nothing to show for it, so the
  // resemblance is surfaced and the operator decides.
  supplierNearMisses: SupplierNearMiss[];
}

/** Coarse bucket label for a unit already in the database, matching the
 *  same taxonomy the scoped Wipe buttons use (wipeScopes.ts) — so "office"
 *  and "shs" here mean exactly what they mean everywhere else in the app. */
function existingUnitBucket(u: InventoryUnit): string {
  if (isOfficeStockUnit(u)) return 'office';
  if (isShsUnit(u)) return 'shs';
  return u.status || 'other';
}

export function buildPreview(
  parsed: ParsedRow[],
  existingUnits: InventoryUnit[],
  existingSuppliers: Supplier[],
  writtenImeis: Set<string>,
  /** Admin model catalogue, from buildCatalogIndex(models). A row whose Model
   *  is not in here is held rather than written — see heldUnknownModel. */
  catalogIndex: Map<string, string> = new Map(),
): PreviewBuckets {
  // An SHS row has no IMEI, so it needs some other way to recognise itself on
  // a second upload — otherwise "re-uploading the same file is safe" stops
  // being true the moment supplier-held stock is involved, and every re-import
  // doubles the holding. Model + supplier + BP + date is what distinguishes
  // one holding line from another; it is also exactly the tuple the operator
  // typed, so two identical rows ARE the same holding.
  const shsKeyOf = (model: string, supplier: string, bp: number, dateIn: string) =>
    [model, supplier].map(v => v.trim().toUpperCase()).join('|') + `|${bp}|${dateIn}`;

  // Every existing SHS unit sharing a key, not just the last one seen — see
  // the shsMatches doc comment on PreviewBuckets for why this must be a
  // pool, not a single slot.
  const shsPoolByKey = new Map<string, InventoryUnit[]>();
  for (const u of existingUnits) {
    if (u.status !== 'incoming' || (u.imei || '').trim()) continue;
    const key = shsKeyOf(u.rawModel || u.model || '', u.supplierName || '', u.buyPrice ?? 0, u.dateIn || '');
    const pool = shsPoolByKey.get(key);
    if (pool) pool.push(u); else shsPoolByKey.set(key, [u]);
  }
  const shsConsumedByKey = new Map<string, number>();
  const shsMatches = new Map<number, InventoryUnit>();

  // MODELS ALREADY ON THE BOOKS COUNT AS KNOWN.
  //
  // The gate's job is to stop a model the app has never heard of from being
  // typed into existence. It is NOT to re-litigate stock that is already here.
  //
  // Asking only "is this in the admin catalogue?" got that wrong in the most
  // visible way possible: the operator downloaded the app's own all-time
  // Inventory Report — 805 rows, every one of them a unit this database
  // already owns — re-uploaded it, and 505 rows were held. Galaxy A32 alone
  // accounted for 214. The catalogue is an admin-curated list that grows when
  // someone adds to it; it has never been a complete census of what is in
  // stock, and a great deal of inventory predates it. Gating on it alone
  // breaks the round trip this importer exists for.
  //
  // So a model is known if the catalogue has it OR some existing unit already
  // carries it. Both sides are compared on the bucket key, which strips brand
  // prefixes and casing, so "SAMSUNG GALAXY S21", "Galaxy S21" and "S21" are
  // one model rather than three.
  //
  // This is a deliberate, bounded loosening: a genuinely new supplier code
  // still has no unit behind it and is still held. What it stops doing is
  // blocking a name the database is already full of.
  const inStockKeys = new Set<string>();
  for (const u of existingUnits) {
    const raw = u.rawModel || u.model || '';
    if (!raw.trim()) continue;
    inStockKeys.add(modelBucketKey(u.brand || '', raw));
    inStockKeys.add(modelBucketKey('', raw));
  }

  const imeiToUnit = new Map<string, InventoryUnit>();
  for (const u of existingUnits) {
    const k = (u.imei || '').trim().toUpperCase();
    if (!k) continue;
    // Skip units we just wrote in this modal session — the live-store
    // listener replays them back into `units` after a successful import,
    // which would otherwise reclassify our just-created rows as "already
    // in inventory" on the next preview rebuild.
    if (writtenImeis.has(k)) continue;
    imeiToUnit.set(k, u);
  }
  const supplierNames = new Set(existingSuppliers.map(s => s.name.trim().toLowerCase()));

  // First pass — track file-internal duplicate IMEIs.
  //
  // SHS rows may legitimately have no IMEI (the supplier has not shipped, so
  // there is no handset to read one off). They are skipped here: two blank
  // IMEIs are not a duplicate, they are two phones on order. Ten of the same
  // model from the same supplier is a normal SHS line.
  const seenInFile = new Map<string, number[]>();
  for (const r of parsed) {
    if (!r.imei || r.errors.length > 0 && r.errors.some(e => e.includes('IMEI'))) continue;
    const arr = seenInFile.get(r.imei) ?? [];
    arr.push(r.rowNum);
    seenInFile.set(r.imei, arr);
  }
  const duplicates: PreviewBuckets['duplicates'] = [];
  for (const [imei, rows] of seenInFile.entries()) {
    if (rows.length > 1) duplicates.push({ imei, rows });
  }

  // Second pass — bucket. Duplicates beyond the first occurrence are flagged
  // invalid so the operator sees them in the invalid list too.
  const firstSeen = new Set<string>();
  const toCreate: ParsedRow[] = [];
  const toUpdate: ParsedRow[] = [];
  const invalid:  ParsedRow[] = [];
  const newSuppliers = new Set<string>();
  const bucketConflicts: PreviewBuckets['bucketConflicts'] = [];
  const heldUnknownModel: ParsedRow[] = [];
  const unknownByKey = new Map<string, { raw: string; brand: string; rowNums: number[] }>();

  for (const r of parsed) {
    const dupInFile = (seenInFile.get(r.imei) || []).length > 1 && firstSeen.has(r.imei);
    if (r.imei) firstSeen.add(r.imei);

    if (r.errors.length > 0) { invalid.push(r); continue; }
    if (dupInFile)            { invalid.push({ ...r, errors: [`Duplicate IMEI in file (also row ${seenInFile.get(r.imei)?.[0]})`] }); continue; }

    // THE CATALOGUE GATE. Before anything else decides what to do with this
    // row, decide whether we are allowed to write it at all. Held rows fall
    // out here — ahead of the create/update matching AND ahead of newSuppliers
    // — so a held row contributes nothing to the write at all.
    const { brand } = parseBrandModelStorage(r.model || '');
    const inCatalogue = resolveCatalogModel(r.model || '', brand || '', catalogIndex).matched;
    const onTheBooks = inStockKeys.has(modelBucketKey(brand || '', r.model || ''))
                    || inStockKeys.has(modelBucketKey('', r.model || ''));
    if (!inCatalogue && !onTheBooks) {
      heldUnknownModel.push(r);
      const raw = (r.model || '').trim();
      // Grouped on the BUCKET key, not the raw string. Grouping by raw text
      // listed "APPLE IPHONE 8" and "IPHONE 8" as two separate unknown models
      // needing two separate catalogue entries, when they are one phone and
      // one entry resolves both.
      const key = modelBucketKey(brand || '', raw);
      const seen = unknownByKey.get(key);
      if (seen) seen.rowNums.push(r.rowNum);
      else unknownByKey.set(key, { raw, brand: (brand || '').trim(), rowNums: [r.rowNum] });
      continue;
    }

    let matched = false;
    if (r.imei) {
      const existing = imeiToUnit.get(r.imei);
      if (existing) {
        matched = true;
        const rowBucket = r.stockType === 'shs' ? 'shs' : 'office';
        const existingBucket = existingUnitBucket(existing);
        if (existingBucket === rowBucket) toUpdate.push(r);
        else                              bucketConflicts.push({ row: r, existingBucket });
      }
    } else {
      // IMEI-less SHS: recognise the same holding line on a re-upload.
      // Always matches within the SHS bucket by construction — shsPoolByKey
      // only ever holds status='incoming' units — so no cross-bucket check
      // is needed here. Consume one distinct existing unit per row so N
      // identical holdings map 1:1 onto N rows instead of all N collapsing
      // onto whichever unit happened to be seen last while building the pool.
      const key = shsKeyOf(r.model, r.supplier, r.buyPrice, r.dateIn);
      const pool = shsPoolByKey.get(key);
      const used = shsConsumedByKey.get(key) ?? 0;
      if (pool && used < pool.length) {
        matched = true;
        shsConsumedByKey.set(key, used + 1);
        shsMatches.set(r.rowNum, pool[used]);
        toUpdate.push(r);
      }
    }
    if (!matched) toCreate.push(r);

    if (r.supplier && !supplierNames.has(r.supplier.toLowerCase())) {
      newSuppliers.add(r.supplier);
    }
  }

  // Every row in the file, not just the importable ones: this is a fact about
  // what was uploaded, so held and invalid rows count too.
  const modelKeys = new Set<string>();
  for (const r of parsed) {
    const m = (r.model || '').trim();
    if (!m) continue;
    modelKeys.add(modelBucketKey(parseBrandModelStorage(m).brand || '', m));
  }

  const newSupplierNames = Array.from(newSuppliers).sort();

  return {
    total: parsed.length,
    distinctModels: modelKeys.size,
    supplierNearMisses: findSupplierNearMisses(
      newSupplierNames, existingSuppliers.map(x => x.name),
    ),
    toCreate, toUpdate, invalid,
    newSuppliers: newSupplierNames,
    duplicates,
    bucketConflicts,
    shsMatches,
    heldUnknownModel,
    unknownModels: Array.from(unknownByKey.values())
      .sort((a, b) => b.rowNums.length - a.rowNums.length || a.raw.localeCompare(b.raw)),
  };
}

export default function InventoryReportImport({ onClose }: Props) {
  const { units, suppliers, models, accessoryStock } = useInventoryStore();
  const [phase, setPhase] = useState<Phase>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parsedAccessoryRows, setParsedAccessoryRows] = useState<ParsedAccessoryRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string>('');
  // Pre-write snapshot of the preview buckets. Captured at handleConfirm time
  // so the Done screen shows what the import actually did — otherwise the
  // memoised preview re-runs after Firestore listeners fire and reclassifies
  // every just-written row, collapsing "5 suppliers added" to 0.
  const [doneStats, setDoneStats] = useState<{
    created: number; updated: number; suppliersAdded: number; skipped: number;
    accessoriesRestored: number; heldUnknownModel: number;
  } | null>(null);
  // Which unknown model is being added to the catalogue, and what the admin
  // has typed for its brand. The model name itself is the file's, verbatim —
  // editing it here would mean the rows waiting on it no longer match.
  const [addingModel, setAddingModel] = useState<string | null>(null);
  const [addBrand, setAddBrand] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  // IMEIs successfully written during this modal session. Filtered out of the
  // dupe-check in buildPreview so the Firestore onSnapshot echo doesn't
  // reclassify our just-created rows as "already in inventory" on rerun.
  // Naturally cleared on unmount.
  const [writtenImeis, setWrittenImeis] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // `models` is live from the store, so adding a model to the catalogue below
  // re-runs this memo and the rows waiting on that model stop being held —
  // no re-upload, no reopening the modal.
  const catalogIndex = useMemo(() => buildCatalogIndex(models), [models]);

  const preview = useMemo(
    () => phase === 'preview' || phase === 'loading' || phase === 'done'
      ? buildPreview(parsedRows, units, suppliers, writtenImeis, catalogIndex)
      : null,
    [parsedRows, units, suppliers, phase, writtenImeis, catalogIndex],
  );

  // Accessory pools are a CREATE-ONLY restore (see restoreAccessoryStockFromImport):
  // a SKU already tracked live is left alone, so only genuinely-missing pools
  // (the post-wipe case) get recreated. Computed here purely to preview which
  // rows will actually do something, before Confirm.
  const accessoryPreview = useMemo(() => {
    if (!(phase === 'preview' || phase === 'loading' || phase === 'done')) return null;
    const existingSkus = new Set(accessoryStock.map(a => a.sku.trim().toUpperCase()));
    const toRestore = parsedAccessoryRows.filter(r => !existingSkus.has(r.sku.trim().toUpperCase()));
    const alreadyTracked = parsedAccessoryRows.length - toRestore.length;
    return { toRestore, alreadyTracked };
  }, [parsedAccessoryRows, accessoryStock, phase]);

  /**
   * Add one unknown model to the admin catalogue, from inside the import.
   *
   * The same write ConfigurationPanel → Models makes, deliberately: one
   * collection, one shape, one meaning of "the catalogue". `createdBy` records
   * that it came from an import so the provenance is visible later.
   *
   * The MODEL STRING IS THE FILE'S, VERBATIM. Correcting it here would be a
   * trap — the held rows still say what they say, so an edited name would not
   * match them and they would stay held with no indication why. Brand is asked
   * for because the parser often cannot infer one, and a catalogue entry
   * without a brand is what the reconciliation screen exists to clean up.
   */
  const addModelToCatalogue = async (rawModel: string) => {
    const model = rawModel.trim();
    const brand = addBrand.trim();
    if (!model || addBusy) return;
    if (!brand) { setAddError('Brand is required'); return; }
    setAddBusy(true);
    setAddError('');
    try {
      const id = `mdl_imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await dbService.create('models', id, {
        brand, model,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email || 'import',
        ownerId: 'shared',
      });
      // No local state to update: dbService.create emits to the store listener,
      // `models` changes, catalogIndex re-memoises and buildPreview re-runs.
      // The rows waiting on this model move out of held on their own.
      setAddingModel(null);
      setAddBrand('');
    } catch (e: any) {
      setAddError(e?.message || 'Could not add the model');
    } finally {
      setAddBusy(false);
    }
  };

  /**
   * Hand the held rows back as a workbook in the SAME schema they arrived in.
   *
   * The point is a round trip: fix the Model column in Excel, re-upload the
   * file, and those rows import. So the headers here must be ones
   * HEADER_ALIASES recognises, and every column the parser reads has to be
   * carried through — a download that dropped Supplier or BP would need
   * re-keying rather than editing.
   *
   * Row Num and Why Held lead the sheet as operator aids. Neither is in
   * HEADER_ALIASES, so both are ignored on re-upload and can be left in place.
   */
  const downloadHeldRows = () => {
    if (!preview?.heldUnknownModel.length) return;
    const rows = preview.heldUnknownModel.map(r => ({
      'Row Num': r.rowNum,
      'Why Held': `"${r.model}" is not in the model catalogue`,
      'Stock In Date': r.dateIn,
      'Model': r.model,
      'IMEI': r.imei,
      'Grade': r.grade,
      'Storage': r.storage,
      'SIM Type': r.simType,
      'Colour': r.colour,
      'Supplier': r.supplier,
      'BP': r.buyPrice,
      'Stock Type': r.stockType === 'shs' ? 'SHS' : 'Office',
      'Notes': r.notes,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Held Rows');
    const base = (fileName || 'inventory').replace(/\.[^.]+$/, '');
    XLSX.writeFile(wb, `${base}-held-rows.xlsx`);
  };

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (!wb.SheetNames.length) throw new Error('Workbook has no sheets');

      // EVERY stock sheet, not just the first — the Inventory Report this
      // importer is the counterpart to downloads as three (Office Stock,
      // SHS Stock, and Accessories when any pools exist).
      const { rows: parsed, skippedSheets, accessoryRows } = parseStockWorkbook(wb);
      if (parsed.length === 0 && accessoryRows.length === 0) {
        throw new Error(
          skippedSheets.length
            ? `No stock rows found. Sheets read: ${skippedSheets.join(', ')} — none had Model + IMEI columns. Check the header row matches the inventory report schema.`
            : 'No data rows found. Check the header row matches the inventory report schema.',
        );
      }
      setParsedRows(parsed);
      setParsedAccessoryRows(accessoryRows);
      setPhase('preview');
    } catch (e: any) {
      setError(e?.message || 'Failed to read file');
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    // Freeze the pre-write counts; the post-write rerun of buildPreview will
    // see the new docs in the store and zero out toCreate / newSuppliers.
    const snapshot = {
      created:        preview.toCreate.length,
      updated:        preview.toUpdate.length,
      suppliersAdded: preview.newSuppliers.length,
      skipped:        preview.invalid.length + preview.bucketConflicts.length,
      accessoriesRestored: accessoryPreview?.toRestore.length ?? 0,
      // Counted apart from `skipped`: a held row is not rejected, it is
      // waiting on a catalogue entry. Saying "skipped" would imply the
      // operator has nothing left to do with it.
      heldUnknownModel: preview.heldUnknownModel.length,
    };
    setPhase('loading');
    setProgress({ done: 0, total: preview.toCreate.length + preview.toUpdate.length });

    // Provenance for the Operations Hub's "Last Import" / "Batch Rows" panels,
    // and the audit trail on each unit.
    //
    // This used to be written by ImportModal, which is no longer rendered
    // anywhere — so through the path the app actually uses, no batch row was
    // ever created and the panel read "No imports yet" no matter how much
    // stock had been loaded. The id is minted first and stamped on every unit;
    // the batch row itself is written only after the units land, so a failed
    // import leaves no row claiming stock that never arrived.
    const importBatchId = dbService.newImportBatchId();

    // Build supplier entries for any new names. We mint synthetic ids prefixed
    // sup_imp_ so they're easy to spot in the data later.
    // Every record is shared-team-owned. firestore.rules gates
    // suppliers + inventoryUnits create/update on ownsShared()
    // (ownerId == 'shared'); writing the user's UID here made every
    // inventory import fail with "Missing or insufficient permissions".
    const ownerId = 'shared';
    const supplierByName = new Map<string, string>();
    for (const s of suppliers) supplierByName.set(s.name.trim().toLowerCase(), s.id);

    const supplierEntries: Array<{ collection: string; id: string; data: any }> = [];
    for (const name of preview.newSuppliers) {
      const id = `sup_imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      supplierByName.set(name.trim().toLowerCase(), id);
      supplierEntries.push({
        collection: 'suppliers',
        id,
        data: { name, portal: 'Direct', ownerId },
      });
    }

    // Snap every model name to the admin catalog spelling on the way in, so
    // data arrives consistent instead of needing a cleanup pass afterwards.
    //
    // Every row reaching here is already known to the catalogue: buildPreview
    // held anything that was not, and toCreate/toUpdate exclude those. So this
    // is a spelling normalisation, not a fallback — canonicaliseModel can no
    // longer be handed something it will pass through untouched.
    // catalogIndex is the memo above, shared with the preview so the two
    // cannot disagree about what the catalogue contains.

    const unitEntries: Array<{ collection: string; id: string; data: any }> = [];
    const toRow = (r: ParsedRow, existing?: InventoryUnit) => {
      const parsed = parseBrandModelStorage(r.model || '');
      const canonicalModel = canonicaliseModel(r.model || '', parsed.brand || '', catalogIndex);
      const supplierId = supplierByName.get(r.supplier.trim().toLowerCase()) || '';
      // An IMEI-less SHS row needs a synthetic id. `manual_shs_` is the
      // prefix the in-app SHS flow already uses, and isManualShsUnit()
      // classifies anything status='incoming' with an `shs_` prefix as a
      // PARSER placeholder — which would hide these rows from the SHS KPI.
      // So follow the manual convention, not the parser one.
      const id = existing?.id
        || (r.imei
          ? `unit_imp_${Date.now()}_${r.rowNum}_${r.imei.slice(0, 6)}`
          : `manual_shs_imp_${Date.now()}_${r.rowNum}`);
      return {
        collection: 'inventoryUnits',
        id,
        data: {
          ...(existing || {}),
          id,
          imei: r.imei,
          model: canonicalModel,
          brand: parsed.brand || existing?.brand || '',
          category: existing?.category || 'phone',
          colour: r.colour || existing?.colour || '',
          storage: r.storage || parsed.storage || existing?.storage || '',
          // Snap casing to the canonical option so a spreadsheet typing
          // "brand new" doesn't create a third spelling of the grade.
          grade: normaliseGrade(r.grade) || existing?.grade || '',
          ...(r.simType ? { simType: normaliseSimType(r.simType) } : {}),
          supplierId,
          supplierName: r.supplier,
          buyPrice: r.buyPrice,
          dateIn: r.dateIn || existing?.dateIn || new Date().toISOString().slice(0, 10),
          // A row tagged SHS is supplier-held: status 'incoming' is what
          // every SHS surface filters on (see lib/shsCount). Never
          // downgrade a unit that already sold — a re-import of an old
          // file must not resurrect it as stock.
          status: existing?.status && existing.status !== 'available'
            ? existing.status
            : (r.stockType === 'shs' ? 'incoming' : 'available'),
          stockSource: r.stockType === 'shs' ? 'shs' : (existing?.stockSource ?? 'office'),
          flags: existing?.flags || [],
          notes: r.notes || existing?.notes || '',
          platformListed: existing?.platformListed ?? false,
          ownerId: existing?.ownerId || ownerId,
          importBatchId,
          sourceFile: fileName,
        },
      };
    };

    const existingByImei = new Map<string, InventoryUnit>();
    for (const u of units) existingByImei.set((u.imei || '').toUpperCase(), u);

    for (const r of preview.toCreate) unitEntries.push(toRow(r));
    // shsMatches came from the SAME pass that produced toUpdate (see
    // buildPreview) — reusing it, rather than re-deriving a second lookup
    // here, is what guarantees N identical SHS holdings write to N distinct
    // docs instead of every row racing to update whichever unit a fresh
    // Map<key, unit> happened to remember last.
    for (const r of preview.toUpdate) {
      const match = r.imei
        ? existingByImei.get(r.imei)
        : preview.shsMatches.get(r.rowNum);
      unitEntries.push(toRow(r, match));
    }

    // Collect normalised IMEIs from the prepared payloads. We flush these
    // into writtenImeis AFTER bulkCreate resolves successfully so a failed
    // write doesn't poison the dupe-check on a retry.
    const justWritten: string[] = [];
    for (const e of unitEntries) {
      const k = String(e.data?.imei || '').trim().toUpperCase();
      if (k) justWritten.push(k);
    }

    try {
      if (supplierEntries.length > 0) await dbService.bulkCreate(supplierEntries);
      if (unitEntries.length > 0) await dbService.bulkCreate(unitEntries, (done, total) => setProgress({ done, total }));
      // Excluded from the dupe-check until the modal unmounts.
      if (justWritten.length) {
        setWrittenImeis(prev => {
          const next = new Set(prev);
          for (const k of justWritten) next.add(k);
          return next;
        });
      }
      // Accessory pools restore CREATE-ONLY (restoreAccessoryStockFromImport
      // no-ops when a pool for the SKU already exists) — safe to run every
      // time, including on a file that also carries ordinary unit rows.
      if (accessoryPreview?.toRestore.length) {
        for (const r of accessoryPreview.toRestore) {
          await restoreAccessoryStockFromImport({
            sku: r.sku,
            name: r.name,
            supplierName: r.supplier || undefined,
            totalReceived: r.totalReceived,
            buyPrice: r.buyPrice,
            notes: r.notes || undefined,
          });
        }
      }
      // Written last, and only on success — see the note where importBatchId
      // is minted.
      if (unitEntries.length > 0) {
        await dbService.createImportBatch({
          id: importBatchId,
          sourceFile: fileName || 'Inventory Report',
          sourceSheet: 'INVENTORY',
          rowCount: unitEntries.length,
          notes: `${snapshot.created} created · ${snapshot.updated} updated`,
        });
      }
      setDoneStats(snapshot);
      setPhase('done');
    } catch (e: any) {
      setError(e?.message || 'Import failed during write');
      setPhase('preview');
    }
  };

  const resetToUpload = () => {
    setPhase('upload');
    setParsedRows([]);
    setParsedAccessoryRows([]);
    setFileName('');
    setError('');
    setProgress({ done: 0, total: 0 });
    setDoneStats(null);
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
        className="bg-white w-full md:max-w-3xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold tracking-tight">Import Inventory Report</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              10-column buy schema · upload → preview → confirm
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* ── Upload phase ─────────────────────────────────────────────── */}
          {phase === 'upload' && (
            <UploadPhase
              error={error}
              fileInputRef={fileInputRef}
              onPick={handleFile}
            />
          )}

          {/* ── Preview phase ────────────────────────────────────────────── */}
          {phase === 'preview' && preview && (
            <PreviewPhase
              preview={preview} fileName={fileName} error={error}
              accessoryPreview={accessoryPreview}
              held={{
                onDownload: downloadHeldRows,
                addingModel, addBrand, addBusy, addError,
                onStartAdd: (raw, brand) => { setAddingModel(raw); setAddBrand(brand); setAddError(''); },
                onCancelAdd: () => { setAddingModel(null); setAddError(''); },
                onBrandChange: setAddBrand,
                onSubmitAdd: addModelToCatalogue,
              }}
            />
          )}

          {/* ── Loading phase ────────────────────────────────────────────── */}
          {phase === 'loading' && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 size={32} className="animate-spin text-emerald-600" />
              <p className="text-[12px] font-bold">Writing {progress.done.toLocaleString()} / {progress.total.toLocaleString()} units…</p>
              <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}

          {/* ── Done phase ───────────────────────────────────────────────── */}
          {phase === 'done' && doneStats && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={36} className="text-emerald-600" />
              <p className="text-sm font-bold text-slate-900">Import complete</p>
              <p className="text-[11px] font-mono text-slate-500">
                {doneStats.created} created · {doneStats.updated} updated · {doneStats.suppliersAdded} suppliers added
                {doneStats.skipped > 0 && <> · {doneStats.skipped} skipped</>}
              </p>
              {doneStats.accessoriesRestored > 0 && (
                <p className="text-[11px] font-mono text-emerald-700">
                  Accessory pools restored: {doneStats.accessoriesRestored}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
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
                disabled={preview.toCreate.length + preview.toUpdate.length === 0 && (accessoryPreview?.toRestore.length ?? 0) === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} />
                {preview.toCreate.length + preview.toUpdate.length > 0
                  ? <>Load {(preview.toCreate.length + preview.toUpdate.length).toLocaleString()} rows</>
                  : <>Restore {(accessoryPreview?.toRestore.length ?? 0).toLocaleString()} accessory pool{(accessoryPreview?.toRestore.length ?? 0) === 1 ? '' : 's'}</>}
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
  error, fileInputRef, onPick,
}: {
  error: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-full border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-2xl py-12 flex flex-col items-center gap-2 text-slate-500 hover:text-emerald-700 transition-all"
      >
        <Upload size={28} />
        <p className="text-[12px] font-bold">Drop a .xlsx or .csv file, or click to pick</p>
        <p className="text-[10px] font-mono text-slate-400">Every stock sheet is read · header row required</p>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
        className="hidden"
      />
      {/* The blank inventory template workbooks were deleted along with the
          importers in 2026-08 and have not come back. The column list below
          is the schema now, and the "Inventory Report" export is the file to
          start from — it round-trips, which a blank template never did. */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
          <FileSpreadsheet size={11} /> Expected columns
        </p>
        <p className="text-[11px] font-mono text-slate-600 leading-relaxed">
          Stock In Date · Model · IMEI · Grade · Storage · SIM Type · Colour · Supplier · BP · Stock Type · Notes
        </p>
        <p className="text-[10px] text-slate-500">
          Match the headers exactly as in the "Inventory Report" export.
          IMEI is matched against the existing database — rows with matching
          IMEIs will UPDATE existing units; rows with new IMEIs will CREATE
          new units. Nothing writes until you confirm the preview.
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
/** Everything the held-on-catalogue panel needs to resolve a model, bundled
 *  so the prop list stays readable. Owned by the parent because adding a
 *  model is a write, and the parent is where the store and phase live. */
interface HeldControls {
  onDownload: () => void;
  addingModel: string | null;
  addBrand: string;
  addBusy: boolean;
  addError: string;
  onStartAdd: (raw: string, brand: string) => void;
  onCancelAdd: () => void;
  onBrandChange: (v: string) => void;
  onSubmitAdd: (raw: string) => void;
}

function PreviewPhase({
  preview, fileName, error, accessoryPreview, held,
}: {
  preview: PreviewBuckets;
  fileName: string;
  error: string;
  accessoryPreview: { toRestore: ParsedAccessoryRow[]; alreadyTracked: number } | null;
  held: HeldControls;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
        <span>
          <FileSpreadsheet size={11} className="inline mr-1" />
          {fileName} · {preview.total.toLocaleString()} {preview.total === 1 ? 'row' : 'rows'}
          {' · '}
          <span
            className="text-slate-700 font-semibold"
            title="Distinct models in this file, counted the way the app groups them: brand prefix and casing folded away, so SAMSUNG GALAXY S21, Galaxy S21 and S21 are one model."
          >
            {preview.distinctModels.toLocaleString()} {preview.distinctModels === 1 ? 'model' : 'models'}
          </span>
        </span>
      </div>

      {/* Accessory pools — a create-only restore, separate from unit rows. */}
      {!!accessoryPreview && (accessoryPreview.toRestore.length > 0 || accessoryPreview.alreadyTracked > 0) && (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2">
          <span className="text-[9px] font-bold uppercase tracking-widest text-indigo-400">Accessories</span>
          {accessoryPreview.toRestore.length > 0 && (
            <span className="text-[10px] font-mono text-indigo-700">
              <strong>{accessoryPreview.toRestore.length}</strong> pool{accessoryPreview.toRestore.length === 1 ? '' : 's'} will be restored
            </span>
          )}
          {accessoryPreview.alreadyTracked > 0 && (
            <span className="text-[10px] font-mono text-indigo-700">
              {accessoryPreview.toRestore.length > 0 && <span className="text-indigo-300 mr-2">·</span>}
              {accessoryPreview.alreadyTracked} already tracked live — left alone
            </span>
          )}
        </div>
      )}

      {/* Office vs SHS split — where these rows will actually land. */}
      {(() => {
        const rows = [...preview.toCreate, ...preview.toUpdate];
        const shs = rows.filter(r => r.stockType === 'shs').length;
        const office = rows.length - shs;
        return (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Lands as</span>
            <span className="text-[10px] font-mono text-slate-700">
              <strong className="text-blue-700">{office.toLocaleString()}</strong> office stock
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-mono text-slate-700">
              <strong className="text-amber-700">{shs.toLocaleString()}</strong> SHS (supplier-held)
            </span>
            {shs === 0 && (
              <span className="text-[9px] font-mono text-slate-400 ml-auto hidden md:inline">
                add a “Stock Type” column with SHS to import supplier-held stock
              </span>
            )}
          </div>
        );
      })()}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
        <SummaryTile
          icon={<PlusCircle size={14} className="text-amber-600" />}
          label="New suppliers"
          value={preview.newSuppliers.length}
          tone="amber"
        />
      </div>

      {/* Detail panels — collapsible-ish.

          Held-on-catalogue leads them: it is the only one with work attached
          that the operator can do from here, and the only one that changes
          what Confirm will write. */}
      {preview.heldUnknownModel.length > 0 && (
        <DetailPanel
          title={`Held · model not in the catalogue · ${preview.heldUnknownModel.length} row${preview.heldUnknownModel.length === 1 ? '' : 's'}`}
          tone="amber"
        >
          <p className="text-[10px] text-amber-800 leading-relaxed mb-2">
            The rest of the file still imports. These rows do not — nothing
            about them is written, not even their suppliers — because their
            Model is not in the admin catalogue. Add the model below and the
            rows join the import immediately, or download them, fix the Model
            column and upload the file again.
          </p>

          <button
            type="button"
            onClick={held.onDownload}
            className="mb-3 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase
                       tracking-widest bg-amber-600 text-white hover:bg-amber-700"
          >
            Download {preview.heldUnknownModel.length} held row{preview.heldUnknownModel.length === 1 ? '' : 's'}
          </button>

          <ul className="space-y-1.5">
            {preview.unknownModels.map(m => (
              <li key={`${m.brand}||${m.raw}`} className="text-[10px] font-mono">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-amber-900 font-semibold">{m.raw || '(no model)'}</span>
                  <span className="text-amber-600">
                    {m.rowNums.length} row{m.rowNums.length === 1 ? '' : 's'} · {m.rowNums.slice(0, 6).join(', ')}
                    {m.rowNums.length > 6 ? ` +${m.rowNums.length - 6}` : ''}
                  </span>
                  {held.addingModel !== m.raw && (
                    <button
                      type="button"
                      onClick={() => held.onStartAdd(m.raw, m.brand)}
                      className="px-2 py-0.5 rounded border border-amber-300 text-amber-800
                                 hover:bg-amber-100 text-[9px] font-bold uppercase tracking-widest"
                    >
                      Add to catalogue
                    </button>
                  )}
                </div>

                {held.addingModel === m.raw && (
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <input
                      autoFocus
                      aria-label={`Brand for ${m.raw}`}
                      value={held.addBrand}
                      onChange={e => held.onBrandChange(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') held.onSubmitAdd(m.raw); }}
                      placeholder="Brand (e.g. Samsung)"
                      className="px-2 py-1 rounded border border-amber-300 text-[10px] w-44"
                    />
                    {/* Shown, not editable: the held rows carry this exact
                        string, so a corrected spelling here would not match
                        them and they would stay held with no explanation. */}
                    <span className="text-amber-700">{m.raw}</span>
                    <button
                      type="button"
                      disabled={held.addBusy}
                      onClick={() => held.onSubmitAdd(m.raw)}
                      className="px-2 py-1 rounded bg-amber-600 text-white text-[9px] font-bold
                                 uppercase tracking-widest disabled:opacity-40"
                    >
                      {held.addBusy ? 'Adding…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={held.onCancelAdd}
                      className="px-2 py-1 rounded text-amber-700 text-[9px] font-bold
                                 uppercase tracking-widest hover:bg-amber-100"
                    >
                      Cancel
                    </button>
                    {held.addError && <span className="text-rose-700">{held.addError}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </DetailPanel>
      )}

      {preview.duplicates.length > 0 && (
        <DetailPanel title="Duplicate IMEIs in file" tone="rose">
          <ul className="space-y-1 text-[10px] font-mono">
            {preview.duplicates.slice(0, 10).map(d => (
              <li key={d.imei} className="text-rose-700">
                {d.imei} — rows {d.rows.join(', ')}
              </li>
            ))}
            {preview.duplicates.length > 10 && (
              <li className="text-rose-500">+{preview.duplicates.length - 10} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.invalid.length > 0 && (
        <DetailPanel title={`Invalid rows · ${preview.invalid.length}`} tone="rose">
          <ul className="space-y-1 text-[10px] font-mono">
            {preview.invalid.slice(0, 15).map(r => (
              <li key={r.rowNum} className="text-rose-700">
                Row {r.rowNum} · {r.model || '(no model)'} — {r.errors.join('; ')}
              </li>
            ))}
            {preview.invalid.length > 15 && (
              <li className="text-rose-500">+{preview.invalid.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.newSuppliers.length > 0 && (
        <DetailPanel title={`New suppliers · ${preview.newSuppliers.length}`} tone="amber">
          {/* ONE LINE PER SUPPLIER, so the count in the title and the number of
              lines below it are the same number.

              They were not. The panel showed "3", then two warnings, then a
              separate comma-separated list of all three — and the operator
              asked where the third had gone. The unflagged name was in the
              list, but two warnings above a blob of three names reads as two
              things, not three. Every new supplier now gets its own row and
              says which of the two it is. */}
          <ul className="space-y-1">
            {preview.newSuppliers.map(name => {
              const miss = preview.supplierNearMisses.find(m => m.candidate === name);
              return (
                <li key={name} className="text-[10px] font-mono flex items-start gap-1.5">
                  {miss ? (
                    <>
                      <AlertTriangle size={11} className="mt-px flex-shrink-0 text-rose-600" />
                      <span className="text-rose-700">
                        <strong>{name}</strong> — did you mean <strong>{miss.match}</strong>?
                        {miss.kind === 'punctuation'
                          ? ' Same letters, different spacing.'
                          : ` ${miss.distance} character${miss.distance === 1 ? '' : 's'} apart.`}
                      </span>
                    </>
                  ) : (
                    <>
                      <PlusCircle size={11} className="mt-px flex-shrink-0 text-amber-500" />
                      <span className="text-amber-700">
                        <strong>{name}</strong>
                        <span className="text-amber-500"> — no close match, treated as genuinely new</span>
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {preview.supplierNearMisses.length > 0 && (
            <p className="text-[9px] text-slate-500 leading-relaxed mt-2">
              Not blocking — all of these will be created as written. Cancel and
              fix the Supplier column if the flagged ones are typos, since a
              misspelled name becomes its own supplier and splits that
              supplier's history.
            </p>
          )}
        </DetailPanel>
      )}

      {preview.toUpdate.length > 0 && (
        <DetailPanel title={`Will update existing units · ${preview.toUpdate.length}`} tone="blue">
          <ul className="space-y-1 text-[10px] font-mono text-blue-700">
            {preview.toUpdate.slice(0, 15).map(r => (
              <li key={r.rowNum}>
                Row {r.rowNum} · {r.model} · IMEI {r.imei}
              </li>
            ))}
            {preview.toUpdate.length > 15 && (
              <li className="text-blue-500">+{preview.toUpdate.length - 15} more</li>
            )}
          </ul>
        </DetailPanel>
      )}

      {preview.bucketConflicts.length > 0 && (
        <DetailPanel title={`Skipped · already exists in a different bucket · ${preview.bucketConflicts.length}`} tone="slate">
          <p className="text-[10px] font-mono text-slate-500 leading-relaxed mb-1.5">
            This IMEI already exists as a unit in a different stock bucket than
            this row declares — neither created (that would duplicate a real
            IMEI) nor updated (that would rewrite a bucket this report doesn't
            own). Use SHS Receive, the sales-orphan completion, or Add Stock to
            change that unit directly.
          </p>
          <ul className="space-y-1 text-[10px] font-mono text-slate-700">
            {preview.bucketConflicts.slice(0, 15).map(({ row: r, existingBucket }) => (
              <li key={r.rowNum}>
                Row {r.rowNum} · {r.model} · IMEI {r.imei} — file says {r.stockType === 'shs' ? 'SHS' : 'office'}, already exists as {existingBucket}
              </li>
            ))}
            {preview.bucketConflicts.length > 15 && (
              <li className="text-slate-500">+{preview.bucketConflicts.length - 15} more</li>
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
  tone: 'emerald' | 'blue' | 'rose' | 'amber';
}) {
  const toneCls = (
    tone === 'emerald' ? 'bg-emerald-50 border-emerald-100 text-emerald-900' :
    tone === 'blue'    ? 'bg-blue-50 border-blue-100 text-blue-900' :
    tone === 'rose'    ? 'bg-rose-50 border-rose-100 text-rose-900' :
                         'bg-amber-50 border-amber-100 text-amber-900'
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
  tone: 'rose' | 'amber' | 'blue' | 'slate';
  children: React.ReactNode;
}) {
  const toneCls = (
    tone === 'rose'  ? 'bg-rose-50/60 border-rose-200' :
    tone === 'amber' ? 'bg-amber-50/60 border-amber-200' :
    tone === 'slate' ? 'bg-slate-50/60 border-slate-200' :
                       'bg-blue-50/60 border-blue-200'
  );
  return (
    <div className={`${toneCls} border rounded-xl p-3 space-y-1.5`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700">{title}</p>
      {children}
    </div>
  );
}
