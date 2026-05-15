// Bulk intake — per-unit IMEI capture (manual entry + optional camera scan).
//
// Replaces the previous image/OCR-based capture step. After Color
// Distribution defines (e.g.) Black ×10, Pink ×3, the operator types
// (or scans) each IMEI directly into a slot. Empty slots fall back to
// the deterministic unitId from the parent flow on submit.

import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Loader2, Check, AlertCircle,
  Camera, X, SkipForward,
} from 'lucide-react';
import IMEIScanner from '../IMEIScanner';

export interface ColourGroup {
  colour: string;
  quantity: number;
  startIndex: number;
}

export interface PlannedUnit {
  index: number;
  colour: string;
  unitId: string;
}

export interface CapturedUnit {
  index: number;
  imei: string;
  skipped: boolean;
}

interface Props {
  plannedUnits: PlannedUnit[];
  baseImei: string;
  onSubmit: (captured: CapturedUnit[]) => void;
  onBack: () => void;
}

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

export default function BatchIMEIEntry({
  plannedUnits,
  baseImei,
  onSubmit,
  onBack,
}: Props) {
  const colourGroups = useMemo<ColourGroup[]>(() => {
    const groups: ColourGroup[] = [];
    for (let i = 0; i < plannedUnits.length; i++) {
      const last = groups[groups.length - 1];
      if (last && last.colour === plannedUnits[i].colour) {
        last.quantity++;
      } else {
        groups.push({ colour: plannedUnits[i].colour, quantity: 1, startIndex: i });
      }
    }
    return groups;
  }, [plannedUnits]);

  // imeis[colour] = array of typed IMEIs, one per slot.
  const [imeis, setImeis] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const g of colourGroups) init[g.colour] = Array(g.quantity).fill('');
    return init;
  });
  const [activeColourIdx, setActiveColourIdx] = useState(0);
  const [scanTarget, setScanTarget] = useState<{ colour: string; slot: number } | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRefs = useRef<Record<string, (HTMLInputElement | null)[]>>({});

  const totalSlots = plannedUnits.length;
  const filledSlots = useMemo(
    () => Object.values(imeis).reduce<number>(
      (sum, arr: string[]) => sum + arr.filter(v => normaliseImei(v).length >= 14).length,
      0,
    ),
    [imeis],
  );

  const activeGroup = colourGroups[activeColourIdx];
  const isLastColour = activeColourIdx >= colourGroups.length - 1;

  const setSlot = (colour: string, slot: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 17);
    setImeis(prev => {
      const arr = [...(prev[colour] || [])];
      arr[slot] = cleaned;
      return { ...prev, [colour]: arr };
    });
    if (error) setError('');
  };

  const handleScanResult = (value: string) => {
    if (!scanTarget) return;
    const digits = normaliseImei(value);
    if (digits.length >= 14) {
      setSlot(scanTarget.colour, scanTarget.slot, digits);
      // Advance focus to next empty slot in the same colour
      const arr = imeis[scanTarget.colour] || [];
      const nextEmpty = arr.findIndex((v, i) => i > scanTarget.slot && normaliseImei(v).length < 14);
      const target = nextEmpty >= 0 ? nextEmpty : -1;
      setScanTarget(null);
      if (target >= 0) {
        setTimeout(() => {
          inputRefs.current[scanTarget.colour]?.[target]?.focus();
        }, 100);
      }
    } else {
      setError(`Scanned value "${value}" needs at least 14 digits`);
    }
  };

  const buildCaptured = (): CapturedUnit[] => {
    const captured: CapturedUnit[] = [];
    for (const g of colourGroups) {
      const arr = imeis[g.colour] || [];
      for (let i = 0; i < g.quantity; i++) {
        const planned = plannedUnits[g.startIndex + i];
        const typed = normaliseImei(arr[i] || '');
        if (typed.length >= 14) {
          captured.push({ index: planned.index, imei: typed, skipped: false });
        } else {
          // Empty — fall back to baseImei sequence or the deterministic unitId.
          const baseClean = normaliseImei(baseImei);
          const fallback = baseClean
            ? `${baseClean}-${String(planned.index + 1).padStart(3, '0')}`
            : planned.unitId;
          captured.push({ index: planned.index, imei: fallback, skipped: true });
        }
      }
    }
    return captured;
  };

  const handleSubmit = () => {
    setError('');
    const captured = buildCaptured();

    // Duplicate IMEI within batch
    const seen = new Map<string, number>();
    for (const c of captured) {
      const k = normaliseImei(c.imei);
      if (k && k.length >= 14) seen.set(k, (seen.get(k) || 0) + 1);
    }
    const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k);
    if (dupes.length) {
      setError(`Duplicate IMEI${dupes.length > 1 ? 's' : ''} within batch: ${dupes.join(', ')}`);
      return;
    }

    setSubmitting(true);
    onSubmit(captured);
  };

  const advanceColourOrSubmit = () => {
    setError('');
    if (isLastColour) handleSubmit();
    else setActiveColourIdx(i => i + 1);
  };

  const goPrevColour = () => {
    setError('');
    if (activeColourIdx === 0) onBack();
    else setActiveColourIdx(i => i - 1);
  };

  if (scanTarget) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Scan IMEI</p>
            <p className="text-[10px] text-gray-400 font-mono">
              {scanTarget.colour} · slot {scanTarget.slot + 1}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setScanTarget(null)}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
            aria-label="Close scanner"
          >
            <X size={16} />
          </button>
        </div>
        <IMEIScanner
          onScan={handleScanResult}
          onError={msg => setError(msg)}
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}
      </div>
    );
  }

  const arr = imeis[activeGroup.colour] || Array(activeGroup.quantity).fill('');
  const filledInGroup = arr.filter(v => normaliseImei(v).length >= 14).length;
  const remaining = activeGroup.quantity - filledInGroup;

  return (
    <div className="space-y-5">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Colour {activeColourIdx + 1} of {colourGroups.length}
          </p>
          <p className="text-[10px] font-mono text-gray-500">
            {filledSlots} / {totalSlots} captured overall
          </p>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${totalSlots ? (filledSlots / totalSlots) * 100 : 0}%` }}
          />
        </div>
        <div className="flex items-center gap-1 pt-1">
          {colourGroups.map((g, i) => {
            const groupArr = imeis[g.colour] || [];
            const filled = groupArr.filter(v => normaliseImei(v).length >= 14).length;
            const complete = filled === g.quantity;
            const active = i === activeColourIdx;
            return (
              <button
                key={g.colour}
                type="button"
                onClick={() => { setActiveColourIdx(i); setError(''); }}
                className={`flex-1 text-[9px] font-mono uppercase tracking-widest px-1.5 py-1 rounded transition-all truncate ${
                  active
                    ? 'bg-slate-900 text-white'
                    : complete
                    ? 'bg-emerald-100 text-emerald-700'
                    : filled > 0
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
                title={`${g.colour} — ${filled}/${g.quantity}`}
              >
                {g.colour} {filled}/{g.quantity}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active colour section */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
          <div className="min-w-0">
            <p className="text-sm font-bold truncate">{activeGroup.colour}</p>
            <p className="text-[10px] font-mono text-gray-500">
              {filledInGroup} of {activeGroup.quantity} captured
              {remaining > 0 ? ` · ${remaining} remaining` : ' · complete'}
            </p>
          </div>
        </div>

        <div className="p-3 space-y-2">
          {arr.map((value, slot) => {
            const digits = normaliseImei(value);
            const ok = digits.length >= 14;
            const planned = plannedUnits[activeGroup.startIndex + slot];
            return (
              <div key={slot} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-gray-400 w-6 text-right tabular-nums">
                  {String(slot + 1).padStart(2, '0')}
                </span>
                <input
                  ref={el => {
                    if (!inputRefs.current[activeGroup.colour]) {
                      inputRefs.current[activeGroup.colour] = [];
                    }
                    inputRefs.current[activeGroup.colour][slot] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={value}
                  onChange={e => setSlot(activeGroup.colour, slot, e.target.value)}
                  onFocus={e => e.target.select()}
                  placeholder={`IMEI for unit ${planned.index + 1}`}
                  className={`flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 ${
                    ok
                      ? 'border-emerald-300 bg-emerald-50/50 focus:ring-emerald-500'
                      : value
                      ? 'border-amber-300 bg-amber-50/50 focus:ring-amber-500'
                      : 'border-gray-300 focus:ring-blue-500'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setScanTarget({ colour: activeGroup.colour, slot })}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 active:bg-gray-100 flex-shrink-0"
                  aria-label="Scan IMEI"
                  title="Scan with camera"
                >
                  <Camera size={14} />
                </button>
              </div>
            );
          })}
        </div>

        {remaining > 0 && filledInGroup === 0 && (
          <div className="px-4 pb-3 -mt-1">
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Type each IMEI or tap the camera to scan. Empty slots will be
              auto-numbered from the starting IMEI on Review.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={goPrevColour}
          disabled={submitting}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <ChevronLeft size={14} />
          {activeColourIdx === 0 ? 'Back' : 'Prev colour'}
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
          title="Skip remaining empty slots and go to review"
        >
          <SkipForward size={13} />
          Skip rest
        </button>

        <button
          type="button"
          onClick={advanceColourOrSubmit}
          disabled={submitting}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting
            ? <><Loader2 size={14} className="animate-spin" /> Processing…</>
            : isLastColour
            ? <><Check size={14} /> Continue to Review</>
            : <>Next colour <ChevronRight size={14} /></>}
        </button>
      </div>
    </div>
  );
}
