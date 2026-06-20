/**
 * OrphansModal — reconciliation surface for sold inventory units with
 * degenerate data.
 *
 * Operator criterion (2026-06-20 final, fixed by screenshot of
 * ASI-SG-A32--64-BK-EX): an orphan is a unit marked SOLD that has at
 * least one of these tells of an auto-created-from-sales-import row
 * that never got cleaned up:
 *   - model is still a raw operator SKU code (e.g. "ASI-SG-A32--64-BK-EX")
 *     rather than a normalised product name. normalizeOperatorSku
 *     returns non-null on these.
 *   - storage missing AND colour either missing or "Unknown" — the
 *     pair of misses signals the import-side defaults were never
 *     overridden.
 *
 * Pre-2026-06-09 sales are excluded as legacy.
 *
 * Per-row action: "Fix Details" opens the full EditUnitModal so the
 * operator can drop the raw SKU, set the clean model, storage, colour
 * and grade. Once saved the row drops out of the list automatically.
 */
import React, { useMemo, useState } from 'react';
import { X, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import { normalizeOperatorSku } from '../lib/modelStorage';
import EditUnitModal from './EditUnitModal';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

/** Cut-off date — pre-Jun-9 sold units are legacy and excluded. */
export const ORPHAN_DATE_CUTOFF = '2026-06-09';

/** Orphan predicate — sold unit with degenerate data. */
export function isOrphanSoldUnit(u: InventoryUnit): boolean {
  if (u.status !== 'sold') return false;
  if ((u.saleDate || '') < ORPHAN_DATE_CUTOFF) return false;
  // Raw SKU model that the import-time normaliser couldn't parse.
  if (normalizeOperatorSku(u.model) !== null) return true;
  // Pair-miss: both storage AND colour fell through to their import-side
  // defaults ("" / "Unknown"). One missing is fine; both missing means
  // nobody touched this record after creation.
  const colour = (u.colour || '').toLowerCase().trim();
  if (!u.storage && (!colour || colour === 'unknown')) return true;
  return false;
}

/** Human-readable reason list for the inline badge. */
function orphanReasons(u: InventoryUnit): string[] {
  const out: string[] = [];
  if (normalizeOperatorSku(u.model) !== null) out.push('raw SKU model');
  if (!u.storage) out.push('no storage');
  const colour = (u.colour || '').toLowerCase().trim();
  if (!colour || colour === 'unknown') out.push('no colour');
  if (!u.grade) out.push('no grade');
  return out;
}

export default function OrphansModal({ units, onClose }: Props) {
  const [editingUnit, setEditingUnit] = useState<InventoryUnit | null>(null);

  const orphanUnits = useMemo(
    () => units.filter(isOrphanSoldUnit)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [units],
  );

  /** Last-10-days stat for the operator's at-a-glance "what came in
   *  this week" view, alongside the running total. */
  const last10Cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    return d.toISOString().slice(0, 10);
  }, []);
  const last10Count = useMemo(
    () => orphanUnits.filter(u => (u.saleDate || '') >= last10Cutoff).length,
    [orphanUnits, last10Cutoff],
  );

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
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
            <div>
              <h3 className="text-sm font-bold tracking-tight">Orphans · {orphanUnits.length}</h3>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                {orphanUnits.length === 0
                  ? 'No sold units with degenerate data'
                  : `${orphanUnits.length} sold units with raw SKU or missing storage/colour (from ${ORPHAN_DATE_CUTOFF}) · ${last10Count} in the last 10 days`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {orphanUnits.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
                <CheckCircle2 size={28} className="text-emerald-500" />
                <p className="text-[11px] font-mono uppercase tracking-widest">All sold units have clean data</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orphanUnits.map(u => {
                  const reasons = orphanReasons(u);
                  return (
                    <div key={u.id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-[12px] truncate">{u.model || '—'}</span>
                          {u.storage && <span className="text-[10px] font-mono text-slate-500">{u.storage}</span>}
                          <span className="text-[10px] font-mono text-slate-400">{u.colour || 'Unknown'}</span>
                          <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                            {u.salePlatform || '—'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            {u.imei || 'no imei'} · {u.saleDate || '—'} · £{u.salePrice ?? 0}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                            <AlertCircle size={10} /> {reasons.join(' · ') || 'degenerate data'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingUnit(u)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700"
                          title="Open the full edit modal to clean up model, storage, colour, grade"
                        >
                          <Edit3 size={10} /> Fix Details
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
