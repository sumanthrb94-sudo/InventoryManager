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
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const cleanImei = imei.replace(/\D/g, '');
  const isNumeric    = /^\d+$/.test(cleanImei);
  const numericOk    = isNumeric && cleanImei.length >= 14 && cleanImei.length <= 15;
  const alphaSerial  = imei.trim().length >= 8 && !isNumeric;
  const inputOk      = (numericOk || alphaSerial || (quantity > 1 && !imei.trim())) && quantity >= 1;
  const finalId      = alphaSerial ? imei.trim().toUpperCase() : cleanImei;

  const handleSave = async () => {
    if (!inputOk) {
      if (quantity > 1 && !imei.trim()) {
        setError('For batch adds, provide starting IMEI or leave blank for auto-generate');
      } else {
        setError('Enter a 14-15 digit IMEI or device serial (≥8 chars)');
      }
      return;
    }

    setSaving(true);
    setError('');
    try {
      const baseDate = new Date().toISOString().split('T')[0];
      const unitsToAdd: InventoryUnit[] = [];

      // Generate units for batch operation
      for (let i = 0; i < quantity; i++) {
        let unitId: string;

        if (quantity === 1) {
          // Single unit - use provided IMEI
          unitId = finalId;
        } else if (imei.trim()) {
          // Batch with starting IMEI - generate variants
          if (isNumeric && numericOk) {
            // Numeric IMEI - increment the last digit for each unit
            const baseNum = BigInt(finalId);
            unitId = (baseNum + BigInt(i)).toString();
          } else {
            // Alphanumeric - add suffix
            unitId = `${finalId}-${String(i + 1).padStart(3, '0')}`;
          }
        } else {
          // Auto-generate unique ID
          unitId = `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
        }

        // Check if this unit already exists
        const exists = await dbService.imeiExists(unitId);
        if (exists) {
          setError(`${unitId} already exists in stock (unit ${i + 1} of ${quantity})`);
          setSaving(false);
          return;
        }

        const newUnit: InventoryUnit = {
          id: unitId,
          imei: unitId,
          model: unit.model,
          brand: unit.brand,
          category: unit.category,
          colour: unit.colour || 'Unknown',
          storage: unit.storage,
          buyPrice: unit.buyPrice,
          dateIn: baseDate,
          supplierId: unit.supplierId,
          batchId: unit.batchId,
          status: 'available',
          flags: unit.flags || [],
          notes: (unit.notes || '').replace(/SHS\s*-\s*Expected stock\s*·?\s*/i, '').trim(),
          platformListed: false,
          listingSites: [],
          ownerId: unit.ownerId || 'shared',
          createdAt: unit.createdAt,
        };

        unitsToAdd.push(newUnit);
      }

      // Delete the original SHS pending unit
      await dbService.delete('inventoryUnits', unit.id);

      // Add all new units
      await Promise.all(unitsToAdd.map(u => dbService.create('inventoryUnits', u.id, u)));

      // Trigger batched notification
      notificationService.addNotification('new_stock', unitsToAdd[0], undefined, quantity);

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

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">
                {quantity > 1 ? 'Starting IMEI (optional)' : 'IMEI / Serial Number'}
              </label>
              <input
                autoFocus
                value={imei}
                onChange={e => { setImei(e.target.value); setError(''); }}
                placeholder={quantity > 1 ? 'Leave blank to auto-generate' : '14-15 digit IMEI or device serial'}
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
            <div>
              <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">
                Quantity
              </label>
              <input
                type="number"
                min="1"
                max="999"
                value={quantity}
                onChange={e => { setQuantity(Math.max(1, parseInt(e.target.value) || 1)); setError(''); }}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-3 text-sm font-bold text-center focus:outline-none focus:border-black bg-white transition-all"
              />
              <p className="text-[9px] font-mono text-gray-400 mt-1 text-center">
                {quantity > 1 ? `×${quantity}` : 'single'}
              </p>
            </div>
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
              ? <><CheckCircle2 size={14} /> {quantity > 1 ? `${quantity} Units Received!` : 'Stock Received!'}</>
              : saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : quantity > 1
                  ? `Add ${quantity}× → Available`
                  : 'Mark as Received → Available'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
