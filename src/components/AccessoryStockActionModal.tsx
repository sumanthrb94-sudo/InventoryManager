/**
 * AccessoryStockActionModal — the two ledger actions decrementAccessoryStock
 * (the Sales Report import path) can't cover on its own:
 *
 *   - Adjust: a stock-count correction (damaged, lost, found extra) — always
 *             carries a reason, so `quantity` is never a black-box number.
 *   - Return: a sold accessory coming back onto the shelf.
 *
 * There is deliberately no manual "Sell" action — every accessory sale
 * flows through a marketplace, so decrementAccessoryStock (fired from the
 * Sales Report import) is the only sale path that exists; a manual
 * alternative would just risk double-recording a sale the import already
 * caught.
 *
 * Each action writes one AccessoryStockEvent row via inventoryService, so
 * every change to a pool's quantity is traceable back to a specific,
 * timestamped, reasoned transaction — see AccessoryStockEvent in types.ts.
 */
import React, { useMemo, useState } from 'react';
import { X, SlidersHorizontal, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { AccessoryStock } from '../types';
import { adjustAccessoryStock, returnAccessoryStock } from '../services/inventoryService';
import { useInventoryStore } from '../lib/inventoryStore';

type Mode = 'adjust' | 'return';
type Outcome = 'refund' | 'replacement' | 'repair';

interface Props {
  accessory: AccessoryStock;
  initialMode?: Mode;
  onClose: () => void;
}

const MODE_META: Record<Mode, { label: string; icon: React.ReactNode; accent: string }> = {
  adjust: { label: 'Adjust', icon: <SlidersHorizontal size={13} />, accent: 'bg-amber-500 text-white' },
  return: { label: 'Return', icon: <RotateCcw size={13} />,         accent: 'bg-emerald-600 text-white' },
};

const OUTCOME_META: Record<Outcome, { label: string }> = {
  refund: { label: 'Refund' },
  replacement: { label: 'Replacement' },
  repair: { label: 'Repair' },
};

export default function AccessoryStockActionModal({ accessory, initialMode = 'adjust', onClose }: Props) {
  const { sales } = useInventoryStore();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [delta, setDelta] = useState('1');
  const [deltaSign, setDeltaSign] = useState<'add' | 'remove'>('remove');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('refund');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ quantity: number } | null>(null);

  const returnableSales = useMemo(
    () => sales
      .filter(s => s.sku === accessory.sku && !(s.imei || '').trim() && !s.voidedAt)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [sales, accessory.sku],
  );
  const [saleId, setSaleId] = useState<string>('');
  const selectedSaleId = saleId || returnableSales[0]?.id || '';

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setDone(null);
  };

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (mode === 'adjust') {
        const d = parseInt(delta, 10);
        if (!(d > 0)) { setError('Enter how many units changed.'); return; }
        if (!reason.trim()) { setError('A reason is required for an adjustment.'); return; }
        const signedDelta = deltaSign === 'add' ? d : -d;
        const res = await adjustAccessoryStock({ sku: accessory.sku, delta: signedDelta, reason: reason.trim() });
        if (!res.ok || res.quantity === undefined) { setError(res.error === 'not_found' ? 'This SKU no longer exists.' : 'Could not record the adjustment.'); return; }
        setDone({ quantity: res.quantity });
      } else {
        if (!selectedSaleId) { setError('No un-returned sale exists for this SKU yet.'); return; }
        const res = await returnAccessoryStock({
          sku: accessory.sku, saleId: selectedSaleId, outcome,
          reason: reason.trim() || undefined, notes: notes.trim() || undefined,
        });
        if (!res.ok || res.quantity === undefined) {
          setError(res.error === 'no_matching_sale' ? 'That sale is no longer available to return.' : 'Could not record the return.');
          return;
        }
        setDone({ quantity: res.quantity });
      }
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{accessory.sku}</p>
            <h3 className="text-sm font-bold truncate">{accessory.name}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 flex-shrink-0"><X size={16} /></button>
        </div>

        <div className="px-5 pt-3 flex items-center gap-2">
          {(['adjust', 'return'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                mode === m ? MODE_META[m].accent : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {MODE_META[m].icon} {MODE_META[m].label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-3">
          {done ? (
            <div className="py-4 flex flex-col items-center gap-2 text-emerald-600">
              <CheckCircle2 size={26} />
              <p className="text-[12px] font-bold">
                {mode === 'adjust' ? 'Adjustment recorded' : 'Return recorded'}
              </p>
              <p className="text-[11px] font-mono text-slate-500">New quantity: {done.quantity}</p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <p className="text-[10px] font-mono text-slate-400">
                Current stock: <strong className="text-slate-700">{accessory.quantity}</strong>
              </p>

              {mode === 'return' && (
                returnableSales.length === 0 ? (
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-mono text-amber-600">
                    <AlertCircle size={12} /> No un-returned sale exists yet for this SKU — accessory returns reverse a specific marketplace sale.
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Which sale is coming back</label>
                      <select
                        value={selectedSaleId}
                        onChange={e => setSaleId(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-900"
                      >
                        {returnableSales.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.saleDate} · {s.marketplace} · order {s.orderNumber || '—'} · qty {s.quantity}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Outcome</label>
                      <div className="inline-flex border border-slate-200 rounded-lg overflow-hidden w-full">
                        {(['refund', 'replacement', 'repair'] as Outcome[]).map(o => (
                          <button
                            key={o} type="button" onClick={() => setOutcome(o)}
                            className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${outcome === o ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}
                          >
                            {OUTCOME_META[o].label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Reason (shown on the Sales Report)</label>
                      <input
                        value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="e.g. customer changed their mind"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-900"
                      />
                    </div>
                  </>
                )
              )}

              {mode === 'adjust' && (
                <>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Change</label>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex border border-slate-200 rounded-lg overflow-hidden flex-shrink-0">
                        <button
                          type="button" onClick={() => setDeltaSign('add')}
                          className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${deltaSign === 'add' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500'}`}
                        >
                          Found +
                        </button>
                        <button
                          type="button" onClick={() => setDeltaSign('remove')}
                          className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${deltaSign === 'remove' ? 'bg-rose-600 text-white' : 'bg-white text-slate-500'}`}
                        >
                          Lost −
                        </button>
                      </div>
                      <input
                        type="number" min="1" value={delta}
                        onChange={e => setDelta(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Reason (required)</label>
                    <input
                      value={reason} onChange={e => setReason(e.target.value)}
                      placeholder="e.g. damaged in storage, stock count correction"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </>
              )}

              {mode === 'return' && returnableSales.length > 0 && (
                <div>
                  <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Internal notes (optional)</label>
                  <input
                    value={notes} onChange={e => setNotes(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-900"
                  />
                </div>
              )}

              {error && (
                <p className="inline-flex items-center gap-1.5 text-[11px] font-mono text-rose-600">
                  <AlertCircle size={12} /> {error}
                </p>
              )}
            </>
          )}
        </div>

        {!done && (
          <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy || (mode === 'return' && returnableSales.length === 0)}
              className={`px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 ${MODE_META[mode].accent}`}
            >
              {busy ? 'Saving…' : `Confirm ${MODE_META[mode].label}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
