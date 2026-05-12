import React, { useState, useMemo } from 'react';
import {
  ShoppingCart, Search, CheckCircle2, Clock, ChevronRight,
  X, Package, AlertCircle, ChevronDown, ChevronUp,
  Truck, Pencil, AlertTriangle, PackageCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';
import { groupIdenticalUnits } from '../lib/unitGroups';
import ColourBreakdown from './ColourBreakdown';
import CopyImei from './CopyImei';
import {
  PLATFORM_LIST, PLATFORMS, DEFAULT_POSTAGE_COST,
  platformTotalFee, calcNetProfit, platformFixedFee,
} from '../lib/platforms';
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

      // Calculate profit for notification
      const profit = calcNetProfit(spNum, unit.buyPrice, platform, postageNum);
      const notificationType = profit < 0 ? 'loss_sell' : 'sold';
      console.log(`[Sale] Selling ${unit.model} at £${spNum} on ${platform}`, { profit, notificationType });

      await dbService.update('inventoryUnits', unit.id, {
        status:      'sold',
        salePrice:   spNum,
        salePlatform: platform,
        saleOrderId: orderId.trim(),
        saleDate,
        postageCost: postageNum,
        ...(isSHS && imeiInput.trim() ? { imei: imeiInput.trim() } : {}),
      });

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
  const { units, suppliers }        = useInventoryStore();
  const [search, setSearch]         = useState('');
  const [selected, setSelected]     = useState<InventoryUnit | null>(null);
  const [selectedIsSHS, setSelectedIsSHS] = useState(false);
  const [savedFlag, setSavedFlag]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [enterImeiUnit, setEnterImeiUnit] = useState<InventoryUnit | null>(null);
  const [showTodaySales, setShowTodaySales] = useState(false);
  const [showInStock, setShowInStock] = useState(false);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  const todayStr  = today();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const inStock   = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  const shsUnits  = useMemo(() =>
    [...units.filter(u => u.status === 'incoming')]
      .sort((a, b) => (b.dateIn || '').localeCompare(a.dateIn || '')),
    [units],
  );
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

  const filtered = useMemo(() => {
    if (!search.trim()) return inStock.slice(0, 80);
    const q = search.toLowerCase();
    return inStock.filter(u =>
      u.model.toLowerCase().includes(q) ||
      (u.imei || '').toLowerCase().includes(q) ||
      u.colour?.toLowerCase().includes(q) ||
      u.storage?.toLowerCase().includes(q) ||
      (supplierMap[u.supplierId] || '').toLowerCase().includes(q),
    );
  }, [inStock, search, supplierMap]);

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
          <p className="text-[8px] font-mono uppercase tracking-widest text-amber-600">SHS Listed</p>
          <p className="text-2xl font-bold font-display mt-1 text-amber-700">{shsUnits.length}</p>
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
            {groupIdenticalUnits(shsUnits).map(g => {
              const u = g.representative;
              return (
              <div key={g.key} className="flex items-start gap-3 px-4 py-3 hover:bg-amber-50/50 transition-all">
                <div className="relative w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Truck size={14} className="text-amber-600" />
                  {g.count > 1 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center">
                      ×{g.count}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">
                    {u.model}{g.count > 1 ? <span className="ml-1 text-amber-600 font-mono">× {g.count}</span> : null}
                  </p>
                  <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                    {g.colours.length === 1 && u.colour && u.colour !== 'Unknown'
                      ? <>{u.colour}{u.storage ? ` · ${u.storage}` : ''}</>
                      : <>{g.colours.length} colours{u.storage ? ` · ${u.storage}` : ''}</>}
                    {' · '}BP £{u.buyPrice}
                    {' · '}{supplierMap[u.supplierId] || 'Supplier'}
                  </p>
                  {u.notes && u.notes !== 'SHS — Expected stock' && (
                    <p className="text-[8px] text-amber-600 font-mono truncate mt-0.5">{u.notes}</p>
                  )}
                  <ColourBreakdown
                    colours={g.colours}
                    accentClass="bg-amber-500 text-white"
                    onPickColour={entry => { setSelected(entry.units[0]); setSelectedIsSHS(true); }}
                  />
                </div>
                <button
                  onClick={() => { setSelected(u); setSelectedIsSHS(true); }}
                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-1 flex-shrink-0 mt-0.5"
                >
                  Record Sale <ChevronRight size={11} />
                </button>
              </div>
              );
            })}
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
                  className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-orange-600 transition-all flex items-center gap-1 flex-shrink-0"
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

      {/* Available stock */}
      <CollapsibleSection
        title="Available Stock"
        count={`${filtered.length}${inStock.length > 80 && !search ? ` of ${inStock.length}` : ''}`}
        accent="border-l-emerald-500"
        defaultOpen={false}
      >
        {inStock.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-300">
            <ShoppingCart size={40} />
            <p className="text-xs font-mono">No stock in office. Add a supplier delivery on Stock In.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <Search size={32} />
            <p className="text-xs font-mono">No units match "{search}"</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => {
              const isOpen = expandedId === u.id;
              const isSHS = u.batchId?.startsWith('shs_') || u.notes?.includes('SHS');
              return (
                <div key={u.id}>
                  <div className={`flex items-center gap-3 px-4 py-3 transition-all ${
                    isSHS
                      ? 'bg-orange-50/60 hover:bg-orange-50'
                      : 'hover:bg-gray-50'
                  }`}>
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                        <CopyImei imei={u.imei} truncate={10} />
                        {u.colour && <> · {u.colour}</>}
                        {u.storage && <> · {u.storage}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{u.buyPrice}</span>
                      <button onClick={() => setExpandedId(isOpen ? null : u.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button onClick={() => { setSelected(u); setSelectedIsSHS(false); }}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1">
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
                        <div className="px-6 py-3 grid grid-cols-4 gap-3 text-center">
                          {[
                            { label: 'Storage', value: u.storage || '—' },
                            { label: 'Date In', value: u.dateIn || '—' },
                            { label: 'Supplier', value: supplierMap[u.supplierId] || '—' },
                            { label: 'Batch', value: u.batchId === 'master_batch' ? 'Master' : (u.batchId || 'Default') },
                          ].map(f => (
                            <div key={f.label}>
                              <p className="text-[8px] text-gray-400 font-mono uppercase tracking-widest">{f.label}</p>
                              <p className="text-xs font-bold mt-0.5">{f.value}</p>
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

      {/* Sold History */}
      <CollapsibleSection
        title="Sold History"
        count={sold.length}
        accent="border-l-blue-500"
        defaultOpen={false}
      >
        {sold.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <ShoppingCart size={32} />
            <p className="text-xs font-mono">No sold items yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {Object.entries(
              sold.reduce((acc, u) => {
                const d = u.saleDate || 'Unknown';
                if (!acc[d]) acc[d] = [];
                acc[d].push(u);
                return acc;
              }, {} as Record<string, InventoryUnit[]>),
            )
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, dayUnits]: [string, InventoryUnit[]]) => (
                <div key={date} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
                      {date === todayStr
                        ? 'Today'
                        : date === yesterday
                          ? 'Yesterday'
                          : date !== 'Unknown'
                            ? new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
                            : 'Unknown Date'}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{dayUnits.length} unit{dayUnits.length !== 1 ? 's' : ''}</span>
                    <span className="text-[10px] font-bold text-emerald-600 ml-auto">
                      £{dayUnits.reduce((s, u) => s + (u.salePrice || 0), 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid gap-2">
                    {dayUnits.map(u => {
                      const platformFee = u.salePrice && u.salePlatform ? platformTotalFee(u.salePlatform, u.salePrice) : 0;
                      const feePercentage = u.salePrice && platformFee ? ((platformFee / u.salePrice) * 100).toFixed(1) : '0';
                      const isSHS = u.batchId?.startsWith('shs_') || u.notes?.includes('SHS');
                      return (
                        <div key={u.id} className={isSHS ? 'bg-orange-50/60 rounded-xl' : ''}>
                          <div className={`flex items-center justify-between p-3 border rounded-t-xl transition-all ${
                            isSHS
                              ? 'bg-orange-50 hover:border-orange-200 border-orange-100'
                              : `bg-white hover:border-blue-200 ${!u.imei ? 'border-orange-200' : 'border-gray-100'}`
                          }`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${!u.imei ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-600'}`}>
                                {!u.imei ? <Truck size={14} /> : <ShoppingCart size={14} />}
                              </div>
                              <div>
                                <p className="text-xs font-bold">{u.model}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {u.imei
                                    ? <CopyImei imei={u.imei} truncate={10} />
                                    : <button
                                        onClick={() => setEnterImeiUnit(u)}
                                        className="flex items-center gap-1 text-[9px] font-bold font-mono bg-orange-100 text-orange-700 border border-orange-300 px-1.5 py-0.5 rounded hover:bg-orange-200 transition-all"
                                      >
                                        <Pencil size={9} /> Enter IMEI
                                      </button>
                                  }
                                  {u.salePlatform && (
                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${PLATFORM_STYLE[u.salePlatform] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                      {u.salePlatform}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-bold text-emerald-600">£{u.salePrice}</p>
                              {u.saleOrderId && <p className="text-[9px] font-mono text-gray-400 mt-0.5">{u.saleOrderId}</p>}
                            </div>
                          </div>
                          <div className={`px-3 pb-3 border border-t-0 rounded-b-xl ${
                            isSHS
                              ? 'bg-orange-50/40 border-orange-100'
                              : 'bg-gray-50 border-gray-100'
                          }`}>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[9px]">
                              <div>
                                <p className="text-gray-500 font-mono uppercase tracking-widest mb-0.5">Buy Price</p>
                                <p className="font-bold">£{u.buyPrice}</p>
                              </div>
                              <div>
                                <p className="text-gray-500 font-mono uppercase tracking-widest mb-0.5">Fee</p>
                                <p className="font-bold text-red-600">-£{platformFee.toFixed(2)} ({feePercentage}%)</p>
                              </div>
                              <div>
                                <p className="text-gray-500 font-mono uppercase tracking-widest mb-0.5">Postage</p>
                                <p className="font-bold text-red-600">-£{(u.postageCost || 3.5).toFixed(2)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
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
    </div>
  );
}
