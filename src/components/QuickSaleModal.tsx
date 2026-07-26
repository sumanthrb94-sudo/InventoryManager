import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { X, ShoppingBag, RotateCcw, PackagePlus, CheckCircle2, ChevronRight, Tag } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Marketplace, MARKETPLACES } from '../types';
import { recordSale } from '../services';
import { calcSaleFinancials } from '../lib/platforms';

/** Operator-facing platform list — the 4 marketplaces the operator sells
 *  on. Mirrors SellOrderModal so the two surfaces stay in lockstep. */
const ACTIVE_PLATFORMS: ReadonlyArray<Marketplace> = MARKETPLACES;

const PLATFORM_LABEL: Record<Marketplace, string> = {
  AMAZON:  'Amazon',
  BM:      'Back Market',
  EBAY:    'eBay',
  ONBUY:   'OnBuy',
  TEMU:    'Temu',
};

interface Props {
  unit?: InventoryUnit;
  availableUnits?: InventoryUnit[];
  onClose: () => void;
}

export default function QuickSaleModal({ unit: initialUnit, availableUnits = [], onClose }: Props) {
  const [selectedUnit, setSelectedUnit] = useState<InventoryUnit | null>(initialUnit || null);
  const [imeiSearch, setImeiSearch] = useState('');
  const [action,    setAction]    = useState<'sold' | 'returned' | 'available'>('sold');
  const [platform,  setPlatform]  = useState<Marketplace>('EBAY');
  const [salePrice, setSalePrice] = useState(initialUnit?.salePrice?.toString() || '');
  const [sku,       setSku]       = useState(initialUnit?.sku || '');
  const [saleOrderId, setSaleOrderId] = useState(initialUnit?.saleOrderId || '');
  const [notes,     setNotes]     = useState(initialUnit?.notes || '');
  const [saving,    setSaving]    = useState(false);
  const [done,      setDone]      = useState(false);
  const [saveError, setSaveError] = useState('');

  const today = new Date().toISOString().split('T')[0];

  const filteredUnits = useMemo(() => {
    if (!imeiSearch) return availableUnits;
    const s = imeiSearch.toLowerCase();
    return availableUnits.filter(u =>
      (u.imei || '').toLowerCase().includes(s) ||
      u.colour.toLowerCase().includes(s)
    );
  }, [availableUnits, imeiSearch]);

  // ── Live GP preview — same math the recordSale write path will run, so the
  // operator sees the master-aligned answer before confirming. Uses each
  // platform's default fee schedule (no postage override here — Quick modal
  // stays lightweight; SellOrderModal is the full P&L surface). ──────────────
  const spNum = Number(salePrice) || 0;
  const gpPreview = useMemo(() => {
    if (action !== 'sold' || !selectedUnit || spNum <= 0) return null;
    try {
      return calcSaleFinancials({
        marketplace: platform,
        buyPrice: selectedUnit.buyPrice,
        salePrice: spNum,
      });
    } catch {
      return null;
    }
  }, [action, selectedUnit, platform, spNum]);

  const save = async () => {
    if (!selectedUnit) return;
    setSaving(true);
    setSaveError('');
    try {
      if (action === 'sold') {
        // Route through recordSale so calcSaleFinancials, the sales-doc write,
        // and the unit status flip all run from one place.
        const res = await recordSale({
          marketplace: platform,
          orderNumber: saleOrderId.trim(),
          unitId: selectedUnit.id,
          buyPrice: selectedUnit.buyPrice,
          salePrice: spNum,
          saleDate: today,
          sku: sku.trim() || undefined,
          comments: notes || undefined,
        });
        if (!res.ok) {
          setSaveError(res.message || 'Failed to save. Please try again.');
          setSaving(false);
          return;
        }
      } else {
        // Returned + Available stay simple status patches — no financial
        // change, no sales row. platformListed flips so listings UI updates.
        const updates: Record<string, any> = {
          status: action,
          platformListed: action === 'available',
          updatedAt: new Date().toISOString(),
        };
        if (notes) updates.notes = notes;
        await dbService.update('inventoryUnits', selectedUnit.id, updates);
      }

      setDone(true);
      setTimeout(onClose, 800);
    } catch (err: any) {
      const msg = err?.code === 'permission-denied'
        ? 'Permission denied — check Firestore rules for your named database.'
        : (err?.message || 'Failed to save. Check your connection.');
      setSaveError(msg);
      console.error('[QuickSaleModal] write failed:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm p-0 md:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-3xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="bg-gray-950 px-5 py-4 flex items-start justify-between">
          <div className="min-w-0">
            {selectedUnit ? (
              <>
                <p className="text-white font-bold text-sm truncate">{selectedUnit.model}</p>
                <p className="text-gray-400 text-[10px] font-mono mt-0.5">{selectedUnit.colour} · £{selectedUnit.buyPrice} BP · {selectedUnit.imei}</p>
              </>
            ) : (
              <>
                <p className="text-white font-bold text-sm uppercase tracking-widest">Select IMEI to Sell</p>
                <p className="text-gray-400 text-[10px] font-mono mt-0.5">{availableUnits.length} available units</p>
              </>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white ml-3 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {!selectedUnit ? (
            <div className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search IMEI or colour..."
                  autoFocus
                  value={imeiSearch}
                  onChange={e => setImeiSearch(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredUnits.length === 0 ? (
                  <p className="text-center py-8 text-gray-400 text-xs font-mono">No matching units found.</p>
                ) : filteredUnits.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setSelectedUnit(u);
                      setSku(u.sku || '');
                    }}
                    className="flex items-center justify-between p-3 border border-gray-100 rounded-xl hover:border-black hover:bg-gray-50 transition-all group"
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-bold font-mono group-hover:text-black transition-colors">{u.imei}</p>
                      <p className="text-[9px] text-gray-400 uppercase">{u.colour} · £{u.buyPrice}</p>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {availableUnits.length > 1 && !initialUnit && (
                <button
                  onClick={() => setSelectedUnit(null)}
                  className="text-[9px] font-bold text-blue-600 uppercase tracking-widest flex items-center gap-1 hover:underline mb-2"
                >
                  <RotateCcw size={10} /> Change Selected IMEI
                </button>
              )}

              {/* Action tabs */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: 'sold'      as const, icon: <ShoppingBag size={13} />, label: 'Sold',      bg: 'bg-black text-white' },
                  { v: 'returned'  as const, icon: <RotateCcw size={13} />,   label: 'Returned',  bg: 'bg-orange-500 text-white' },
                  { v: 'available' as const, icon: <PackagePlus size={13} />, label: 'In Stock',  bg: 'bg-emerald-600 text-white' },
                ]).map(({ v, icon, label, bg }) => (
                  <button key={v} onClick={() => setAction(v)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-[10px] font-bold uppercase tracking-wide transition-all ${
                      action === v ? `${bg} border-transparent` : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                    }`}>
                    {icon}{label}
                  </button>
                ))}
              </div>

              {/* Sold fields */}
              {action === 'sold' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Price (£)</label>
                    <input type="number" min="0.01" step="0.01" value={salePrice}
                      onChange={e => setSalePrice(e.target.value)} placeholder="0.00"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[9px] text-gray-400 font-mono uppercase">Platform</label>
                    <select value={platform} onChange={e => setPlatform(e.target.value as Marketplace)}
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black">
                      {ACTIVE_PLATFORMS.map(p => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[9px] text-gray-400 font-mono uppercase flex items-center gap-1">
                      <Tag size={9} /> SKU
                    </label>
                    <input type="text" value={sku}
                      onChange={e => setSku(e.target.value)} placeholder={selectedUnit.sku || 'e.g. ASI-IP-13-128-BK'}
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Order ID</label>
                    <input type="text" value={saleOrderId}
                      onChange={e => setSaleOrderId(e.target.value)} placeholder="e.g. 12-09873-12345"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>

                  {/* Inline GP preview — master-aligned via calcSaleFinancials.
                      Uses the platform's default postage; SellOrderModal owns
                      the full P&L surface for overrides + tiers. */}
                  {gpPreview && (
                    <div className={`col-span-2 rounded-lg px-3 py-2 text-[10px] font-mono flex items-center justify-between border ${
                      gpPreview.grossProfit >= 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-700'
                    }`}>
                      <span className="uppercase tracking-widest opacity-70">GP preview</span>
                      <span className="font-bold">
                        {gpPreview.grossProfit >= 0 ? '+' : ''}£{gpPreview.grossProfit.toFixed(2)} · {gpPreview.gpPercent.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase">Notes (optional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Additional details…"
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>

              <button onClick={save}
                disabled={saving || done || (action === 'sold' && (spNum <= 0 || !saleOrderId.trim()))}
                className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {done ? <><CheckCircle2 size={16} /> Updated!</> :
                 saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                 'Confirm Update'}
              </button>
              {saveError && (
                <p className="text-[10px] text-red-500 font-mono text-center mt-2 leading-snug">{saveError}</p>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
