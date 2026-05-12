import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ColourBreakdown as ColourBreakdownEntry } from '../lib/unitGroups';

interface Props {
  colours: ColourBreakdownEntry[];
  /** Tailwind colour class for the active colour pill. Defaults to slate. */
  accentClass?: string;
  /** Optional click handler — called with the chosen colour entry. */
  onPickColour?: (entry: ColourBreakdownEntry) => void;
}

/**
 * Inline colour breakdown shown under a grouped unit row. Collapses to a
 * single "View by colour ▾" pill; expanding reveals one chip per colour
 * with its count. Clickable when onPickColour is supplied.
 *
 * Renders nothing if there's only one colour — no point breaking down a
 * single-colour group.
 */
export default function ColourBreakdown({
  colours,
  accentClass = 'bg-slate-900 text-white',
  onPickColour,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  if (colours.length <= 1) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors"
        aria-expanded={open}
      >
        View by colour
        <ChevronDown
          size={11}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <span className="ml-1 text-[9px] text-slate-400">({colours.length})</span>
      </button>

      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {colours.map(c => {
            const isActive = active === c.colour;
            const clickable = !!onPickColour;
            return (
              <button
                key={c.colour}
                type="button"
                disabled={!clickable}
                onClick={e => {
                  e.stopPropagation();
                  if (!clickable) return;
                  setActive(c.colour);
                  onPickColour!(c);
                }}
                className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-full border transition-all ${
                  isActive
                    ? `${accentClass} border-transparent`
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'
                } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                title={clickable ? `Filter to ${c.colour}` : c.colour}
              >
                <span className="font-semibold">{c.colour}</span>
                <span className="text-slate-400 font-mono">× {c.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
