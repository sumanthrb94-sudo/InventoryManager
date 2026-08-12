/**
 * AwaitingImeiPanel — the warehouse half of a two-stage sale.
 *
 * The sales team records an order by MODEL, because the marketplace tells them
 * what sold and for how much but nobody has been to the shelf yet. Those sales
 * are complete in every respect except one: no handset is attached and nothing
 * has been marked sold. This is where that gets finished.
 *
 * One row per waiting sale, each with an IMEI dropdown narrowed to the
 * available units of that model. Pick, confirm, done: the unit flips to sold
 * and the sale's money is recomputed against the handset's real buy price,
 * replacing the provisional one.
 *
 * WHY THE SHORTFALL IS SHOWN RATHER THAN PREVENTED
 *
 * Stage 1 does not reserve stock — see services/pendingSaleService.ts for why
 * — so two sales can be waiting on a model with one unit left. The header
 * counts both sides ("3 waiting · 2 in stock") and a short model is called out
 * on its own row, because the people who can fix an oversell are the ones
 * standing at the shelf. Hiding it until the dropdown came up empty would tell
 * them too late.
 */
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { PackageCheck, AlertTriangle, Check, X } from 'lucide-react';
import type { InventoryUnit, Sale } from '../types';
import {
  pendingSales, candidateUnitsFor, linkImeiToPendingSale,
} from '../services/pendingSaleService';
import { normalizeBucketModel } from '../lib/modelStorage';

export default function AwaitingImeiPanel({
  sales, units, onDone,
}: {
  sales: Sale[];
  units: InventoryUnit[];
  onDone?: () => void;
}) {
  const waiting = useMemo(() => pendingSales(sales), [sales]);
  /** saleId -> chosen unit id */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Units already chosen on another row of this panel. One handset cannot
  // settle two orders, and the service would reject the second anyway — this
  // just stops the operator picking it in the first place.
  const takenHere = useMemo(() => {
    const s = new Set<string>();
    for (const unitId of Object.keys(choice).map(k => choice[k])) if (unitId) s.add(unitId);
    return s;
  }, [choice]);

  const stockByModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of waiting) {
      const k = normalizeBucketModel(s.model || '');
      if (!m.has(k)) m.set(k, candidateUnitsFor(s.model || '', units).length);
    }
    return m;
  }, [waiting, units]);

  const waitingByModel = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of waiting) {
      const k = normalizeBucketModel(s.model || '');
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [waiting]);

  if (waiting.length === 0) return null;

  const totalStock = [...stockByModel.values()].reduce((a, b) => a + b, 0);

  const complete = async (sale: Sale) => {
    const unitId = choice[sale.id];
    if (!unitId) return;
    setBusy(sale.id);
    setErrors(e => ({ ...e, [sale.id]: '' }));
    const res = await linkImeiToPendingSale({ saleId: sale.id, unitId });
    setBusy(null);
    if (!res.ok) {
      setErrors(e => ({ ...e, [sale.id]: res.message || 'Could not complete the sale.' }));
      return;
    }
    setChoice(c => { const next = { ...c }; delete next[sale.id]; return next; });
    onDone?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-amber-200 rounded-3xl shadow-sm overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-3 border-b border-amber-100 bg-amber-50/60">
        <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
          <PackageCheck size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-900">
            Awaiting IMEI
          </p>
          <p className="text-[9px] font-mono text-slate-500 mt-0.5">
            {waiting.length} sold, not yet picked · {totalStock} matching unit{totalStock === 1 ? '' : 's'} in stock
          </p>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {waiting.map(sale => {
          const key = normalizeBucketModel(sale.model || '');
          const candidates = candidateUnitsFor(sale.model || '', units);
          const short = (waitingByModel.get(key) ?? 0) > (stockByModel.get(key) ?? 0);
          const err = errors[sale.id];

          return (
            <div key={sale.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold text-slate-900 truncate">
                    {sale.model || '(no model)'}{sale.storage ? ` ${sale.storage}` : ''}
                  </p>
                  <p className="text-[9px] font-mono text-slate-500 mt-0.5 truncate">
                    {sale.marketplace} · {sale.orderNumber} · £{Number(sale.salePrice).toFixed(2)}
                    {sale.sku ? ` · ${sale.sku}` : ''}
                  </p>
                </div>

                <select
                  aria-label={`IMEI for ${sale.orderNumber}`}
                  className="text-[11px] font-mono border border-slate-300 rounded-lg px-2 py-1.5
                             min-w-[13rem] focus:outline-none focus:border-slate-900"
                  value={choice[sale.id] ?? ''}
                  onChange={e => setChoice(c => ({ ...c, [sale.id]: e.target.value }))}
                >
                  <option value="">
                    {candidates.length ? 'Select IMEI…' : 'nothing in stock'}
                  </option>
                  {candidates.map(u => (
                    <option
                      key={u.id}
                      value={u.id}
                      // Greyed rather than removed: seeing it taken on another
                      // row explains why it cannot be picked here.
                      disabled={takenHere.has(u.id) && choice[sale.id] !== u.id}
                    >
                      {u.imei}{u.colour ? ` · ${u.colour}` : ''} · £{Number(u.buyPrice || 0).toFixed(2)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => complete(sale)}
                  disabled={!choice[sale.id] || busy === sale.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold
                             uppercase tracking-widest transition-all
                             bg-slate-900 text-white hover:bg-slate-700
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Check size={12} /> {busy === sale.id ? 'Saving…' : 'Mark Sold'}
                </button>
              </div>

              {short && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[9px] font-mono text-amber-700">
                  <AlertTriangle size={10} className="flex-shrink-0" />
                  {waitingByModel.get(key)} waiting · {stockByModel.get(key)} in stock — more sold than held
                </p>
              )}
              {err && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[9px] font-mono text-rose-700">
                  <X size={10} className="flex-shrink-0" /> {err}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
