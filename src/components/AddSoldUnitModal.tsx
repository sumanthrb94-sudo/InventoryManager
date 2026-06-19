/**
 * AddSoldUnitModal — turn an orphan sale (one whose IMEI has no matching
 * inventory unit) into a fresh-stock unit that is created already SOLD and
 * back-linked to the sale.
 *
 * Launched from the "No Inventory" badge on the Sell / Sales tables. The
 * operator fills/confirms the IMEI (pre-filled from the sale when present),
 * confirms the model + supplier + BP (all pre-filled from the sale), and on
 * save the unit lands in inventory with status='sold' carrying the sale's
 * SP / marketplace / order / date provenance. The "No Inventory IMEI" flag
 * then clears on the next render/report.
 */
import { useState, type ReactNode } from 'react';
import { useIsAdmin } from '../lib/useIsAdmin';
import { X, PackagePlus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { addSoldUnitFromSale } from '../services/inventoryService';
import { isAppleDevice } from '../lib/imeiValidation';
import type { Sale } from '../types';

interface Props {
  sale: Sale;
  onClose: () => void;
  onSaved?: () => void;
}

export default function AddSoldUnitModal({ sale, onClose, onSaved }: Props) {
  const isAdminUser                   = useIsAdmin();
  const [imei, setImei]               = useState((sale.imei || '').trim());
  const [model, setModel]             = useState((sale.sku || '').trim());
  const [supplier, setSupplier]       = useState((sale.supplierName || '').trim());
  const [buyPrice, setBuyPrice]       = useState(String(sale.buyPrice ?? ''));
  const [colour, setColour]           = useState('');
  const [storage, setStorage]         = useState('');
  const [stockSource, setStockSource] = useState<'office' | 'shs'>('office');
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState('');

  // Mirror the service's model-aware IMEI rule so the inline hint matches
  // what addSoldUnitFromSale will accept.
  const apple       = isAppleDevice(model);
  const cleanDigits = imei.replace(/\D/g, '');
  const isNumeric   = /^\d+$/.test(imei.trim());
  const numericOk   = isNumeric && cleanDigits.length === 15;
  const serialOk    = apple && /^[A-Za-z0-9]{10,12}$/.test(imei.trim());
  const imeiOk      = numericOk || serialOk;
  const bpOk        = Number(buyPrice) > 0;
  const modelOk     = model.trim().length > 0;
  const supplierOk  = supplier.trim().length > 0;
  const formOk      = imeiOk && bpOk && modelOk && supplierOk;

  const handleSave = async () => {
    if (!isAdminUser) { setError('Admin only.'); return; }
    if (!formOk) { setError('Fill IMEI, model, supplier and a buy price > £0.'); return; }
    setSaving(true);
    setError('');
    const res = await addSoldUnitFromSale({
      sale,
      imei: imei.trim(),
      model: model.trim(),
      supplierName: supplier.trim(),
      buyPrice: Number(buyPrice),
      colour: colour.trim(),
      storage: storage.trim(),
      stockSource,
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => { onSaved?.(); onClose(); }, 700);
    } else {
      setError(res.message || 'Save failed — please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden max-h-[calc(100dvh-32px)] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-amber-500 text-white rounded-xl flex items-center justify-center"><PackagePlus size={15} /></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-amber-600">Add to Inventory &amp; Mark Sold</p>
              <h3 className="text-sm font-bold truncate max-w-[260px]">{sale.sku || sale.orderNumber || 'Sale'}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-amber-100 rounded-xl text-amber-400"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-auto">
          {/* Read-only sale context — these flow onto the sold unit automatically. */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">Sale Details (carried onto the unit)</p>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-slate-500">{sale.marketplace} · {sale.orderNumber}</span>
              <span className="text-sm font-bold text-emerald-700">£{Number(sale.salePrice ?? 0).toFixed(2)}</span>
            </div>
            {sale.saleDate && <p className="text-[9px] text-slate-400 font-mono">Sold {sale.saleDate}</p>}
          </div>

          <Field label="IMEI / Serial" hint={
            imei.trim().length === 0 ? 'Required'
              : imeiOk ? (numericOk ? '15-digit IMEI ✓' : 'Serial ✓')
              : apple ? 'Need 15-digit IMEI or 10-12 char serial' : `Need 15 digits (${cleanDigits.length} so far)`
          } hintOk={imeiOk}>
            <input autoFocus value={imei} onChange={e => { setImei(e.target.value); setError(''); }}
              placeholder="Scan or type the IMEI / serial" maxLength={20}
              className={`w-full border rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none ${
                imei && !imeiOk ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-black'}`} />
          </Field>

          <Field label="Model" hint={modelOk ? '' : 'Required'} hintOk={modelOk}>
            <input value={model} onChange={e => setModel(e.target.value)}
              placeholder="e.g. Samsung Galaxy A32 5G"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Colour"><input value={colour} onChange={e => setColour(e.target.value)} placeholder="Optional"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black" /></Field>
            <Field label="Storage"><input value={storage} onChange={e => setStorage(e.target.value)} placeholder="Optional"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black" /></Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" hint={supplierOk ? '' : 'Required'} hintOk={supplierOk}>
              <input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="Supplier name"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-black" /></Field>
            <Field label="Buy Price (£)" hint={bpOk ? '' : '> £0'} hintOk={bpOk}>
              <input value={buyPrice} onChange={e => setBuyPrice(e.target.value)} type="number" placeholder="0"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black" /></Field>
          </div>

          <Field label="Stock Source">
            <div className="inline-flex rounded-xl border border-slate-200 overflow-hidden">
              {(['office', 'shs'] as const).map(src => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setStockSource(src)}
                  className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                    stockSource === src
                      ? (src === 'shs' ? 'bg-teal-600 text-white' : 'bg-slate-800 text-white')
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                  title={src === 'shs' ? 'Supplier-held (SHS) stock' : 'Office stock'}
                >
                  {src === 'shs' ? 'SHS' : 'Office Stock'}
                </button>
              ))}
            </div>
          </Field>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertTriangle size={12} className="text-red-500" />
              <p className="text-[10px] text-red-600 font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-slate-100 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-3 border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={!formOk || saving || saved}
            className="flex-1 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 disabled:opacity-50 flex items-center justify-center gap-2">
            {saved
              ? <><CheckCircle2 size={13} /> Added!</>
              : saving
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><PackagePlus size={13} /> Add &amp; Mark Sold</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, hint, hintOk, children }: {
  label: string; hint?: string; hintOk?: boolean; children: ReactNode;
}) {
  return (
    <div>
      <label className="text-[8px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">{label}</label>
      {children}
      {hint ? <p className={`text-[9px] font-mono mt-1 ${hintOk ? 'text-emerald-600' : 'text-amber-600'}`}>{hint}</p> : null}
    </div>
  );
}
