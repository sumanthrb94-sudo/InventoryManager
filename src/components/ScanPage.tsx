import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera, Search, CheckCircle2, XCircle, ShoppingBag,
  RotateCcw, PackagePlus, Cpu, AlertCircle, X,
  ChevronRight, Zap, TrendingUp
} from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import { formatIMEI, validateIMEI } from '../lib/imeiUtils';
import { calculateUnitNetProfit } from '../lib/profit';
import { logInventoryEvent } from '../lib/inventoryEvents';

const PLATFORMS = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Other'] as const;
type Platform = typeof PLATFORMS[number];

type ActionType = 'sold' | 'returned' | 'available';

interface QuickAction {
  unit: InventoryUnit;
  action: ActionType;
  platform?: Platform;
  salePrice?: number;
  saleFees?: number;
  shippingCost?: number;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ScanPage() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [scanMode, setScanMode]   = useState(false);
  const [manualImei, setManualImei] = useState('');
  const [foundUnit, setFoundUnit] = useState<InventoryUnit | null>(null);
  const [notFound, setNotFound]   = useState(false);
  const [pendingAction, setPendingAction] = useState<QuickAction | null>(null);
  const [saving, setSaving]       = useState(false);
  const [history, setHistory]     = useState<{ imei: string; action: string; ts: string }[]>([]);

  // Lazy-load scanner
  const [ScannerComponent, setScannerComponent] = useState<any>(null);
  const manualRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsub = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return unsub;
  }, []);

  // Today's stats
  const today = new Date().toISOString().split('T')[0];
  const todaySold      = useMemo(() => units.filter(u => (u.saleDate || u.dateIn) === today), [units, today]);
  const todayReturned  = useMemo(() => units.filter(u => u.status === 'returned' && u.updatedAt?.startsWith?.(today)), [units, today]);
  const totalAvailable = useMemo(() => units.filter(u => u.status === 'available').length, [units]);

  const lookupIMEI = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    const match  = units.find(u => u.imei.replace(/\D/g,'') === digits);
    if (match) {
      setFoundUnit(match);
      setNotFound(false);
      setPendingAction({ unit: match, action: 'sold', platform: 'eBay' });
    } else {
      setFoundUnit(null);
      setNotFound(true);
    }
  };

  const handleScan = (value: string) => {
    setScanMode(false);
    setManualImei(value.replace(/\D/g,''));
    lookupIMEI(value);
  };

  const handleManualSearch = () => {
    if (manualImei.length >= 6) lookupIMEI(manualImei);
  };

  const openScanner = async () => {
    if (!ScannerComponent) {
      const mod = await import('./IMEIScanner');
      setScannerComponent(() => mod.default);
    }
    setScanMode(true);
  };

  const commitAction = async () => {
    if (!pendingAction) return;
    setSaving(true);
    const { unit, action, platform, salePrice, saleFees, shippingCost, notes } = pendingAction;

    const updates: any = { status: action, updatedAt: new Date().toISOString() };
    if (action === 'sold') {
      updates.saleDate     = today;
      updates.salePlatform = platform;
      updates.salePrice    = salePrice ?? 0;
      updates.saleFees     = saleFees ?? 0;
      updates.shippingCost = shippingCost ?? 0;
      updates.netProfit    = (salePrice ?? 0) - unit.buyPrice - (saleFees ?? 0) - (shippingCost ?? 0);
      updates.platformListed = false;
    }
    if (action === 'returned') {
      updates.platformListed = false;
      updates.saleDate       = undefined;
      updates.salePrice      = undefined;
      updates.saleFees       = undefined;
      updates.shippingCost   = undefined;
      updates.netProfit      = undefined;
    }
    if (action === 'available') {
      updates.platformListed = true;
    }
    if (notes) updates.notes = notes;

    await dbService.update('inventoryUnits', unit.id, updates);
    try {
      await logInventoryEvent({
        type: action,
        message: action === 'sold' ? `Sold on ${platform}` : action === 'returned' ? 'Returned' : 'Back in stock',
        unitId: unit.id,
        platform,
        salePrice: updates.salePrice,
        saleFees: updates.saleFees,
        shippingCost: updates.shippingCost,
        profit: action === 'sold' ? calculateUnitNetProfit({ ...unit, ...updates, status: 'sold' }) : undefined,
      });
    } catch (eventError) {
      console.warn('Inventory event logging failed for scan action.', eventError);
    }

    setHistory(h => [{
      imei: unit.imei,
      action: action === 'sold' ? `Sold on ${platform}` : action === 'returned' ? 'Returned' : 'Back in stock',
      ts: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }, ...h].slice(0, 20));

    setSaving(false);
    setFoundUnit(null);
    setPendingAction(null);
    setManualImei('');
    setNotFound(false);
    setTimeout(() => manualRef.current?.focus(), 100);
  };

  const STATUS_BADGE: Record<string, string> = {
    available: 'bg-emerald-100 text-emerald-800',
    sold:      'bg-gray-200 text-gray-600',
    returned:  'bg-orange-100 text-orange-800',
    reserved:  'bg-amber-100 text-amber-800',
    lost:      'bg-red-100 text-red-800',
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">

      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Scan & Update</h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Scan IMEI · Log sales · Track returns · Update stock
        </p>
      </div>

      {/* Today's KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Sold Today',  value: todaySold.length,      icon: <ShoppingBag size={14} />, color: 'text-emerald-600' },
          { label: 'In Stock',    value: totalAvailable,         icon: <PackagePlus size={14} />,  color: 'text-black' },
          { label: 'Returned',    value: todayReturned.length,   icon: <RotateCcw size={14} />,    color: 'text-orange-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm text-center">
            <div className={`flex justify-center mb-1 ${k.color}`}>{k.icon}</div>
            <p className="text-2xl font-bold font-display tracking-tighter">{k.value}</p>
            <p className="text-[9px] text-gray-400 font-mono uppercase tracking-wider mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Scanner / manual search */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-gray-400" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600">IMEI Lookup</p>
          </div>
          <button
            onClick={openScanner}
            className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all"
          >
            <Camera size={13} />
            Scan Camera
          </button>
        </div>

        {/* Camera scanner */}
        <AnimatePresence>
          {scanMode && ScannerComponent && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              className="overflow-hidden"
            >
              <div className="relative p-3">
                <ScannerComponent onScan={handleScan} />
                <button
                  onClick={() => setScanMode(false)}
                  className="absolute top-5 right-5 bg-black/70 text-white p-1.5 rounded-full"
                >
                  <X size={14} />
                </button>
                <p className="text-center text-[10px] text-gray-400 font-mono mt-2 uppercase tracking-widest">
                  Point camera at IMEI barcode or QR code
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Manual entry */}
        <div className="p-5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              <input
                ref={manualRef}
                type="text"
                inputMode="numeric"
                value={manualImei}
                onChange={e => setManualImei(e.target.value.replace(/\D/g,''))}
                onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                placeholder="Type IMEI number…"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-9 pr-4 text-sm font-mono focus:outline-none focus:border-black transition-all"
              />
            </div>
            <button
              onClick={handleManualSearch}
              disabled={manualImei.length < 6}
              className="bg-black text-white px-5 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest disabled:opacity-40 hover:bg-gray-800 transition-all flex items-center gap-2"
            >
              <Zap size={13} /> Find
            </button>
          </div>

          {/* Not found */}
          <AnimatePresence>
            {notFound && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3 flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3"
              >
                <AlertCircle size={14} className="text-red-500" />
                <div>
                  <p className="text-xs font-bold text-red-800">IMEI not found in inventory</p>
                  <p className="text-[10px] text-red-600 font-mono">{manualImei} — check spelling or import from Excel</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Found unit + quick action form */}
      <AnimatePresence>
        {foundUnit && pendingAction && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
          >
            {/* Unit summary */}
            <div className="px-5 py-4 bg-gray-950 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full font-mono uppercase ${STATUS_BADGE[foundUnit.status]}`}>
                    {foundUnit.status}
                  </span>
                  {foundUnit.imei ? (
                    (() => {
                      const digits = foundUnit.imei.replace(/\D/g, '');
                      if (digits.length !== 15) {
                        return (
                          <span className="text-[9px] px-2 py-0.5 rounded-full font-mono bg-gray-800 text-gray-300">
                            Serial
                          </span>
                        );
                      }
                      const valid = validateIMEI(foundUnit.imei);
                      return (
                        <span className={`text-[9px] px-2 py-0.5 rounded-full font-mono ${valid ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'}`}>
                          {valid ? '✓ Valid IMEI' : '! Invalid IMEI'}
                        </span>
                      );
                    })()
                  ) : null}
                </div>
                <p className="text-white font-bold text-sm">{foundUnit.model}</p>
                <p className="text-gray-400 text-xs font-mono mt-0.5">{foundUnit.colour} · BP: £{foundUnit.buyPrice}</p>
                <p className="text-gray-500 text-[10px] font-mono mt-1">{formatIMEI(foundUnit.imei)}</p>
              </div>
              <button onClick={() => { setFoundUnit(null); setPendingAction(null); }} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* Action form */}
            <div className="p-5 space-y-4">
              {/* Action type */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Action</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { a: 'sold' as ActionType,      icon: <ShoppingBag size={13} />, label: 'Mark Sold',    color: 'bg-black text-white' },
                    { a: 'returned' as ActionType,  icon: <RotateCcw size={13} />,  label: 'Returned',     color: 'bg-orange-500 text-white' },
                    { a: 'available' as ActionType, icon: <PackagePlus size={13} />, label: 'Back in Stock', color: 'bg-emerald-600 text-white' },
                  ]).map(({ a, icon, label, color }) => (
                    <button
                      key={a}
                      onClick={() => setPendingAction(p => p ? { ...p, action: a } : p)}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-[10px] font-bold uppercase tracking-widest transition-all ${
                        pendingAction.action === a
                          ? `${color} border-transparent`
                          : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sale-specific fields */}
              {pendingAction.action === 'sold' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Sale Price (£)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={pendingAction.salePrice ?? ''}
                      onChange={e => setPendingAction(p => p ? { ...p, salePrice: parseFloat(e.target.value) } : p)}
                      placeholder="0.00"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Platform</label>
                    <select
                      value={pendingAction.platform}
                      onChange={e => setPendingAction(p => p ? { ...p, platform: e.target.value as Platform } : p)}
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    >
                      {PLATFORMS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Sale Fees (£)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={pendingAction.saleFees ?? ''}
                      onChange={e => setPendingAction(p => p ? { ...p, saleFees: parseFloat(e.target.value) } : p)}
                      placeholder="0.00"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Shipping (£)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={pendingAction.shippingCost ?? ''}
                      onChange={e => setPendingAction(p => p ? { ...p, shippingCost: parseFloat(e.target.value) } : p)}
                      placeholder="0.00"
                      className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                    />
                  </div>
                  {pendingAction.salePrice !== undefined && !Number.isNaN(pendingAction.salePrice) && (
                    <div className="col-span-2 bg-gray-50 rounded-xl p-3">
                      <p className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Estimated Net Profit</p>
                      <p className="text-sm font-bold mt-0.5">
                        £{calculateUnitNetProfit({
                          ...unit,
                          salePrice: pendingAction.salePrice || 0,
                          saleFees: pendingAction.saleFees || 0,
                          shippingCost: pendingAction.shippingCost || 0,
                          status: 'sold',
                        }).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[9px] text-gray-400 font-mono uppercase tracking-widest">Notes (optional)</label>
                <input
                  type="text"
                  value={pendingAction.notes ?? ''}
                  onChange={e => setPendingAction(p => p ? { ...p, notes: e.target.value } : p)}
                  placeholder="Order ID, issue, condition…"
                  className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
                />
              </div>

              {/* Confirm */}
              <button
                onClick={commitAction}
                disabled={saving || (pendingAction.action === 'sold' && !pendingAction.salePrice)}
                className="w-full py-3.5 bg-black text-white rounded-xl text-sm font-bold uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <><CheckCircle2 size={16} /> Confirm & Save</>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Today's activity log */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp size={13} className="text-gray-400" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Session Log</p>
          </div>
          <div className="divide-y divide-gray-50">
            {history.map((h, i) => (
              <div key={i} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold font-mono">{h.imei.slice(0,8)}•••••••</p>
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5">{h.action}</p>
                </div>
                <span className="text-[9px] text-gray-400 font-mono">{h.ts}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
