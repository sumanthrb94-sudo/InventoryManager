import React, { useState } from 'react';
import { X, CheckCircle2, Edit3 } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, DeviceCategory, DeviceStatus } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { GradeSelect, StorageSelect } from './FormSelects';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
}

const QUICK_NOTES = ['CLEARANCE', 'ONU', 'BOXED', 'NO BOX'];

const CATEGORY_OPTIONS: DeviceCategory[] = ['iPhone', 'iPad', 'Apple Watch', 'Tablet', 'Samsung S Series', 'Samsung A Series', 'Other'];
const STATUS_OPTIONS: DeviceStatus[]     = ['available', 'sold', 'reserved', 'returned', 'lost', 'incoming', 'ready_to_ship', 'fba'];

/**
 * EditUnitModal — admin-grade overlay for editing a single inventory
 * unit. Exposes every field on the InventoryUnit doc the operator is
 * likely to need to correct after a client walkthrough: identity
 * (imei, model, brand, category), status, pricing, supplier
 * attribution, and the marketplace / unlock / box fields used by the
 * listing workflow.
 *
 * Provenance fields (importBatchId, sourceFile, sourceRow,
 * importedAt, createdAt) and the unit doc id are intentionally
 * read-only — those are system fields tracked by the import path.
 */
export default function EditUnitModal({ unit, onClose }: Props) {
  const { suppliers } = useInventoryStore();

  // Identity
  const [imei,     setImei]     = useState(unit.imei || '');
  const [model,    setModel]    = useState(unit.model);
  const [brand,    setBrand]    = useState(unit.brand || '');
  const [category, setCategory] = useState<DeviceCategory>(unit.category);
  const [status,   setStatus]   = useState<DeviceStatus>(unit.status);

  // Stock attributes
  const [colour,   setColour]   = useState(unit.colour || '');
  const [grade,    setGrade]    = useState(unit.grade || '');
  const [storage,  setStorage]  = useState(unit.storage || '');
  const [boxIncluded,   setBoxIncluded]   = useState(!!unit.boxIncluded);
  const [batteryHealth, setBatteryHealth] = useState(unit.batteryHealth?.toString() || '');
  const [networkLock,   setNetworkLock]   = useState(unit.networkLock || '');
  const [activationLock,setActivationLock]= useState(unit.activationLock || '');

  // Pricing / supplier / provenance-ish
  const [buyPrice, setBuyPrice] = useState(String(unit.buyPrice || ''));
  const [dateIn,   setDateIn]   = useState(unit.dateIn || '');
  const [batchNo,  setBatchNo]  = useState(unit.batchNo || '');
  const [suppId,   setSuppId]   = useState(unit.supplierId || '');
  const [marketplace, setMarketplace] = useState(unit.marketplace || '');

  const [notes,    setNotes]    = useState(unit.notes || '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  const handleSave = async () => {
    if (!model.trim()) { setError('Model is required'); return; }
    const bp = parseFloat(buyPrice);
    if (isNaN(bp) || bp < 0) { setError('Valid buy price required'); return; }
    const bh = batteryHealth.trim() ? parseFloat(batteryHealth) : undefined;
    if (bh !== undefined && (isNaN(bh) || bh < 0 || bh > 100)) {
      setError('Battery health must be 0–100'); return;
    }

    setSaving(true);
    setError('');
    try {
      const supplier = suppliers.find(s => s.id === suppId);
      await dbService.update('inventoryUnits', unit.id, {
        imei:           imei.trim(),
        model:          model.trim(),
        brand:          brand.trim() || unit.brand,
        category,
        status,
        colour:         colour.trim() || 'Unknown',
        grade:          grade || undefined,
        storage:        storage || undefined,
        boxIncluded,
        batteryHealth:  bh,
        networkLock:    networkLock.trim() || undefined,
        activationLock: activationLock.trim() || undefined,
        buyPrice:       bp,
        dateIn:         dateIn || unit.dateIn,
        batchNo:        batchNo.trim() || undefined,
        supplierId:     suppId || unit.supplierId,
        supplierName:   supplier?.name || unit.supplierName,
        marketplace:    marketplace.trim() || undefined,
        notes:          notes.trim(),
      });
      setSaved(true);
      setTimeout(onClose, 800);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-black text-white rounded-xl flex items-center justify-center">
              <Edit3 size={14} />
            </div>
            <div>
              <p className="text-sm font-bold">Edit Unit</p>
              <p className="text-[9px] text-gray-400 font-mono">{unit.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400"><X size={15} /></button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ─── Identity ─────────────────────────────────────────────── */}
          <Section title="Identity">
            <FieldRow>
              <Field label="IMEI / Serial">
                <input value={imei} onChange={e => setImei(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Model">
                <input value={model} onChange={e => setModel(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
            <FieldRow cols={2}>
              <Field label="Brand">
                <input value={brand} onChange={e => setBrand(e.target.value)}
                  placeholder="Apple, Samsung…"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
              <Field label="Category">
                <select value={category} onChange={e => setCategory(e.target.value as DeviceCategory)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white">
                  {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Status">
                <select value={status} onChange={e => setStatus(e.target.value as DeviceStatus)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </FieldRow>
          </Section>

          {/* ─── Pricing / dates / batch ─────────────────────────────── */}
          <Section title="Pricing & Provenance">
            <FieldRow cols={2}>
              <Field label="Buy Price (£)">
                <input type="number" min={0} value={buyPrice} onChange={e => setBuyPrice(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black bg-white" />
              </Field>
              <Field label="Date In">
                <input type="date" value={dateIn} onChange={e => setDateIn(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
            <FieldRow cols={2}>
              <Field label="Batch No">
                <input value={batchNo} onChange={e => setBatchNo(e.target.value)}
                  placeholder="INV-2061"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black bg-white" />
              </Field>
              <Field label="Marketplace">
                <input value={marketplace} onChange={e => setMarketplace(e.target.value)}
                  placeholder="eBay, Amazon, R T S…"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Supplier">
                <select value={suppId} onChange={e => setSuppId(e.target.value)}
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white">
                  <option value="">— Select supplier —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </FieldRow>
          </Section>

          {/* ─── Physical attributes ─────────────────────────────────── */}
          <Section title="Physical">
            <FieldRow>
              <Field label="Colour">
                <input value={colour} onChange={e => setColour(e.target.value)}
                  placeholder="Black, Space Grey, Lilac Purple…"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
            <FieldRow cols={2}>
              <GradeSelect value={grade} onChange={setGrade} />
              <StorageSelect value={storage} onChange={setStorage} />
            </FieldRow>
            <FieldRow cols={2}>
              <Field label="Battery Health (%)">
                <input type="number" min={0} max={100} value={batteryHealth} onChange={e => setBatteryHealth(e.target.value)}
                  placeholder="0–100"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black bg-white" />
              </Field>
              <Field label="Box Included">
                <label className="mt-1 flex items-center gap-2 cursor-pointer h-[40px]">
                  <input type="checkbox" checked={boxIncluded} onChange={e => setBoxIncluded(e.target.checked)}
                    className="w-4 h-4 accent-black" />
                  <span className="text-sm text-slate-700">{boxIncluded ? 'Yes' : 'No'}</span>
                </label>
              </Field>
            </FieldRow>
            <FieldRow cols={2}>
              <Field label="Network Lock">
                <input value={networkLock} onChange={e => setNetworkLock(e.target.value)}
                  placeholder="Unlocked, EE, O2…"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
              <Field label="Activation Lock">
                <input value={activationLock} onChange={e => setActivationLock(e.target.value)}
                  placeholder="Off, On, Pending…"
                  className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white" />
              </Field>
            </FieldRow>
          </Section>

          {/* ─── Notes ───────────────────────────────────────────────── */}
          <Section title="Notes">
            <div className="flex flex-wrap gap-1 mb-2">
              {QUICK_NOTES.map(n => (
                <button key={n} type="button" onClick={() => setNotes(notes === n ? '' : n)}
                  className={`px-2 py-1 rounded-lg text-[8px] font-bold border transition-all ${
                    notes === n ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}>{n}</button>
              ))}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Custom notes…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black bg-white resize-none" />
          </Section>

          {error && <p className="text-[10px] text-red-500 font-mono">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full py-3.5 bg-black text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved   ? <><CheckCircle2 size={14} /> Saved!</> :
             saving  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
             'Save Changes'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Section header + child fields — keeps the now-long form
 *  visually grouped (Identity / Pricing / Physical / Notes). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400 mb-2">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FieldRow({ cols = 1, children }: { cols?: 1 | 2; children: React.ReactNode }) {
  return <div className={cols === 2 ? 'grid grid-cols-2 gap-3' : ''}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">{label}</label>
      {children}
    </div>
  );
}
