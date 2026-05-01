import React, { useState, useRef, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit, Supplier } from '../types';
import { buildStableUnitId } from '../lib/inventoryMaintenance';
import { uploadSourceAttachment } from '../lib/fileAttachments';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface ImportModalProps {
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function excelSerialToISO(serial: any): string {
  if (!serial) return new Date().toISOString().split('T')[0];
  
  // If it's already a JS Date object (XLSX sometimes does this if cellDates is true or inferred)
  if (serial instanceof Date) {
    return serial.toISOString().split('T')[0];
  }

  // If it's a number, it's likely an Excel serial
  if (typeof serial === 'number') {
    try {
      const date = XLSX.SSF.parse_date_code(serial);
      const d = new Date(Date.UTC(date.y, date.m - 1, date.d));
      return d.toISOString().split('T')[0];
    } catch {
      // Fall through
    }
  }

  // If it's a string, try standard JS parsing
  if (typeof serial === 'string') {
    const d = new Date(serial);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }

  return new Date().toISOString().split('T')[0];
}

function parseColour(model: string): string {
  const m = model.toUpperCase();
  const colours = [
    'NATURAL TITANIUM', 'BLACK TITANIUM', 'WHITE TITANIUM', 'BLUE TITANIUM', 'DESERT TITANIUM',
    'STARLIGHT', 'MIDNIGHT', 'SPACE GREY', 'SPACE GRAY', 'GRAPHITE',
    'SILVER', 'GOLD', 'ROSE GOLD', 'PRODUCT RED',
    'PHANTOM BLACK', 'PHANTOM WHITE', 'PHANTOM SILVER',
    'CREAM', 'LAVENDER', 'GREEN', 'YELLOW', 'PURPLE', 'CORAL', 'MINT',
    'BLACK', 'WHITE', 'BLUE', 'PINK', 'TEAL', 'ORANGE', 'RED',
  ];
  for (const c of colours) {
    if (m.includes(c)) {
      if (c === 'SPACE GREY' || c === 'SPACE GRAY') return 'Space Grey';
      return c.charAt(0) + c.slice(1).toLowerCase();
    }
  }
  return 'Unknown';
}

function parseCategory(model: string): DeviceCategory {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (m.includes('APPLE WATCH') || m.includes('IWATCH') || m.includes('WATCH ULTRA') || m.includes('WATCH SE') || m.includes('WATCH')) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (m.includes('GALAXY TAB') || m.includes('TAB A') || m.includes('TAB S') || m.includes('TAB')) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    if (m.includes(' A') || /\bA\d{2}\b/.test(m) || /\bA\d{3}\b/.test(m)) return 'Samsung A Series';
    return 'Samsung S Series';
  }
  return 'Other';
}

function parseBrand(category: DeviceCategory): string {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series'].includes(category)) return 'Samsung';
  return 'Other';
}

function normalizeImei(imei: string) {
  return imei.replace(/\D/g, '');
}

interface ParsedData {
  suppliers: Omit<Supplier, 'createdAt'>[];
  units: Omit<InventoryUnit, 'createdAt'>[];
  stats: { total: number; available: number; sold: number; skipped: number; duplicateRows: number };
}

function parseOGStockSheet(ws: XLSX.WorkSheet): ParsedData {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
  const header = rows[0] || [];
  
  // Try to find columns by name
  const findCol = (names: string[]) => {
    return header.findIndex(h => names.some(n => h?.toString().toUpperCase().includes(n.toUpperCase())));
  };

  const dateInCol    = findCol(['Date In', 'Stock In', 'Received', 'Date']);
  const modelCol     = findCol(['Model', 'Device', 'Description']);
  const imeiCol      = findCol(['IMEI', 'Serial', 'S/N']);
  const supplierCol  = findCol(['Supplier', 'Source', 'From']);
  const buyPriceCol  = findCol(['Buy Price', 'BP', 'Cost']);
  const statusCol    = findCol(['Status', 'Available', 'State']);
  const platformCol  = findCol(['Platform', 'Sale Platform', 'Listed']);
  const salePriceCol = findCol(['Sale Price', 'Price Sold', 'SP']);
  const saleDateCol  = findCol(['Sale Date', 'Date Sold', 'Sold Date']);

  const dateInIdx    = dateInCol >= 0 ? dateInCol : 0;
  const modelIdx     = modelCol >= 0 ? modelCol : 1;
  const imeiIdx      = imeiCol >= 0 ? imeiCol : 2;
  const supplierIdx  = supplierCol >= 0 ? supplierCol : 3;
  const buyPriceIdx  = buyPriceCol >= 0 ? buyPriceCol : 4;
  const statusIdx    = statusCol >= 0 ? statusCol : 5;
  const platformIdx  = platformCol >= 0 ? platformCol : 6;
  const salePriceIdx = salePriceCol >= 0 ? salePriceCol : 7;
  const saleDateIdx  = saleDateCol >= 0 ? saleDateCol : -1;

  const supplierMap = new Map<string, Omit<Supplier, 'createdAt'>>();
  const unitMap = new Map<string, Omit<InventoryUnit, 'createdAt'>>();
  const seenImeis = new Set<string>();
  let skipped = 0;
  let duplicateRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const model = r[modelIdx]?.toString().trim();
    if (!model) { skipped++; continue; }

    const imei = r[imeiIdx]?.toString().trim() || '';
    const supplierName = r[supplierIdx]?.toString().trim() || 'UNKNOWN';
    const buyPrice = parseFloat(r[buyPriceIdx]) || 0;
    const statusRaw = r[statusIdx]?.toString().trim().toUpperCase();
    const status: InventoryUnit['status'] = statusRaw === 'SOLD' ? 'sold' : 'available';
    const salePlatform = r[platformIdx]?.toString().trim() || '';
    const salePrice = parseFloat(r[salePriceIdx]) || 0;
    const dateIn = excelSerialToISO(r[dateInIdx]);

    const supplierId = `sup_${supplierName.replace(/\s+/g, '_').toLowerCase()}`;
    if (!supplierMap.has(supplierId)) {
      supplierMap.set(supplierId, {
        id: supplierId,
        name: supplierName,
        portal: 'Direct',
        ownerId: 'anonymous',
      });
    }

    const category = parseCategory(model);
    const brand = parseBrand(category);
    const colour = parseColour(model);
    const unitId = buildStableUnitId({ imei, model, dateIn, supplierId, buyPrice, status });
    const dedupeKey = normalizeImei(imei) || unitId;

    if (seenImeis.has(dedupeKey)) {
      duplicateRows++;
    }
    seenImeis.add(dedupeKey);

    const saleDate = (status === 'sold' && saleDateIdx >= 0 && r[saleDateIdx]) 
      ? excelSerialToISO(r[saleDateIdx]) 
      : dateIn;

    unitMap.set(dedupeKey, {
      id: unitId,
      imei,
      model: model.trim(),
      brand,
      category,
      colour,
      buyPrice,
      dateIn,
      supplierId,
      status,
      flags: [],
      notes: '',
      platformListed: status === 'available',
      ownerId: 'anonymous',
      ...(status === 'sold' ? { saleDate } : {}),
      ...(status === 'sold' && salePlatform ? { salePlatform } : {}),
      ...(status === 'sold' && salePrice ? { salePrice } : {}),
    });
  }

  const units = Array.from(unitMap.values());

  const available = units.filter(u => u.status === 'available').length;
  const sold = units.filter(u => u.status === 'sold').length;

  return {
    suppliers: Array.from(supplierMap.values()),
    units,
    stats: { total: units.length, available, sold, skipped, duplicateRows },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

type Stage = 'upload' | 'preview' | 'importing' | 'done';

export default function ImportModal({ onClose }: ImportModalProps) {
  const [stage, setStage] = useState<Stage>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [existingMatches, setExistingMatches] = useState(0);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    setSourceFile(file);
    setFileName(file.name);
    setError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        // Try 'OG STOCK DATA' first, then first sheet
        const sheetName = wb.SheetNames.includes('OG STOCK DATA') ? 'OG STOCK DATA' : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const result = parseOGStockSheet(ws);
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
      if (stage !== 'preview' || !parsed) {
        setExistingMatches(0);
        return;
      }

      const inventory = await dbService.readAll('inventoryUnits');
      const existingImeis = new Set(
        inventory
          .map((unit: InventoryUnit) => normalizeImei(unit.imei))
          .filter(Boolean)
      );
      const matches = parsed.units.filter(unit => existingImeis.has(normalizeImei(unit.imei))).length;
      if (!cancelled) {
        setExistingMatches(matches);
      }
    })().catch(() => {
      if (!cancelled) setExistingMatches(0);
    });

    return () => {
      cancelled = true;
    };
  }, [parsed, stage]);

  const handleImport = async () => {
    if (!parsed) return;
    setStage('importing');

    const allDocs: { collection: string; id: string; data: any }[] = [];

    for (const s of parsed.suppliers) {
      allDocs.push({
        collection: 'suppliers',
        id: s.id,
        data: { ...s, ownerId: 'local' },
      });
    }
    for (const u of parsed.units) {
      allDocs.push({
        collection: 'inventoryUnits',
        id: u.id,
        data: { ...u, ownerId: 'local' },
      });
    }

    setProgress({ done: 0, total: allDocs.length });

    try {
      await dbService.bulkCreate(allDocs, (done, total) => {
        setProgress({ done, total });
      });
      if (sourceFile) {
        try {
          const importId = `import_${Date.now()}`;
          const source = await uploadSourceAttachment(sourceFile, 'import', importId);
          await dbService.create('sourceDocuments', `doc_${importId}`, {
            ...source,
            linkedId: importId,
            ownerId: 'local',
          });
          await logInventoryEvent({
            type: 'file_attached',
            message: `Excel import attached: ${sourceFile.name}`,
            batchId: importId,
          });
        } catch (attachmentError) {
          console.warn('Excel source attachment upload failed.', attachmentError);
        }
      }
      setStage('done');
    } catch (err: any) {
      setError('Import failed: ' + err.message);
      setStage('preview');
    }
  };

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="bg-white border border-gray-200 shadow-2xl w-full max-w-2xl overflow-hidden text-black flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-4">
            <FileSpreadsheet size={20} className="text-green-700" />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest">Import from Excel</h2>
              <p className="text-[9px] text-gray-400 font-mono uppercase mt-0.5">OG STOCK DATA sheet · INVENTORY REPORT 2026.xlsx</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 transition-all text-gray-400 hover:text-black">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1">
          {/* Stage: Upload */}
          {stage === 'upload' && (
            <div className="space-y-4">
              <div
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all ${
                  isDragging ? 'border-black bg-gray-50' : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
                }`}
              >
                <Upload className="mx-auto mb-4 text-gray-300" size={40} />
                <p className="text-sm font-bold text-gray-700">Drop your Excel file here</p>
                <p className="text-xs text-gray-400 mt-2 font-mono">or click to browse</p>
                <p className="text-[9px] text-gray-300 mt-4 font-mono uppercase tracking-widest">.xlsx / .xls supported</p>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileInput} />
              </div>
              {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Stage: Preview */}
          {stage === 'preview' && parsed && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200">
                <CheckCircle2 size={16} className="text-green-700" />
                <div>
                  <p className="text-sm font-bold text-green-900">{fileName}</p>
                  <p className="text-[10px] text-green-700 font-mono uppercase mt-0.5">Parsed successfully · Ready to import</p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Total Units', value: parsed.stats.total, style: 'border-black' },
                  { label: 'Available', value: parsed.stats.available, style: 'border-gray-200' },
                  { label: 'Sold (History)', value: parsed.stats.sold, style: 'border-gray-200' },
                  { label: 'Suppliers', value: parsed.suppliers.length, style: 'border-gray-200' },
                ].map(s => (
                  <div key={s.label} className={`border ${s.style} p-4 text-center`}>
                    <p className="text-2xl font-bold font-display tracking-tighter">{s.value}</p>
                    <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {(parsed.stats.duplicateRows > 0 || existingMatches > 0) && (
                <div className="p-4 border border-amber-200 bg-amber-50 text-amber-900">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p className="text-sm font-bold">Duplicate records detected</p>
                      <p className="text-[10px] font-mono uppercase tracking-widest leading-relaxed">
                        {parsed.stats.duplicateRows > 0
                          ? `${parsed.stats.duplicateRows} duplicate row${parsed.stats.duplicateRows === 1 ? '' : 's'} were collapsed inside this file.`
                          : 'No duplicates were found inside the file.'}
                      </p>
                      {existingMatches > 0 && (
                        <p className="text-[10px] font-mono uppercase tracking-widest leading-relaxed">
                          {existingMatches} imported unit{existingMatches === 1 ? '' : 's'} already exist in inventory and will be updated instead of duplicated.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Supplier list */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Suppliers detected</p>
                <div className="flex flex-wrap gap-2">
                  {parsed.suppliers.map(s => (
                    <span key={s.id} className="text-[10px] font-mono bg-gray-100 px-2 py-1 text-gray-700">{s.name}</span>
                  ))}
                </div>
              </div>

              {/* Sample units */}
              <div>
                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Sample rows (first 5)</p>
                <div className="border border-gray-200 divide-y divide-gray-100">
                  {parsed.units.slice(0, 5).map((u, i) => (
                    <div key={i} className="px-4 py-2 flex items-center gap-4 text-xs">
                      <span className={`text-[8px] font-bold font-mono px-1.5 py-0.5 ${u.status === 'available' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>
                        {u.status}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold truncate">{u.model}</p>
                        <p className="text-[9px] text-gray-400 font-mono mt-0.5">
                          Date In: {u.dateIn}
                          {u.status === 'sold' && u.saleDate && ` · Sold: ${u.saleDate}`}
                        </p>
                      </div>
                      <span className="text-gray-400 font-mono">{u.colour}</span>
                      <span className="font-mono font-bold">£{u.buyPrice}</span>
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertTriangle size={14} />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Stage: Importing */}
          {stage === 'importing' && (
            <div className="py-8 space-y-6 text-center">
              <Loader2 className="mx-auto animate-spin text-gray-400" size={40} />
              <div>
                <p className="text-sm font-bold">Uploading to Firestore...</p>
                <p className="text-xs text-gray-400 mt-1 font-mono">{progress.done} / {progress.total} records</p>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1 bg-gray-100 rounded-xl">
                <motion.div
                  className="h-full bg-black"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: 'linear' }}
                />
              </div>
              <p className="text-2xl font-bold font-display tracking-tighter">{pct}%</p>
            </div>
          )}

          {/* Stage: Done */}
          {stage === 'done' && parsed && (
            <div className="py-8 space-y-6 text-center">
              <CheckCircle2 className="mx-auto text-green-600" size={48} />
              <div>
                <p className="text-xl font-bold">Import Complete!</p>
                <p className="text-sm text-gray-500 mt-2">
                  {parsed.units.length} units and {parsed.suppliers.length} suppliers are now live in Firestore.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-left">
                <div className="border border-gray-200 p-4">
                  <p className="text-2xl font-bold font-display">{parsed.stats.available}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest mt-1">Available to sell</p>
                </div>
                <div className="border border-gray-200 p-4">
                  <p className="text-2xl font-bold font-display">{parsed.stats.sold}</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest mt-1">Historical sold records</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-gray-200 flex justify-between items-center bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2.5 border border-gray-200 text-[10px] font-bold uppercase tracking-widest hover:bg-white text-gray-600 transition-all"
          >
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>

          {stage === 'preview' && (
            <button
              onClick={handleImport}
              className="px-10 py-2.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center gap-3"
            >
              Import {parsed!.units.length} Units
              <ArrowRight size={14} />
            </button>
          )}

          {stage === 'upload' && (
            <button
              onClick={() => fileRef.current?.click()}
              className="px-10 py-2.5 bg-black text-white text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all flex items-center gap-3"
            >
              Select File
              <Upload size={14} />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
