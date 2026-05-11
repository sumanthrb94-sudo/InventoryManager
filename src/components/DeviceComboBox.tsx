import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
  buildDeviceCatalog,
  searchDeviceCatalog,
  type DeviceCatalogEntry,
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
}

// Combobox over the live device catalog. Free text always wins — the
// dropdown is suggestions, not a constraint — so users can still type a
// device that doesn't exist in stock yet. Picking a suggestion fires
// onPick with the full catalog entry so the caller can also pre-fill
// storage / colour / grade hints.
export default function DeviceComboBox({
  units,
  brand,
  model,
  onPick,
  onModelChange,
  placeholder = 'e.g. iPhone 15 Pro Max  /  S21 FE 5G',
  inputClassName = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const catalog = useMemo(() => buildDeviceCatalog(units), [units]);

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
    onPick(entry);
    setOpen(false);
    inputRef.current?.blur();
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

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={model}
          onChange={e => { onModelChange(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`w-full px-3 py-2 pr-9 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${inputClassName}`}
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

      {open && suggestions.length > 0 && (
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
                <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-widest bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">
                  {s.count} in stock
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
