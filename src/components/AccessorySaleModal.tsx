/**
 * AccessorySaleModal — record a marketplace sale for a no-IMEI accessory
 * pool, in-app. The accessory counterpart of SellOrderModal: every real
 * accessory sale still normally arrives via the Sales Report import, but
 * this exists for the same reason SellOrderModal exists for phones — so
 * ops isn't forced to wait for the monthly bulk file just to log one sale
 * as it happens.
 *
 * Differences from SellOrderModal (no IMEI to anchor on):
 *   - Picks a SKU from the accessory pool instead of an inventory unit.
 *   - Carries a Quantity field — an accessory line routinely covers more
 *     than one unit (e.g. 3 chargers on one order), unlike a phone sale
 *     which is always exactly 1.
 *   - Sale Price is the TOTAL for the whole line (all units), matching the
 *     "line total, not per-unit" convention the Sales Report import already
 *     uses — so GP math (which never multiplies by quantity) stays correct.
 */
import { useState, useMemo } from 'react';
import { X, Package, AlertCircle, CheckCircle2, Tag, ChevronRight, Minus, Plus } from 'lucide-react';
import type { AccessoryStock, Marketplace } from '../types';
import { useIsAdmin } from '../lib/useIsAdmin';
import { calcSaleFinancials, getMarketplaceFee } from '../lib/platforms';
import { recordAccessorySale } from '../services/inventoryService';
import {
  ACTIVE_PLATFORMS, PLATFORM_META, BM_PAYMENT_MODES, POSTAGE_PRESETS, SalePLBreakdown,
} from './SellOrderModal';

const today = () => new Date().toISOString().split('T')[0];

interface Props {
  accessory: AccessoryStock;
  onClose: () => void;
  onSaved?: () => void;
}

export default function AccessorySaleModal({ accessory, onClose, onSaved }: Props) {
  const isAdminUser = useIsAdmin();

  const [marketplace, setMarketplace] = useState<Marketplace>('EBAY');
  const [orderId, setOrderId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sp, setSp] = useState('');
  const [saleDate, setSaleDate] = useState(today());
  const [postageInput, setPostageInput] = useState<string>('');
  const [postageOther, setPostageOther] = useState<boolean>(false);
  const [postageVatExempt, setPostageVatExempt] = useState<boolean>(false);
  const [paymentMode, setPaymentMode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const UI_AUTOFILL_POSTAGE: Record<Marketplace, number> = {
    AMAZON: 6.30, BM: 6.30, ONBUY: 6.30, EBAY: 0, TEMU: 6.30,
  };
  const defaultPostage = UI_AUTOFILL_POSTAGE[marketplace] || getMarketplaceFee(marketplace).postage;
  const effectivePostage =
    postageInput.trim() !== '' ? Number(postageInput) || defaultPostage
    : defaultPostage;

  const spNum = Number(sp) || 0;
  // Line-total buy price — quantity × the pool's per-unit BP. Not editable:
  // the per-unit cost is a known fact of the pool, only the operator-typed
  // sale price needs a form field.
  const bpLineTotal = (accessory.buyPrice || 0) * quantity;
  const breakdown = useMemo(() => {
    if (spNum <= 0) return null;
    return calcSaleFinancials({
      marketplace,
      buyPrice: bpLineTotal,
      salePrice: spNum,
      postageOverride: effectivePostage,
      postageVatExempt,
    });
  }, [marketplace, bpLineTotal, spNum, effectivePostage, postageVatExempt]);

  const maxQty = accessory.quantity ?? 0;

  const handleSave = async () => {
    if (!isAdminUser) { setError('Admin only.'); return; }
    if (!sp || spNum <= 0) { setError('Please enter a valid sale price.'); return; }
    if (!orderId.trim()) { setError('Please enter the order number from the platform.'); return; }
    if (!(quantity > 0)) { setError('Quantity must be at least 1.'); return; }
    if (quantity > maxQty) { setError(`Only ${maxQty} left in stock.`); return; }

    setSaving(true);
    try {
      const res = await recordAccessorySale({
        sku: accessory.sku,
        marketplace,
        orderNumber: orderId.trim(),
        quantity,
        salePrice: spNum,
        saleDate,
        paymentMode: marketplace === 'BM' ? (paymentMode || undefined) : undefined,
        postageOverride: effectivePostage,
        postageVatExempt,
      });
      if (!res.ok) {
        setError(res.message || 'Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      if (onSaved) onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  const orderPlaceholder = (
    marketplace === 'AMAZON' ? '026-1234567-1234567' :
    marketplace === 'BM'     ? '79008748' :
    marketplace === 'EBAY'   ? '01-14475-65087' :
    /* ONBUY */                'T6G29N2'
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-100 bg-indigo-50">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-indigo-600">
              <Package size={17} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">Record Sale · Accessory</p>
              <h3 className="text-sm font-bold truncate">{accessory.name}</h3>
              <p className="text-[9px] text-slate-500 font-mono">
                {accessory.sku} · {maxQty} in stock · BP £{(accessory.buyPrice ?? 0).toFixed(2)}/unit
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/60 rounded-xl transition-all flex-shrink-0"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Platform picker */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-2">Platform *</label>
            <div className="grid grid-cols-2 gap-2">
              {ACTIVE_PLATFORMS.map(p => {
                const meta = PLATFORM_META[p];
                const active = marketplace === p;
                return (
                  <button
                    key={p}
                    onClick={() => setMarketplace(p)}
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

          {/* Order number + Quantity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                Order Number *
              </label>
              <input
                value={orderId}
                onChange={e => { setOrderId(e.target.value); setError(''); }}
                placeholder={orderPlaceholder}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                <Tag size={9} className="inline mr-1" /> Quantity *
              </label>
              <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="px-2.5 py-2.5 text-slate-500 hover:bg-slate-50"
                ><Minus size={12} /></button>
                <input
                  type="number" min="1" max={maxQty || undefined} value={quantity}
                  onChange={e => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full text-center text-sm font-mono focus:outline-none py-2.5"
                />
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.min(maxQty || q + 1, q + 1))}
                  className="px-2.5 py-2.5 text-slate-500 hover:bg-slate-50"
                ><Plus size={12} /></button>
              </div>
            </div>
          </div>
          {quantity > maxQty && (
            <p className="text-[10px] font-mono text-rose-600 -mt-2">Only {maxQty} left in stock.</p>
          )}

          {/* Sale price — line total for all `quantity` units */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
              Sale Price (£) * <span className="normal-case font-normal text-slate-400">· total for {quantity} unit{quantity === 1 ? '' : 's'}</span>
            </label>
            <input
              type="number"
              value={sp}
              onChange={e => { setSp(e.target.value); setError(''); }}
              placeholder="0.00"
              min="0.01"
              step="0.01"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold font-mono focus:outline-none focus:border-slate-900 transition-all"
            />
          </div>

          {/* Sale Date + Postage row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Sale Date</label>
              <input
                type="date"
                value={saleDate}
                onChange={e => setSaleDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Postage (£)</label>
                <label className="inline-flex items-center gap-1 text-[9px] font-mono text-slate-500 cursor-pointer select-none" title="Zero-rate postage VAT for this sale">
                  <input
                    type="checkbox"
                    checked={postageVatExempt}
                    onChange={e => setPostageVatExempt(e.target.checked)}
                    className="h-3 w-3 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  No P. VAT
                </label>
              </div>
              {(() => {
                const postageNum = Number(postageInput);
                const inputIsPreset = postageInput !== '' && !Number.isNaN(postageNum) && POSTAGE_PRESETS.includes(postageNum);
                const showOtherInput = postageOther || (postageInput !== '' && !inputIsPreset);
                const dropdownValue = inputIsPreset ? String(postageNum) : (showOtherInput ? '__other__' : '');
                return (
                  <div className="space-y-1.5">
                    <select
                      value={dropdownValue}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === '__other__') { setPostageOther(true); }
                        else if (v === '') { setPostageOther(false); setPostageInput(''); }
                        else { setPostageOther(false); setPostageInput(v); }
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
                        value={postageInput}
                        onChange={e => setPostageInput(e.target.value)}
                        placeholder="Manual postage £"
                        min="0"
                        step="0.01"
                        autoFocus={postageOther && postageInput === ''}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
                      />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Payment mode — BM only */}
          {marketplace === 'BM' && (
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                Payment Mode <span className="normal-case font-normal text-slate-500">· drives the 2.5% Klarna/PayPal fee</span>
              </label>
              <select
                value={paymentMode}
                onChange={e => setPaymentMode(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all bg-white"
              >
                {BM_PAYMENT_MODES.map(pm => (
                  <option key={pm || '_none'} value={pm}>{pm || '(none / cash)'}</option>
                ))}
              </select>
            </div>
          )}

          {breakdown && (
            <SalePLBreakdown
              marketplace={marketplace}
              breakdown={breakdown}
              bp={bpLineTotal}
              sp={spNum}
            />
          )}

          {error && (
            <div className="flex items-center gap-2 text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-slate-100 flex gap-3 bg-white">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-slate-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || spNum <= 0 || !orderId.trim() || quantity <= 0 || quantity > maxQty}
            className="flex-1 py-3 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700"
          >
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm Sale</>}
          </button>
        </div>
      </div>
    </div>
  );
}
