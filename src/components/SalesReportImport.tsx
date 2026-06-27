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
import React, { useState, useMemo, useRef } from 'react';
import {
  X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2,
  PlusCircle, RefreshCw, AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import type { Sale, Marketplace } from '../types';
import { MARKETPLACES } from '../types';
import { parseSalesWorkbook, type ParsedSales } from '../lib/salesImport';
import { buildPostImportSyncPatches } from '../services/salesService';
import { addSoldUnitFromSale, completeUnitBuyInfo } from '../services/inventoryService';
import { auth } from '../lib/firebase';

interface Props { onClose: () => void; }

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
  colour: string;
  storage: string;
  supplierName: string;
  buyPrice: number;
  /** Per-unit fulfilment source — operator picks Office Stock or SHS so the
   *  sold unit is classified and SHS stays filterable as its own component. */
  stockSource: 'office' | 'shs';
  /** Sale-level facts the panel can't edit (must be fixed in the sheet);
   *  used to show un-editable blockers. */
  saleDate: string;
}

/** Required-field audit check for a sold record. Returns the list of missing
 *  field labels — empty array means audit-complete. The single source of
 *  truth for both the preview's blocker list and the live Confirm gate. */
export function auditRowMissing(r: {
  imei: string; model: string; supplierName: string;
  buyPrice: number; salePrice: number; saleDate: string;
  marketplace: string; orderNumber: string;
}): string[] {
  const missing: string[] = [];
  // The gate checks PRESENCE of required audit fields. Strict IMEI/serial
  // FORMAT validation happens at unit creation/patch time (addSoldUnitFromSale
  // / completeUnitBuyInfo), which reject a malformed identifier with a clear
  // message — surfaced as a confirm-time failure if one slips through.
  if (!(r.imei || '').trim()) missing.push('IMEI');
  if (!(r.model || '').trim()) missing.push('model');
  if (!(r.supplierName || '').trim()) missing.push('supplier');
  if (!(Number(r.buyPrice) > 0)) missing.push('buy price');
  if (!(Number(r.salePrice) > 0)) missing.push('sale price');
  if (!(r.saleDate || '').trim()) missing.push('sale date');
  if (!(r.marketplace || '').trim()) missing.push('marketplace');
  if (!(r.orderNumber || '').trim()) missing.push('order number');
  return missing;
}

export function buildPreview(
  parsed: ParsedSales,
  existingSales: Sale[],
  units: ReturnType<typeof useInventoryStore>['units'],
): PreviewBuckets {
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
    const model = (matched?.model || s.sku || '').trim();
    const supplierName = (matched?.supplierName || s.supplierName || '').trim();
    const buyPrice = matched?.buyPrice ?? s.buyPrice ?? 0;
    const colour = matched?.colour && matched.colour !== 'Unknown' ? matched.colour : '';
    const storage = matched?.storage || '';

    const missing = auditRowMissing({
      imei: s.imei || '', model, supplierName, buyPrice,
      salePrice: s.salePrice ?? 0, saleDate: s.saleDate || '',
      marketplace: s.marketplace, orderNumber: s.orderNumber || '',
    });

    // A matched, already-complete unit needs no completion row — it just
    // flips. Only surface matched units when something's missing. Orphans
    // (no matched unit) ALWAYS need a row (a unit must be created).
    if (matched && missing.length === 0) continue;

    seenAuditKey.add(imeiKey);
    recordsToComplete.push({
      saleId: s.id,
      orderNumber: s.orderNumber || '',
      marketplace: s.marketplace,
      salePrice: s.salePrice ?? 0,
      existingUnitId: matched?.id,
      imei: (s.imei || '').trim(),
      imeiReadOnly: true,              // device sales always carry an IMEI here
      sku: s.sku || '',
      model,
      colour,
      storage,
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

  return {
    total: parsed.sales.length,
    perSheet: parsed.perSheetCounts,
    toCreate,
    toUpdate,
    invalid: parsed.errors,
    duplicatesInFile: dupes,
    inventoryFlips,
    staleCombined,
    recordsToComplete,
  };
}

export default function SalesReportImport({ onClose }: Props) {
  const { sales, units } = useInventoryStore();
  const [phase, setPhase] = useState<Phase>('upload');
  const [parsed, setParsed] = useState<ParsedSales | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState('');
  /** Counts populated after a successful import. `unitsMarkedSold` is
   *  the side-effect from the import → inventory sync (Bug B); shown
   *  on the Done screen so the operator sees the buy-side reconciled.
   *  `unitsAddedFromOrphanSales` counts the inventory rows the operator
   *  opted to auto-create from sales that had no matching IMEI.
   *  `staleDeleteFailed` counts stale-combined deletions that Firestore
   *  rules denied (e.g. non-admin user trying to delete sales) — surfaced
   *  to the operator so the Done screen doesn't lie about the cleanup. */
  const [syncStats, setSyncStats] = useState<{
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
  }>({ unitsMarkedSold: 0, salesLinked: 0, unitsAddedFromOrphanSales: 0, unitsAddFailed: 0, unitsAddFailedDetails: [], staleDeleted: 0, staleDeleteFailed: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [auditEdits, setAuditEdits] = useState<AuditCompletionRow[]>([]);

  const preview = useMemo(
    () => phase === 'preview' || phase === 'loading' || phase === 'done'
      ? (parsed ? buildPreview(parsed, sales, units) : null)
      : null,
    [parsed, sales, units, phase],
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
  const auditBlockers = auditEdits.filter(r => auditRowMissing(r).length > 0).length;

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const out = await parseSalesWorkbook(file, file.name);
      if (out.sales.length === 0 && out.errors.length === 0) {
        throw new Error('No AMAZON / BM / EBAY / ONBUY sheets found in this workbook.');
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
    const entries = [...preview.toCreate, ...preview.toUpdate].map(s => ({
      collection: 'sales',
      id: s.id,
      data: {
        ...s,
        importBatchId: `inv-${Date.now()}`,
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
    }));
    setProgress({ done: 0, total: entries.length });
    try {
      await dbService.bulkCreate(entries, (done, total) => setProgress({ done, total }));
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
      let staleDeleted = 0;
      let staleFailed = 0;
      if (preview.staleCombined.length) {
        const res = await dbService.bulkDelete(
          preview.staleCombined.map(s => ({ collection: 'sales', id: s.id })),
        );
        staleDeleted = res.deleted;
        staleFailed = res.failed;
      }

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
      let unitsAddedFromOrphanSales = 0;
      let unitsAddFailed = 0;
      const unitsAddFailedDetails: Array<{ imei: string; orderNumber: string; reason: string }> = [];
      if (preview.recordsToComplete.length > 0) {
        const allImportedSales = [...preview.toCreate, ...preview.toUpdate];
        const saleById = new Map(allImportedSales.map(s => [s.id, s]));
        for (const row of auditEdits) {
          const sale = saleById.get(row.saleId);
          if (!sale) {
            unitsAddFailed++;
            unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: 'sale lookup failed (id missing)' });
            continue;
          }
          const stillMissing = auditRowMissing(row);
          if (stillMissing.length > 0) {
            unitsAddFailed++;
            unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: `missing ${stillMissing.join(', ')}` });
            continue;
          }
          const imei = row.imei.trim();
          let res;
          if (row.existingUnitId) {
            // PATCH the matched unit's buy-side info for audit completeness.
            res = await completeUnitBuyInfo({
              unitId: row.existingUnitId,
              model: row.model.trim(),
              colour: row.colour.trim() || undefined,
              storage: row.storage.trim() || undefined,
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
              supplierName: row.supplierName.trim(),
              buyPrice: row.buyPrice,
              stockSource: row.stockSource,
            });
          }
          if (res.ok) {
            unitsAddedFromOrphanSales++;
          } else {
            unitsAddFailed++;
            unitsAddFailedDetails.push({ imei: row.imei, orderNumber: row.orderNumber, reason: res.message || res.error || 'unknown' });
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
      const allImported = [...preview.toCreate, ...preview.toUpdate];
      const { unitPatches, salePatches } = buildPostImportSyncPatches(allImported, units);
      if (unitPatches.length || salePatches.length) {
        await dbService.bulkCreate([...unitPatches, ...salePatches]);
      }
      setSyncStats({
        unitsMarkedSold: unitPatches.length,
        salesLinked: salePatches.length,
        unitsAddedFromOrphanSales,
        unitsAddFailed,
        unitsAddFailedDetails,
        staleDeleted,
        staleDeleteFailed: staleFailed,
      });
      setPhase('done');
    } catch (e: any) {
      setError(e?.message || 'Import failed during write');
      setPhase('preview');
    }
  };

  const resetToUpload = () => {
    setPhase('upload');
    setParsed(null);
    setFileName('');
    setError('');
    setProgress({ done: 0, total: 0 });
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
            <h3 className="text-sm font-bold tracking-tight">Import Sales Report</h3>
            <p className="text-[10px] font-mono text-slate-400 mt-0.5">
              4-platform xlsx · upload → preview → confirm
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {phase === 'upload' && (
            <UploadPhase error={error} fileInputRef={fileInputRef} onPick={handleFile} />
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
            />
          )}

          {phase === 'loading' && (
            <div className="py-12 flex flex-col items-center gap-3 text-slate-500">
              <Loader2 size={32} className="animate-spin text-emerald-600" />
              <p className="text-[12px] font-bold">
                Writing {progress.done.toLocaleString()} / {progress.total.toLocaleString()} sales…
              </p>
              <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
                />
              </div>
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
              && syncStats.unitsAddFailed === 0;
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
                  {preview.toCreate.length} created · {preview.toUpdate.length} updated
                  {preview.invalid.length > 0 && <> · {preview.invalid.length} skipped</>}
                  {syncStats.staleDeleted > 0 && <> · {syncStats.staleDeleted} stale rows cleaned</>}
                </p>
                {syncStats.staleDeleteFailed > 0 && (
                  <p className="text-[10px] font-mono text-rose-700 mt-1">
                    ⚠ {syncStats.staleDeleteFailed} stale row{syncStats.staleDeleteFailed === 1 ? '' : 's'} could not be deleted (Firestore rules require admin for sales delete). They'll reappear on the next snapshot.
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
        <p className="text-[12px] font-bold">Drop a SALES_REPORT.xlsx, or click to pick</p>
        <p className="text-[10px] font-mono text-slate-400">
          AMAZON / BM / EBAY / ONBUY sheets · the ALL sheet is ignored
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
  auditEdits, onAuditEdit,
}: {
  preview: PreviewBuckets;
  fileName: string;
  error: string;
  flipsAcked: boolean;
  onAckChange: (v: boolean) => void;
  auditEdits: AuditCompletionRow[];
  onAuditEdit: (saleId: string, patch: Partial<AuditCompletionRow>) => void;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
        <span>
          <FileSpreadsheet size={11} className="inline mr-1" />
          {fileName} · {preview.total.toLocaleString()} {preview.total === 1 ? 'row' : 'rows'}
        </span>
      </div>

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

      {/* Per-platform counts — confirms every sheet was found and parsed */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {MARKETPLACES.map(m => (
          <div key={m} className="bg-white border border-slate-200 rounded-xl px-3 py-2">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{m}</p>
            <p className="text-base font-bold text-slate-900">{(preview.perSheet[m] ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

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
        const incomplete = auditEdits.filter(o => auditRowMissing(o).length > 0).length;
        const ready = auditEdits.length - incomplete;
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
            </div>
          </div>

          <div className="bg-white border border-orange-200 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-orange-100 text-[9px] font-mono uppercase tracking-widest text-orange-900 bg-orange-50/60 grid grid-cols-12 gap-2">
              <span className="col-span-3">IMEI · Source · Order</span>
              <span className="col-span-3">Model</span>
              <span className="col-span-1">Colour</span>
              <span className="col-span-1">Storage</span>
              <span className="col-span-2">Supplier</span>
              <span className="col-span-1 text-right">BP £</span>
              <span className="col-span-1 text-right">SP £</span>
            </div>
            <ul className="max-h-72 overflow-auto divide-y divide-orange-50 text-[11px]">
              {auditEdits.map(o => {
                const missing = auditRowMissing(o);
                const rowIncomplete = missing.length > 0;
                const needImei = !/^\d{15}$/.test((o.imei || '').trim().toUpperCase()) && !/^[A-Z0-9]{10,12}$/.test((o.imei || '').trim().toUpperCase());
                return (
                  <li
                    key={o.saleId}
                    className={`px-3 py-1.5 grid grid-cols-12 gap-2 items-center ${rowIncomplete ? 'bg-rose-50/70' : ''}`}
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
                    </span>
                    <input
                      className={`col-span-3 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500 ${!o.model.trim() ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
                      value={o.model}
                      placeholder="Model required"
                      onChange={e => onAuditEdit(o.saleId, { model: e.target.value })}
                    />
                    <input
                      className="col-span-1 border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500"
                      value={o.colour}
                      placeholder="—"
                      onChange={e => onAuditEdit(o.saleId, { colour: e.target.value })}
                    />
                    <input
                      className="col-span-1 border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500"
                      value={o.storage}
                      placeholder="—"
                      onChange={e => onAuditEdit(o.saleId, { storage: e.target.value })}
                    />
                    <input
                      className={`col-span-2 border rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-orange-500 ${!o.supplierName.trim() ? 'border-rose-400 bg-rose-50' : 'border-slate-200'}`}
                      value={o.supplierName}
                      placeholder="Supplier required"
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
