import React, { useState, useEffect } from 'react';
import {
  X, Plus, Trash2, Smartphone, Truck, Calendar, CheckCircle2, Zap, Info, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Supplier, DeviceCategory, OperationalFlag } from '../types';

interface NewBatchModalProps {
  onClose: () => void;
}

const CATEGORIES: DeviceCategory[] = [
  'iPhone', 'iPad', 'Apple Watch', 'Tablet', 'Samsung S Series', 'Samsung A Series', 'Other'
];

const COMMON_COLOURS = [
  'Black', 'White', 'Silver', 'Gold', 'Rose Gold', 'Natural Titanium', 'Blue Titanium',
  'White Titanium', 'Black Titanium', 'Phantom Black', 'Cream', 'Lavender', 'Graphite',
  'Starlight', 'Midnight', 'Product Red', 'Green', 'Yellow', 'Purple', 'Space Grey', 'Other'
];

type DeviceRow = {
  imei: string;
  model: string;
  brand: string;
  category: DeviceCategory;
  colour: string;
  buyPrice: number;
  notes: string;
  flags: OperationalFlag[];
};

const emptyDevice = (): DeviceRow => ({
  imei: '', model: '', brand: 'Apple', category: 'iPhone',
  colour: 'Black', buyPrice: 0, notes: '', flags: []
});

export default function NewBatchModal({ onClose }: NewBatchModalProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [batchInfo, setBatchInfo] = useState({
    supplierId: '',
    date: new Date().toISOString().split('T')[0],
    supplierRef: '',
    notes: '',
  });

  const [devices, setDevices] = useState<DeviceRow[]>([emptyDevice()]);

  useEffect(() => {
    return dbService.subscribeToCollection('suppliers', setSuppliers);
  }, []);

  const addDevice = () => setDevices([...devices, emptyDevice()]);
  const removeDevice = (i: number) => setDevices(devices.filter((_, idx) => idx !== i));
  const updateDevice = (i: number, field: keyof DeviceRow, value: any) => {
    const next = [...devices];
    (next[i] as any)[field] = value;
    // Auto-set brand based on category
    if (field === 'category') {
      if (['iPhone', 'iPad', 'Apple Watch'].includes(value)) next[i].brand = 'Apple';
      else if (['Samsung S Series', 'Samsung A Series'].includes(value)) next[i].brand = 'Samsung';
    }
    setDevices(next);
  };
  const toggleFlag = (i: number, flag: OperationalFlag) => {
    const next = [...devices];
    const flags = next[i].flags;
    next[i].flags = flags.includes(flag) ? flags.filter(f => f !== flag) : [...flags, flag];
    setDevices(next);
  };

  const totalValue = devices.reduce((sum, d) => sum + (d.buyPrice || 0), 0);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const batchId = `bat_${Date.now()}`;
      await dbService.create('batches', batchId, {
        ...batchInfo,
        unitCount: devices.length,
        totalBuyValue: totalValue,
      });

      for (const d of devices) {
        const unitId = `unit_${Math.random().toString(36).substr(2, 9)}`;
        await dbService.create('inventoryUnits', unitId, {
          ...d,
          batchId,
          supplierId: batchInfo.supplierId,
          dateIn: batchInfo.date,
          status: 'available',
          platformListed: false,
        });
      }

      onClose();
    } catch (err) {
      console.error('Batch creation failed', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        className="bg-white border border-gray-200 rounded-xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-black"
      >
        {/* Header */}
        <div className="h-auto bg-gray-50 border-b border-gray-200 flex items-center justify-between px-10 py-6">
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 bg-black text-white flex items-center justify-center flex-shrink-0">
              <Zap size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Ingest Batch</h2>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-[0.3em] mt-0.5">Supplier Packing Slip Entry</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black hover:text-white transition-all text-gray-400">
            <X size={20} />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex border-b border-gray-200">
          {[{ n: 1, label: 'Batch Details' }, { n: 2, label: 'Add Units' }].map(s => (
            <button
              key={s.n}
              onClick={() => s.n < step || s.n === 1 ? setStep(s.n as 1 | 2) : null}
              className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest font-mono border-b-2 transition-all ${
                step === s.n ? 'border-black text-black' : 'border-transparent text-gray-400'
              }`}
            >
              {s.n}. {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {step === 1 ? (
            <div className="p-10 space-y-8">
              <div className="grid grid-cols-2 gap-8">
                {/* Supplier */}
                <div className="space-y-2">
                  <label className="text-[9px] text-gray-500 font-mono uppercase font-bold tracking-widest flex items-center gap-2">
                    <Truck size={10} /> Supplier
                  </label>
                  <select
                    value={batchInfo.supplierId}
                    onChange={e => setBatchInfo({ ...batchInfo, supplierId: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 py-3 px-4 focus:outline-none focus:border-black transition-all font-light text-black text-sm"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                {/* Supplier Ref */}
                <div className="space-y-2">
                  <label className="text-[9px] text-gray-500 font-mono uppercase font-bold tracking-widest">Invoice / Ref #</label>
                  <input
                    value={batchInfo.supplierRef}
                    onChange={e => setBatchInfo({ ...batchInfo, supplierRef: e.target.value })}
                    placeholder="e.g. INV-2024-001"
                    className="w-full bg-gray-50 border border-gray-200 py-3 px-4 focus:outline-none focus:border-black transition-all font-mono text-sm text-black"
                  />
                </div>

                {/* Date */}
                <div className="space-y-2">
                  <label className="text-[9px] text-gray-500 font-mono uppercase font-bold tracking-widest flex items-center gap-2">
                    <Calendar size={10} /> Date Stock Arrived
                  </label>
                  <input
                    type="date"
                    value={batchInfo.date}
                    onChange={e => setBatchInfo({ ...batchInfo, date: e.target.value })}
                    className="w-full bg-gray-50 border border-gray-200 py-3 px-4 focus:outline-none focus:border-black transition-all font-mono text-sm text-black"
                  />
                </div>

                {/* Notes */}
                <div className="space-y-2">
                  <label className="text-[9px] text-gray-500 font-mono uppercase font-bold tracking-widest">Batch Notes</label>
                  <input
                    value={batchInfo.notes}
                    onChange={e => setBatchInfo({ ...batchInfo, notes: e.target.value })}
                    placeholder="e.g. All units boxed, chargers included"
                    className="w-full bg-gray-50 border border-gray-200 py-3 px-4 focus:outline-none focus:border-black transition-all font-light text-sm text-black"
                  />
                </div>
              </div>

              <div className="p-6 bg-gray-50 border border-gray-200 border-l-4 border-l-black flex items-start gap-4">
                <Info size={18} className="text-black flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-500 leading-relaxed font-mono uppercase tracking-wider">
                  Enter the packing slip details above. In the next step, add each unit individually with its IMEI, colour, and buy price.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-10 space-y-4">
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-gray-200">
                {['Category', 'Model', 'IMEI / Serial', 'Colour', 'Buy Price (£)', 'Flags', 'Notes', ''].map((h, i) => (
                  <div key={i} className={`text-[8px] font-bold uppercase tracking-widest font-mono text-gray-400 ${
                    i === 0 ? 'col-span-2' : i === 1 ? 'col-span-2' : i === 2 ? 'col-span-2' : i === 3 ? 'col-span-1' :
                    i === 4 ? 'col-span-1' : i === 5 ? 'col-span-2' : i === 6 ? 'col-span-1' : 'col-span-1'
                  }`}>{h}</div>
                ))}
              </div>

              {devices.map((device, idx) => (
                <motion.div
                  key={idx}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="grid grid-cols-12 gap-3 p-4 bg-white border border-gray-200 hover:border-gray-400 transition-all items-start"
                >
                  {/* Category */}
                  <div className="col-span-2">
                    <select
                      value={device.category}
                      onChange={e => updateDevice(idx, 'category', e.target.value as DeviceCategory)}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-2 text-[10px] font-mono focus:outline-none focus:border-black text-black"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {/* Model */}
                  <div className="col-span-2">
                    <input
                      placeholder="e.g. iPhone 15 Pro 256GB"
                      value={device.model}
                      onChange={e => updateDevice(idx, 'model', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-2 text-[11px] focus:outline-none focus:border-black text-black placeholder:text-gray-300"
                    />
                  </div>
                  {/* IMEI */}
                  <div className="col-span-2">
                    <input
                      placeholder="IMEI / Serial"
                      value={device.imei}
                      onChange={e => updateDevice(idx, 'imei', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-2 text-[11px] font-mono focus:outline-none focus:border-black text-black placeholder:text-gray-300"
                    />
                  </div>
                  {/* Colour */}
                  <div className="col-span-1">
                    <select
                      value={device.colour}
                      onChange={e => updateDevice(idx, 'colour', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-1 text-[10px] font-mono focus:outline-none focus:border-black text-black"
                    >
                      {COMMON_COLOURS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {/* Buy Price */}
                  <div className="col-span-1">
                    <input
                      type="number"
                      placeholder="0"
                      value={device.buyPrice || ''}
                      onChange={e => updateDevice(idx, 'buyPrice', Number(e.target.value))}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-2 text-[11px] font-mono focus:outline-none focus:border-black text-black"
                    />
                  </div>
                  {/* Flags */}
                  <div className="col-span-2 flex flex-wrap gap-1">
                    {(Object.keys({ top10: 1, officeOnly: 1, supplierHasStock: 1 }) as OperationalFlag[]).map(flag => (
                      <button
                        key={flag}
                        type="button"
                        onClick={() => toggleFlag(idx, flag)}
                        className={`text-[8px] font-bold uppercase px-1.5 py-1 border font-mono transition-all ${
                          device.flags.includes(flag) ? 'bg-black text-white border-black' : 'bg-white text-gray-400 border-gray-200'
                        }`}
                      >
                        {flag === 'top10' ? 'Top 10' : flag === 'officeOnly' ? 'Office' : 'Supplier'}
                      </button>
                    ))}
                  </div>
                  {/* Notes */}
                  <div className="col-span-1">
                    <input
                      placeholder="Notes..."
                      value={device.notes}
                      onChange={e => updateDevice(idx, 'notes', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 py-2 px-2 text-[10px] focus:outline-none focus:border-black text-black placeholder:text-gray-300"
                    />
                  </div>
                  {/* Remove */}
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => removeDevice(idx)}
                      className="p-2 hover:bg-red-50 hover:text-red-500 text-gray-300 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              ))}

              <button
                onClick={addDevice}
                className="w-full py-6 border-2 border-dashed border-gray-200 text-gray-400 font-bold uppercase tracking-widest text-[10px] hover:border-black hover:text-black hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={14} /> Add Unit
              </button>

              {/* Summary bar */}
              <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 text-xs font-mono">
                <span className="text-gray-500">{devices.length} unit{devices.length !== 1 ? 's' : ''}</span>
                <span className="font-bold text-black">Total Buy Value: £{totalValue.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-10 py-6 border-t border-gray-200 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-3">
            {[1, 2].map(i => (
              <div key={i} className={`w-10 h-1 transition-all ${step === i ? 'bg-black' : 'bg-gray-300'}`} />
            ))}
          </div>
          <div className="flex gap-4">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="px-8 py-3 border border-gray-200 font-bold uppercase tracking-widest text-[10px] hover:bg-white transition-all text-black"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (step === 1) {
                  if (!batchInfo.supplierId) return alert('Please select a supplier.');
                  setStep(2);
                } else {
                  handleSubmit();
                }
              }}
              disabled={loading}
              className="px-12 py-3 bg-black text-white font-bold uppercase tracking-widest text-[10px] hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center gap-3"
            >
              {loading ? 'Saving...' : step === 1 ? 'Next: Add Units →' : 'Commit Batch'}
              {!loading && step === 2 && <CheckCircle2 size={16} strokeWidth={3} />}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
