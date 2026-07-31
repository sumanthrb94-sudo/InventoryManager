/**
 * SkuReconciliation — admin tool for units whose persisted model is still a
 * raw operator SKU code (e.g. "ASI-SG-A32--64-BK-EX").
 *
 * Why: `parseBrandModelStorage` cleans most SKU shapes at read time, but
 * unknown brand codes or new operator conventions can slip through and show
 * up as SKU strings in stock alerts. This screen surfaces every unit whose
 * raw Firestore model looks SKU-like so an admin can manually fix it, or
 * bulk auto-fix the ones the parser already understands.
 *
 * Admin-only at the App route level; a defensive useIsAdmin gate disables
 * writes for the rare non-admin deep-link case.
 */
import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertCircle, CheckCircle2, Database, Edit3, Wand2,
} from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { logInventoryEvent } from '../lib/inventoryEvents';
import {
  normalizeOperatorSku, parseBrandModelStorage, looksLikeSku, stripKnownBrandPrefix,
} from '../lib/modelStorage';
import type { InventoryUnit } from '../types';
import EditUnitModal from './EditUnitModal';

/** True when the parser recognises the SKU code (with or without a brand
 *  prefix) and can auto-clean it. Exported for direct testing. */
export function isAutoFixable(u: InventoryUnit): boolean {
  return normalizeOperatorSku(stripKnownBrandPrefix(u.rawModel || u.model)) !== null;
}

/** Build the clean patch a bulk auto-fix would write for a unit. Exported
 *  for direct testing. */
export function buildAutoFixPatch(unit: InventoryUnit): Record<string, any> | null {
  const raw = stripKnownBrandPrefix(unit.rawModel || unit.model);
  if (!raw || normalizeOperatorSku(raw) === null) return null;
  const parsed = parseBrandModelStorage(raw);
  if (!parsed.model) return null;
  return {
    model: parsed.model,
    brand: parsed.brand !== 'Other' ? parsed.brand : unit.brand,
    storage: parsed.storage || unit.storage,
    sku: [parsed.brand !== 'Other' ? parsed.brand : unit.brand, parsed.model, parsed.storage]
      .filter(Boolean)
      .join(' '),
  };
}

export default function SkuReconciliation() {
  const { units } = useInventoryStore();
  const isAdmin = useIsAdmin();
  const [editingUnit, setEditingUnit] = useState<InventoryUnit | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  const skuUnits = useMemo(
    () => units
      .filter(u => looksLikeSku(u.rawModel || u.model))
      .sort((a, b) => (a.rawModel || a.model).localeCompare(b.rawModel || b.model)),
    [units],
  );

  const autoFixable = useMemo(
    () => skuUnits.filter(isAutoFixable),
    [skuUnits],
  );

  const applyAll = async () => {
    if (!isAdmin || applying || autoFixable.length === 0) return;
    setApplying(true);
    try {
      const entries: Array<{ collection: string; id: string; data: Record<string, any> }> = [];
      for (const u of autoFixable) {
        const patch = buildAutoFixPatch(u);
        if (!patch) continue;
        entries.push({ collection: 'inventoryUnits', id: u.id, data: patch });
      }
      if (entries.length === 0) {
        setAppliedCount(0);
        return;
      }
      await dbService.bulkCreate(entries);
      await logInventoryEvent({
        type: 'stock_adjusted',
        message: `SKU reconciliation: auto-fixed ${entries.length} unit(s) with recognised operator SKU codes`,
      });
      setAppliedCount(entries.length);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
              <Database size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight">Reconcile SKUs</h2>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                {skuUnits.length === 0
                  ? 'No raw SKU models — every unit has a clean product name'
                  : `${skuUnits.length} unit(s) with raw SKU model(s) · ${autoFixable.length} auto-fixable`}
              </p>
            </div>
          </div>
          {skuUnits.length > 0 && (
            <div className="flex items-center gap-2">
              {autoFixable.length > 0 && (
                <button
                  type="button"
                  onClick={applyAll}
                  disabled={applying || !isAdmin}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border bg-amber-600 text-white border-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Wand2 size={12} />
                  {applying ? 'Fixing…' : `Auto-fix ${autoFixable.length}`}
                </button>
              )}
            </div>
          )}
        </div>

        {appliedCount !== null && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="mt-4 flex items-center gap-2 text-[11px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2"
          >
            <CheckCircle2 size={14} />
            {appliedCount === 0
              ? 'Nothing to auto-fix.'
              : `Auto-fixed ${appliedCount} unit(s). Remaining rows may need manual editing.`}
          </motion.div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {skuUnits.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-[11px] font-mono uppercase tracking-widest">All models are clean</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Raw SKU</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Cleaned</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">IMEI / Serial</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">Supplier</th>
                  <th className="px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-slate-500 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {skuUnits.map(u => {
                  const fixable = isAutoFixable(u);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-[12px] text-slate-900 truncate max-w-[200px]" title={u.rawModel || u.model}>
                            {u.rawModel || u.model}
                          </span>
                          {!fixable && (
                            <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-100">
                              <AlertCircle size={8} /> manual
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] text-slate-600 truncate block max-w-[180px]" title={u.model}>
                          {u.model}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono text-slate-500 truncate block max-w-[120px]">
                          {u.imei || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono text-slate-500 capitalize">
                          {u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono text-slate-500 truncate block max-w-[120px]">
                          {u.supplierName || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingUnit(u)}
                          disabled={!isAdmin}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border bg-slate-900 text-white border-slate-900 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Edit3 size={10} /> Fix
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {editingUnit && (
          <EditUnitModal unit={editingUnit} onClose={() => setEditingUnit(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
