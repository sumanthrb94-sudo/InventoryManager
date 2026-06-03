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
  Loader2, Truck, PackagePlus, Camera, ArrowLeft, Edit2, Printer,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { dbService } from '../lib/dbService';
import { isValidImei, isAppleDevice } from '../lib/imeiValidation';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { ensureSupplier } from '../services';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { generateBatchStickerSheet } from '../lib/stickerPdf';
import DeviceComboBox from './DeviceComboBox';
import IMEIScanner from './IMEIScanner';
import type { InventoryUnit, ListingSite } from '../types';

type Mode = 'office' | 'shs';
type Stage = 'setup' | 'scan' | 'review' | 'saving' | 'done';

// ── WebHID shapes (Chrome only; not in lib.dom.d.ts) ─────────────────────────
// We model only the surface we use so the rest of the file can stay strictly
// typed without an `any` cast at every event handler.
interface HidInputReportEvent { data: DataView; }
interface HidDeviceLike {
  opened: boolean;
  productName?: string;
  vendorId?: number;
  productId?: number;
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: 'inputreport', listener: (e: HidInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (e: HidInputReportEvent) => void): void;
}
interface HidLike {
  requestDevice(opts: { filters: Array<{ vendorId?: number; productId?: number; usagePage?: number; usage?: number }> }):
    Promise<HidDeviceLike[]>;
}

/** USB HID keyboard usage-code → ASCII char, with shift modifier for the
 *  uppercase letters / shifted digits. Subset: A-Z, 0-9, Enter, Space,
 *  Hyphen — covers every character a 15-digit IMEI or an alphanumeric
 *  Apple serial can carry. Other usages return '' so unrelated keystrokes
 *  (arrow keys, F-keys, modifiers themselves) get silently dropped. */
function hidKeycodeToChar(code: number, shift: boolean): string {
  // Letters: 0x04 (a) .. 0x1D (z)
  if (code >= 0x04 && code <= 0x1D) {
    const base = shift ? 0x41 : 0x61; // A or a — IMEIs use uppercase but our
    // submit pipeline uppercases either way, so respecting the shift state
    // here keeps round-tripping with serials that include lowercase chars.
    return String.fromCharCode(base + (code - 0x04));
  }
  // Digits 1-9: 0x1E .. 0x26, 0 at 0x27.
  if (code >= 0x1E && code <= 0x26) return String.fromCharCode(0x31 + (code - 0x1E));
  if (code === 0x27) return '0';
  if (code === 0x28) return '\n';        // Enter
  if (code === 0x2C) return ' ';         // Space
  if (code === 0x2D) return '-';         // Hyphen
  return '';
}

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
  // Non-blocking advisory shown next to scanError — set when the scanned
  // IMEI has a prior `sent_to_supplier` event. Cleared on the next scan.
  const [scanWarning, setScanWarning] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [reviewEditing, setReviewEditing] = useState<string | null>(null);
  // ── Scanner status ────────────────────────────────────────────────────────
  // 'unsupported' — WebHID API not present in this browser (Safari, iOS,
  //                 older Chrome). The keyboard/burst paths still work.
  // 'idle'        — WebHID present, no device paired.
  // 'connecting'  — picker dialog open / opening the device.
  // 'connected'   — HID input-reports streaming straight into the buffer
  //                 (works even when no input has focus).
  // 'error'       — last connect attempt failed; user can retry.
  const [hidStatus, setHidStatus] = useState<'unsupported' | 'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [hidDeviceName, setHidDeviceName] = useState('');
  const hidDeviceRef = useRef<HidDeviceLike | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [savedCount, setSavedCount] = useState(0);
  // The unit data we just wrote — stashed so the Done screen's "Print
  // Stickers" button can hand it to the PDF generator without re-reading
  // from the store (the store will eventually reflect the write but only
  // after the Firestore listener round-trips, which is racy).
  const [savedUnits, setSavedUnits] = useState<Array<{
    imei?: string; model: string; storage?: string; colour?: string;
    grade?: string; buyPrice?: number; supplierName?: string;
    dateIn?: string; batchId?: string; notes?: string;
  }>>([]);

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

  // ── Returns history: IMEIs we've previously sent back to a supplier.
  // Subscribed live so the operator gets the warning the moment a
  // matching scan comes in. The check is non-blocking — operator can
  // still add the unit, just sees a banner so they don't re-stock a
  // unit we already RTS'd to the supplier without realising.
  const [rtsImeiHistory, setRtsImeiHistory] = useState<Map<string, { date: string; comment?: string; supplierName?: string }>>(new Map());
  useEffect(() => {
    const unsub = dbService.subscribeToCollection('returnEvents', (rows) => {
      const m = new Map<string, { date: string; comment?: string; supplierName?: string }>();
      // Keep the MOST RECENT sent_to_supplier event per IMEI so the
      // warning shows the latest context.
      for (const r of rows) {
        if (r.type !== 'sent_to_supplier' || !r.imei) continue;
        const key = String(r.imei).trim().toUpperCase();
        const existing = m.get(key);
        if (!existing || (r.date && r.date > existing.date)) {
          m.set(key, { date: r.date, comment: r.comment, supplierName: r.supplierName });
        }
      }
      setRtsImeiHistory(m);
    });
    return () => unsub();
  }, []);

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

  // ── Setup → next stage: hydrate slots from buckets ────────────────────────
  // Office mode goes to 'scan' so the operator can attach IMEIs to each
  // empty slot. SHS mode skips Scan entirely — supplier-held units are
  // placeholders by definition (no physical IMEI yet) so there's nothing
  // to scan; jump straight to Review where the operator confirms the
  // colour split and saves.
  const goToNext = useCallback(() => {
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
    setStage(mode === 'shs' ? 'review' : 'scan');
  }, [colourBuckets, setupValidation.complete, mode]);

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
    // Re-intake warning — surface (don't block) when this IMEI was
    // previously sent back to a supplier. The operator can still add
    // the unit, but they'll see a banner that includes the prior
    // supplier name + return date + comment so they don't accidentally
    // re-stock something we already RTS'd.
    const priorRts = rtsImeiHistory.get(imei);
    if (priorRts) {
      const ctx = [
        priorRts.supplierName && `to ${priorRts.supplierName}`,
        priorRts.date && `on ${priorRts.date}`,
        priorRts.comment && `· ${priorRts.comment}`,
      ].filter(Boolean).join(' ');
      setScanWarning(`⚠ IMEI ${imei} was previously returned to supplier ${ctx}. Confirm before adding.`);
    } else {
      setScanWarning('');
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
  }, [model, slots, activeSlotIdx, existingByImei, rtsImeiHistory]);

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

  // ── Document-level keystroke buffer ───────────────────────────────────────
  // Catches scanner output when focus is somewhere other than the scan input
  // (operator taps a slot card to jump → focus moves to that button → next
  // scan's keystrokes would otherwise vanish into the void). Differentiates
  // a scanner burst from human typing by elapsed time: 6+ chars arriving
  // in <500ms is hardware, anything slower is a person — and humans don't
  // usually pump valid IMEIs into UI chrome anyway.
  useEffect(() => {
    if (stage !== 'scan') return;

    let buffer = '';
    let firstKeyTs = 0;
    let lastKeyTs = 0;
    let flushTimer: number | null = null;

    const isAppleModel = isAppleDevice(model);

    const flush = () => {
      flushTimer = null;
      if (buffer.length === 0) return;
      const elapsed = lastKeyTs - firstKeyTs;
      const isBurst = buffer.length >= 6 && elapsed < 500;
      const captured = buffer;
      buffer = '';
      if (isBurst && isValidImei(captured, { isAppleSerial: isAppleModel })) {
        handleScanSubmit(captured);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Skip when the focus is on an input — that input's own handler
      // owns the keystroke. Our scan <input> has its own auto-submit;
      // unrelated inputs on the page (e.g. a different modal) shouldn't
      // get hijacked.
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Don't capture modifier-combo shortcuts (browser/system).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (buffer === '' || now - lastKeyTs > 100) {
        buffer = '';
        firstKeyTs = now;
      }
      lastKeyTs = now;

      if (e.key === 'Enter') {
        if (flushTimer !== null) window.clearTimeout(flushTimer);
        flush();
        return;
      }
      if (e.key.length === 1) buffer += e.key;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      flushTimer = window.setTimeout(flush, 100);
    };

    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
    };
  }, [stage, model, handleScanSubmit]);

  // ── Persistent focus on the scan input ────────────────────────────────────
  // After a click anywhere in the document, if focus didn't land in a
  // typing target or another scan control (Camera / Skip / HID button),
  // pull it back to the scan input so the next scan goes where it should.
  // 80ms delay so the user can interact with controls without focus
  // snapping back mid-tap.
  useEffect(() => {
    if (stage !== 'scan' || showCamera) return;
    const onClick = () => {
      setTimeout(() => {
        if (stage !== 'scan') return;
        const active = document.activeElement as HTMLElement | null;
        const inScanControl = !!active?.closest('[data-bulk-scan-control]');
        const inForm = active?.tagName === 'INPUT' || active?.tagName === 'SELECT' || active?.tagName === 'TEXTAREA';
        if (!inScanControl && !inForm) scanInputRef.current?.focus();
      }, 80);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [stage, showCamera]);

  // ── WebHID feature-detection ───────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('hid' in navigator)) {
      setHidStatus('unsupported');
    }
  }, []);

  // ── WebHID pairing + input-report listener ─────────────────────────────────
  // For scanners configured as POS HID or any setup where the operator wants
  // capture to work without keyboard focus on the tab. Permission is a
  // user-gesture pick (Chrome's device chooser). We open the device, attach
  // an inputreport listener, and translate keycodes → ASCII so the captured
  // string flows through the same handleScanSubmit pipeline as everything else.
  const connectHidScanner = useCallback(async () => {
    const nav = navigator as unknown as { hid?: HidLike };
    if (!nav.hid) {
      setScanError('WebHID not supported in this browser — keep using the focused-input scanner');
      return;
    }
    setHidStatus('connecting');
    try {
      const devices = await nav.hid.requestDevice({ filters: [] });
      if (!devices.length) { setHidStatus('idle'); return; }
      const device = devices[0];
      if (!device.opened) await device.open();
      hidDeviceRef.current = device;
      setHidDeviceName(device.productName || `HID ${device.vendorId?.toString(16)}:${device.productId?.toString(16)}`);

      let hidBuffer = '';
      let hidTimer: number | null = null;
      let shiftHeld = false;

      const flushHidBuffer = () => {
        hidTimer = null;
        const val = hidBuffer;
        hidBuffer = '';
        if (val.length < 6) return;
        const isAppleModel = isAppleDevice(model);
        if (isValidImei(val, { isAppleSerial: isAppleModel })) handleScanSubmit(val);
      };

      const onReport = (event: HidInputReportEvent) => {
        // HID keyboard input report: byte 0 = modifiers, byte 1 = reserved,
        // bytes 2..N = up to N usage codes (typically 6). Some scanners ship
        // single-byte reports with the keycode at byte 0 — accept either.
        const data = event.data;
        const offset = data.byteLength >= 8 ? 2 : 0;
        if (offset === 2) shiftHeld = (data.getUint8(0) & 0x22) !== 0; // L/R shift bits
        for (let i = offset; i < data.byteLength; i++) {
          const code = data.getUint8(i);
          if (code === 0) continue;
          const ch = hidKeycodeToChar(code, shiftHeld);
          if (ch === '\n') { if (hidTimer !== null) clearTimeout(hidTimer); flushHidBuffer(); continue; }
          if (ch) hidBuffer += ch;
        }
        if (hidTimer !== null) clearTimeout(hidTimer);
        hidTimer = window.setTimeout(flushHidBuffer, 120);
      };

      device.addEventListener('inputreport', onReport);
      // Stash the cleanup on the device ref so disconnect can find it.
      (device as HidDeviceLike & { __cleanup?: () => void }).__cleanup = () => {
        device.removeEventListener('inputreport', onReport);
        device.close().catch(() => {});
        if (hidTimer !== null) clearTimeout(hidTimer);
      };
      setHidStatus('connected');
    } catch (err) {
      setHidStatus('error');
      setScanError('HID connect failed — ' + (err instanceof Error ? err.message : 'unknown'));
    }
  }, [model, handleScanSubmit]);

  const disconnectHidScanner = useCallback(() => {
    const dev = hidDeviceRef.current as (HidDeviceLike & { __cleanup?: () => void }) | null;
    dev?.__cleanup?.();
    hidDeviceRef.current = null;
    setHidDeviceName('');
    setHidStatus(typeof navigator !== 'undefined' && 'hid' in navigator ? 'idle' : 'unsupported');
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => { disconnectHidScanner(); }, [disconnectHidScanner]);

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

      // Lifecycle log — for every IMEI in this batch that has a prior
      // sent_to_supplier event, record a `received_again` event so the
      // per-IMEI timeline shows the round-trip. Best-effort; failures
      // don't roll back the bulkCreate.
      for (const d of docs) {
        const imei = String(d.data?.imei || '').trim().toUpperCase();
        if (!imei) continue;
        if (!rtsImeiHistory.get(imei)) continue;
        try {
          await dbService.createReturnEvent({
            imei,
            unitId: d.id,
            type: 'received_again',
            date: d.data.dateIn || new Date().toISOString().slice(0, 10),
            comment: `Re-stocked via Bulk Order — previously returned to supplier`,
            supplierId:   d.data.supplierId,
            supplierName: d.data.supplierName,
          });
        } catch (err) {
          console.warn('Failed to record received_again for IMEI', imei, err);
        }
      }

      await logInventoryEvent({
        type: 'batch_created',
        message: `Bulk ${mode === 'office' ? 'Office' : 'SHS'}: ${docs.length} units added (${cleanModel}${storage ? ' ' + storage : ''})`,
        batchId,
      });

      setSavedCount(docs.length);
      setSavedUnits(docs.map(d => ({
        imei:         d.data.imei || undefined,
        model:        d.data.model || '',
        storage:      d.data.storage || undefined,
        colour:       d.data.colour || undefined,
        grade:        d.data.grade || undefined,
        buyPrice:     typeof d.data.buyPrice === 'number' ? d.data.buyPrice : undefined,
        supplierName: d.data.supplierName || undefined,
        dateIn:       d.data.dateIn || undefined,
        batchId:      d.data.batchId || undefined,
        notes:        d.data.notes || undefined,
      })));
      setStage('done');
      // No auto-close — the Done screen carries a richer summary the
      // operator should be able to read in full before dismissing.
      // Exit is via the explicit "Exit Bulk Order" button in the footer.
    } catch (e: any) {
      setError(e?.message || 'Save failed');
      setStage('review');
    }
  }, [canSave, supplierName, model, bp, slots, storage, grade, date, mode, onClose]);

  /** Restart the flow at Setup for a follow-up batch — keep the device
   *  details (date / model / storage / grade / BP / mode) so the operator
   *  doesn't have to re-type them when the next delivery is the same SKU
   *  but a different supplier or different colour split. Reset everything
   *  downstream of supplier so the next setup starts clean.
   *
   *  Common use case: operator receives 2 units in Black from MHL, saves,
   *  then realises another 10 are coming from NIHAL in a Black/White mix.
   *  Click "+ Add Another Batch", swap supplier, dial in the new colour
   *  quantities, scan, save again — all inside the same modal session. */
  const startNewBatch = useCallback(() => {
    setSupplierName('');
    setColourBuckets([{ id: uid(), colour: 'Black', quantity: 0 }]);
    setSlots([]);
    setActiveSlotIdx(0);
    setScanInput('');
    setScanError('');
    setReviewEditing(null);
    setError('');
    setProgress({ done: 0, total: 0 });
    setSavedCount(0);
    setSavedUnits([]);
    setStage('setup');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={() => {
        // Backdrop click only dismisses while the operator is still
        // composing or scanning. Once the save is in flight or finished,
        // exit goes through the explicit Cancel / Exit Bulk Order buttons
        // so an accidental click outside the card doesn't lose the
        // post-save summary or interrupt an active bulkCreate.
        if (stage === 'saving' || stage === 'done') return;
        onClose();
      }}
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
          <StageDots stage={stage} mode={mode} />
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
              scanWarning={scanWarning}
              onSubmit={handleScanSubmit}
              onSkip={skipCurrentSlot}
              onJump={jumpToSlot}
              showCamera={showCamera}
              setShowCamera={setShowCamera}
              inputFocused={inputFocused}
              setInputFocused={setInputFocused}
              hidStatus={hidStatus}
              hidDeviceName={hidDeviceName}
              connectHidScanner={connectHidScanner}
              disconnectHidScanner={disconnectHidScanner}
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
            <div className="py-10 md:py-16 flex flex-col items-center gap-4 text-center px-5">
              <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <CheckCircle2 size={28} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">
                  Saved {savedCount} unit{savedCount === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] font-mono text-slate-500 mt-1">
                  {mode === 'office' ? 'Office Stock' : 'SHS Supplier Stock'} ·{' '}
                  {model.trim() || '—'}{storage ? ` · ${storage}` : ''}
                </p>
              </div>
              {/* Per-colour breakdown so the operator can confirm the split
                  matches their delivery before walking away. */}
              <div className="w-full max-w-md grid grid-cols-2 gap-2">
                {Array.from(
                  slots.reduce((m, s) => {
                    const k = s.colour || 'Unspecified';
                    m.set(k, (m.get(k) ?? 0) + 1);
                    return m;
                  }, new Map<string, number>()).entries()
                ).map(([colour, count]) => (
                  <div
                    key={colour}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200"
                  >
                    <span className="text-[11px] font-mono text-slate-700 truncate">{colour}</span>
                    <span className="text-[11px] font-mono font-bold text-slate-900">× {count}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-mono text-slate-400 mt-2">
                Print peel-off stickers for this batch, add another from the same delivery, or close when done.
              </p>
            </div>
          )}
        </div>

        {/* Footer (done stage) — three CTAs: print peel-off labels for
            the just-saved batch, stay in the modal for a follow-up batch
            (same device, new supplier / colours), or exit. No auto-close;
            operator chooses the path. */}
        {stage === 'done' && (
          <div className="px-4 md:px-5 py-3 border-t border-gray-100 flex flex-col-reverse md:flex-row md:items-center md:justify-end gap-2 flex-shrink-0 bg-slate-50/60">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 md:py-2 rounded-lg border border-slate-200 text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all inline-flex items-center justify-center gap-1.5"
            >
              <X size={11} /> Exit Bulk Order
            </button>
            <button
              type="button"
              onClick={() => generateBatchStickerSheet(savedUnits)}
              disabled={savedUnits.length === 0}
              title="Download a PDF of peel-off labels for every unit in this batch — sized for Avery L7160 (21 per A4 sheet, 63.5×38.1mm)"
              className="px-4 py-2.5 md:py-2 rounded-lg border border-indigo-200 bg-white text-indigo-700 text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-50 transition-all inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={11} /> Print Stickers
            </button>
            <button
              type="button"
              onClick={startNewBatch}
              autoFocus
              title="Reset supplier + colour quantities, keep date / model / storage / grade / BP — useful when the next delivery is the same SKU from a different supplier"
              className="px-4 py-2.5 md:py-2 rounded-lg bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all inline-flex items-center justify-center gap-1.5"
            >
              <Plus size={11} /> Add Another Batch
            </button>
          </div>
        )}

        {/* Footer — navigation buttons. Stacks vertically on mobile so the
            status line above the buttons doesn't collide with three CTAs
            squeezed onto one row. */}
        {stage !== 'saving' && stage !== 'done' && (
          <div className="px-4 md:px-5 py-3 border-t border-gray-100 flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-3 flex-shrink-0 bg-slate-50/60">
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {stage === 'setup' && (
                <span>
                  {setupValidation.totalQty > 0
                    ? `Ready to ${mode === 'shs' ? 'register' : 'scan'} ${setupValidation.totalQty} unit${setupValidation.totalQty === 1 ? '' : 's'} · £${(setupValidation.totalQty * (parseFloat(bp) || 0)).toFixed(0)}`
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
                  // Back from review skips over the scan stage in SHS mode
                  // because that stage is never used there — going back
                  // would land on an empty Scan screen with nothing to do.
                  onClick={() => setStage(
                    stage === 'scan' ? 'setup'
                      : (mode === 'shs' ? 'setup' : 'scan')
                  )}
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
                  onClick={goToNext}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all disabled:opacity-40 inline-flex items-center gap-1.5"
                >
                  {mode === 'shs' ? 'Continue to review' : 'Start scanning'} <ChevronRight size={11} />
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
// SHS skips the scan stage entirely (supplier-held units have no IMEI to
// attach yet), so the dot strip drops the middle one and shows only
// Setup → Review for that mode.
function StageDots({ stage, mode }: { stage: Stage; mode: Mode }) {
  const order: Stage[] = mode === 'shs' ? ['setup', 'review'] : ['setup', 'scan', 'review'];
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
      {/* Mode tabs — stack vertically on mobile (each tab gets a full row),
          two side-by-side on md+. py-3 on mobile for an easier tap target. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <button
          type="button" onClick={() => setMode('office')}
          className={`text-left rounded-xl border px-3 py-3 md:py-2 transition-all ${
            mode === 'office' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest">Office Stock</p>
          <p className="text-[9px] font-mono opacity-70 mt-0.5">IMEI required per unit · counts as office stock</p>
        </button>
        <button
          type="button" onClick={() => setMode('shs')}
          className={`text-left rounded-xl border px-3 py-3 md:py-2 transition-all ${
            mode === 'shs' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400'
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest">SHS Supplier Stock</p>
          <p className="text-[9px] font-mono opacity-70 mt-0.5">IMEI optional · supplier-held, not office stock</p>
        </button>
      </div>

      {/* Shared metadata grid — mobile-first: 2-col on small screens (storage
          + grade pair up, everything else takes a full row), 12-col grid on
          md+ to keep the desktop dense layout. font-size bumps up on mobile
          so dropdown text doesn't collapse to a single character. */}
      <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
        <FieldCell label="Stock In Date *" className="col-span-2 md:col-span-3">
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] font-mono focus:outline-none focus:border-black"
          />
        </FieldCell>
        <FieldCell label="Model *" className="col-span-2 md:col-span-5" error={!validation.modelOk}>
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
            inputClassName="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] focus:outline-none focus:border-black"
          />
        </FieldCell>
        <FieldCell label="Storage *" className="col-span-1 md:col-span-2" error={!validation.storageOk}>
          <select
            value={storage} onChange={e => setStorage(e.target.value)}
            className={`w-full border rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] font-mono bg-white focus:outline-none transition-colors ${
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
        <FieldCell label="Grade" className="col-span-1 md:col-span-2">
          <select
            value={grade} onChange={e => setGrade(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] focus:outline-none focus:border-black bg-white"
          >
            <option value="">—</option>
            {grade && !GRADES.includes(grade as any) && (
              <option value={grade}>{grade}</option>
            )}
            {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </FieldCell>
        <FieldCell label="Supplier *" className="col-span-2 md:col-span-6" error={!validation.supplierOk}>
          <input
            list="bulk-supplier-names" value={supplierName}
            onChange={e => setSupplierName(e.target.value)}
            placeholder="Type or pick"
            className={`w-full border rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] focus:outline-none transition-colors ${
              !validation.supplierOk ? 'border-rose-300 bg-rose-50' : 'border-gray-200 focus:border-black'
            }`}
          />
          <datalist id="bulk-supplier-names">
            {supplierNames.map(n => <option key={n} value={n} />)}
          </datalist>
        </FieldCell>
        <FieldCell label="BP per unit (£) *" className="col-span-2 md:col-span-6" error={!validation.bpOk}>
          <input
            type="number" min={0} step={0.01} value={bp}
            onChange={e => setBp(e.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            className={`w-full border rounded-lg px-2.5 py-2 text-[13px] md:text-[12px] font-mono focus:outline-none transition-colors ${
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
            <div key={b.id} className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <ColourSelect
                  value={b.colour}
                  onChange={(colour) => updateBucket(b.id, { colour })}
                />
              </div>
              <input
                type="number" min={0} step={1} inputMode="numeric"
                value={b.quantity || ''}
                onChange={e => updateBucket(b.id, { quantity: Math.max(0, parseInt(e.target.value) || 0) })}
                placeholder="Qty"
                className="w-20 md:w-24 flex-shrink-0 border border-gray-200 rounded-lg px-2.5 py-2 md:py-1.5 text-[13px] md:text-[12px] font-mono focus:outline-none focus:border-black"
              />
              <button
                type="button"
                onClick={() => removeBucket(b.id)}
                disabled={colourBuckets.length === 1}
                className="p-2 md:p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all disabled:opacity-30 flex-shrink-0"
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
  scanError, setScanError, scanWarning, onSubmit, onSkip, onJump, showCamera, setShowCamera,
  inputFocused, setInputFocused,
  hidStatus, hidDeviceName, connectHidScanner, disconnectHidScanner,
}: {
  mode: Mode; model: string;
  slots: UnitSlot[]; activeSlotIdx: number;
  scanInput: string; onScanInputChange: (s: string) => void;
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  scanError: string; setScanError: (s: string) => void;
  scanWarning: string;
  onSubmit: (raw: string) => void; onSkip: () => void; onJump: (idx: number) => void;
  showCamera: boolean; setShowCamera: (b: boolean) => void;
  inputFocused: boolean; setInputFocused: (b: boolean) => void;
  hidStatus: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  hidDeviceName: string;
  connectHidScanner: () => Promise<void>;
  disconnectHidScanner: () => void;
}) {
  void model; void setScanError; // suppress unused-prop warnings in this view
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
    <div className="p-4 md:p-5 space-y-3 md:space-y-4">
      {/* Scan input — the throughput-critical control. On mobile the scan
          input gets its own row, the Camera + Skip buttons land below; on
          desktop everything stays on one row. text-base on the input prevents
          iOS Safari from auto-zooming when the field is tapped. */}
      <div className="border border-slate-200 rounded-2xl p-3 md:p-4 bg-white shadow-sm">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <ScanLine size={14} className="text-slate-500" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            Slot #{activeSlotIdx + 1} — {activeSlot?.colour || '—'}
          </p>
          {/* Scanner status chip — three signals at a glance:
              - HID paired (blue dot, device name): scanner output streams in
                regardless of focus
              - Input focused (green dot): focused-input keystrokes captured
              - Input unfocused (amber dot): tap the field to start scanning
              Tap the chip to pair / unpair a HID device (Chrome only). */}
          <ScannerStatusChip
            inputFocused={inputFocused}
            hidStatus={hidStatus}
            hidDeviceName={hidDeviceName}
            onConnect={connectHidScanner}
            onDisconnect={disconnectHidScanner}
          />
          <span className="ml-auto text-[10px] font-mono text-slate-500">
            {totalFilled}/{slots.length}
          </span>
        </div>
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <input
            ref={scanInputRef}
            value={scanInput}
            onChange={e => onScanInputChange(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit(scanInput);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onSkip();
              }
            }}
            placeholder="Tap here · scan IMEI"
            inputMode="text"
            autoFocus
            data-bulk-scan-control
            className={`flex-1 border rounded-lg px-3 py-3 md:py-2 text-[16px] md:text-[13px] font-mono focus:outline-none transition-colors ${
              scanError ? 'border-rose-300 bg-rose-50 focus:border-rose-500' : 'border-slate-300 focus:border-slate-900'
            }`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={() => setShowCamera(!showCamera)}
              data-bulk-scan-control
              title="Toggle camera scanner"
              className={`p-2.5 rounded-lg border transition-all flex-shrink-0 ${
                showCamera ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >
              <Camera size={14} />
            </button>
            <button
              type="button" onClick={onSkip}
              data-bulk-scan-control
              className="flex-1 md:flex-initial px-3 py-2.5 md:py-2 rounded-lg border border-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50"
              title="Mark slot as skipped (Esc)"
            >
              Skip
            </button>
          </div>
        </div>
        {scanError && (
          <p className="text-[11px] md:text-[10px] font-mono text-rose-600 mt-1.5 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {scanError}
          </p>
        )}
        {scanWarning && !scanError && (
          <p className="text-[11px] md:text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5 inline-flex items-center gap-1 leading-snug">
            {scanWarning}
          </p>
        )}
        <p className="text-[10px] md:text-[9px] font-mono text-slate-400 mt-1.5 leading-relaxed">
          Tap the field once, then scan — IMEI auto-submits when complete, no Enter needed.
          {' '}Manual entry: type · Enter to submit · Esc to skip.
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

// ── Scanner status chip ─────────────────────────────────────────────────────
// Compact status pill rendered in the scan toolbar. Three states matter to
// the operator:
//
//   - HID paired:    blue dot, device name, tap to disconnect — scanner
//                    output streams via WebHID regardless of focus.
//   - Input focused: green dot "Ready" — keyboard-emulation scanner output
//                    lands in the focused field.
//   - Input blurred: amber dot "Tap input" — the document keystroke fallback
//                    will catch a burst from anywhere on the page but the
//                    operator should refocus for the best experience.
//
// When WebHID is supported but no device is paired we show a "Pair" button.
// On unsupported browsers (Safari, iOS) we hide the WebHID controls entirely
// since the focused-input path is fully functional there.
function ScannerStatusChip({
  inputFocused, hidStatus, hidDeviceName, onConnect, onDisconnect,
}: {
  inputFocused: boolean;
  hidStatus: 'unsupported' | 'idle' | 'connecting' | 'connected' | 'error';
  hidDeviceName: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}) {
  if (hidStatus === 'connected') {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        data-bulk-scan-control
        title={`HID scanner paired: ${hidDeviceName} — click to disconnect`}
        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
        <span className="truncate max-w-[160px]">{hidDeviceName || 'HID scanner'}</span>
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border ${
          inputFocused
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}
        title={inputFocused ? 'Scanner ready — keystrokes land in the focused input' : 'Tap the input field to start scanning'}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${inputFocused ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {inputFocused ? 'Ready' : 'Tap input'}
      </span>
      {hidStatus !== 'unsupported' && (
        <button
          type="button"
          onClick={onConnect}
          disabled={hidStatus === 'connecting'}
          data-bulk-scan-control
          title="Pair a USB HID barcode scanner directly — capture works without focus"
          className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {hidStatus === 'connecting' ? 'Pairing…' : hidStatus === 'error' ? 'Retry pair' : 'Pair USB'}
        </button>
      )}
    </div>
  );
}

// ── Shared cell wrapper ──────────────────────────────────────────────────────
// Width is owned by the caller via `className` (mobile-first: pass
// `col-span-2 md:col-span-3` to occupy the full mobile row but only 3 cols
// of the desktop 12-col grid).
function FieldCell({
  label, className = '', error, children,
}: { label: string; className?: string; error?: boolean; children: React.ReactNode }) {
  return (
    <div className={className}>
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

