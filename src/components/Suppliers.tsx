import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Package, TrendingUp, RotateCcw, ChevronDown, ChevronRight, X, ShoppingBag, Cpu, ArrowUpRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { Supplier, InventoryUnit } from '../types';
import { formatIMEI } from '../lib/imeiUtils';

const PLATFORM_COLORS: Record<string, string> = {
  eBay: 'bg-yellow-100 text-yellow-800',
  Amazon: 'bg-orange-100 text-orange-800',
  OnBuy: 'bg-blue-100 text-blue-800',
  Backmarket: 'bg-green-100 text-green-800',
  Other: 'bg-gray-100 text-gray-700',
};

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [selected, setSelected]   = useState<string | null>(null);
  const [isAdding, setIsAdding]   = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    name: '',
    portal: 'Direct',
    contactName: '',
    contactEmail: '',
    phone: '',
    address: '',
    paymentTerms: '',
    returnTerms: '',
    notes: '',
  });
  const [historyPage, setHistoryPage] = useState(1);
  const HIST_PAGE_SIZE = 20;

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = `sup_${Date.now()}`;
    await dbService.create('suppliers', id, { ...newSupplier, ownerId: 'local' });
    setIsAdding(false);
    setNewSupplier({
      name: '',
      portal: 'Direct',
      contactName: '',
      contactEmail: '',
      phone: '',
      address: '',
      paymentTerms: '',
      returnTerms: '',
      notes: '',
    });
  };

  // Per-supplier stats
  const supplierStats = useMemo(() => {
    const map: Record<string, {
      total: number; available: number; sold: number;
      totalCost: number; revenue: number;
      netProfit: number;
      byDate: Record<string, InventoryUnit[]>;
      platforms: Record<string, number>;
    }> = {};

    for (const u of units) {
      if (!map[u.supplierId]) {
        map[u.supplierId] = { total: 0, available: 0, sold: 0, totalCost: 0, revenue: 0, netProfit: 0, byDate: {}, platforms: {} };
      }
      const s = map[u.supplierId];
      s.total++;
      s.totalCost += u.buyPrice;
      if (u.status === 'available') s.available++;
      if (u.status === 'sold') {
        s.sold++;
        s.revenue += u.salePrice ?? 0;
        s.netProfit += u.netProfit ?? ((u.salePrice ?? 0) - u.buyPrice - (u.saleFees || 0) - (u.shippingCost || 0));
        if (u.salePlatform) s.platforms[u.salePlatform] = (s.platforms[u.salePlatform] || 0) + 1;
      }
      const d = u.dateIn;
      if (!s.byDate[d]) s.byDate[d] = [] as InventoryUnit[];
      (s.byDate[d] as InventoryUnit[]).push(u);
    }
    return map;
  }, [units]);

  const selectedSupplier = suppliers.find(s => s.id === selected);
  const selectedStats    = selected ? supplierStats[selected] : null;

  // History: flat list sorted by date desc
  const historyItems = useMemo(() => {
    if (!selectedStats) return [] as { date: string; unit: InventoryUnit }[];
    return Object.entries(selectedStats.byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .flatMap(([date, us]) => (us as InventoryUnit[]).map(u => ({ date, unit: u })));
  }, [selectedStats]);

  const histPages = Math.max(1, Math.ceil(historyItems.length / HIST_PAGE_SIZE));
  const histSlice = historyItems.slice((historyPage - 1) * HIST_PAGE_SIZE, historyPage * HIST_PAGE_SIZE);

  return (
    <div className="space-y-4 pb-24 md:pb-8 max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Suppliers</h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-0.5">{suppliers.length} partners</p>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-800 transition-all"
        >
          <Plus size={14} strokeWidth={3} />Add
        </button>
      </div>

      {/* Add supplier form */}
      <AnimatePresence>
        {isAdding && (
          <motion.form
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            onSubmit={handleAdd}
            className="overflow-hidden bg-white border border-gray-200 rounded-2xl p-4 space-y-3"
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">New Supplier</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                required value={newSupplier.name}
                onChange={e => setNewSupplier(p => ({ ...p, name: e.target.value }))}
                placeholder="Supplier name"
                className="col-span-2 w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.contactName}
                onChange={e => setNewSupplier(p => ({ ...p, contactName: e.target.value }))}
                placeholder="Contact name"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.contactEmail}
                onChange={e => setNewSupplier(p => ({ ...p, contactEmail: e.target.value }))}
                placeholder="Contact email"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.phone}
                onChange={e => setNewSupplier(p => ({ ...p, phone: e.target.value }))}
                placeholder="Phone"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.address}
                onChange={e => setNewSupplier(p => ({ ...p, address: e.target.value }))}
                placeholder="Address"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.paymentTerms}
                onChange={e => setNewSupplier(p => ({ ...p, paymentTerms: e.target.value }))}
                placeholder="Payment terms"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.returnTerms}
                onChange={e => setNewSupplier(p => ({ ...p, returnTerms: e.target.value }))}
                placeholder="Return terms"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
              <input
                value={newSupplier.notes}
                onChange={e => setNewSupplier(p => ({ ...p, notes: e.target.value }))}
                placeholder="Notes"
                className="col-span-2 w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={newSupplier.portal}
                onChange={e => setNewSupplier(p => ({ ...p, portal: e.target.value }))}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-black"
              >
                {['Direct','Wholesale','Auction','Online'].map(p => <option key={p}>{p}</option>)}
              </select>
              <button type="submit" className="px-5 py-2.5 bg-black text-white rounded-xl text-[11px] font-bold uppercase tracking-widest">Save</button>
              <button type="button" onClick={() => setIsAdding(false)} className="px-4 py-2.5 border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50">
                <X size={14} />
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Supplier cards */}
      <div className="space-y-2">
        {suppliers.map(sup => {
          const stats = supplierStats[sup.id];
          const isOpen = selected === sup.id;
          return (
            <div key={sup.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              {/* Card header */}
              <button
                onClick={() => { setSelected(isOpen ? null : sup.id); setHistoryPage(1); }}
                className="w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 transition-all"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-gray-950 flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm font-display">{sup.name.charAt(0).toUpperCase()}</span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{sup.name}</p>
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">{sup.portal}</p>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 flex-shrink-0 text-right">
                  {stats && (
                    <>
                      <div className="hidden sm:block">
                        <p className="text-[8px] text-gray-400 font-mono uppercase">Units</p>
                        <p className="text-lg font-bold font-display leading-tight">{stats.total}</p>
                      </div>
                      <div>
                        <p className="text-[8px] text-gray-400 font-mono uppercase">Avail</p>
                        <p className="text-lg font-bold font-display leading-tight text-emerald-600">{stats.available}</p>
                      </div>
                      <div className="hidden sm:block">
                        <p className="text-[8px] text-gray-400 font-mono uppercase">Sold</p>
                        <p className="text-sm font-bold text-gray-500">{stats.sold}</p>
                      </div>
                    </>
                  )}
                  <div className="text-gray-300">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</div>
                </div>
              </button>

              {/* Expanded detail */}
              <AnimatePresence>
                {isOpen && selectedStats && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
                    className="overflow-hidden border-t border-gray-100"
                  >
                    {/* Stats row */}
                    <div className="grid grid-cols-2 gap-2 p-4">
                      {[
                        { label: 'Total Units',  value: selectedStats.total,                             icon: <Package size={13} />,    color: 'text-black' },
                        { label: 'Stock Cost',   value: `£${selectedStats.totalCost.toLocaleString()}`, icon: <TrendingUp size={13} />,  color: 'text-black' },
                        { label: 'Sold',         value: selectedStats.sold,                             icon: <ShoppingBag size={13} />, color: 'text-emerald-600' },
                        { label: 'Revenue',      value: `£${selectedStats.revenue.toLocaleString()}`,   icon: <TrendingUp size={13} />,  color: 'text-emerald-600' },
                        { label: 'Net Profit',   value: `£${selectedStats.netProfit.toLocaleString()}`, icon: <ArrowUpRight size={13} />, color: 'text-black' },
                      ].map(k => (
                        <div key={k.label} className="bg-gray-50 rounded-xl p-3 flex items-center gap-2">
                          <span className={k.color}>{k.icon}</span>
                          <div>
                            <p className="text-base font-bold font-display">{k.value}</p>
                            <p className="text-[9px] text-gray-400 font-mono uppercase tracking-wider">{k.label}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Platform breakdown */}
                    {Object.keys(selectedStats.platforms).length > 0 && (
                      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                        {Object.entries(selectedStats.platforms)
                          .sort((a, b) => (b[1] as number) - (a[1] as number))
                          .map(([p, c]) => (
                            <span key={p} className={`text-[9px] font-bold px-2.5 py-1 rounded-full font-mono ${PLATFORM_COLORS[p] || PLATFORM_COLORS.Other}`}>
                              {p} · {c}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* Order history */}
                    <div className="border-t border-gray-100">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Order History</p>
                        <p className="text-[9px] text-gray-400 font-mono">{historyItems.length} units · {histPages} pages</p>
                      </div>

                      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto custom-scrollbar">
                        {histSlice.map(({ date, unit }, idx) => (
                          <div key={idx} className="px-4 py-3 flex items-center gap-3">
                            {/* Date badge */}
                            <div className="w-16 flex-shrink-0 text-center">
                              <p className="text-[9px] font-bold font-mono bg-gray-100 px-2 py-1 rounded-lg text-gray-600">
                                {new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                              </p>
                            </div>

                            <Cpu size={10} className="text-gray-300 flex-shrink-0" />

                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate">{unit.model}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-[9px] text-gray-400 font-mono">{unit.colour}</span>
                                <span className="text-[9px] text-gray-400 font-mono">
                                  {unit.imei ? unit.imei.slice(0,8) + '…' : '—'}
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <span className="text-xs font-bold font-mono">£{unit.buyPrice}</span>
                              <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full font-mono ${
                                unit.status === 'sold'      ? 'bg-gray-200 text-gray-600' :
                                unit.status === 'available' ? 'bg-emerald-100 text-emerald-700' :
                                'bg-orange-100 text-orange-700'
                              }`}>
                                {unit.status}
                              </span>
                              {unit.salePlatform && (
                                <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full font-mono ${PLATFORM_COLORS[unit.salePlatform] || PLATFORM_COLORS.Other}`}>
                                  {unit.salePlatform}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* History pagination */}
                      {histPages > 1 && (
                        <div className="flex items-center justify-center gap-2 p-3 border-t border-gray-100">
                          <button onClick={() => setHistoryPage(p => Math.max(1, p-1))} disabled={historyPage===1}
                            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30">
                            <ChevronRight size={14} className="rotate-180" />
                          </button>
                          <span className="text-[10px] font-mono text-gray-500">
                            Page {historyPage} / {histPages}
                          </span>
                          <button onClick={() => setHistoryPage(p => Math.min(histPages, p+1))} disabled={historyPage===histPages}
                            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 disabled:opacity-30">
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {suppliers.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl">
          <Package size={40} className="text-gray-300" />
          <p className="text-gray-400 font-mono text-sm">No suppliers yet. Import your Excel data first.</p>
        </div>
      )}
    </div>
  );
}
