import React, { useCallback, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X, Upload, Package, DollarSign, CheckCircle2, AlertTriangle, Loader2,
  ArrowRight, FileSpreadsheet, Link2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import type { Supplier } from '../types';
import {
  parseClientBulkSheet,
  parseOGStockSheet,
  detectFormat,
  mergeSuppliers,
  ParsedData,
} from './ImportModal';
import { parseSalesWorkbook, ParsedSales } from '../lib/salesImport';
import { uploadSourceAttachment } from '../lib/fileAttachments';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface Props { onClose: () => void; }

// Sheet name signatures used to auto-route a dropped workbook into the right slot.
const SALES_SHEETS = [
  'AMAZON', 'BM', 'EBAY', 'ONBUY',
  'AMAZON SALES', 'BM SALES', 'EBAY SALES', 'ONBUY SALES',
];
const INVENTORY_SHEETS = ['INVENTORY', 'IMEI NUMBERS', 'OG STOCK DATA'];

type SlotKind = 'inventory' | 'sales';

/**
 * detectSlot — inspect a workbook's sheet names and return which slot the file
 * belongs in. The rule mirrors what the legacy ImportModal does at processFile
 * time but exposes it as a pure function so we can run auto-swap before parsing.
 */
function detectSlot(sheetNames: string[]): SlotKind | undefined {
  const upper = sheetNames.map(n => n.trim().toUpperCase());
  if (upper.some(n => SALES_SHEETS.includes(n))) return 'sales';
  if (upper.some(n => INVENTORY_SHEETS.includes(n))) return 'inventory';
  return undefined;
}

interface InventorySlotState {
  file: File;
  parsed: ParsedData;
}
interface SalesSlotState {
  file: File;
  parsed: ParsedSales;
  buffer: ArrayBuffer;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'parsing'; slot: SlotKind }
  | { kind: 'ready' }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; summary: string; importBatchId: string };

interface Toast { id: number; message: string; }

export default function MasterDataLinkedImport({ onClose }: Props) {
  const [inventorySlot, setInventorySlot] = useState<InventorySlotState | null>(null);
  const [salesSlot, setSalesSlot] = useState<SalesSlotState | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const inventoryInputRef = useRef<HTMLInputElement>(null);
  const salesInputRef = useRef<HTMLInputElement>(null);
  const [dragSlot, setDragSlot] = useState<SlotKind | null>(null);

  const pushToast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  /**
   * processFile — read the workbook once, decide which slot owns it (auto-swap
   * if the user dropped it on the wrong panel), parse with the appropriate
   * pipeline, and stash the result. Surfaces errors back into local state.
   */
  const processFile = useCallback(async (file: File, droppedOn: SlotKind) => {
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: true, cellText: true });
      const detected = detectSlot(wb.SheetNames);
      const targetSlot: SlotKind = detected ?? droppedOn;
      if (detected && detected !== droppedOn) {
        pushToast(`Moved ${file.name} to the ${detected === 'sales' ? 'Sales' : 'Inventory'} slot`);
      }

      setStage({ kind: 'parsing', slot: targetSlot });

      if (targetSlot === 'sales') {
        const parsed = await parseSalesWorkbook(buffer, file.name);
        if (!parsed.sales.length) {
          setError(`Sales workbook parsed 0 rows. ${parsed.errors.slice(0, 2).map(e => `${e.sheet}#${e.row}: ${e.message}`).join('; ')}`);
          setStage({ kind: inventorySlot || salesSlot ? 'ready' : 'idle' } as Stage);
          return;
        }
        setSalesSlot({ file, parsed, buffer });
      } else {
        // Inventory path — match ImportModal.processFile sheet-merge behaviour.
        const parsedSheets: { name: string; result: ParsedData }[] = [];
        const sheetCandidates = wb.SheetNames.includes('OG STOCK DATA')
          ? ['OG STOCK DATA']
          : ['INVENTORY', 'IMEI NUMBERS'].filter(n => wb.SheetNames.includes(n));
        if (sheetCandidates.length === 0 && wb.SheetNames.length > 0) {
          sheetCandidates.push(wb.SheetNames[0]);
        }
        for (const sheetName of sheetCandidates) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
          if (!rows.length) continue;
          const format = detectFormat(rows[0] || []);
          const result = format === 'client-bulk' ? parseClientBulkSheet(rows) : parseOGStockSheet(rows);
          if (!result.units.length && !(result.aggregates?.length)) continue;
          parsedSheets.push({ name: sheetName, result });
        }

        if (parsedSheets.length === 0) {
          setError('No valid rows found in inventory workbook.');
          setStage({ kind: inventorySlot || salesSlot ? 'ready' : 'idle' } as Stage);
          return;
        }

        const merged: ParsedData = parsedSheets[0].result;
        for (let i = 1; i < parsedSheets.length; i++) {
          const next = parsedSheets[i].result;
          merged.units = [...merged.units, ...next.units];
          merged.suppliers = mergeSuppliers([...merged.suppliers, ...next.suppliers]);
          merged.aggregates = [...(merged.aggregates ?? []), ...(next.aggregates ?? [])];
          merged.stats = {
            total: merged.stats.total + next.stats.total,
            available: merged.stats.available + next.stats.available,
            sold: merged.stats.sold + next.stats.sold,
            incoming: merged.stats.incoming + next.stats.incoming,
            skipped: merged.stats.skipped + next.stats.skipped,
            ignoredEmpty: (merged.stats.ignoredEmpty ?? 0) + (next.stats.ignoredEmpty ?? 0),
            duplicateRows: merged.stats.duplicateRows + next.stats.duplicateRows,
          };
        }
        merged.sheetName = parsedSheets.map(s => s.name).join(' + ');
        setInventorySlot({ file, parsed: merged });
      }
      setStage({ kind: 'ready' });
    } catch (err: any) {
      setError(`Failed to parse ${file.name}: ${err.message}`);
      setStage({ kind: inventorySlot || salesSlot ? 'ready' : 'idle' } as Stage);
    }
  }, [inventorySlot, salesSlot, pushToast]);

  const handleDrop = useCallback((e: React.DragEvent, slot: SlotKind) => {
    e.preventDefault();
    setDragSlot(null);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file, slot);
  }, [processFile]);

  const handleFileInput = (slot: SlotKind) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file, slot);
    e.target.value = '';
  };

  /**
   * handleImport — emit ONE importBatches row and stamp the resulting id onto
   * every unit / aggregate / supplier / sale doc. Mirrors ImportModal.handleImport
   * for the inventory half and salesImport's bulkUpsertSales convention for the
   * sales half. The single id is the whole point of this screen.
   */
  const handleImport = async () => {
    if (!inventorySlot && !salesSlot) return;
    setError('');
    setStage({ kind: 'importing', done: 0, total: 1 });

    try {
      const invParsed = inventorySlot?.parsed;
      const aggregates = invParsed?.aggregates ?? [];
      const units = invParsed?.units ?? [];
      const sales = salesSlot?.parsed.sales ?? [];

      const sourceFile = [inventorySlot?.file.name, salesSlot?.file.name]
        .filter(Boolean).join(' + ');
      const sourceSheet = [
        invParsed?.sheetName,
        salesSlot ? Object.entries(salesSlot.parsed.perSheetCounts)
          .filter(([, n]) => (n as number) > 0).map(([m]) => m).join(', ')
          : undefined,
      ].filter(Boolean).join(' | ');
      const rowCount = units.length + aggregates.length + sales.length;

      const inventorySummary = invParsed
        ? `inventory: ${units.length} units, ${aggregates.length} aggregates` +
          (invParsed.suppliers.length ? `, ${invParsed.suppliers.length} suppliers` : '')
        : null;
      const salesSummary = salesSlot
        ? `sales: ${sales.length} rows`
        : null;
      const notes = [inventorySummary, salesSummary].filter(Boolean).join(' · ');

      // ── ONE batch row, ONE shared id ─────────────────────────────────────
      const importBatchId = await dbService.createImportBatch({
        sourceFile,
        sourceSheet: sourceSheet || undefined,
        rowCount,
        notes,
      });
      const importedAt = new Date().toISOString();

      // ── Inventory half: resolve synthetic supplier ids → real collection ids
      let stampedUnits: any[] = [];
      let stampedAggregates: any[] = [];
      const suppliersToCreate = new Map<string, Omit<Supplier, 'createdAt'>>();

      if (invParsed) {
        const existingSuppliers = await dbService.readAll('suppliers');
        const byNormName = new Map<string, any>();
        for (const sup of existingSuppliers) {
          const n = String(sup?.name || '').trim().toLowerCase();
          if (n) byNormName.set(n, sup);
        }
        const slugify = (name: string) =>
          `sup_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'}`;
        const idRemap = new Map<string, string>();

        for (const parsedSup of invParsed.suppliers) {
          const name = (parsedSup.name || '').trim();
          const norm = name.toLowerCase();
          const existing = norm ? byNormName.get(norm) : undefined;
          if (existing?.id) {
            idRemap.set(parsedSup.id, existing.id);
          } else {
            const realId = slugify(name || 'Unknown');
            idRemap.set(parsedSup.id, realId);
            if (!suppliersToCreate.has(realId)) {
              suppliersToCreate.set(realId, {
                id: realId,
                name: name || 'Unknown',
                portal: parsedSup.portal || 'Wholesale',
                ownerId: 'shared',
              });
              byNormName.set(name.toLowerCase(), { id: realId, name });
            }
          }
        }

        const resolveId = (s: string | undefined) => s ? (idRemap.get(s) ?? s) : s;
        const resolveIds = (ids: string[] | undefined) => ids ? ids.map(id => idRemap.get(id) ?? id) : ids;

        stampedUnits = units.map((u, idx) => ({
          ...u,
          supplierId: resolveId(u.supplierId)!,
          supplierIds: resolveIds(u.supplierIds),
          importBatchId,
          sourceFile: inventorySlot!.file.name,
          sourceRow: (u as any)._sourceRow ?? (idx + 1),
          importedAt,
          ownerId: 'shared',
        }));

        stampedAggregates = aggregates.map(a => ({
          ...a,
          supplierIds: resolveIds(a.supplierIds) ?? [],
          importBatchId,
          sourceFile: inventorySlot!.file.name,
          sourceRow: a.sourceRow,
          importedAt,
          ownerId: 'shared',
        }));
      }

      const allDocs: { collection: string; id: string; data: any }[] = [];
      for (const s of suppliersToCreate.values())
        allDocs.push({ collection: 'suppliers', id: s.id, data: s });
      for (const u of stampedUnits)
        allDocs.push({ collection: 'inventoryUnits', id: u.id, data: u });
      for (const a of stampedAggregates)
        allDocs.push({ collection: 'inventoryAggregates', id: a.id, data: a });

      const uniqueDocsMap = new Map<string, { collection: string; id: string; data: any }>();
      for (const d of allDocs) uniqueDocsMap.set(`${d.collection}_${d.id}`, d);
      const finalDocs = Array.from(uniqueDocsMap.values());

      const salesTotal = sales.length;
      const totalSteps = finalDocs.length + (salesTotal > 0 ? salesTotal : 0);
      setStage({ kind: 'importing', done: 0, total: Math.max(totalSteps, 1) });

      if (finalDocs.length > 0) {
        await dbService.bulkCreate(finalDocs, (done, total) =>
          setStage({ kind: 'importing', done, total: total + salesTotal })
        );
      }

      if (salesTotal > 0) {
        await dbService.bulkUpsertSales(
          sales.map(s => ({
            ...s,
            importBatchId,
            importedAt,
            sourceFile: salesSlot!.file.name,
            ownerId: 'shared',
          })),
          (done, total) =>
            setStage({ kind: 'importing', done: finalDocs.length + done, total: finalDocs.length + total }),
        );
      }

      await logInventoryEvent({
        type: 'batch_created',
        message:
          `Linked Master Data import — ${stampedUnits.length} units, ${stampedAggregates.length} aggregates, ` +
          `${salesTotal} sales (batch ${importBatchId})`,
        batchId: importBatchId,
      });

      // Background: attach the source workbooks to the batch row.
      (async () => {
        try {
          if (inventorySlot) {
            const src = await uploadSourceAttachment(inventorySlot.file, 'import', importBatchId);
            await dbService.create('sourceDocuments', `doc_${importBatchId}_inv`, {
              ...src, linkedId: importBatchId, ownerId: 'shared',
            });
          }
          if (salesSlot) {
            const src = await uploadSourceAttachment(salesSlot.file, 'import', importBatchId);
            await dbService.create('sourceDocuments', `doc_${importBatchId}_sales`, {
              ...src, linkedId: importBatchId, ownerId: 'shared',
            });
          }
        } catch { /* non-critical */ }
      })();

      setStage({
        kind: 'done',
        summary: notes,
        importBatchId,
      });
    } catch (err: any) {
      setError('Import failed: ' + err.message);
      setStage({ kind: 'ready' });
    }
  };

  const canImport = (inventorySlot !== null || salesSlot !== null)
    && (stage.kind === 'ready' || stage.kind === 'idle');

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 12, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="bg-white rounded-3xl overflow-hidden shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/70 w-full max-w-4xl text-slate-700 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-50 ring-1 ring-slate-200/80 rounded-xl flex items-center justify-center text-slate-500">
              <Link2 size={16} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Master Data</h2>
              <p className="text-[10px] text-slate-400 mt-0.5 tracking-wide">
                Inventory + Sales · one linked import batch
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="border-t border-slate-100" />

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar space-y-5">

          {stage.kind !== 'importing' && stage.kind !== 'done' && (
            <>
              {/* Drop zones */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SlotPanel
                  title="Inventory Report"
                  emoji={<Package size={18} strokeWidth={1.75} className="text-slate-500" />}
                  hint="INVENTORY_REPORT_*.xlsx · INVENTORY / IMEI NUMBERS / OG STOCK DATA"
                  filled={!!inventorySlot}
                  isParsing={stage.kind === 'parsing' && stage.slot === 'inventory'}
                  isDragging={dragSlot === 'inventory'}
                  onDragEnter={() => setDragSlot('inventory')}
                  onDragLeave={() => setDragSlot(null)}
                  onDrop={e => handleDrop(e, 'inventory')}
                  onPick={() => inventoryInputRef.current?.click()}
                  onClear={() => setInventorySlot(null)}
                  fileName={inventorySlot?.file.name}
                  preview={inventorySlot ? renderInventoryStats(inventorySlot.parsed) : undefined}
                />
                <SlotPanel
                  title="Sales Report"
                  emoji={<DollarSign size={18} strokeWidth={1.75} className="text-slate-500" />}
                  hint="SALES_REPORT_*.xlsx · AMAZON / BM / EBAY / ONBUY"
                  filled={!!salesSlot}
                  isParsing={stage.kind === 'parsing' && stage.slot === 'sales'}
                  isDragging={dragSlot === 'sales'}
                  onDragEnter={() => setDragSlot('sales')}
                  onDragLeave={() => setDragSlot(null)}
                  onDrop={e => handleDrop(e, 'sales')}
                  onPick={() => salesInputRef.current?.click()}
                  onClear={() => setSalesSlot(null)}
                  fileName={salesSlot?.file.name}
                  preview={salesSlot ? renderSalesStats(salesSlot.parsed) : undefined}
                />
              </div>

              <input ref={inventoryInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput('inventory')} />
              <input ref={salesInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInput('sales')} />

              {/* Combined linked-totals card */}
              {(inventorySlot || salesSlot) && (
                <div className="rounded-2xl ring-1 ring-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Link2 size={12} className="text-slate-400" />
                    <p className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider">Linked batch totals</p>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Stat label="Units"      value={inventorySlot?.parsed.units.length ?? 0} />
                    <Stat label="Aggregates" value={inventorySlot?.parsed.aggregates?.length ?? 0} />
                    <Stat label="Suppliers"  value={inventorySlot?.parsed.suppliers.length ?? 0} />
                    <Stat label="Sales"      value={salesSlot?.parsed.sales.length ?? 0} />
                  </div>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50/70 ring-1 ring-rose-100 rounded-xl">
                  <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" strokeWidth={1.75} />
                  <p className="text-[11px] text-rose-600">{error}</p>
                </div>
              )}
            </>
          )}

          {stage.kind === 'importing' && (
            <div className="py-12 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-3xl bg-slate-50 ring-1 ring-slate-100 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={20} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Saving linked batch to Firestore</p>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{stage.done} of {stage.total} records</p>
              </div>
              <div className="max-w-xs mx-auto">
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-700 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : 0}%` }}
                    transition={{ ease: 'linear' }}
                  />
                </div>
              </div>
              <p className="text-2xl font-semibold text-slate-800 tracking-tight tabular-nums">
                {stage.total > 0 ? Math.round((stage.done / stage.total) * 100) : 0}%
              </p>
            </div>
          )}

          {stage.kind === 'done' && (
            <div className="py-6 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 bg-emerald-50 ring-1 ring-emerald-100 rounded-3xl flex items-center justify-center">
                <CheckCircle2 className="text-emerald-500" size={22} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-800 tracking-tight">Linked import complete</p>
                <p className="text-[12px] text-slate-500 mt-1.5 font-mono">{stage.summary}</p>
                <p className="text-[10px] text-slate-400 mt-2 font-mono">batch {stage.importBatchId}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-2xl mx-auto">
                <SummaryTile value={inventorySlot?.parsed.units.length ?? 0}      label="Units" />
                <SummaryTile value={inventorySlot?.parsed.aggregates?.length ?? 0} label="Aggregates" />
                <SummaryTile value={inventorySlot?.parsed.suppliers.length ?? 0}  label="Suppliers" />
                <SummaryTile value={salesSlot?.parsed.sales.length ?? 0}          label="Sales" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-6 py-4 flex justify-between items-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-all"
          >
            {stage.kind === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage.kind !== 'importing' && stage.kind !== 'done' && (
            <button
              onClick={handleImport}
              disabled={!canImport}
              className="px-5 py-2 bg-slate-800 text-white text-[11px] font-medium rounded-lg hover:bg-slate-900 transition-all flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Import Linked Batch <ArrowRight size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      </motion.div>

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[70] space-y-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
              className="px-3 py-2 bg-slate-900 text-white rounded-xl text-[11px] font-medium shadow-lg max-w-xs"
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

interface SlotPanelProps {
  title: string;
  emoji: React.ReactNode;
  hint: string;
  filled: boolean;
  isParsing: boolean;
  isDragging: boolean;
  fileName?: string;
  preview?: React.ReactNode;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: () => void;
  onClear: () => void;
}

function SlotPanel(p: SlotPanelProps) {
  return (
    <div
      onDragOver={e => { e.preventDefault(); p.onDragEnter(); }}
      onDragLeave={p.onDragLeave}
      onDrop={p.onDrop}
      className={`relative border-2 border-dashed rounded-2xl p-5 transition-all ${
        p.isDragging
          ? 'border-slate-400 bg-slate-50'
          : p.filled
            ? 'border-emerald-200 bg-emerald-50/40'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="w-8 h-8 rounded-xl bg-white ring-1 ring-slate-200 flex items-center justify-center">
          {p.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-slate-800">{p.title}</p>
          <p className="text-[9px] text-slate-400 font-mono truncate">{p.hint}</p>
        </div>
        {p.filled && !p.isParsing && (
          <button
            onClick={p.onClear}
            className="p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-white"
            title="Clear slot"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {p.isParsing ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Loader2 className="animate-spin text-slate-400" size={18} />
          <p className="text-[10px] text-slate-500 font-mono">Parsing…</p>
        </div>
      ) : p.filled && p.preview ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white ring-1 ring-emerald-100 rounded-lg">
            <FileSpreadsheet size={11} className="text-emerald-500 flex-shrink-0" />
            <p className="text-[10px] font-medium text-slate-700 truncate">{p.fileName}</p>
          </div>
          {p.preview}
        </div>
      ) : (
        <button
          onClick={p.onPick}
          className="w-full mt-2 py-6 flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <Upload size={16} strokeWidth={1.75} />
          <p className="text-[11px] font-medium">Drop file or click</p>
          <p className="text-[9px] text-slate-300 tracking-wider uppercase">.xlsx · .xls</p>
        </button>
      )}
    </div>
  );
}

function renderInventoryStats(parsed: ParsedData) {
  // The "SHS" count mirrors the legacy stat: aggregates that the parser flagged
  // as supplier-held stock (quantityText === 'SHS').
  const shsCount = (parsed.aggregates ?? []).filter((a: any) => a.quantityText === 'SHS').length;
  return (
    <p className="text-[10px] text-slate-600 font-mono leading-relaxed">
      {parsed.units.length} units · {parsed.aggregates?.length ?? 0} aggregates · {shsCount} SHS · {parsed.suppliers.length} suppliers
    </p>
  );
}

function renderSalesStats(parsed: ParsedSales) {
  const c = parsed.perSheetCounts;
  return (
    <p className="text-[10px] text-slate-600 font-mono leading-relaxed">
      {parsed.sales.length} sales across AMAZON {c.AMAZON}, BM {c.BM}, EBAY {c.EBAY}, ONBUY {c.ONBUY}
    </p>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-white ring-1 ring-slate-200 rounded-xl px-3 py-2.5 text-center">
      <p className="text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
      <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

function SummaryTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="bg-slate-50 ring-1 ring-slate-100 rounded-xl px-4 py-3 text-left">
      <p className="text-2xl font-semibold text-slate-800 tabular-nums">{value}</p>
      <p className="text-[9px] text-slate-400 uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
