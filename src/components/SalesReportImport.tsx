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
    if (u.status === 'returned' || u.status === 'incoming') continue;
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
  const importedOrderKeys = new Set(
    parsed.sales
      .filter(s => s.orderNumber)
      .map(s => `${s.marketplace}__${(s.orderNumber || '').trim()}`),
  );
  // IDs we're about to (re)write — never delete a doc we're also writing.
  const writingIds = new Set([...toCreate, ...toUpdate].map(s => s.id));
  const staleCombined: PreviewBuckets['staleCombined'] = [];
  for (const ex of existingSales) {
    const imei = (ex.imei || '').trim();
    if (!imei.includes('/')) continue;                       // not a combined doc
    const key = `${ex.marketplace}__${(ex.orderNumber || '').trim()}`;
    if (!importedOrderKeys.has(key)) continue;               // order not in this upload
    if (writingIds.has(ex.id)) continue;                     // being rewritten, keep
    staleCombined.push({
      id: ex.id,
      orderNumber: ex.orderNumber || '',
      imei,
      salePrice: ex.salePrice ?? 0,
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
   *  on the Done screen so the operator sees the buy-side reconciled. */
  const [syncStats, setSyncStats] = useState<{ unitsMarkedSold: number; salesLinked: number }>({ unitsMarkedSold: 0, salesLinked: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        ownerId: auth.currentUser?.uid || 'shared',
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
      if (preview.staleCombined.length) {
        await dbService.bulkDelete(
          preview.staleCombined.map(s => ({ collection: 'sales', id: s.id })),
        );
      }
      // Bug B sync — after sales land in Firestore, mark every matching
      // InventoryUnit as sold and link sale.unitId. Operator no longer
      // has to manually flip statuses to reconcile inventory with
      // imported sales. Skipped sales (voided, no-imei, returned/incoming
      // unit) are silently ignored, see buildPostImportSyncPatches docs.
      const allImported = [...preview.toCreate, ...preview.toUpdate];
      const { unitPatches, salePatches } = buildPostImportSyncPatches(allImported, units);
      if (unitPatches.length || salePatches.length) {
        await dbService.bulkCreate([...unitPatches, ...salePatches]);
      }
      setSyncStats({ unitsMarkedSold: unitPatches.length, salesLinked: salePatches.length });
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

          {phase === 'done' && preview && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={36} className="text-emerald-600" />
              <p className="text-sm font-bold text-slate-900">Import complete</p>
              <p className="text-[11px] font-mono text-slate-500">
                {preview.toCreate.length} created · {preview.toUpdate.length} updated
                {preview.invalid.length > 0 && <> · {preview.invalid.length} skipped</>}
                {preview.staleCombined.length > 0 && <> · {preview.staleCombined.length} stale rows cleaned</>}
              </p>
              {(syncStats.unitsMarkedSold > 0 || syncStats.salesLinked > 0) && (
                <p className="text-[10px] font-mono text-emerald-700 mt-1">
                  Inventory synced ·{' '}
                  {syncStats.unitsMarkedSold > 0 && <>{syncStats.unitsMarkedSold} unit{syncStats.unitsMarkedSold === 1 ? '' : 's'} marked sold</>}
                  {syncStats.unitsMarkedSold > 0 && syncStats.salesLinked > 0 && ' · '}
                  {syncStats.salesLinked > 0 && <>{syncStats.salesLinked} sale{syncStats.salesLinked === 1 ? '' : 's'} linked</>}
                </p>
              )}
            </div>
          )}
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
                }
                title={
                  preview.inventoryFlips.length > 0 && !flipsAcked
                    ? `Tick the acknowledgement to confirm ${preview.inventoryFlips.length} in-stock unit${preview.inventoryFlips.length === 1 ? '' : 's'} will be flipped to sold.`
                    : undefined
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} /> Load {(preview.toCreate.length + preview.toUpdate.length).toLocaleString()} sales
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
}: {
  preview: PreviewBuckets;
  fileName: string;
  error: string;
  flipsAcked: boolean;
  onAckChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-[11px] font-mono text-slate-500">
        <span>
          <FileSpreadsheet size={11} className="inline mr-1" />
          {fileName} · {preview.total.toLocaleString()} {preview.total === 1 ? 'row' : 'rows'}
        </span>
      </div>

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
                {preview.inventoryFlips.length} in-stock unit{preview.inventoryFlips.length === 1 ? '' : 's'} will be flipped to SOLD
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                These units have IMEIs that match sales in the file. Confirming the
                import will mark them as sold and remove them from "All Office Stock"
                (e.g. 215 → {215 - preview.inventoryFlips.length}). If any IMEI is
                wrong, fix the sales sheet first or void the sale after import to
                restore the unit.
              </p>
            </div>
          </div>

          <div className="bg-white border border-amber-200 rounded-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-amber-100 text-[9px] font-mono uppercase tracking-widest text-amber-900 bg-amber-50/60">
              Units that will flip
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
            I've reviewed the list — flip the {preview.inventoryFlips.length} unit{preview.inventoryFlips.length === 1 ? '' : 's'} to sold.
          </label>
        </div>
      )}

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
        <DetailPanel title={`Stale combined rows to clean up · ${preview.staleCombined.length}`} tone="amber">
          <p className="text-[10px] text-amber-800 mb-1.5">
            These bulk orders were previously stored as one row holding every
            IMEI. This upload splits them into one row per IMEI, so the old
            combined rows below are deleted on confirm (fixes double-counted
            revenue and 4-unit orders showing as 1-2 rows).
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
