import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShoppingBag, RotateCcw, PackagePlus, CheckCircle2, ChevronRight, Smartphone } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'] as const;

interface Props { 
  unit?: InventoryUnit; 
  availableUnits?: InventoryUnit[];
  onClose: () => void; 
}

export default function QuickSaleModal({ unit: initialUnit, availableUnits = [], onClose }: Props) {
  const [selectedUnit, setSelectedUnit] = useState<InventoryUnit | null>(initialUnit || null);
  const [imeiSearch, setImeiSearch] = useState('');
  const [action,    setAction]    = useState<'sold' | 'returned' | 'available'>('sold');
  const [platform,  setPlatform]  = useState(initialUnit?.salePlatform || 'eBay');
  const [salePrice, setSalePrice] = useState(initialUnit?.salePrice?.toString() || '');
  const [saleOrderId, setSaleOrderId] = useState(initialUnit?.saleOrderId || '');
  const [customerName, setCustomerName] = useState(initialUnit?.customerName || '');
  const [notes,     setNotes]     = useState(initialUnit?.notes || '');
  const [saving,    setSaving]    = useState(false);
  const [done,      setDone]      = useState(false);

  const today = new Date().toISOString().split('T')[0];

  const filteredUnits = useMemo(() => {
    if (!imeiSearch) return availableUnits;
    const s = imeiSearch.toLowerCase();
    return availableUnits.filter(u => 
      u.imei.toLowerCase().includes(s) ||
      u.colour.toLowerCase().includes(s)
    );
  }, [availableUnits, imeiSearch]);

  const save = async () => {
    if (!selectedUnit) return;
    setSaving(true);
    const updates: any = { status: action, updatedAt: new Date().toISOString() };
    if (action === 'sold') {
      updates.saleDate      = today;
      updates.salePlatform  = platform;
      updates.salePrice     = parseFloat(salePrice) || 0;
      updates.saleOrderId   = saleOrderId || undefined;
      updates.customerName  = customerName || undefined;
    } else if (action === 'returned') {
      updates.platformListed = false;
    } else {
      updates.platformListed = true;
    }
    if (notes) updates.notes = notes;
    
    await dbService.update('inventoryUnits', selectedUnit.id, updates);
    
    if (action === 'sold') {
      try {
        const updateId = `du_${Date.now()}`;
        await dbService.create('dailyUpdates', updateId, {
          date: today,
          message: `${selectedUnit.model} (${selectedUnit.colour}) sold via ${platform} for £${updates.salePrice}${saleOrderId ? ' · Order: ' + saleOrderId : ''}`,
          affectedUnitIds: [selectedUnit.id],
          affectedModels: [selectedUnit.model],
          type: 'stock_sold',
          ownerId: 'local',
          createdAt: new Date().toISOString()
        });
      } catch (duError) {
        console.warn('Daily update creation failed.', duError);
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
                    onClick={() => setSelectedUnit(u)}
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
                    <input type="number" value={salePrice}
                      onChange={e => setSalePrice(e.target.value)} placeholder="0.00"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label className="text-[9px] text-gray-400 font-mono uppercase">Platform</label>
                    <select value={platform} onChange={e => setPlatform(e.target.value)}
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black">
                      {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[9px] text-gray-400 font-mono uppercase">Sale Order ID</label>
                    <input type="text" value={saleOrderId}
                      onChange={e => setSaleOrderId(e.target.value)} placeholder="e.g. 12-09873-12345"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
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
                disabled={saving || done || (action === 'sold' && !salePrice)}
                className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {done ? <><CheckCircle2 size={16} /> Updated!</> :
                 saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> :
                 'Confirm Update'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
