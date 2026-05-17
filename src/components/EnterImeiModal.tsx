/**
 * EnterImeiModal — backfill the IMEI on a sold SHS unit after the supplier
 * confirms dispatch and sends the device serial.
 *
 * Extracted from the legacy SellPage so the new SellSheet can reuse it
 * unchanged. Behavior identical: numeric IMEI (14–15 digits) or alphanumeric
 * Apple serial (≥8 chars); writes back to inventoryUnits via dbService.update.
 */
import { useState } from 'react';
import { X, PackageCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import type { InventoryUnit } from '../types';

const PLATFORM_STYLE: Record<string, string> = {
  eBay:       'bg-yellow-50 text-yellow-800 border-yellow-200',
  Amazon:     'bg-orange-50 text-orange-800 border-orange-200',
  OnBuy:      'bg-blue-50   text-blue-800   border-blue-200',
  Backmarket: 'bg-green-50  text-green-800  border-green-200',
};

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved?: () => void;
}

export default function EnterImeiModal({ unit, onClose, onSaved }: Props) {
  const [imei, setImei]     = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const clean      = imei.replace(/\D/g, '');
  const isNumeric  = /^\d+$/.test(clean);
  const numericOk  = isNumeric && clean.length >= 14 && clean.length <= 15;
  const alphaOk    = imei.trim().length >= 8 && !isNumeric;
  const inputOk    = numericOk || alphaOk;
  const finalImei  = alphaOk ? imei.trim().toUpperCase() : clean;

  const handleSave = async () => {
    if (!inputOk) { setError('Enter a valid 14–15 digit IMEI or device serial (≥8 chars)'); return; }
    setSaving(true);
    try {
      const exists = await dbService.imeiExists(finalImei);
      if (exists) { setError(`${finalImei} is already in stock as a different unit`); setSaving(false); return; }
      await dbService.update('inventoryUnits', unit.id, { imei: finalImei });
      setSaved(true);
      setTimeout(() => { if (onSaved) onSaved(); onClose(); }, 700);
    } catch {
      setError('Save failed — please try again');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100 bg-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 text-white rounded-xl flex items-center justify-center"><PackageCheck size={15} /></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-orange-600">Supplier Dispatched</p>
              <h3 className="text-sm font-bold truncate max-w-[220px]">{unit.model}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-orange-100 rounded-xl text-orange-400"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Sale Details</p>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">{unit.colour}{unit.storage ? ` · ${unit.storage}` : ''}</p>
              <p className="text-sm font-bold text-emerald-700">£{unit.salePrice}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {unit.salePlatform && (
                <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full border ${PLATFORM_STYLE[unit.salePlatform] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {unit.salePlatform}
                </span>
              )}
              {unit.saleOrderId && <p className="text-[9px] text-gray-500 font-mono">{unit.saleOrderId}</p>}
              {unit.saleDate    && <p className="text-[9px] text-gray-400 font-mono">{unit.saleDate}</p>}
            </div>
          </div>

          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              IMEI / Serial from Supplier Invoice
            </label>
            <input
              autoFocus
              value={imei}
              onChange={e => { setImei(e.target.value); setError(''); }}
              placeholder="Scan or type 14–15 digit IMEI"
              maxLength={20}
              className={`w-full border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                imei && !inputOk ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-black'
              }`}
            />
            {imei.trim().length > 0 && (
              <p className={`text-[9px] font-mono mt-1 ${inputOk ? 'text-emerald-600' : 'text-red-500'}`}>
                {alphaOk
                  ? `Serial: ${finalImei} ✓`
                  : isNumeric
                    ? `${clean.length} digits ${numericOk ? '✓' : `— need ${14 - clean.length} more`}`
                    : 'Non-numeric — treating as serial'}
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertTriangle size={12} className="text-red-500" />
              <p className="text-[9px] text-red-600 font-mono">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
              Cancel
            </button>
            <button onClick={handleSave} disabled={!inputOk || saving || saved}
              className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {saved
                ? <><CheckCircle2 size={13} /> Saved!</>
                : saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><PackageCheck size={13} /> Save IMEI</>
              }
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
