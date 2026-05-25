/**
 * BulkOrderModal — three-step bulk stock-in flow tuned for hardware-scanner
 * throughput. Operator's worst-case is ~100 units per delivery; this flow
 * keeps that under 5 minutes by:
 *
 *   1. Doing ALL the per-unit shared metadata once on the Setup screen
 *      (date, model, storage, grade, BP, supplier, per-colour quantities).
 *      Scanning starts from a fully-prepared queue of empty slots so the
 *      operator's hands never leave the scanner.
 *
 *   2. Auto-advancing the focused scan input on every successful Enter.
 *      Hardware barcode scanners typically type the IMEI then send Enter —
 *      this flow consumes that keystream verbatim, validates inline against
 *      the live inventory cache (no DB round-trip per scan), and jumps to
 *      the next empty slot. Skip key (Esc) marks a slot pending without
 *      breaking the rhythm.
 *
 *   3. Showing the full slot list in Review with inline edits so a
 *      mis-scanned slot can be corrected in one click. Save is a single
 *      bulkCreate batch — every unit lands with the same batchId so the
 *      Audit trail groups them.
 *
 * Office mode requires every slot have an IMEI before save; SHS mode lets
 * slots stay empty (they become incoming/SHS placeholders the operator
 * fills in on Receive).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Plus, Trash2, CheckCircle2, AlertCircle, ScanLine, ChevronRight,
  Loader2, Truck, PackagePlus, Camera, ArrowLeft, Edit2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { ensureSupplier } from '../services';
import { logInventoryEvent } from '../lib/inventoryEvents';
import DeviceComboBox from './DeviceComboBox';
import IMEIScanner from './IMEIScanner';
import type { InventoryUnit, ListingSite } from '../types';

type Mode = 'office' | 'shs';
type Stage = 'setup' | 'scan' | 'review' | 'saving' | 'done';

interface ColourBucket {
  id: string;
  /** Either one of the four presets or operator-typed freeform text. */
  colour: string;
  quantity: number;
}

interface UnitSlot {
  id: string;
  /** Index in the originating colour bucket (used purely for display
   *  grouping; the bucket's name lives on `colour` for save-time
   *  convenience). */
  colour: string;
  imei: string;
  /** Per-unit BP override; defaults to the batch BP when blank. */
  bpOverride: string;
  notes: string;
  /** Operator marked this slot as "skip" — no IMEI required, the unit
   *  is still queued for save (Office mode) but visibly flagged on
   *  Review so they can decide whether to delete or fill it. */
  skipped?: boolean;
}

const COLOUR_PRESETS = ['Black', 'White', 'Grey', 'Blue'] as const;
const GRADES = ['A', 'B', 'C', 'ONU', 'Brand new'] as const;
const STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB'] as const;

const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().split('T')[0];

interface Props { onClose: () => void; initialMode?: Mode; }

export default function BulkOrderModal({ onClose, initialMode = 'office' }: Props) {
  const { units, suppliers } = useInventoryStore();

  // ── Stage + shared form state ──────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>('setup');
  const [mode, setMode] = useState<Mode>(initialMode);
  const [date, setDate] = useState(today());
  const [model, setModel] = useState('');
  const [storage, setStorage] = useState('');
  const [grade, setGrade] = useState('');
  const [bp, setBp] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [colourBuckets, setColourBuckets] = useState<ColourBucket[]>([
    { id: uid(), colour: 'Black', quantity: 0 },
  ]);

  // ── Per-unit slots (built when leaving Setup) ──────────────────────────────
  const [slots, setSlots] = useState<UnitSlot[]>([]);
  const [activeSlotIdx, setActiveSlotIdx] = useState(0);
  const [scanInput, setScanInput] = useState('');
  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanDebounceRef = useRef<number | null>(null);
  const [scanError, setScanError] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [reviewEditing, setReviewEditing] = useState<string | null>(null);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [savedCount, setSavedCount] = useState(0);

  // ── Derived: live IMEI dup-check cache ─────────────────────────────────────
  const existingByImei = useMemo(() => {
    const m = new Map<string, InventoryUnit>();
    for (const u of units) {
      if (!u.imei) continue;
      const key = u.imei.trim().toUpperCase();
      if (key && !m.has(key)) m.set(key, u);
    }
    return m;
  }, [units]);

  const supplierNames = useMemo(() => suppliers.map(s => s.name), [suppliers]);

  // ── Setup validation ───────────────────────────────────────────────────────
  const setupValidation = useMemo(() => {
    const modelOk    = model.trim().length > 0;
    const supplierOk = supplierName.trim().length > 0;
    const storageOk  = storage.trim().length > 0;
    const bpNum      = parseFloat(bp);
    const bpOk       = Number.isFinite(bpNum) && bpNum > 0;
    const totalQty   = colourBuckets.reduce((s, b) => s + (b.quantity || 0), 0);
    const bucketsOk  = totalQty > 0 && colourBuckets.every(b =>
      b.colour.trim().length > 0 && b.quantity > 0
    );
    return { modelOk, supplierOk, storageOk, bpOk, bucketsOk, totalQty, complete: modelOk && supplierOk && storageOk && bpOk && bucketsOk };
  }, [model, supplierName, storage, bp, colourBuckets]);

  // ── Auto-focus scan input whenever activeSlotIdx / stage changes ───────────
  useEffect(() => {
    if (stage === 'scan' && !showCamera) {
      // setTimeout avoids fighting framer-motion's enter transition.
      const t = setTimeout(() => scanInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [stage, activeSlotIdx, showCamera]);

  // ── Setup → Scan: hydrate slots from buckets ───────────────────────────────
  const goToScan = useCallback(() => {
    if (!setupValidation.complete) return;
    const built: UnitSlot[] = [];
    for (const b of colourBuckets) {
      for (let i = 0; i < b.quantity; i++) {
        built.push({
          id: uid(),
          colour: b.colour.trim(),
          imei: '',
          bpOverride: '',
          notes: '',
        });
      }
    }
    setSlots(built);
    setActiveSlotIdx(0);
    setScanInput('');
    setScanError('');
    setStage('scan');
  }, [colourBuckets, setupValidation.complete]);

  // ── Scan submit handler — the throughput-critical path ─────────────────────
  // Called from three entry points:
  //   1. Hardware scanners that send Enter after the value (onKeyDown handler)
  //   2. Hardware scanners that DON'T send Enter — auto-submit kicks in 150ms
  //      after the last keystroke once the buffered value looks like a
  //      complete IMEI (scanInputAutoSubmit below)
  //   3. The camera-based IMEIScanner onScan callback
  // All paths validate inline against the in-memory store cache so the
  // operator never waits on a network round-trip per scan.
  const handleScanSubmit = useCallback((raw: string) => {
    const imei = raw.replace(/\s+/g, '').trim().toUpperCase();
    if (!imei) return;
    const appleDevice = isAppleDevice(model);
    if (!isValidImei(imei, { isAppleSerial: appleDevice })) {
      setScanError(`Invalid IMEI format${appleDevice ? ' (15-digit IMEI or 10-12 char Apple serial)' : ' (15 digits)'}`);
      return;
    }
    // Duplicate against units already scanned in THIS batch.
    if (slots.some((s, i) => i !== activeSlotIdx && s.imei.trim().toUpperCase() === imei)) {
      setScanError(`IMEI ${imei} already in this batch`);
      return;
    }
    // Duplicate against live inventory.
    const dbMatch = existingByImei.get(imei);
    if (dbMatch) {
      setScanError(`IMEI ${imei} already in inventory · ${dbMatch.model || '?'} · ${dbMatch.dateIn || '?'} · ${dbMatch.status}`);
      return;
    }
    // Apply + advance.
    setSlots(prev => {
      const next = [...prev];
      next[activeSlotIdx] = { ...next[activeSlotIdx], imei, skipped: false };
      return next;
    });
    setScanError('');
    setScanInput('');
    advanceToNextEmptySlot();
  }, [model, slots, activeSlotIdx, existingByImei]);

  /** Walk forward from the current slot to find the next empty (or skipped)
   *  one. If none is found, wrap around to find any empty slot. If still
   *  none, leave activeSlotIdx at the last slot so the operator's next
   *  Enter doesn't accidentally land elsewhere. */
  const advanceToNextEmptySlot = useCallback(() => {
    setActiveSlotIdx(prevIdx => {
      const total = slots.length;
      for (let i = 1; i <= total; i++) {
        const candidate = (prevIdx + i) % total;
        if (!slots[candidate].imei) return candidate;
      }
      return prevIdx;
    });
  }, [slots]);

  /** Scanner-friendly onChange: every keystroke updates state, AND if the
   *  buffered value already matches a valid IMEI shape, schedule an
   *  auto-submit 150ms later. Most hardware scanners pipe the whole code
   *  in under 50ms so the debounce fires once the burst stops; a manual
   *  typist can still type past the threshold and Enter normally without
   *  triggering the auto-submit because each new keystroke resets the
   *  timer and the value won't be IMEI-valid until they're done. */
  const handleScanInputChange = useCallback((val: string) => {
    setScanInput(val);
    if (scanError) setScanError('');
    if (scanDebounceRef.current !== null) {
      window.clearTimeout(scanDebounceRef.current);
      scanDebounceRef.current = null;
    }
    const cleaned = val.replace(/\s+/g, '').trim();
    const appleDevice = isAppleDevice(model);
    if (isValidImei(cleaned, { isAppleSerial: appleDevice })) {
      scanDebounceRef.current = window.setTimeout(() => {
        scanDebounceRef.current = null;
        // Re-read latest value from the ref so a slower typist can keep
        // adding chars beyond the minimum length without us cutting them off.
        const live = scanInputRef.current?.value ?? val;
        if (live === val) handleScanSubmit(val);
      }, 150);
    }
  }, [model, scanError, handleScanSubmit]);

  // Clear the pending auto-submit timer on unmount / stage change to avoid
  // firing into a stale closure after the user navigates away mid-scan.
  useEffect(() => () => {
    if (scanDebounceRef.current !== null) {
      window.clearTimeout(scanDebounceRef.current);
      scanDebounceRef.current = null;
    }
  }, [stage]);

  // ── Scan: skip current slot ────────────────────────────────────────────────
  const skipCurrentSlot = () => {
    setSlots(prev => {
      const next = [...prev];
      next[activeSlotIdx] = { ...next[activeSlotIdx], skipped: true };
      return next;
    });
    setScanInput('');
    setScanError('');
    advanceToNextEmptySlot();
  };

  // ── Scan: jump to a specific slot by clicking on it ────────────────────────
  const jumpToSlot = (idx: number) => {
    setActiveSlotIdx(idx);
    setScanInput('');
    setScanError('');
  };

  // ── Review validation ──────────────────────────────────────────────────────
  const reviewValidation = useMemo(() => {
    const totalSlots = slots.length;
    const filled = slots.filter(s => s.imei.trim().length > 0).length;
    const skipped = slots.filter(s => s.skipped && !s.imei.trim()).length;
    const requiredFilled = mode === 'office' ? (filled + skipped === totalSlots) : true;
    const dupes: Set<string> = new Set();
    const seen: Map<string, number> = new Map();
    for (const s of slots) {
      const k = s.imei.trim().toUpperCase();
      if (!k) continue;
      const prev = seen.get(k);
      if (prev !== undefined) dupes.add(k);
      else seen.set(k, 1);
    }
    const hasInFlightDupes = dupes.size > 0;
    return { totalSlots, filled, skipped, requiredFilled, hasInFlightDupes, dupes };
  }, [slots, mode]);

  const canSave = stage === 'review'
    && reviewValidation.totalSlots > 0
    && !reviewValidation.hasInFlightDupes
    && (mode === 'shs' || reviewValidation.requiredFilled);

  // ── Save → bulkCreate ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setStage('saving');
    setError('');
    try {
      const supplierId = await ensureSupplier(supplierName.trim());
      const parsed = parseBrandModelStorage(model);
      const cleanModel = parsed.model || model.trim();
      const brand = parsed.brand !== 'Other' ? parsed.brand : 'Other';
      const series = parsed.series;
      const baseBp = parseFloat(bp) || 0;
      const batchId = `bulk_${mode}_${Date.now()}`;
      const createdAt = new Date().toISOString();

      // Build doc payloads.
      const docs: { collection: string; id: string; data: any }[] = [];
      for (const s of slots) {
        const hasImei = s.imei.trim().length > 0;
        const finalImei = hasImei ? s.imei.trim().toUpperCase() : '';
        const slotBp = s.bpOverride.trim() ? (parseFloat(s.bpOverride) || baseBp) : baseBp;
        // Office: doc id is the IMEI when present so re-imports upsert
        // cleanly. SHS placeholder slots (no IMEI) get a synthetic id.
        const id = finalImei
          || `${mode === 'shs' ? 'bulk_shs' : 'bulk_manual'}_${Date.now()}_${s.id}`;
        const data: any = {
          id,
          imei: finalImei,
          model: cleanModel,
          brand,
          category: detectCategory(model),
          colour: s.colour || 'Unknown',
          ...(storage ? { storage } : {}),
          ...(series ? { series } : {}),
          ...(grade ? { grade } : {}),
          buyPrice: slotBp,
          dateIn: date,
          supplierId,
          supplierName: supplierName.trim(),
          batchId,
          status: mode === 'office' ? 'available' : 'incoming',
          ...(mode === 'shs' ? { statusRaw: 'SHS — Bulk' } : {}),
          flags: [],
          notes: s.notes.trim() || (mode === 'shs' ? 'SHS — Awaiting delivery' : ''),
          platformListed: false,
          listingSites: [] as ListingSite[],
          ownerId: 'shared',
          createdAt,
        };
        docs.push({ collection: 'inventoryUnits', id, data });
      }

      setProgress({ done: 0, total: docs.length });
      await dbService.bulkCreate(docs, (done, total) => setProgress({ done, total }));

      await logInventoryEvent({
        type: 'batch_created',
        message: `Bulk ${mode === 'office' ? 'Office' : 'SHS'}: ${docs.length} units added (${cleanModel}${storage ? ' ' + storage : ''})`,
        batchId,
      });

      setSavedCount(docs.length);
      setStage('done');
      setTimeout(onClose, 1600);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
      setStage('review');
    }
  }, [canSave, supplierName, model, bp, slots, storage, grade, date, mode, onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-5xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${mode === 'shs' ? 'bg-amber-500' : 'bg-slate-900'}`}>
              {mode === 'shs' ? <Truck size={15} /> : <PackagePlus size={15} />}
            </div>
            <div>
              <h3 className="text-sm font-bold">Bulk Order</h3>
              <p className="text-[9px] text-gray-400 font-mono">
                {mode === 'office' ? 'Office Stock' : 'SHS Supplier Stock'} ·{' '}
                {stage === 'setup' ? 'Setup' : stage === 'scan' ? `Scan IMEIs (${slots.filter(s => s.imei).length}/${slots.length})`
                  : stage === 'review' ? `Review ${slots.length} units`
                  : stage === 'saving' ? `Saving ${progress.done}/${progress.total}`
                  : `Saved ${savedCount}`}
              </p>
            </div>
          </div>
          <StageDots stage={stage} />
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400">
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {stage === 'setup' && (
            <SetupView
              mode={mode} setMode={setMode}
              date={date} setDate={setDate}
              model={model} setModel={setModel}
              storage={storage} setStorage={setStorage}
              grade={grade} setGrade={setGrade}
              bp={bp} setBp={setBp}
              supplierName={supplierName} setSupplierName={setSupplierName}
              supplierNames={supplierNames}
              units={units}
              colourBuckets={colourBuckets} setColourBuckets={setColourBuckets}
              validation={setupValidation}
            />
          )}
          {stage === 'scan' && (
            <ScanView
              mode={mode}
              model={model}
              slots={slots}
              activeSlotIdx={activeSlotIdx}
              scanInput={scanInput}
              onScanInputChange={handleScanInputChange}
              scanInputRef={scanInputRef}
              scanError={scanError}
              setScanError={setScanError}
              onSubmit={handleScanSubmit}
              onSkip={skipCurrentSlot}
              onJump={jumpToSlot}
              showCamera={showCamera}
              setShowCamera={setShowCamera}
            />
          )}
          {stage === 'review' && (
            <ReviewView
              mode={mode}
              slots={slots}
              setSlots={setSlots}
              validation={reviewValidation}
              defaultBp={bp}
              reviewEditing={reviewEditing}
              setReviewEditing={setReviewEditing}
              existingByImei={existingByImei}
              error={error}
            />
          )}
          {stage === 'saving' && (
            <div className="py-16 flex flex-col items-center gap-4">
              <Loader2 size={32} className="animate-spin text-slate-600" />
              <p className="text-[12px] font-bold text-slate-700">
                Saving {progress.done.toLocaleString()} / {progress.total.toLocaleString()} units…
              </p>
              <div className="w-full max-w-sm h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )}
          {stage === 'done' && (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={36} className="text-emerald-600" />
              <p className="text-sm font-bold text-slate-900">Saved {savedCount} units</p>
              <p className="text-[11px] font-mono text-slate-500">Closing…</p>
            </div>
          )}
        </div>

        {/* Footer — navigation buttons */}
        {stage !== 'saving' && stage !== 'done' && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0 bg-slate-50/60">
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {stage === 'setup' && (
                <span>
                  {setupValidation.totalQty > 0
                    ? `Ready to scan ${setupValidation.totalQty} unit${setupValidation.totalQty === 1 ? '' : 's'} · £${(setupValidation.totalQty * (parseFloat(bp) || 0)).toFixed(0)}`
                    : 'Add colour quantities to continue'}
                </span>
              )}
              {stage === 'scan' && (
                <span>
                  {slots.filter(s => s.imei).length}/{slots.length} scanned ·{' '}
                  {slots.filter(s => s.skipped).length} skipped
                </span>
              )}
              {stage === 'review' && (
                error
                  ? <span className="text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} />{error}</span>
                  : reviewValidation.hasInFlightDupes
                    ? <span className="text-rose-600 inline-flex items-center gap-1"><AlertCircle size={11} />{reviewValidation.dupes.size} duplicate IMEI{reviewValidation.dupes.size === 1 ? '' : 's'} in batch</span>
                    : !reviewValidation.requiredFilled
                      ? <span className="text-amber-600 inline-flex items-center gap-1"><AlertCircle size={11} />{reviewValidation.totalSlots - reviewValidation.filled - reviewValidation.skipped} slot{reviewValidation.totalSlots - reviewValidation.filled - reviewValidation.skipped === 1 ? '' : 's'} missing IMEI</span>
                      : <span>{reviewValidation.filled} filled · {reviewValidation.skipped} skipped · ready to save</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {stage !== 'setup' && (
                <button
                  type="button"
                  onClick={() => setStage(stage === 'scan' ? 'setup' : 'scan')}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-white inline-flex items-center gap-1"
                >
                  <ArrowLeft size={11} /> Back
                </button>
              )}
              <button onClick={onClose} type="button"
                className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
              {stage === 'setup' && (
                <button
                  type="button"
                  disabled={!setupValidation.complete}
                  onClick={goToScan}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  Start scanning <ChevronRight size={11} />
                </button>
              )}
              {stage === 'scan' && (
                <button
                  type="button"
                  onClick={() => setStage('review')}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all inline-flex items-center gap-1.5"
                >
                  Review <ChevronRight size={11} />
                </button>
              )}
              {stage === 'review' && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className={`px-4 py-2 rounded-lg text-white text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 inline-flex items-center gap-1.5
                    ${mode === 'shs' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-slate-900 hover:bg-slate-700'}`}
                >
                  <CheckCircle2 size={11} /> Save {slots.length} unit{slots.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── Stage indicator dots ──────────────────────────────────────────────────────
function StageDots({ stage }: { stage: Stage }) {
  const order: Stage[] = ['setup', 'scan', 'review'];
  const idx = order.indexOf(stage);
  // Saving/Done both visually count as "after review".
  const effective = stage === 'saving' || stage === 'done' ? order.length : idx;
  return (
    <div className="hidden md:flex items-center gap-1.5 mx-4">
      {order.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full transition-colors ${i <= effective ? 'bg-slate-900' : 'bg-slate-300'}`} />
          {i < order.length - 1 && <span className={`w-4 h-px ${i < effective ? 'bg-slate-900' : 'bg-slate-300'}`} />}
        </div>
      ))}
    </div>
  );
}

// ── Setup view ────────────────────────────────────────────────────────────────
interface SetupValidation {
  modelOk: boolean; supplierOk: boolean; storageOk: boolean; bpOk: boolean;
  bucketsOk: boolean; totalQty: number; complete: boolean;
}
function SetupView({
  mode, setMode, date, setDate, model, setModel, storage, setStorage,
  grade, setGrade, bp, setBp, supplierName, setSupplierName, supplierNames,
  units, colourBuckets, setColourBuckets, validation,
}: {
  mode: Mode; setMode: (m: Mode) => void;
  date: string; setDate: (d: string) => void;
  model: string; setModel: (m: string) => void;
  storage: string; setStorage: (s: string) => void;
  grade: string; setGrade: (g: string) => void;
  bp: string; setBp: (b: string) => void;
  supplierName: string; setSupplierName: (s: string) => void;
  supplierNames: string[];
  units: InventoryUnit[];
  colourBuckets: ColourBucket[]; setColourBuckets: React.Dispatch<React.SetStateAction<ColourBucket[]>>;
  validation: SetupValidation;
}) {
  const updateBucket = (id: string, patch: Partial<ColourBucket>) =>
    setColourBuckets(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeBucket = (id: string) =>
    setColourBuckets(prev => prev.length > 1 ? prev.filter(b => b.id !== id) : prev);
  const addBucket = () => setColourBuckets(prev => [...prev, { id: uid(), colour: '', quantity: 0 }]);

  return (
    <div className="p-5 space-y-4">
      {/* Mode tabs */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button" onClick={() => setMode('office')}
          className={`text-left rounded-xl border px-3 py-2 transition-all ${
            mode === 'office' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest">Office Stock</p>
          <p className="text-[9px] font-mono opacity-70 mt-0.5">IMEI required per unit · counts as office stock</p>
        </button>
        <button
          type="button" onClick={() => setMode('shs')}
          className={`text-left rounded-xl border px-3 py-2 transition-all ${
            mode === 'shs' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest">SHS Supplier Stock</p>
          <p className="text-[9px] font-mono opacity-70 mt-0.5">IMEI optional · supplier-held, not office stock</p>
        </button>
      </div>

      {/* Shared metadata grid */}
      <div className="grid grid-cols-12 gap-2">
        <FieldCell label="Stock In Date *" span={3}>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none focus:border-black"
          />
        </FieldCell>
        <FieldCell label="Model *" span={5} error={!validation.modelOk}>
          <DeviceComboBox
            units={units} brand=""
            model={model}
            onModelChange={setModel}
            onPick={(entry) => {
              setModel(entry.model);
              if (!storage && entry.storages[0]) setStorage(entry.storages[0]);
              if (!grade && entry.topGrade) setGrade(entry.topGrade);
            }}
            placeholder="Search existing models or type new — e.g. iPhone 13 128GB"
            inputClassName="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
          />
        </FieldCell>
        <FieldCell label="Storage *" span={2} error={!validation.storageOk}>
          <select
            value={storage} onChange={e => setStorage(e.target.value)}
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono bg-white focus:outline-none transition-colors ${
              !validation.storageOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          >
            <option value="">—</option>
            {storage && !STORAGE_OPTIONS.includes(storage as any) && (
              <option value={storage}>{storage}</option>
            )}
            {STORAGE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FieldCell>
        <FieldCell label="Grade" span={2}>
          <select
            value={grade} onChange={e => setGrade(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black bg-white"
          >
            <option value="">—</option>
            {grade && !GRADES.includes(grade as any) && (
              <option value={grade}>{grade}</option>
            )}
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </FieldCell>
        <FieldCell label="Supplier *" span={6} error={!validation.supplierOk}>
          <input
            list="bulk-supplier-names" value={supplierName}
            onChange={e => setSupplierName(e.target.value)}
            placeholder="Type or pick"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none transition-colors ${
              !validation.supplierOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          />
          <datalist id="bulk-supplier-names">
            {supplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </FieldCell>
        <FieldCell label="BP per unit (£) *" span={6} error={!validation.bpOk}>
          <input
            type="number" min={0} step={0.01} value={bp}
            onChange={e => setBp(e.target.value)}
            placeholder="0.00"
            className={`w-full border rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none transition-colors ${
              !validation.bpOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          />
        </FieldCell>
      </div>

      {/* Colour quantity breakdown */}
      <div className="border border-slate-200 rounded-2xl p-3 bg-slate-50/40">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Quantity per colour</p>
            <p className="text-[9px] font-mono text-slate-400 mt-0.5">
              Total {validation.totalQty} unit{validation.totalQty === 1 ? '' : 's'} — slots are generated in this order on the next step
            </p>
          </div>
          <button
            type="button" onClick={addBucket}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-700 hover:bg-white px-2 py-1 rounded inline-flex items-center gap-1 border border-slate-200"
          >
            <Plus size={11} /> Colour
          </button>
        </div>
        <div className="space-y-1.5">
          {colourBuckets.map(b => (
            <div key={b.id} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-6">
                <ColourSelect
                  value={b.colour}
                  onChange={(colour) => updateBucket(b.id, { colour })}
                />
              </div>
              <div className="col-span-5">
                <input
                  type="number" min={0} step={1}
                  value={b.quantity || ''}
                  onChange={e => updateBucket(b.id, { quantity: Math.max(0, parseInt(e.target.value) || 0) })}
                  placeholder="Qty"
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] font-mono focus:outline-none focus:border-black"
                />
              </div>
              <button
                type="button"
                onClick={() => removeBucket(b.id)}
                disabled={colourBuckets.length === 1}
                className="col-span-1 p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all disabled:opacity-30 flex justify-center"
                title="Remove colour"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Scan view ────────────────────────────────────────────────────────────────
function ScanView({
  mode, model, slots, activeSlotIdx, scanInput, onScanInputChange, scanInputRef,
  scanError, setScanError, onSubmit, onSkip, onJump, showCamera, setShowCamera,
}: {
  mode: Mode; model: string;
  slots: UnitSlot[]; activeSlotIdx: number;
  scanInput: string; onScanInputChange: (s: string) => void;
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  scanError: string; setScanError: (s: string) => void;
  onSubmit: (raw: string) => void; onSkip: () => void; onJump: (idx: number) => void;
  showCamera: boolean; setShowCamera: (b: boolean) => void;
}) {
  // Group slots by colour for visual structure (operator sees Black ×30,
  // White ×20 sections rather than a flat 100-row list).
  const grouped = useMemo(() => {
    const map = new Map<string, { colour: string; slots: { slot: UnitSlot; idx: number }[] }>();
    slots.forEach((slot, idx) => {
      const g = map.get(slot.colour) ?? { colour: slot.colour, slots: [] };
      g.slots.push({ slot, idx });
      map.set(slot.colour, g);
    });
    return Array.from(map.values());
  }, [slots]);

  const activeSlot = slots[activeSlotIdx];
  const totalFilled = slots.filter(s => s.imei).length;

  return (
    <div className="p-5 space-y-4">
      {/* Scan input — the throughput-critical control */}
      <div className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <ScanLine size={14} className="text-slate-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            Scanning slot #{activeSlotIdx + 1} — {activeSlot?.colour || '—'}
          </p>
          <span className="ml-auto text-[10px] font-mono text-slate-500">
            {totalFilled}/{slots.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={scanInputRef}
            value={scanInput}
            onChange={e => onScanInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit(scanInput);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onSkip();
              }
            }}
            placeholder={`Click here and scan — auto-advances when IMEI complete`}
            inputMode="text"
            autoFocus
            className={`flex-1 border rounded-lg px-3 py-2 text-[13px] font-mono focus:outline-none transition-colors ${
              scanError ? 'border-rose-300 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-slate-900'
            }`}
          />
          <button
            type="button" onClick={() => setShowCamera(!showCamera)}
            title="Toggle camera scanner"
            className={`p-2.5 rounded-lg border transition-all ${
              showCamera ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
            }`}
          >
            <Camera size={14} />
          </button>
          <button
            type="button" onClick={onSkip}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
            title="Mark slot as skipped (Esc)"
          >
            Skip
          </button>
        </div>
        {scanError && (
          <p className="text-[10px] font-mono text-rose-600 mt-1.5 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {scanError}
          </p>
        )}
        <p className="text-[9px] font-mono text-slate-400 mt-1.5">
          Click the field, then scan — the IMEI auto-submits as soon as the value matches a valid IMEI length, no Enter needed. Manual entry: type IMEI · Enter to submit · Esc to skip.
        </p>
      </div>

      {/* Optional camera scanner */}
      {showCamera && (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <IMEIScanner
            onScan={(value) => onSubmit(value)}
            onError={(msg) => setScanError(msg)}
          />
        </div>
      )}

      {/* Slot grid grouped by colour */}
      <div className="space-y-3">
        {grouped.map(g => (
          <div key={g.colour} className="border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-3 py-2 bg-slate-50/60 border-b border-slate-100 flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700">{g.colour}</p>
              <span className="text-[9px] font-mono text-slate-500">
                {g.slots.filter(s => s.slot.imei).length}/{g.slots.length}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 p-2">
              {g.slots.map(({ slot, idx }) => {
                const isActive = idx === activeSlotIdx;
                const tone =
                  isActive ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                  : slot.skipped ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : slot.imei ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400';
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onJump(idx)}
                    className={`text-left rounded-lg border px-2 py-1.5 transition-all ${tone}`}
                  >
                    <p className="text-[9px] font-mono opacity-70">#{idx + 1}</p>
                    <p className="text-[10px] font-mono truncate" title={slot.imei || (slot.skipped ? 'skipped' : 'empty')}>
                      {slot.imei || (slot.skipped ? '— skipped —' : '— empty —')}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[9px] font-mono text-slate-400 text-center">
        {mode === 'office' ? 'Every slot needs a valid IMEI to save · Skip leaves slot pending' : 'IMEIs optional in SHS · empty slots become awaiting-IMEI placeholders'}
      </p>
    </div>
  );
}

// ── Review view ──────────────────────────────────────────────────────────────
interface ReviewValidation {
  totalSlots: number; filled: number; skipped: number;
  requiredFilled: boolean; hasInFlightDupes: boolean; dupes: Set<string>;
}
function ReviewView({
  mode, slots, setSlots, validation, defaultBp, reviewEditing, setReviewEditing,
  existingByImei, error,
}: {
  mode: Mode;
  slots: UnitSlot[]; setSlots: React.Dispatch<React.SetStateAction<UnitSlot[]>>;
  validation: ReviewValidation; defaultBp: string;
  reviewEditing: string | null; setReviewEditing: (id: string | null) => void;
  existingByImei: Map<string, InventoryUnit>;
  error: string;
}) {
  const updateSlot = (id: string, patch: Partial<UnitSlot>) =>
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const removeSlot = (id: string) =>
    setSlots(prev => prev.filter(s => s.id !== id));

  return (
    <div className="p-5 space-y-3">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} className="text-rose-600" />
          <p className="text-[11px] text-rose-700">{error}</p>
        </div>
      )}

      <div className="border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-[11px] border-separate border-spacing-0">
          <thead>
            <tr className="text-[9px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50">
              <th className="px-3 py-2 text-left border-b border-slate-200 w-10">#</th>
              <th className="px-3 py-2 text-left border-b border-slate-200">Colour</th>
              <th className="px-3 py-2 text-left border-b border-slate-200">IMEI</th>
              <th className="px-3 py-2 text-right border-b border-slate-200 w-20">BP (£)</th>
              <th className="px-3 py-2 text-left border-b border-slate-200">Notes</th>
              <th className="px-3 py-2 text-left border-b border-slate-200 w-32">Status</th>
              <th className="px-3 py-2 border-b border-slate-200 w-10" />
            </tr>
          </thead>
          <tbody>
            {slots.map((slot, idx) => {
              const isEditing = reviewEditing === slot.id;
              const imeiUp = slot.imei.trim().toUpperCase();
              const isDupInBatch = validation.dupes.has(imeiUp);
              const dbMatch = imeiUp ? existingByImei.get(imeiUp) : undefined;
              const missingImei = mode === 'office' && !slot.imei.trim() && !slot.skipped;
              const tone =
                isDupInBatch || dbMatch ? 'bg-rose-50/60'
                : missingImei ? 'bg-amber-50/40'
                : 'bg-white hover:bg-slate-50';
              return (
                <tr key={slot.id} className={`${tone} transition-colors`}>
                  <td className="px-3 py-1.5 border-b border-slate-100 font-mono text-slate-500">{idx + 1}</td>
                  <td className="px-3 py-1.5 border-b border-slate-100">
                    {isEditing ? (
                      <ColourSelect
                        value={slot.colour}
                        onChange={(c) => updateSlot(slot.id, { colour: c })}
                      />
                    ) : (
                      <span className="font-mono text-slate-700">{slot.colour}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-slate-100">
                    {isEditing ? (
                      <input
                        value={slot.imei}
                        onChange={e => updateSlot(slot.id, { imei: e.target.value, skipped: false })}
                        placeholder="IMEI"
                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] font-mono focus:outline-none focus:border-slate-900"
                      />
                    ) : slot.imei ? (
                      <span className="font-mono text-slate-900">{slot.imei}</span>
                    ) : slot.skipped ? (
                      <span className="text-[10px] font-mono text-amber-700">— skipped —</span>
                    ) : (
                      <span className="text-[10px] font-mono text-slate-400">— empty —</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-slate-100 text-right">
                    {isEditing ? (
                      <input
                        type="number" min={0} step={0.01} value={slot.bpOverride}
                        onChange={e => updateSlot(slot.id, { bpOverride: e.target.value })}
                        placeholder={defaultBp}
                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] font-mono text-right focus:outline-none focus:border-slate-900"
                      />
                    ) : (
                      <span className="font-mono text-slate-700">{slot.bpOverride || defaultBp}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-slate-100">
                    {isEditing ? (
                      <input
                        value={slot.notes}
                        onChange={e => updateSlot(slot.id, { notes: e.target.value })}
                        placeholder="—"
                        className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-slate-900"
                      />
                    ) : slot.notes ? (
                      <span className="text-slate-600 truncate" title={slot.notes}>{slot.notes}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-slate-100">
                    {dbMatch ? (
                      <span className="text-[10px] font-mono text-rose-700" title={`Already in inventory · ${dbMatch.model || '?'} · ${dbMatch.dateIn || '?'} · ${dbMatch.status}`}>
                        in DB
                      </span>
                    ) : isDupInBatch ? (
                      <span className="text-[10px] font-mono text-rose-700">dup in batch</span>
                    ) : missingImei ? (
                      <span className="text-[10px] font-mono text-amber-700">missing IMEI</span>
                    ) : slot.skipped ? (
                      <span className="text-[10px] font-mono text-amber-700">skipped</span>
                    ) : (
                      <span className="text-[10px] font-mono text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 size={11} /> ready
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-b border-slate-100">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setReviewEditing(isEditing ? null : slot.id)}
                        className="p-1 rounded text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                        title={isEditing ? 'Done editing' : 'Edit row'}
                      >
                        {isEditing ? <CheckCircle2 size={12} /> : <Edit2 size={11} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.id)}
                        className="p-1 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50"
                        title="Delete row"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Shared cell wrapper ──────────────────────────────────────────────────────
function FieldCell({
  label, span, error, children,
}: { label: string; span: number; error?: boolean; children: React.ReactNode }) {
  const spanCls = ({
    1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4',
    5: 'col-span-5', 6: 'col-span-6', 7: 'col-span-7', 8: 'col-span-8',
    9: 'col-span-9', 10: 'col-span-10', 11: 'col-span-11', 12: 'col-span-12',
  } as Record<number, string>)[span] || 'col-span-12';
  return (
    <div className={spanCls}>
      <label className={`text-[9px] font-bold uppercase tracking-widest block mb-0.5 ${error ? 'text-rose-600' : 'text-slate-500'}`}>{label}</label>
      {children}
    </div>
  );
}

// ── Colour picker (preset dropdown + Other freeform) ─────────────────────────
function ColourSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isPreset = COLOUR_PRESETS.some(p => p.toLowerCase() === value.trim().toLowerCase());
  const showOther = value !== '' && !isPreset;
  return (
    <div className="space-y-1">
      <select
        value={isPreset ? COLOUR_PRESETS.find(p => p.toLowerCase() === value.trim().toLowerCase()) : (showOther ? '__other__' : '')}
        onChange={e => {
          const v = e.target.value;
          if (v === '__other__') onChange(''); // operator picks Other → freeform input takes focus
          else onChange(v);
        }}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black bg-white"
      >
        <option value="">—</option>
        {COLOUR_PRESETS.map(c => <option key={c} value={c}>{c}</option>)}
        <option value="__other__">Other</option>
      </select>
      {(showOther || (!isPreset && value === '')) && (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="Custom colour (e.g. Space Grey)"
          className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-black"
        />
      )}
    </div>
  );
}

// ── Category helper — kept in sync with AddStockManualModal.detectCategory ───
function detectCategory(model: string): InventoryUnit['category'] {
  const s = String(model || '').toLowerCase();
  if (s.includes('iphone'))       return 'iPhone';
  if (s.includes('ipad'))         return 'iPad';
  if (s.includes('apple watch'))  return 'Apple Watch';
  if (s.includes('galaxy s'))     return 'Samsung S Series';
  if (s.includes('galaxy a'))     return 'Samsung A Series';
  if (s.includes('galaxy tab') || s.includes('tab a') || s.includes('tab s')) return 'Tablet';
  if (s.includes('samsung'))      return 'Samsung S Series';
  return 'Other';
}

