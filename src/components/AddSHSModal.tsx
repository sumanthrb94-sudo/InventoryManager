import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, CheckCircle2, Truck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory, InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { StorageSelectCompact, GradeSelectCompact } from './FormSelects';
import { logInventoryEvent } from '../lib/inventoryEvents';

interface Props { onClose: () => void; }

interface SHSRow {
  id: string;
  model: string;
  qty: string;
  buyPrice: string;
  colour: string;
  storage: string;
  grade: string;
  supplierName: string;
  eta: string;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

function emptyRow(supplierName = ''): SHSRow {
  return { id: uid(), model: '', qty: '1', buyPrice: '', colour: '', storage: '', grade: '', supplierName, eta: '' };
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

export default function AddSHSModal({ onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [date, setDate]     = useState(today());
  const [rows, setRows]     = useState<SHSRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const knownNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);
  const supplierByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.name.toUpperCase()] = s.id;
    return m;
  }, [suppliers]);

  const lastSupplierName = rows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';

  const updateRow = useCallback((id: string, patch: Partial<SHSRow>) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r)), []);
  const removeRow = (id: string) => setRows(rs => rs.filter(r => r.id !== id));
  const addRow    = () => setRows(rs => [...rs, emptyRow(lastSupplierName)]);

  const totals = useMemo(() => {
    let units = 0, value = 0;
    for (const r of rows) {
      const qty = Math.max(1, parseInt(r.qty) || 1);
      const bp  = parseFloat(r.buyPrice) || 0;
      if (r.model.trim()) { units += qty; value += bp * qty; }
    }
    return { units, value };
  }, [rows]);

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
    const validRows = rows.filter(r => r.model.trim() && r.supplierName.trim());
    if (!validRows.length) { setError('Add at least one unit with a model and supplier.'); return; }

    setSaving(true);
    setError('');
    try {
      const batchId = `shs_bat_${Date.now()}`;
      const ts      = Date.now();

      const supCache: Record<string, string> = {};
      for (const r of validRows) {
        const key = r.supplierName.trim().toUpperCase();
        if (key && !supCache[key]) supCache[key] = await ensureSupplier(r.supplierName);
      }

      let idx = 0;
      let totalUnits = 0;
      for (const r of validRows) {
        const qty        = Math.max(1, parseInt(r.qty) || 1);
        const supplierId = supCache[r.supplierName.trim().toUpperCase()] || '';
        const category   = detectCategory(r.model);
        const brand      = detectBrand(category);
        const bp         = parseFloat(r.buyPrice) || 0;
        const noteStr    = r.eta.trim()
          ? `SHS — Expected stock · ${r.eta.trim()}`
          : 'SHS — Expected stock';

        for (let i = 0; i < qty; i++) {
          const tempId = `shs_${ts}_${idx++}`;
          const newUnit: InventoryUnit = {
            id: tempId,
            imei:           '',
            model:          r.model.trim(),
            brand,
            category,
            colour:         r.colour.trim() || 'Unknown',
            ...(r.storage.trim() ? { storage: r.storage.trim() } : {}),
            ...(r.grade.trim() ? { grade: r.grade.trim() } : {}),
            buyPrice:       bp,
            dateIn:         date,
            supplierId,
            batchId,
            status:         'incoming',
            flags:          [],
            notes:          noteStr,
            platformListed: false,
            listingSites:   [],
            ownerId:        'shared',
            createdAt:      new Date().toISOString(),
          };
          await dbService.create('inventoryUnits', tempId, newUnit);
          // Trigger shs_received notification for the first unit in batch to avoid spam
          if (i === 0) {
            notificationService.addNotification('shs_received', newUnit);
          }
          totalUnits++;
        }
      }

      await logInventoryEvent({
        type:    'batch_created',
        message: `SHS order logged: ${totalUnits} unit${totalUnits !== 1 ? 's' : ''} expected from ${[...new Set(validRows.map(r => r.supplierName))].join(', ')}`,
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 text-white rounded-xl flex items-center justify-center">
              <Truck size={17} />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-tight">Log SHS Order</p>
              <p className="text-[9px] text-amber-700 font-mono uppercase tracking-widest">
                Supplier Holding Stock · No IMEI yet · Receive when delivered
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-xl transition-all text-amber-400">
            <X size={16} />
          </button>
        </div>

        {/* Date */}
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Order Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="block mt-1 border border-gray-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
            <div className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-[9px] text-amber-800 font-mono leading-relaxed">
              IMEI will be blank — enter it when stock arrives via <strong>Receive</strong> on the Stock In screen.
              Units are immediately visible in the Sell screen for pre-selling.
            </div>
          </div>
        </div>

        {/* Column headers (desktop) */}
        <div className="hidden md:grid grid-cols-12 gap-1 px-5 pt-3 pb-1 flex-shrink-0">
          {[
            ['col-span-3', 'MODEL'],
            ['col-span-1', 'QTY'],
            ['col-span-1', 'BP (£)'],
            ['col-span-1', 'COLOUR'],
            ['col-span-1', 'GRADE'],
            ['col-span-1', 'STORAGE'],
            ['col-span-2', 'SUPPLIER'],
            ['col-span-2', 'ETA / NOTES'],
          ].map(([cls, label]) => (
            <div key={label} className={`${cls} text-[7px] font-bold uppercase tracking-widest text-gray-400`}>{label}</div>
          ))}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 md:px-5 py-3 space-y-2">
            <AnimatePresence initial={false}>
              {rows.map((row, idx) => (
                <SHSRowCard
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
              className="w-full py-3 border-2 border-dashed border-amber-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-amber-400 hover:border-amber-500 hover:text-amber-600 transition-all flex items-center justify-center gap-2"
            >
              <Plus size={13} /> Add Another SKU
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold">{totals.units} unit{totals.units !== 1 ? 's' : ''} expected</span>
              {totals.value > 0 && (
                <span className="text-gray-400 font-mono">£{totals.value.toLocaleString()} committed</span>
              )}
            </div>
            <span className="text-[8px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full uppercase">
              SHS — No stock in office
            </span>
          </div>

          {error && <p className="text-[10px] text-red-500 font-mono">{error}</p>}

          <button
            onClick={handleSave}
            disabled={saving || saved || totals.units === 0}
            className="w-full py-3.5 bg-amber-500 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved
              ? <><CheckCircle2 size={15} /> SHS Order Saved!</>
              : saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Truck size={15} /> Log {totals.units} Unit{totals.units !== 1 ? 's' : ''} as Expected</>
            }
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Row card ──────────────────────────────────────────────────────────────────

interface RowProps {
  key?: React.Key;
  row: SHSRow;
  index: number;
  knownSuppliers: string[];
  onChange: (patch: Partial<SHSRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function SHSRowCard({ row, index, knownSuppliers, onChange, onRemove, canRemove }: RowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className="border border-amber-200 bg-amber-50/30 rounded-xl overflow-hidden"
    >
      {/* Desktop grid */}
      <div className="hidden md:grid grid-cols-12 gap-1 px-3 py-2 items-center">
        <div className="col-span-3">
          <input value={row.model} onChange={e => onChange({ model: e.target.value })}
            placeholder="iPhone 16 Pro 256GB"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <input type="number" min={1} value={row.qty} onChange={e => onChange({ qty: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-center focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
            placeholder="0"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono text-right focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
            placeholder="Black Titanium"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-1">
          <StorageSelectCompact value={row.storage} onChange={e => onChange({ storage: e })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs font-mono focus:outline-none focus:border-amber-400 bg-white transition-all" />
        </div>
        <div className="col-span-2">
          <input list={`shs-sup-${row.id}`} value={row.supplierName}
            onChange={e => onChange({ supplierName: e.target.value })}
            placeholder="MHL"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white transition-all" />
          <datalist id={`shs-sup-${row.id}`}>
            {knownSuppliers.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <div className="col-span-1 flex items-center gap-1">
          <input value={row.eta} onChange={e => onChange({ eta: e.target.value })}
            placeholder="ETA 1 wk"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white transition-all" />
          {canRemove && (
            <button onClick={onRemove}
              className="p-1.5 hover:bg-red-50 hover:text-red-500 text-gray-300 rounded-lg transition-all flex-shrink-0">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Mobile fields */}
      <div className="md:hidden px-3 py-3 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[8px] font-bold text-amber-600 uppercase tracking-widest">#{index + 1}</span>
          {canRemove && (
            <button onClick={onRemove} className="text-[8px] text-red-400 hover:text-red-600 font-bold uppercase flex items-center gap-1">
              <Trash2 size={10} /> Remove
            </button>
          )}
        </div>
        <div>
          <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Model</label>
          <input value={row.model} onChange={e => onChange({ model: e.target.value })}
            placeholder="iPhone 16 Pro 256GB"
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Qty</label>
            <input type="number" min={1} value={row.qty} onChange={e => onChange({ qty: e.target.value })}
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono text-center focus:outline-none focus:border-amber-400 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Buy Price (£)</label>
            <input type="number" min={0} value={row.buyPrice} onChange={e => onChange({ buyPrice: e.target.value })}
              placeholder="0"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber-400 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Storage</label>
            <StorageSelectCompact value={row.storage} onChange={e => onChange({ storage: e })} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber-400 bg-white" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Colour</label>
            <input value={row.colour} onChange={e => onChange({ colour: e.target.value })}
              placeholder="Black Titanium"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Grade</label>
            <GradeSelectCompact value={row.grade} onChange={e => onChange({ grade: e })} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber-400 bg-white" />
          </div>
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Supplier</label>
            <input list={`shs-sup-m-${row.id}`} value={row.supplierName}
              onChange={e => onChange({ supplierName: e.target.value })}
              placeholder="MHL"
              className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white" />
            <datalist id={`shs-sup-m-${row.id}`}>
              {knownSuppliers.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>
        <div>
          <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">ETA / Notes</label>
          <input value={row.eta} onChange={e => onChange({ eta: e.target.value })}
            placeholder="ETA 1 week, pre-ordered…"
            className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-amber-400 bg-white" />
        </div>
      </div>
    </motion.div>
  );
}
