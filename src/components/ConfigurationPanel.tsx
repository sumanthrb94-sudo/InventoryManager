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
import { SlidersHorizontal, Plus, Trash2, Edit3, X, AlertCircle, CheckCircle2, Database, Users, Wand2 } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { useIsAdmin } from '../lib/useIsAdmin';
import { auth } from '../lib/firebase';
import Suppliers from './Suppliers';
import DataHealthPanel from './DataHealthPanel';
import SkuReconciliation from './SkuReconciliation';
import AccessoryStockPanel from './AccessoryStockPanel';
import AccessoryCatalogPanel from './AccessoryCatalogPanel';
import { useInventoryStore } from '../lib/inventoryStore';
import { findGradeCasingDrift, fixGradeCasing } from '../lib/migrations/normaliseGradeCasing';
import { findModelCatalogDrift, fixModelCatalog } from '../lib/migrations/normaliseModelCatalog';
import { findMangledUnitModels, fixMangledUnitModels } from '../lib/migrations/repairMangledUnitModels';
import { normalizeBucketModel, normalizeOperatorSku } from '../lib/modelStorage';

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

/** Same bucket-key normalisation (`normalizeBucketModel`) that
 *  DeviceComboBox's catalog build and `catalogEntryFor` use. Exported so
 *  it's directly testable — a raw exact-string compare here would let
 *  "Galaxy S23" / "GALAXY S23" / "S23" all pass as distinct catalog rows
 *  even though the picker treats them as one bucket. */
export function modelBucketKey(brand: string, model: string): string {
  return `${(brand || '').toLowerCase().trim()}||${normalizeBucketModel(model)}`;
}

/** True when (brand, model) already exists in the catalog, optionally
 *  ignoring one doc id (so an edit doesn't collide with the row being
 *  edited). Exported for direct testing. */
export function isDuplicateModel(
  models: Array<Pick<ModelDoc, 'id' | 'brand' | 'model'>>,
  brand: string,
  model: string,
  ignoreId?: string,
): boolean {
  const key = modelBucketKey(brand, model);
  return models.some(m => m.id !== ignoreId && modelBucketKey(m.brand || '', m.model || '') === key);
}

/** Same SKU-shape guard DeviceComboBox's inline "+Add" pill already
 *  applies (see `DeviceComboBox.tsx` `handleCreate`) — this standalone
 *  panel is the OTHER write path to `models` and had no equivalent, so an
 *  admin could paste a raw operator SKU code (e.g. "IPAD-11-128-BL")
 *  straight into the Model field with nothing cleaning it up first.
 *  Exported for direct testing. */
export function cleanCatalogModelInput(model: string): string {
  const trimmed = model.trim();
  return normalizeOperatorSku(trimmed) ?? trimmed;
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

  const isDuplicate = (brand: string, model: string, ignoreId?: string) =>
    isDuplicateModel(models, brand, model, ignoreId);

  const addModel = async () => {
    if (!isAdmin || saving) return;
    const brand = draft.brand.trim();
    const model = cleanCatalogModelInput(draft.model);
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
    const model = cleanCatalogModelInput(editDraft.model);
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

      {/* ── Accessories catalog ──────────────────────────────────────────
          Sits directly under the Models catalog because it is the same kind
          of thing — "what employees can pick" — just for no-IMEI items, with
          a deliberately smaller schema (SKU + name, no brand/model/series).
          It used to live below the data-hygiene panels, where it was hidden
          behind the full models table and effectively undiscoverable. */}
      <AccessoryCatalogPanel />

      {/* ── Data hygiene ──────────────────────────────────────────────────
          Three tools that do the same job — find records that are valid but
          wrong, and repair them. They were spread across two admin sections
          and a stand-alone tab; grouped here because an admin fixing one is
          usually about to fix the others. */}
      <DataHealthPanel />
      <ModelCatalogRepairPanel />
      <MangledUnitModelPanel />
      <GradeCasingPanel />
      <SkuReconciliation />

      {/* ── Accessory stock (no-IMEI quantity pools) ──────────────────────
          How many of each are on hand. The catalog of "what exists" is up
          beside the Models catalog. */}
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
/**
 * Repairs catalog rows saved with a blank brand and the brand word fused
 * into an ALL-CAPS model string — see normaliseModelCatalog.ts for how the
 * drift happened. Sits above the grade-casing panel because the catalog
 * feeds the model pickers, so it's the more consequential of the two.
 */
/**
 * Sweep for inventory units whose stored model decayed to a bare
 * parenthetical ("(10.1)(T580)"). Beyond looking wrong everywhere the model
 * is displayed, the missing prose is what made the Sales Report audit gate
 * demand a 15-digit IMEI from Wi-Fi-only tablets that have never had one.
 * Only units with a recognised model code are rewritten; the rest are listed
 * for the operator to name by hand rather than guessed at.
 */
function MangledUnitModelPanel() {
  const { units } = useInventoryStore();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ updated: number } | null>(null);
  const [failed, setFailed] = useState('');

  const drift = useMemo(
    () => findMangledUnitModels((units as any[]).map(u => ({
      id: u.id, model: u.model, rawModel: u.rawModel, imei: u.imei,
    }))),
    [units],
  );

  const run = async () => {
    setRunning(true);
    setFailed('');
    try {
      setDone(await fixMangledUnitModels(drift, dbService));
    } catch (e: any) {
      setFailed(e?.message || 'Repair failed');
    } finally {
      setRunning(false);
    }
  };

  if (drift.repairs.length === 0 && drift.unresolved.length === 0 && done === null) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center">
          <Wand2 size={14} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight">Unit model names lost to fragments</h3>
          <p className="text-[10px] font-mono text-slate-400">
            Restores product names on units whose model is only a code, e.g. “(10.1)(T580)”
          </p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {done !== null ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-700">
            <CheckCircle2 size={12} /> {done.updated} unit{done.updated === 1 ? '' : 's'} renamed
          </p>
        ) : (
          <>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {drift.repairs.slice(0, 12).map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-[11px] font-mono text-slate-700 truncate">
                    “{r.before}” → <strong>{r.after}</strong>
                  </span>
                  {!r.hasCellular && (
                    <span className="text-[10px] font-mono text-sky-700 flex-shrink-0">Wi-Fi · serial only</span>
                  )}
                </div>
              ))}
              {drift.repairs.length > 12 && (
                <p className="text-[10px] font-mono text-slate-400 px-3">
                  + {drift.repairs.length - 12} more…
                </p>
              )}
            </div>

            {drift.unresolved.length > 0 && (
              <p className="text-[10px] font-mono text-amber-700 leading-relaxed">
                {drift.unresolved.length} unit{drift.unresolved.length === 1 ? ' has' : 's have'} a fragment with no
                recognised model code ({drift.unresolved.map(u => u.model).join(', ')}) — left untouched, name
                {drift.unresolved.length === 1 ? ' it' : ' these'} by hand. A guessed product name would be worse
                than a visible fragment.
              </p>
            )}

            <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
              Only the display model is rewritten — the original text stays on <code>rawModel</code> for provenance.
              Wi-Fi-only tablets have no IMEI in existence, so their serial is the correct identifier.
            </p>

            {failed && <p className="text-[11px] font-mono text-rose-600">{failed}</p>}

            {drift.repairs.length > 0 && (
              <button
                onClick={run}
                disabled={running}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-sky-700 disabled:opacity-50"
              >
                <Wand2 size={11} /> {running ? 'Renaming…' : `Rename ${drift.repairs.length} unit${drift.repairs.length === 1 ? '' : 's'}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ModelCatalogRepairPanel() {
  const { models } = useInventoryStore();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ updated: number; removed: number } | null>(null);
  const [failed, setFailed] = useState('');

  const drift = useMemo(
    () => findModelCatalogDrift((models as any[]).map(m => ({
      id: m.id, brand: m.brand, model: m.model, series: m.series,
    }))),
    [models],
  );

  const run = async () => {
    setRunning(true);
    setFailed('');
    try {
      setDone(await fixModelCatalog(drift, dbService));
    } catch (e: any) {
      setFailed(e?.message || 'Repair failed');
    } finally {
      setRunning(false);
    }
  };

  const total = drift.patches.length + drift.duplicates.length;
  if (total === 0 && done === null) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
          <Wand2 size={14} />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold tracking-tight">Model catalog brand split</h3>
          <p className="text-[10px] font-mono text-slate-400">
            Moves the brand out of the model name into its own column, and derives the series
          </p>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {done !== null ? (
          <p className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-700">
            <CheckCircle2 size={12} /> {done.updated} row{done.updated === 1 ? '' : 's'} repaired
            {done.removed > 0 && ` · ${done.removed} duplicate${done.removed === 1 ? '' : 's'} merged`}
          </p>
        ) : (
          <>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {drift.patches.slice(0, 12).map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-1.5">
                  <span className="text-[11px] font-mono text-slate-700 truncate">
                    “{p.before.model}” → <strong>{p.data.brand || '—'}</strong> · “{p.data.model}”
                  </span>
                  {p.data.series && (
                    <span className="text-[10px] font-mono text-violet-700 flex-shrink-0">{p.data.series}</span>
                  )}
                </div>
              ))}
              {drift.patches.length > 12 && (
                <p className="text-[10px] font-mono text-slate-400 px-3">
                  + {drift.patches.length - 12} more…
                </p>
              )}
            </div>

            {drift.duplicates.length > 0 && (
              <p className="text-[10px] font-mono text-amber-700 leading-relaxed">
                {drift.duplicates.length} row{drift.duplicates.length === 1 ? '' : 's'} become duplicates once split
                ({drift.duplicates.map(d => d.label).join(', ')}) — the extra copies are removed. Inventory is not
                affected; catalog entries only feed the Add Stock / Bulk Order pickers.
              </p>
            )}
            {drift.unbranded.length > 0 && (
              <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
                {drift.unbranded.length} row{drift.unbranded.length === 1 ? '' : 's'} have no recognisable brand
                ({drift.unbranded.map(u => u.model).join(', ')}) — these look like accessories added to the device
                catalog by mistake. They are left exactly as they are for you to remove by hand.
              </p>
            )}

            <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
              Storage fused into a model name is dropped (it belongs on the unit); connectivity like WiFi / 5G is kept.
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
              <Wand2 size={11} /> {running ? 'Repairing…' : `Repair ${drift.patches.length} catalog row${drift.patches.length === 1 ? '' : 's'}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

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

