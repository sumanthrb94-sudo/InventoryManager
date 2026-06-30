/**
 * ModelReconciliation — admin tool to unify duplicate model strings in
 * the inventoryUnits collection.
 *
 * What it does: groups every unit whose `model` field collapses to the
 * SAME normalised key (`normalizeBucketModel`) but whose RAW strings
 * differ (e.g. "GALAXY S23" + "Galaxy S23" + "S23"). Each cluster shows
 * its variants with unit counts, a default canonical pick (most-
 * frequent → longest → alpha), and a button to override the canonical
 * inline. The big "Apply All" CTA dispatches one batched write through
 * dbService.bulkCreate (which uses `{ merge: true }` under the hood —
 * passing only `{ model }` patches every existing field intact).
 *
 * After Apply, every affected unit's `model` field is the canonical
 * raw string. The periodic table tiles merge, the device-catalog
 * picker collapses, the operator stops seeing the same product in two
 * tiles. Reports continue to read every unit's model verbatim — the
 * change is just data normalisation, not a filter.
 *
 * Admin-only at the App route level (rendered only under the Admin
 * tab); a defensive useIsAdmin gate disables Apply for the rare case
 * a non-admin reaches the route via deep-link.
 */
import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Wand2 } from 'lucide-react';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { parseBrandModelStorage } from '../lib/modelStorage';
import type { DeviceCategory } from '../types';
import {
  buildReconciliationClusters,
  buildReconciliationPatches,
  type ModelCluster,
} from '../lib/modelReconciliation';

function detectCategory(model: string): DeviceCategory {
  const m = (model || '').toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d|TABA\d|TABS\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

export default function ModelReconciliation() {
  const { units } = useInventoryStore();
  const isAdmin = useIsAdmin();

  /** Cluster list from the live store + per-cluster overrides. We seed
   *  the override map lazily — only when the admin actually changes the
   *  canonical — so the default canonical stays in sync with the live
   *  data and doesn't go stale across re-renders. */
  const baseClusters = useMemo(() => buildReconciliationClusters(units), [units]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [appliedSummary, setAppliedSummary] = useState<{ clusters: number; units: number } | null>(null);

  const clusters: ModelCluster[] = useMemo(
    () => baseClusters.map(c => ({ ...c, canonical: overrides[c.key] ?? c.canonical })),
    [baseClusters, overrides],
  );

  const totals = useMemo(() => ({
    clusters: clusters.length,
    units: clusters.reduce((n, c) => n + c.totalUnits, 0),
    patches: clusters.reduce((n, c) => n + buildReconciliationPatches(c).length, 0),
  }), [clusters]);

  const apply = async () => {
    if (!isAdmin || applying || clusters.length === 0) return;
    setApplying(true);
    try {
      const entries: Array<{ collection: string; id: string; data: Record<string, any> }> = [];
      for (const c of clusters) {
        for (const p of buildReconciliationPatches(c)) {
          const parsed = parseBrandModelStorage(p.model);
          const category = detectCategory(p.model);
          const brand = parsed.brand !== 'Other'
            ? parsed.brand
            : (['iPhone', 'iPad', 'Apple Watch'].includes(category) ? 'Apple' :
              (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category) ? 'Samsung' : 'Other'));
          
          const patchData: Record<string, any> = { 
            model: parsed.model || p.model,
            brand,
            category
          };
          if (parsed.storage) patchData.storage = parsed.storage;
          if (parsed.series) patchData.series = parsed.series;

          entries.push({ collection: 'inventoryUnits', id: p.id, data: patchData });
        }
      }
      if (entries.length === 0) {
        setAppliedSummary({ clusters: 0, units: 0 });
        return;
      }
      // bulkCreate writes with `{ merge: true }` — patches only the
      // model field, leaves every other column on the unit intact.
      await dbService.bulkCreate(entries);
      // One audit row per cluster so the rebrand history is searchable.
      for (const c of clusters) {
        const off = c.variants.filter(v => v.rawModel !== c.canonical);
        if (off.length === 0) continue;
        const movedCount = off.reduce((n, v) => n + v.count, 0);
        const fromVariants = off.map(v => `"${v.rawModel}" × ${v.count}`).join(' + ');
        await logInventoryEvent({
          type: 'stock_adjusted',
          message: `Model reconciled: ${fromVariants} → "${c.canonical}" (${movedCount} units)`,
        });
      }
      setAppliedSummary({ clusters: clusters.length, units: entries.length });
      setOverrides({});
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
              <Wand2 size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight">Model Reconciliation</h2>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
                {totals.clusters === 0
                  ? 'No duplicates — every model is uniquely named'
                  : `${totals.clusters} clusters · ${totals.units} affected units · ${totals.patches} writes pending`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={!isAdmin || applying || totals.patches === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 size={11} />
            {applying ? 'Applying…' : `Apply (${totals.patches})`}
          </button>
        </div>
        {appliedSummary && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800"
          >
            <CheckCircle2 size={13} />
            Reconciled {appliedSummary.clusters} cluster{appliedSummary.clusters === 1 ? '' : 's'} — {appliedSummary.units} units updated.
          </motion.div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {clusters.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-slate-400">
            <CheckCircle2 size={28} className="text-emerald-500" />
            <p className="text-[11px] font-mono uppercase tracking-widest">Nothing to reconcile</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {clusters.map(c => {
              const open = expanded.has(c.key);
              const offCanonical = c.variants.filter(v => v.rawModel !== c.canonical);
              const offUnits = offCanonical.reduce((n, v) => n + v.count, 0);
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => setExpanded(prev => {
                      const next = new Set(prev);
                      next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                      return next;
                    })}
                    className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"
                  >
                    {open ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{c.brand || '—'}</span>
                        <span className="font-mono font-bold text-[13px] truncate">{c.canonical}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {c.variants.length} variants
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 mt-1">
                        {c.totalUnits} units · {offUnits} will be patched · {c.variants.length - 1} variant{c.variants.length - 1 === 1 ? '' : 's'} renamed
                      </p>
                    </div>
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      <AlertCircle size={9} /> {c.totalUnits}
                    </span>
                  </button>
                  {open && (
                    <div className="px-5 pb-4 bg-slate-50/60">
                      <div className="space-y-1.5">
                        {c.variants.map(v => {
                          const isCanonical = v.rawModel === c.canonical;
                          return (
                            <button
                              key={v.rawModel}
                              type="button"
                              onClick={() => setOverrides(prev => ({ ...prev, [c.key]: v.rawModel }))}
                              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors ${
                                isCanonical
                                  ? 'bg-emerald-50 border-emerald-300'
                                  : 'bg-white border-slate-200 hover:border-slate-400'
                              }`}
                            >
                              <span className="flex items-center gap-2 min-w-0 flex-1">
                                {isCanonical && <CheckCircle2 size={11} className="text-emerald-600 flex-shrink-0" />}
                                <span className={`font-mono text-[12px] truncate ${isCanonical ? 'font-bold text-emerald-900' : 'text-slate-700'}`}>
                                  {v.rawModel}
                                </span>
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">
                                {v.count} unit{v.count === 1 ? '' : 's'}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={c.canonical}
                          onChange={e => setOverrides(prev => ({ ...prev, [c.key]: e.target.value }))}
                          placeholder="Or type a custom unified name..."
                          className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 bg-white"
                        />
                      </div>
                      <p className="text-[10px] font-mono text-slate-400 italic mt-2">
                        Click a variant to make it the canonical for this cluster, or type a custom name. Apply rewrites every variant to that string.
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
