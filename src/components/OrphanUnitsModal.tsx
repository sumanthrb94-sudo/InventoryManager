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
import { X, MapPin, Edit3, AlertCircle, CheckCircle2, Link2, Plus, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit, Sale } from '../types';
import { dbService } from '../lib/dbService';
import { reconcileOrphanSaleForImei } from '../services/inventoryService';
import EditUnitModal from './EditUnitModal';
import AddSoldUnitModal from './AddSoldUnitModal';

interface Props {
  units: InventoryUnit[];
  sales: Sale[];
  onClose: () => void;
}

/** Live unit predicate — missing supplier / price / stock segment. */
export function isOrphanUnit(u: InventoryUnit): boolean {
  if (u.status === 'sold' || u.status === 'returned' || u.status === 'lost') return false;
  return !u.supplierId || !(u.buyPrice && u.buyPrice > 0) || !u.stockSource;
}

/** Cut-off for the orphan-sales view. Sales dated before this are
 *  legacy data from the pre-workflow-change era — the operator
 *  explicitly told us to ignore them; they're not actionable and don't
 *  belong in the reconciliation pill. */
export const ORPHAN_SALE_CUTOFF = '2026-04-01';

/** Orphan sale predicate.
 *
 *  Per operator (2026-06-20 audit): an orphan is a sale captured WITHOUT
 *  an IMEI on the report. Those are the rows that need manual mapping
 *  because there's no key to auto-match against an inventory unit.
 *  Sales WITH IMEIs are handled by the import-time auto-link path
 *  (buildPostImportSyncPatches) and the addUnitManual post-create
 *  reconcile — both fire automatically the moment the matching unit
 *  exists, so they never need a human touch and shouldn't crowd this
 *  surface.
 *
 *  Pre-April-1 sales are excluded as legacy regardless of IMEI state. */
export function isOrphanSale(s: Sale): boolean {
  if (s.voidedAt) return false;
  if ((s.saleDate || '') < ORPHAN_SALE_CUTOFF) return false;
  return !((s.imei || '').trim());
}

function missingFields(u: InventoryUnit): string[] {
  const out: string[] = [];
  if (!u.supplierId) out.push('supplier');
  if (!u.buyPrice || u.buyPrice <= 0) out.push('buy price');
  if (!u.stockSource) out.push('office/SHS');
  return out;
}

export default function OrphansModal({ units, sales, onClose }: Props) {
  const [editingUnit, setEditingUnit] = useState<InventoryUnit | null>(null);
  const [addSoldSale, setAddSoldSale] = useState<Sale | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Which orphan-sale row is showing its link-to-unit picker. */
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [tab, setTab] = useState<'units' | 'sales'>('units');

  const orphanUnits = useMemo(() => units.filter(isOrphanUnit), [units]);

  const orphanSales = useMemo(
    () => sales.filter(isOrphanSale)
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [sales],
  );

  /** Pool of units a sale could legitimately be linked TO — available
   *  (not sold) and not already orphaned itself. */
  const linkableUnits = useMemo(
    () => units.filter(u => u.status === 'available' || u.status === 'incoming'),
    [units],
  );

  const mapUnitTo = async (u: InventoryUnit, segment: 'office' | 'shs') => {
    setBusyId(u.id);
    try {
      await dbService.update('inventoryUnits', u.id, {
        stockSource: segment,
        status: segment === 'office' ? 'available' : 'incoming',
      });
      // Operator rule: a unit only auto-flips to 'sold' when every
      // schema field is filled. Setting stockSource here might have
      // completed the schema — re-run the reconcile so any orphan sale
      // sitting on the same IMEI now closes the loop without forcing
      // the operator to do a second manual link in the Orphan Sales
      // tab. Skips silently when no matching sale exists or the unit
      // is still incomplete (e.g. no supplier).
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

  const mapSaleToShs = async (s: Sale) => {
    setBusyId(s.id);
    try {
      // SHS-fulfilled sale carries no unit linkage — supplier shipped
      // direct. Setting stockSource is enough to route the demand signal
      // to the SHS Out-of-Stock view per the existing soldAll filter.
      await dbService.update('sales', s.id, { stockSource: 'shs' });
    } finally {
      setBusyId(null);
    }
  };

  const linkSaleToUnit = async (s: Sale, u: InventoryUnit) => {
    setBusyId(s.id);
    try {
      // Two-sided write: sale gets unit pointer, unit gets sale provenance
      // and flips to sold. Keep both in lockstep so a refresh anywhere
      // re-renders consistently.
      await Promise.all([
        dbService.update('sales', s.id, {
          unitId: u.id,
          stockSource: s.stockSource ?? 'office',
        }),
        dbService.update('inventoryUnits', u.id, {
          status: 'sold',
          saleDate: s.saleDate || u.saleDate,
          salePrice: s.salePrice ?? u.salePrice,
          salePlatform: s.marketplace || u.salePlatform,
          saleOrderId: s.orderNumber || u.saleOrderId,
          stockSource: u.stockSource ?? 'office',
        }),
      ]);
      setPickingFor(null);
      setPickerQuery('');
    } finally {
      setBusyId(null);
    }
  };

  /** Best-effort filter for the inline picker: substring match against
   *  model / IMEI / supplier. Caps results so the row stays compact. */
  const filteredLinkable = useMemo(() => {
    if (!pickingFor) return [];
    const sale = orphanSales.find(s => s.id === pickingFor);
    const q = pickerQuery.trim().toLowerCase()
      || (sale?.sku || '').toLowerCase()
      || (sale?.imei || '').toLowerCase();
    if (!q) return linkableUnits.slice(0, 10);
    return linkableUnits
      .filter(u => {
        const hay = `${u.model} ${u.imei || ''} ${u.supplierName || ''} ${u.storage || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [pickingFor, pickerQuery, orphanSales, linkableUnits]);

  const totalCount = orphanUnits.length + orphanSales.length;

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
                  ? 'Nothing to reconcile — every unit and sale is mapped'
                  : `${orphanUnits.length} live units missing data · ${orphanSales.length} sales without an inventory match`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>
          <div className="flex border-b border-slate-100 px-5 flex-shrink-0">
            {(['units', 'sales'] as const).map(t => {
              const n = t === 'units' ? orphanUnits.length : orphanSales.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2 mr-5 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${
                    tab === t ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {t === 'units' ? 'Live Units' : 'Orphan Sales'} · {n}
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
            ) : orphanSales.length === 0 ? (
              <EmptyState label="No unmatched sales" />
            ) : (
              <div className="divide-y divide-slate-100">
                {orphanSales.map(s => {
                  const busy = busyId === s.id;
                  const picking = pickingFor === s.id;
                  return (
                    <div key={s.id} className="px-5 py-3 hover:bg-slate-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                              {s.marketplace}
                            </span>
                            <span className="font-mono font-bold text-[12px] truncate">{s.sku || s.orderNumber || '—'}</span>
                            <span className="text-[10px] font-mono text-slate-500">£{s.salePrice ?? 0}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono text-slate-400">
                              {s.saleDate || '—'} · {s.orderNumber || '—'}
                              {s.imei ? ` · imei ${s.imei}` : ' · no imei'}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                              <AlertCircle size={10} />
                              no inventory match
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => mapSaleToShs(s)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 disabled:opacity-50"
                            title="Mark as SHS-fulfilled — supplier shipped direct, no unit needed"
                          >
                            <MapPin size={10} /> SHS
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPickingFor(picking ? null : s.id); setPickerQuery(''); }}
                            disabled={busy}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border disabled:opacity-50 ${
                              picking
                                ? 'bg-emerald-700 text-white border-emerald-700'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            }`}
                            title="Pick an existing available/incoming unit to link this sale to"
                          >
                            <Link2 size={10} /> {picking ? 'Cancel' : 'Link Unit'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAddSoldSale(s)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700 disabled:opacity-50"
                            title="Create a fresh inventory unit already in SOLD state, back-linked to this sale"
                          >
                            <Plus size={10} /> Add Stock
                          </button>
                        </div>
                      </div>

                      {/* Inline link-to-unit picker. Pre-filters by SKU/IMEI;
                          operator can refine with the search box. Up to 10 hits. */}
                      {picking && (
                        <div className="mt-3 ml-1 pl-3 border-l-2 border-emerald-300">
                          <div className="relative mb-2">
                            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              autoFocus
                              value={pickerQuery}
                              onChange={e => setPickerQuery(e.target.value)}
                              placeholder="Search by model / IMEI / supplier…"
                              className="w-full pl-7 pr-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:border-slate-900"
                            />
                          </div>
                          {filteredLinkable.length === 0 ? (
                            <p className="text-[10px] font-mono text-slate-400 italic px-1 py-2">
                              No matching available units. Try a different search or use "Add Stock" to create one.
                            </p>
                          ) : (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {filteredLinkable.map(u => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => linkSaleToUnit(s, u)}
                                  disabled={busy}
                                  className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 disabled:opacity-50"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold truncate">{u.model}</p>
                                    <p className="text-[9px] font-mono text-slate-400 truncate">
                                      {u.imei || '—'} · {u.storage || '—'} · {u.supplierName || '—'} · £{u.buyPrice}
                                    </p>
                                  </div>
                                  <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">
                                    {u.status}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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
        {addSoldSale && (
          <AddSoldUnitModal
            sale={addSoldSale}
            onClose={() => setAddSoldSale(null)}
            onSaved={() => setAddSoldSale(null)}
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
