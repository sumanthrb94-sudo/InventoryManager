import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit, Supplier } from '../types';
import { buildStableUnitId } from '../lib/inventoryMaintenance';
import { classifyDeviceId } from '../lib/deviceId';
import { uploadSourceAttachment } from '../lib/fileAttachments';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface ImportModalProps { onClose: () => void; }

// ── Shared helpers ────────────────────────────────────────────────────────────

function excelSerialToISO(serial: any): string {
  if (!serial) return new Date().toISOString().split('T')[0];
  if (serial instanceof Date) return serial.toISOString().split('T')[0];
  if (typeof serial === 'number') {
    try {
      const date = XLSX.SSF.parse_date_code(serial);
      return new Date(Date.UTC(date.y, date.m - 1, date.d)).toISOString().split('T')[0];
    } catch { /* fall through */ }
  }
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

function parseCategory(model: string): DeviceCategory {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('APPLE WATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE')) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

function parseBrand(category: DeviceCategory): string {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)) return 'Samsung';
  return 'Other';
}

// Legacy digits-only normalizer — kept for backwards-compat with the
// dedupe key on existing imported rows. New code should prefer the
// classifyDeviceId / normalizeDeviceId pair from `lib/deviceId`.
function normalizeImei(imei: string) { return imei.replace(/\D/g, ''); }

// Parse "BLACK 3 GREY 1" → [{colour:'Black', qty:3}, {colour:'Grey', qty:1}]
function parseColourStr(s: string): Array<{ colour: string; qty: number }> {
  if (!s) return [];
  const cleaned = String(s).replace(/(\d+)B\b/gi, '$1');
  const matches = [...cleaned.matchAll(/([A-Za-z][A-Za-z\s]*?)(\d+)/g)];
  return matches
    .map(m => ({ colour: m[1].trim(), qty: parseInt(m[2]) }))
    .filter(c => c.colour && c.qty > 0);
}

interface ParsedData {
  suppliers: Omit<Supplier, 'createdAt'>[];
  units: Omit<InventoryUnit, 'createdAt'>[];
  stats: { total: number; available: number; sold: number; incoming: number; skipped: number; duplicateRows: number };
  format: 'client-bulk' | 'imei-per-row';
}

// ── Format detection ──────────────────────────────────────────────────────────

function detectFormat(headers: string[]): 'client-bulk' | 'imei-per-row' {
  const h = headers.map(x => String(x || '').toUpperCase()).join(' ');
  if ((h.includes('QUANTITY') || h.includes('QTY')) && h.includes('COLOUR')) return 'client-bulk';
  return 'imei-per-row';
}

// ── Parser A: Client bulk format (MODEL · BP · QTY · COLOURS · SUPPLIER · NOTES) ──

function parseClientBulkSheet(rows: any[][]): ParsedData {
  const header = (rows[0] || []).map((h: any) => String(h || '').trim().toUpperCase());
  const col = (names: string[]) =>
    header.findIndex((h: string) => names.some(n => h.includes(n.toUpperCase())));

  const modelIdx    = col(['MODEL', 'DESCRIPTION', 'DEVICE']);
  const bpIdx       = col(['BP', 'BUY PRICE', 'PRICE', 'COST']);
  const qtyIdx      = col(['QUANTITY', 'QTY']);
  const colourIdx   = col(['COLOUR', 'COLOR']);
  const supplierIdx = col(['SUPPLIER', 'SOURCE']);
  const notesIdx    = col(['NOTES', 'NOTE', 'REMARK']);

  const dateIn = new Date().toISOString().split('T')[0];
  const supplierMap = new Map<string, Omit<Supplier, 'createdAt'>>();
  const units: Omit<InventoryUnit, 'createdAt'>[] = [];
  let skipped = 0;
  let uid = 1;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const model   = modelIdx >= 0 ? String(r[modelIdx] || '').trim() : '';
    const bpRaw   = bpIdx >= 0 ? r[bpIdx] : 0;
    const qtyRaw  = qtyIdx >= 0 ? String(r[qtyIdx] || '').trim() : '';
    const colours = colourIdx >= 0 ? String(r[colourIdx] || '').trim() : '';
    const supName = supplierIdx >= 0 ? String(r[supplierIdx] || '').trim().split('/')[0].trim() : '';
    const notes   = notesIdx >= 0 ? String(r[notesIdx] || '').trim() : '';

    if (!model || /^(model|total|#)/i.test(model)) { skipped++; continue; }
    const bp = parseFloat(String(bpRaw)) || 0;
    if (!bp && qtyRaw.toUpperCase() !== 'SHS') { skipped++; continue; }

    const isSHS    = qtyRaw.toUpperCase() === 'SHS';
    const category = parseCategory(model);
    const brand    = parseBrand(category);

    const supKey     = supName.toUpperCase() || 'UNKNOWN';
    const supplierId = `sup_${supKey.replace(/\s+/g, '_').toLowerCase()}`;
    if (!supplierMap.has(supplierId))
      supplierMap.set(supplierId, { id: supplierId, name: supName || 'Unknown', portal: 'Wholesale', ownerId: 'shared' });

    if (isSHS) {
      const parsed = parseColourStr(colours);
      const colourList = parsed.length ? parsed.map(c => c.colour) : ['Unknown'];
      for (const colour of colourList) {
        units.push({
          id: `import_shs_${uid++}`, imei: `SHS_import_${uid}`,
          model, brand, category, colour, buyPrice: bp,
          dateIn, supplierId, supplierName: supName, status: 'incoming',
          flags: [], notes: `SHS — Expected${notes ? ' · ' + notes : ''}`,
          platformListed: false, listingSites: [], ownerId: 'shared',
        });
      }
    } else {
      const parsed = parseColourStr(colours);
      const colourList: string[] = parsed.length
        ? parsed.flatMap(c => Array(c.qty).fill(c.colour))
        : [colours || 'Unknown'];

      for (const colour of colourList) {
        units.push({
          id: `import_${uid++}`, imei: `PENDING_import_${uid}`,
          model, brand, category, colour, buyPrice: bp,
          dateIn, supplierId, supplierName: supName, status: 'available',
          flags: [], notes: notes || '',
          platformListed: false, listingSites: [], ownerId: 'shared',
        });
      }
    }
  }

  const available = units.filter(u => u.status === 'available').length;
  const incoming  = units.filter(u => u.status === 'incoming').length;

  return {
    suppliers: Array.from(supplierMap.values()),
    units,
    stats: { total: units.length, available, sold: 0, incoming, skipped, duplicateRows: 0 },
    format: 'client-bulk',
  };
}

// ── Parser B: Master sheet / IMEI-per-row format ─────────────────────────────
// Canonical 14-column format:
//   Date In · Model · IMEI · Supplier · Buy Price · Colour · Storage ·
//   Status · Sale Platform · Sale Price · Sale Date · Sale Order ID ·
//   Postage Cost · Notes

function parseOGStockSheet(rows: any[][]): ParsedData {
  const header = rows[0] || [];
  const findCol = (names: string[]) =>
    header.findIndex((h: any) => names.some(n => h?.toString().toUpperCase().includes(n.toUpperCase())));

  // Required columns — fall back to positional index for legacy headerless sheets
  const dateInIdx    = Math.max(findCol(['Date In', 'Stock In', 'Received']), 0);
  const modelIdx     = Math.max(findCol(['Model', 'Device', 'Description']), 1);
  const imeiIdx      = Math.max(findCol(['IMEI', 'Serial', 'S/N']), 2);
  const supplierIdx  = Math.max(findCol(['Supplier', 'Source', 'From']), 3);
  const buyPriceIdx  = Math.max(findCol(['Buy Price', 'BP', 'Cost']), 4);
  const statusIdx    = Math.max(findCol(['Status', 'State']), 5);
  // Optional columns — -1 if absent
  const colourIdx      = findCol(['Colour', 'Color']);
  const storageIdx     = findCol(['Storage', 'Capacity']);
  const platformIdx    = findCol(['Sale Platform', 'Platform', 'Listed']);
  const salePriceIdx   = findCol(['Sale Price', 'Price Sold', 'SP']);
  const saleDateIdx    = findCol(['Sale Date', 'Date Sold', 'Sold Date']);
  const saleOrderIdx   = findCol(['Sale Order ID', 'Order ID', 'Order Number', 'Order No']);
  const postageCostIdx = findCol(['Postage Cost', 'Postage', 'Shipping']);
  const notesIdx       = findCol(['Notes', 'Note', 'Remark']);

  const supplierMap = new Map<string, Omit<Supplier, 'createdAt'>>();
  const unitMap     = new Map<string, Omit<InventoryUnit, 'createdAt'>>();
  const seenImeis   = new Set<string>();
  let skipped = 0, duplicateRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const model = r[modelIdx]?.toString().trim();
    if (!model || /^(model|total|#)/i.test(model)) { skipped++; continue; }

    const imei         = r[imeiIdx]?.toString().trim() || '';
    const supplierName = r[supplierIdx]?.toString().trim() || 'Unknown';
    const buyPrice     = parseFloat(r[buyPriceIdx]) || 0;
    const colour       = colourIdx >= 0 && r[colourIdx] ? r[colourIdx].toString().trim() : 'Unknown';
    const storage      = storageIdx >= 0 && r[storageIdx] ? r[storageIdx].toString().trim() : undefined;
    const notes        = notesIdx >= 0 && r[notesIdx] ? r[notesIdx].toString().trim() : '';

    const statusRaw = r[statusIdx]?.toString().trim().toUpperCase();
    const status: InventoryUnit['status'] =
      statusRaw === 'SOLD'                          ? 'sold' :
      statusRaw === 'INCOMING' || statusRaw === 'SHS' ? 'incoming' :
      'available';

    const salePlatform  = platformIdx  >= 0 ? r[platformIdx]?.toString().trim()  || '' : '';
    const salePrice     = salePriceIdx >= 0 ? parseFloat(r[salePriceIdx])        || 0  : 0;
    const saleOrderId   = saleOrderIdx >= 0 ? r[saleOrderIdx]?.toString().trim() || '' : '';
    const postageCost   = postageCostIdx >= 0 && r[postageCostIdx]
      ? parseFloat(r[postageCostIdx]) : undefined;

    const dateIn  = excelSerialToISO(r[dateInIdx]);
    const saleDate = status === 'sold' && saleDateIdx >= 0 && r[saleDateIdx]
      ? excelSerialToISO(r[saleDateIdx]) : dateIn;

    const supplierId = `sup_${supplierName.replace(/\s+/g, '_').toLowerCase()}`;
    if (!supplierMap.has(supplierId))
      supplierMap.set(supplierId, { id: supplierId, name: supplierName, portal: 'Direct', ownerId: 'shared' });

    const category    = parseCategory(model);
    const brand       = parseBrand(category);
    const cleanedImei = normalizeImei(imei);
    // Industry-grade ID derivation:
    //   • Valid IMEI / IMEISV / Apple serial / MEID → use the normalized
    //     classifier output (matches NewBatchModal so same physical unit
    //     = same record across import paths).
    //   • Anything else → synthesize a stable hash from row content so
    //     legacy / messy Excel rows still import deterministically.
    const idClass   = classifyDeviceId(imei);
    const unitId    = idClass.valid
      ? idClass.normalized
      : buildStableUnitId({ imei, model, dateIn, supplierId, buyPrice, status });
    const dedupeKey = idClass.valid ? idClass.normalized : (cleanedImei || unitId);

    if (seenImeis.has(dedupeKey)) { duplicateRows++; }
    seenImeis.add(dedupeKey);

    unitMap.set(dedupeKey, {
      id: unitId, imei, model, brand, category,
      colour, buyPrice, dateIn, supplierId, status,
      flags: [], notes,
      ...(storage      ? { storage }      : {}),
      ...(postageCost  !== undefined ? { postageCost } : {}),
      platformListed: status === 'available' && !!salePlatform,
      listingSites:   salePlatform ? [salePlatform as any] : [],
      ownerId: 'shared',
      ...(status === 'sold' ? {
        saleDate,
        ...(salePlatform ? { salePlatform }   : {}),
        ...(salePrice    ? { salePrice }       : {}),
        ...(saleOrderId  ? { saleOrderId }     : {}),
      } : {}),
    });
  }

  const units    = Array.from(unitMap.values());
  const available = units.filter(u => u.status === 'available').length;
  const sold      = units.filter(u => u.status === 'sold').length;
  const incoming  = units.filter(u => u.status === 'incoming').length;

  return {
    suppliers: Array.from(supplierMap.values()),
    units,
    stats: { total: units.length, available, sold, incoming, skipped, duplicateRows },
    format: 'imei-per-row',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

type Stage = 'upload' | 'preview' | 'importing' | 'done';
type DuplicateStrategy = 'skip' | 'overwrite';

interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  failed: number;
}

export default function ImportModal({ onClose }: ImportModalProps) {
  const [stage,          setStage]          = useState<Stage>('upload');
  const [isDragging,     setIsDragging]     = useState(false);
  const [parsed,         setParsed]         = useState<ParsedData | null>(null);
  const [fileName,       setFileName]       = useState('');
  const [progress,       setProgress]       = useState({ done: 0, total: 0 });
  const [error,          setError]          = useState('');
  const [existingMatches,setExistingMatches]= useState(0);
  // Default 'skip' — overwrite is destructive and should be a deliberate choice.
  const [duplicateStrategy, setDuplicateStrategy] = useState<DuplicateStrategy>('skip');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [existingImeiSet, setExistingImeiSet] = useState<Set<string>>(new Set());
  const [sourceFile,     setSourceFile]     = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setSourceFile(file);
    setFileName(file.name);
    setError('');
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // xlsx auto-detects CSV vs binary, but CSVs need to be read as text
        // (or as binary string) to avoid byte-order mark corruption. Branch
        // on extension/MIME so we hand xlsx the right input every time.
        const wb = isCsv
          ? XLSX.read(e.target!.result as string, { type: 'string' })
          : XLSX.read(new Uint8Array(e.target!.result as ArrayBuffer), { type: 'array' });
        const sheetName = wb.SheetNames.includes('OG STOCK DATA') ? 'OG STOCK DATA' : wb.SheetNames[0];
        const ws   = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

        const format = detectFormat(rows[0] || []);
        const result = format === 'client-bulk' ? parseClientBulkSheet(rows) : parseOGStockSheet(rows);
        if (!result.units.length) {
          setError('No valid rows found. Check the file has a header row and at least one data row matching the expected columns.');
          return;
        }
        setParsed(result);
        setStage('preview');
      } catch (err: any) {
        setError('Failed to parse file: ' + err.message);
      }
    };
    if (isCsv) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (stage !== 'preview' || !parsed || parsed.format === 'client-bulk') {
        setExistingMatches(0);
        setExistingImeiSet(new Set());
        return;
      }
      const inventory = await dbService.readAll('inventoryUnits');
      const existingImeis = new Set(
        inventory.map((unit: InventoryUnit) => normalizeImei(unit.imei)).filter(Boolean) as string[],
      );
      const matches = parsed.units.filter(u => existingImeis.has(normalizeImei(u.imei))).length;
      if (!cancelled) {
        setExistingMatches(matches);
        setExistingImeiSet(existingImeis);
      }
    })().catch(() => { if (!cancelled) { setExistingMatches(0); setExistingImeiSet(new Set()); } });
    return () => { cancelled = true; };
  }, [parsed, stage]);

  const handleImport = async () => {
    if (!parsed) return;
    setStage('importing');
    setError('');

    // Apply the duplicate-handling strategy. We only filter unit docs;
    // suppliers always get upserted (low cardinality, low risk).
    const filteredUnits = duplicateStrategy === 'skip' && existingImeiSet.size > 0
      ? parsed.units.filter(u => {
          const key = normalizeImei(u.imei);
          // Keep rows where the IMEI doesn't look real (PENDING_/SHS_) or
          // isn't already in inventory.
          return !key || !existingImeiSet.has(key);
        })
      : parsed.units;

    const skippedAsDuplicate = parsed.units.length - filteredUnits.length;

    const allDocs: { collection: string; id: string; data: any }[] = [];
    for (const s of parsed.suppliers)
      allDocs.push({ collection: 'suppliers',      id: s.id, data: { ...s, ownerId: 'shared' } });
    for (const u of filteredUnits)
      allDocs.push({ collection: 'inventoryUnits', id: u.id, data: { ...u, ownerId: 'shared' } });

    const uniqueDocsMap = new Map<string, { collection: string; id: string; data: any }>();
    for (const doc of allDocs) uniqueDocsMap.set(`${doc.collection}_${doc.id}`, doc);
    const finalDocs = Array.from(uniqueDocsMap.values());

    setProgress({ done: 0, total: finalDocs.length });
    try {
      await dbService.bulkCreate(finalDocs, (done, total) => setProgress({ done, total }));
      setImportResult({
        imported: filteredUnits.length,
        skipped: parsed.stats.skipped || 0,
        duplicates: skippedAsDuplicate,
        failed: 0,
      });
      setStage('done');
      // Upload source file in background (non-blocking)
      if (sourceFile) {
        (async () => {
          try {
            const importId = `import_${Date.now()}`;
            const source   = await uploadSourceAttachment(sourceFile, 'import', importId);
            await dbService.create('sourceDocuments', `doc_${importId}`, { ...source, linkedId: importId, ownerId: 'shared' });
            await logInventoryEvent({ type: 'file_attached', message: `Import: ${sourceFile.name}`, batchId: importId });
          } catch { /* non-critical */ }
        })();
      }
      setTimeout(onClose, 2000);
    } catch (err: any) {
      setError('Import failed: ' + err.message);
      setStage('preview');
    }
  };

  const pct         = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const isClientFmt = parsed?.format === 'client-bulk';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 12, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
        className="bg-white rounded-3xl overflow-hidden shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/70 w-full max-w-2xl overflow-hidden text-slate-700 flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-slate-50 ring-1 ring-slate-200/80 rounded-xl flex items-center justify-center text-slate-500">
              <FileSpreadsheet size={16} strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Import Stock</h2>
              <p className="text-[10px] text-slate-400 mt-0.5 tracking-wide">
                {isClientFmt
                  ? 'Bulk format · model · BP · qty · colours · supplier'
                  : 'Master sheet · date · model · IMEI · colour · status'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="border-t border-slate-100" />

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">

          {/* ── Upload ── */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  {
                    title: 'Stock Report',
                    desc:  'MODEL · BP · QTY · COLOURS · SUPPLIER',
                    eg:    'Galaxy A32, 60, 122, 7320, BLACK 122, IMAX',
                    tag:   'Auto-detected',
                  },
                  {
                    title: 'Master Sheet',
                    desc:  'Date · Model · IMEI · Supplier · BP · Colour · Status',
                    eg:    '2026-04-01, iPhone 15 Pro Max, 35320…, TechSource, 800',
                    tag:   'Recommended',
                  },
                ].map(f => (
                  <div key={f.title} className="bg-slate-50/70 rounded-xl p-3.5 ring-1 ring-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold text-slate-700 tracking-tight">{f.title}</p>
                      <span className="text-[8px] tracking-wider uppercase text-slate-500 bg-white px-2 py-0.5 rounded-full ring-1 ring-slate-200/80">
                        {f.tag}
                      </span>
                    </div>
                    <p className="text-[9px] text-slate-400 leading-relaxed">{f.desc}</p>
                    <p className="text-[9px] bg-white px-2 py-1 font-mono text-slate-500 rounded-md truncate ring-1 ring-slate-200/60">{f.eg}</p>
                  </div>
                ))}
              </div>

              {/* Sample file download */}
              <a
                href="/sample-100-units.xlsx"
                download="sample-100-units.xlsx"
                className="flex items-center justify-between w-full px-4 py-3 border border-dashed border-slate-200 rounded-xl hover:border-slate-300 hover:bg-slate-50/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={15} className="text-slate-400 flex-shrink-0" strokeWidth={1.75} />
                  <div>
                    <p className="text-[11px] font-medium text-slate-700">Download sample file</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">100 mock units · correct column format</p>
                  </div>
                </div>
                <Download size={13} className="text-slate-300 group-hover:text-slate-500 transition-colors flex-shrink-0" strokeWidth={1.75} />
              </a>

              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-slate-400 bg-slate-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className={`mx-auto mb-3 w-11 h-11 rounded-3xl flex items-center justify-center transition-all ${
                  isDragging ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'
                }`}>
                  <Upload size={18} strokeWidth={1.75} />
                </div>
                <p className="text-sm font-medium text-slate-700">Drop Excel or CSV here</p>
                <p className="text-[11px] text-slate-400 mt-1">or click to browse</p>
                <p className="text-[9px] text-slate-300 mt-3 tracking-wider uppercase">.xlsx · .xls · .csv</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
              </div>

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50/70 ring-1 ring-rose-100 rounded-xl">
                  <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" strokeWidth={1.75} />
                  <p className="text-[11px] text-rose-600">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Preview ── */}
          {stage === 'preview' && parsed && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50/60 ring-1 ring-emerald-100/80 rounded-xl">
                <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-slate-800 truncate">{fileName}</p>
                  <p className="text-[10px] text-emerald-700/70 mt-0.5">
                    {isClientFmt ? 'Bulk stock format detected' : 'IMEI-per-row format detected'} · ready to import
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <PreviewStat label="Total"     value={parsed.stats.total}     tone="primary" />
                <PreviewStat label="Available" value={parsed.stats.available} tone="muted" />
                {parsed.stats.incoming > 0
                  ? <PreviewStat label="SHS"  value={parsed.stats.incoming} tone="muted" />
                  : <PreviewStat label="Sold" value={parsed.stats.sold}     tone="muted" />}
                <PreviewStat label="Suppliers" value={parsed.suppliers.length} tone="muted" />
              </div>

              {existingMatches > 0 && (
                <div className="px-4 py-3 ring-1 ring-amber-100 bg-amber-50/60 rounded-xl space-y-2.5">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-amber-500" strokeWidth={1.75} />
                    <p className="text-[11px] text-amber-800/90 leading-relaxed">
                      <span className="font-semibold">{existingMatches}</span> unit{existingMatches !== 1 ? 's' : ''} already in inventory.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pl-6">
                    {([
                      { id: 'skip',      label: 'Skip duplicates',    desc: 'Recommended · safe' },
                      { id: 'overwrite', label: 'Overwrite existing', desc: 'Replaces fields' },
                    ] as const).map(opt => {
                      const active = duplicateStrategy === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setDuplicateStrategy(opt.id)}
                          className={`text-left px-3 py-2 rounded-lg ring-1 transition-all ${
                            active
                              ? 'bg-white ring-amber-300 shadow-sm'
                              : 'bg-amber-50/40 ring-amber-100/80 hover:bg-white/60'
                          }`}
                        >
                          <p className={`text-[11px] font-semibold ${active ? 'text-amber-900' : 'text-amber-800/80'}`}>
                            {opt.label}
                          </p>
                          <p className="text-[9px] text-amber-700/70 mt-0.5">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {parsed.stats.skipped > 0 && (
                <div className="px-4 py-3 ring-1 ring-slate-200 bg-slate-50/60 rounded-xl flex items-start gap-2.5">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-semibold">{parsed.stats.skipped}</span> row{parsed.stats.skipped !== 1 ? 's' : ''} couldn't be parsed (missing model, no buy price, or header repeated). They'll be skipped.
                  </p>
                </div>
              )}

              <div>
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-2">Suppliers detected</p>
                <div className="flex flex-wrap gap-1.5">
                  {parsed.suppliers.map(s => (
                    <span key={s.id} className="text-[10px] bg-slate-50 ring-1 ring-slate-100 px-2 py-1 text-slate-600 rounded-lg">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wider mb-2">Sample rows</p>
                <div className="rounded-xl ring-1 ring-slate-100 divide-y divide-slate-100 overflow-hidden">
                  {parsed.units.slice(0, 5).map((u, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-xs bg-white">
                      <StatusPill status={u.status} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-slate-700 truncate">{u.model}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{u.colour} · £{u.buyPrice}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{u.supplierName || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-rose-50/70 ring-1 ring-rose-100 rounded-xl">
                  <AlertTriangle size={13} className="text-rose-500 flex-shrink-0" strokeWidth={1.75} />
                  <p className="text-[11px] text-rose-600">{error}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Importing ── */}
          {stage === 'importing' && (
            <div className="py-12 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-3xl bg-slate-50 ring-1 ring-slate-100 flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-400" size={20} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">Saving to Firestore</p>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">{progress.done} of {progress.total} records</p>
              </div>
              <div className="max-w-xs mx-auto">
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-slate-700 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ ease: 'linear' }}
                  />
                </div>
              </div>
              <p className="text-2xl font-semibold text-slate-800 tracking-tight tabular-nums">{pct}%</p>
            </div>
          )}

          {/* ── Done ── */}
          {stage === 'done' && parsed && importResult && (
            <div className="py-6 space-y-6 text-center">
              <div className="mx-auto w-12 h-12 bg-emerald-50 ring-1 ring-emerald-100 rounded-3xl flex items-center justify-center">
                <CheckCircle2 className="text-emerald-500" size={22} strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-800 tracking-tight">Import complete</p>
                <p className="text-[12px] text-slate-500 mt-1.5">
                  {importResult.imported} unit{importResult.imported !== 1 ? 's' : ''}{' '}
                  {duplicateStrategy === 'overwrite' && existingMatches > 0
                    ? `· ${existingMatches} updated`
                    : ''}{' '}
                  · {parsed.suppliers.length} supplier{parsed.suppliers.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
                <SummaryTile value={importResult.imported}  label="Imported" />
                <SummaryTile value={importResult.duplicates} label={duplicateStrategy === 'skip' ? 'Skipped (duplicate)' : 'Overwritten'} />
                <SummaryTile value={importResult.skipped}    label="Skipped (invalid)" />
                <SummaryTile value={importResult.failed}     label="Failed" />
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
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'upload' && (
            <button
              onClick={() => fileRef.current?.click()}
              className="px-5 py-2 bg-slate-800 text-white text-[11px] font-medium rounded-lg hover:bg-slate-900 transition-all flex items-center gap-2"
            >
              Select file <Upload size={12} strokeWidth={2} />
            </button>
          )}
          {stage === 'preview' && (() => {
            const willImport = duplicateStrategy === 'skip'
              ? parsed!.units.length - existingMatches
              : parsed!.units.length;
            return (
              <button
                onClick={handleImport}
                disabled={willImport <= 0}
                className="px-5 py-2 bg-slate-800 text-white text-[11px] font-medium rounded-lg hover:bg-slate-900 transition-all flex items-center gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {willImport <= 0
                  ? 'Nothing to import'
                  : <>Import {willImport} unit{willImport !== 1 ? 's' : ''} <ArrowRight size={12} strokeWidth={2} /></>}
              </button>
            );
          })()}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PreviewStat({ value, label, tone }: { value: number; label: string; tone: 'primary' | 'muted' }) {
  const isPrimary = tone === 'primary';
  return (
    <div className={`rounded-xl px-3 py-3 text-center ${
      isPrimary
        ? 'bg-slate-800 text-white'
        : 'bg-slate-50 ring-1 ring-slate-100'
    }`}>
      <p className={`text-xl font-semibold tabular-nums ${isPrimary ? '' : 'text-slate-700'}`}>
        {value}
      </p>
      <p className={`text-[9px] mt-0.5 tracking-wider uppercase ${
        isPrimary ? 'text-slate-300' : 'text-slate-400'
      }`}>
        {label}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'available'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : status === 'incoming'
      ? 'bg-sky-50 text-sky-700 ring-sky-100'
      : 'bg-slate-50 text-slate-500 ring-slate-100';
  return (
    <span className={`text-[9px] font-medium px-2 py-0.5 rounded-md ring-1 ${tone} flex-shrink-0`}>
      {status}
    </span>
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
