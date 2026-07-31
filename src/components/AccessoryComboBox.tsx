import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Plus, Lock } from 'lucide-react';
import {
  buildAccessoryCatalog,
  accessoryEntryFor,
  searchAccessoryCatalog,
  type AccessoryCatalogEntry,
} from '../lib/accessoryCatalog';
import type { AccessoryStock } from '../types';

interface Props {
  /** Live accessory pools — these ARE the catalog (no separate seed
   *  collection exists for accessories, unlike devices' `models`). */
  accessories: AccessoryStock[];
  /** Current typed/picked text. */
  value: string;
  onValueChange: (v: string) => void;
  /** Fired when an EXISTING accessory is chosen — the caller should copy
   *  both sku and name off the entry so a top-up can't rename the pool. */
  onPick: (entry: AccessoryCatalogEntry) => void;
  /** Admin-only: the operator confirmed this really is a brand-new SKU.
   *  Receives the typed text; the caller unlocks its row for free entry. */
  onCreateNew?: (typed: string) => void;
  isAdmin?: boolean;
  /** Blur-validate the typed text against the catalog and revert it when
   *  it matches nothing. Defaults true. The caller turns this OFF for a row
   *  whose new SKU an admin has already approved via "+ Add" — that value
   *  is intentionally not in the catalog yet, so revalidating it would wipe
   *  the admin's own entry the next time the field loses focus. */
  strict?: boolean;
  placeholder?: string;
  inputClassName?: string;
}

/**
 * Strict picker over the existing accessory pools, deliberately mirroring
 * DeviceComboBox's contract so accessory intake behaves exactly like office
 * / SHS device intake:
 *
 *   - Employees can only PICK something that already exists. Typing an
 *     unrecognised SKU reverts to empty on blur with a red ring, same as
 *     the device picker.
 *   - Only an admin sees the "+ Add" pill that approves a genuinely new
 *     accessory SKU.
 *
 * This exists because accessory intake was previously free text with no
 * gate at all, which let the same product enter as several pools under
 * reordered names ("type c usb" vs "c type usb"). Matching is
 * order-insensitive (see normalizeAccessoryKey) so the existing pool is
 * actually findable no matter which way round the operator types it.
 */
export default function AccessoryComboBox({
  accessories,
  value,
  onValueChange,
  onPick,
  onCreateNew,
  isAdmin = false,
  strict = true,
  placeholder = 'Search accessories — e.g. USB-C 20W',
  inputClassName = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [invalid, setInvalid] = useState(false);
  // Fixed-position dropdown rect — the Add Stock modal's row list is
  // overflow-y-auto and would clip an absolutely-positioned panel. Same
  // approach DeviceComboBox uses for the identical reason.
  const [dropdownRect, setDropdownRect] = useState({ top: 0, left: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set in pick() before the programmatic blur so the blur validator knows
   *  not to run its stale-closure revert against an already-correct value. */
  const justPickedRef = useRef(false);

  const catalog = useMemo(() => buildAccessoryCatalog(accessories), [accessories]);
  const suggestions = useMemo(
    () => searchAccessoryCatalog(catalog, value, 8),
    [catalog, value],
  );

  const updateRect = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const MIN_DROPDOWN_WIDTH = 360;
    const width = Math.max(r.width, MIN_DROPDOWN_WIDTH);
    const maxLeft = window.innerWidth - width - 8;
    const left = Math.max(8, Math.min(r.left, maxLeft));
    setDropdownRect({ top: r.bottom, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open, updateRect]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (entry: AccessoryCatalogEntry) => {
    setInvalid(false);
    justPickedRef.current = true;
    onPick(entry);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onBlur = () => {
    if (!strict) return;
    if (justPickedRef.current) {
      justPickedRef.current = false;
      return;
    }
    // Deferred so a suggestion click lands before the revert runs.
    window.setTimeout(() => {
      const v = (value || '').trim();
      if (!v) { setInvalid(false); return; }
      if (accessoryEntryFor(catalog, v)) {
        setInvalid(false);
      } else {
        setInvalid(true);
        onValueChange('');
      }
    }, 150);
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

  const trimmed = (value || '').trim();

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => { onValueChange(e.target.value); setOpen(true); setHighlight(0); setInvalid(false); }}
          onFocus={() => { updateRect(); setOpen(true); }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`w-full px-2.5 py-1.5 pr-8 border rounded-lg text-[12px] focus:outline-none ${
            invalid
              ? 'border-rose-400 ring-1 ring-rose-200 bg-rose-50/40'
              : 'border-gray-200 focus:border-black'
          } ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => { updateRect(); setOpen(o => !o); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Show known accessories"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && dropdownRect.width > 0 && (
        <div
          style={{
            position: 'fixed',
            top: dropdownRect.top,
            left: dropdownRect.left,
            width: dropdownRect.width,
          }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          className="z-[9999] mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto"
        >
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-100 text-[10px] uppercase tracking-widest text-gray-500 font-mono">
            <Search size={11} />
            {trimmed && suggestions.length === 0
              ? `No matches in ${catalog.length} known accessor${catalog.length === 1 ? 'y' : 'ies'}`
              : `Known accessories (${catalog.length})`}
          </div>

          {suggestions.map((s, i) => (
            <button
              key={s.sku}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => pick(s)}
              className={`w-full text-left px-3 py-2 flex items-start justify-between gap-3 ${
                i === highlight ? 'bg-indigo-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-gray-900 truncate">{s.name}</p>
                <p className="text-[10px] text-gray-500 font-mono truncate">{s.sku}</p>
              </div>
              <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 ${
                s.quantity > 0 ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'
              }`}>
                {s.quantity > 0 ? `${s.quantity} in stock` : 'out'}
              </span>
            </button>
          ))}

          {/* Empty-search affordances — employees get a read-only hint,
              admins get the "+ Add" pill. Same split as DeviceComboBox. */}
          {suggestions.length === 0 && trimmed.length > 0 && (
            <div className="border-t border-gray-100">
              {isAdmin && onCreateNew ? (
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { justPickedRef.current = true; onCreateNew(trimmed); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100"
                >
                  <Plus size={12} />
                  Add "{trimmed}" as a new accessory
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-amber-700 bg-amber-50">
                  <Lock size={11} />
                  No match — ask an admin to add "{trimmed}".
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
