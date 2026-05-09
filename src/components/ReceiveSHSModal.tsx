import React, { useState } from 'react';
import { X, CheckCircle2, PackageCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
}

export default function ReceiveSHSModal({ unit, onClose }: Props) {
  const [imei, setImei]     = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const cleanImei = imei.replace(/\D/g, '');
  // Allow 14-15 digit numeric IMEIs OR accept alphanumeric serial (≥8 chars) for tablets
  const isNumeric    = /^\d+$/.test(cleanImei);
  const numericOk    = isNumeric && cleanImei.length >= 14 && cleanImei.length <= 15;
  const alphaSerial  = imei.trim().length >= 8 && !isNumeric;
  const inputOk      = numericOk || alphaSerial;
  const finalId      = alphaSerial ? imei.trim().toUpperCase() : cleanImei;

  const handleSave = async () => {
    if (!inputOk) { setError('Enter a 14-15 digit IMEI or device serial (≥8 chars)'); return; }
    setSaving(true);
    setError('');
    try {
      const exists = await dbService.imeiExists(finalId);
      if (exists) { setError(`${finalId} already exists in stock`); setSaving(false); return; }

      const newUnit: InventoryUnit = {
        id: finalId,
        imei:           finalId,
        model:          unit.model,
        brand:          unit.brand,
        category:       unit.category,
        colour:         unit.colour || 'Unknown',
        storage:        unit.storage,
        buyPrice:       unit.buyPrice,
        dateIn:         new Date().toISOString().split('T')[0],
        supplierId:     unit.supplierId,
        batchId:        unit.batchId,
        status:         'available',
        flags:          unit.flags || [],
        notes:          (unit.notes || '').replace(/SHS\s*-\s*Expected stock\s*·?\s*/i, '').trim(),
        platformListed: false,
        listingSites:   [],
        ownerId:        unit.ownerId || 'shared',
        createdAt:      unit.createdAt,
      };

      await dbService.delete('inventoryUnits', unit.id);
      await dbService.create('inventoryUnits', finalId, newUnit);

      // Trigger new_stock notification when SHS unit is received
      notificationService.addNotification('new_stock', newUnit);

      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Save failed — please try again');
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
        className="bg-white w-full md:max-w-sm rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden"
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
            <p className="text-[9px] text-gray-500 font-mono">
              {unit.colour || 'Unknown'} · £{unit.buyPrice} BP
              {unit.supplierId ? ` · ${unit.supplierId}` : ''}
            </p>
          </div>

          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">
              IMEI / Serial Number
            </label>
            <input
              autoFocus
              value={imei}
              onChange={e => { setImei(e.target.value); setError(''); }}
              placeholder="14-15 digit IMEI or device serial"
              maxLength={20}
              inputMode="text"
              className={`w-full mt-1 border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                imei && !inputOk ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-black bg-white'
              }`}
            />
            {imei.trim().length > 0 && (
              <p className={`text-[9px] font-mono mt-1 ${inputOk ? 'text-emerald-600' : 'text-red-500'}`}>
                {alphaSerial
                  ? `Serial: ${finalId} ✓`
                  : isNumeric
                    ? `${cleanImei.length} digits ${numericOk ? '✓' : `— need ${14 - cleanImei.length} more`}`
                    : 'Contains non-numeric chars — treating as serial'}
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <p className="text-[10px] text-red-600 font-mono">{error}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!inputOk || saving || saved}
            className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved
              ? <><CheckCircle2 size={14} /> Stock Received!</>
              : saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : 'Mark as Received → Available'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
