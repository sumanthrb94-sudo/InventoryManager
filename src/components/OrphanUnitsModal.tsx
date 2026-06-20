/**
 * OrphansModal — reconciliation surface for sales that landed in the
 * sales collection but have NO matching inventory unit.
 *
 * Operator criterion (2026-06-20 final): an orphan is a sale uploaded
 * from a sales report, marked as sold, but with no corresponding
 * inventory-unit entry. Either the sale carries no IMEI, or the IMEI
 * exists but doesn't match any unit doc. Both flavours qualify;
 * presence of an IMEI alone doesn't disqualify because the matching
 * unit may simply not have been added yet.
 *
 * Pre-2026-06-09 sales are excluded as legacy — operator explicitly
 * told us to ignore that window.
 *
 * Per-row action: "Create Inventory Unit" delegates to AddSoldUnitModal
 * which writes a fresh unit already in SOLD state and back-links the
 * sale doc. Once the operator does that, the row drops out of the list
 * automatically (sale.unitId is set → predicate fails).
 */
import React, { useMemo, useState } from 'react';
import { X, AlertCircle, CheckCircle2, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit, Sale } from '../types';
import AddSoldUnitModal from './AddSoldUnitModal';

interface Props {
  units: InventoryUnit[];
  sales: Sale[];
  onClose: () => void;
}

/** Cut-off date — pre-Jun-9 sales are legacy and excluded. */
export const ORPHAN_DATE_CUTOFF = '2026-06-09';

/** Orphan-sale predicate. A sale is orphan when:
 *   - not voided
 *   - dated on/after ORPHAN_DATE_CUTOFF
 *   - has no unitId pointing to a real unit, AND
 *   - has no IMEI matching any current unit
 *  IMEI presence alone is fine — the unit just hasn't been added yet
 *  and the sale is waiting for reconciliation. */
export function isOrphanSale(
  s: Sale,
  unitsById: Map<string, InventoryUnit>,
  unitsByImei: Map<string, InventoryUnit>,
): boolean {
  if (s.voidedAt) return false;
  if ((s.saleDate || '') < ORPHAN_DATE_CUTOFF) return false;
  if (s.unitId && unitsById.has(s.unitId)) return false;
  const imei = (s.imei || '').trim().toUpperCase();
  if (imei && unitsByImei.has(imei)) return false;
  return true;
}

export default function OrphansModal({ units, sales, onClose }: Props) {
  const [addSoldSale, setAddSoldSale] = useState<Sale | null>(null);

  const { unitsById, unitsByImei } = useMemo(() => {
    const byId = new Map<string, InventoryUnit>();
    const byImei = new Map<string, InventoryUnit>();
    for (const u of units) {
      if (u.id) byId.set(u.id, u);
      const k = (u.imei || '').trim().toUpperCase();
      if (k) byImei.set(k, u);
    }
    return { unitsById: byId, unitsByImei: byImei };
  }, [units]);

  const orphanSales = useMemo(
    () => sales
      .filter(s => isOrphanSale(s, unitsById, unitsByImei))
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [sales, unitsById, unitsByImei],
  );

  /** Quick stats — total since cutoff + last-10-days slice so the
   *  operator sees both windows in the modal header without doing the
   *  date math themselves. */
  const last10Cutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    return d.toISOString().slice(0, 10);
  }, []);
  const last10Count = useMemo(
    () => orphanSales.filter(s => (s.saleDate || '') >= last10Cutoff).length,
    [orphanSales, last10Cutoff],
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
              <h3 className="text-sm font-bold tracking-tight">Orphans · {orphanSales.length}</h3>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                {orphanSales.length === 0
                  ? 'No sales without a matching inventory unit'
                  : `${orphanSales.length} sale${orphanSales.length === 1 ? '' : 's'} from ${ORPHAN_DATE_CUTOFF} · ${last10Count} in the last 10 days`}
              </p>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {orphanSales.length === 0 ? (
              <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
                <CheckCircle2 size={28} className="text-emerald-500" />
                <p className="text-[11px] font-mono uppercase tracking-widest">All sales have inventory matches</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {orphanSales.map(s => (
                  <div key={s.id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200">
                          {s.marketplace}
                        </span>
                        <span className="font-mono font-bold text-[12px] truncate">{s.sku || s.orderNumber || '—'}</span>
                        <span className="text-[10px] font-mono text-slate-500">£{s.salePrice ?? 0}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono text-slate-400 truncate">
                          {s.saleDate || '—'} · {s.orderNumber || '—'}
                          {s.imei ? ` · imei ${s.imei}` : ' · no imei'}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-amber-700">
                          <AlertCircle size={10} /> no inventory unit
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setAddSoldSale(s)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700"
                        title="Create the inventory unit (sold state) and back-link this sale"
                      >
                        <Plus size={10} /> Create Unit
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
