import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, CheckCircle2, PackageCheck, AlertCircle, Plus, ScanLine } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryAggregate } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import {
  isValidImei,
  isAppleDevice,
  IMEI_REQUIRED_MESSAGE,
  IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
// Service layer — owns SHS qty cap, IMEI validation, duplicate guard,
// aggregate decrement, synthetic-placeholder cleanup, and audit-log emission.
import { receiveShsAggregate } from '../services';

interface Props {
  aggregate: InventoryAggregate;
  onClose: () => void;
}

/** One expected unit, flattened out of the aggregate's coloursMap. The
 *  operator scans/types an IMEI into the slot's input; we never let two
 *  slots hold the same IMEI in this batch. */
interface ColourSlot {
  /** Stable key per slot — `${colour}__${ordinal}`. Two pink units → pink__0, pink__1. */
  key: string;
  colour: string;
  /** 1-based ordinal within the colour group (e.g. "PINK · 1/3"). */
  ordinal: number;
  /** Total expected for this colour, used to render "PINK 1 of 3". */
  capacity: number;
  imei: string;
  /** Live validation feedback while the operator types. */
  error?: string;
}

export default function ReceiveShsAggregateModal({ aggregate, onClose }: Props) {
  const { suppliers } = useInventoryStore();
  const [bulkInput, setBulkInput] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const supplierName = useMemo(() => {
    const id = aggregate.supplierIds?.[0];
    if (!id) return '—';
    const s = suppliers.find(x => x.id === id);
    return s?.name || id;
  }, [aggregate.supplierIds, suppliers]);

  const apple = useMemo(() => isAppleDevice(aggregate.model), [aggregate.model]);

  // ── Expected slots ────────────────────────────────────────────────────────
  // Sum of coloursMap values is the source of truth — the INVENTORY sheet
  // QUANTITY column is often the literal "SHS" string (quantityNum undefined),
  // but the COLOURS column spells out the breakdown (PINK 1 BLUE 1 ...).
  // Fall back to quantityNum / 1 only when there's no colour map at all.
  const slotsTemplate = useMemo<Array<{ colour: string; capacity: number }>>(() => {
    const map = aggregate.coloursMap ?? {};
    const entries = Object.entries(map).filter(([c, q]) => c.trim() && (q ?? 0) > 0);
    if (entries.length === 0) {
      const fallbackQty = aggregate.quantityNum ?? 1;
      const raw = (aggregate.coloursRaw ?? '').trim();
      const fallbackColour = raw && !/\d/.test(raw) ? raw : 'Unknown';
      return [{ colour: fallbackColour, capacity: fallbackQty }];
    }
    return entries
      .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
      .map(([colour, capacity]) => ({ colour, capacity: capacity ?? 0 }));
  }, [aggregate.coloursMap, aggregate.coloursRaw, aggregate.quantityNum]);

  const expectedQty = useMemo(
    () => slotsTemplate.reduce((s, x) => s + x.capacity, 0),
    [slotsTemplate],
  );

  // Flat list of one slot per expected unit — this is what the body renders.
  const initialSlots = useMemo<ColourSlot[]>(() => {
    const out: ColourSlot[] = [];
    for (const { colour, capacity } of slotsTemplate) {
      for (let i = 0; i < capacity; i++) {
        out.push({
          key: `${colour}__${i}`,
          colour,
          ordinal: i + 1,
          capacity,
          imei: '',
        });
      }
    }
    return out;
  }, [slotsTemplate]);

  // Local slot state (mutable; one entry per expected unit).
  const [slots, setSlots] = useState<ColourSlot[]>(initialSlots);
  useEffect(() => { setSlots(initialSlots); }, [initialSlots]);

  // Partial-receive metadata for the "already received" banner.
  const originalQty = (aggregate as any).originalQuantityNum ?? expectedQty;
  const alreadyReceived = Math.max(0, originalQty - expectedQty);

  // ── Derived ───────────────────────────────────────────────────────────────
  const filledCount = useMemo(
    () => slots.filter(s => s.imei.trim().length > 0 && !s.error).length,
    [slots],
  );
  const remaining = expectedQty - filledCount;
  const canSubmit = filledCount > 0 && !saving && !saved;

  // ── Validation ────────────────────────────────────────────────────────────
  function validateImei(imei: string): string | undefined {
    const v = imei.trim().toUpperCase();
    if (!v) return undefined;
    if (!isValidImei(v, { isAppleSerial: apple })) {
      return apple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE;
    }
    return undefined;
  }

  /** Apply a single IMEI to a specific slot. Cross-slot duplicate guard runs
   *  on every change so two pink slots can't share an IMEI. */
  function setSlotImei(key: string, raw: string) {
    setGlobalError('');
    const next = raw.trim().toUpperCase();
    setSlots(prev => {
      // Cross-slot dupe check (case-insensitive)
      const dupeKey = next && prev.find(s => s.key !== key && s.imei.trim().toUpperCase() === next);
      return prev.map(s => {
        if (s.key !== key) return s;
        const err = dupeKey
          ? 'Duplicate IMEI in this batch'
          : validateImei(next);
        return { ...s, imei: raw, error: err };
      });
    });
  }

  /** Focus the next empty slot — driven by Enter on a single input. */
  function focusNextEmpty(currentKey: string) {
    const idx = slots.findIndex(s => s.key === currentKey);
    for (let i = idx + 1; i < slots.length; i++) {
      if (!slots[i].imei.trim()) {
        inputRefs.current[slots[i].key]?.focus();
        return;
      }
    }
    // No empty slot after current — wrap to earlier empties.
    for (let i = 0; i < idx; i++) {
      if (!slots[i].imei.trim()) {
        inputRefs.current[slots[i].key]?.focus();
        return;
      }
    }
  }

  /** Bulk-paste handler — fill empty slots in order with the pasted IMEIs. */
  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError('');
    const tokens = bulkInput.split(/[\s,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tokens.length === 0) return;
    setSlots(prev => {
      const next = [...prev];
      const usedAcrossExisting = new Set(
        next.filter(s => s.imei.trim()).map(s => s.imei.trim().toUpperCase())
      );
      let tokIdx = 0;
      let consumed = 0;
      for (let i = 0; i < next.length && tokIdx < tokens.length; i++) {
        if (next[i].imei.trim()) continue;
        const tok = tokens[tokIdx++];
        if (usedAcrossExisting.has(tok)) {
          next[i] = { ...next[i], imei: tok, error: 'Duplicate IMEI in this batch' };
        } else {
          next[i] = { ...next[i], imei: tok, error: validateImei(tok) };
          usedAcrossExisting.add(tok);
        }
        consumed++;
      }
      if (tokens.length > consumed) {
        setGlobalError(`${consumed} of ${tokens.length} pasted — no empty slots left for the rest`);
      }
      return next;
    });
    setBulkInput('');
  }

  function clearSlot(key: string) {
    setGlobalError('');
    setSlots(prev => prev.map(s => s.key === key ? { ...s, imei: '', error: undefined } : s));
    inputRefs.current[key]?.focus();
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleReceive() {
    if (!canSubmit) return;
    setSaving(true);
    setGlobalError('');
    try {
      // Only send slots with a non-empty, valid IMEI to the service.
      const scanned = slots
        .filter(s => s.imei.trim() && !s.error)
        .map(s => ({ imei: s.imei.trim().toUpperCase(), colour: s.colour }));
      const res = await receiveShsAggregate({ aggregate, scanned });

      if (!res.ok || res.receivedCount === 0) {
        const first = res.errors[0];
        setGlobalError(first
          ? `Receive rejected (${first.reason}) on ${first.imei || '(empty)'}`
          : 'Receive failed — please try again');
        setSaving(false);
        return;
      }

      if (res.errors.length > 0) {
        const e = res.errors[0];
        setGlobalError(`Received ${res.receivedCount} · ${res.errors.length} rejected (${e.reason})`);
      }

      setSaved(true);
      setTimeout(onClose, 900);
    } catch (err: any) {
      setGlobalError(err?.message || 'Receive failed — please try again');
      setSaving(false);
    }
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────
  // Group slots by colour for the section dividers.
  const groupedSlots = useMemo(() => {
    const groups: Array<{ colour: string; slots: ColourSlot[] }> = [];
    let current: { colour: string; slots: ColourSlot[] } | undefined;
    for (const s of slots) {
      if (!current || current.colour !== s.colour) {
        current = { colour: s.colour, slots: [s] };
        groups.push(current);
      } else {
        current.slots.push(s);
      }
    }
    return groups;
  }, [slots]);

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
        className="bg-white w-full md:max-w-lg rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col"
        style={{ maxHeight: 'calc(100dvh - 16px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
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
        <div className="px-5 pt-4 pb-2 grid grid-cols-3 gap-2 flex-shrink-0">
          <div className="bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-orange-600">Expected</p>
            <p className="text-lg font-bold text-orange-700 leading-tight">{expectedQty}</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">Filled</p>
            <p className="text-lg font-bold text-emerald-700 leading-tight">{filledCount}</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
            <p className="text-[8px] font-mono uppercase tracking-widest text-gray-500">BP / unit</p>
            <p className="text-lg font-bold text-gray-700 leading-tight">
              £{aggregate.buyPrice ?? '—'}
            </p>
          </div>
        </div>
        {alreadyReceived > 0 && (
          <div className="px-5 pb-2 flex-shrink-0">
            <p className="text-[9px] font-mono text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-1.5 inline-block">
              {alreadyReceived}/{originalQty} already received · {expectedQty} remaining
            </p>
          </div>
        )}

        {/* Body — colour-grouped slot inputs */}
        <div className="flex-1 overflow-y-auto px-5 pb-3">
          {expectedQty === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-gray-300">
              <ScanLine size={28} />
              <p className="text-[10px] font-mono">No expected units — close to revise the aggregate.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedSlots.map(group => {
                const groupFilled = group.slots.filter(s => s.imei.trim() && !s.error).length;
                return (
                  <section key={group.colour} className="border border-gray-100 rounded-2xl overflow-hidden bg-gray-50/40">
                    <header className="px-3 py-2 flex items-center justify-between bg-white border-b border-gray-100">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 flex items-center gap-1.5">
                        <ColourDot label={group.colour} />
                        {group.colour}
                      </p>
                      <p className="text-[9px] font-mono text-gray-500">
                        {groupFilled} / {group.slots.length}
                      </p>
                    </header>
                    <div className="divide-y divide-gray-100">
                      {group.slots.map(slot => {
                        const filled = slot.imei.trim().length > 0;
                        return (
                          <div key={slot.key} className="px-3 py-2 flex items-center gap-2">
                            <span className="text-[9px] font-mono text-gray-400 w-10 flex-shrink-0">
                              {slot.capacity > 1 ? `${slot.ordinal}/${slot.capacity}` : '·'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <input
                                ref={el => { inputRefs.current[slot.key] = el; }}
                                value={slot.imei}
                                onChange={e => setSlotImei(slot.key, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (!slot.error && slot.imei.trim()) focusNextEmpty(slot.key);
                                  }
                                }}
                                placeholder={apple
                                  ? '15-digit IMEI or 10-12 char serial'
                                  : '15-digit IMEI (digits only)'}
                                inputMode={apple ? 'text' : 'numeric'}
                                maxLength={apple ? 16 : 15}
                                disabled={saving || saved}
                                className={`w-full border rounded-lg px-3 py-2 text-[12px] font-mono focus:outline-none transition-all ${
                                  slot.error
                                    ? 'border-rose-300 bg-rose-50 focus:border-rose-500'
                                    : filled
                                      ? 'border-emerald-300 bg-emerald-50/50 focus:border-emerald-500'
                                      : 'border-gray-200 focus:border-black bg-white'
                                }`}
                              />
                              {slot.error && (
                                <p className="text-[9px] text-rose-600 font-mono mt-1 flex items-center gap-1">
                                  <AlertCircle size={10} /> {slot.error}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => clearSlot(slot.key)}
                              disabled={!filled || saving || saved}
                              className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded transition-all disabled:opacity-30"
                              title="Clear"
                            >
                              <X size={12} />
                            </button>
                            {filled && !slot.error && (
                              <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}

              {/* Bulk-paste shortcut — auto-fills remaining empty slots in order. */}
              {remaining > 1 && (
                <form onSubmit={handleBulkSubmit} className="border border-dashed border-gray-200 rounded-2xl p-3 bg-white">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 flex items-center gap-1.5">
                    <Plus size={10} /> Quick fill · paste IMEIs to fill remaining {remaining} slot{remaining === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-stretch gap-2">
                    <input
                      value={bulkInput}
                      onChange={e => setBulkInput(e.target.value)}
                      placeholder="Paste multi-line list — fills colour slots in order"
                      disabled={saving || saved}
                      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-black"
                    />
                    <button
                      type="submit"
                      disabled={!bulkInput.trim() || saving || saved}
                      className="px-3 py-2 bg-gray-900 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-40"
                    >
                      Fill
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] font-mono text-gray-500">
            {filledCount} of {expectedQty} ready
            {globalError && (
              <span className="ml-3 text-rose-600 inline-flex items-center gap-1">
                <AlertCircle size={11} /> {globalError}
              </span>
            )}
          </div>
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
                  : <>Receive {filledCount} unit{filledCount === 1 ? '' : 's'}</>}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── ColourDot — small swatch for the colour group header ────────────────────
// Maps a handful of common labels to actual hex tones so the operator's eyes
// can lock onto the right group quickly. Anything unknown gets a neutral
// slate dot with the first letter overlaid.
const COLOUR_HEX: Record<string, string> = {
  black: '#0f172a', white: '#f8fafc', grey: '#64748b', gray: '#64748b',
  silver: '#cbd5e1', gold: '#eab308', pink: '#ec4899', red: '#ef4444',
  orange: '#f97316', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6',
  navy: '#1e3a8a', purple: '#a855f7', violet: '#8b5cf6', brown: '#78350f',
  graphite: '#374151', titanium: '#94a3b8', 'space grey': '#374151',
  'space gray': '#374151', 'rose gold': '#f5a8a8', 'starlight': '#f1f5f9',
  midnight: '#0c0a1f', cream: '#fef3c7', mint: '#86efac', teal: '#14b8a6',
};

function ColourDot({ label }: { label: string }) {
  const norm = label.toLowerCase().trim();
  const hex = COLOUR_HEX[norm];
  if (hex) {
    return (
      <span
        className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
        style={{ backgroundColor: hex }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="w-3 h-3 rounded-full bg-slate-200 text-slate-600 text-[7px] font-bold flex items-center justify-center flex-shrink-0"
      aria-hidden
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}
