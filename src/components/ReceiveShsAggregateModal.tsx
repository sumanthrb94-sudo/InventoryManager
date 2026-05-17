import React, { useMemo, useRef, useState } from 'react';
import { X, CheckCircle2, PackageCheck, Trash2, AlertCircle, ScanLine, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryAggregate, InventoryUnit, DeviceCategory } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { logInventoryEvent } from '../lib/inventoryEvents';
import { isValidImei } from '../lib/imeiValidation';

interface Props {
  aggregate: InventoryAggregate;
  onClose: () => void;
}

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
  const [scanned, setScanned]     = useState<string[]>([]);
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

  /** Add one IMEI (already trimmed) to the scanned list with validation. */
  async function addOne(rawImei: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const imei = rawImei.trim();
    if (!imei) return { ok: false, reason: 'Empty' };

    if (!isValidImei(imei)) {
      return { ok: false, reason: `Invalid IMEI: ${imei}` };
    }
    if (scanned.includes(imei)) {
      return { ok: false, reason: 'IMEI already in this batch' };
    }
    const exists = await dbService.imeiExists(imei);
    if (exists) {
      return { ok: false, reason: 'IMEI already in inventory' };
    }
    setScanned(prev => [...prev, imei]);
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
    setScanned(prev => prev.filter(x => x !== imei));
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

      // 1. Build one inventoryUnits doc per scanned IMEI.
      const newUnits: InventoryUnit[] = scanned.map(imei => ({
        id: imei,
        imei,
        model: aggregate.model,
        brand,
        category,
        storage: aggregate.storage,
        colour: '', // operator can edit later — most SHS rows are mixed-colour
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
                {scanned.map((imei, idx) => (
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
            </label>
            <div className="flex items-stretch gap-2">
              <input
                ref={inputRef}
                autoFocus
                value={imeiInput}
                onChange={e => { setImeiInput(e.target.value); setError(''); }}
                placeholder="Type or paste IMEI then click Add (or press Enter)"
                inputMode="text"
                className={`flex-1 min-w-0 border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                  error ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-black bg-white'
                }`}
              />
              <button
                type="submit"
                disabled={!imeiInput.trim()}
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
