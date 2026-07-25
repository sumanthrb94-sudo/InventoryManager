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
import { buildCatalogIndex, canonicaliseModel } from '../lib/modelReconciliation';
import { normaliseGrade, normaliseSimType } from '../lib/unitConstants';
import { isAppleDevice, isValidImei } from '../lib/imeiValidation';
import { auth } from '../lib/firebase';

interface Props { onClose: () => void; }

type Phase = 'upload' | 'preview' | 'loading' | 'done';

interface ParsedRow {
  rowNum: number;          // 1-indexed row in the file (header is 0)
  dateIn: string;          // ISO YYYY-MM-DD; empty if missing
  model: string;
  imei: string;            // trimmed, uppercased
  grade: string;
  storage: string;
  simType: string;         // Physical SIM / eSIM / Dual SIM / Not Applicable
  colour: string;
  supplier: string;        // raw supplier name string
  buyPrice: number;        // parsed numeric; 0 if missing
  stockType: 'office' | 'shs';   // 'shs' = supplier-held, lands as incoming
  notes: string;
  errors: string[];        // per-row validation messages
}

interface PreviewBuckets {
  total: number;
  toCreate: ParsedRow[];   // imei not in DB
  toUpdate: ParsedRow[];   // imei found in DB
  invalid:  ParsedRow[];   // missing required / invalid imei / dup-in-file
  newSuppliers: string[];  // distinct supplier names not in DB
  duplicates: { imei: string; rows: number[] }[];
}

// ── Header alias table — case-insensitive, whitespace-tolerant ──────────────
// Maps every reasonable column-name variant the operator might paste into the
// canonical field name. Anything not in this map gets ignored on import.
const HEADER_ALIASES: Record<string, keyof Omit<ParsedRow, 'rowNum' | 'errors'>> = {
  'stock in date': 'dateIn',
  'stockindate':   'dateIn',
  'stock in':      'dateIn',
  'date in':       'dateIn',
  'datein':        'dateIn',
  'date':          'dateIn',
  'model':         'model',
  'imei':          'imei',
  'serial':        'imei',
  'imei/serial':   'imei',
  'imei / serial': 'imei',
  'grade':         'grade',
  'storage':       'storage',
  'sim type':      'simType',
  'simtype':       'simType',
  'sim':           'simType',
  'colour':        'colour',
  'color':         'colour',
  'supplier':      'supplier',
  'stock type':    'stockType',
  'stocktype':     'stockType',
  'stock status':  'stockType',
  'shs':           'stockType',
  'holding':       'stockType',
  'bp':            'buyPrice',
  'bp (£)':        'buyPrice',
  'buy price':     'buyPrice',
  'buying price':  'buyPrice',
  'notes':         'notes',
  'note':          'notes',
};

function normalizeHeader(h: string): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function excelSerialToISO(v: any): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      return new Date(Date.UTC(d.y, d.m - 1, d.d)).toISOString().slice(0, 10);
    } catch { /* fall through */ }
  }
  const s = String(v).trim();
  if (!s) return '';
  // ISO-ish — accept as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

function parseNumber(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseSheet(rows: any[][]): ParsedRow[] {
  if (rows.length < 2) return [];
  const headerRow = rows[0].map(normalizeHeader);
  const colIndex: Partial<Record<keyof Omit<ParsedRow, 'rowNum' | 'errors'>, number>> = {};
  headerRow.forEach((h: string, i: number) => {
    const field = HEADER_ALIASES[h];
    if (field && colIndex[field] === undefined) colIndex[field] = i;
  });

  const result: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c == null || String(c).trim() === '')) continue; // skip blank
    const get = (k: keyof Omit<ParsedRow, 'rowNum' | 'errors'>) => {
      const idx = colIndex[k];
      return idx === undefined ? '' : r[idx];
    };
    const dateIn   = excelSerialToISO(get('dateIn'));
    const model    = String(get('model') ?? '').trim();
    const imei     = String(get('imei') ?? '').trim().toUpperCase();
    const grade    = String(get('grade') ?? '').trim();
    const storage  = String(get('storage') ?? '').trim();
    const simType  = String(get('simType') ?? '').trim();
    const colour   = String(get('colour') ?? '').trim();
    const supplier = String(get('supplier') ?? '').trim();
    const buyPrice = parseNumber(get('buyPrice'));
    const notes    = String(get('notes') ?? '').trim();
    // Supplier-held stock. Accept the words operators actually type, plus
    // a bare Y/YES under an "SHS" header. Anything else is office stock.
    const stockTypeRaw = String(get('stockType') ?? '').trim().toUpperCase();
    const stockType: 'office' | 'shs' =
      /^(SHS|INCOMING|SUPPLIER|SUPPLIER HELD|SUPPLIER-HELD|Y|YES|TRUE|1)$/.test(stockTypeRaw)
        ? 'shs' : 'office';

    const errors: string[] = [];
    if (!model)     errors.push('Model is required');
    if (!imei)      errors.push('IMEI is required');
    else {
      const apple = isAppleDevice(model);
      if (!isValidImei(imei, { isAppleSerial: apple })) errors.push('IMEI not valid (15 digits, or 10-12 char alphanumeric serial)');
    }
    if (!supplier)  errors.push('Supplier is required');
    if (buyPrice <= 0) errors.push('BP must be greater than 0');

    result.push({ rowNum: i + 1, dateIn, model, imei, grade, storage, simType, colour, supplier, buyPrice, stockType, notes, errors });
  }
  return result;
}

function buildPreview(
  parsed: ParsedRow[],
  existingUnits: InventoryUnit[],
  existingSuppliers: Supplier[],
  writtenImeis: Set<string>,
): PreviewBuckets {
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

  for (const r of parsed) {
    const dupInFile = (seenInFile.get(r.imei) || []).length > 1 && firstSeen.has(r.imei);
    if (r.imei) firstSeen.add(r.imei);

    if (r.errors.length > 0) { invalid.push(r); continue; }
    if (dupInFile)            { invalid.push({ ...r, errors: [`Duplicate IMEI in file (also row ${seenInFile.get(r.imei)?.[0]})`] }); continue; }

    if (imeiToUnit.has(r.imei)) toUpdate.push(r);
    else                        toCreate.push(r);

    if (r.supplier && !supplierNames.has(r.supplier.toLowerCase())) {
      newSuppliers.add(r.supplier);
    }
  }

  return {
    total: parsed.length,
    toCreate, toUpdate, invalid,
    newSuppliers: Array.from(newSuppliers).sort(),
    duplicates,
  };
}

export default function InventoryReportImport({ onClose }: Props) {
  const { units, suppliers, models } = useInventoryStore();
  const [phase, setPhase] = useState<Phase>('upload');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string>('');
  // Pre-write snapshot of the preview buckets. Captured at handleConfirm time
  // so the Done screen shows what the import actually did — otherwise the
  // memoised preview re-runs after Firestore listeners fire and reclassifies
  // every just-written row, collapsing "5 suppliers added" to 0.
  const [doneStats, setDoneStats] = useState<{
    created: number; updated: number; suppliersAdded: number; skipped: number;
  } | null>(null);
  // IMEIs successfully written during this modal session. Filtered out of the
  // dupe-check in buildPreview so the Firestore onSnapshot echo doesn't
  // reclassify our just-created rows as "already in inventory" on rerun.
  // Naturally cleared on unmount.
  const [writtenImeis, setWrittenImeis] = useState<Set<string>>(() => new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(
    () => phase === 'preview' || phase === 'loading' || phase === 'done'
      ? buildPreview(parsedRows, units, suppliers, writtenImeis)
      : null,
    [parsedRows, units, suppliers, phase, writtenImeis],
  );

  const handleFile = async (file: File) => {
    setError('');
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('Workbook has no sheets');
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true, defval: '' });
      const parsed = parseSheet(rows);
      if (parsed.length === 0) throw new Error('No data rows found. Check the header row matches the inventory report schema.');
      setParsedRows(parsed);
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
      skipped:        preview.invalid.length,
    };
    setPhase('loading');
    setProgress({ done: 0, total: preview.toCreate.length + preview.toUpdate.length });

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

    // Snap every model name to the admin catalog on the way in, so data
    // arrives consistent instead of needing a cleanup pass afterwards.
    // Unknown models import exactly as typed.
    const catalogIndex = buildCatalogIndex(models);

    const unitEntries: Array<{ collection: string; id: string; data: any }> = [];
    const toRow = (r: ParsedRow, existing?: InventoryUnit) => {
      const parsed = parseBrandModelStorage(r.model || '');
      const canonicalModel = canonicaliseModel(r.model || '', parsed.brand || '', catalogIndex);
      const supplierId = supplierByName.get(r.supplier.trim().toLowerCase()) || '';
      const id = existing?.id || `unit_imp_${Date.now()}_${r.rowNum}_${r.imei.slice(0, 6)}`;
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
        },
      };
    };

    const existingByImei = new Map<string, InventoryUnit>();
    for (const u of units) existingByImei.set((u.imei || '').toUpperCase(), u);

    for (const r of preview.toCreate) unitEntries.push(toRow(r));
    for (const r of preview.toUpdate) unitEntries.push(toRow(r, existingByImei.get(r.imei)));

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
      await dbService.bulkCreate(unitEntries, (done, total) => setProgress({ done, total }));
      // Excluded from the dupe-check until the modal unmounts.
      if (justWritten.length) {
        setWrittenImeis(prev => {
          const next = new Set(prev);
          for (const k of justWritten) next.add(k);
          return next;
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
            <PreviewPhase preview={preview} fileName={fileName} error={error} />
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
                disabled={preview.toCreate.length + preview.toUpdate.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} /> Load {(preview.toCreate.length + preview.toUpdate.length).toLocaleString()} rows
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
        <p className="text-[10px] font-mono text-slate-400">First sheet only · header row required</p>
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

      {/* Detail panels — collapsible-ish */}
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
          <p className="text-[10px] font-mono text-amber-700 leading-relaxed">
            {preview.newSuppliers.join(', ')}
          </p>
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
  tone: 'rose' | 'amber' | 'blue';
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
