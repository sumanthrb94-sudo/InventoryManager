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
 * sheets are consumed. Composite Sale ID (`${marketplace}__${orderNumber}`)
 * gives natural upsert semantics so re-importing the same file is safe.
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
import { auth } from '../lib/firebase';

interface Props { onClose: () => void; }

type Phase = 'upload' | 'preview' | 'loading' | 'done';

interface PreviewBuckets {
  total: number;
  perSheet: Record<Marketplace, number>;
  toCreate: ParsedSales['sales'];   // composite ID not seen in DB
  toUpdate: ParsedSales['sales'];   // composite ID already in DB
  invalid:  ParsedSales['errors'];  // parser-side validation failures
  duplicatesInFile: { id: string; rows: number[] }[];
}

function buildPreview(
  parsed: ParsedSales,
  existingSales: Sale[],
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

  return {
    total: parsed.sales.length,
    perSheet: parsed.perSheetCounts,
    toCreate,
    toUpdate,
    invalid: parsed.errors,
    duplicatesInFile: dupes,
  };
}

export default function SalesReportImport({ onClose }: Props) {
  const { sales } = useInventoryStore();
  const [phase, setPhase] = useState<Phase>('upload');
  const [parsed, setParsed] = useState<ParsedSales | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(
    () => phase === 'preview' || phase === 'loading' || phase === 'done'
      ? (parsed ? buildPreview(parsed, sales) : null)
      : null,
    [parsed, sales, phase],
  );

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
            <PreviewPhase preview={preview} fileName={fileName} error={error} />
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
              </p>
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
                disabled={preview.toCreate.length + preview.toUpdate.length === 0}
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
          Sales are matched by composite ID <span className="font-mono">marketplace__orderNumber__imei</span>
          {' '}(so one order can hold multiple phones/SKUs). Rows matching an existing ID will UPDATE; new rows will CREATE. Nothing writes until you
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
  preview, fileName, error,
}: {
  preview: PreviewBuckets;
  fileName: string;
  error: string;
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
  tone: 'rose' | 'blue';
  children: React.ReactNode;
}) {
  const toneCls = (
    tone === 'rose' ? 'bg-rose-50/60 border-rose-200' :
                      'bg-blue-50/60 border-blue-200'
  );
  return (
    <div className={`${toneCls} border rounded-xl p-3 space-y-1.5`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700">{title}</p>
      {children}
    </div>
  );
}
