import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit, Supplier } from '../types';
import { buildStableUnitId } from '../lib/inventoryMaintenance';
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

    const category  = parseCategory(model);
    const brand     = parseBrand(category);
    const unitId    = buildStableUnitId({ imei, model, dateIn, supplierId, buyPrice, status });
    const dedupeKey = normalizeImei(imei) || unitId;

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

export default function ImportModal({ onClose }: ImportModalProps) {
  const [stage,          setStage]          = useState<Stage>('upload');
  const [isDragging,     setIsDragging]     = useState(false);
  const [parsed,         setParsed]         = useState<ParsedData | null>(null);
  const [fileName,       setFileName]       = useState('');
  const [progress,       setProgress]       = useState({ done: 0, total: 0 });
  const [error,          setError]          = useState('');
  const [existingMatches,setExistingMatches]= useState(0);
  const [sourceFile,     setSourceFile]     = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setSourceFile(file);
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames.includes('OG STOCK DATA') ? 'OG STOCK DATA' : wb.SheetNames[0];
        const ws   = wb.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];

        const format = detectFormat(rows[0] || []);
        const result = format === 'client-bulk' ? parseClientBulkSheet(rows) : parseOGStockSheet(rows);
        setParsed(result);
        setStage('preview');
      } catch (err: any) {
        setError('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
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
        setExistingMatches(0); return;
      }
      const inventory = await dbService.readAll('inventoryUnits');
      const existingImeis = new Set(
        inventory.map((unit: InventoryUnit) => normalizeImei(unit.imei)).filter(Boolean)
      );
      const matches = parsed.units.filter(u => existingImeis.has(normalizeImei(u.imei))).length;
      if (!cancelled) setExistingMatches(matches);
    })().catch(() => { if (!cancelled) setExistingMatches(0); });
    return () => { cancelled = true; };
  }, [parsed, stage]);

  const handleImport = async () => {
    if (!parsed) return;
    setStage('importing');

    const allDocs: { collection: string; id: string; data: any }[] = [];
    for (const s of parsed.suppliers)
      allDocs.push({ collection: 'suppliers',      id: s.id, data: { ...s, ownerId: 'shared' } });
    for (const u of parsed.units)
      allDocs.push({ collection: 'inventoryUnits', id: u.id, data: { ...u, ownerId: 'shared' } });

    const uniqueDocsMap = new Map<string, { collection: string; id: string; data: any }>();
    for (const doc of allDocs) uniqueDocsMap.set(`${doc.collection}_${doc.id}`, doc);
    const finalDocs = Array.from(uniqueDocsMap.values());

    setProgress({ done: 0, total: finalDocs.length });
    try {
      await dbService.bulkCreate(finalDocs, (done, total) => setProgress({ done, total }));
      if (sourceFile) {
        try {
          const importId = `import_${Date.now()}`;
          const source   = await uploadSourceAttachment(sourceFile, 'import', importId);
          await dbService.create('sourceDocuments', `doc_${importId}`, { ...source, linkedId: importId, ownerId: 'shared' });
          await logInventoryEvent({ type: 'file_attached', message: `Import: ${sourceFile.name}`, batchId: importId });
        } catch { /* non-critical */ }
      }
      setStage('done');
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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
        className="bg-white border border-gray-200 shadow-2xl w-full max-w-2xl overflow-hidden text-black flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-4">
            <FileSpreadsheet size={20} className="text-green-700" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest">Import Stock</h2>
              <p className="text-[9px] text-gray-400 font-mono uppercase mt-0.5">
                {isClientFmt
                  ? 'Bulk format · MODEL · BP · QTY · COLOURS · SUPPLIER'
                  : 'Master sheet · Date In · Model · IMEI · Colour · Status'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 transition-all text-gray-400 hover:text-black">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1">

          {/* ── Upload ── */}
          {stage === 'upload' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    title: 'Your Stock Report',
                    desc:  'MODEL · BP · QTY · COLOURS · SUPPLIER · NOTES',
                    eg:    'Samsung Galaxy A32, 60, 122, 7320, BLACK 122, IMAX,',
                    tag:   'Auto-detected',
                  },
                  {
                    title: 'Master Sheet',
                    desc:  'Date In · Model · IMEI · Supplier · Buy Price · Colour · Storage · Status · Sale Platform · Sale Price · Sale Date · Sale Order ID · Postage Cost · Notes',
                    eg:    '2026-04-01, iPhone 15 Pro Max 256GB, 353209102768686, TechSource, 800, Natural Titanium, 256GB, available',
                    tag:   'Recommended',
                  },
                ].map(f => (
                  <div key={f.title} className="border border-gray-200 rounded-xl p-4 space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest">{f.title}</p>
                    <p className="text-[8px] text-gray-400 font-mono">{f.desc}</p>
                    <p className="text-[8px] bg-gray-50 px-2 py-1 font-mono text-gray-500 rounded truncate">{f.eg}</p>
                    <span className="inline-block text-[7px] bg-black text-white px-2 py-0.5 rounded-full font-bold uppercase">{f.tag}</span>
                  </div>
                ))}
              </div>

              {/* Sample file download */}
              <a
                href="/sample-100-units.xlsx"
                download="sample-100-units.xlsx"
                className="flex items-center justify-between w-full px-4 py-3 border border-dashed border-gray-300 rounded-xl hover:border-black hover:bg-gray-50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet size={16} className="text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest">Download Sample File</p>
                    <p className="text-[8px] text-gray-400 font-mono mt-0.5">100 mock units · available + sold + SHS · correct column format</p>
                  </div>
                </div>
                <Download size={14} className="text-gray-400 group-hover:text-black transition-colors flex-shrink-0" />
              </a>

              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
                  isDragging ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Upload className="mx-auto mb-3 text-gray-300" size={36} />
                <p className="text-sm font-bold text-gray-700">Drop your Excel or CSV file here</p>
                <p className="text-xs text-gray-400 mt-1 font-mono">or click to browse</p>
                <p className="text-[9px] text-gray-300 mt-3 font-mono uppercase tracking-widest">.xlsx · .xls · .csv supported</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileInput} />
              </div>

              {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
            </div>
          )}

          {/* ── Preview ── */}
          {stage === 'preview' && parsed && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200">
                <CheckCircle2 size={16} className="text-green-700" />
                <div>
                  <p className="text-sm font-bold text-green-900">{fileName}</p>
                  <p className="text-[9px] text-green-700 font-mono uppercase mt-0.5">
                    {isClientFmt ? 'Bulk stock format detected' : 'IMEI-per-row format detected'} · Ready to import
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total Units',      value: parsed.stats.total,     style: 'border-black' },
                  { label: 'Available',        value: parsed.stats.available, style: 'border-gray-200' },
                  parsed.stats.incoming > 0
                    ? { label: 'SHS / Expected', value: parsed.stats.incoming, style: 'border-blue-300' }
                    : { label: 'Sold (History)', value: parsed.stats.sold,     style: 'border-gray-200' },
                  { label: 'Suppliers',        value: parsed.suppliers.length, style: 'border-gray-200' },
                ].map(s => (
                  <div key={s.label} className={`border ${s.style} p-4 text-center`}>
                    <p className="text-2xl font-bold font-display tracking-tighter">{s.value}</p>
                    <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {existingMatches > 0 && (
                <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900 flex items-start gap-3">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] font-mono leading-relaxed">
                    {existingMatches} unit{existingMatches !== 1 ? 's' : ''} already exist in inventory and will be updated.
                  </p>
                </div>
              )}

              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Suppliers detected</p>
                <div className="flex flex-wrap gap-2">
                  {parsed.suppliers.map(s => (
                    <span key={s.id} className="text-[10px] font-mono bg-gray-100 px-2 py-1 text-gray-700">{s.name}</span>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Sample rows (first 5)</p>
                <div className="border border-gray-200 divide-y divide-gray-100">
                  {parsed.units.slice(0, 5).map((u, i) => (
                    <div key={i} className="px-4 py-2 flex items-center gap-4 text-xs">
                      <span className={`text-[8px] font-bold font-mono px-1.5 py-0.5 flex-shrink-0 ${
                        u.status === 'available' ? 'bg-black text-white' :
                        u.status === 'incoming'  ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>{u.status}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{u.model}</p>
                        <p className="text-[9px] text-gray-400 font-mono">{u.colour} · £{u.buyPrice}</p>
                      </div>
                      <span className="text-[9px] text-gray-400 font-mono flex-shrink-0">{u.supplierName || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
            </div>
          )}

          {/* ── Importing ── */}
          {stage === 'importing' && (
            <div className="py-8 space-y-6 text-center">
              <Loader2 className="mx-auto animate-spin text-gray-400" size={40} />
              <div>
                <p className="text-sm font-bold">Saving to Firestore…</p>
                <p className="text-xs text-gray-400 mt-1 font-mono">{progress.done} / {progress.total} records</p>
              </div>
              <div className="w-full h-1 bg-gray-100 rounded-xl">
                <motion.div className="h-full bg-black" initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }} transition={{ ease: 'linear' }} />
              </div>
              <p className="text-2xl font-bold font-display tracking-tighter">{pct}%</p>
            </div>
          )}

          {/* ── Done ── */}
          {stage === 'done' && parsed && (
            <div className="py-8 space-y-6 text-center">
              <CheckCircle2 className="mx-auto text-green-600" size={48} />
              <div>
                <p className="text-xl font-bold">Import Complete!</p>
                <p className="text-sm text-gray-500 mt-2">
                  {parsed.units.length} units · {parsed.suppliers.length} suppliers saved.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="border border-gray-200 p-4">
                  <p className="text-2xl font-bold font-display">{parsed.stats.available}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest mt-1">Available to sell</p>
                </div>
                <div className="border border-gray-200 p-4">
                  <p className="text-2xl font-bold font-display">{parsed.stats.incoming || parsed.stats.sold}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest mt-1">
                    {parsed.stats.incoming > 0 ? 'SHS / Expected' : 'Historical sold'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-200 flex justify-between items-center bg-gray-50">
          <button onClick={onClose}
            className="px-6 py-2.5 border border-gray-200 text-[10px] font-bold uppercase tracking-widest hover:bg-white text-gray-600 transition-all">
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
          {stage === 'upload' && (
            <button onClick={() => fileRef.current?.click()}
              className="px-10 py-2.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center gap-3">
              Select File <Upload size={14} />
            </button>
          )}
          {stage === 'preview' && (
            <button onClick={handleImport}
              className="px-10 py-2.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center gap-3">
              Import {parsed!.units.length} Units <ArrowRight size={14} />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
