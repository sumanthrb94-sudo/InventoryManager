import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShoppingBag, RotateCcw, PackagePlus, CheckCircle2 } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { calculateUnitNetProfit } from '../lib/profit';
import { logInventoryEvent } from '../lib/inventoryEvents';

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'] as const;

interface Props { unit: InventoryUnit; onClose: () => void; }

export default function QuickSaleModal({ unit, onClose }: Props) {
  const [action,    setAction]    = useState<'sold' | 'returned' | 'available'>('sold');
  const [platform,  setPlatform]  = useState(unit.salePlatform || 'eBay');
  const [salePrice, setSalePrice] = useState(unit.salePrice?.toString() || '');
  const [saleFees, setSaleFees] = useState(unit.saleFees?.toString() || '');
  const [shippingCost, setShippingCost] = useState(unit.shippingCost?.toString() || '');
  const [notes,     setNotes]     = useState(unit.notes || '');
  const [saving,    setSaving]    = useState(false);
  const [done,      setDone]      = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const save = async () => {
    setSaving(true);
    const updates: any = { status: action, updatedAt: new Date().toISOString() };
    if (action === 'sold') {
      updates.saleDate      = today;
      updates.salePlatform  = platform;
      updates.salePrice     = parseFloat(salePrice) || 0;
      updates.saleFees      = parseFloat(saleFees) || 0;
      updates.shippingCost  = parseFloat(shippingCost) || 0;
      updates.netProfit     = (parseFloat(salePrice) || 0) - unit.buyPrice - (parseFloat(saleFees) || 0) - (parseFloat(shippingCost) || 0);
      updates.platformListed = false;
    } else if (action === 'returned') {
      updates.platformListed = false;
      updates.saleDate      = undefined;
      updates.salePrice     = undefined;
      updates.salePlatform  = undefined;
      updates.saleFees      = undefined;
      updates.shippingCost  = undefined;
      updates.netProfit     = undefined;
    } else {
      updates.platformListed = true;
    }
    if (notes) updates.notes = notes;
    await dbService.update('inventoryUnits', unit.id, updates);
    if (action !== 'available') {
      try {
        await logInventoryEvent({
          type: action,
          message: action === 'sold' ? `Sold via ${platform}` : 'Marked returned',
          unitId: unit.id,
          platform,
          salePrice: updates.salePrice,
          saleFees: updates.saleFees,
          shippingCost: updates.shippingCost,
          profit: calculateUnitNetProfit({ ...unit, ...updates }),
        });
      } catch (eventError) {
        console.warn('Inventory event logging failed for quick sale.', eventError);
      }
    }
    setSaving(false);
    setDone(true);
    setTimeout(onClose, 800);
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
        className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="bg-gray-950 px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-white font-bold text-sm truncate">{unit.model}</p>
            <p className="text-gray-400 text-[10px] font-mono mt-0.5">{unit.colour} · £{unit.buyPrice} BP · {unit.imei?.slice(0,10)}…</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white ml-3 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
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
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Price (£)</label>
                <input type="number" inputMode="decimal" value={salePrice}
                  onChange={e => setSalePrice(e.target.value)} placeholder="0.00"
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase">Platform</label>
                <select value={platform} onChange={e => setPlatform(e.target.value)}
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black">
                  {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Fees (£)</label>
                <input type="number" inputMode="decimal" value={saleFees}
                  onChange={e => setSaleFees(e.target.value)} placeholder="0.00"
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase">Shipping (£)</label>
                <input type="number" inputMode="decimal" value={shippingCost}
                  onChange={e => setShippingCost(e.target.value)} placeholder="0.00"
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>
              {salePrice && (
                <div className="col-span-2 bg-gray-50 rounded-xl p-3">
                  <p className="text-[9px] text-gray-400 font-mono uppercase">Estimated Net Profit</p>
                  <p className="text-sm font-bold mt-0.5">
                    £{calculateUnitNetProfit({
                      ...unit,
                      salePrice: parseFloat(salePrice) || 0,
                      saleFees: parseFloat(saleFees) || 0,
                      shippingCost: parseFloat(shippingCost) || 0,
                      status: 'sold',
                    }).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[9px] text-gray-400 font-mono uppercase">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Order ID, condition…"
              className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
            />
          </div>

          <button onClick={save}
            disabled={saving || done || (action === 'sold' && !salePrice)}
            className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {done ? <><CheckCircle2 size={16} /> Updated!</> :
             saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
             'Confirm Update'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
