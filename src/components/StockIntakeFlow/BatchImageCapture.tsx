// Batch image-capture step for bulk intake.
//
// After Color Distribution finalises N units (e.g. 8 phones split across
// colours), this screen walks the operator through each unit one at a
// time: scan or upload the label photo, OCR auto-fills the IMEI, operator
// confirms (or types a manual IMEI), tap Next, repeat. Skip-able per-unit
// for items without a usable label.
//
// Output: an array of CapturedUnit (one entry per planned unit) the
// parent flow can fold into the final InventoryUnit before save.

import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, Upload, Camera, Loader2, X, Check,
  AlertCircle, Image as ImageIcon, SkipForward,
} from 'lucide-react';
import { performOCR } from '../../lib/ocr/ocrEngine';

interface OCRProgressLike {
  stage: 'init' | 'recognize' | 'done' | string;
  progress: number;
  message?: string;
}

export interface PlannedUnit {
  index: number;        // 0-based position within the batch
  colour: string;       // assigned by Color Distribution
  unitId: string;       // deterministic id from the parent flow
}

export interface CapturedUnit {
  index: number;
  imei: string;
  previewUrl?: string;
  ocrConfidence?: number;
  skipped: boolean;
}

interface Props {
  plannedUnits: PlannedUnit[];
  baseImei: string;          // starting IMEI from DetailForm (used as fallback)
  onSubmit: (captured: CapturedUnit[]) => void;
  onBack: () => void;
}

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

export default function BatchImageCapture({
  plannedUnits,
  baseImei,
  onSubmit,
  onBack,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [captured, setCaptured] = useState<CapturedUnit[]>(() =>
    plannedUnits.map(u => ({
      index: u.index,
      // Fallback IMEI: <baseImei>-<seq> so the unit still has an
      // identifier even before the operator scans anything.
      imei: baseImei
        ? `${normaliseImei(baseImei)}-${String(u.index + 1).padStart(3, '0')}`
        : '',
      skipped: false,
    })),
  );
  const [imeiDraft, setImeiDraft] = useState('');
  const [preview, setPreview] = useState('');
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OCRProgressLike | null>(null);
  const [ocrError, setOcrError] = useState('');
  const [confidence, setConfidence] = useState<number | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentPlanned = plannedUnits[currentIndex];
  const currentCaptured = captured[currentIndex];
  const isLast = currentIndex === plannedUnits.length - 1;

  // Whenever the index changes, re-hydrate the local form from the
  // captured array — supports going Back and editing a prior unit.
  React.useEffect(() => {
    const c = captured[currentIndex];
    setImeiDraft(c?.imei || '');
    setPreview(c?.previewUrl || '');
    setConfidence(c?.ocrConfidence);
    setOcrError('');
    setOcrRunning(false);
    setOcrProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const pickFile = () => fileInputRef.current?.click();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setOcrError('Please pick an image file.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setOcrError('Image is larger than 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    setOcrError('');
    setOcrRunning(true);
    setOcrProgress({ stage: 'init', progress: 0 });

    try {
      const result = await performOCR(file, p =>
        setOcrProgress({ stage: 'recognize', progress: p / 100, message: `OCR ${p}%` } as any),
      );
      const detected = result.device?.imei?.value;
      if (detected) setImeiDraft(detected);
      setConfidence(result.confidence);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OCR failed';
      console.warn('[BatchImageCapture] OCR error:', msg);
      setOcrError('Couldn\'t read the label. You can still type the IMEI manually.');
    } finally {
      setOcrRunning(false);
    }
  };

  const commitCurrent = (markSkipped = false): boolean => {
    const next = [...captured];
    const trimmed = normaliseImei(imeiDraft);
    if (!markSkipped && trimmed && trimmed.length < 14) {
      setOcrError('IMEI should be 14 or 15 digits, or leave blank and skip.');
      return false;
    }
    next[currentIndex] = {
      ...next[currentIndex],
      imei: markSkipped ? captured[currentIndex].imei : (trimmed || captured[currentIndex].imei),
      previewUrl: preview || undefined,
      ocrConfidence: confidence,
      skipped: markSkipped,
    };
    setCaptured(next);
    return true;
  };

  const goNext = () => {
    if (!commitCurrent(false)) return;
    if (isLast) {
      onSubmit(captured.map((c, i) =>
        i === currentIndex
          ? { ...c, imei: normaliseImei(imeiDraft) || c.imei, previewUrl: preview || undefined, ocrConfidence: confidence, skipped: false }
          : c,
      ));
    } else {
      setCurrentIndex(i => i + 1);
    }
  };

  const goSkip = () => {
    commitCurrent(true);
    if (isLast) {
      const next = [...captured];
      next[currentIndex] = { ...next[currentIndex], skipped: true };
      onSubmit(next);
    } else {
      setCurrentIndex(i => i + 1);
    }
  };

  const goPrev = () => {
    commitCurrent(false);
    if (currentIndex === 0) onBack();
    else setCurrentIndex(i => i - 1);
  };

  const capturedCount = captured.filter(c => c.previewUrl && !c.skipped).length;
  const skippedCount = captured.filter(c => c.skipped).length;
  const progressPct = Math.round(((currentIndex + 1) / plannedUnits.length) * 100);

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      {/* Header — progress through the batch */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Unit {currentIndex + 1} of {plannedUnits.length}
          </p>
          <p className="text-[10px] font-mono text-gray-500">
            {capturedCount} captured · {skippedCount} skipped
          </p>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Color / unitId chip */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl">
        <ImageIcon size={14} className="text-gray-400" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">{currentPlanned.colour}</p>
          <p className="text-[10px] text-gray-400 font-mono truncate">{currentPlanned.unitId}</p>
        </div>
      </div>

      {/* Image area */}
      <AnimatePresence mode="wait">
        {!preview && !ocrRunning && (
          <motion.button
            key="picker"
            type="button"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={pickFile}
            className="w-full aspect-[4/3] border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-3 text-center hover:border-blue-400 hover:bg-blue-50/40 transition-all active:scale-[0.99]"
          >
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
              <Camera size={20} className="text-gray-500" />
            </div>
            <div>
              <p className="text-sm font-bold">Scan or upload</p>
              <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
                Camera roll or live shot
              </p>
            </div>
          </motion.button>
        )}

        {ocrRunning && (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="bg-gray-50 rounded-2xl p-5 space-y-3"
          >
            {preview && (
              <img src={preview} alt="" className="w-full max-h-48 object-contain bg-white rounded-xl" />
            )}
            <div className="flex items-center gap-3">
              <Loader2 size={16} className="animate-spin text-blue-600" />
              <p className="text-sm font-bold">
                {ocrProgress?.message || 'Reading label…'}
              </p>
            </div>
          </motion.div>
        )}

        {preview && !ocrRunning && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="relative">
              <img src={preview} alt="" className="w-full max-h-48 object-contain bg-gray-50 rounded-2xl" />
              <button
                type="button"
                onClick={() => { setPreview(''); setConfidence(undefined); }}
                className="absolute top-2 right-2 bg-black/70 text-white p-1.5 rounded-full"
                aria-label="Remove image"
              >
                <X size={12} />
              </button>
            </div>
            <button
              type="button"
              onClick={pickFile}
              className="w-full text-[11px] font-bold uppercase tracking-widest text-blue-600 py-2 rounded-lg border border-blue-200 hover:bg-blue-50"
            >
              <Upload size={12} className="inline mr-1" /> Re-scan
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* IMEI field */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
            IMEI
          </label>
          {confidence != null && (
            <span className="text-[9px] font-mono text-emerald-600">
              OCR {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
        <input
          type="text"
          inputMode="numeric"
          value={imeiDraft}
          onChange={e => { setImeiDraft(e.target.value); setOcrError(''); }}
          placeholder="14-15 digits, or use Skip"
          maxLength={20}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black"
        />
        {ocrError && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-red-600">
            <AlertCircle size={12} />
            {ocrError}
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={goPrev}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <ChevronLeft size={14} />
          {currentIndex === 0 ? 'Back' : 'Prev'}
        </button>

        <button
          type="button"
          onClick={goSkip}
          className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 flex items-center gap-1.5"
        >
          <SkipForward size={13} />
          Skip
        </button>

        <button
          type="button"
          onClick={goNext}
          className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
        >
          {isLast ? (
            <>
              <Check size={14} /> Confirm batch
            </>
          ) : (
            <>
              Next unit <ChevronRight size={14} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
