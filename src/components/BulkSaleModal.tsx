/**
 * BulkSaleModal — "Mark Multiple Sold": record several sales (office units,
 * SHS units, and/or accessory pools, in any mix) in one sitting.
 *
 * Flow: tap "+ Add Sale" to open the same Office/SHS/Accessory picker
 * SellOrderModal's single-sale entry point uses (SellUnitPicker, exported
 * from SellSheet.tsx), pick a unit or accessory, fill in its per-line form
 * — same fields, same platform-button grid, same postage/VAT/payment-mode
 * controls as the single "Record Sale" flow (SellOrderModal /
 * AccessorySaleModal) — repeat, then hit "Confirm N Sales" once.
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
import { useState, useMemo, type Key } from 'react';
import {
  X, Plus, CheckCircle2, Trash2, ShoppingCart, Truck, Tag, Minus, Package, ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { InventoryUnit, AccessoryStock, Marketplace } from '../types';
import { useIsAdmin } from '../lib/useIsAdmin';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import { recordBulkSales, type BulkSaleLine, type BulkSaleLineResult } from '../services/salesService';
import { registerSessionSoldUnits } from '../hooks/useRealTimeNotifications';
import {
  ACTIVE_PLATFORMS, PLATFORM_META, BM_PAYMENT_MODES, POSTAGE_PRESETS, SalePLBreakdown,
} from './SellOrderModal';
import { SellUnitPicker } from './SellSheet';

const today = () => new Date().toISOString().split('T')[0];

// Same UI-only autofill table SellOrderModal/AccessorySaleModal use — not
// part of calcSaleFinancials, just what the postage dropdown defaults to
// before the operator picks/types a value.
const UI_AUTOFILL_POSTAGE: Record<Marketplace, number> = {
  AMAZON: 6.30, BM: 6.30, ONBUY: 6.30, EBAY: 0, TEMU: 6.30,
};

type DraftLine =
  | {
      key: string;
      kind: 'unit';
      unit: InventoryUnit;
      isSHS: boolean;
      imei: string;
      sku: string;
      marketplace: Marketplace;
      orderNumber: string;
      salePrice: string;
      saleDate: string;
      postageInput: string;
      postageOther: boolean;
      postageVatExempt: boolean;
      paymentMode: string;
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
      postageInput: string;
      postageOther: boolean;
      postageVatExempt: boolean;
      paymentMode: string;
    };

let draftKeySeq = 0;
const nextKey = () => `draft-${++draftKeySeq}`;

function newUnitDraft(u: InventoryUnit, isSHS: boolean): DraftLine {
  return {
    key: nextKey(), kind: 'unit', unit: u, isSHS,
    imei: (u.imei || '').trim(), sku: u.sku || '',
    marketplace: 'EBAY', orderNumber: '', salePrice: '', saleDate: today(),
    postageInput: '', postageOther: false, postageVatExempt: false, paymentMode: '',
  };
}
function newAccessoryDraft(a: AccessoryStock): DraftLine {
  return {
    key: nextKey(), kind: 'accessory', accessory: a, quantity: 1,
    marketplace: 'EBAY', orderNumber: '', salePrice: '', saleDate: today(),
    postageInput: '', postageOther: false, postageVatExempt: false, paymentMode: '',
  };
}

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
    setLines(ls => [...ls, newUnitDraft(u, isSHS)]);
    setPickerOpen(false);
  };
  const addAccessoryLine = (a: AccessoryStock) => {
    setLines(ls => [...ls, newAccessoryDraft(a)]);
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

  const effectivePostage = (l: DraftLine): number => {
    const defaultPostage = UI_AUTOFILL_POSTAGE[l.marketplace] || getMarketplaceFee(l.marketplace).postage;
    return l.postageInput.trim() !== '' ? (Number(l.postageInput) || defaultPostage) : defaultPostage;
  };

  const handleConfirm = async () => {
    if (!isAdminUser || !allValid || saving) return;
    setSaving(true);

    const batch: BulkSaleLine[] = lines.map(l => l.kind === 'unit'
      ? {
          kind: 'unit', unit: l.unit, isSHS: l.isSHS, imei: l.imei.trim() || undefined,
          marketplace: l.marketplace, orderNumber: l.orderNumber.trim(),
          salePrice: Number(l.salePrice), saleDate: l.saleDate,
          sku: l.sku.trim() || undefined,
          paymentMode: l.marketplace === 'BM' ? (l.paymentMode || undefined) : undefined,
          postageOverride: effectivePostage(l),
          postageVatExempt: l.postageVatExempt,
        }
      : {
          kind: 'accessory', sku: l.accessory.sku, quantity: l.quantity,
          marketplace: l.marketplace, orderNumber: l.orderNumber.trim(),
          salePrice: Number(l.salePrice), saleDate: l.saleDate,
          paymentMode: l.marketplace === 'BM' ? (l.paymentMode || undefined) : undefined,
          postageOverride: effectivePostage(l),
          postageVatExempt: l.postageVatExempt,
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
        className="bg-white rounded-3xl w-full max-w-xl shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {lines.length === 0 && (
            <p className="text-center text-[11px] font-mono text-slate-400 py-10">
              Add a unit or accessory to start the batch.
            </p>
          )}
          {lines.map(l => (
            <BulkSaleLineCard
              key={l.key}
              line={l}
              defaultPostage={UI_AUTOFILL_POSTAGE[l.marketplace] || getMarketplaceFee(l.marketplace).postage}
              onPatch={patch => patchLine(l.key, patch)}
              onRemove={() => removeLine(l.key)}
            />
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

// ── Per-line form — mirrors SellOrderModal / AccessorySaleModal's fields ────
// so a batch line looks and behaves exactly like the single-sale flow: the
// same colour-coded platform grid, the same Sale Price / Postage / No P.VAT
// / Payment Mode controls, the same live P&L breakdown once a price is typed.
function BulkSaleLineCard({
  line: l, defaultPostage, onPatch, onRemove,
}: {
  key?: Key;
  line: DraftLine;
  defaultPostage: number;
  onPatch: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const spNum = Number(l.salePrice) || 0;
  const postageNum = Number(l.postageInput);
  const inputIsPreset = l.postageInput !== '' && !Number.isNaN(postageNum) && POSTAGE_PRESETS.includes(postageNum);
  const showOtherInput = l.postageOther || (l.postageInput !== '' && !inputIsPreset);
  const effectivePostage = l.postageInput.trim() !== '' ? (Number(l.postageInput) || defaultPostage) : defaultPostage;

  const bpLineTotal = l.kind === 'unit' ? l.unit.buyPrice : (l.accessory.buyPrice || 0) * l.quantity;
  const breakdown = spNum > 0
    ? calcSaleFinancials({
        marketplace: l.marketplace, buyPrice: bpLineTotal, salePrice: spNum,
        postageOverride: effectivePostage, postageVatExempt: l.postageVatExempt,
      })
    : null;

  return (
    <div className={`border rounded-2xl overflow-hidden ${l.kind === 'unit' && l.isSHS ? 'border-amber-200' : l.kind === 'accessory' ? 'border-indigo-200' : 'border-slate-200'}`}>
      {/* Header — mirrors the single-sale modal's title block */}
      <div className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${
        l.kind === 'accessory' ? 'bg-indigo-50 border-indigo-100' : l.kind === 'unit' && l.isSHS ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'
      }`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
            l.kind === 'accessory' ? 'bg-indigo-600' : l.kind === 'unit' && l.isSHS ? 'bg-amber-500' : 'bg-slate-900'
          }`}>
            {l.kind === 'unit' && l.isSHS ? <Truck size={15} className="text-white" /> : <Package size={15} className="text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
              {l.kind === 'accessory' ? 'Accessory' : l.isSHS ? 'Supplier Direct Sale' : 'Office Stock'}
            </p>
            <h4 className="text-[13px] font-bold truncate">{l.kind === 'unit' ? l.unit.model : l.accessory.name}</h4>
            <p className="text-[9px] text-slate-500 font-mono truncate">
              {l.kind === 'unit'
                ? `${l.unit.colour}${l.unit.storage ? ` · ${l.unit.storage}` : ''} · BP £${l.unit.buyPrice}`
                : `${l.accessory.sku} · ${l.accessory.quantity} in stock · BP £${(l.accessory.buyPrice ?? 0).toFixed(2)}/unit`}
            </p>
          </div>
        </div>
        <button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-white/70 text-slate-400 hover:text-rose-600 flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* IMEI — SHS units only */}
        {l.kind === 'unit' && l.isSHS && (
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
              IMEI / Serial *
            </label>
            <input
              value={l.imei}
              onChange={e => onPatch({ imei: e.target.value })}
              placeholder="Enter IMEI / serial"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
            />
          </div>
        )}

        {/* Platform picker — same grid as the single-sale flow */}
        <div>
          <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-2">Platform *</label>
          <div className="grid grid-cols-2 gap-2">
            {ACTIVE_PLATFORMS.map(p => {
              const meta = PLATFORM_META[p];
              const active = l.marketplace === p;
              return (
                <button
                  key={p}
                  onClick={() => onPatch({ marketplace: p, postageInput: '', postageOther: false, postageVatExempt: false, paymentMode: '' })}
                  className={`py-2.5 px-3 rounded-xl border text-[11px] font-bold transition-all flex items-center justify-between ${
                    active ? `${meta.activeBg} text-white border-transparent` : meta.tone
                  }`}
                >
                  <span>{meta.label}</span>
                  {active ? <CheckCircle2 size={12} /> : <ChevronRight size={12} className="opacity-60" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Order Number + SKU (unit) / Quantity (accessory) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Order Number *</label>
            <input
              value={l.orderNumber}
              onChange={e => onPatch({ orderNumber: e.target.value })}
              placeholder="e.g. 01-14475-65087"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
            />
          </div>
          {l.kind === 'unit' ? (
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                <Tag size={9} className="inline mr-1" /> SKU
              </label>
              <input
                value={l.sku}
                onChange={e => onPatch({ sku: e.target.value })}
                placeholder="Optional"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
              />
            </div>
          ) : (
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                <Tag size={9} className="inline mr-1" /> Quantity *
              </label>
              <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                <button type="button" onClick={() => onPatch({ quantity: Math.max(1, l.quantity - 1) })}
                  className="px-2.5 py-2.5 text-slate-500 hover:bg-slate-50"><Minus size={12} /></button>
                <input
                  type="number" min="1" max={l.accessory.quantity || undefined} value={l.quantity}
                  onChange={e => onPatch({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                  className="w-full text-center text-sm font-mono focus:outline-none py-2.5"
                />
                <button type="button" onClick={() => onPatch({ quantity: Math.min(l.accessory.quantity || l.quantity + 1, l.quantity + 1) })}
                  className="px-2.5 py-2.5 text-slate-500 hover:bg-slate-50"><Plus size={12} /></button>
              </div>
            </div>
          )}
        </div>
        {l.kind === 'accessory' && l.quantity > (l.accessory.quantity ?? 0) && (
          <p className="text-[10px] font-mono text-rose-600 -mt-2">Only {l.accessory.quantity} left in stock.</p>
        )}

        {/* Sale price — line total */}
        <div>
          <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
            Sale Price (£) *
            {l.kind === 'accessory' && (
              <span className="normal-case font-normal text-slate-400"> · total for {l.quantity} unit{l.quantity === 1 ? '' : 's'}</span>
            )}
          </label>
          <input
            type="number"
            value={l.salePrice}
            onChange={e => onPatch({ salePrice: e.target.value })}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold font-mono focus:outline-none focus:border-slate-900 transition-all"
          />
        </div>

        {/* Sale Date + Postage */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Sale Date</label>
            <input
              type="date"
              value={l.saleDate}
              onChange={e => onPatch({ saleDate: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Postage (£)</label>
              <label className="inline-flex items-center gap-1 text-[9px] font-mono text-slate-500 cursor-pointer select-none" title="Zero-rate postage VAT for this sale">
                <input
                  type="checkbox"
                  checked={l.postageVatExempt}
                  onChange={e => onPatch({ postageVatExempt: e.target.checked })}
                  className="h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                No P. VAT
              </label>
            </div>
            <div className="space-y-1.5">
              <select
                value={inputIsPreset ? String(postageNum) : (showOtherInput ? '__other__' : '')}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__other__') onPatch({ postageOther: true });
                  else if (v === '') onPatch({ postageOther: false, postageInput: '' });
                  else onPatch({ postageOther: false, postageInput: v });
                }}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 bg-white transition-all"
              >
                <option value="">Default £{defaultPostage.toFixed(2)}</option>
                {POSTAGE_PRESETS.map(p => (
                  <option key={p} value={String(p)}>£{p.toFixed(2)}</option>
                ))}
                <option value="__other__">Other…</option>
              </select>
              {showOtherInput && (
                <input
                  type="number"
                  value={l.postageInput}
                  onChange={e => onPatch({ postageInput: e.target.value })}
                  placeholder="Manual postage £"
                  min="0"
                  step="0.01"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
                />
              )}
            </div>
          </div>
        </div>

        {/* Payment mode — BM only */}
        {l.marketplace === 'BM' && (
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
              Payment Mode <span className="normal-case font-normal text-slate-500">· drives the 2.5% Klarna/PayPal fee</span>
            </label>
            <select
              value={l.paymentMode}
              onChange={e => onPatch({ paymentMode: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all bg-white"
            >
              {BM_PAYMENT_MODES.map(pm => (
                <option key={pm || '_none'} value={pm}>{pm || '(none / cash)'}</option>
              ))}
            </select>
          </div>
        )}

        {breakdown && (
          <SalePLBreakdown marketplace={l.marketplace} breakdown={breakdown} bp={bpLineTotal} sp={spNum} />
        )}
      </div>
    </div>
  );
}
