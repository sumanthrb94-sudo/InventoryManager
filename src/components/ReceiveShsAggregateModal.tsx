import React, { useMemo, useRef, useState } from 'react';
import { X, CheckCircle2, PackageCheck, Trash2, AlertCircle, ScanLine, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryAggregate, InventoryUnit, DeviceCategory } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { logInventoryEvent } from '../lib/inventoryEvents';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';

interface Props {
  aggregate: InventoryAggregate;
  onClose: () => void;
}

/** Pair captured per scanned line — the user can pick the colour for each
 *  IMEI when the aggregate has multiple colours (PINK 1 BLUE 1). */
interface ScannedItem { imei: string; colour: string; }

/** Best-effort category inference from a model string (mirrors ScanInModal's
 *  heuristic — kept local to avoid coupling to ImportModal). */
function inferCategory(model: string): DeviceCategory {
  const m = (model || '').toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY')) {
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  }
  return 'Other';
}

/** Slugify identical to the SHS placeholder id encoding used at import time
 *  (src/components/ImportModal.tsx — keep in sync). */
function slug(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

export default function ReceiveShsAggregateModal({ aggregate, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [imeiInput, setImeiInput] = useState('');
  const [scanned, setScanned]     = useState<ScannedItem[]>([]);
  const [error, setError]         = useState('');
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);

  const supplierName = useMemo(() => {
    const id = aggregate.supplierIds?.[0];
    if (!id) return '—';
    const s = suppliers.find(x => x.id === id);
    return s?.name || id;
  }, [aggregate.supplierIds, suppliers]);

  // Original/expected qty for the partial-receive display. We treat the
  // CURRENT quantityNum as authoritative (decremented by previous partial
  // receives) and stamp `originalQuantityNum` on the aggregate on first
  // partial receive so subsequent opens can render "X/Y received".
  const expectedQty = aggregate.quantityNum ?? 1;
  const originalQty = (aggregate as any).originalQuantityNum ?? expectedQty;
  const alreadyReceived = Math.max(0, originalQty - expectedQty);

  const remaining = Math.max(0, expectedQty - scanned.length);
  const canSubmit = scanned.length > 0 && !saving && !saved;

  /** Apple devices allow alphanumeric serials (10-12 chars) alongside the
   *  canonical 15-digit IMEI. Detect from the aggregate's model. */
  const isAppleSerial = useMemo(() => isAppleDevice(aggregate.model), [aggregate.model]);

  /** Available colours from the aggregate's coloursMap, ordered by quantity
   *  descending. Each colour has a "slot count" — how many units of that
   *  colour the supplier said they hold (e.g. {PINK:1, BLUE:1} = 1 of each).
   *  Used to drive the colour dropdown next to each scanned IMEI and the
   *  auto-allocator that picks a default colour when the user just hits Add. */
  const colourSlots = useMemo<Array<{ colour: string; capacity: number }>>(() => {
    const map = aggregate.coloursMap ?? {};
    const entries = Object.entries(map).filter(([c, q]) => c.trim() && (q ?? 0) > 0);
    if (entries.length === 0) {
      // Fall back to a single "Unknown" slot equal to expectedQty when the
      // master file didn't break the row down by colour.
      const raw = (aggregate.coloursRaw ?? '').trim();
      const fallback = raw && !/\d/.test(raw) ? raw : 'Unknown';
      return [{ colour: fallback, capacity: expectedQty }];
    }
    return entries
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      .map(([colour, capacity]) => ({ colour, capacity: capacity ?? 0 }));
  }, [aggregate.coloursMap, aggregate.coloursRaw, expectedQty]);

  /** Pick the next colour slot that still has unused capacity, given the
   *  colours already chosen for previously-scanned items. */
  function nextColourSlot(soFar: ScannedItem[]): string {
    for (const slot of colourSlots) {
      const used = soFar.filter(s => s.colour === slot.colour).length;
      if (used < slot.capacity) return slot.colour;
    }
    return colourSlots[0]?.colour || 'Unknown';
  }

  /** Re-allocate a single scanned item's colour. Used by the per-row dropdown. */
  function setColourFor(idx: number, colour: string) {
    setScanned(prev => prev.map((s, i) => i === idx ? { ...s, colour } : s));
  }

  /** Add one IMEI (already trimmed) to the scanned list with validation. */
  async function addOne(rawImei: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const imei = rawImei.trim().toUpperCase();
    if (!imei) return { ok: false, reason: 'Empty' };

    // Hard cap: cannot scan more than expected. If the master file qty is
    // wrong, the operator must cancel and edit the SHS aggregate first.
    if (scanned.length >= expectedQty) {
      return { ok: false, reason: `Already scanned all ${expectedQty} expected — cancel to add more.` };
    }
    if (!isValidImei(imei, { isAppleSerial })) {
      return { ok: false, reason: isAppleSerial ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE };
    }
    if (scanned.some(s => s.imei === imei)) {
      return { ok: false, reason: 'IMEI already in this batch' };
    }
    const exists = await dbService.imeiExists(imei);
    if (exists) {
      return { ok: false, reason: 'IMEI already in inventory' };
    }
    // Allocate the first colour in the aggregate's coloursMap that still has
    // remaining capacity; falls back to coloursRaw or the literal 'Unknown'.
    const colour = nextColourSlot(scanned);
    setScanned(prev => [...prev, { imei, colour }]);
    return { ok: true };
  }

  /** Handle Enter on the input — supports single scan OR pasted multi-line list. */
  async function handleSubmitInput(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const raw = imeiInput;
    // Multi-line paste: split on whitespace/newlines, add each in turn.
    const tokens = raw.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return;

    let added = 0;
    let lastErr = '';
    for (const tok of tokens) {
      const res = await addOne(tok);
      if (res.ok === true) {
        added++;
      } else {
        lastErr = res.reason;
      }
    }

    setImeiInput('');
    if (added === 0 && lastErr) {
      setError(lastErr);
    } else if (added > 0 && lastErr && tokens.length > 1) {
      // Mixed result — surface the last error but keep the batch.
      setError(`${added} added · ${lastErr}`);
    }
    inputRef.current?.focus();
  }

  function removeImei(imei: string) {
    setScanned(prev => prev.filter(x => x.imei !== imei));
    setError('');
    inputRef.current?.focus();
  }

  async function handleReceive() {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const importBatchId = aggregate.importBatchId;
      const importedAt = new Date().toISOString();
      const dateIn = importedAt.slice(0, 10);
      const category = inferCategory(aggregate.model);
      const brand = (aggregate as any).brand ?? 'Other';

      // 1. Build one inventoryUnits doc per scanned IMEI. The operator
      //    picked a colour per row (defaulting via the auto-allocator);
      //    persist it so the unit lands in the correct SKU bucket.
      const newUnits: InventoryUnit[] = scanned.map(({ imei, colour }) => ({
        id: imei,
        imei,
        model: aggregate.model,
        brand,
        category,
        storage: aggregate.storage,
        colour: colour || 'Unknown',
        buyPrice: aggregate.buyPrice ?? 0,
        dateIn,
        supplierId: aggregate.supplierIds?.[0] ?? '',
        supplierIds: aggregate.supplierIds,
        status: 'available',
        statusRaw: 'Received from SHS',
        flags: [],
        notes: aggregate.notes ?? '',
        platformListed: false,
        listingSites: [],
        importBatchId,
        sourceFile: 'shs-receive',
        importedAt,
        ownerId: 'shared',
        createdAt: importedAt,
      } as InventoryUnit));

      await dbService.bulkCreate(
        newUnits.map(u => ({ collection: 'inventoryUnits', id: u.id, data: u })),
      );

      // 2. Delete the synthetic SHS placeholder unit (if present).
      const placeholderId = `shs_${slug(aggregate.model)}_${slug(supplierName)}_${aggregate.sourceRow}`;
      await dbService.delete('inventoryUnits', placeholderId).catch(() => {});

      // 3. Update the aggregate — partial vs full receive.
      const newRemaining = expectedQty - scanned.length;
      if (newRemaining <= 0) {
        await dbService.update('inventoryAggregates', aggregate.id, {
          quantityNum: 0,
          quantityText: 'RECEIVED',
          receivedAt: new Date().toISOString(),
          originalQuantityNum: originalQty,
        });
      } else {
        await dbService.update('inventoryAggregates', aggregate.id, {
          quantityNum: newRemaining,
          originalQuantityNum: originalQty,
        });
      }

      // 4. Log a inventoryEvents row.
      await logInventoryEvent({
        type: 'stock_adjusted',
        message: `Received ${newUnits.length} unit${newUnits.length === 1 ? '' : 's'} from SHS · ${aggregate.model} · ${supplierName}`,
        batchId: importBatchId,
      });

      // 5. Surface a notification (reuse shs_received).
      notificationService.addNotification('shs_received', newUnits[0], undefined, newUnits.length);

      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setError(err?.message || 'Receive failed — please try again');
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-orange-500 text-white rounded-xl flex items-center justify-center flex-shrink-0">
              <PackageCheck size={15} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">Receive SHS into stock</p>
              <p className="text-[9px] text-gray-400 font-mono truncate">
                {aggregate.model}
                {aggregate.storage ? ` · ${aggregate.storage}` : ''}
                {aggregate.coloursRaw ? ` · ${aggregate.coloursRaw}` : ''}
                {' · '}{supplierName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Summary strip */}
        <div className="px-5 pt-4 pb-2 grid grid-cols-3 gap-2">
          <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-orange-600">Expected</p>
            <p className="text-lg font-bold text-orange-700 leading-tight">{expectedQty}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">Scanned</p>
            <p className="text-lg font-bold text-emerald-700 leading-tight">{scanned.length}</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">BP / unit</p>
            <p className="text-lg font-bold text-gray-700 leading-tight">
              £{aggregate.buyPrice ?? '—'}
            </p>
          </div>
        </div>
        {alreadyReceived > 0 && (
          <div className="px-5 pb-2">
            <p className="text-[9px] font-mono text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 inline-block">
              {alreadyReceived}/{originalQty} already received · {expectedQty} remaining
            </p>
          </div>
        )}

        {/* Body — IMEI list + input */}
        <div className="px-5 pb-3 max-h-[50dvh] overflow-y-auto">
          <AnimatePresence initial={false}>
            {scanned.length === 0 ? (
              <div className="py-6 flex flex-col items-center gap-2 text-gray-300">
                <ScanLine size={28} />
                <p className="text-[10px] font-mono">No IMEIs scanned yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 mb-3">
                {scanned.map(({ imei, colour }, idx) => (
                  <motion.div
                    key={imei}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 8 }}
                    className="flex items-center gap-2 py-2"
                  >
                    <span className="text-[9px] font-mono text-gray-400 w-6 text-right">{idx + 1}</span>
                    <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                    <span className="text-[11px] font-mono text-gray-800 flex-1 truncate">{imei}</span>
                    {/* Per-row colour picker — only shown when the aggregate
                        has more than one colour slot. Auto-allocator picks a
                        sensible default; operator can override here. */}
                    {colourSlots.length > 1 && (
                      <select
                        value={colour}
                        onChange={e => setColourFor(idx, e.target.value)}
                        className="text-[10px] font-mono border border-gray-200 rounded px-2 py-0.5 bg-white focus:outline-none focus:border-black"
                      >
                        {colourSlots.map(s => (
                          <option key={s.colour} value={s.colour}>
                            {s.colour} ({scanned.filter(x => x.colour === s.colour).length}/{s.capacity})
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() => removeImei(imei)}
                      className="p-1 text-red-400 hover:bg-red-50 rounded transition-all"
                      title="Remove"
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>

          {/* Input row */}
          <form onSubmit={handleSubmitInput} className="space-y-2">
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400">
              Scan or paste IMEI{remaining > 0 ? ` · ${remaining} to go` : ''}
              {remaining === 0 && (
                <span className="ml-2 text-emerald-700">
                  · All {expectedQty} scanned — click Receive below
                </span>
              )}
            </label>
            <div className="flex items-stretch gap-2">
              <input
                ref={inputRef}
                autoFocus
                value={imeiInput}
                onChange={e => { setImeiInput(e.target.value); setError(''); }}
                placeholder={remaining === 0
                  ? `Reached expected quantity (${expectedQty}). Cancel to revise.`
                  : isAppleSerial
                    ? '15-digit IMEI or 10-12 char Apple serial'
                    : '15-digit IMEI (digits only — no letters)'}
                inputMode={isAppleSerial ? 'text' : 'numeric'}
                disabled={remaining === 0}
                maxLength={isAppleSerial ? 12 : 15}
                className={`flex-1 min-w-0 border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                  error
                    ? 'border-red-300 bg-red-50'
                    : remaining === 0
                      ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                      : 'border-gray-200 focus:border-black bg-white'
                }`}
              />
              <button
                type="submit"
                disabled={!imeiInput.trim() || remaining === 0}
                className="px-4 py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 flex-shrink-0"
              >
                <Plus size={12} /> Add
              </button>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-[10px] text-red-600 font-mono bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                <AlertCircle size={11} />
                {error}
              </div>
            )}
            <p className="text-[9px] font-mono text-gray-400">
              Tip: paste a multi-line list to add many IMEIs in one go.
            </p>
          </form>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <p className="text-[10px] font-mono text-gray-500">
            {scanned.length} of {expectedQty} received
            {remaining > 0 && ` · ${remaining} remaining`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              type="button"
              className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleReceive}
              disabled={!canSubmit}
              className="px-4 py-2.5 bg-orange-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {saved
                ? <><CheckCircle2 size={12} /> Received!</>
                : saving
                  ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <>Receive {scanned.length} unit{scanned.length === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
