/**
 * AccessoryCatalogPanel — admin list of "what accessories exist", the
 * accessory counterpart to the Models catalog above it.
 *
 * Why it's a separate list rather than rows in the Models catalog: Brand /
 * Model / Series is device vocabulary. An accessory has a SKU and a name
 * and nothing else, and forcing them into `models` is what put "generic",
 * "pins", "SIM PINS" and "Samsung Galaxy 25W ... Travel Adapter" into the
 * device catalog — where they also surfaced in the phone picker.
 *
 * There is no separate seed collection: the `accessoryStock` pools ARE the
 * catalog (see accessoryCatalog.ts). Registering an accessory here creates
 * its pool at quantity 0, which makes it immediately pickable in Add Stock →
 * Accessories so the first real intake tops up an agreed name instead of
 * inventing a second spelling.
 *
 * Two deliberate constraints:
 *   - SKU is fixed after creation. The Firestore doc id is derived from it
 *     (slugify), and every AccessoryStockEvent references that id, so
 *     "editing" a SKU would orphan the pool's whole ledger. Rename the
 *     display name instead.
 *   - Delete is only offered while the pool is empty. Removing a pool that
 *     holds stock would silently destroy it; adjust it to zero first via
 *     the Accessory Stock panel if that's really the intent.
 */
import React, { useMemo, useState } from 'react';
import { Package, Plus, Trash2, Edit3, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { useInventoryStore } from '../lib/inventoryStore';
import { registerAccessorySku } from '../services';
import { normalizeAccessoryKey } from '../lib/accessoryCatalog';
import type { AccessoryStock } from '../types';

/** Existing pool whose SKU or name collides with `text`, ignoring word
 *  order and punctuation — the same rule the intake picker matches on, so
 *  the catalog can't be seeded with a duplicate the picker would then
 *  treat as the same thing. Exported for direct testing. */
export function findAccessoryConflict(
  stock: Array<Pick<AccessoryStock, 'id' | 'sku' | 'name'>>,
  text: string,
  ignoreId?: string,
): { id: string; sku: string; name: string } | null {
  const key = normalizeAccessoryKey(text);
  if (!key) return null;
  return stock.find(a =>
    a.id !== ignoreId &&
    (normalizeAccessoryKey(a.sku) === key || normalizeAccessoryKey(a.name) === key)
  ) ?? null;
}

export default function AccessoryCatalogPanel() {
  const { accessoryStock } = useInventoryStore();
  const [draft, setDraft] = useState({ sku: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const sorted = useMemo(
    () => [...accessoryStock].sort((a, b) => (a.name || a.sku || '').localeCompare(b.name || b.sku || '')),
    [accessoryStock],
  );

  const add = async () => {
    if (saving) return;
    const sku = draft.sku.trim();
    const name = draft.name.trim();
    if (!sku)  { setError('SKU is required'); return; }
    if (!name) { setError('Name is required'); return; }

    const clash = findAccessoryConflict(accessoryStock, sku) ?? findAccessoryConflict(accessoryStock, name);
    if (clash) {
      setError(`Already in the catalog as “${clash.name}” (${clash.sku}) — top it up from Add Stock instead.`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const res = await registerAccessorySku({ sku, name });
      if (!res.ok) {
        setError(res.error === 'already_exists'
          ? 'That SKU already exists in the catalog.'
          : (res.error || 'Save failed'));
        return;
      }
      setDraft({ sku: '', name: '' });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveRename = async (a: AccessoryStock) => {
    const name = editName.trim();
    if (!name) { setError('Name is required'); return; }
    const clash = findAccessoryConflict(accessoryStock, name, a.id);
    if (clash) {
      setError(`“${name}” collides with the existing “${clash.name}” (${clash.sku}).`);
      return;
    }
    await dbService.update('accessoryStock', a.id, { name });
    setEditingId(null);
    setError('');
  };

  const remove = async (a: AccessoryStock) => {
    const ok = window.confirm(
      `Remove “${a.name}” (${a.sku}) from the accessory catalog?\n\n` +
      `It holds no stock, so nothing is lost. Employees will no longer be able to pick it in Add Stock.`
    );
    if (!ok) return;
    await dbService.delete('accessoryStock', a.id);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
          <Package size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold tracking-tight">Accessories Catalog</h3>
          <p className="text-[10px] font-mono text-slate-400">
            {sorted.length} {sorted.length === 1 ? 'accessory' : 'accessories'} · employees pick from this list
          </p>
        </div>
        {savedFlash && <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />}
      </div>

      {/* Add row — deliberately only SKU + name. Brand / model / series is
          device vocabulary; an accessory has neither, and forcing it into
          that shape is what put "generic" / "pins" / "SIM PINS" into the
          device Models catalog. Mirrors the Models add-row layout so the
          two read as the same kind of action. */}
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="md:col-span-4">
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">SKU *</label>
            <input
              value={draft.sku}
              onChange={e => setDraft(d => ({ ...d, sku: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="USB-C-20W"
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none focus:border-slate-900 bg-white"
            />
          </div>
          <div className="md:col-span-7">
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-500 block mb-1">Name *</label>
            <input
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="USB-C 20W Charger"
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-slate-900 bg-white"
            />
          </div>
          <div className="md:col-span-1 flex md:items-end">
            <button
              onClick={add}
              disabled={saving}
              className="w-full md:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 mt-1 md:mt-0 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40"
            >
              <Plus size={11} /> {saving ? '…' : 'Add'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-[10px] font-mono text-slate-500">
          No brand, model or series — an accessory only needs these two. Registered with no stock, pickable straight away.
        </p>
        {error && (
          <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-rose-600">
            <AlertCircle size={11} /> {error}
          </p>
        )}
        {savedFlash && (
          <p className="mt-2 inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700">
            <CheckCircle2 size={11} /> Added · live in Add Stock → Accessories now
          </p>
        )}
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <p className="px-5 py-6 text-[11px] font-mono text-slate-400 text-center">
          No accessories yet — add the first one above.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
          {sorted.map(a => {
            const empty = (a.quantity ?? 0) === 0;
            return (
              <div key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                {editingId === a.id ? (
                  <>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
                    />
                    <button
                      onClick={() => saveRename(a)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest flex-shrink-0"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setError(''); }}
                      className="p-1.5 text-gray-400 hover:text-gray-700 flex-shrink-0"
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-slate-900 truncate">{a.name || a.sku}</p>
                      <p className="text-[10px] font-mono text-slate-400 truncate">{a.sku}</p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 flex-shrink-0 ${
                      empty ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {empty ? 'no stock' : `${a.quantity} in stock`}
                    </span>
                    <button
                      onClick={() => { setEditingId(a.id); setEditName(a.name || ''); setError(''); }}
                      title="Rename — the SKU is fixed, it identifies this pool's history"
                      className="p-1.5 text-gray-300 hover:text-slate-700 flex-shrink-0"
                    >
                      <Edit3 size={13} />
                    </button>
                    <button
                      onClick={() => remove(a)}
                      disabled={!empty}
                      title={empty
                        ? 'Remove from the catalog'
                        : 'Holds stock — adjust it to zero from Accessory Stock first'}
                      className="p-1.5 text-gray-300 hover:text-rose-500 disabled:opacity-25 disabled:hover:text-gray-300 flex-shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
