import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, CheckCircle2, ClipboardPaste, PackagePlus, ChevronDown, ChevronUp, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { GradeSelectCompact, StorageSelectCompact } from './FormSelects';
import ScanInModal from './ScanInModal';

interface Props { onClose: () => void; }

interface BatchRow {
  id: string;
  model: string;
  imei: string;
  buyPrice: string;
  colour: string;
  storage: string;
  supplierName: string;
  grade: string;
  batchNo: string;
  notes: string;
  isSHS: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];
const QUICK_NOTES = ['CLEARANCE', 'ONU', 'BOXED', 'NO BOX'];

function emptyRow(supplierName = ''): BatchRow {
  return { id: uid(), model: '', imei: '', buyPrice: '', colour: '', storage: '', supplierName, grade: '', batchNo: '', notes: '', isSHS: false };
}

function detectCategory(model: string): DeviceCategory {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}
function detectBrand(cat: DeviceCategory): string {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(cat)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(cat)) return 'Samsung';
  return 'Other';
}

// CSV format: MODEL, IMEI, GRADE, BP, COLOUR, BATCH, SUPPLIER, NOTES
function parsePastedCSV(text: string, fallbackSupplier: string): BatchRow[] {
  const rows: BatchRow[] = [];
  for (const raw of text.trim().split('\n')) {
    const parts = raw.split(',').map(p => p.trim());
    if (parts.length < 2) continue;
    const [model, imei, grade, bp, colour, batch, supplier, notes] = parts;
    if (!model || model.toLowerCase() === 'model') continue;
    const isSHS = (imei ?? '').toUpperCase() === 'SHS';
    if (!isSHS && isNaN(parseFloat(bp))) continue;
    rows.push({
      id: uid(),
      model: model.trim(),
      imei: isSHS ? '' : (imei ?? '').replace(/\D/g, ''),
      buyPrice: isSHS ? (bp ?? '') : (bp ?? ''),
      colour: (colour ?? '').trim(),
      storage: '',
      grade: (grade ?? '').trim(),
      batchNo: (batch ?? '').trim(),
      supplierName: ((supplier ?? '').split('/')[0]).trim() || fallbackSupplier,
      notes: (notes ?? '').trim(),
      isSHS,
    });
  }
  return rows;
}

export default function NewBatchModal({ onClose }: Props) {
  const { suppliers } = useInventoryStore();

  const [date, setDate]           = useState(today());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [rows, setRows]           = useState<BatchRow[]>([emptyRow()]);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [error, setError]         = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [showScan, setShowScan]   = useState(false);

  const supplierByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.name.toUpperCase()] = s.id;
    return m;
  }, [suppliers]);

  const knownNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);
  const lastSupplierName = rows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';

  const updateRow = useCallback((id: string, patch: Partial<BatchRow>) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)), []);

  const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id));
  const addRow    = () => setRows(rs => [...rs, emptyRow(lastSupplierName)]);

  const totals = useMemo(() => {
    let units = 0, value = 0, shs = 0;
    for (const r of rows) {
      if (r.isSHS) { shs++; continue; }
      if (r.model.trim()) { units++; value += parseFloat(r.buyPrice) || 0; }
    }
    return { units, value, shs };
  }, [rows]);

  const applyPaste = () => {
    if (!pasteText.trim()) return;
    const parsed = parsePastedCSV(pasteText, lastSupplierName);
    if (!parsed.length) { setError('Could not parse CSV — check the format.'); return; }
    setRows(rs => {
      const nonEmpty = rs.filter(r => r.model || r.imei);
      return [...nonEmpty, ...parsed];
    });
    setShowPaste(false);
    setPasteText('');
    setError('');
  };

  const ensureSupplier = async (name: string): Promise<string> => {
    const key = name.trim().toUpperCase();
    if (!key) return '';
    const existing = supplierByName[key];
    if (existing) return existing;
    const newId = `sup_${Date.now()}_${uid()}`;
    await dbService.create('suppliers', newId, {
      name: name.trim(), portal: 'Wholesale', ownerId: 'shared',
      createdAt: new Date().toISOString(),
    });
    return newId;
  };

  const handleSave = async () => {
    const validRows = rows.filter(r => r.model.trim() && (r.buyPrice || r.isSHS));
    if (!validRows.length) { setError('Add at least one unit to save.'); return; }

    // Validate IMEIs for non-SHS rows
    for (const r of validRows.filter(r => !r.isSHS)) {
      const clean = r.imei.replace(/\D/g, '');
      if (clean.length < 14) {
        setError(`"${r.model}" — IMEI must be 14-15 digits`);
        return;
      }
    }

    setSaving(true);
    setError('');
    try {
      // Check IMEI uniqueness against DB
      const realRows = validRows.filter(r => !r.isSHS);
      for (const r of realRows) {
        const clean = r.imei.replace(/\D/g, '');
        const exists = await dbService.imeiExists(clean);
        if (exists) {
          setError(`IMEI ${clean} already exists in stock`);
          setSaving(false);
          return;
        }
      }

      // Check for duplicates within this batch
      const batchImeis = realRows.map(r => r.imei.replace(/\D/g, ''));
      if (new Set(batchImeis).size !== batchImeis.length) {
        setError('Duplicate IMEIs within this batch — check your entries');
        setSaving(false);
        return;
      }

      const batchId = `bat_${Date.now()}`;
      const ts      = Date.now();

      const supCache: Record<string, string> = {};
      for (const r of validRows) {
        const key = r.supplierName.trim().toUpperCase();
        if (key && !supCache[key]) supCache[key] = await ensureSupplier(r.supplierName);
      }

      await dbService.create('batches', batchId, {
        invoiceNumber: invoiceNo || undefined,
        date,
        unitCount: totals.units,
        totalBuyValue: totals.value,
        notes: `${validRows.length} lines · ${totals.shs} SHS`,
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      });

      let idx = 0;
      for (const r of validRows) {
        const supplierId = supCache[r.supplierName.trim().toUpperCase()] || '';
        const category   = detectCategory(r.model);
        const brand      = detectBrand(category);
        const bp         = parseFloat(r.buyPrice) || 0;

        if (r.isSHS) {
          const tempId = `shs_${ts}_${idx++}`;
          await dbService.create('inventoryUnits', tempId, {
            imei: '',
            model: r.model.trim(), brand, category,
            colour: r.colour.trim() || 'Unknown',
            storage: r.storage.trim() || undefined,
            grade: r.grade.trim() || undefined,
            batchNo: r.batchNo.trim() || undefined,
            buyPrice: bp, dateIn: date,
            supplierId, batchId,
            status: 'incoming', flags: [],
            notes: `SHS — Expected stock${r.notes ? ' · ' + r.notes : ''}`,
            platformListed: false, listingSites: [],
            ownerId: 'shared', createdAt: new Date().toISOString(),
          });
        } else {
          const cleanImei = r.imei.replace(/\D/g, '');
          await dbService.create('inventoryUnits', cleanImei, {
            imei: cleanImei,
            model: r.model.trim(), brand, category,
            colour: r.colour || 'Unknown',
            storage: r.storage.trim() || undefined,
            grade: r.grade.trim() || undefined,
            batchNo: r.batchNo.trim() || undefined,
            buyPrice: bp, dateIn: date,
            supplierId, batchId,
            status: 'available', flags: [],
            notes: r.notes || '',
            platformListed: false, listingSites: [],
            ownerId: 'shared', createdAt: new Date().toISOString(),
          });
        }
      }

      await logInventoryEvent({
        type: 'batch_created',
        message: `Stock in: ${totals.units} units added (${totals.shs} SHS expected)${invoiceNo ? ' · Invoice ' + invoiceNo : ''}`,
        batchId,
      });

      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed. Check connection.');
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-3xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 text-white rounded-xl flex items-center justify-center">
              <PackagePlus size={17} />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-tight">Stock In</p>
              <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">One row = one unit · IMEI required</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowScan(true)}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-100 text-emerald-600 rounded-xl hover:bg-emerald-200 transition-all"
            >
              <Camera size={14} />
              <span className="text-[9px] font-bold uppercase tracking-widest">Scan</span>
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all text-gray-400">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Batch header */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Invoice # (optional)</label>
              <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
                placeholder="e.g. INV-2061"
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
          </div>
        </div>

        {/* Column headers */}
        <div className="hidden md:grid grid-cols-12 gap-1 px-5 pt-3 pb-1 flex-shrink-0">
          {[
            ['col-span-2', 'MODEL'],
            ['col-span-2', 'IMEI (14-15 digits)'],
            ['col-span-1', 'GRADE'],
            ['col-span-1', 'BP (£)'],
            ['col-span-1', 'COLOUR'],
            ['col-span-3', 'BATCH #'],
            ['col-span-1', 'SUPPLIER'],
            ['col-span-1', ''],
          ].map(([cls, label]) => (
            <div key={label} className={`${cls} text-[7px] font-bold uppercase tracking-widest text-gray-400`}>{label}</div>
          ))}
        </div>

        {/* Row list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 md:px-5 py-3 space-y-2">
            <AnimatePresence initial={false}>
              {rows.map((row, idx) => (
                <BatchRowCard
                  key={row.id}
                  row={row}
                  index={idx}
                  knownSuppliers={knownNames}
                  onChange={patch => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                  canRemove={rows.length > 1}
                />
              ))}
            </AnimatePresence>

            <button
              onClick={addRow}
              className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:border-emerald-500 hover:text-emerald-600 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={13} /> Add Unit
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold">{totals.units} units</span>
              <span className="text-gray-400 font-mono">£{totals.value.toLocaleString()}</span>
              {totals.shs > 0 && (
                <span className="bg-blue-100 text-blue-700 text-[8px] font-bold px-2 py-0.5 rounded-full uppercase">
                  +{totals.shs} SHS expected
                </span>
              )}
            </div>
            <button
              onClick={() => setShowPaste(true)}
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-gray-500 hover:text-black transition-colors"
            >
              <ClipboardPaste size={12} /> Paste CSV
            </button>
          </div>

          {error && <p className="text-[10px] text-red-500 font-mono">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || saved || totals.units + totals.shs === 0}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved   ? <><CheckCircle2 size={15} /> Saved!</> :
             saving  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
             <><CheckCircle2 size={15} /> Save {totals.units} Units to Stock</>}
          </button>
        </div>
      </motion.div>

      {/* Paste CSV modal */}
      <AnimatePresence>
        {showScan && <ScanInModal onClose={() => setShowScan(false)} />}
        {showPaste && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60"
            onClick={() => setShowPaste(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <p className="text-sm font-bold">Paste from Spreadsheet</p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5">MODEL, IMEI, BP, COLOUR, SUPPLIER, NOTES</p>
                </div>
                <button onClick={() => setShowPaste(false)} className="text-gray-400 hover:text-black"><X size={16} /></button>
              </div>
              <div className="p-5 space-y-3">
                <div className="bg-gray-50 rounded-xl p-3 text-[9px] font-mono text-gray-500 leading-relaxed">
                  <p className="font-bold text-gray-700 mb-1">Format: MODEL, IMEI, GRADE, BP, COLOUR, BATCH, SUPPLIER, NOTES</p>
                  <p>Apple iPhone 14 128GB, 359108096724237, A, 255, Black, INV-2061, MHL,</p>
                  <p>Samsung Galaxy S21 128GB, 350220437101229, B, 120, Grey, INV-2061, NIHAL,</p>
                  <p>Apple iPhone SE 2nd, SHS, , 60, , INV-2061, NANAK,</p>
                </div>
                <textarea
                  autoFocus
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste your CSV rows here…"
                  rows={8}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:border-black resize-none"
                />
                <button
                  onClick={applyPaste}
                  disabled={!pasteText.trim()}
                  className="w-full py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-40"
                >
                  Import {parsePastedCSV(pasteText, '').length} Rows
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Row card ──────────────────────────────────────────────────────────────────
interface RowProps {
  key?: React.Key;
  row: BatchRow;
  index: number;
  knownSuppliers: string[];
  onChange: (patch: Partial<BatchRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function BatchRowCard({ row, index, knownSuppliers, onChange, onRemove, canRemove }: RowProps) {
  const [expanded, setExpanded] = useState(true);
  const imeiOk = row.isSHS || row.imei.replace(/\D/g, '').length >= 14;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className={`border rounded-xl overflow-hidden ${row.isSHS ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-white'}`}
    >
      {/* Mobile collapsed header */}
      <div className="flex items-center gap-2 px-3 py-2.5 md:hidden">
        <span className="text-[8px] font-bold text-gray-400 w-4 flex-shrink-0">#{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate">{row.model || <span className="text-gray-300">Model…</span>}</p>
          {row.imei && <p className="text-[8px] text-gray-400 font-mono truncate">{row.imei}</p>}
        </div>
        {row.isSHS && <span className="text-[8px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">SHS</span>}
        <button onClick={() => setExpanded(e => !e)} className="p-1 text-gray-400">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Desktop row */}
      <AnimatePresence initial={false}>
        {(expanded || window.innerWidth >= 768) && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">

            {/* Desktop grid */}
            <div className="hidden md:grid grid-cols-12 gap-1 px-3 py-2 items-center">
              <div className="col-span-2">
                <input value={row.model} onChange={e => onChange({ model: e.target.value })}
                  placeholder="e.g. iPhone 14 128GB"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-black bg-white transition-all" />
              </div>
              <div className="col-span-2">
                {row.isSHS ? (
                  <div className="px-2.5 py-2 text-[9px] text-blue-500 font-mono bg-blue-50 rounded-lg border border-blue-200">
                    No IMEI — expected stock
                  </div>
                ) : (
                  <input value={row.imei} onChange={e => onChange({ imei: e.target.value.replace(/\D/g, '') })}
                    placeholder="14-15 digit IMEI"
                    maxLength={15}
                    className={`w-full border rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none bg-white transition-all ${
                      row.imei && !imeiOk ? 'border-red-300 focus:border-red-500' : 'border-gray-200 focus:border-black'
                    }`} />
                )}
              </div>
              <div className="col-span-1">
                <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} />
              </div>
              <div className="col-span-1">
                <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white text-right transition-all" />
              </div>
              <div className="col-span-1">
                <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
                  placeholder="Black"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-black bg-white transition-all" />
              </div>
              <div className="col-span-3">
                <input value={row.batchNo} onChange={e => onChange({ batchNo: e.target.value })}
                  placeholder="e.g. INV-2061"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all" />
              </div>
              <div className="col-span-1">
                <input list={`sup-list-${row.id}`} value={row.supplierName}
                  onChange={e => onChange({ supplierName: e.target.value })}
                  placeholder="MHL"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-black bg-white transition-all" />
                <datalist id={`sup-list-${row.id}`}>
                  {knownSuppliers.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="col-span-1 flex items-center justify-end gap-1">
                {canRemove && (
                  <button onClick={onRemove} className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-300 rounded-lg transition-all">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Desktop notes & SHS row */}
            <div className="hidden md:flex items-center gap-4 px-3 pb-2">
              <div className="flex gap-1">
                {QUICK_NOTES.map(n => (
                  <button key={n}
                    onClick={() => onChange({ notes: row.notes === n ? '' : n })}
                    className={`text-[7px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                      row.notes === n ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-400 hover:border-gray-400'
                    }`}>
                    {n}
                  </button>
                ))}
                <input value={QUICK_NOTES.includes(row.notes) ? '' : row.notes}
                  onChange={e => onChange({ notes: e.target.value })}
                  placeholder="Notes…"
                  className="border border-gray-200 rounded-lg px-2 py-0.5 text-[9px] focus:outline-none focus:border-black w-28" />
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
                <div onClick={() => onChange({ isSHS: !row.isSHS, imei: '' })}
                  className={`w-7 h-3.5 rounded-full transition-all relative ${row.isSHS ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${row.isSHS ? 'left-3.5' : 'left-0.5'}`} />
                </div>
                <span className="text-[7px] font-bold text-gray-500 uppercase">SHS</span>
              </label>
            </div>

            {/* Mobile fields */}
            <div className="md:hidden px-3 pb-3 space-y-2">
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Model</label>
                <input value={row.model} onChange={e => onChange({ model: e.target.value })}
                  placeholder="e.g. Apple iPhone 14 128GB"
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black bg-white" />
              </div>
              {!row.isSHS && (
                <div>
                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">IMEI</label>
                  <input value={row.imei} onChange={e => onChange({ imei: e.target.value.replace(/\D/g, '') })}
                    placeholder="14-15 digit IMEI" maxLength={15} inputMode="numeric"
                    className={`w-full mt-1 border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none bg-white ${
                      row.imei && !imeiOk ? 'border-red-300' : 'border-gray-200 focus:border-black'
                    }`} />
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Grade</label>
                  <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white" />
                </div>
                <div>
                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Buy Price (£)</label>
                  <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
                    placeholder="0"
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white" />
                </div>
                <div>
                  <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Colour</label>
                  <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
                    placeholder="Black"
                    className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black bg-white" />
                </div>
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Batch Number</label>
                <input value={row.batchNo} onChange={e => onChange({ batchNo: e.target.value })}
                  placeholder="e.g. INV-2061"
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white" />
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Supplier</label>
                <input list={`sup-list-m-${row.id}`} value={row.supplierName}
                  onChange={e => onChange({ supplierName: e.target.value })}
                  placeholder="MHL, NANAK…"
                  className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-black bg-white" />
                <datalist id={`sup-list-m-${row.id}`}>
                  {knownSuppliers.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Notes</label>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {QUICK_NOTES.map(n => (
                    <button key={n}
                      onClick={() => onChange({ notes: row.notes === n ? '' : n })}
                      className={`text-[8px] font-bold px-2 py-1 rounded-lg border transition-all ${
                        row.notes === n ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                      }`}>
                      {n}
                    </button>
                  ))}
                  <input value={QUICK_NOTES.includes(row.notes) ? '' : row.notes}
                    onChange={e => onChange({ notes: e.target.value })}
                    placeholder="Custom…"
                    className="flex-1 min-w-[80px] border border-gray-200 rounded-lg px-2 py-1 text-[9px] focus:outline-none focus:border-black" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <div onClick={() => onChange({ isSHS: !row.isSHS, imei: '' })}
                    className={`w-9 h-5 rounded-full transition-all relative ${row.isSHS ? 'bg-blue-500' : 'bg-gray-300'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${row.isSHS ? 'left-4' : 'left-0.5'}`} />
                  </div>
                  <span className="text-[9px] font-bold text-gray-600 uppercase tracking-widest">SHS — Expected Stock</span>
                </label>
                {canRemove && (
                  <button onClick={onRemove} className="text-[8px] font-bold text-red-400 hover:text-red-600 uppercase flex items-center gap-1">
                    <Trash2 size={10} /> Remove
                  </button>
                )}
              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
