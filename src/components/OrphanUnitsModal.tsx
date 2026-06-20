/**
 * OrphanUnitsModal — pinned helper for incomplete inventory units.
 *
 * "Orphan" = a unit that's missing at least one of:
 *   - supplierId (no attribution)
 *   - buyPrice > 0
 *   - stockSource (whether it lives in Office or SHS)
 * and is NOT yet sold. Sold units with missing IMEIs are handled by
 * AwaitingImeiSection; sold units with no inventory match are handled by
 * the amber "No Inventory" badge on the sales row. Both of those already
 * exist; THIS modal covers the third gap — live units that imported
 * incomplete and never got slotted into Office vs SHS.
 *
 * The operator gets three actions per row:
 *   - Map to Office  → status='available' + stockSource='office'
 *   - Map to SHS     → status='incoming'  + stockSource='shs'
 *   - Fill Details   → opens the EditUnitModal for the full field editor
 *
 * Writes go through dbService.update (Firestore + onSnapshot → optimistic
 * UI everywhere). Admin-only — non-admin sees a disabled badge.
 */
import React, { useMemo, useState } from 'react';
import { X, MapPin, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import { dbService } from '../lib/dbService';
import EditUnitModal from './EditUnitModal';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

/** True when the unit is missing at least one operational field that the
 *  rest of the app expects (supplier / price / stock segment). Sold and
 *  return-flow units are intentionally excluded — they live in their own
 *  pinned sections. */
export function isOrphanUnit(u: InventoryUnit): boolean {
  if (u.status === 'sold' || u.status === 'returned' || u.status === 'lost') return false;
  return !u.supplierId || !(u.buyPrice && u.buyPrice > 0) || !u.stockSource;
}

/** Human-readable reason list, shown inline so the operator sees WHY a
 *  unit landed in the orphan bucket without opening the editor. */
function missingFields(u: InventoryUnit): string[] {
  const out: string[] = [];
  if (!u.supplierId) out.push('supplier');
  if (!u.buyPrice || u.buyPrice <= 0) out.push('buy price');
  if (!u.stockSource) out.push('office/SHS');
  return out;
}

export default function OrphanUnitsModal({ units, onClose }: Props) {
  const [editingUnit, setEditingUnit] = useState<InventoryUnit | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const orphans = useMemo(() => units.filter(isOrphanUnit), [units]);

  const mapTo = async (u: InventoryUnit, segment: 'office' | 'shs') => {
    setBusyId(u.id);
    try {
      await dbService.update('inventoryUnits', u.id, {
        stockSource: segment,
        status: segment === 'office' ? 'available' : 'incoming',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="bg-white w-full md:max-w-3xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100dvh - 24px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
            <div>
              <h3 className="text-sm font-bold tracking-tight">Orphan Units</h3>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                {orphans.length === 0
                  ? 'No incomplete units — everything is mapped'
                  : `${orphans.length} unit${orphans.length === 1 ? '' : 's'} missing data · map to Office / SHS or fill details`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {orphans.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
                <CheckCircle2 size={28} className="text-emerald-500" />
                <p className="text-[11px] font-mono uppercase tracking-widest">Nothing to fix</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orphans.map(u => {
                  const reasons = missingFields(u);
                  const busy = busyId === u.id;
                  return (
                    <div key={u.id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-[12px] truncate">{u.model || '—'}</span>
                          {u.storage && (
                            <span className="text-[10px] font-mono text-slate-500">{u.storage}</span>
                          )}
                          {u.colour && (
                            <span className="text-[10px] font-mono text-slate-400">· {u.colour}</span>
                          )}
                          <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
                            {u.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            {u.imei ? u.imei : <span className="italic">no imei</span>}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                            <AlertCircle size={10} />
                            missing: {reasons.join(' · ')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => mapTo(u, 'office')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                          title="Set stockSource=office + status=available"
                        >
                          <MapPin size={10} /> Office
                        </button>
                        <button
                          type="button"
                          onClick={() => mapTo(u, 'shs')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 disabled:opacity-50"
                          title="Set stockSource=shs + status=incoming"
                        >
                          <MapPin size={10} /> SHS
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUnit(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700"
                          title="Open the full edit modal to fill every field"
                        >
                          <Edit3 size={10} /> Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {editingUnit && (
          <EditUnitModal unit={editingUnit} onClose={() => setEditingUnit(null)} />
        )}
      </AnimatePresence>
    </>
  );
}
