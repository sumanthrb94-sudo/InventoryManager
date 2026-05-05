import React, { useState } from 'react';
import { X, CheckCircle2, Edit3 } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
}

const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C'];
const QUICK_NOTES = ['CLEARANCE', 'ONU', 'BOXED', 'NO BOX'];

export default function EditUnitModal({ unit, onClose }: Props) {
  const { suppliers } = useInventoryStore();

  const [model,    setModel]    = useState(unit.model);
  const [colour,   setColour]   = useState(unit.colour || '');
  const [buyPrice, setBuyPrice] = useState(String(unit.buyPrice || ''));
  const [dateIn,   setDateIn]   = useState(unit.dateIn || '');
  const [grade,    setGrade]    = useState(unit.conditionGrade || '');
  const [notes,    setNotes]    = useState(unit.notes || '');
  const [suppId,   setSuppId]   = useState(unit.supplierId || '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  const supplierName = suppliers.find(s => s.id === suppId)?.name || '';

  const handleSave = async () => {
    if (!model.trim()) { setError('Model is required'); return; }
    const bp = parseFloat(buyPrice);
    if (isNaN(bp) || bp < 0) { setError('Valid buy price required'); return; }

    setSaving(true);
    setError('');
    try {
      await dbService.update('inventoryUnits', unit.id, {
        model:          model.trim(),
        colour:         colour.trim() || 'Unknown',
        buyPrice:       bp,
        dateIn:         dateIn || unit.dateIn,
        conditionGrade: grade || undefined,
        notes:          notes.trim(),
        supplierId:     suppId || unit.supplierId,
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
        className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
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
              <p className="text-[9px] text-gray-400 font-mono">{unit.imei || unit.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400"><X size={15} /></button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Model */}
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Model</label>
            <input value={model} onChange={e => setModel(e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-black bg-white transition-all" />
          </div>

          {/* Price + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Buy Price (£)</label>
              <input type="number" min={0} value={buyPrice} onChange={e => setBuyPrice(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Date In</label>
              <input type="date" value={dateIn} onChange={e => setDateIn(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-black bg-white transition-all" />
            </div>
          </div>

          {/* Colour + Grade */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Colour</label>
              <input value={colour} onChange={e => setColour(e.target.value)}
                placeholder="Black, White…"
                className="w-full mt-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-black bg-white transition-all" />
            </div>
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Condition</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {GRADES.map(g => (
                  <button key={g} onClick={() => setGrade(g === grade ? '' : g)}
                    className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                      grade === g ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}>{g}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Supplier */}
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Supplier</label>
            <select value={suppId} onChange={e => setSuppId(e.target.value)}
              className="w-full mt-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-black bg-white transition-all">
              <option value="">— Select supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Notes</label>
            <div className="flex flex-wrap gap-1 mt-1 mb-2">
              {QUICK_NOTES.map(n => (
                <button key={n} onClick={() => setNotes(notes === n ? '' : n)}
                  className={`px-2 py-1 rounded-lg text-[8px] font-bold border transition-all ${
                    notes === n ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}>{n}</button>
              ))}
            </div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} placeholder="Custom notes…"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-black bg-white resize-none transition-all" />
          </div>

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
