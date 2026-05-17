import React, { useState, useMemo } from 'react';
import {
  ShoppingCart, Search, CheckCircle2, Clock, ChevronRight,
  X, Package, AlertCircle, ChevronDown, ChevronUp,
  Truck, Pencil, AlertTriangle, PackageCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Sale, Marketplace, ListingSite } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { parseBrandModelStorage } from '../lib/modelStorage';
import { deriveSkuListing } from '../lib/skuListings';
import { totalShsRecords, manualShsUnitsFrom } from '../lib/shsCount';
import SkuListingEditor from './SkuListingEditor';
import CopyImei from './CopyImei';
import {
  PLATFORM_LIST, PLATFORMS, DEFAULT_POSTAGE_COST,
  platformTotalFee, calcNetProfit, platformFixedFee,
  marketplaceFromListingSite, listingSiteLabel,
} from '../lib/platforms';
import { recomputeSale } from '../lib/recomputeSale';
// Service layer — record sale routes through here so the GP math + composite
// doc id + unit-status flip stay centralised. UI no longer calls
// dbService.update('inventoryUnits') for the sale path.
import { recordSale } from '../services';
import { fmtDateForUser, useUserRegion } from '../lib/userLocale';
import CollapsibleSection from './CollapsibleSection';
import PeriodicInventory from './PeriodicInventory';
import IntelligencePanel from './IntelligencePanel';
import TodaySalesModal from './TodaySalesModal';
import InStockModal from './InStockModal';

// ── helpers ────────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

const PLATFORM_STYLE: Record<string, string> = {
  eBay:       'bg-yellow-50 text-yellow-800 border-yellow-200',
  Amazon:     'bg-orange-50 text-orange-800 border-orange-200',
  OnBuy:      'bg-blue-50   text-blue-800   border-blue-200',
  Backmarket: 'bg-green-50  text-green-800  border-green-200',
};

/** Resolve a unit's SKU using pre-split fields when present, otherwise
 *  parse the legacy single-string `model` column at runtime. Mirrors the
 *  helper in StockInPage so legacy "SAMSUNG S21 128GB" strings still
 *  group together with newly-imported brand-split units. */
function deriveSku(u: InventoryUnit): { brand: string; model: string; storage?: string; series?: string } {
  if (u.brand && u.storage) {
    return { brand: u.brand, model: u.model, storage: u.storage };
  }
  const p = parseBrandModelStorage(u.model || '');
  return {
    brand: u.brand || p.brand,
    model: p.model || u.model,
    storage: u.storage || p.storage,
    series: p.series,
  };
}

// ── Sold-history helpers ──────────────────────────────────────────────────────
const MARKETPLACE_BADGE: Record<Marketplace, string> = {
  AMAZON:  'bg-amber-100  text-amber-800  border-amber-200',
  BM:      'bg-emerald-100 text-emerald-800 border-emerald-200',
  EBAY:    'bg-blue-100   text-blue-800   border-blue-200',
  ONBUY:   'bg-purple-100 text-purple-800 border-purple-200',
  PROJECT: 'bg-pink-100   text-pink-800   border-pink-200',
};

const fmtGBP = (n: number | undefined | null): string => {
  if (n == null || Number.isNaN(n)) return '—';
  return `£${n.toFixed(2)}`;
};

/** Map a legacy in-app sold inventoryUnit into a Sale-shaped row so the
 *  unified Sold History panel can render it alongside imported sales.
 *  Mirrors `inventoryUnitToSale` in Sales.tsx — placeholder derived fields
 *  are overwritten by `recomputeSale()` downstream. */
function inventoryUnitToSale(u: InventoryUnit): Sale {
  const marketplace: Marketplace =
    (marketplaceFromListingSite(u.salePlatform || '') as Marketplace | undefined) ?? 'EBAY';
  const sp = u.salePrice ?? 0;
  const bp = u.buyPrice ?? 0;
  return {
    id: u.id,
    marketplace,
    orderNumber: u.saleOrderId || '',
    sku: u.sku,
    imei: u.imei,
    unitId: u.id,
    supplierId: u.supplierId,
    supplierName: u.supplierName,
    saleDate: (u.saleDate || u.updatedAt?.split?.('T')?.[0] || '') as string,
    quantity: 1,
    buyPrice: bp,
    salePrice: sp,
    paymentMode: undefined,
    spMinusBp: sp - bp,
    marginalTax: 0,
    commission: 0,
    postage: u.postageCost ?? 0,
    grossProfit: 0,
    gpPercent: 0,
    comments: u.notes || undefined,
    importBatchId: 'inapp',
    sourceFile: 'inapp-sell-flow',
    sourceRow: 0,
    importedAt: u.updatedAt ?? u.createdAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    ownerId: u.ownerId,
  };
}

// ── SellOrderModal ─────────────────────────────────────────────────────────────
function SellOrderModal({
  unit, onClose, onSaved, isSHS = false,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
  isSHS?: boolean;
}) {
  const [sp, setSp]           = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_LIST[0]);
  const [orderId, setOrderId] = useState('');
  const [saleDate, setSaleDate] = useState(today());
  const [postage, setPostage] = useState(String(DEFAULT_POSTAGE_COST));
  const [imeiInput, setImeiInput] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const spNum      = sp ? Number(sp) : 0;
  const postageNum = postage ? Number(postage) : DEFAULT_POSTAGE_COST;
  const platformFee = spNum > 0 ? platformTotalFee(platform, spNum) : 0;
  const netProfit   = spNum > 0 ? calcNetProfit(spNum, unit.buyPrice, platform, postageNum) : null;

  const handleSave = async () => {
    if (!sp || Number(sp) <= 0) { setError('Please enter a valid selling price.'); return; }
    if (!orderId.trim()) { setError('Please enter the order number from the platform.'); return; }
    setSaving(true);
    try {
      const spNum = Number(sp);
      const postageNum = postage ? Number(postage) : DEFAULT_POSTAGE_COST;

      // Calculate profit for the notification (legacy two-input formula —
      // mirrors what the SellPage UI displayed in the live P&L panel; the
      // service stores authoritative GP via calcSaleFinancials).
      const profit = calcNetProfit(spNum, unit.buyPrice, platform, postageNum);
      const notificationType = profit < 0 ? 'loss_sell' : 'sold';

      // SHS path may carry a late-arriving IMEI from the supplier invoice
      // — write it to the unit before flipping to sold so the sale row
      // links to the correct (now-known) IMEI.
      if (isSHS && imeiInput.trim()) {
        await dbService.update('inventoryUnits', unit.id, { imei: imeiInput.trim() });
      }

      // Map the legacy PLATFORM_LIST string ("eBay" / "Amazon" / "OnBuy" /
      // "Backmarket") to the canonical Marketplace enum used by the sales
      // service + calcSaleFinancials. Falls back to EBAY if mapping fails.
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

      // Trigger notification with correct type and profit amount
      notificationService.addNotification(notificationType, unit, profit);

      onSaved();
      onClose();
    } catch {
      setError('Failed to save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>

        {/* Header */}
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
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* SHS IMEI field */}
        {isSHS && (
          <div className="px-6 pt-4 pb-0">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700 flex items-center gap-1.5">
                <Truck size={11} /> IMEI — Optional now, enter after supplier dispatches
              </p>
              <input
                value={imeiInput}
                onChange={e => setImeiInput(e.target.value)}
                placeholder="Enter IMEI if known, or leave blank"
                className="w-full border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500 transition-all"
              />
              <p className="text-[8px] text-amber-600 font-mono">
                {imeiInput.trim()
                  ? `IMEI saved: ${imeiInput.trim()}`
                  : 'No IMEI — this unit will appear in "Awaiting IMEI" after the sale'}
              </p>
            </div>
          </div>
        )}

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Platform */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">
              Platform *
            </label>
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

          {/* Order Number */}
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

          {/* Sale Price */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              Selling Price (£) *
            </label>
            <input
              type="number" value={sp} onChange={e => { setSp(e.target.value); setError(''); }}
              placeholder="0.00" min="0" step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold font-mono focus:outline-none focus:border-black transition-all"
            />
          </div>

          {/* Sale Date + Postage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">Sale Date</label>
              <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black transition-all" />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
                Postage (£)
              </label>
              <input type="number" value={postage} onChange={e => setPostage(e.target.value)}
                placeholder={String(DEFAULT_POSTAGE_COST)} min="0" step="0.01"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black transition-all" />
            </div>
          </div>

          {/* Live P&L */}
          {spNum > 0 && (
            <div className={`rounded-xl p-4 border ${netProfit! >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">Profit Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-center mb-2">
                {[
                  { label: 'Sold For',  val: `£${spNum.toLocaleString()}`,     red: false },
                  { label: 'Bought For', val: `£${unit.buyPrice}`,             red: false },
                  { label: `${platform} Fee`, val: `-£${platformFee}`,         red: true  },
                  { label: 'Postage',   val: `-£${postageNum}`,                 red: true  },
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

        {/* Footer */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
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

// ── EnterImeiModal — attach IMEI after supplier confirms dispatch ───────────────
function EnterImeiModal({
  unit, onClose, onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [imei, setImei]     = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const clean     = imei.replace(/\D/g, '');
  const isNumeric = /^\d+$/.test(clean);
  const numericOk = isNumeric && clean.length >= 14 && clean.length <= 15;
  const alphaOk   = imei.trim().length >= 8 && !isNumeric;
  const inputOk   = numericOk || alphaOk;
  const finalImei = alphaOk ? imei.trim().toUpperCase() : clean;

  const handleSave = async () => {
    if (!inputOk) { setError('Enter a valid 14–15 digit IMEI or device serial (≥8 chars)'); return; }
    setSaving(true);
    try {
      const exists = await dbService.imeiExists(finalImei);
      if (exists) { setError(`${finalImei} is already in stock as a different unit`); setSaving(false); return; }
      await dbService.update('inventoryUnits', unit.id, { imei: finalImei });
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 700);
    } catch {
      setError('Save failed — please try again');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-orange-100 bg-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-orange-500 text-white rounded-xl flex items-center justify-center">
              <PackageCheck size={15} />
            </div>
            <div>
              <p className="text-[9px] font-mono uppercase tracking-widest text-orange-600">Supplier Dispatched</p>
              <h3 className="text-sm font-bold truncate max-w-[220px]">{unit.model}</h3>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-orange-100 rounded-xl text-orange-400"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Sale summary */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-1">
            <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Sale Details</p>
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold">{unit.colour}{unit.storage ? ` · ${unit.storage}` : ''}</p>
              <p className="text-sm font-bold text-emerald-700">£{unit.salePrice}</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {unit.salePlatform && (
                <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full border ${PLATFORM_STYLE[unit.salePlatform] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                  {unit.salePlatform}
                </span>
              )}
              {unit.saleOrderId && <p className="text-[9px] text-gray-500 font-mono">{unit.saleOrderId}</p>}
              {unit.saleDate    && <p className="text-[9px] text-gray-400 font-mono">{unit.saleDate}</p>}
            </div>
          </div>

          {/* IMEI input */}
          <div>
            <label className="text-[8px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              IMEI / Serial from Supplier Invoice
            </label>
            <input
              autoFocus
              value={imei}
              onChange={e => { setImei(e.target.value); setError(''); }}
              placeholder="Scan or type 14–15 digit IMEI"
              maxLength={20}
              className={`w-full border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none transition-all ${
                imei && !inputOk ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-black'
              }`}
            />
            {imei.trim().length > 0 && (
              <p className={`text-[9px] font-mono mt-1 ${inputOk ? 'text-emerald-600' : 'text-red-500'}`}>
                {alphaOk
                  ? `Serial: ${finalImei} ✓`
                  : isNumeric
                    ? `${clean.length} digits ${numericOk ? '✓' : `— need ${14 - clean.length} more`}`
                    : 'Non-numeric — treating as serial'}
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <AlertTriangle size={12} className="text-red-500" />
              <p className="text-[9px] text-red-600 font-mono">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
              Cancel
            </button>
            <button onClick={handleSave} disabled={!inputOk || saving || saved}
              className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {saved
                ? <><CheckCircle2 size={13} /> Saved!</>
                : saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><PackageCheck size={13} /> Save IMEI</>
              }
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main SellPage ──────────────────────────────────────────────────────────────
export default function SellPage() {
  const { units, suppliers, sales, aggregates } = useInventoryStore();
  const region                      = useUserRegion();
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState<InventoryUnit | null>(null);
  const [selectedIsSHS, setSelectedIsSHS] = useState(false);
  const [savedFlag, setSavedFlag]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enterImeiUnit, setEnterImeiUnit] = useState<InventoryUnit | null>(null);
  const [showTodaySales, setShowTodaySales] = useState(false);
  const [showInStock, setShowInStock] = useState(false);
  // SKU-level listing editor — opens from each Available Stock group row so
  // ops can list/de-list a whole SKU without scanning every IMEI.
  const [listingEditor, setListingEditor] = useState<{
    label: string;
    units: InventoryUnit[];
    current: ListingSite[];
  } | null>(null);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  const todayStr  = today();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const inStock   = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  // Manual SHS orders only — synthetic placeholders for master-file
  // aggregates are excluded here to avoid double counting with the
  // aggregate-derived total below. Both surfaces (BUY KPI + SELL KPI)
  // now agree via totalShsRecords().
  const shsUnits  = useMemo(() => manualShsUnitsFrom(units), [units]);
  /** Canonical SHS records count — matches the BUY tab's SHS KPI. */
  const shsTotal  = useMemo(() => totalShsRecords(units, aggregates), [units, aggregates]);
  const sold      = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  // Sold SHS units still awaiting IMEI from supplier
  const awaitingImei = useMemo(() =>
    [...sold.filter(u => !u.imei)]
      .sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || '')),
    [sold],
  );

  const todaySold    = sold.filter(u => u.saleDate === todayStr);
  const ystdSold     = sold.filter(u => u.saleDate === yesterday);
  const todayRevenue = todaySold.reduce((s, u) => s + (u.salePrice || 0), 0);

  // ────────────────────────────────────────────────────────────────────────
  // Unified Sold History data — same merge pattern as Admin → Sales History
  // (Sales.tsx). Master `sales` collection (1,450 rows) is the source of
  // truth; legacy in-app sold units get folded in if they don't already
  // appear in the sales collection. Every row passes through `recomputeSale`
  // so commission / GP / GP% are live against current MARKETPLACE_FEES.
  // ────────────────────────────────────────────────────────────────────────
  const allSold = useMemo<Sale[]>(() => {
    const merged: Sale[] = [];
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const s of sales) {
      const fresh = recomputeSale(s);
      merged.push(fresh);
      seenIds.add(s.id);
      if (fresh.orderNumber) {
        seenKeys.add(`${fresh.marketplace}__${fresh.orderNumber}`);
      }
    }
    for (const u of units) {
      if (u.status !== 'sold' || u.salePrice == null) continue;
      if (seenIds.has(u.id)) continue;
      const candidate = inventoryUnitToSale(u);
      const dedupeKey = candidate.orderNumber
        ? `${candidate.marketplace}__${candidate.orderNumber}`
        : '';
      if (dedupeKey && seenKeys.has(dedupeKey)) continue;
      merged.push(recomputeSale(candidate));
    }
    return merged.sort((a, b) => (b.saleDate || '').localeCompare(a.saleDate || ''));
  }, [sales, units]);

  // Date-scope tabs for the Sold History panel
  type SoldScope = 'today' | 'month' | 'range' | 'all';
  const [soldScope, setSoldScope] = useState<SoldScope>('today');
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  }, []);
  const [rangeFrom, setRangeFrom] = useState<string>(monthStart);
  const [rangeTo,   setRangeTo]   = useState<string>(todayStr);

  const scopedSold = useMemo<Sale[]>(() => {
    if (soldScope === 'all') return allSold;
    if (soldScope === 'today') {
      return allSold.filter(s => (s.saleDate || '').split('T')[0] === todayStr);
    }
    if (soldScope === 'month') {
      return allSold.filter(s => {
        const d = (s.saleDate || '').split('T')[0];
        return d >= monthStart && d <= todayStr;
      });
    }
    return allSold.filter(s => {
      const d = (s.saleDate || '').split('T')[0];
      if (!d) return false;
      return d >= rangeFrom && d <= rangeTo;
    });
  }, [allSold, soldScope, todayStr, monthStart, rangeFrom, rangeTo]);

  // KPI aggregates for the panel header — count · Σ SP · Σ GP · avg GP%
  const buildKpi = (rows: Sale[]) => {
    const sumSP = rows.reduce((s, r) => s + (r.salePrice  || 0), 0);
    const sumGP = rows.reduce((s, r) => s + (r.grossProfit || 0), 0);
    const avgGpPct = rows.length
      ? rows.reduce((s, r) => s + (r.gpPercent || 0), 0) / rows.length
      : 0;
    return { count: rows.length, sumSP, sumGP, avgGpPct };
  };
  const kpiToday = useMemo(
    () => buildKpi(allSold.filter(s => (s.saleDate || '').split('T')[0] === todayStr)),
    [allSold, todayStr],
  );
  const kpiMonth = useMemo(
    () => buildKpi(allSold.filter(s => {
      const d = (s.saleDate || '').split('T')[0];
      return d >= monthStart && d <= todayStr;
    })),
    [allSold, monthStart, todayStr],
  );
  const kpiAll   = useMemo(() => buildKpi(allSold), [allSold]);
  const kpiScope = useMemo(() => buildKpi(scopedSold), [scopedSold]);

  // Apply search BEFORE grouping so an IMEI hit still surfaces the SKU
  // group containing that IMEI. No top-N slice here — we cap by SKU groups
  // in the render below (so users never see a stack of duplicate rows).
  const filtered = useMemo(() => {
    if (!search.trim()) return inStock;
    const q = search.toLowerCase();
    return inStock.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      u.colour?.toLowerCase().includes(q) ||
      u.storage?.toLowerCase().includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q),
    );
  }, [inStock, search, supplierMap]);

  // Collapse the filtered list into one row per SKU (brand · model · storage ·
  // colour). Mirrors the StockInPage grouping pattern so 354 individual
  // IMEIs render as ~47 expandable rows instead of stacking three identical
  // S21 GREY 128GB lines. Empty / "Unknown" colours collapse to one
  // colour-less bucket (consistent with StockInPage). Sort: largest group
  // first; ties broken alphabetically by model.
  const availableGroups = useMemo(() => {
    const map = new Map<string, {
      key: string;
      sku: { brand: string; model: string; storage?: string; series?: string };
      colour: string;
      units: InventoryUnit[];
    }>();
    for (const u of filtered) {
      const sku = deriveSku(u);
      const colour = u.colour && u.colour !== 'Unknown' ? u.colour : '';
      const key = `${sku.brand}|${sku.model}|${sku.storage || ''}|${colour}`;
      const g = map.get(key);
      if (g) g.units.push(u);
      else map.set(key, { key, sku, colour, units: [u] });
    }
    return Array.from(map.values()).sort((a, b) =>
      b.units.length - a.units.length || a.sku.model.localeCompare(b.sku.model),
    );
  }, [filtered]);

  const handleSaved = () => {
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 3000);
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3 flex-wrap">
          <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <ShoppingCart size={16} className="text-emerald-600" />
          </span>
          Sell
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          In stock · Supplier direct (SHS) · Awaiting IMEI
        </p>
      </div>

      {/* Sale saved toast */}
      <AnimatePresence>
        {savedFlag && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-xl">
            <CheckCircle2 size={16} />
            <p className="text-sm font-bold">Sale recorded successfully!</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => setShowInStock(true)}
          disabled={inStock.length === 0}
          className="bg-emerald-50 border border-emerald-100 rounded-3xl p-3 hover:bg-emerald-100 hover:border-emerald-200 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-default text-left cursor-pointer"
        >
          <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">In Stock</p>
          <p className="text-2xl font-bold font-display mt-1 text-emerald-700">{inStock.length}</p>
          <p className="text-[8px] text-emerald-500 font-mono">in office</p>
        </button>
        <div className="bg-amber-50 border border-amber-100 rounded-3xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-amber-600">SHS</p>
          <p className="text-2xl font-bold font-display mt-1 text-amber-700">{shsTotal}</p>
          <p className="text-[8px] text-amber-500 font-mono">supplier holds</p>
        </div>
        <button
          onClick={() => setShowTodaySales(true)}
          disabled={todaySold.length === 0}
          className="bg-blue-50 border border-blue-100 rounded-3xl p-3 hover:bg-blue-100 hover:border-blue-200 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-default text-left cursor-pointer"
        >
          <p className="text-[8px] font-mono uppercase tracking-widest text-blue-600">Sold Today</p>
          <p className="text-2xl font-bold font-display mt-1 text-blue-700">{todaySold.length}</p>
          <p className="text-[8px] text-blue-500 font-mono">£{todayRevenue.toLocaleString()}</p>
        </button>
      </div>

      {/* Intelligence panel */}
      <IntelligencePanel units={units} mode="sell" />

      {/* Periodic table */}
      <PeriodicInventory units={units} onNavigate={term => setSearch(term)} />

      {/* ── SHS — Supplier Direct Listings ── */}
      {shsUnits.length > 0 && (
        <CollapsibleSection
          title="SHS — Supplier Direct"
          count={shsUnits.length}
          accent="border-l-amber-500"
          defaultOpen={false}
        >
          <div className="px-4 py-2 border-b border-amber-50 bg-amber-50/60">
            <p className="text-[8px] font-mono text-amber-700 leading-relaxed">
              These units are listed on your platforms. Supplier ships directly to the customer when sold.
              Record the sale now — enter IMEI when supplier confirms dispatch.
            </p>
          </div>
          <div className="divide-y divide-gray-50">
            {shsUnits.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/50 transition-all">
                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Truck size={14} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                    {u.colour && u.colour !== 'Unknown' ? u.colour : ''}
                    {u.storage ? ` · ${u.storage}` : ''}
                    {' · '}BP £{u.buyPrice}
                    {' · '}{supplierMap[u.supplierId] || 'Supplier'}
                  </p>
                  {u.notes && u.notes !== 'SHS — Expected stock' && (
                    <p className="text-[8px] text-amber-600 font-mono truncate mt-0.5">{u.notes}</p>
                  )}
                </div>
                <button
                  onClick={() => { setSelected(u); setSelectedIsSHS(true); }}
                  className="px-3 py-2.5 bg-amber-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-1 flex-shrink-0 min-h-[40px]"
                >
                  Record Sale <ChevronRight size={11} />
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Awaiting IMEI from Supplier ── */}
      {awaitingImei.length > 0 && (
        <CollapsibleSection
          title="Awaiting IMEI — Supplier Dispatching"
          count={awaitingImei.length}
          accent="border-l-orange-500"
          defaultOpen={false}
        >
          <div className="px-4 py-2 border-b border-orange-50 bg-orange-50/60">
            <p className="text-[8px] font-mono text-orange-700 leading-relaxed">
              Sold — supplier is dispatching to the customer. Enter IMEI once supplier sends the dispatch confirmation / invoice.
            </p>
          </div>
          <div className="divide-y divide-orange-50">
            {awaitingImei.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-orange-50/40 transition-all">
                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <PackageCheck size={14} className="text-orange-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{u.model}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {u.colour && u.colour !== 'Unknown' && (
                      <span className="text-[8px] text-gray-500 font-mono">{u.colour}</span>
                    )}
                    {u.storage && (
                      <span className="text-[8px] text-gray-500 font-mono">{u.storage}</span>
                    )}
                    {u.salePlatform && (
                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${PLATFORM_STYLE[u.salePlatform] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {u.salePlatform}
                      </span>
                    )}
                    {u.saleOrderId && (
                      <span className="text-[8px] text-gray-400 font-mono">{u.saleOrderId}</span>
                    )}
                  </div>
                  <p className="text-[8px] text-gray-400 font-mono mt-0.5">
                    Sold {u.saleDate} · £{u.salePrice}
                  </p>
                </div>
                <button
                  onClick={() => setEnterImeiUnit(u)}
                  className="px-3 py-2.5 bg-orange-500 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-orange-600 transition-all flex items-center gap-1 flex-shrink-0 min-h-[40px]"
                >
                  <Pencil size={10} /> Enter IMEI
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Yesterday pill */}
      {ystdSold.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-xl">
          <Clock size={13} className="text-gray-400" />
          <span className="text-[10px] font-mono text-gray-400">Yesterday:</span>
          <span className="text-[10px] font-bold">{ystdSold.length} sold</span>
          <span className="text-[10px] text-gray-500">·</span>
          <span className="text-[10px] font-bold text-emerald-400">
            £{ystdSold.reduce((s, u) => s + (u.salePrice || 0), 0).toLocaleString()} revenue
          </span>
        </div>
      )}

      {/* Search — in stock */}
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">Search In-Stock Phones</p>
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Model, IMEI, colour, storage…"
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-black transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Available stock — grouped by (brand, model, storage, colour) so 354
          IMEIs collapse to ~47 SKU rows. Click a row to expand the per-IMEI
          list; each child row has its own SELL button for IMEI-level
          targeting, while the group-level SELL button opens the existing
          single-unit modal on the first IMEI in the group. */}
      <CollapsibleSection
        title="Available Stock"
        count={`${availableGroups.length} SKUs · ${filtered.length} units`}
        accent="border-l-emerald-500"
        defaultOpen={false}
      >
        {inStock.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-300">
            <ShoppingCart size={40} />
            <p className="text-xs font-mono">No stock in office. Add a supplier delivery on Stock In.</p>
          </div>
        ) : availableGroups.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <Search size={32} />
            <p className="text-xs font-mono">No units match "{search}"</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {availableGroups.map(group => {
              const isOpen = expandedId === group.key;
              const head = group.units[0];
              const isSHS = head.batchId?.startsWith('shs_') || head.notes?.includes('SHS');
              const qty = group.units.length;
              // BP summary: if every unit in the group shares the same BP,
              // show a single price. Otherwise show "from £min" so the
              // operator sees the cheapest unit at a glance without us
              // hiding the variance. Defensive against the all-zero-BP case
              // (pre-fix imports) — just renders "£0".
              const bps = group.units.map(u => u.buyPrice || 0);
              const minBp = bps.reduce((m, v) => (v < m ? v : m), bps[0] ?? 0);
              const maxBp = bps.reduce((m, v) => (v > m ? v : m), bps[0] ?? 0);
              const bpLabel = minBp === maxBp ? `£${minBp}` : `from £${minBp}`;
              const titleParts = [
                group.sku.model,
                group.sku.storage,
                group.colour || null,
              ].filter(Boolean);
              // SKU-level listing state — union of `listingSites` across the
              // available units. Drives both the chip strip and the editor
              // seed when ops opens the marketplace picker from this row.
              const skuLabel = [group.sku.brand, ...titleParts].filter(Boolean).join(' ');
              const listing = deriveSkuListing(group.units);
              return (
                <div key={group.key}>
                  <div className={`flex items-center gap-3 px-4 py-3 transition-all ${
                    isSHS ? 'bg-orange-50/60 hover:bg-orange-50' : 'hover:bg-gray-50'
                  }`}>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-bold truncate">{titleParts.join(' · ')}</p>
                        {qty > 1 && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                            ×{qty} units
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                        {qty} unit{qty === 1 ? '' : 's'} · {bpLabel} ea
                      </p>
                      {/* SKU-level marketplace chips — one listing per
                          marketplace per SKU, quantity decrements as units
                          sell. Edit opens SkuListingEditor. */}
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className="text-[8px] font-mono uppercase tracking-widest text-gray-400">
                          Listed on:
                        </span>
                        {listing.listedOn.length === 0 ? (
                          <span className="text-[9px] font-mono text-gray-400 italic">Not listed</span>
                        ) : (
                          listing.listedOn.map(site => (
                            <span
                              key={site}
                              className="text-[8px] font-bold px-1.5 py-0.5 bg-gray-900 text-white rounded font-mono uppercase tracking-tighter"
                            >
                              {listingSiteLabel(site)}
                            </span>
                          ))
                        )}
                        <button
                          type="button"
                          onClick={() => setListingEditor({
                            label: skuLabel,
                            units: group.units,
                            current: listing.listedOn,
                          })}
                          className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-emerald-700 hover:text-white hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 px-1.5 py-0.5 rounded font-mono transition-all"
                          title="Edit SKU marketplace listings"
                        >
                          <Pencil size={9} /> Edit
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">{bpLabel}</span>
                      <button onClick={() => setExpandedId(isOpen ? null : group.key)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button onClick={() => { setSelected(group.units[0]); setSelectedIsSHS(false); }}
                        className="px-3 py-2.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1 min-h-[40px]">
                        Sell <ChevronRight size={11} />
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100"
                      >
                        <div className="divide-y divide-gray-100">
                          {group.units.map(u => (
                            <div key={u.id} className="px-5 py-2.5 flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-mono text-gray-700 flex items-center gap-2 flex-wrap">
                                  <CopyImei imei={u.imei} truncate={14} />
                                  <span className="text-gray-400">·</span>
                                  <span className="text-gray-500">{supplierMap[u.supplierId] || '—'}</span>
                                  <span className="text-gray-400">·</span>
                                  <span className="text-gray-500">{u.dateIn || '—'}</span>
                                  <span className="text-gray-400">·</span>
                                  <span className="text-gray-700 font-bold">£{u.buyPrice}</span>
                                </p>
                                <p className="text-[8px] text-gray-400 font-mono mt-0.5">
                                  Batch: {u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default')}
                                </p>
                              </div>
                              <button onClick={() => { setSelected(u); setSelectedIsSHS(false); }}
                                className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1 flex-shrink-0">
                                Sell <ChevronRight size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* Sold History — Excel-parity, merges master `sales` + legacy in-app sells */}
      <CollapsibleSection
        title="Sold History"
        count={allSold.length}
        accent="border-l-blue-500"
        defaultOpen={false}
      >
        {allSold.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <ShoppingCart size={32} />
            <p className="text-xs font-mono">No sold items yet.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {/* KPI strip — Today · This Month · All Time + active scope summary */}
            <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-b from-gray-50 to-white grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: 'Today',      k: kpiToday },
                { label: 'This Month', k: kpiMonth },
                { label: 'All Time',   k: kpiAll   },
                { label: 'In Scope',   k: kpiScope, highlight: true },
              ].map(({ label, k, highlight }) => (
                <div
                  key={label}
                  className={`rounded-xl border p-2.5 ${
                    highlight
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-white border-gray-100'
                  }`}
                >
                  <p className="text-[8px] font-mono uppercase tracking-widest text-gray-400">
                    {label}
                  </p>
                  <p className="text-lg font-bold font-display leading-tight mt-0.5">
                    {k.count.toLocaleString('en-GB')}
                    <span className="text-[9px] font-mono text-gray-400 ml-1">units</span>
                  </p>
                  <p className="text-[10px] font-mono text-gray-600 mt-0.5">
                    £{k.sumSP.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                    <span className="text-gray-300 mx-1">·</span>
                    <span className={k.sumGP < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                      GP £{k.sumGP.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-gray-300 mx-1">·</span>
                    <span className={k.avgGpPct < 0 ? 'text-red-600' : 'text-emerald-700'}>
                      {k.avgGpPct.toFixed(1)}%
                    </span>
                  </p>
                </div>
              ))}
            </div>

            {/* Scope tabs + range picker */}
            <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center gap-2 flex-wrap">
              <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden">
                {(['today','month','range','all'] as SoldScope[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setSoldScope(s)}
                    className={`px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest transition-all ${
                      soldScope === s
                        ? 'bg-black text-white'
                        : 'bg-white text-gray-500 hover:text-black hover:bg-gray-50'
                    }`}
                  >
                    {s === 'today' ? 'Today' : s === 'month' ? 'This Month' : s === 'range' ? 'Date Range' : 'All Time'}
                  </button>
                ))}
              </div>
              {soldScope === 'range' && (
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={e => setRangeFrom(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-gray-400">→</span>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={e => setRangeTo(e.target.value)}
                    className="bg-gray-50 border border-gray-200 rounded px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Excel-style sticky-header grid */}
            <div className="max-h-[560px] overflow-auto custom-scrollbar">
              {scopedSold.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-400 font-mono text-[11px]">
                  No sales in this scope.
                </div>
              ) : (
                <table
                  className="w-full border-collapse"
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 }}
                >
                  <thead className="sticky top-0 z-10 bg-gray-100 shadow-sm">
                    <tr>
                      {[
                        { label: 'Date',        w: 100 },
                        { label: 'Market',      w: 80  },
                        { label: 'Model',       w: 200 },
                        { label: 'IMEI',        w: 140 },
                        { label: 'Order #',     w: 140 },
                        { label: 'BP',          w: 70,  align: 'right' as const },
                        { label: 'SP',          w: 70,  align: 'right' as const },
                        { label: 'Postage',     w: 70,  align: 'right' as const },
                        { label: 'Commission',  w: 90,  align: 'right' as const },
                        { label: 'GP',          w: 80,  align: 'right' as const },
                        { label: 'GP%',         w: 60,  align: 'right' as const },
                        { label: 'Pay/Detail',  w: 130 },
                      ].map(c => (
                        <th
                          key={c.label}
                          className="px-2 py-2 text-[9px] font-bold uppercase tracking-widest text-gray-500 border-b border-r border-gray-200"
                          style={{ width: c.w, textAlign: c.align ?? 'left' }}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scopedSold.map(s => {
                      const isInApp  = s.importBatchId === 'inapp';
                      const unit     = s.unitId ? units.find(u => u.id === s.unitId) : undefined;
                      const modelStr = unit?.model
                        || [unit?.brand, unit?.model, unit?.storage, unit?.colour].filter(Boolean).join(' ')
                        || s.sku
                        || '—';
                      const gpPct = s.buyPrice > 0
                        ? (s.grossProfit / s.buyPrice) * 100
                        : 0;
                      // Marketplace-specific extra detail (BM payment, eBay net profit)
                      let detail: React.ReactNode = '—';
                      if (s.marketplace === 'BM') {
                        detail = (
                          <span className="text-[10px] text-gray-700">
                            {s.paymentMode || '—'}
                          </span>
                        );
                      } else if (s.marketplace === 'EBAY') {
                        const np = s.netProfit ?? s.grossProfit;
                        detail = (
                          <span
                            className={`text-[10px] font-bold ${np < 0 ? 'text-red-600' : 'text-emerald-700'}`}
                            title={`ROF ${fmtGBP(s.rof)} · FVF ${fmtGBP(s.fvf)} · 20% ${fmtGBP(s.twentyPercent)} · Net ${fmtGBP(np)}`}
                          >
                            Net {fmtGBP(np)}
                          </span>
                        );
                      }
                      return (
                        <tr
                          key={s.id}
                          className={`hover:bg-blue-50/60 transition-colors ${isInApp ? 'bg-blue-50/30' : ''}`}
                          title={isInApp ? 'In-app sale (recorded via Sell page)' : 'Imported sale (master file)'}
                        >
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-gray-800">
                            {s.saleDate ? fmtDateForUser(s.saleDate, region) : '—'}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100">
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border font-mono ${
                                MARKETPLACE_BADGE[s.marketplace] ?? 'bg-gray-100 text-gray-600 border-gray-200'
                              }`}
                            >
                              {s.marketplace}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 truncate text-gray-800" title={modelStr}>
                            {modelStr}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100">
                            {s.imei ? <CopyImei imei={s.imei} truncate={12} /> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 truncate text-gray-600" title={s.orderNumber}>
                            {s.orderNumber || '—'}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right">{fmtGBP(s.buyPrice)}</td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right font-bold">{fmtGBP(s.salePrice)}</td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right text-red-600">
                            {s.postage ? `-${fmtGBP(s.postage)}` : '—'}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right text-red-600">
                            {s.commission ? `-${fmtGBP(s.commission)}` : '—'}
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right">
                            <span className={s.grossProfit < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                              {fmtGBP(s.grossProfit)}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100 text-right">
                            <span className={gpPct < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                              {gpPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-2 py-1.5 border-b border-r border-gray-100">
                            {detail}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer hint — link to full Admin view */}
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-[9px] font-mono uppercase tracking-widest text-gray-500 flex items-center justify-between flex-wrap gap-2">
              <span>
                {scopedSold.length.toLocaleString('en-GB')} row{scopedSold.length === 1 ? '' : 's'} shown
                <span className="text-gray-300 mx-2">·</span>
                <span className="text-blue-700 normal-case tracking-normal">Blue rows = in-app sales</span>
              </span>
              <span className="text-gray-400 normal-case tracking-normal">
                For full Excel-parity view (search · sort · marketplace chips) see Admin → Sales History.
              </span>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* Sell modal */}
      {selected && (
        <SellOrderModal
          unit={selected}
          isSHS={selectedIsSHS}
          onClose={() => { setSelected(null); setSelectedIsSHS(false); }}
          onSaved={handleSaved}
        />
      )}

      {/* Enter IMEI modal */}
      {enterImeiUnit && (
        <EnterImeiModal
          unit={enterImeiUnit}
          onClose={() => setEnterImeiUnit(null)}
          onSaved={handleSaved}
        />
      )}

      {/* Today's Sales modal */}
      <AnimatePresence>
        {showTodaySales && (
          <TodaySalesModal
            units={todaySold}
            onClose={() => setShowTodaySales(false)}
          />
        )}
      </AnimatePresence>

      {/* In Stock modal */}
      <AnimatePresence>
        {showInStock && (
          <InStockModal
            units={inStock}
            onClose={() => setShowInStock(false)}
          />
        )}
      </AnimatePresence>

      {/* SKU-level listing editor — same flow as Pending IMEIs on StockInPage.
          Mirrors `dbService.setSkuListingSites` writes to every available
          unit in the SKU so the derived union (deriveSkuListing) collapses
          back to the chosen set on the next snapshot. */}
      {listingEditor && (
        <SkuListingEditor
          skuLabel={listingEditor.label}
          units={listingEditor.units}
          current={listingEditor.current}
          onClose={() => setListingEditor(null)}
          onSaved={() => setListingEditor(null)}
        />
      )}
    </div>
  );
}
