import React, { useState, useMemo } from 'react';
import { X, Camera, CheckCircle2, AlertCircle, Smartphone } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { DeviceCategory } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import IMEIScanner from './IMEIScanner';

interface Props { onClose: () => void; }

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

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

const COLOUR_OPTIONS = [
  'Black','White','Blue','Green','Red','Pink','Purple','Yellow',
  'Gold','Silver','Graphite','Starlight','Midnight','Natural Titanium',
  'Black Titanium','White Titanium','Phantom Black','Phantom White',
  'Space Grey','Sierra Blue','Alpine Green','Coral','Mint','Cream',
  'Lavender','Desert Titanium','Pacific Blue','Rose Gold','Other',
];

export default function ScanInModal({ onClose }: Props) {
  const { suppliers } = useInventoryStore();

  const [stage, setStage] = useState<'scan' | 'form'>('scan');
  const [imei, setImei] = useState('');
  const [model, setModel] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [colour, setColour] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const knownSuppliers = useMemo(() => suppliers.map(s => s.name), [suppliers]);

  const supplierByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.name.toUpperCase()] = s.id;
    return m;
  }, [suppliers]);

  const handleScan = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 14) {
      setImei(digits);
      setStage('form');
      setError('');
    } else {
      setError(`Invalid scan: "${value}" — need 14-15 digits`);
    }
  };

  const ensureSupplier = async (name: string): Promise<string> => {
    const key = name.trim().toUpperCase();
    if (!key) return '';
    const existing = supplierByName[key];
    if (existing) return existing;
    const newId = `sup_${Date.now()}_${uid()}`;
    await dbService.create('suppliers', newId, {
      name: name.trim(),
      portal: 'Wholesale',
      ownerId: 'shared',
      createdAt: new Date().toISOString(),
    });
    return newId;
  };

  const handleSave = async () => {
    if (!model.trim()) { setError('Model is required'); return; }
    if (!buyPrice || isNaN(parseFloat(buyPrice))) { setError('Buy price is required'); return; }
    if (!colour) { setError('Colour is required'); return; }

    setSaving(true);
    setError('');

    try {
      // Check IMEI uniqueness
      const exists = await dbService.imeiExists(imei);
      if (exists) {
        setError(`IMEI ${imei} already exists in database`);
        setSaving(false);
        return;
      }

      const supplierId = await ensureSupplier(supplierName || 'Unknown');
      const category = detectCategory(model);
      const brand = detectBrand(category);
      const bp = parseFloat(buyPrice) || 0;

      await dbService.create('inventoryUnits', imei, {
        id: imei,
        imei,
        model: model.trim(),
        brand,
        category,
        colour,
        buyPrice: bp,
        dateIn: today(),
        supplierId,
        status: 'available',
        flags: [],
        notes: notes || '',
        platformListed: false,
        listingSites: [],
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      });

      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setStage('scan');
        setImei('');
        setModel('');
        setBuyPrice('');
        setColour('');
        setSupplierName('');
        setNotes('');
      }, 1200);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
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
        className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600 text-white rounded-xl flex items-center justify-center">
              <Camera size={17} />
            </div>
            <div>
              <p className="text-sm font-bold uppercase tracking-tight">
                {stage === 'scan' ? 'Scan IMEI' : 'Add Unit'}
              </p>
              <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">
                {stage === 'scan' ? 'Point camera at barcode' : `IMEI: ${imei}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {stage === 'scan' && (
              <motion.div
                key="scan"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="p-4 space-y-4"
              >
                <IMEIScanner onScan={handleScan} onError={msg => setError(msg)} />

                {error && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertCircle size={14} />
                    <p className="text-xs font-mono">{error}</p>
                  </div>
                )}

                {/* Manual IMEI fallback */}
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
                    Or type IMEI manually
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={imei}
                      onChange={e => setImei(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456789012345"
                      maxLength={15}
                      className="flex-1 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
                    />
                    <button
                      onClick={() => handleScan(imei)}
                      disabled={imei.length < 14}
                      className="bg-black text-white px-5 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {stage === 'form' && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-5 space-y-4"
              >
                {/* IMEI display */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <Smartphone size={18} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Scanned IMEI</p>
                    <p className="text-sm font-bold font-mono">{imei}</p>
                  </div>
                  <button
                    onClick={() => setStage('scan')}
                    className="ml-auto text-[9px] font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors"
                  >
                    Rescan
                  </button>
                </div>

                {/* Model */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Model *</label>
                  <input
                    value={model}
                    onChange={e => { setModel(e.target.value); setError(''); }}
                    placeholder="e.g. Apple iPhone 14 128GB"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all"
                  />
                </div>

                {/* Buy Price */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Buy Price (£) *</label>
                  <input
                    type="number"
                    value={buyPrice}
                    onChange={e => { setBuyPrice(e.target.value); setError(''); }}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
                  />
                </div>

                {/* Colour */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Colour *</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOUR_OPTIONS.map(c => (
                      <button
                        key={c}
                        onClick={() => setColour(c)}
                        className={`text-[9px] font-bold px-3 py-1.5 rounded-lg border transition-all ${
                          colour === c ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Supplier */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Supplier</label>
                  <input
                    list="scan-suppliers"
                    value={supplierName}
                    onChange={e => setSupplierName(e.target.value)}
                    placeholder="MHL, NANAK, ABC..."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all"
                  />
                  <datalist id="scan-suppliers">
                    {knownSuppliers.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Notes</label>
                  <input
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional: condition, box included, etc."
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-black transition-all"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertCircle size={14} />
                    <p className="text-xs font-mono">{error}</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {stage === 'form' && (
          <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 flex-shrink-0">
            <button
              onClick={handleSave}
              disabled={saving || saved}
              className="w-full py-3.5 bg-emerald-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saved ? (
                <><CheckCircle2 size={15} /> Saved!</>
              ) : saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Save to Stock</>
              )}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
