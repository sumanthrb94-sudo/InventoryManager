/**
 * OrphansModal — pinned reconciliation surface for two related gaps:
 *
 *   1. ORPHAN LIVE UNITS — units that are not sold but missing at least
 *      one of: supplierId, buyPrice>0, stockSource. They never got
 *      slotted into Office / SHS so they're invisible on the periodic
 *      table. Actions: Map → Office (status=available), Map → SHS
 *      (status=incoming), Fill Details (EditUnitModal).
 *
 *   2. ORPHAN SALES — sales rows without unitId AND no matching unit by
 *      IMEI. These come from the new ops workflow: employees deliberately
 *      omit IMEIs from sales reports to avoid creating broken inventory
 *      rows; instead they add the unit manually first, then upload the
 *      sales report at EOD, and the admin reconciles afterwards.
 *      Actions per orphan sale:
 *        - Map → SHS              (sets stockSource='shs', no unit linked)
 *        - Link to Unit (picker)  (writes sale.unitId + flips unit→sold)
 *        - Add as Stock           (delegates to AddSoldUnitModal — creates
 *                                  a fresh-stock unit directly in sold state)
 *
 * Writes via dbService.update — Firestore + onSnapshot for real-time
 * propagation. Admin-only on the call sites; the modal itself trusts the
 * caller has gated visibility.
 */
import React, { useMemo, useState } from 'react';
import { X, MapPin, Edit3, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import { dbService } from '../lib/dbService';
import { reconcileOrphanSaleForImei } from '../services/inventoryService';
import EditUnitModal from './EditUnitModal';
import EnterImeiModal from './EnterImeiModal';

interface Props {
  units: InventoryUnit[];
  onClose: () => void;
}

/** Live unit predicate — missing supplier / price / stock segment. */
export function isOrphanUnit(u: InventoryUnit): boolean {
  if (u.status === 'sold' || u.status === 'returned' || u.status === 'lost') return false;
  return !u.supplierId || !(u.buyPrice && u.buyPrice > 0) || !u.stockSource;
}

/** Cut-off for the orphan-sold-unit view. Anything sold before this
 *  is legacy data from the pre-workflow-change era — operator told us
 *  to ignore them; they're not actionable and shouldn't crowd the pill. */
export const ORPHAN_DATE_CUTOFF = '2026-06-09';

/** Orphan-sold-unit predicate.
 *
 *  Per operator (2026-06-20 audit): an orphan is a UNIT that was marked
 *  sold without an IMEI on the inventory record. Those need the IMEI
 *  backfilled so the rest of the app's join logic (Sales Report ALL
 *  sheet, periodic table out-of-stock, post-import sync) can attach.
 *  Sales WITH IMEIs are handled by the auto-link path
 *  (buildPostImportSyncPatches at import time +
 *  reconcileOrphanSaleForImei when a unit is added manually after),
 *  so the orphan surface only needs to expose the no-IMEI-yet rows.
 *
 *  Pre-cutoff sold units are excluded as legacy. */
export function isOrphanSoldUnit(u: InventoryUnit): boolean {
  if (u.status !== 'sold') return false;
  if ((u.imei || '').trim()) return false;
  if ((u.saleDate || '') < ORPHAN_DATE_CUTOFF) return false;
  return true;
}

function missingFields(u: InventoryUnit): string[] {
  const out: string[] = [];
  if (!u.supplierId) out.push('supplier');
  if (!u.buyPrice || u.buyPrice <= 0) out.push('buy price');
  if (!u.stockSource) out.push('office/SHS');
  return out;
}

export default function OrphansModal({ units, onClose }: Props) {
  const [editingUnit, setEditingUnit] = useState<InventoryUnit | null>(null);
  const [backfillUnit, setBackfillUnit] = useState<InventoryUnit | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'units' | 'sold-no-imei'>('units');

  const orphanUnits = useMemo(() => units.filter(isOrphanUnit), [units]);

  const orphanSoldUnits = useMemo(
    () => units.filter(isOrphanSoldUnit)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [units],
  );

  const mapUnitTo = async (u: InventoryUnit, segment: 'office' | 'shs') => {
    setBusyId(u.id);
    try {
      await dbService.update('inventoryUnits', u.id, {
        stockSource: segment,
        status: segment === 'office' ? 'available' : 'incoming',
      });
      // If the unit's IMEI happens to match a sitting orphan sale, the
      // newly-completed schema lets the auto-flip path close the loop.
      // Skips silently when there's no IMEI or no matching sale.
      const imei = (u.imei || '').trim().toUpperCase();
      if (imei) {
        try {
          await reconcileOrphanSaleForImei(imei);
        } catch (e) {
          console.warn('post-map reconcile failed', e);
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const totalCount = orphanUnits.length + orphanSoldUnits.length;

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
          {/* Header + tabs */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100 flex-shrink-0">
            <div>
              <h3 className="text-sm font-bold tracking-tight">Orphans</h3>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                {totalCount === 0
                  ? 'Nothing to reconcile — every unit has a complete schema and every sold unit has an IMEI'
                  : `${orphanUnits.length} live units missing data · ${orphanSoldUnits.length} sold units missing IMEI (from ${ORPHAN_DATE_CUTOFF})`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>
          <div className="flex border-b border-slate-100 px-5 flex-shrink-0">
            {(['units', 'sold-no-imei'] as const).map(t => {
              const n = t === 'units' ? orphanUnits.length : orphanSoldUnits.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2 mr-5 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${
                    tab === t ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t === 'units' ? 'Live Units' : 'Sold · No IMEI'} · {n}
                </button>
              );
            })}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {tab === 'units' ? (
              orphanUnits.length === 0 ? (
                <EmptyState label="No incomplete units" />
              ) : (
                <div className="divide-y divide-slate-100">
                  {orphanUnits.map(u => {
                    const reasons = missingFields(u);
                    const busy = busyId === u.id;
                    return (
                      <div key={u.id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-[12px] truncate">{u.model || '—'}</span>
                            {u.storage && <span className="text-[10px] font-mono text-slate-500">{u.storage}</span>}
                            {u.colour && <span className="text-[10px] font-mono text-slate-400">· {u.colour}</span>}
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
                            onClick={() => mapUnitTo(u, 'office')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                            title="Set stockSource=office + status=available"
                          >
                            <MapPin size={10} /> Office
                          </button>
                          <button
                            type="button"
                            onClick={() => mapUnitTo(u, 'shs')}
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
              )
            ) : orphanSoldUnits.length === 0 ? (
              <EmptyState label="No sold units missing IMEI" />
            ) : (
              <div className="divide-y divide-slate-100">
                {orphanSoldUnits.map(u => (
                  <div key={u.id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-[12px] truncate">{u.model || '—'}</span>
                        {u.storage && <span className="text-[10px] font-mono text-slate-500">{u.storage}</span>}
                        {u.colour && <span className="text-[10px] font-mono text-slate-400">· {u.colour}</span>}
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                          {u.salePlatform || '—'}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-400 truncate">
                          {u.saleDate || '—'} · {u.saleOrderId || '—'} · £{u.salePrice ?? 0}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                          <AlertCircle size={10} />
                          no IMEI on record
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setBackfillUnit(u)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        title="Enter the IMEI from the box / device"
                      >
                        <Edit3 size={10} /> Backfill IMEI
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingUnit(u)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700"
                        title="Open the full edit modal to revise every field"
                      >
                        <Edit3 size={10} /> Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {editingUnit && (
          <EditUnitModal unit={editingUnit} onClose={() => setEditingUnit(null)} />
        )}
        {backfillUnit && (
          <EnterImeiModal
            unit={backfillUnit}
            onClose={() => setBackfillUnit(null)}
            onSaved={() => setBackfillUnit(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
      <CheckCircle2 size={28} className="text-emerald-500" />
      <p className="text-[11px] font-mono uppercase tracking-widest">{label}</p>
    </div>
  );
}
