/**
 * BulkSaleModal — "Mark Multiple Sold": record several sales (office units,
 * SHS units, and/or accessory pools, in any mix) in one sitting.
 *
 * Flow: tap "+ Add Sale" to open the same Office/SHS/Accessory picker
 * SellOrderModal's single-sale entry point uses (SellUnitPicker, exported
 * from SellSheet.tsx), pick a unit or accessory, fill in its minimal
 * per-line fields (Marketplace / Order Number / Sale Price, plus IMEI for
 * a fresh SHS unit or Quantity for an accessory line), repeat, then hit
 * "Confirm N Sales" once.
 *
 * Each line still goes through recordSale()/recordAccessorySale() via
 * recordBulkSales() — the SAME calcSaleFinancials math and unit status-flip
 * logic as a single sale, just looped. This modal only owns the batch UI and
 * the notification-flood guard: a loop of N recordSale() calls flips N unit
 * docs across N separate store updates, so without registering the whole
 * batch up front the store-diffing "sold" hook in useRealTimeNotifications
 * would fire a toast per unit per batch. One completion summary here
 * replaces that entirely — no per-line toasts.
 */
import { useState, useMemo } from 'react';
import {
  X, Plus, CheckCircle2, AlertCircle, Trash2, ShoppingCart, Truck, Tag, Minus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { InventoryUnit, AccessoryStock, Marketplace } from '../types';
import { useIsAdmin } from '../lib/useIsAdmin';
import { recordBulkSales, type BulkSaleLine, type BulkSaleLineResult } from '../services/salesService';
import { registerSessionSoldUnits } from '../hooks/useRealTimeNotifications';
import { ACTIVE_PLATFORMS, PLATFORM_META } from './SellOrderModal';
import { SellUnitPicker } from './SellSheet';

const today = () => new Date().toISOString().split('T')[0];

type DraftLine =
  | {
      key: string;
      kind: 'unit';
      unit: InventoryUnit;
      isSHS: boolean;
      imei: string;
      marketplace: Marketplace;
      orderNumber: string;
      salePrice: string;
      saleDate: string;
    }
  | {
      key: string;
      kind: 'accessory';
      accessory: AccessoryStock;
      quantity: number;
      marketplace: Marketplace;
      orderNumber: string;
      salePrice: string;
      saleDate: string;
    };

let draftKeySeq = 0;
const nextKey = () => `draft-${++draftKeySeq}`;

interface Props {
  units: InventoryUnit[];      // sellable office stock (status === 'available')
  shsUnits: InventoryUnit[];   // sellable SHS units (status === 'incoming')
  accessoryStock: AccessoryStock[];
  supplierMap: Record<string, string>;
  onClose: () => void;
  onSaved?: () => void;
}

export default function BulkSaleModal({ units, shsUnits, accessoryStock, supplierMap, onClose, onSaved }: Props) {
  const isAdminUser = useIsAdmin();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<BulkSaleLineResult[] | null>(null);

  // Already-picked units/accessories shouldn't reappear in the picker —
  // otherwise the operator could add the same phone to the batch twice.
  const pickedUnitIds = useMemo(
    () => new Set(lines.filter(l => l.kind === 'unit').map(l => (l as any).unit.id as string)),
    [lines],
  );
  const pickedSkus = useMemo(
    () => new Set(lines.filter(l => l.kind === 'accessory').map(l => (l as any).accessory.sku as string)),
    [lines],
  );
  const pickerUnits = useMemo(() => units.filter(u => !pickedUnitIds.has(u.id)), [units, pickedUnitIds]);
  const pickerShs = useMemo(() => shsUnits.filter(u => !pickedUnitIds.has(u.id)), [shsUnits, pickedUnitIds]);
  const pickerAccessories = useMemo(() => accessoryStock.filter(a => !pickedSkus.has(a.sku)), [accessoryStock, pickedSkus]);

  const addUnitLine = (u: InventoryUnit, isSHS: boolean) => {
    setLines(ls => [...ls, {
      key: nextKey(), kind: 'unit', unit: u, isSHS,
      imei: (u.imei || '').trim(),
      marketplace: 'EBAY', orderNumber: '', salePrice: '', saleDate: today(),
    }]);
    setPickerOpen(false);
  };
  const addAccessoryLine = (a: AccessoryStock) => {
    setLines(ls => [...ls, {
      key: nextKey(), kind: 'accessory', accessory: a, quantity: 1,
      marketplace: 'EBAY', orderNumber: '', salePrice: '', saleDate: today(),
    }]);
    setPickerOpen(false);
  };
  const removeLine = (key: string) => setLines(ls => ls.filter(l => l.key !== key));
  const patchLine = (key: string, patch: Partial<DraftLine>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } as DraftLine : l)));

  const lineIsValid = (l: DraftLine): boolean => {
    if (!l.marketplace || !l.orderNumber.trim()) return false;
    const sp = Number(l.salePrice);
    if (!Number.isFinite(sp) || sp <= 0) return false;
    if (l.kind === 'unit' && l.isSHS && !l.imei.trim()) return false;
    if (l.kind === 'accessory' && !(l.quantity > 0)) return false;
    return true;
  };
  const allValid = lines.length > 0 && lines.every(lineIsValid);

  const handleConfirm = async () => {
    if (!isAdminUser || !allValid || saving) return;
    setSaving(true);

    const batch: BulkSaleLine[] = lines.map(l => l.kind === 'unit'
      ? {
          kind: 'unit', unit: l.unit, isSHS: l.isSHS, imei: l.imei.trim() || undefined,
          marketplace: l.marketplace, orderNumber: l.orderNumber.trim(),
          salePrice: Number(l.salePrice), saleDate: l.saleDate,
        }
      : {
          kind: 'accessory', sku: l.accessory.sku, quantity: l.quantity,
          marketplace: l.marketplace, orderNumber: l.orderNumber.trim(),
          salePrice: Number(l.salePrice), saleDate: l.saleDate,
        });

    // Register every unit this batch is about to flip to 'sold' BEFORE the
    // write loop starts, so the store-diffing "sold" notification hook skips
    // them entirely — see the header comment for why per-line toasts would
    // otherwise flood in across the batch's several store updates.
    const unitIds = lines.filter(l => l.kind === 'unit').map(l => (l as any).unit.id as string);
    const unregister = registerSessionSoldUnits(unitIds, 10 * 60 * 1000);
    try {
      const result = await recordBulkSales(batch);
      setSummary(result.results);
      if (result.failed === 0 && onSaved) onSaved();
    } finally {
      setSaving(false);
      setTimeout(() => unregister(), 1500);
    }
  };

  // ── Completion summary ─────────────────────────────────────────────────
  if (summary) {
    const succeeded = summary.filter(r => r.ok);
    const failed = summary.filter(r => !r.ok);
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${failed.length === 0 ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                <CheckCircle2 size={17} className="text-white" />
              </div>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Bulk sale complete</p>
                <h3 className="text-sm font-bold">{succeeded.length} of {summary.length} sales recorded</h3>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
            {summary.map((r, i) => (
              <div key={i} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border text-[11px] font-mono ${
                r.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}>
                <span className="truncate">{r.label}</span>
                <span className="flex-shrink-0">{r.ok ? 'Sold' : (r.message || r.error || 'Failed')}</span>
              </div>
            ))}
          </div>
          <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100">
            <button
              onClick={onClose}
              className="w-full py-3 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-700 transition-all"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Batch builder ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center"><ShoppingCart size={17} /></div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Mark multiple sold</p>
              <h3 className="text-sm font-bold">{lines.length} sale{lines.length === 1 ? '' : 's'} pending</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {lines.length === 0 && (
            <p className="text-center text-[11px] font-mono text-slate-400 py-10">
              Add a unit or accessory to start the batch.
            </p>
          )}
          {lines.map(l => (
            <div key={l.key} className="border border-slate-200 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {l.kind === 'unit' && l.isSHS && <Truck size={13} className="text-amber-600 flex-shrink-0" />}
                  {l.kind === 'accessory' && <Tag size={13} className="text-indigo-600 flex-shrink-0" />}
                  <p className="text-[12px] font-bold text-slate-900 truncate">
                    {l.kind === 'unit' ? l.unit.model : l.accessory.name}
                  </p>
                  <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-md flex-shrink-0 ${
                    l.kind === 'accessory' ? 'bg-indigo-100 text-indigo-700'
                    : l.isSHS ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {l.kind === 'accessory' ? 'Accessory' : l.isSHS ? 'SHS' : 'Office'}
                  </span>
                </div>
                <button onClick={() => removeLine(l.key)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex-shrink-0">
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <select
                  value={l.marketplace}
                  onChange={e => patchLine(l.key, { marketplace: e.target.value as Marketplace })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono bg-white focus:outline-none focus:border-slate-900"
                >
                  {ACTIVE_PLATFORMS.map(p => (
                    <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                  ))}
                </select>
                <input
                  value={l.orderNumber}
                  onChange={e => patchLine(l.key, { orderNumber: e.target.value })}
                  placeholder="Order #"
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-slate-900"
                />
                <input
                  type="number" min="0.01" step="0.01"
                  value={l.salePrice}
                  onChange={e => patchLine(l.key, { salePrice: e.target.value })}
                  placeholder="Sale £"
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-slate-900"
                />
                <input
                  type="date"
                  value={l.saleDate}
                  onChange={e => patchLine(l.key, { saleDate: e.target.value })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-slate-900"
                />
              </div>

              {l.kind === 'unit' && l.isSHS && (
                <input
                  value={l.imei}
                  onChange={e => patchLine(l.key, { imei: e.target.value })}
                  placeholder="IMEI / serial *"
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-slate-900"
                />
              )}
              {l.kind === 'accessory' && (
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Qty</span>
                  <button type="button" onClick={() => patchLine(l.key, { quantity: Math.max(1, l.quantity - 1) })}
                    className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Minus size={11} /></button>
                  <input
                    type="number" min="1" max={l.accessory.quantity || undefined} value={l.quantity}
                    onChange={e => patchLine(l.key, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-14 text-center border border-slate-200 rounded-lg px-1 py-1 text-[11px] font-mono focus:outline-none"
                  />
                  <button type="button" onClick={() => patchLine(l.key, { quantity: Math.min(l.accessory.quantity || l.quantity + 1, l.quantity + 1) })}
                    className="p-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Plus size={11} /></button>
                  <span className="text-[9px] font-mono text-slate-400">of {l.accessory.quantity} in stock</span>
                </div>
              )}
            </div>
          ))}

          <button
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 text-[10px] font-bold uppercase tracking-widest hover:border-slate-400 hover:text-slate-700 transition-all"
          >
            <Plus size={13} /> Add Sale
          </button>
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 flex gap-3 bg-white">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!allValid || saving}
            className="flex-1 py-3 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-700"
          >
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm {lines.length} Sale{lines.length === 1 ? '' : 's'}</>}
          </button>
        </div>

        <AnimatePresence>
          {pickerOpen && (
            <SellUnitPicker
              units={pickerUnits}
              shsUnits={pickerShs}
              accessoryStock={pickerAccessories}
              supplierMap={supplierMap}
              onClose={() => setPickerOpen(false)}
              onPick={addUnitLine}
              onPickAccessory={addAccessoryLine}
              title="Add a sale to the batch"
              subtitle="Pick a unit"
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
