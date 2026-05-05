import React, { useState } from 'react';
import { X, CheckCircle2, PackageCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
}

export default function ReceiveSHSModal({ unit, onClose }: Props) {
  const [imei, setImei]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');

  const cleanImei = imei.replace(/\D/g, '');
  const imeiOk    = cleanImei.length >= 14 && cleanImei.length <= 15;

  const handleSave = async () => {
    if (!imeiOk) { setError('IMEI must be 14-15 digits'); return; }
    setSaving(true);
    setError('');
    try {
      const exists = await dbService.imeiExists(cleanImei);
      if (exists) { setError(`IMEI ${cleanImei} already in stock`); setSaving(false); return; }

      // Delete the old SHS placeholder and create with real IMEI as ID
      await dbService.delete('inventoryUnits', unit.id);
      await dbService.create('inventoryUnits', cleanImei, {
        imei: cleanImei,
        model:          unit.model,
        brand:          unit.brand,
        category:       unit.category,
        colour:         unit.colour,
        buyPrice:       unit.buyPrice,
        dateIn:         new Date().toISOString().split('T')[0],
        supplierId:     unit.supplierId,
        batchId:        unit.batchId,
        status:         'available',
        flags:          unit.flags || [],
        notes:          unit.notes || '',
        platformListed: false,
        listingSites:   [],
        conditionGrade: unit.conditionGrade,
        ownerId:        'shared',
        createdAt:      unit.createdAt,
      });
      setSaved(true);
      setTimeout(onClose, 900);
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
        className="bg-white w-full md:max-w-sm rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center">
              <PackageCheck size={15} />
            </div>
            <div>
              <p className="text-sm font-bold">Receive SHS Stock</p>
              <p className="text-[9px] text-gray-400 font-mono truncate max-w-[200px]">{unit.model}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-blue-500">Expected Unit</p>
            <p className="text-xs font-bold">{unit.model}</p>
            <p className="text-[9px] text-gray-500 font-mono">{unit.colour} · £{unit.buyPrice} BP</p>
          </div>

          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Real IMEI</label>
            <input
              autoFocus
              value={imei}
              onChange={e => { setImei(e.target.value.replace(/\D/g, '')); setError(''); }}
              placeholder="14-15 digit IMEI"
              maxLength={15}
              inputMode="numeric"
              className={`w-full mt-1 border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                imei && !imeiOk ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-black bg-white'
              }`}
            />
            {imei && (
              <p className={`text-[9px] font-mono mt-1 ${imeiOk ? 'text-emerald-600' : 'text-red-500'}`}>
                {cleanImei.length} digits {imeiOk ? '✓' : `— need ${14 - cleanImei.length} more`}
              </p>
            )}
          </div>

          {error && <p className="text-[10px] text-red-500 font-mono">{error}</p>}

          <button
            onClick={handleSave}
            disabled={!imeiOk || saving || saved}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved   ? <><CheckCircle2 size={14} /> Stock Received!</> :
             saving  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
             'Mark as Received → Available'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
