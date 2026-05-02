import React, { useState, useEffect, useMemo } from 'react';
import {
  Bell, CheckCircle2, Star, Truck,
  ChevronDown, Clock, Search, ShoppingBag, Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, OperationalFlag, ActiveListing } from '../types';
import { notificationService, Notification } from '../lib/notificationService';

const FLAG_CONFIG: Record<OperationalFlag, { label: string; icon: any; style: string; action: string }> = {
  top10: {
    label: 'Top 10 Focus',
    icon: Star,
    style: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    action: 'Prioritise on eBay, Amazon, OnBuy, Backmarket — keep qty at 1',
  },
  supplierHasStock: {
    label: 'Supplier Has Stock',
    icon: Truck,
    style: 'bg-green-50 text-green-800 border-green-200',
    action: 'Supplier holding — list as 1 once confirmed in-hand',
  },
  stockSold: {
    label: 'Stock Sold',
    icon: CheckCircle2,
    style: 'bg-gray-50 text-gray-500 border-gray-200',
    action: 'Set qty to 0 on eBay, Amazon, OnBuy, Backmarket immediately',
  },
};

export default function Sales() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [activeListings, setActiveListings] = useState<ActiveListing[]>([]);
  const [recentNotifications, setRecentNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    const unsub1 = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const unsub2 = dbService.subscribeToCollection('suppliers', setSuppliers);
    const unsub3 = dbService.subscribeToCollection('activeListings', setActiveListings);
    const unsub4 = notificationService.subscribe(setRecentNotifications);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const [isTodayStockOpen, setIsTodayStockOpen] = useState(true);
  const [isPlatformListOpen, setIsPlatformListOpen] = useState(true);
  const [isSoldTodayOpen, setIsSoldTodayOpen] = useState(true);
  const [soldSearch, setSoldSearch] = useState('');
  
  const today = new Date().toISOString().split('T')[0];

  // Units updated today (dateIn = today)
  const todayUnits = useMemo(() =>
    units.filter(u => u.dateIn === today),
    [units, today]
  );

  // Sold today
  const soldToday = useMemo(() => 
    units.filter(u => u.status === 'sold' && (u.saleDate === today || (!u.saleDate && u.updatedAt?.split('T')[0] === today))), 
    [units, today]
  );

  const filteredSold = useMemo(() => {
    if (!soldSearch) return soldToday;
    const s = soldSearch.toLowerCase();
    return soldToday.filter(u => 
      u.imei.toLowerCase().includes(s) || 
      u.model.toLowerCase().includes(s) || 
      u.saleOrderId?.toLowerCase().includes(s)
    );
  }, [soldToday, soldSearch]);

  // Platform update list — available units grouped by model for qty decisions
  const platformList = useMemo(() => {
    const map = new Map<string, { model: string; brand: string; category: string; count: number; flags: OperationalFlag[]; units: InventoryUnit[]; listingSites: string[] }>();
    for (const u of units.filter(u => u.status === 'available')) {
      if (!map.has(u.model)) {
        map.set(u.model, { model: u.model, brand: u.brand, category: u.category, count: 0, flags: [], units: [], listingSites: [] });
      }
      const entry = map.get(u.model)!;
      entry.count++;
      entry.units.push(u);
      
      // Aggregated listing sites
      if (u.listingSites) {
        for (const site of u.listingSites) {
          if (!entry.listingSites.includes(site)) entry.listingSites.push(site);
        }
      }

      for (const f of u.flags) {
        if (!entry.flags.includes(f)) entry.flags.push(f);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTop = a.flags.includes('top10') ? 1 : 0;
      const bTop = b.flags.includes('top10') ? 1 : 0;
      return bTop - aTop || b.count - a.count;
    });
  }, [units]);

  // RECONCILIATION LOGIC: Physical vs Platform
  const reconciliation = useMemo(() => {
    // 1. Group physical available stock by model
    const physicalStock = new Map<string, number>();
    for (const u of units.filter(u => u.status === 'available')) {
      physicalStock.set(u.model, (physicalStock.get(u.model) || 0) + 1);
    }

    // 2. Group active listings by model
    const listedStock = new Map<string, { total: number; platforms: string[] }>();
    for (const l of activeListings) {
      const entry = listedStock.get(l.model) || { total: 0, platforms: [] };
      entry.total += l.quantity;
      entry.platforms.push(l.platform);
      listedStock.set(l.model, entry);
    }

    const results: {
      model: string;
      physical: number;
      listed: number;
      platforms: string[];
      status: 'ok' | 'under' | 'over' | 'none';
      message: string;
    }[] = [];

    // All models that either have stock or have a listing
    const allModels = new Set([...physicalStock.keys(), ...listedStock.keys()]);

    for (const model of allModels) {
      const physical = physicalStock.get(model) || 0;
      const listedObj = listedStock.get(model) || { total: 0, platforms: [] };
      const listed = listedObj.total;

      let status: 'ok' | 'under' | 'over' | 'none' = 'ok';
      let message = 'Listing synced';

      if (listed === 0 && physical > 0) {
        status = 'none';
        message = 'Not listed anywhere';
      } else if (listed < physical) {
        status = 'under';
        message = `${physical - listed} units waiting to be listed`;
      } else if (listed > physical) {
        status = 'over';
        message = 'OVERSELL RISK: Listing qty > Stock';
      }

      results.push({
        model,
        physical,
        listed,
        platforms: listedObj.platforms,
        status,
        message
      });
    }

    return results.sort((a, b) => {
      // Sort priority: Oversell > None > Under > OK
      const priority = { over: 0, none: 1, under: 2, ok: 3 };
      return priority[a.status] - priority[b.status] || b.physical - a.physical;
    });
  }, [units, activeListings]);

  const handleUpdateListing = async (model: string, platform: string, quantity: number) => {
    const listingId = `list_${model.replace(/\s+/g, '_').toLowerCase()}_${platform.toLowerCase()}`;
    if (quantity <= 0) {
      await dbService.delete('activeListings', listingId);
    } else {
      await dbService.create('activeListings', listingId, {
        model,
        platform,
        quantity,
        updatedAt: new Date().toISOString(),
        ownerId: 'anonymous'
      });
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tighter uppercase font-display">Daily Update</h2>
          <div className="h-px w-16 bg-black mt-2" />
          <p className="text-xs text-gray-400 font-mono mt-2 uppercase tracking-widest">
            Sales team daily stock briefing ·{' '}
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {todayUnits.length > 0 && (
            <span className="bg-black text-white text-[9px] font-bold font-mono px-3 py-1.5 uppercase tracking-widest flex items-center gap-2">
              <Bell size={10} />
              {todayUnits.length} new unit{todayUnits.length > 1 ? 's' : ''} in today
            </span>
          )}
        </div>
      </div>

      {/* Recent Activity Feed */}
      {recentNotifications.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Recent Activity Feed</h3>
            <button 
              onClick={() => notificationService.markAllAsRead()}
              className="text-[9px] font-bold text-gray-400 hover:text-black uppercase tracking-widest transition-colors"
            >
              Clear All
            </button>
          </div>
          <div className="divide-y divide-gray-50 max-h-[240px] overflow-y-auto custom-scrollbar">
            {recentNotifications.map(n => (
              <div key={n.id} className={`px-6 py-3 flex items-center gap-4 hover:bg-gray-50 transition-all ${!n.read ? 'bg-blue-50/30' : ''}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  n.type === 'sold' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {n.type === 'sold' ? <ShoppingBag size={14} /> : <CheckCircle2 size={14} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-black truncate">{n.model}</p>
                    <span className="text-[8px] font-mono text-gray-400 uppercase">
                      {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{n.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Listing Reconciliation — Critical Insights */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Inventory Reconciliation</h3>
            <p className="text-[8px] text-gray-400 font-mono uppercase mt-0.5">Physical Stock vs Online Listings</p>
          </div>
          <span className="text-[8px] bg-black text-white px-2 py-1 font-mono uppercase tracking-widest">Live Sync</span>
        </div>

        <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto custom-scrollbar">
          {reconciliation.filter(r => r.status !== 'ok').length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={24} />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">All listings are perfectly synced</p>
            </div>
          ) : (
            reconciliation.filter(r => r.status !== 'ok').map(item => (
              <div key={item.model} className={`px-6 py-4 flex items-center gap-6 group hover:bg-gray-50 transition-all ${
                item.status === 'over' ? 'bg-red-50/50' : item.status === 'none' ? 'bg-amber-50/30' : ''
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate">{item.model}</p>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase font-mono border ${
                      item.status === 'over' ? 'bg-red-100 text-red-700 border-red-200' :
                      item.status === 'none' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                      'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                      {item.message}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 font-mono mt-1">
                    Physical: <span className="text-black font-bold">{item.physical}</span> · 
                    Listed: <span className={item.listed > item.physical ? 'text-red-600 font-bold' : 'text-black font-bold'}>{item.listed}</span>
                  </p>
                </div>

                <div className="flex gap-1.5">
                  {['eBay', 'Amazon'].map(site => {
                    const isListedOnSite = item.platforms.includes(site);
                    return (
                      <button 
                        key={site}
                        onClick={() => handleUpdateListing(item.model, site, isListedOnSite ? 0 : 1)}
                        className={`text-[9px] font-bold px-3 py-1.5 rounded-lg transition-all uppercase tracking-wider ${
                          isListedOnSite 
                            ? 'bg-black text-white hover:bg-gray-800' 
                            : 'bg-white border border-gray-200 text-gray-400 hover:border-black hover:text-black'
                        }`}
                      >
                        {isListedOnSite ? `✓ ${site}` : `+ ${site}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick KPIs for sales team */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Available to Sell</p>
          <p className="text-4xl font-bold font-display tracking-tighter">{units.filter(u => u.status === 'available').length}</p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Top 10 Focus</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-black">
            {units.filter(u => u.status === 'available' && u.flags.includes('top10')).length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Sold Today</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-emerald-600">
            {soldToday.length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5 border-l-4 border-l-amber-400">
          <p className="text-[8px] font-bold text-amber-500 uppercase tracking-widest font-mono mb-2">Unlisted Models</p>
          <p className="text-4xl font-bold font-display tracking-tighter text-amber-600">
            {reconciliation.filter(r => r.status === 'none').length}
          </p>
        </div>
      </div>



      {/* Sold Today — Tracking by IMEI */}
      {soldToday.length > 0 && (
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 border-l-4 border-l-emerald-500 overflow-hidden">
          <button 
            onClick={() => setIsSoldTodayOpen(!isSoldTodayOpen)}
            className="w-full px-6 py-4 border-b border-gray-200 bg-emerald-50 flex items-center justify-between hover:bg-emerald-100 transition-all text-left"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-800 flex items-center gap-2">
              <ShoppingBag size={12} /> Devices Sold Today — Dispatch List
              <span className="ml-2 bg-emerald-600 text-white text-[8px] px-1.5 py-0.5 rounded-full">{soldToday.length}</span>
            </h3>
            <ChevronDown size={14} className={`text-emerald-400 transition-transform duration-200 ${isSoldTodayOpen ? 'rotate-180' : ''}`} />
          </button>
          
          <AnimatePresence initial={false}>
            {isSoldTodayOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                {/* IMEI Tracking Search */}
                <div className="px-6 py-3 bg-white border-b border-gray-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input 
                      type="text"
                      placeholder="Track via IMEI, Model or Order ID..."
                      value={soldSearch}
                      onChange={e => setSoldSearch(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-9 pr-4 text-xs font-mono focus:outline-none focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto custom-scrollbar">
                  {filteredSold.length === 0 ? (
                    <div className="px-6 py-12 text-center text-gray-400 font-mono text-[10px]">
                      {soldSearch ? `No matching sales found for "${soldSearch}"` : "No devices sold today yet."}
                    </div>
                  ) : filteredSold.map(u => (
                    <div key={u.id} className="px-6 py-4 flex items-center gap-6 group hover:bg-gray-50 transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate">{u.model}</p>
                          {u.saleOrderId && (
                            <span className="text-[8px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-200 font-mono">
                              #{u.saleOrderId}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 font-mono uppercase mt-0.5">
                          {u.colour} · <span className="text-black font-bold">IMEI: {u.imei || '—'}</span> · {u.salePlatform || 'Direct'}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold font-mono text-emerald-600">£{u.salePrice || u.buyPrice}</p>
                        <p className="text-[8px] text-gray-400 font-mono uppercase mt-1">Ready for Courier</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Today's new stock */}
      {todayUnits.length > 0 && (
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 border-l-4 border-l-black overflow-hidden">
          <button 
            onClick={() => setIsTodayStockOpen(!isTodayStockOpen)}
            className="w-full px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-all text-left"
          >
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 flex items-center gap-2">
              <Clock size={12} /> New Stock In Today — List These Now
              <span className="ml-2 bg-black text-white text-[8px] px-1.5 py-0.5 rounded-full">{todayUnits.length}</span>
            </h3>
            <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isTodayStockOpen ? 'rotate-180' : ''}`} />
          </button>
          
          <AnimatePresence initial={false}>
            {isTodayStockOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="divide-y divide-gray-50">
                  {todayUnits.map(u => (
                    <div key={u.id} className="px-6 py-4 flex items-center gap-6">
                      <div className="flex-1">
                        <p className="text-sm font-bold">{u.model}</p>
                        <p className="text-[10px] text-gray-500 font-mono uppercase">{u.colour} · <span className="text-black font-bold">IMEI: {u.imei || '—'}</span> · £{u.buyPrice}</p>
                      </div>
                      <span className="text-[10px] font-bold bg-black text-white px-3 py-1.5 font-mono uppercase tracking-widest flex-shrink-0">
                        Set Qty: 1 ↑
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Platform Quantity Reference */}
      <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 overflow-hidden">
        <button 
          onClick={() => setIsPlatformListOpen(!isPlatformListOpen)}
          className="w-full px-6 py-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between bg-gray-50 gap-2 hover:bg-gray-100 transition-all text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Platform Quantity Reference</h3>
            <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isPlatformListOpen ? 'rotate-180' : ''}`} />
          </div>
          <span className="text-[9px] text-gray-400 font-mono text-left md:text-right">Update daily on eBay / Amazon / OnBuy / Backmarket</span>
        </button>

        <AnimatePresence initial={false}>
          {isPlatformListOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="max-w-full overflow-hidden">
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-gray-100 text-[8px] text-gray-400 uppercase tracking-[0.25em] font-mono bg-gray-50">
                        <th className="px-6 py-3 font-bold">Model</th>
                        <th className="px-6 py-3 font-bold">Category</th>
                        <th className="px-6 py-3 font-bold">Flags</th>
                        <th className="px-6 py-3 font-bold">Units Available</th>
                        <th className="px-6 py-3 font-bold">Platform Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {platformList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-400 font-mono text-xs">
                            No phones in stock. Add a supplier delivery first.
                          </td>
                        </tr>
                      ) : platformList.map(item => (
                        <tr key={item.model} className="hover:bg-gray-50 transition-all">
                          <td className="px-6 py-4">
                            <p className="text-xs font-bold">{item.model}</p>
                            <p className="text-[9px] text-gray-400 font-mono uppercase mt-0.5">{item.brand}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-[9px] font-mono bg-black text-white px-2 py-1 uppercase">{item.category}</span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1">
                              {item.flags.map(flag => {
                                const cfg = FLAG_CONFIG[flag];
                                const Icon = cfg.icon;
                                return (
                                  <span key={flag} className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border font-mono flex items-center gap-1 ${cfg.style}`}>
                                    <Icon size={8} />{cfg.label}
                                  </span>
                                );
                              })}
                              {item.flags.length === 0 && <span className="text-[9px] text-gray-300 font-mono">—</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-2xl font-bold font-display tracking-tighter">{item.count}</span>
                          </td>
                          <td className="px-6 py-4">
                            {item.count > 0 ? (
                              <div>
                                <span className="text-[10px] font-bold bg-black text-white px-3 py-1.5 font-mono uppercase tracking-widest">
                                  Set Qty: 1 ✓
                                </span>
                                <p className="text-[8px] text-gray-400 font-mono mt-1 uppercase">
                                  {item.flags.includes('top10') ? FLAG_CONFIG.top10.action : 'In stock — list now'}
                                </p>
                              </div>
                            ) : (
                              <div>
                                <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-3 py-1.5 font-mono uppercase tracking-widest">
                                  Set Qty: 0 ✗
                                </span>
                                <p className="text-[8px] text-gray-400 font-mono mt-1 uppercase">Out of stock — delist</p>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="md:hidden divide-y divide-gray-50">
                  {platformList.length === 0 ? (
                    <div className="px-6 py-12 text-center text-gray-400 font-mono text-xs">
                      No available stock.
                    </div>
                  ) : platformList.map(item => (
                    <div key={item.model} className="px-6 py-5 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-bold">{item.model}</p>
                          <p className="text-[10px] text-gray-400 font-mono uppercase mt-0.5">{item.brand} · {item.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold font-display tracking-tighter leading-none">{item.count}</p>
                          <p className="text-[8px] text-gray-400 font-mono uppercase mt-1">Available</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {item.flags.map(flag => {
                          const cfg = FLAG_CONFIG[flag];
                          const Icon = cfg.icon;
                          return (
                            <span key={flag} className={`text-[8px] font-bold uppercase px-2 py-1 border font-mono flex items-center gap-1 ${cfg.style}`}>
                              <Icon size={8} />{cfg.label}
                            </span>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                         <span className={`text-[10px] font-bold px-3 py-2 font-mono uppercase tracking-widest rounded-lg ${item.count > 0 ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}>
                            Set Qty: {item.count > 0 ? '1 ✓' : '0 ✗'}
                         </span>
                         <p className="text-[8px] text-gray-400 font-mono uppercase text-right leading-tight max-w-[120px]">
                            {item.count > 0 
                              ? (item.flags.includes('top10') ? FLAG_CONFIG.top10.action : 'List on platforms now')
                              : 'Out of stock — delist everywhere'}
                         </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
