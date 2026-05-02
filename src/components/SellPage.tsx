import React, { useState, useEffect, useMemo } from 'react';
import {
  ShoppingCart, Search, CheckCircle2, Clock, ChevronRight,
  X, Package, AlertCircle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import CopyImei from './CopyImei';
import { PLATFORM_LIST, PLATFORMS, DEFAULT_POSTAGE_COST, platformTotalFee, calcNetProfit } from '../lib/platforms';
import CollapsibleSection from './CollapsibleSection';

// ── helpers ────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

const PLATFORM_STYLE: Record<string, string> = {
  eBay: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  Amazon: 'bg-orange-50 text-orange-800 border-orange-200',
  OnBuy: 'bg-blue-50   text-blue-800   border-blue-200',
  Backmarket: 'bg-green-50  text-green-800  border-green-200',
};

// ── SellOrderModal ──────────────────────────────────────────────────────────
function SellOrderModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: InventoryUnit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sp, setSp] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORM_LIST[0]);
  const [orderId, setOrderId] = useState('');
  const [saleDate, setSaleDate] = useState(today());
  const [postage, setPostage] = useState(String(DEFAULT_POSTAGE_COST));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const spNum = sp ? Number(sp) : 0;
  const postageNum = postage ? Number(postage) : DEFAULT_POSTAGE_COST;
  const platformFee = spNum > 0 ? platformTotalFee(platform, spNum) : 0;
  const netProfit = spNum > 0 ? calcNetProfit(spNum, unit.buyPrice, platform, postageNum) : null;

  const handleSave = async () => {
    if (!sp || Number(sp) <= 0) { setError('Please enter a valid selling price.'); return; }
    if (!orderId.trim()) { setError('Please enter the order number from the platform.'); return; }
    setSaving(true);
    try {
      await dbService.update('inventoryUnits', unit.id, {
        status: 'sold',
        salePrice: Number(sp),
        salePlatform: platform,
        saleOrderId: orderId.trim(),
        saleDate,
        postageCost: postageNum,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 md:p-4 bg-black/40 backdrop-blur-sm">
      {/* max-h keeps modal within viewport; flex-col lets body scroll while footer stays fixed */}
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col" style={{ maxHeight: 'calc(100dvh - 24px)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Record Sale</p>
            <h3 className="text-base font-bold truncate mt-0.5 max-w-[280px]">{unit.model}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Unit summary */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CopyImei imei={unit.imei} truncate={12} />
              <span className="text-[8px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.5 rounded-full uppercase">In Stock</span>
            </div>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">
              Paid: <span className="font-bold text-black">£{unit.buyPrice}</span>
              {unit.colour && <> · {unit.colour}</>}
              {unit.storage && <> · {unit.storage}</>}
            </p>
          </div>
        </div>

        {/* Form — scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Platform */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-2">
              Selling Platform *
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORM_LIST.map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={`py-2.5 px-3 rounded-xl border text-[10px] font-bold transition-all flex items-center justify-between ${platform === p
                      ? 'bg-black text-white border-black'
                      : `${PLATFORM_STYLE[p]} hover:opacity-80`
                    }`}
                >
                  {p}
                  {platform === p && <CheckCircle2 size={12} />}
                  {platform !== p && (
                    <span className="text-[8px] font-mono opacity-60">{PLATFORMS[p as keyof typeof PLATFORMS].commission}%</span>
                  )}
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

          {/* Selling Price */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              Selling Price (£) *
            </label>
            <input
              type="number"
              value={sp}
              onChange={e => { setSp(e.target.value); setError(''); }}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold font-mono focus:outline-none focus:border-black transition-all"
            />
          </div>

          {/* Sale Date */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              Sale Date
            </label>
            <input
              type="date"
              value={saleDate}
              onChange={e => setSaleDate(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
            />
          </div>

          {/* Postage Cost */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-widest text-gray-400 block mb-1.5">
              Postage Cost (£) <span className="normal-case font-normal text-gray-400">— default £{DEFAULT_POSTAGE_COST}</span>
            </label>
            <input
              type="number"
              value={postage}
              onChange={e => setPostage(e.target.value)}
              placeholder={String(DEFAULT_POSTAGE_COST)}
              min="0"
              step="0.01"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black transition-all"
            />
          </div>

          {/* Live P&L preview */}
          {sp && Number(sp) > 0 && (
            <div className={`rounded-xl p-4 border ${netProfit! >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className="text-[9px] font-mono uppercase tracking-widest text-gray-500 mb-2">Profit Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-center mb-2">
                <div>
                  <p className="text-[8px] text-gray-400 font-mono">Sold For</p>
                  <p className="text-sm font-bold">£{spNum.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-400 font-mono">Bought For (BP)</p>
                  <p className="text-sm font-bold text-gray-600">£{unit.buyPrice}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-400 font-mono">{platform} Fee (incl. fixed)</p>
                  <p className="text-sm font-bold text-red-600">-£{platformFee}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-400 font-mono">Postage</p>
                  <p className="text-sm font-bold text-red-600">-£{postageNum}</p>
                </div>
              </div>
              <div className={`rounded-lg px-3 py-2 text-center border-t ${netProfit! >= 0 ? 'border-emerald-200' : 'border-red-200'}`}>
                <p className="text-[8px] text-gray-400 font-mono mb-0.5">Net Profit</p>
                <p className={`text-lg font-bold ${netProfit! >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {netProfit! >= 0 ? '+' : ''}£{netProfit}
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={14} />
              <p className="text-xs font-mono">{error}</p>
            </div>
          )}
        </div>

        {/* Footer — always pinned, never pushed off screen */}
        <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 flex gap-3 bg-white">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 rounded-xl text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? 'Saving…' : <>Confirm Sale <CheckCircle2 size={13} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Sell Page ──────────────────────────────────────────────────────────
export default function SellPage() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InventoryUnit | null>(null);
  const [savedFlag, setSavedFlag] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return u;
  }, []);

  const todayStr = today();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // ONLY in-stock units for selling
  const inStock = useMemo(() => units.filter(u => u.status === 'available'), [units]);

  // Sold units for today's summary
  const sold = useMemo(() => units.filter(u => u.status === 'sold'), [units]);
  const todaySold = sold.filter(u => u.saleDate === todayStr);
  const ystdSold = sold.filter(u => u.saleDate === yesterday);
  const todayRevenue = todaySold.reduce((s, u) => s + (u.salePrice || 0), 0);
  const todayProfit = todaySold.reduce((s, u) => s + ((u.salePrice || 0) - u.buyPrice), 0);

  // Filtered in-stock for search
  const filtered = useMemo(() => {
    if (!search.trim()) return inStock.slice(0, 80);
    const q = search.toLowerCase();
    return inStock.filter(u =>
      u.model.toLowerCase().includes(q) ||
      u.imei.includes(q) ||
      u.colour?.toLowerCase().includes(q) ||
      u.storage?.toLowerCase().includes(q) ||
      u.supplierId?.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [inStock, search]);

  const handleSaved = () => {
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 3000);
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">

      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <ShoppingCart size={16} className="text-emerald-600" />
          </span>
          Sell
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Select a phone from stock → enter order details → confirm sale
        </p>
      </div>

      {/* Sale saved toast */}
      {savedFlag && (
        <div className="flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-xl">
          <CheckCircle2 size={16} />
          <p className="text-sm font-bold">Sale recorded successfully!</p>
        </div>
      )}

      {/* Today's summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-emerald-600">In Stock</p>
          <p className="text-2xl font-bold font-display mt-1 text-emerald-700">{inStock.length}</p>
          <p className="text-[8px] text-emerald-500 font-mono">available to sell</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-blue-600">Sold Today</p>
          <p className="text-2xl font-bold font-display mt-1 text-blue-700">{todaySold.length}</p>
          <p className="text-[8px] text-blue-500 font-mono">£{todayRevenue.toLocaleString()} revenue</p>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-purple-600">Today Profit</p>
          <p className="text-xl font-bold font-display mt-1 text-purple-700">£{todayProfit.toLocaleString()}</p>
          <p className="text-[8px] text-purple-500 font-mono">gross margin</p>
        </div>
      </div>

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

      {/* Search — in stock only */}
      <div>
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-2">
          Search In-Stock Phones
        </p>
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by model, IMEI, colour, storage…"
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

      {/* In-stock list */}
      <CollapsibleSection
        title="Available Stock"
        count={`${filtered.length}${inStock.length > 80 && !search ? ` of ${inStock.length}` : ''}`}
        accent="border-l-emerald-500"
        defaultOpen={true}
      >

        {inStock.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-3 text-gray-300">
            <ShoppingCart size={40} />
            <p className="text-xs font-mono">No stock available. Add a supplier delivery first.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <Search size={32} />
            <p className="text-xs font-mono">No in-stock units match "{search}"</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => {
              const isOpen = expandedId === u.id;
              return (
                <div key={u.id}>
                  {/* Collapsed row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{u.model}</p>
                      <p className="text-[9px] text-gray-400 font-mono mt-0.5 truncate">
                        <CopyImei imei={u.imei} truncate={10} />
                        {u.colour && <> · {u.colour}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold">£{u.buyPrice}</span>
                      {/* Expand/collapse */}
                      <button onClick={() => setExpandedId(isOpen ? null : u.id)}
                        className="p-1.5 hover:bg-gray-100 rounded-lg transition-all text-gray-400">
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {/* Sell button */}
                      <button onClick={() => setSelected(u)}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-1">
                        Sell <ChevronRight size={11} />
                      </button>
                    </div>
                  </div>
                  {/* Expanded details */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-gray-50 border-t border-gray-100">
                        <div className="px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                          {[
                            { label: 'Condition', value: u.conditionGrade ? `Grade ${u.conditionGrade}` : '—' },
                            { label: 'Storage', value: u.storage || '—' },
                            { label: 'Date In', value: u.dateIn || '—' },
                            { label: 'Status', value: 'In Stock' },
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

      {/* Sell order modal */}
      {selected && (
      <SellOrderModal
        unit={selected}
        onClose={() => setSelected(null)}
        onSaved={handleSaved}
      />
    )
  }
    </div >
  );
}
