import React, { useState } from 'react';
import { X, CheckCircle2, PackageCheck, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { notificationService } from '../lib/notificationService';

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
}

interface ColorVariant {
  id: string;
  name: string;
  quantity: number;
}

export default function ReceiveSHSModal({ unit, onClose }: Props) {
  const [imei, setImei]     = useState('');
  const [quantity, setQuantity] = useState(1);
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([]);
  const [newColorName, setNewColorName] = useState('');
  const [newColorQty, setNewColorQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const cleanImei = imei.replace(/\D/g, '');
  const isNumeric    = /^\d+$/.test(cleanImei);
  const numericOk    = isNumeric && cleanImei.length >= 14 && cleanImei.length <= 15;
  const alphaSerial  = imei.trim().length >= 8 && !isNumeric;
  const inputOk      = (numericOk || alphaSerial || (quantity > 1 && !imei.trim())) && quantity >= 1;
  const finalId      = alphaSerial ? imei.trim().toUpperCase() : cleanImei;

  // Calculate color totals and validation
  const colorTotalQty = colorVariants.reduce((sum, c) => sum + c.quantity, 0);
  const isColorDistributionValid = colorVariants.length > 0 && colorTotalQty === quantity;
  const hasColorDistribution = colorVariants.length > 0;
  const showColorDist = quantity > 1; // Only show color distribution for batches

  const addColorVariant = () => {
    if (!newColorName.trim() || newColorQty < 1) {
      setError('Enter color name and quantity');
      return;
    }

    // Check if color already exists
    if (colorVariants.some(c => c.name.toLowerCase() === newColorName.toLowerCase())) {
      setError('Color already added');
      return;
    }

    // Check if adding this color would exceed total quantity
    if (colorTotalQty + newColorQty > quantity) {
      setError(`Total would be ${colorTotalQty + newColorQty}, but batch quantity is ${quantity}`);
      return;
    }

    setColorVariants([
      ...colorVariants,
      {
        id: Math.random().toString(36).substr(2, 9),
        name: newColorName.trim(),
        quantity: newColorQty,
      },
    ]);
    setNewColorName('');
    setNewColorQty(1);
    setError('');
  };

  const removeColorVariant = (id: string) => {
    setColorVariants(colorVariants.filter(c => c.id !== id));
    setError('');
  };

  const updateColorQuantity = (id: string, newQty: number) => {
    const variant = colorVariants.find(c => c.id === id);
    if (!variant) return;

    const otherTotal = colorVariants.reduce((sum, c) => c.id === id ? sum : sum + c.quantity, 0);
    if (otherTotal + newQty > quantity) {
      setError(`Total would be ${otherTotal + newQty}, but batch quantity is ${quantity}`);
      return;
    }

    setColorVariants(colorVariants.map(c => c.id === id ? { ...c, quantity: newQty } : c));
    setError('');
  };

  const handleSave = async () => {
    if (!inputOk) {
      if (quantity > 1 && !imei.trim()) {
        setError('For batch adds, provide starting IMEI or leave blank for auto-generate');
      } else {
        setError('Enter a 14-15 digit IMEI or device serial (≥8 chars)');
      }
      return;
    }

    // If batch and color distribution required but not specified, warn
    if (showColorDist && !hasColorDistribution) {
      setError(`Specify color distribution for ${quantity} units, or set quantity to 1`);
      return;
    }

    // If color distribution specified, validate it
    if (hasColorDistribution && !isColorDistributionValid) {
      setError(`Color quantities must total ${quantity}. Currently: ${colorTotalQty}`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const baseDate = new Date().toISOString().split('T')[0];
      const unitsToAdd: InventoryUnit[] = [];

      // If color distribution exists, use it
      if (hasColorDistribution) {
        let unitCounter = 0;
        for (const colorVariant of colorVariants) {
          for (let i = 0; i < colorVariant.quantity; i++) {
            let unitId: string;

            if (imei.trim()) {
              if (isNumeric && numericOk) {
                const baseNum = BigInt(finalId);
                unitId = (baseNum + BigInt(unitCounter)).toString();
              } else {
                unitId = `${finalId}-${String(unitCounter + 1).padStart(3, '0')}`;
              }
            } else {
              unitId = `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${unitCounter}`;
            }

            const exists = await dbService.imeiExists(unitId);
            if (exists) {
              setError(`${unitId} already exists`);
              setSaving(false);
              return;
            }

            unitsToAdd.push({
              id: unitId,
              imei: unitId,
              model: unit.model,
              brand: unit.brand,
              category: unit.category,
              colour: colorVariant.name,
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
            });

            unitCounter++;
          }
        }
      } else {
        // Original batch logic without color distribution
        for (let i = 0; i < quantity; i++) {
          let unitId: string;

          if (quantity === 1) {
            unitId = finalId;
          } else if (imei.trim()) {
            if (isNumeric && numericOk) {
              const baseNum = BigInt(finalId);
              unitId = (baseNum + BigInt(i)).toString();
            } else {
              unitId = `${finalId}-${String(i + 1).padStart(3, '0')}`;
            }
          } else {
            unitId = `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`;
          }

          const exists = await dbService.imeiExists(unitId);
          if (exists) {
            setError(`${unitId} already exists in stock (unit ${i + 1} of ${quantity})`);
            setSaving(false);
            return;
          }

          unitsToAdd.push({
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
          });
        }
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

        <div className="p-5 space-y-4 max-h-[calc(100dvh-200px)] overflow-y-auto">
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-blue-500">Expected Unit</p>
            <p className="text-xs font-bold">{unit.model}</p>
            <p className="text-[9px] text-gray-500 font-mono">
              {unit.storage && `${unit.storage} · `}£{unit.buyPrice} BP
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
                onChange={e => {
                  const newQty = Math.max(1, parseInt(e.target.value) || 1);
                  setQuantity(newQty);
                  // Clear color variants if reducing quantity below current total
                  if (newQty < colorTotalQty) {
                    setColorVariants([]);
                  }
                  setError('');
                }}
                className="w-full mt-1 border border-gray-200 rounded-xl px-3 py-3 text-sm font-bold text-center focus:outline-none focus:border-black bg-white transition-all"
              />
              <p className="text-[9px] font-mono text-gray-400 mt-1 text-center">
                {quantity > 1 ? `×${quantity}` : 'single'}
              </p>
            </div>
          </div>

          {/* Color Distribution Section */}
          {showColorDist && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[8px] font-bold uppercase tracking-widest text-purple-600">Color Distribution</p>
                {hasColorDistribution && (
                  <p className={`text-[9px] font-bold font-mono ${isColorDistributionValid ? 'text-emerald-600' : 'text-red-600'}`}>
                    {colorTotalQty} / {quantity}
                  </p>
                )}
              </div>

              {/* Color Input */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Color (e.g., Purple, Blue)"
                    value={newColorName}
                    onChange={e => { setNewColorName(e.target.value); setError(''); }}
                    maxLength={20}
                    className="flex-1 border border-purple-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-600 bg-white"
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={newColorQty}
                    onChange={e => setNewColorQty(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-16 border border-purple-200 rounded-lg px-2 py-2 text-sm font-bold text-center focus:outline-none focus:border-purple-600 bg-white"
                  />
                  <button
                    onClick={addColorVariant}
                    disabled={!newColorName.trim() || newColorQty < 1}
                    className="px-3 py-2 bg-purple-600 text-white rounded-lg text-[10px] font-bold hover:bg-purple-700 transition-all disabled:opacity-50 flex items-center gap-1"
                  >
                    <Plus size={12} /> Add
                  </button>
                </div>

                {/* Color List */}
                <AnimatePresence>
                  {colorVariants.map(color => (
                    <motion.div
                      key={color.id}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center justify-between bg-white border border-purple-100 rounded-lg px-3 py-2"
                    >
                      <div className="flex-1">
                        <p className="text-[9px] font-bold">{color.name}</p>
                        <p className="text-[8px] text-gray-400 font-mono">Qty: {color.quantity}</p>
                      </div>
                      <input
                        type="number"
                        min="1"
                        value={color.quantity}
                        onChange={e => updateColorQuantity(color.id, Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-12 border border-purple-200 rounded px-2 py-1 text-[9px] font-bold text-center focus:outline-none focus:border-purple-600"
                      />
                      <button
                        onClick={() => removeColorVariant(color.id)}
                        className="ml-2 p-1 text-red-500 hover:bg-red-50 rounded transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {colorVariants.length > 0 && !isColorDistributionValid && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-[8px] text-amber-700 font-mono">
                    Color total ({colorTotalQty}) must equal batch quantity ({quantity})
                  </p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <p className="text-[10px] text-red-600 font-mono">{error}</p>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!inputOk || saving || saved || (showColorDist && !isColorDistributionValid)}
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
