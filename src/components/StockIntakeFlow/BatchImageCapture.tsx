// Bulk intake — per-unit capture wizard.
//
// Step-through, one phone at a time. After Color Distribution defines
// (e.g.) Black ×3, Pink ×2, the operator works the line linearly:
//
//   Black · Unit 1 of 3 → take/upload photo → OCR → confirm → Next
//   Black · Unit 2 of 3 → ...
//   ...
//   Pink  · Unit 2 of 2 → ... → Continue to Review
//
// One image per unit. OCR fills IMEI + model + brand + storage +
// grade. The operator can edit any field (typically the IMEI) before
// confirming, or skip the current unit if a photo can't be taken.

import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Loader2, X, Check,
  AlertCircle, Camera, RefreshCcw, SkipForward,
} from 'lucide-react';
import { performOCR } from '../../lib/ocr/ocrEngine';

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
  model?: string;
  brand?: string;
  storage?: string;
  grade?: string;
  colour?: string;
}

interface CurrentTile {
  status: 'idle' | 'processing' | 'ready' | 'failed';
  previewUrl?: string;
  imei: string;
  confidence?: number;
  model?: string;
  brand?: string;
  storage?: string;
  grade?: string;
  ocrColour?: string;
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

const emptyTile = (): CurrentTile => ({ status: 'idle', imei: '' });

export default function BatchImageCapture({ plannedUnits, baseImei, onSubmit, onBack }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [captured, setCaptured]     = useState<Record<number, CapturedUnit>>({});
  const [tile, setTile]             = useState<CurrentTile>(emptyTile);
  const [error, setError]           = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef                = useRef<HTMLInputElement | null>(null);

  const total      = plannedUnits.length;
  const planned    = plannedUnits[currentIdx];
  const completed  = Object.keys(captured).length;
  const isLast     = currentIdx >= total - 1;

  // Per-colour position so the header reads "Black · Unit 2 of 3" for
  // the operator. We compute by walking the planned list — cheap, no
  // memo needed for sane batch sizes.
  const colourPosition = useMemo(() => {
    if (!planned) return { ofN: 0, totalN: 0 };
    let ofN = 0;
    let totalN = 0;
    for (let i = 0; i < plannedUnits.length; i++) {
      if (plannedUnits[i].colour === planned.colour) {
        totalN++;
        if (i <= currentIdx) ofN++;
      }
    }
    return { ofN, totalN };
  }, [planned, plannedUnits, currentIdx]);

  // When stepping to a new index, hydrate the tile state from any
  // already-captured value so the operator sees what they had before
  // (and can re-confirm or edit). On a fresh slot, reset to empty.
  React.useEffect(() => {
    const prev = captured[currentIdx];
    if (prev && !prev.skipped) {
      setTile({
        status:    'ready',
        previewUrl: prev.previewUrl,
        imei:      prev.imei,
        confidence: prev.ocrConfidence,
        model:     prev.model,
        brand:     prev.brand,
        storage:   prev.storage,
        grade:     prev.grade,
        ocrColour: prev.colour,
      });
    } else {
      setTile(emptyTile());
    }
    setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx]);

  const pickFile = () => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFile = async (file: File) => {
    setError('');
    const previewUrl = await fileToDataUrl(file);
    setTile({ status: 'processing', previewUrl, imei: '' });
    try {
      const result = await performOCR(file);
      const d = result.device;
      const detectedImei = normaliseImei(d?.imei?.value || '');
      const pickIf = (field?: { value: string; confidence: number }) =>
        field && field.confidence >= 0.6 && field.value.trim() ? field.value.trim() : undefined;
      setTile({
        status:    'ready',
        previewUrl,
        imei:      detectedImei,
        confidence: result.confidence,
        model:     pickIf(d?.model),
        brand:     pickIf(d?.brand),
        storage:   pickIf(d?.storage),
        grade:     pickIf(d?.grade),
        ocrColour: pickIf(d?.colour),
      });
    } catch (err: any) {
      console.warn('[BatchCapture] OCR failed:', err?.message);
      setTile({
        status:    'failed',
        previewUrl,
        imei:      '',
        error:     "Couldn't read label. Type the IMEI manually.",
      });
    }
  };

  const retake = () => {
    setTile(emptyTile());
    setError('');
  };

  const persistCurrent = (skipped: boolean): CapturedUnit => {
    const trimmed = normaliseImei(tile.imei);
    const finalImei = skipped
      ? planned.unitId
      : trimmed.length >= 14
        ? trimmed
        : baseImei
          ? `${normaliseImei(baseImei)}-${String(planned.index + 1).padStart(3, '0')}`
          : planned.unitId;
    const entry: CapturedUnit = skipped
      ? { index: planned.index, imei: planned.unitId, skipped: true }
      : {
          index: planned.index,
          imei: finalImei,
          previewUrl: tile.previewUrl,
          ocrConfidence: tile.confidence,
          skipped: false,
          model:   tile.model,
          brand:   tile.brand,
          storage: tile.storage,
          grade:   tile.grade,
          colour:  tile.ocrColour,
        };
    setCaptured(prev => ({ ...prev, [planned.index]: entry }));
    return entry;
  };

  const finalise = (afterCurrent: CapturedUnit) => {
    // Build the full ordered array, substituting the just-confirmed
    // entry for the current slot since React state batching may not
    // have flushed yet.
    const out: CapturedUnit[] = plannedUnits.map(p => {
      if (p.index === planned.index) return afterCurrent;
      return captured[p.index] || { index: p.index, imei: p.unitId, skipped: true };
    });
    // Within-batch IMEI duplicate guard — same rule as before.
    const seen = new Map<string, number>();
    for (const c of out) {
      const k = normaliseImei(c.imei);
      if (k && k.length >= 14) seen.set(k, (seen.get(k) || 0) + 1);
    }
    const dupes = Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k]) => k);
    if (dupes.length) {
      setError(`Duplicate IMEI${dupes.length > 1 ? 's' : ''} within batch: ${dupes.join(', ')}`);
      return;
    }
    setSubmitting(true);
    onSubmit(out);
  };

  const confirmAndNext = () => {
    if (tile.status === 'idle') {
      setError('Take or upload a photo first, or use Skip.');
      return;
    }
    if (tile.status === 'processing') {
      setError('OCR still running — wait for it to finish.');
      return;
    }
    const trimmed = normaliseImei(tile.imei);
    // OCR-failed path is allowed through if the operator typed an IMEI
    // manually; otherwise nudge them to type or skip.
    if (tile.status === 'failed' && trimmed.length < 14) {
      setError('Type a valid IMEI (≥14 digits) or click Skip.');
      return;
    }
    const entry = persistCurrent(false);
    if (isLast) {
      finalise(entry);
    } else {
      setCurrentIdx(i => i + 1);
    }
  };

  const skipCurrent = () => {
    const entry = persistCurrent(true);
    if (isLast) {
      finalise(entry);
    } else {
      setCurrentIdx(i => i + 1);
    }
  };

  const goPrev = () => {
    setError('');
    if (currentIdx === 0) {
      onBack();
      return;
    }
    setCurrentIdx(i => i - 1);
  };

  if (!planned) {
    return (
      <div className="text-sm text-gray-500">No planned units in this batch.</div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Overall progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            {planned.colour} · Unit {colourPosition.ofN} of {colourPosition.totalN}
          </p>
          <p className="text-[10px] font-mono text-gray-500">
            {completed} / {total} captured
          </p>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
          />
        </div>
        {/* Per-unit pip strip — operator can jump back to any prior unit */}
        <div className="flex items-center gap-1 pt-1 overflow-x-auto pb-1">
          {plannedUnits.map((p, i) => {
            const c = captured[p.index];
            const state = i === currentIdx
              ? 'active'
              : !c
                ? 'pending'
                : c.skipped
                  ? 'skipped'
                  : 'done';
            const cls =
              state === 'active'   ? 'bg-slate-900 text-white' :
              state === 'done'     ? 'bg-emerald-100 text-emerald-700' :
              state === 'skipped'  ? 'bg-gray-200 text-gray-500'        :
                                     'bg-gray-100 text-gray-400 hover:bg-gray-200';
            return (
              <button
                key={p.index}
                type="button"
                onClick={() => setCurrentIdx(i)}
                className={`flex-shrink-0 text-[9px] font-mono uppercase tracking-widest px-2 py-1 rounded transition-all ${cls}`}
                title={`${p.colour} · #${i + 1}${c ? (c.skipped ? ' · skipped' : ` · ${c.imei.slice(-6)}`) : ' · pending'}`}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            );
          })}
        </div>
      </div>

      {/* Image stage — one big drop-zone OR the captured preview */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <AnimatePresence mode="wait">
          {tile.status === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="aspect-[4/3] bg-gray-50 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-gray-100 transition"
              onClick={pickFile}
            >
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                <Camera size={22} />
              </div>
              <div className="text-center px-6">
                <p className="text-sm font-bold text-gray-800">Take or upload one photo</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Aim at the device's IMEI / model label. We'll OCR it.
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); pickFile(); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700"
              >
                Open camera / picker
              </button>
            </motion.div>
          )}

          {(tile.status === 'processing' || tile.status === 'ready' || tile.status === 'failed') && (
            <motion.div
              key="captured"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-[3fr_4fr]"
            >
              {/* Left: image preview */}
              <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[260px] bg-black">
                {tile.previewUrl && (
                  <img src={tile.previewUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                )}
                {tile.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white text-[10px] font-mono uppercase tracking-widest gap-1.5">
                    <Loader2 size={20} className="animate-spin" />
                    Reading label…
                  </div>
                )}
              </div>

              {/* Right: detected fields */}
              <div className="p-4 space-y-3 bg-white">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    Detected
                  </p>
                  {tile.confidence != null && (
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      tile.confidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      OCR {Math.round(tile.confidence * 100)}%
                    </span>
                  )}
                </div>

                {/* IMEI — primary editable field */}
                <div>
                  <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-1">
                    IMEI
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tile.imei}
                    onChange={e => setTile(t => ({ ...t, imei: e.target.value.replace(/\D/g, '').slice(0, 17) }))}
                    placeholder={tile.status === 'failed' ? 'Type IMEI manually' : '14-15 digits'}
                    className={`w-full px-3 py-2 text-sm font-mono rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      tile.status === 'failed' && tile.imei.length < 14 ? 'border-red-300 bg-red-50' : 'border-gray-200'
                    }`}
                    autoFocus={tile.status === 'failed' || (tile.status === 'ready' && !tile.imei)}
                  />
                </div>

                {/* Other detected fields — read-only here; full editing
                 * happens on the Review screen. Showing them gives the
                 * operator a quick "did OCR get it right" sanity check. */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <FieldRow label="Model"   value={tile.model} />
                  <FieldRow label="Brand"   value={tile.brand} />
                  <FieldRow label="Storage" value={tile.storage} />
                  <FieldRow label="Grade"   value={tile.grade} />
                </div>

                {tile.status === 'failed' && tile.error && (
                  <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle size={12} className="text-red-600 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] text-red-700">{tile.error}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={retake}
                  className="w-full flex items-center justify-center gap-1.5 py-2 border border-gray-200 rounded-lg text-[11px] font-mono uppercase tracking-widest text-gray-600 hover:bg-gray-50"
                >
                  <RefreshCcw size={11} />
                  Retake / pick different image
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
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
          onClick={goPrev}
          disabled={submitting}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <ChevronLeft size={14} />
          {currentIdx === 0 ? 'Back' : 'Prev unit'}
        </button>

        <button
          type="button"
          onClick={skipCurrent}
          disabled={submitting}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
          title="Skip this unit and continue"
        >
          <SkipForward size={13} />
          Skip
        </button>

        <button
          type="button"
          onClick={confirmAndNext}
          disabled={submitting || tile.status === 'processing'}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting
            ? <><Loader2 size={14} className="animate-spin" /> Processing…</>
            : isLast
              ? <><Check size={14} /> Confirm & Continue to Review</>
              : <>Confirm & Next Unit <ChevronRight size={14} /></>}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="px-2 py-1.5 bg-gray-50 rounded">
      <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-[11px] font-mono mt-0.5 truncate ${value ? 'text-gray-800' : 'text-gray-300'}`}>
        {value || '—'}
      </p>
    </div>
  );
}
