/**
 * AddStockManualModal — manual stock-in entry, follows the client's spec:
 *
 *   Office Stock: IMEI mandatory · status=available · counts as office stock
 *   SHS Supplier Stock: IMEI optional · status=incoming · NOT in office stock
 *
 * Both tabs use the same schema (per client whiteboard, 17-May):
 *   1. Stock In Date    (batch-level — top of modal)
 *   2. Model            (per row)
 *   3. IMEI / Serial    (per row — required for Office, optional for SHS)
 *   4. Grade            (per row — A / B / C / Refurbished)
 *   5. Storage          (per row — auto-parsed from Model, overridable)
 *   6. Colour           (per row)
 *   7. Supplier         (per row — autocomplete from existing suppliers)
 *   8. Buying Price     (per row — must be > 0)
 *   9. Notes            (per row — optional)
 *
 * Priority-1 rule: IMEI duplication is rejected. The service layer
 * (addUnitManual) checks the live inventoryUnits collection; the UI
 * also runs an in-batch dedupe for instant feedback. Apple devices accept
 * a 10–12 char alphanumeric serial in place of the 15-digit IMEI.
 */
import React, { useState, useMemo, useCallback } from 'react';
import { X, Plus, Trash2, CheckCircle2, PackagePlus, AlertCircle, Truck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { dbService } from '../lib/dbService';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { addUnitManual, ensureSupplier } from '../services';
import type { InventoryUnit, ListingSite } from '../types';

type Mode = 'office' | 'shs';

interface Props {
  onClose: () => void;
  /** Initial tab. 'office' = default. The 'SHS Order' button on Buy passes 'shs'. */
  initialMode?: Mode;
}

interface StockRow {
  id: string;
  model: string;
  imei: string;          // required for Office; optional for SHS
  grade: string;         // A / B / C / Refurbished
  storage: string;       // auto-parsed but editable
  colour: string;
  supplierName: string;
  buyPrice: string;
  notes: string;
  /** When true the operator has manually edited Storage; we stop auto-syncing
   *  it from Model so their override sticks. */
  storageTouched?: boolean;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

function emptyRow(supplierName = ''): StockRow {
  return {
    id: uid(),
    model: '', imei: '', grade: '', storage: '', colour: '',
    supplierName, buyPrice: '', notes: '',
  };
}

const GRADES = ['A', 'B', 'C', 'Refurbished', 'Other'];

interface RowValidation {
  modelOk: boolean;
  imeiOk: boolean;        // true when IMEI is valid OR mode=shs and IMEI is empty
  isApple: boolean;
  imeiRequired: boolean;
  imeiEmpty: boolean;
  dupeInBatch: boolean;
  dupeInDb: boolean;
  bpOk: boolean;
  supplierOk: boolean;
  /** Whole-row green-light: all required fields satisfied. */
  complete: boolean;
}

export default function AddStockManualModal({ onClose, initialMode = 'office' }: Props) {
  const { suppliers, units } = useInventoryStore();
  const [mode, setMode]     = useState<Mode>(initialMode);
  const [date, setDate]     = useState(today());
  const [rows, setRows]     = useState<StockRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const supplierNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);
  const existingImeis = useMemo(() => {
    const s = new Set<string>();
    for (const u of units) if (u.imei) s.add(u.imei.trim().toUpperCase());
    return s;
  }, [units]);

  // Carry the last typed supplier forward — saves re-typing across rows in
  // the same delivery from one source.
  const lastSupplier = rows.filter(r => r.supplierName).at(-1)?.supplierName ?? '';

  const updateRow = useCallback((id: string, patch: Partial<StockRow>) => {
    setRows(rs => rs.map(r => {
      if (r.id !== id) return r;
      const next: StockRow = { ...r, ...patch };
      // Auto-sync Storage from Model unless the operator has touched it.
      if ('model' in patch && !next.storageTouched) {
        const parsed = parseBrandModelStorage(next.model);
        next.storage = parsed.storage || '';
      }
      if ('storage' in patch) next.storageTouched = true;
      return next;
    }));
  }, []);

  const removeRow = (id: string) => setRows(rs => rs.length > 1 ? rs.filter(r => r.id !== id) : rs);
  const addRow    = () => setRows(rs => [...rs, emptyRow(lastSupplier)]);

  // ── Validation per row ─────────────────────────────────────────────────────
  const validation: RowValidation[] = useMemo(() => rows.map(r => {
    const imei = r.imei.trim().toUpperCase();
    const isApple = isAppleDevice(r.model);
    const imeiRequired = mode === 'office';
    const imeiEmpty = imei.length === 0;
    const imeiFormatOk = imei ? isValidImei(imei, { isAppleSerial: isApple }) : false;

    const dupeInBatch = !!imei && rows.filter(x => x.imei.trim().toUpperCase() === imei).length > 1;
    const dupeInDb    = !!imei && existingImeis.has(imei);

    const modelOk    = r.model.trim().length > 0;
    const supplierOk = r.supplierName.trim().length > 0;
    const bp         = parseFloat(r.buyPrice);
    const bpOk       = Number.isFinite(bp) && bp > 0;

    const imeiOk =
      imeiRequired
        ? imeiFormatOk && !dupeInBatch && !dupeInDb
        : (imeiEmpty || (imeiFormatOk && !dupeInBatch && !dupeInDb));

    return {
      modelOk, imeiOk, isApple, imeiRequired, imeiEmpty,
      dupeInBatch, dupeInDb, bpOk, supplierOk,
      complete: modelOk && imeiOk && bpOk && supplierOk,
    };
  }), [rows, mode, existingImeis]);

  // ── Totals strip ───────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let validUnits = 0, value = 0;
    rows.forEach((r, i) => {
      if (validation[i].complete) {
        validUnits++;
        value += parseFloat(r.buyPrice) || 0;
      }
    });
    return { validUnits, value };
  }, [rows, validation]);

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    const validIdxs: number[] = [];
    validation.forEach((v, i) => { if (v.complete) validIdxs.push(i); });
    if (!validIdxs.length) {
      setError('Add at least one row with all required fields filled in.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const batchId = mode === 'office'
        ? `manual_bat_${Date.now()}`
        : `shs_bat_${Date.now()}`;

      let total = 0;
      const failures: string[] = [];

      // SHS mode caches supplier ids by name so we only ensureSupplier once
      // per name per batch. Office mode uses the service-side ensureSupplier
      // via addUnitManual.
      const supplierIdCache: Record<string, string> = {};

      for (const i of validIdxs) {
        const r = rows[i];
        try {
          if (mode === 'office') {
            const res = await addUnitManual({
              imei: r.imei,
              model: r.model,
              buyPrice: parseFloat(r.buyPrice) || 0,
              supplierName: r.supplierName,
              colour: r.colour,
              storage: r.storage,
              grade: r.grade,
              notes: r.notes,
              dateIn: date,
              batchId,
            });
            if (!res.ok) {
              failures.push(`${r.imei.trim().toUpperCase() || '(no imei)'}: ${res.message ?? res.error}`);
              continue;
            }
            notificationService.addNotification('new_stock', {
              id: res.id!, imei: res.id!, model: r.model,
              colour: r.colour, buyPrice: parseFloat(r.buyPrice) || 0,
            } as any);
            total++;
          } else {
            // SHS path — IMEI optional. Create the unit directly with
            // status='incoming' so it shows up in the SHS section of BuySheet.
            const supplierName = r.supplierName.trim();
            const supKey = supplierName.toUpperCase();
            if (!supplierIdCache[supKey]) {
              supplierIdCache[supKey] = await ensureSupplier(supplierName);
            }
            const supplierId = supplierIdCache[supKey];
            const parsed = parseBrandModelStorage(r.model);
            const cleanModel = parsed.model || r.model.trim();
            const storage = r.storage.trim() || parsed.storage || '';
            const brand = parsed.brand !== 'Other' ? parsed.brand : 'Other';
            // Apple serials surface as IMEI too; uppercase + trim.
            const imei = r.imei.trim().toUpperCase();
            const id = imei || `shs_manual_${Date.now()}_${i}`;
            const newUnit: InventoryUnit = {
              id,
              imei,
              model: cleanModel,
              brand,
              category: detectCategory(r.model),
              colour: r.colour.trim() || 'Unknown',
              ...(storage ? { storage } : {}),
              ...(r.grade.trim() ? { grade: r.grade.trim() } : {}),
              buyPrice: parseFloat(r.buyPrice) || 0,
              dateIn: date,
              supplierId,
              supplierName,
              batchId,
              status: 'incoming',
              statusRaw: 'SHS — Manual',
              flags: [],
              notes: r.notes.trim() || 'SHS — Awaiting delivery',
              platformListed: false,
              listingSites: [] as ListingSite[],
              ownerId: 'shared',
              createdAt: new Date().toISOString(),
            };
            await dbService.create('inventoryUnits', id, newUnit);
            if (i === validIdxs[0]) {
              notificationService.addNotification('shs_received', newUnit);
            }
            total++;
          }
        } catch (err: any) {
          failures.push(`row ${i + 1}: ${err?.message || 'save failed'}`);
        }
      }

      if (total > 0) {
        await logInventoryEvent({
          type: 'batch_created',
          message: mode === 'office'
            ? `Manual add: ${total} unit${total === 1 ? '' : 's'} added (IMEI-tracked)`
            : `Manual SHS: ${total} unit${total === 1 ? '' : 's'} flagged supplier-held`,
          batchId,
        });
      }

      if (failures.length && total === 0) {
        setError(failures[0]);
        setSaving(false);
        return;
      }
      if (failures.length) {
        setError(`${total} saved · ${failures.length} rejected: ${failures[0]}`);
      }
      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed. Check connection.');
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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
        className="bg-white w-full md:max-w-4xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header + mode tabs */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${mode === 'shs' ? 'bg-amber-500' : 'bg-slate-900'}`}>
              {mode === 'shs' ? <Truck size={15} /> : <PackagePlus size={15} />}
            </div>
            <div>
              <h3 className="text-sm font-bold">Add Stock</h3>
              <p className="text-[9px] text-gray-400 font-mono">
                Stock-In Page · {mode === 'office' ? 'Office Stock' : 'SHS Supplier Stock'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400">
            <X size={15} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="px-5 pt-3 pb-2 flex-shrink-0 flex items-center gap-2">
          <ModeTab
            label="Office Stock"
            sub="IMEI mandatory · counts as office stock"
            active={mode === 'office'}
            onClick={() => setMode('office')}
            tone="emerald"
          />
          <ModeTab
            label="SHS Supplier Stock"
            sub="IMEI optional · supplier-held, not office stock"
            active={mode === 'shs'}
            onClick={() => setMode('shs')}
            tone="amber"
          />
        </div>

        {/* Top-level Stock In Date */}
        <div className="px-5 pb-2 flex items-center gap-3 flex-shrink-0">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Stock In Date</label>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12px] font-mono focus:outline-none focus:border-black"
          />
          <p className="text-[9px] font-mono text-gray-400 ml-auto">
            {rows.length} row{rows.length === 1 ? '' : 's'} · {totals.validUnits} ready · £{totals.value.toFixed(0)}
          </p>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <Row
                key={r.id}
                row={r}
                index={i}
                validation={validation[i]}
                mode={mode}
                supplierNames={supplierNames}
                onChange={patch => updateRow(r.id, patch)}
                onRemove={() => removeRow(r.id)}
                canRemove={rows.length > 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2 border-2 border-dashed border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-all"
          >
            <Plus size={12} /> Add Row
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] font-mono text-gray-500 truncate">
            {error
              ? <span className="text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} />{error}</span>
              : `${totals.validUnits} unit${totals.validUnits === 1 ? '' : 's'} ready · £${totals.value.toFixed(0)}`}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onClose} type="button"
              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!totals.validUnits || saving || saved}
              className={`px-4 py-2.5 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 flex items-center gap-2
                ${mode === 'shs' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-900 hover:bg-slate-800'}`}
            >
              {saved
                ? <><CheckCircle2 size={12} /> Saved!</>
                : saving
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <>Save {totals.validUnits} {mode === 'shs' ? 'SHS' : ''} unit{totals.validUnits === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Mode tab pill ────────────────────────────────────────────────────────────
function ModeTab({
  label, sub, active, onClick, tone,
}: {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  tone: 'emerald' | 'amber';
}) {
  const activeCls = tone === 'amber'
    ? 'bg-amber-50 border-amber-300 text-amber-900'
    : 'bg-emerald-50 border-emerald-300 text-emerald-900';
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-left rounded-xl border px-3 py-2 transition-all ${
        active ? activeCls : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest leading-tight">{label}</p>
      <p className="text-[9px] font-mono opacity-70 mt-0.5">{sub}</p>
    </button>
  );
}

// ── One row in the entry grid ────────────────────────────────────────────────
function Row({
  row, index, validation, mode, supplierNames, onChange, onRemove, canRemove,
}: {
  key?: React.Key;
  row: StockRow;
  index: number;
  validation: RowValidation;
  mode: Mode;
  supplierNames: string[];
  onChange: (patch: Partial<StockRow>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  // ── IMEI helper text — shows what's wrong (or empty when fine) ─────────────
  const imeiHelp = (() => {
    if (mode === 'shs' && validation.imeiEmpty) return 'Optional for SHS';
    if (validation.imeiEmpty && validation.imeiRequired) return 'Required';
    if (validation.dupeInBatch) return 'Duplicate in this batch';
    if (validation.dupeInDb)    return 'Already in inventory';
    if (!validation.imeiOk && !validation.imeiEmpty) {
      return validation.isApple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE;
    }
    return '';
  })();

  return (
    <div className={`border rounded-2xl p-3 transition-all ${
      validation.complete
        ? 'border-emerald-200 bg-emerald-50/30'
        : 'border-slate-200 bg-slate-50/40'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-mono text-gray-400 w-6 text-center">#{index + 1}</span>
        <div className="flex-1" />
        {validation.complete && <CheckCircle2 size={13} className="text-emerald-500" />}
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all"
            title="Remove row"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Grid: Model · IMEI · Grade */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
        <Cell label="Model *" colSpan={5}>
          <input
            value={row.model}
            onChange={e => onChange({ model: e.target.value })}
            placeholder="e.g. iPhone 13 128GB"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none ${
              row.model.trim() ? 'border-gray-200 focus:border-black' : 'border-gray-200 focus:border-black'
            }`}
          />
        </Cell>
        <Cell
          label={mode === 'office' ? 'IMEI / Serial *' : 'IMEI / Serial'}
          colSpan={4}
          help={imeiHelp}
          helpTone={validation.imeiEmpty && !validation.imeiRequired ? 'muted' : 'error'}
        >
          <input
            value={row.imei}
            onChange={e => onChange({ imei: e.target.value })}
            placeholder={validation.isApple
              ? '15-digit IMEI or 10-12 char Apple serial'
              : '15-digit IMEI (digits only)'}
            inputMode={validation.isApple ? 'text' : 'numeric'}
            maxLength={validation.isApple ? 16 : 15}
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none transition-all ${
              imeiHelp && !(validation.imeiEmpty && !validation.imeiRequired)
                ? 'border-rose-300 bg-rose-50 focus:border-rose-500'
                : row.imei.trim()
                  ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-500'
                  : 'border-gray-200 focus:border-black bg-white'
            }`}
          />
        </Cell>
        <Cell label="Grade" colSpan={3}>
          <select
            value={row.grade}
            onChange={e => onChange({ grade: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black bg-white"
          >
            <option value="">—</option>
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </Cell>
      </div>

      {/* Grid: Storage · Colour · Supplier · BP */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 mt-2">
        <Cell label="Storage" colSpan={2}>
          <input
            value={row.storage}
            onChange={e => onChange({ storage: e.target.value })}
            placeholder="128GB"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none focus:border-black"
          />
        </Cell>
        <Cell label="Colour" colSpan={3}>
          <input
            value={row.colour}
            onChange={e => onChange({ colour: e.target.value })}
            placeholder="e.g. Space Grey"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </Cell>
        <Cell label="Supplier *" colSpan={4}>
          <input
            list="add-stock-supplier-names"
            value={row.supplierName}
            onChange={e => onChange({ supplierName: e.target.value })}
            placeholder="Type or pick"
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
          <datalist id="add-stock-supplier-names">
            {supplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </Cell>
        <Cell label="BP (£) *" colSpan={3} help={!validation.bpOk && row.buyPrice ? 'Must be > 0' : ''} helpTone="error">
          <input
            type="number" min="0" step="0.01"
            value={row.buyPrice}
            onChange={e => onChange({ buyPrice: e.target.value })}
            placeholder="0.00"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none ${
              row.buyPrice && !validation.bpOk
                ? 'border-rose-300 bg-rose-50'
                : 'border-gray-200 focus:border-black'
            }`}
          />
        </Cell>
      </div>

      {/* Notes (full width) */}
      <Cell label="Notes" colSpan={12} className="mt-2">
        <input
          value={row.notes}
          onChange={e => onChange({ notes: e.target.value })}
          placeholder="Optional — condition, lock state, etc."
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
        />
      </Cell>
    </div>
  );
}

function Cell({
  label, children, colSpan, help, helpTone, className,
}: {
  label: string;
  children: React.ReactNode;
  colSpan: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  help?: string;
  helpTone?: 'muted' | 'error';
  className?: string;
}) {
  const spanCls = {
    1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4',
    5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8',
    9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12',
  }[colSpan];
  const helpCls = helpTone === 'muted' ? 'text-slate-400' : 'text-rose-600';
  return (
    <div className={`${spanCls} ${className ?? ''}`}>
      <label className="text-[9px] font-bold uppercase tracking-widest text-gray-500 block mb-0.5">{label}</label>
      {children}
      {help && <p className={`text-[9px] font-mono mt-0.5 ${helpCls}`}>{help}</p>}
    </div>
  );
}

// ── Category helper (local — avoids importing the heavy detectCategory) ─────
// The service does the real categorisation on the office-stock path; for the
// SHS direct-create path we just need a sensible default.
function detectCategory(model: string): InventoryUnit['category'] {
  const s = String(model || '').toLowerCase();
  if (s.includes('iphone'))       return 'iPhone';
  if (s.includes('ipad'))         return 'iPad';
  if (s.includes('apple watch'))  return 'Apple Watch';
  if (s.includes('galaxy s'))     return 'Samsung S Series';
  if (s.includes('galaxy a'))     return 'Samsung A Series';
  if (s.includes('tab') || s.includes('tablet')) return 'Tablet';
  return 'Other';
}
