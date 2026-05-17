/**
 * SellOrderModal — record a marketplace sale for one inventory unit.
 *
 * Extracted from the legacy SellPage so both SellPage (deprecated) and the
 * new SellSheet can reuse it. Behavior is verbatim: live P&L breakdown,
 * SHS-path IMEI capture, recordSale via the service layer.
 */
import { useState } from 'react';
import {
  X, Package, AlertCircle, Truck, CheckCircle2,
} from 'lucide-react';
import { dbService } from '../lib/dbService';
import type { InventoryUnit, Marketplace } from '../types';
import { notificationService } from '../lib/notificationService';
import {
  PLATFORM_LIST, PLATFORMS, DEFAULT_POSTAGE_COST,
  platformTotalFee, calcNetProfit, platformFixedFee,
  marketplaceFromListingSite,
} from '../lib/platforms';
import {
  isValidImei, isAppleDevice,
  IMEI_REQUIRED_MESSAGE, IMEI_OR_APPLE_SERIAL_MESSAGE,
} from '../lib/imeiValidation';
import { recordSale } from '../services';

const PLATFORM_STYLE: Record<string, string> = {
  eBay:       'bg-yellow-50 text-yellow-800 border-yellow-200',
  Amazon:     'bg-orange-50 text-orange-800 border-orange-200',
  OnBuy:      'bg-blue-50   text-blue-800   border-blue-200',
  Backmarket: 'bg-green-50  text-green-800  border-green-200',
};

const today = () => new Date().toISOString().split('T')[0];

interface Props {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved?: () => void;
  isSHS?: boolean;
}

export default function SellOrderModal({ unit, onClose, onSaved, isSHS = false }: Props) {
  // Model-aware IMEI semantics: Apple devices unlock the 10–12 char serial
  // format alongside the 15-digit numeric IMEI.
  const apple = isAppleDevice(unit.model);
  const existingImei = (unit.imei || '').trim().toUpperCase();
  // SHS units may already carry an IMEI if the operator entered it when
  // logging the order — in that case the field is locked (read-only).
  // Anything else requires the operator to enter + validate before save.
  const hasValidExistingImei = !!existingImei && isValidImei(existingImei, { isAppleSerial: apple });
  const lockedImei = isSHS && hasValidExistingImei;

  const [sp, setSp]                 = useState('');
  const [platform, setPlatform]     = useState<string>(PLATFORM_LIST[0]);
  const [orderId, setOrderId]       = useState('');
  const [saleDate, setSaleDate]     = useState(today());
  const [postage, setPostage]       = useState(String(DEFAULT_POSTAGE_COST));
  // Pre-fill the IMEI input with whatever the unit already has, so a locked
  // SHS unit can still pass through handleSave's IMEI checks cleanly.
  const [imeiInput, setImeiInput]   = useState(existingImei);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const spNum       = sp ? Number(sp) : 0;
  const postageNum  = postage ? Number(postage) : DEFAULT_POSTAGE_COST;
  const platformFee = spNum > 0 ? platformTotalFee(platform, spNum) : 0;
  const netProfit   = spNum > 0 ? calcNetProfit(spNum, unit.buyPrice, platform, postageNum) : null;

  const handleSave = async () => {
    if (!sp || Number(sp) <= 0)     { setError('Please enter a valid selling price.'); return; }
    if (!orderId.trim())            { setError('Please enter the order number from the platform.'); return; }

    // Every sale — SHS or office — needs a valid IMEI on the unit before
    // it can leave inventory. We can't ship a serial we don't know.
    //   - Office sales: IMEI was required at Add Stock, so unit.imei is the
    //     source of truth; block here only if data quality has somehow let
    //     a unit through without one.
    //   - SHS sales: the modal collects the IMEI inline (lockedImei when
    //     it's already on file, otherwise editable input).
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
    // For SHS where the operator typed a fresh IMEI, also run the
    // cross-collection duplicate guard so they can't accidentally collide
    // with another unit's serial. recordSale will re-check on the service
    // side; failing early keeps the UX fast.
    if (isSHS && !lockedImei) {
      try {
        const exists = await dbService.imeiExists(imei);
        if (exists && imei !== existingImei) {
          setError(`IMEI ${imei} already belongs to another unit.`);
          return;
        }
      } catch {
        // Network blip — let the service-side guard catch it.
      }
    }

    setSaving(true);
    try {
      const profit = calcNetProfit(spNum, unit.buyPrice, platform, postageNum);
      const notificationType = profit < 0 ? 'loss_sell' : 'sold';
      if (isSHS && !lockedImei) {
        // Operator typed a fresh IMEI for an SHS unit that didn't have one;
        // stamp it on the unit so the sale doc + downstream surfaces have a
        // real serial to link to. Skipped when lockedImei (the IMEI was
        // already on file and the input was read-only) — nothing to write.
        await dbService.update('inventoryUnits', unit.id, { imei: imeiInput.trim().toUpperCase() });
      }
      const marketplace = (marketplaceFromListingSite(platform) as Marketplace | undefined) ?? 'EBAY';
      const res = await recordSale({
        marketplace,
        orderNumber: orderId.trim(),
        unitId: unit.id,
        buyPrice: unit.buyPrice,
        salePrice: spNum,
        saleDate,
        postageOverride: postageNum,
      });
      if (!res.ok) {
        setError(res.message || 'Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      notificationService.addNotification(notificationType, unit, profit);
      if (onSaved) onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>
        <div className={`flex items-center justify-between px-6 py-4 border-b ${isSHS ? 'border-amber-100 bg-amber-50' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isSHS ? 'bg-amber-500' : 'bg-black'}`}>
              {isSHS ? <Truck size={17} className="text-white" /> : <Package size={17} className="text-white" />}
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">
                {isSHS ? 'Supplier Direct Sale' : 'Record Sale'}
              </p>
              <h3 className="text-sm font-bold truncate max-w-[260px]">{unit.model}</h3>
              <p className="text-[9px] text-gray-500 font-mono">
                {unit.colour}{unit.storage ? ` · ${unit.storage}` : ''} · BP £{unit.buyPrice}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all flex-shrink-0"><X size={16} /></button>
        </div>

        {/* IMEI section
            - SHS + locked: IMEI already on file from Add SHS; show read-only.
            - SHS + empty:  collect + validate before save.
            - Office sale:  IMEI is taken from the unit (set at Add Stock);
              surface it inline as read-only so the operator can confirm. */}
        {(() => {
          const imei     = imeiInput.trim().toUpperCase();
          const empty    = imei.length === 0;
          const valid    = imei && isValidImei(imei, { isAppleSerial: apple });
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
            <div className="px-6 pt-4 pb-0">
              <div className={`border rounded-xl p-3 space-y-2 ${sectionTone}`}>
                <p className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5">
                  <Truck size={11} /> {labelText}
                </p>
                {/* Locked: render the existing IMEI as a static, un-editable
                    value so the operator can verify but never accidentally
                    overwrite the serial captured upstream. */}
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
                    placeholder={apple
                      ? '15-digit IMEI or 10–12 char Apple serial'
                      : '15-digit IMEI (digits only)'}
                    inputMode={apple ? 'text' : 'numeric'}
                    maxLength={apple ? 16 : 15}
                    className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none transition-all ${
                      showError
                        ? 'border-rose-400 bg-rose-50 focus:border-rose-500'
                        : valid
                          ? 'border-emerald-400 bg-emerald-50/40 focus:border-emerald-500'
                          : 'border-amber-200 bg-white focus:border-amber-500'
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

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">Platform *</label>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORM_LIST.map(p => (
                <button key={p} onClick={() => setPlatform(p)}
                  className={`py-2.5 px-3 rounded-xl border text-[10px] font-bold transition-all flex items-center justify-between ${
                    platform === p ? 'bg-black text-white border-black' : `${PLATFORM_STYLE[p]} hover:opacity-80`
                  }`}
                >
                  {p}
                  {platform === p
                    ? <CheckCircle2 size={12} />
                    : <span className="text-[8px] font-mono opacity-60">
                        {PLATFORMS[p as keyof typeof PLATFORMS].commission}%
                        {platformFixedFee(p) > 0 ? ` +£${platformFixedFee(p)}` : ''}
                      </span>
                  }
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              Order Number * <span className="normal-case font-normal">(from {platform})</span>
            </label>
            <input
              value={orderId}
              onChange={e => { setOrderId(e.target.value); setError(''); }}
              placeholder={`e.g. ${platform === 'eBay' ? '12-34567-89012' : platform === 'Amazon' ? '202-1234567-8901234' : platform === 'OnBuy' ? 'OB-123456' : 'BM-123456'}`}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
            />
          </div>

          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Selling Price (£) *</label>
            <input type="number" value={sp} onChange={e => { setSp(e.target.value); setError(''); }}
              placeholder="0.00" min="0" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold font-mono focus:outline-none focus:border-black transition-all" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Sale Date</label>
              <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black transition-all" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Postage (£)</label>
              <input type="number" value={postage} onChange={e => setPostage(e.target.value)}
                placeholder={String(DEFAULT_POSTAGE_COST)} min="0" step="0.01"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black transition-all" />
            </div>
          </div>

          {spNum > 0 && (
            <div className={`rounded-xl p-4 border ${netProfit! >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">Profit Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-center mb-2">
                {[
                  { label: 'Sold For',  val: `£${spNum.toLocaleString()}`, red: false },
                  { label: 'Bought For', val: `£${unit.buyPrice}`,         red: false },
                  { label: `${platform} Fee`, val: `-£${platformFee}`,     red: true  },
                  { label: 'Postage',   val: `-£${postageNum}`,             red: true  },
                ].map(({ label, val, red }) => (
                  <div key={label}>
                    <p className="text-[8px] text-gray-400 font-mono">{label}</p>
                    <p className={`text-sm font-bold ${red ? 'text-red-600' : ''}`}>{val}</p>
                  </div>
                ))}
              </div>
              <div className={`rounded-lg px-3 py-2 text-center border-t ${netProfit! >= 0 ? 'border-emerald-200' : 'border-red-200'}`}>
                <p className="text-[8px] text-gray-400 font-mono mb-0.5">Net Profit</p>
                <p className={`text-lg font-bold ${netProfit! >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {netProfit! >= 0 ? '+' : ''}£{netProfit}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button
            onClick={handleSave}
            // Block Confirm when no valid IMEI is set, regardless of SHS vs
            // Office. SHS reads from imeiInput (editable when not locked);
            // Office reads from the unit itself (read-only mirror).
            disabled={saving || !isValidImei((isSHS ? imeiInput : unit.imei || '').trim().toUpperCase(), { isAppleSerial: apple })}
            className={`flex-1 py-3 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
              isSHS ? 'bg-amber-500 hover:bg-amber-600' : 'bg-black hover:bg-gray-800'
            }`}>
            {saving ? 'Saving…' : <><CheckCircle2 size={13} /> Confirm Sale</>}
          </button>
        </div>
      </div>
    </div>
  );
}
