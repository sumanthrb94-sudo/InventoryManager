import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, CheckCircle2, PackagePlus, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { StorageSelectCompact, GradeSelectCompact } from './FormSelects';
import { logInventoryEvent } from '../lib/inventoryEvents';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';

interface Props { onClose: () => void; }

/**
 * AddStockManualModal — physical stock arrived in office, operator enters
 * each unit manually. Mirrors AddSHSModal's row-per-SKU layout but every
 * row requires a real IMEI / Apple serial. The unit is created with
 * status='available' and shows up in Sell / Inventory immediately.
 *
 * Use this when there's no barcode scanner / no master file — pure
 * manual entry. The legacy StockIntakeFlow camera/OCR flow is hidden
 * for now per ops feedback ("use this manual only for now").
 */

interface StockRow {
  id: string;          // local row id
  imei: string;        // REQUIRED — IMEI or Apple serial
  model: string;
  buyPrice: string;
  colour: string;
  storage: string;
  grade: string;
  supplierName: string;
  notes: string;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

function emptyRow(supplierName = ''): StockRow {
  return { id: uid(), imei: '', model: '', buyPrice: '', colour: '', storage: '', grade: '', supplierName, notes: '' };
}

function detectCategory(model: string): DeviceCategory {
  const m = (model || '').toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

export default function AddStockManualModal({ onClose }: Props) {
  const { suppliers, units } = useInventoryStore();
  const [date, setDate]     = useState(today());
  const [rows, setRows]     = useState<StockRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const knownNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);
  const supplierByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.name.toUpperCase()] = s.id;
    return m;
  }, [suppliers]);
  const existingImeis = useMemo(() => {
    const s = new Set<string>();
    for (const u of units) if (u.imei) s.add(u.imei.trim().toUpperCase());
    return s;
  }, [units]);

  const lastSupplierName = rows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';

  const updateRow = useCallback((id: string, patch: Partial<StockRow>) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)), []);
  const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id));
  const addRow    = () => setRows(rs => [...rs, emptyRow(lastSupplierName)]);

  // Per-row validation summary, used for the bottom CTA + inline highlight.
  // Apple devices unlock the 10-12 char alphanumeric serial format; all other
  // brands must be 15-digit numeric IMEIs (per ops rule, 2026-05-17).
  const rowValidation = useMemo(() => rows.map(r => {
    const imeiTrim   = r.imei.trim().toUpperCase();
    const isApple    = isAppleDevice(r.model);
    const imeiOk     = isValidImei(r.imei, { isAppleSerial: isApple });
    const dupeInRow  = imeiTrim && rows.filter(x => x.imei.trim().toUpperCase() === imeiTrim).length > 1;
    const dupeExisting = imeiTrim && existingImeis.has(imeiTrim);
    const modelOk    = r.model.trim().length > 0;
    const supplierOk = r.supplierName.trim().length > 0;
    return {
      imeiOk: !!imeiOk,
      isApple,
      dupeInRow: !!dupeInRow,
      dupeExisting: !!dupeExisting,
      modelOk,
      supplierOk,
      complete: !!imeiOk && !dupeInRow && !dupeExisting && modelOk && supplierOk,
    };
  }), [rows, existingImeis]);

  const totals = useMemo(() => {
    let units = 0, value = 0;
    rows.forEach((r, i) => {
      if (rowValidation[i].complete) {
        units++;
        value += parseFloat(r.buyPrice) || 0;
      }
    });
    return { units, value };
  }, [rows, rowValidation]);

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
    const validIdxs: number[] = [];
    rowValidation.forEach((v, i) => { if (v.complete) validIdxs.push(i); });
    if (!validIdxs.length) {
      setError('Add at least one row with a valid IMEI, model and supplier.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const batchId = `manual_bat_${Date.now()}`;
      const supCache: Record<string, string> = {};
      for (const i of validIdxs) {
        const key = rows[i].supplierName.trim().toUpperCase();
        if (key && !supCache[key]) supCache[key] = await ensureSupplier(rows[i].supplierName);
      }

      let totalUnits = 0;
      for (const i of validIdxs) {
        const r = rows[i];
        const supplierId = supCache[r.supplierName.trim().toUpperCase()] || '';
        const imei       = r.imei.trim().toUpperCase();
        const category   = detectCategory(r.model);
        // Use the shared brand/series detector so the new unit lands in the
        // right Periodic Table bucket and respects naming conventions.
        const parsed     = parseBrandModelStorage(r.model);
        const brand      = parsed.brand !== 'Other' ? parsed.brand
                            : (['iPhone', 'iPad', 'Apple Watch'].includes(category) ? 'Apple'
                                : (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category) ? 'Samsung' : 'Other'));
        const cleanModel = parsed.model || r.model.trim();
        const storage    = r.storage.trim() || parsed.storage;
        const bp         = parseFloat(r.buyPrice) || 0;
        const newUnit: InventoryUnit = {
          id:             imei,        // doc id = IMEI for upsert semantics
          imei,
          model:          cleanModel,
          brand,
          category,
          colour:         r.colour.trim() || 'Unknown',
          ...(storage      ? { storage }                : {}),
          ...(parsed.series ? { series: parsed.series } : {}),
          ...(r.grade.trim() ? { grade: r.grade.trim() } : {}),
          buyPrice:       bp,
          dateIn:         date,
          supplierId,
          batchId,
          status:         'available',
          flags:          [],
          notes:          r.notes.trim(),
          platformListed: false,
          listingSites:   [],
          ownerId:        'shared',
          createdAt:      new Date().toISOString(),
        };
        await dbService.create('inventoryUnits', imei, newUnit);
        // Single dedup-aware notification per unit; notificationService
        // already groups identical SKUs within its 10-min window.
        notificationService.addNotification('new_stock', newUnit);
        totalUnits++;
      }

      await logInventoryEvent({
        type:    'batch_created',
        message: `Manual add: ${totalUnits} unit${totalUnits !== 1 ? 's' : ''} added by IMEI`,
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-emerald-100 bg-emerald-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 text-white rounded-xl flex items-center justify-center">
              <PackagePlus size={17} />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-tight">Add Stock — Manual</p>
              <p className="text-[9px] text-emerald-700 font-mono uppercase tracking-widest">
                Physical units in office · IMEI required · Goes straight to Sell
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-emerald-100 rounded-xl transition-all text-emerald-500">
            <X size={16} />
          </button>
        </div>

        {/* Date */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Stock In Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
            <div className="flex-1 min-w-[200px] bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-[9px] text-emerald-800 font-mono leading-relaxed">
              IMEI is required for every row. Apple alphanumeric serials accepted
              (e.g. <code>NL6CMQCYTD</code>). Duplicates against existing inventory are blocked.
            </div>
          </div>
        </div>

        {/* Column headers (desktop) */}
        <div className="hidden md:grid grid-cols-12 gap-1 px-5 pt-3 pb-1 flex-shrink-0">
          {[
            ['col-span-3', 'IMEI / SERIAL *'],
            ['col-span-3', 'MODEL *'],
            ['col-span-1', 'BP (£)'],
            ['col-span-1', 'COLOUR'],
            ['col-span-1', 'GRADE'],
            ['col-span-1', 'STORAGE'],
            ['col-span-2', 'SUPPLIER *'],
          ].map(([cls, label]) => (
            <div key={label} className={`${cls} text-[7px] font-bold uppercase tracking-widest text-gray-400`}>{label}</div>
          ))}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 md:px-5 py-3 space-y-2">
            <AnimatePresence initial={false}>
              {rows.map((row, idx) => (
                <StockRowCard
                  key={row.id}
                  row={row}
                  index={idx}
                  validation={rowValidation[idx]}
                  knownSuppliers={knownNames}
                  onChange={patch => updateRow(row.id, patch)}
                  onRemove={() => removeRow(row.id)}
                  canRemove={rows.length > 1}
                />
              ))}
            </AnimatePresence>
            <button
              onClick={addRow}
              className="w-full py-3 border-2 border-dashed border-emerald-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:border-emerald-600 hover:text-emerald-700 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={13} /> Add Another IMEI
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold">{totals.units} unit{totals.units !== 1 ? 's' : ''} ready</span>
              {totals.value > 0 && (
                <span className="text-gray-400 font-mono">£{totals.value.toLocaleString()} committed</span>
              )}
              {rows.length > totals.units && (
                <span className="text-[8px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full uppercase">
                  {rows.length - totals.units} row{(rows.length - totals.units) !== 1 ? 's' : ''} need fixing
                </span>
              )}
            </div>
          </div>

          {error && <p className="text-[10px] text-red-500 font-mono">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || saved || totals.units === 0}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved
              ? <><CheckCircle2 size={15} /> Stock Added!</>
              : saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><PackagePlus size={15} /> Add {totals.units} Unit{totals.units !== 1 ? 's' : ''} to Stock</>
            }
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Row card ──────────────────────────────────────────────────────────────────

interface RowValidation {
  imeiOk: boolean;
  /** True when the row's model is Apple — unlocks the alphanumeric serial form. */
  isApple: boolean;
  dupeInRow: boolean;
  dupeExisting: boolean;
  modelOk: boolean;
  supplierOk: boolean;
  complete: boolean;
}

interface RowProps {
  key?: React.Key;
  row: StockRow;
  index: number;
  validation: RowValidation;
  knownSuppliers: string[];
  onChange: (patch: Partial<StockRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function StockRowCard({ row, index, validation, knownSuppliers, onChange, onRemove, canRemove }: RowProps) {
  const imeiClass = (() => {
    if (!row.imei.trim()) return 'border-gray-200 focus:border-emerald-500 bg-white';
    if (validation.dupeInRow || validation.dupeExisting) return 'border-rose-400 bg-rose-50 focus:border-rose-500';
    if (!validation.imeiOk) return 'border-rose-300 bg-rose-50 focus:border-rose-500';
    return 'border-emerald-300 bg-emerald-50/40 focus:border-emerald-500';
  })();
  const imeiError = (() => {
    if (!row.imei.trim()) return '';
    if (validation.dupeInRow)    return 'Duplicate IMEI in this batch';
    if (validation.dupeExisting) return 'IMEI already in inventory';
    if (!validation.imeiOk) {
      return validation.isApple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE;
    }
    return '';
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className={`border rounded-xl overflow-hidden ${validation.complete ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200 bg-white'}`}
    >
      {/* Desktop grid */}
      <div className="hidden md:grid grid-cols-12 gap-1 px-3 py-2 items-start">
        <div className="col-span-3">
          <input
            value={row.imei}
            onChange={e => onChange({ imei: e.target.value })}
            placeholder="IMEI or serial"
            className={`w-full border rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none transition-all ${imeiClass}`}
          />
          {imeiError && <p className="text-[8px] text-rose-600 font-mono mt-1">{imeiError}</p>}
        </div>
        <div className="col-span-3">
          <input value={row.model} onChange={e => onChange({ model: e.target.value })}
            placeholder="iPhone 16 Pro 256GB"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
            placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-right focus:outline-none focus:border-emerald-500 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
            placeholder="Black"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <StorageSelectCompact value={row.storage} onChange={e => onChange({ storage: e })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 bg-white transition-all" />
        </div>
        <div className="col-span-2 flex items-start gap-1">
          <div className="flex-1">
            <input list={`stock-sup-${row.id}`} value={row.supplierName}
              onChange={e => onChange({ supplierName: e.target.value })}
              placeholder="MHL"
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white transition-all" />
            <datalist id={`stock-sup-${row.id}`}>
              {knownSuppliers.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          {canRemove && (
            <button onClick={onRemove}
              className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-300 rounded-lg transition-all flex-shrink-0 mt-0.5">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Mobile fields */}
      <div className="md:hidden px-3 py-3 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-[8px] font-bold uppercase tracking-widest ${validation.complete ? 'text-emerald-600' : 'text-gray-400'}`}>
            #{index + 1}{validation.complete ? ' · OK' : ''}
          </span>
          {canRemove && (
            <button onClick={onRemove} className="text-[8px] text-red-400 hover:text-red-600 font-bold uppercase flex items-center gap-1">
              <Trash2 size={10} /> Remove
            </button>
          )}
        </div>
        <div>
          <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1">
            IMEI / Serial <span className="text-rose-500">*</span>
          </label>
          <input
            value={row.imei}
            onChange={e => onChange({ imei: e.target.value })}
            placeholder="e.g. 351554741082094 or NL6CMQCYTD"
            className={`w-full mt-1 border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none transition-all ${imeiClass}`}
          />
          {imeiError && (
            <p className="text-[8px] text-rose-600 font-mono mt-1 flex items-center gap-1">
              <AlertCircle size={9} /> {imeiError}
            </p>
          )}
        </div>
        <div>
          <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1">
            Model <span className="text-rose-500">*</span>
          </label>
          <input value={row.model} onChange={e => onChange({ model: e.target.value })}
            placeholder="iPhone 16 Pro 256GB"
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Buy Price (£)</label>
            <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
              placeholder="0"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Storage</label>
            <StorageSelectCompact value={row.storage} onChange={e => onChange({ storage: e })} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Grade</label>
            <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-emerald-500 bg-white" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Colour</label>
            <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
              placeholder="Black Titanium"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400 flex items-center gap-1">
              Supplier <span className="text-rose-500">*</span>
            </label>
            <input list={`stock-sup-m-${row.id}`} value={row.supplierName}
              onChange={e => onChange({ supplierName: e.target.value })}
              placeholder="MHL"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white" />
            <datalist id={`stock-sup-m-${row.id}`}>
              {knownSuppliers.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>
        <div>
          <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Notes</label>
          <input value={row.notes} onChange={e => onChange({ notes: e.target.value })}
            placeholder="Grade A · Box included · …"
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-emerald-500 bg-white" />
        </div>
      </div>
    </motion.div>
  );
}
