// Bulk intake — capture stage.
//
// After Color Distribution defines (e.g.) Black ×10, Pink ×3, the
// operator picks ALL the photos for each colour in one go via the
// system multi-file picker. We OCR each in parallel, surface the
// IMEI per image with a confidence pill, let the operator edit /
// remove any tile, and only advance to Review once every slot is
// filled (or explicitly skipped).
//
// Output: one CapturedUnit per planned slot. Skipped slots get a
// deterministic fallback ID from the parent flow.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Upload, Loader2, X, Check,
  AlertCircle, Image as ImageIcon, Plus, SkipForward,
} from 'lucide-react';
import { performOCR } from '../../lib/ocr/ocrEngine';

export interface ColourGroup {
  colour: string;
  quantity: number;        // how many units of this colour expected
  startIndex: number;      // first planned-unit index in the batch
}

export interface PlannedUnit {
  index: number;
  colour: string;
  unitId: string;
}

export interface CapturedUnit {
  index: number;
  imei: string;
  previewUrl?: string;
  ocrConfidence?: number;
  skipped: boolean;
}

interface CapturedTile {
  status: 'ready' | 'processing' | 'failed';
  previewUrl: string;
  imei: string;
  confidence?: number;
  error?: string;
}

interface Props {
  plannedUnits: PlannedUnit[];
  baseImei: string;
  onSubmit: (captured: CapturedUnit[]) => void;
  onBack: () => void;
}

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export default function BatchImageCapture({
  plannedUnits,
  baseImei,
  onSubmit,
  onBack,
}: Props) {
  // Group planned units by colour, preserving batch order.
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

  // tiles[colour] = array of length `quantity`, each entry maybe-undefined.
  const [tiles, setTiles] = useState<Record<string, (CapturedTile | undefined)[]>>(() => {
    const init: Record<string, (CapturedTile | undefined)[]> = {};
    for (const g of colourGroups) init[g.colour] = Array(g.quantity).fill(undefined);
    return init;
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const totalSlots = plannedUnits.length;
  const filledSlots = useMemo(
    () => Object.values(tiles).reduce(
      (sum: number, arr: (CapturedTile | undefined)[]) => sum + arr.filter(Boolean).length,
      0,
    ),
    [tiles],
  );

  // Lazy per-colour file-input ref so the system picker only opens for
  // the colour the operator tapped.
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const pickFiles = (colour: string) => {
    const el = inputRefs.current[colour];
    if (el) {
      el.value = ''; // allow re-picking the same file later
      el.click();
    }
  };

  const handleFilesChosen = async (colour: string, fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    setError('');

    const group = colourGroups.find(g => g.colour === colour);
    if (!group) return;

    const existing = tiles[colour] || [];
    // First find the empty slot indices, in order. Fill those first.
    const emptyIndices: number[] = [];
    existing.forEach((t, i) => { if (!t) emptyIndices.push(i); });

    const files = Array.from(fileList);
    const acceptCount = Math.min(files.length, emptyIndices.length);
    if (files.length > emptyIndices.length) {
      setError(
        `Picked ${files.length} image${files.length !== 1 ? 's' : ''} but only ${emptyIndices.length} slot${emptyIndices.length !== 1 ? 's' : ''} left for ${colour}. Extras ignored.`,
      );
    }

    // Seed placeholders synchronously so the grid reflects the work in
    // progress, then OCR each one.
    const accepted = files.slice(0, acceptCount);
    const placeholderUrls = await Promise.all(accepted.map(fileToDataUrl));
    setTiles(prev => {
      const next = { ...prev };
      const arr = [...(next[colour] || [])];
      accepted.forEach((_, i) => {
        const slot = emptyIndices[i];
        arr[slot] = {
          status: 'processing',
          previewUrl: placeholderUrls[i],
          imei: '',
        };
      });
      next[colour] = arr;
      return next;
    });

    // Now OCR each in parallel; update tiles as each resolves.
    accepted.forEach((file, i) => {
      const slot = emptyIndices[i];
      performOCR(file)
        .then(result => {
          const detected = normaliseImei(result.device?.imei?.value || '');
          setTiles(prev => {
            const arr = [...(prev[colour] || [])];
            if (arr[slot]) {
              arr[slot] = {
                ...arr[slot]!,
                status: 'ready',
                imei: detected,
                confidence: result.confidence,
              };
            }
            return { ...prev, [colour]: arr };
          });
        })
        .catch(err => {
          console.warn('[BatchCapture] OCR failed:', err?.message);
          setTiles(prev => {
            const arr = [...(prev[colour] || [])];
            if (arr[slot]) {
              arr[slot] = {
                ...arr[slot]!,
                status: 'failed',
                imei: '',
                error: 'Couldn\'t read label; type IMEI or remove',
              };
            }
            return { ...prev, [colour]: arr };
          });
        });
    });
  };

  const removeTile = (colour: string, slot: number) => {
    setTiles(prev => {
      const arr = [...(prev[colour] || [])];
      arr[slot] = undefined;
      return { ...prev, [colour]: arr };
    });
    setError('');
  };

  const setTileImei = (colour: string, slot: number, value: string) => {
    setTiles(prev => {
      const arr = [...(prev[colour] || [])];
      if (arr[slot]) {
        arr[slot] = { ...arr[slot]!, imei: value.replace(/\D/g, '').slice(0, 17) };
      }
      return { ...prev, [colour]: arr };
    });
  };

  const handleSubmit = () => {
    setError('');
    // Build the CapturedUnit[] using the plannedUnits ordering.
    const captured: CapturedUnit[] = [];
    for (const g of colourGroups) {
      const arr = tiles[g.colour] || [];
      for (let i = 0; i < g.quantity; i++) {
        const t = arr[i];
        const planned = plannedUnits[g.startIndex + i];
        if (!t) {
          captured.push({ index: planned.index, imei: planned.unitId, skipped: true });
        } else {
          const trimmed = normaliseImei(t.imei);
          const finalImei =
            trimmed.length >= 14
              ? trimmed
              : baseImei
              ? `${normaliseImei(baseImei)}-${String(planned.index + 1).padStart(3, '0')}`
              : planned.unitId;
          captured.push({
            index: planned.index,
            imei: finalImei,
            previewUrl: t.previewUrl,
            ocrConfidence: t.confidence,
            skipped: false,
          });
        }
      }
    }
    // IMEI duplicate-within-batch check.
    const seen = new Map<string, number>();
    for (const c of captured) {
      const k = normaliseImei(c.imei);
      if (k && k.length >= 14) {
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k);
    if (dupes.length) {
      setError(`Duplicate IMEI${dupes.length > 1 ? 's' : ''} within batch: ${dupes.join(', ')}`);
      return;
    }
    setSubmitting(true);
    onSubmit(captured);
  };

  const [activeColourIdx, setActiveColourIdx] = useState(0);
  const activeGroup = colourGroups[activeColourIdx];
  const isLastColour = activeColourIdx >= colourGroups.length - 1;

  const handleSkipAll = () => {
    // Mark every empty slot as skipped explicitly. Tiles that already
    // have an image come through normally.
    handleSubmit();
  };

  const advanceColourOrSubmit = () => {
    setError('');
    if (isLastColour) {
      handleSubmit();
    } else {
      setActiveColourIdx(i => i + 1);
    }
  };

  const goPrevColour = () => {
    setError('');
    if (activeColourIdx === 0) onBack();
    else setActiveColourIdx(i => i - 1);
  };

  return (
    <div className="space-y-5">
      {/* Overall progress across every colour */}
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
        {/* Per-colour pip strip — shows which colours are complete */}
        <div className="flex items-center gap-1 pt-1">
          {colourGroups.map((g, i) => {
            const arr: (CapturedTile | undefined)[] = tiles[g.colour] || Array(g.quantity).fill(undefined);
            const filled = arr.filter(Boolean).length;
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

      {/* Active colour's section — focused, one at a time */}
      {(() => {
        const group = activeGroup;
        const arr: (CapturedTile | undefined)[] = tiles[group.colour] || Array(group.quantity).fill(undefined);
        const captured = arr.filter(Boolean).length;
        const remaining = group.quantity - captured;
        return (
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{group.colour}</p>
                <p className="text-[10px] font-mono text-gray-500">
                  {captured} of {group.quantity} captured
                  {remaining > 0 ? ` · ${remaining} remaining` : ' · complete'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => pickFiles(group.colour)}
                disabled={remaining <= 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex-shrink-0"
              >
                <Plus size={12} />
                Add images
              </button>
              <input
                ref={el => { inputRefs.current[group.colour] = el; }}
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={e => handleFilesChosen(group.colour, e.target.files)}
              />
            </div>

            {/* Grid of slots for this colour only */}
            <div className="p-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
              {arr.map((tile, slot) => (
                <CaptureTile
                  key={slot}
                  tile={tile}
                  onRemove={() => removeTile(group.colour, slot)}
                  onImeiChange={v => setTileImei(group.colour, slot, v)}
                />
              ))}
            </div>

            {remaining > 0 && captured === 0 && (
              <div className="px-4 pb-3 -mt-1">
                <p className="text-[10px] text-gray-500 leading-relaxed">
                  Pick all {group.quantity} {group.colour.toLowerCase()} unit photos at once — system will OCR each in parallel and you can edit any IMEI before continuing.
                </p>
              </div>
            )}
          </div>
        );
      })()}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={14} className="text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {/* Navigation — per-colour Prev/Next, final colour switches to Continue */}
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
          onClick={handleSkipAll}
          disabled={submitting}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
          title="Skip remaining empty slots in every colour and go to review"
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
interface CaptureTileProps {
  /** Undefined until the operator picks a photo for this slot. */
  tile: CapturedTile | undefined;
  onRemove: () => void;
  onImeiChange: (v: string) => void;
}

/**
 * One slot in the per-colour grid.
 *
 * Typed as React.FC rather than a bare function with an inline props
 * literal: the caller renders these in a .map and passes `key`, and only
 * a recognised component type picks up React's built-in `key` attribute.
 * With the inline literal TypeScript compared the JSX attributes against
 * the props object directly and rejected `key` as an unknown property.
 */
const CaptureTile: React.FC<CaptureTileProps> = ({
  tile,
  onRemove,
  onImeiChange,
}) => {
  if (!tile) {
    return (
      <div className="aspect-square border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-300">
        <ImageIcon size={20} />
      </div>
    );
  }
  return (
    <div className="aspect-square relative rounded-xl overflow-hidden bg-gray-100 group">
      <img src={tile.previewUrl} alt="" className="w-full h-full object-cover" />
      {tile.status === 'processing' && (
        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center text-white text-[10px] font-mono uppercase tracking-widest gap-1">
          <Loader2 size={16} className="animate-spin" />
          Reading…
        </div>
      )}
      {tile.status === 'ready' && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-1.5 space-y-0.5">
          <input
            type="text"
            inputMode="numeric"
            value={tile.imei}
            onChange={e => onImeiChange(e.target.value)}
            placeholder="IMEI"
            className="w-full text-[9px] font-mono text-white bg-transparent border-0 placeholder:text-white/40 focus:outline-none"
          />
          {tile.confidence != null && (
            <p className="text-[8px] font-mono text-emerald-300">
              OCR {Math.round(tile.confidence * 100)}%
            </p>
          )}
        </div>
      )}
      {tile.status === 'failed' && (
        <div className="absolute inset-x-0 bottom-0 bg-red-700/95 p-1">
          <input
            type="text"
            inputMode="numeric"
            value={tile.imei}
            onChange={e => onImeiChange(e.target.value)}
            placeholder="Type IMEI"
            className="w-full text-[9px] font-mono text-white bg-transparent border-0 placeholder:text-white/60 focus:outline-none"
          />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white p-1 rounded-full opacity-100 group-hover:opacity-100 transition-all"
        aria-label="Remove image"
      >
        <X size={10} />
      </button>
    </div>
  );
};
