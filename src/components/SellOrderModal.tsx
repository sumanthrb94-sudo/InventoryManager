/**
 * SellOrderModal — record a marketplace sale for one inventory unit.
 *
 * Calculations are master-aligned: every derived field (SP-BP, MAR TAX,
 * Commission, ROF, FVF, 0.2 VAT bundle, T.COM, GP, GP%, NP) comes from
 * `calcSaleFinancials`, which mirrors the formulas in the operator's
 * SALES_REPORT_2026.xlsx (verified via xl/worksheets/sheet{1..5}.xml).
 *
 * The four supported platforms:
 *   AMAZON · BM · EBAY · ONBUY
 *
 * Each platform surfaces its own input set + a live P&L breakdown that
 * shows exactly the columns the master report will emit when this row
 * lands on its sheet — so the operator sees the answer the workbook
 * would compute, before they hit Confirm.
 */
import { useState, useMemo, useEffect } from 'react';
import {
  X, Package, AlertCircle, Truck, CheckCircle2, Tag, ChevronRight,
} from 'lucide-react';
import { dbService } from '../lib/dbService';
import type { InventoryUnit, Marketplace } from '../types';
import { MARKETPLACES } from '../types';
import { notificationService } from '../lib/notificationService';
import { calcSaleFinancials } from '../lib/platforms';
import {
  isValidImei, isAppleDevice,
  IMEI_REQUIRED_MESSAGE, IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { recordSale } from '../services';

/** Operator-facing platform list — the 4 marketplaces the operator sells
 *  on. Matches the master SALES_REPORT sheet order. */
const ACTIVE_PLATFORMS: ReadonlyArray<Marketplace> = MARKETPLACES;

/** Per-platform display palette + label. Matches the colour cues used on
 *  the Sell screen so the operator's eye recognises the platform instantly. */
const PLATFORM_META: Record<Marketplace, { label: string; tone: string; activeBg: string }> = {
  AMAZON:  { label: 'Amazon',       tone: 'border-orange-200 text-orange-800 bg-orange-50',   activeBg: 'bg-orange-600' },
  BM:      { label: 'Back Market',  tone: 'border-emerald-200 text-emerald-800 bg-emerald-50', activeBg: 'bg-emerald-600' },
  EBAY:    { label: 'eBay',         tone: 'border-yellow-200 text-yellow-800 bg-yellow-50',   activeBg: 'bg-yellow-600' },
  ONBUY:   { label: 'OnBuy',        tone: 'border-blue-200 text-blue-800 bg-blue-50',         activeBg: 'bg-blue-600' },
};

/** BM-only payment-mode options — these are the values the master file uses
 *  in the BM "Payment Mode" column. Anything matching the PayPal/Klarna
 *  detection regex in calcSaleFinancials triggers the 2.5% commission. */
const BM_PAYMENT_MODES = ['', 'Klarna', 'PayPal', 'Clear Pay', 'Apple Pay', 'Google Pay', 'Card'] as const;

/** eBay's three shipping tiers per the master sheet — surfaced as quick-pick
 *  buttons rather than a free-text postage field so the operator's input
 *  routes cleanly into the eBayShippingTier slot inside calcSaleFinancials. */

const today = () => new Date().toISOString().split('T')[0];

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved?: () => void;
  isSHS?: boolean;
}

export default function SellOrderModal({ unit, onClose, onSaved, isSHS = false }: Props) {
  const apple = isAppleDevice(unit.model);
  const existingImei = (unit.imei || '').trim().toUpperCase();
  const hasValidExistingImei = !!existingImei && isValidImei(existingImei, { isAppleSerial: apple });
  const lockedImei = isSHS && hasValidExistingImei;

  const [marketplace, setMarketplace] = useState<Marketplace>('EBAY');
  const [orderId, setOrderId]   = useState('');
  const [sku, setSku]           = useState(unit.sku || '');
  const [sp, setSp]             = useState('');
  const [saleDate, setSaleDate] = useState(today());
  // Postage UX: dropdown of preset values (6.30 / 5 / 4.65 / 1.90 / 0) + "Other"
  // which reveals a free-text £ field. Matches the variability seen across the
  // client master (AMAZON: 5 or 6.3; EBAY: 0 / 1.9 / 4.65 / 6.3; BM/ONBUY: 6.3).
  const [postagePreset, setPostagePreset] = useState<string>('6.30');
  const [postageCustom, setPostageCustom] = useState<string>('');
  // VAT-nullify toggle — when ON, P.VAT is written as literal 0 (not Postage*20%).
  const [postageVatExempt, setPostageVatExempt] = useState<boolean>(false);
  // Accessory toggle — defaults ON (£1 Acc column value). Uncheck for £0.
  const [accessoriesIncluded, setAccessoriesIncluded] = useState<boolean>(true);
  const [paymentMode, setPaymentMode] = useState('');           // BM only
  const [imeiInput, setImeiInput] = useState(existingImei);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  // Reset postage / payment-mode when switching platform so the user sees
  // the platform's fresh default instead of a stale eBay-tier carryover.
  useEffect(() => {
    setPostagePreset('6.30');
    setPostageCustom('');
    setPostageVatExempt(false);
    setPaymentMode('');
  }, [marketplace]);

  // ── Resolve effective postage from the dropdown + custom-text fallback ────
  const effectivePostage = useMemo(() => {
    const raw = postagePreset === 'other' ? postageCustom : postagePreset;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 6.30;
  }, [postagePreset, postageCustom]);

  // ── Live P&L breakdown — master-aligned via calcSaleFinancials ────────────
  const spNum = Number(sp) || 0;
  const breakdown = useMemo(() => {
    if (spNum <= 0) return null;
    return calcSaleFinancials({
      marketplace,
      buyPrice: unit.buyPrice,
      salePrice: spNum,
      postage: effectivePostage,
      postageVatExempt,
      accessories: accessoriesIncluded ? 1 : 0,
    });
  }, [marketplace, unit.buyPrice, spNum, effectivePostage, postageVatExempt, accessoriesIncluded]);

  const handleSave = async () => {
    if (!sp || spNum <= 0)    { setError('Please enter a valid sale price.'); return; }
    if (!orderId.trim())      { setError('Please enter the order number from the platform.'); return; }

    const imei = (isSHS ? imeiInput : unit.imei || '').trim().toUpperCase();
    if (!imei) {
      setError(isSHS
        ? 'IMEI / serial is required before marking an SHS unit as sold.'
        : 'This unit has no IMEI on file — add one before recording the sale.');
      return;
    }
    if (!isValidImei(imei, { isAppleSerial: apple })) {
      setError(apple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE);
      return;
    }
    if (isSHS && !lockedImei) {
      try {
        const exists = await dbService.imeiExists(imei);
        if (exists && imei !== existingImei) {
          setError(`IMEI ${imei} already belongs to another unit.`);
          return;
        }
      } catch { /* network blip — service-side guard will catch */ }
    }

    setSaving(true);
    try {
      if (isSHS && !lockedImei) {
        await dbService.update('inventoryUnits', unit.id, { imei });
      }
      const res = await recordSale({
        marketplace,
        orderNumber: orderId.trim(),
        unitId: unit.id,
        buyPrice: unit.buyPrice,
        salePrice: spNum,
        saleDate,
        sku: sku.trim() || undefined,
        paymentMode: marketplace === 'BM' ? (paymentMode || undefined) : undefined,
        postageOverride: effectivePostage,
        postageVatExempt,
        accessories: accessoriesIncluded ? 1 : 0,
      });
      if (!res.ok) {
        setError(res.message || 'Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      const profit = breakdown?.grossProfit ?? 0;
      const notificationType = profit < 0 ? 'loss_sell' : 'sold';
      notificationService.addNotification(notificationType, unit, profit);
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
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isSHS ? 'border-amber-100 bg-amber-50' : 'border-slate-100'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isSHS ? 'bg-amber-500' : 'bg-slate-900'}`}>
              {isSHS ? <Truck size={17} className="text-white" /> : <Package size={17} className="text-white" />}
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-mono uppercase tracking-widest text-slate-400">
                {isSHS ? 'Supplier Direct Sale' : 'Record Sale'}
              </p>
              <h3 className="text-sm font-bold truncate">{unit.model}</h3>
              <p className="text-[9px] text-slate-500 font-mono">
                {unit.colour}{unit.storage ? ` · ${unit.storage}` : ''} · BP £{unit.buyPrice}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all flex-shrink-0"><X size={16} /></button>
        </div>

        {/* IMEI section — unchanged contract, just tonally aligned */}
        {(() => {
          const imei  = imeiInput.trim().toUpperCase();
          const empty = imei.length === 0;
          const valid = imei && isValidImei(imei, { isAppleSerial: apple });
          const showError = isSHS && !lockedImei && !empty && !valid;
          const help =
            empty       ? (apple ? '15-digit IMEI or 10–12 char Apple serial' : '15-digit IMEI (digits only)')
            : !valid    ? (apple ? IMEI_OR_APPLE_SERIAL_MESSAGE : IMEI_REQUIRED_MESSAGE)
            :             `Locked in — ${imei}`;
          const sectionTone = isSHS
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-slate-50 border-slate-200 text-slate-700';
          const labelText = isSHS
            ? (lockedImei ? 'IMEI / Serial · On file from Add SHS' : 'IMEI / Serial · Required for SHS sale')
            : 'IMEI / Serial · From inventory';
          return (
            <div className="px-6 pt-4">
              <div className={`border rounded-xl p-3 space-y-2 ${sectionTone}`}>
                <p className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                  <Truck size={11} /> {labelText}
                </p>
                {lockedImei || !isSHS ? (
                  <div className={`w-full border bg-white rounded-lg px-3 py-2 text-sm font-mono flex items-center justify-between ${
                    valid ? 'border-emerald-200 text-emerald-900' : 'border-rose-300 text-rose-700'
                  }`}>
                    <span className="truncate">{imei || '(none on file)'}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                      valid ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {valid ? 'Locked' : 'Missing'}
                    </span>
                  </div>
                ) : (
                  <input
                    value={imeiInput}
                    onChange={e => { setImeiInput(e.target.value); setError(''); }}
                    placeholder={apple ? '15-digit IMEI or 10–12 char Apple serial' : '15-digit IMEI (digits only)'}
                    inputMode={apple ? 'text' : 'numeric'}
                    maxLength={apple ? 16 : 15}
                    className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none transition-all ${
                      showError ? 'border-rose-400 bg-rose-50 focus:border-rose-500'
                      : valid   ? 'border-emerald-400 bg-emerald-50/40 focus:border-emerald-500'
                      :           'border-amber-200 bg-white focus:border-amber-500'
                    }`}
                  />
                )}
                <p className={`text-[9px] font-mono ${
                  showError ? 'text-rose-600'
                  : valid     ? (isSHS ? 'text-emerald-700' : 'text-slate-500')
                  :             (isSHS ? 'text-amber-600' : 'text-rose-600')
                }`}>
                  {!isSHS && !valid ? 'No IMEI on this unit — sale will be blocked. Edit the unit on Buy first.' : help}
                </p>
              </div>
            </div>
          );
        })()}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Platform picker — 4 buttons in a row */}
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
                    {active
                      ? <CheckCircle2 size={12} />
                      : <ChevronRight size={12} className="opacity-60" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Order number + SKU side-by-side */}
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
                <Tag size={9} className="inline mr-1" /> SKU
              </label>
              <input
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder={unit.sku || 'e.g. ASI-IP-13-128-BK'}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
              />
            </div>
          </div>

          {/* Sale price */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">Sale Price (£) *</label>
            <input
              type="number"
              value={sp}
              onChange={e => { setSp(e.target.value); setError(''); }}
              placeholder="0.00"
              min="0"
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
              <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block mb-1.5">
                Postage (£)
              </label>
              <select
                value={postagePreset}
                onChange={e => setPostagePreset(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
              >
                <option value="6.30">£6.30</option>
                <option value="5.00">£5.00</option>
                <option value="4.65">£4.65</option>
                <option value="1.90">£1.90</option>
                <option value="0.00">£0.00</option>
                <option value="other">Other…</option>
              </select>
              {postagePreset === 'other' && (
                <input
                  type="number"
                  value={postageCustom}
                  onChange={e => setPostageCustom(e.target.value)}
                  placeholder="Custom postage £"
                  min="0"
                  step="0.01"
                  className="w-full mt-2 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-slate-900 transition-all"
                />
              )}
            </div>
          </div>

          {/* Postage VAT-exempt + Accessory toggles */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={postageVatExempt}
                onChange={e => setPostageVatExempt(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              Postage VAT-exempt (P.VAT = 0)
            </label>
            <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={accessoriesIncluded}
                onChange={e => setAccessoriesIncluded(e.target.checked)}
                className="w-4 h-4 rounded border-slate-300"
              />
              Accessory included (Acc = £1)
            </label>
          </div>

          {/* Payment mode — BM only (drives the PayPal/Klarna 2.5% fee) */}
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

          {/* Live P&L breakdown — master-formula columns surfaced one-to-one
              so the operator sees exactly what'll land in the report row. */}
          {breakdown && (
            <SalePLBreakdown
              marketplace={marketplace}
              breakdown={breakdown}
              bp={unit.buyPrice}
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
            disabled={saving || !isValidImei((isSHS ? imeiInput : unit.imei || '').trim().toUpperCase(), { isAppleSerial: apple })}
            className={`flex-1 py-3 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
              isSHS ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm Sale</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── P&L breakdown card ──────────────────────────────────────────────────────
// One-to-one mapping with the master sheet's columns per platform. Whatever
// reads on screen is exactly what the operator's SALES_REPORT_2026.xlsx
// formula will compute when this sale row lands on its sheet.
function SalePLBreakdown({
  marketplace, breakdown, bp, sp,
}: {
  marketplace: Marketplace;
  breakdown: ReturnType<typeof calcSaleFinancials>;
  bp: number;
  sp: number;
}) {
  const positive = breakdown.grossProfit >= 0;
  const tone = positive ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200';

  // Rows are platform-specific — show only the columns the master sheet
  // surfaces for this marketplace so the breakdown is a literal preview.
  const rows: Array<{ label: string; value: string; sub?: 'add' | 'sub' }> = [
    { label: 'Sale Price',  value: `£${sp.toFixed(2)}`,                 sub: 'add' },
    { label: 'Buy Price',   value: `£${bp.toFixed(2)}`,                 sub: 'sub' },
    { label: 'SP − BP',     value: `£${breakdown.spMinusBp.toFixed(2)}` },
  ];

  switch (marketplace) {
    case 'AMAZON':
      rows.push(
        { label: 'Marginal Tax 16.67%',  value: `£${(breakdown.marginalTax ?? 0).toFixed(2)}`, sub: 'sub' },
        { label: 'Commission 7%',        value: `£${(breakdown.commission ?? 0).toFixed(2)}`,  sub: 'sub' },
        { label: 'C. VAT 20%',           value: `£${(breakdown.cVat ?? 0).toFixed(2)}`,        sub: 'sub' },
        { label: 'DSF 2%',               value: `£${(breakdown.dsf ?? 0).toFixed(2)}`,         sub: 'sub' },
        { label: 'DSF. VAT 20%',         value: `£${(breakdown.dsfVat ?? 0).toFixed(2)}`,      sub: 'sub' },
        { label: 'Postage',              value: `£${(breakdown.postage ?? 0).toFixed(2)}`,     sub: 'sub' },
        { label: 'P. VAT',               value: `£${(breakdown.pVat ?? 0).toFixed(2)}`,        sub: 'sub' },
        { label: 'Acc (accessories)',    value: `£${(breakdown.accessories ?? 0).toFixed(2)}`, sub: 'sub' },
      );
      break;

    case 'BM':
      rows.push(
        { label: 'Marginal Tax 16.67%',  value: `£${(breakdown.marginalTax ?? 0).toFixed(2)}`,     sub: 'sub' },
        { label: 'Commission 11%',       value: `£${(breakdown.commission ?? 0).toFixed(2)}`,      sub: 'sub' },
        { label: 'Customer Care Fees',   value: `£${(breakdown.customerCareFees ?? 0).toFixed(2)}`, sub: 'sub' },
        { label: 'Postage',              value: `£${(breakdown.postage ?? 0).toFixed(2)}`,         sub: 'sub' },
        { label: 'P. VAT',               value: `£${(breakdown.pVat ?? 0).toFixed(2)}`,            sub: 'sub' },
        { label: 'Acc (accessories)',    value: `£${(breakdown.accessories ?? 0).toFixed(2)}`,     sub: 'sub' },
      );
      break;

    case 'EBAY':
      rows.push(
        { label: 'MAR TAX 16.67%',       value: `£${(breakdown.marginalTax ?? 0).toFixed(2)}`,   sub: 'sub' },
        { label: 'COM (6.9% − 10%)',     value: `£${(breakdown.commission ?? 0).toFixed(2)}`,    sub: 'sub' },
        { label: 'ROF 0.35%',            value: `£${(breakdown.rof ?? 0).toFixed(2)}`,           sub: 'sub' },
        { label: 'FVF',                  value: `£${(breakdown.fvf ?? 0).toFixed(2)}`,           sub: 'sub' },
        { label: 'VAT 20%',              value: `£${(breakdown.vat ?? 0).toFixed(2)}`,           sub: 'sub' },
        { label: 'Postage',              value: `£${(breakdown.postage ?? 0).toFixed(2)}`,       sub: 'sub' },
        { label: 'P. VAT',               value: `£${(breakdown.pVat ?? 0).toFixed(2)}`,          sub: 'sub' },
        { label: 'Marketing 5%',         value: `£${(breakdown.marketing ?? 0).toFixed(2)}`,     sub: 'sub' },
        { label: 'M. VAT',               value: `£${(breakdown.mVat ?? 0).toFixed(2)}`,          sub: 'sub' },
        { label: 'Acc (accessories)',    value: `£${(breakdown.accessories ?? 0).toFixed(2)}`,   sub: 'sub' },
      );
      break;

    case 'ONBUY':
      rows.push(
        { label: 'Marginal Tax 16.67%',  value: `£${(breakdown.marginalTax ?? 0).toFixed(2)}`,    sub: 'sub' },
        { label: 'Commission 7%',        value: `£${(breakdown.commission ?? 0).toFixed(2)}`,    sub: 'sub' },
        { label: 'VAT 20%',              value: `£${(breakdown.vat20 ?? 0).toFixed(2)}`,         sub: 'sub' },
        { label: 'Postage',              value: `£${(breakdown.postage ?? 0).toFixed(2)}`,       sub: 'sub' },
        { label: 'P. VAT',               value: `£${(breakdown.pVat ?? 0).toFixed(2)}`,          sub: 'sub' },
        { label: 'Acc (accessories)',    value: `£${(breakdown.accessories ?? 0).toFixed(2)}`,   sub: 'sub' },
      );
      break;
  }

  return (
    <div className={`rounded-xl border ${tone} p-4 space-y-2`}>
      <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 flex items-center justify-between">
        <span>P&amp;L preview · master formulas</span>
        <span className="text-slate-400">{PLATFORM_META[marketplace].label}</span>
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-slate-500">{r.label}</span>
            <span className={
              r.sub === 'sub' ? 'text-rose-600 font-bold' :
              r.sub === 'add' ? 'text-slate-800 font-bold' :
                                'text-slate-700'
            }>
              {r.sub === 'sub' ? '−' : ''}{r.value.replace('£', '£')}
            </span>
          </div>
        ))}
      </div>
      <div className={`flex items-center justify-between pt-2 border-t ${positive ? 'border-emerald-200' : 'border-rose-200'}`}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Gross Profit · GP%</span>
        <span className={`text-base font-bold ${positive ? 'text-emerald-700' : 'text-rose-600'}`}>
          {positive ? '+' : ''}£{breakdown.grossProfit.toFixed(2)} · {breakdown.gpPercent.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
