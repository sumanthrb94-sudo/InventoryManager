import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Plus, Lock } from 'lucide-react';
import {
  buildDeviceCatalog,
  catalogEntryFor,
  searchDeviceCatalog,
  type DeviceCatalogEntry,
  type ModelSeed,
} from '../lib/deviceCatalog';
import type { InventoryUnit } from '../types';

interface Props {
  units: InventoryUnit[];
  brand: string;
  model: string;
  onPick: (entry: DeviceCatalogEntry) => void;
  onModelChange: (model: string) => void;
  placeholder?: string;
  inputClassName?: string;
  /** Admin-curated seeds merged into the catalog so brand-new SKUs the
   *  admin has registered are pickable before any stock exists. */
  seeds?: ModelSeed[];
  /** Strict mode: free-text submission is blocked. The input's onBlur
   *  validates against the catalog; non-matching text reverts to the
   *  last valid pick and surfaces a red ring on the field. Defaults to
   *  false so legacy callers keep their free-text behaviour. */
  strict?: boolean;
  /** Gates the inline "+ Add new" affordance shown when the query has
   *  no matches. Employees see a "no match — ask admin" hint instead. */
  isAdmin?: boolean;
  /** Admin-only: write a brand-new entry into the models collection
   *  and auto-pick it. Receives the typed draft (brand, model) so the
   *  parent can split prefix/series however it likes. */
  onCreateModel?: (draft: { brand: string; model: string }) => Promise<DeviceCatalogEntry>;
}

// Combobox over the live device catalog. Two modes:
//   - permissive (default, strict=false): free text wins; the dropdown
//     is a suggestion only.
//   - strict (strict=true): selection is mandatory. The input's onBlur
//     validates against the catalog and reverts non-matching text. When
//     a search returns zero hits, employees see a muted "ask admin to
//     add this model" line; admins see a "+ Add 'query'" pill that
//     writes a new doc to the models collection on click.
export default function DeviceComboBox({
  units,
  brand,
  model,
  onPick,
  onModelChange,
  placeholder = 'e.g. iPhone 15 Pro Max  /  S21 FE 5G',
  inputClassName = '',
  seeds = [],
  strict = false,
  isAdmin = false,
  onCreateModel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [creating, setCreating] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const catalog = useMemo(() => buildDeviceCatalog(units, seeds), [units, seeds]);

  // Combine current brand + model into the search query so a user who
  // already has brand=Samsung and starts typing "s21" gets Samsung-only
  // suggestions ordered by stock count.
  const query = `${brand} ${model}`.trim();
  const suggestions = useMemo(
    () => searchDeviceCatalog(catalog, query, 8),
    [catalog, query],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (entry: DeviceCatalogEntry) => {
    setInvalid(false);
    onPick(entry);
    setOpen(false);
    inputRef.current?.blur();
  };

  /** Strict-mode blur validator. Deferred ~150ms so a suggestion click
   *  fires (its mouseup writes the state) BEFORE this runs — if we
   *  cleared the field synchronously the click's resulting onPick would
   *  be racing the revert. */
  const onBlur = () => {
    if (!strict) return;
    window.setTimeout(() => {
      // Don't fight a successful pick (or a still-open dropdown waiting
      // for one). If the input picked up a real catalog match by name in
      // the meantime, accept it; otherwise revert.
      const m = (model || '').trim();
      if (!m) { setInvalid(false); return; }
      const hit = catalogEntryFor(catalog, brand, m);
      if (hit) {
        setInvalid(false);
      } else {
        setInvalid(true);
        onModelChange('');
      }
    }, 150);
  };

  const handleCreate = async () => {
    if (!onCreateModel) return;
    const m = (model || '').trim();
    if (!m) return;
    setCreating(true);
    try {
      const entry = await onCreateModel({ brand: (brand || '').trim(), model: m });
      pick(entry);
    } catch (err) {
      console.warn('DeviceComboBox: create model failed', err);
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && open && suggestions[highlight]) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const trimmedQuery = (model || '').trim();

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={model}
          onChange={e => { onModelChange(e.target.value); setOpen(true); setHighlight(0); setInvalid(false); }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`w-full px-3 py-2 pr-9 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
            invalid
              ? 'border-rose-400 ring-1 ring-rose-200 bg-rose-50/40 focus:ring-rose-400'
              : 'border-gray-300 focus:ring-blue-500'
          } ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => { setOpen(o => !o); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Show known devices"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (suggestions.length > 0 || strict) && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 text-[10px] uppercase tracking-widest text-gray-500 font-mono">
            <Search size={11} />
            Known devices ({catalog.length})
          </div>
          {suggestions.map((s, i) => {
            const isActive = i === highlight;
            return (
              <button
                key={`${s.brand}|${s.model}`}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(s)}
                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 ${
                  isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">
                    <span className="text-gray-500">{s.brand}</span>
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span className="text-gray-900">{s.model}</span>
                  </p>
                  <p className="text-[10px] text-gray-500 truncate font-mono">
                    {s.storages.length ? `${s.storages.slice(0, 3).join(' · ')}` : 'no storage data'}
                    {s.colours.length ? ` · ${s.colours.slice(0, 2).join(', ')}` : ''}
                    {s.topGrade ? ` · grade ${s.topGrade}` : ''}
                    {s.medianBuyPrice ? ` · £${s.medianBuyPrice}` : ''}
                  </p>
                </div>
                <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 ${
                  s.source === 'seed'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {s.source === 'seed' ? 'new' : `${s.count} in stock`}
                </span>
              </button>
            );
          })}

          {/* Empty-search affordances in strict mode. Employees get a
              read-only "ask admin" hint. Admins get a "+ Add" pill that
              writes a new doc to the models collection via the parent's
              onCreateModel handler. */}
          {strict && suggestions.length === 0 && trimmedQuery.length > 0 && (
            <div className="border-t border-gray-100">
              {isAdmin && onCreateModel ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Plus size={12} />
                  {creating ? 'Adding…' : `Add "${trimmedQuery}" to the model catalog`}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-amber-700 bg-amber-50">
                  <Lock size={11} />
                  No match — ask an admin to add "{trimmedQuery}" to the catalog.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
