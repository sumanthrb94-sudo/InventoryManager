/**
 * ConfigurationPanel — admin-only Configuration sub-tab under Admin.
 *
 * One screen consolidating the editable admin data the operator
 * (2026-06-21) asked for:
 *
 *   1. Models catalog (writes to the `models` Firestore collection) —
 *      brand, model, series, SKU, default storage. Powers the
 *      strict DeviceComboBox picker in Add Stock + Bulk Order; admin
 *      can seed catalog entries even when no stock for that model
 *      exists yet. List + add + delete inline.
 *   2. Suppliers — embeds the existing <Suppliers /> + supplier
 *      WhatsApp feed so the operator manages suppliers from the same
 *      place instead of a separate sub-tab.
 *
 * Doesn't replace the standalone "Models" reconciliation tool — that
 * stays as its own cleanup surface. This page is for ongoing catalog
 * maintenance, not retroactive dedup.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SlidersHorizontal, Plus, Trash2, Edit3, X, AlertCircle, CheckCircle2, Database, Users, Wand2, Package, History } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { auth } from '../lib/firebase';
import Suppliers from './Suppliers';
import DataHealthPanel from './DataHealthPanel';
import SkuReconciliation from './SkuReconciliation';
import AccessoryStockActionModal from './AccessoryStockActionModal';
import { useInventoryStore } from '../lib/inventoryStore';
import type { AccessoryStock, AccessoryStockEvent } from '../types';
import { findGradeCasingDrift, fixGradeCasing } from '../lib/migrations/normaliseGradeCasing';

interface ModelDoc {
  id: string;
  brand: string;
  model: string;
  series?: string;
  // sku / defaultStorage are legacy fields some old docs may still carry;
  // we no longer write or display them. Storage is captured per-unit at
  // Add-Stock time, not on the catalog entry.
  sku?: string;
  defaultStorage?: string;
  createdAt: string;
  createdBy?: string;
  ownerId: 'shared';
}

export default function ConfigurationPanel() {
  const isAdmin = useIsAdmin();

  // ── Models catalog ─────────────────────────────────────────────────────────
  // Catalog entries need only brand + model + series. Storage / colour /
  // grade are captured per-unit while adding stock — a catalog entry is a
  // "what models exist" list, not a per-variant spec.
  const [models, setModels] = useState<ModelDoc[]>([]);
  const [draft, setDraft] = useState<{ brand: string; model: string; series: string }>({
    brand: '', model: '', series: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  // Inline edit state — which row is being edited + the working values.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ brand: string; model: string; series: string }>({
    brand: '', model: '', series: '',
  });

  useEffect(() => {
    return dbService.subscribeToCollection('models', (data: ModelDoc[]) => setModels(data));
  }, []);

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => {
      const c = (a.brand || '').localeCompare(b.brand || '');
      return c !== 0 ? c : (a.model || '').localeCompare(b.model || '');
    }),
    [models],
  );

  /** True when (brand, model) already exists, optionally ignoring one doc
   *  id (so an edit doesn't collide with the row being edited). */
  const isDuplicate = (brand: string, model: string, ignoreId?: string) =>
    models.some(m =>
      m.id !== ignoreId &&
      (m.brand || '').toLowerCase() === brand.toLowerCase() &&
      (m.model || '').toLowerCase() === model.toLowerCase()
    );

  const addModel = async () => {
    if (!isAdmin || saving) return;
    const brand = draft.brand.trim();
    const model = draft.model.trim();
    if (!brand)  { setError('Brand is required'); return; }
    if (!model)  { setError('Model is required'); return; }
    if (isDuplicate(brand, model)) { setError(`"${brand} ${model}" is already in the catalog`); return; }

    setSaving(true);
    setError('');
    try {
      const id = `mdl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // dbService.create updates the shared in-memory cache and emits to
      // every live subscriber — including the inventoryStore listener the
      // Add-Stock / Bulk-Order pickers read from — so a new model appears
      // in those pickers immediately, no refresh.
      await dbService.create('models', id, {
        brand, model,
        series: draft.series.trim() || undefined,
        createdAt: new Date().toISOString(),
        createdBy: auth.currentUser?.email || 'admin',
        ownerId: 'shared',
      });
      setDraft({ brand: '', model: '', series: '' });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (m: ModelDoc) => {
    setEditingId(m.id);
    setEditDraft({ brand: m.brand || '', model: m.model || '', series: m.series || '' });
    setError('');
  };

  const saveEdit = async () => {
    if (!isAdmin || !editingId) return;
    const brand = editDraft.brand.trim();
    const model = editDraft.model.trim();
    if (!brand || !model) { setError('Brand and model are required'); return; }
    if (isDuplicate(brand, model, editingId)) { setError(`"${brand} ${model}" already exists`); return; }
    await dbService.update('models', editingId, {
      brand, model,
      series: editDraft.series.trim() || null,
      ownerId: 'shared',
    });
    setEditingId(null);
    setError('');
  };

  const removeModel = async (m: ModelDoc) => {
    if (!isAdmin) return;
    const sure = window.confirm(`Remove "${m.brand} ${m.model}" from the catalog?\n\nExisting inventory units are not affected; this only removes the catalog entry employees pick from in Add Stock / Bulk Order.`);
    if (!sure) return;
    await dbService.delete('models', m.id);
  };

  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center">
        <AlertCircle size={28} className="mx-auto text-amber-500" />
        <p className="text-[11px] font-mono uppercase tracking-widest text-slate-500 mt-2">Admin only</p>
        <p className="text-[10px] font-mono text-slate-400 mt-1">Configuration is restricted to the admin account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Section header ───────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
            <SlidersHorizontal size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold tracking-tight">Configuration</h2>
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              Editable admin data · Models catalog · Suppliers
            </p>
          </div>
        </div>
      </div>

      {/* ── Models catalog ───────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Database size={14} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[13px] font-bold tracking-tight">Models Catalog</h3>
              <p className="text-[10px] font-mono text-slate-400">
                {sortedModels.length} {sortedModels.length === 1 ? 'model' : 'models'} · employees pick from this list
              </p>
            </div>
          </div>
        </div>

        {/* Add new model — brand + model + series only. Storage / colour /
            grade are captured per-unit at Add-Stock time, not here. */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-3">
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Brand *</label>
              <input
                value={draft.brand}
                onChange={e => setDraft(d => ({ ...d, brand: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addModel(); }}
                placeholder="Samsung"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-slate-900 bg-white"
              />
            </div>
            <div className="md:col-span-5">
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Model *</label>
              <input
                value={draft.model}
                onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addModel(); }}
                placeholder="Galaxy S24 Ultra"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-slate-900 bg-white"
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Series</label>
              <input
                value={draft.series}
                onChange={e => setDraft(d => ({ ...d, series: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addModel(); }}
                placeholder="Galaxy S"
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-slate-900 bg-white"
              />
            </div>
            <div className="md:col-span-1 flex md:items-end">
              <button
                onClick={addModel}
                disabled={saving}
                className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 mt-1 md:mt-0 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40"
              >
                <Plus size={11} /> Add
              </button>
            </div>
          </div>
          {error && (
            <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-rose-600">
              <AlertCircle size={11} /> {error}
            </p>
          )}
          {savedFlash && (
            <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700">
              <CheckCircle2 size={11} /> Added to catalog · live in Add Stock now
            </p>
          )}
        </div>

        {/* Existing catalog list — edit / delete per row */}
        {sortedModels.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-slate-400">
            <Database size={24} />
            <p className="text-[11px] font-mono uppercase tracking-widest">Catalog is empty</p>
            <p className="text-[10px] font-mono text-slate-400">Add the first model above. Employees will pick from this list in Add Stock.</p>
          </div>
        ) : (
          <table className="w-full text-[11px]" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            <thead>
              <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
                <th className="text-left px-4 py-2 border-b border-slate-200">Brand</th>
                <th className="text-left px-4 py-2 border-b border-slate-200">Model</th>
                <th className="text-left px-4 py-2 border-b border-slate-200">Series</th>
                <th className="text-right px-4 py-2 border-b border-slate-200 w-28"></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {sortedModels.map(m => {
                  const editing = editingId === m.id;
                  return (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hover:bg-slate-50 border-b border-slate-100"
                    >
                      {editing ? (
                        <>
                          <td className="px-3 py-1.5">
                            <input
                              value={editDraft.brand}
                              onChange={e => setEditDraft(d => ({ ...d, brand: e.target.value }))}
                              className="w-full border border-amber-400 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-black bg-white"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={editDraft.model}
                              onChange={e => setEditDraft(d => ({ ...d, model: e.target.value }))}
                              className="w-full border border-amber-400 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-black bg-white"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={editDraft.series}
                              onChange={e => setEditDraft(d => ({ ...d, series: e.target.value }))}
                              placeholder="—"
                              className="w-full border border-amber-400 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-black bg-white"
                            />
                          </td>
                          <td className="px-4 py-1.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 mr-1"
                              title="Save"
                            >
                              <CheckCircle2 size={10} /> Save
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setError(''); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                              title="Cancel"
                            >
                              <X size={10} />
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-2 text-slate-700">{m.brand}</td>
                          <td className="px-4 py-2 font-bold text-slate-900">{m.model}</td>
                          <td className="px-4 py-2 text-slate-600">{m.series || <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => startEdit(m)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border bg-white text-slate-600 border-slate-200 hover:bg-slate-50 mr-1"
                              title="Edit"
                            >
                              <Edit3 size={10} /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removeModel(m)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border bg-white text-rose-600 border-rose-200 hover:bg-rose-50"
                              title="Remove from catalog"
                            >
                              <Trash2 size={10} />
                            </button>
                          </td>
                        </>
                      )}
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Data hygiene ──────────────────────────────────────────────────
          Three tools that do the same job — find records that are valid but
          wrong, and repair them. They were spread across two admin sections
          and a stand-alone tab; grouped here because an admin fixing one is
          usually about to fix the others. */}
      <DataHealthPanel />
      <GradeCasingPanel />
      <SkuReconciliation />

      {/* ── Accessory stock (no-IMEI quantity pools) ──────────────────────── */}
      <AccessoryStockPanel />

      {/* ── Suppliers (embedded existing components) ─────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
            <Users size={14} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold tracking-tight">Suppliers</h3>
            <p className="text-[10px] font-mono text-slate-400">Add suppliers, manage portals, track payment terms</p>
          </div>
        </div>
        <div className="px-5 py-4">
          <Suppliers />
        </div>
      </div>
    </div>
  );
}


/**
 * Grade / SIM Type casing repair.
 *
 * Two intake screens once wrote 'Brand new' while the shared constant said
 * 'Brand New'. Same grade, two strings, so every grade breakdown split it
 * across two rows. Intake now normalises on write; this cleans up what was
 * stored before that.
 *
 * Shows the proposed change and its scale BEFORE anything is written —
 * capitalisation only, never meaning, and a free-text grade the operator
 * genuinely typed is never touched.
 */
function GradeCasingPanel() {
  const { units } = useInventoryStore();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failed, setFailed] = useState('');

  const drift = useMemo(() => findGradeCasingDrift(units), [units]);

  const run = async () => {
    setRunning(true);
    setFailed('');
    try {
      const res = await fixGradeCasing(drift.patches, dbService);
      setDone(res.updated);
    } catch (e: any) {
      setFailed(e?.message || 'Normalisation failed');
    } finally {
      setRunning(false);
    }
  };

  // Nothing split, nothing to show — this panel earns its space only when
  // there is real drift.
  if (drift.patches.length === 0 && done === null) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
          <Wand2 size={14} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight">Grade &amp; SIM casing</h3>
          <p className="text-[10px] font-mono text-slate-400">
            Same value stored two ways — merges them onto the option the app offers
          </p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {done !== null ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-700">
            <CheckCircle2 size={12} /> {done} unit{done === 1 ? '' : 's'} normalised · breakdowns now group correctly
          </p>
        ) : (
          <>
            <div className="space-y-1">
              {drift.summary.map(r => (
                <div key={`${r.field}-${r.from}`} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-[11px] font-mono text-slate-700 truncate">
                    <span className="text-slate-400">{r.field === 'grade' ? 'Grade' : 'SIM'}</span>{' '}
                    “{r.from}” → <strong>“{r.to}”</strong>
                  </span>
                  <span className="text-[11px] font-bold font-mono text-violet-700 flex-shrink-0">{r.count}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
              Capitalisation only — a grade you typed by hand that matches no option is left alone.
            </p>
            {failed && (
              <p className="inline-flex items-center gap-1 text-[10px] font-mono text-rose-600">
                <AlertCircle size={11} /> {failed}
              </p>
            )}
            <button
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-violet-700 disabled:opacity-40"
            >
              <Wand2 size={11} /> {running ? 'Normalising…' : `Normalise ${drift.patches.length} unit${drift.patches.length === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Human-readable line for one ledger row in the per-SKU history strip. */
function describeAccessoryEvent(e: AccessoryStockEvent): string {
  const sign = e.delta > 0 ? '+' : '';
  switch (e.type) {
    case 'topup':      return `Topped up ${sign}${e.delta} → ${e.quantityAfter}`;
    case 'sale': {
      const via = e.source === 'sales_report_import'
        ? (e.orderNumber ? `order ${e.orderNumber}` : 'Sales Report import')
        : (e.orderNumber ? `manual · ${e.orderNumber}` : 'manual sale');
      // "Sold" already conveys direction — showing the signed delta here
      // would read as "Sold -3", a redundant minus sign.
      return `Sold ${Math.abs(e.delta)} (${via}) → ${e.quantityAfter}`;
    }
    case 'adjustment': return `Adjusted ${sign}${e.delta} → ${e.quantityAfter}${e.reason ? ` · ${e.reason}` : ''}`;
    case 'return':     return `Returned ${sign}${e.delta} → ${e.quantityAfter}`;
    case 'restore':    return `Restored from Inventory Report → ${e.quantityAfter}`;
    default:           return `${sign}${e.delta} → ${e.quantityAfter}`;
  }
}

/**
 * AccessoryStockPanel — the no-IMEI quantity pools (see AccessoryStock in
 * types.ts). New pools / top-ups are added via the "Accessories" tab in Add
 * Stock; this panel is where an admin sees current levels, sells/adjusts/
 * returns stock outside the Sales Report import path, and reviews the
 * transaction ledger behind each SKU's running quantity (see
 * AccessoryStockEvent).
 */
function AccessoryStockPanel() {
  const { accessoryStock, accessoryStockEvents } = useInventoryStore();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<{ accessory: AccessoryStock; mode: 'adjust' | 'return' } | null>(null);
  const sorted = useMemo(
    () => [...accessoryStock].sort((a, b) => a.sku.localeCompare(b.sku)),
    [accessoryStock],
  );
  const eventsBySkuId = useMemo(() => {
    const map = new Map<string, AccessoryStockEvent[]>();
    for (const e of accessoryStockEvents) {
      const list = map.get(e.skuId) ?? [];
      list.push(e);
      map.set(e.skuId, list);
    }
    for (const list of map.values()) {
      list.sort((x, y) => {
        const tx = typeof x.createdAt === 'string' ? x.createdAt : '';
        const ty = typeof y.createdAt === 'string' ? y.createdAt : '';
        return ty.localeCompare(tx);
      });
    }
    return map;
  }, [accessoryStockEvents]);

  const removeSku = async (id: string, sku: string) => {
    const sure = window.confirm(`Remove accessory SKU "${sku}" from stock? This deletes the pool entirely — use it only when the SKU is discontinued.`);
    if (!sure) return;
    await dbService.delete('accessoryStock', id);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
          <Package size={14} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight">Accessory Stock</h3>
          <p className="text-[10px] font-mono text-slate-400">
            No-IMEI quantity pools (chargers, SIM pins, cables) — add / top up from Add Stock → Accessories
          </p>
        </div>
      </div>
      <div className="px-5 py-4">
        {sorted.length === 0 ? (
          <p className="text-[11px] font-mono text-slate-400">No accessory SKUs yet.</p>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[9px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="pb-2 pr-3">SKU</th>
                <th className="pb-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Supplier</th>
                <th className="pb-2 pr-3 text-right">Qty</th>
                <th className="pb-2 pr-3 text-right">BP</th>
                <th className="pb-2 w-40" />
                <th className="pb-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(a => {
                const history = eventsBySkuId.get(a.id) ?? [];
                const isOpen = expanded === a.id;
                return (
                  <React.Fragment key={a.id}>
                    <tr className="border-b border-slate-50 last:border-0">
                      <td className="py-1.5 pr-3 font-mono">{a.sku}</td>
                      <td className="py-1.5 pr-3">{a.name}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{a.supplierName || '—'}</td>
                      <td className={`py-1.5 pr-3 text-right font-mono font-bold ${a.quantity === 0 ? 'text-rose-500' : 'text-slate-700'}`}>{a.quantity}</td>
                      <td className="py-1.5 pr-3 text-right font-mono text-slate-500">£{(a.buyPrice ?? 0).toFixed(2)}</td>
                      <td className="py-1.5 pr-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setActionFor({ accessory: a, mode: 'adjust' })}
                            className="px-2 py-1 rounded bg-amber-100 text-amber-800 text-[9px] font-bold uppercase tracking-widest hover:bg-amber-200"
                          >
                            Adjust
                          </button>
                          <button
                            onClick={() => setActionFor({ accessory: a, mode: 'return' })}
                            className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-200"
                          >
                            Return
                          </button>
                        </div>
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => setExpanded(isOpen ? null : a.id)}
                            className="p-1 text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 rounded transition-all"
                            title="History"
                          >
                            <History size={11} />
                          </button>
                          <button
                            onClick={() => removeSku(a.id, a.sku)}
                            className="p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all"
                            title="Remove SKU"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={7} className="px-3 py-2">
                          {history.length === 0 ? (
                            <p className="text-[10px] font-mono text-slate-400 py-1">No ledger history yet.</p>
                          ) : (
                            <ul className="space-y-1">
                              {history.slice(0, 10).map(e => (
                                <li key={e.id} className="flex items-center justify-between gap-3 text-[10px] font-mono text-slate-600">
                                  <span className="truncate">{describeAccessoryEvent(e)}</span>
                                  <span className="text-slate-400 flex-shrink-0">
                                    {typeof e.createdAt === 'string' ? e.createdAt.slice(0, 10) : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {actionFor && (
        <AccessoryStockActionModal
          accessory={actionFor.accessory}
          initialMode={actionFor.mode}
          onClose={() => setActionFor(null)}
        />
      )}
    </div>
  );
}
