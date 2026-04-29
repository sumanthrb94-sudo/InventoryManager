import { useState, useEffect, useMemo } from 'react';
import {
  Bell, CheckCircle2, XCircle, Star, MapPin, Truck,
  RefreshCw, Package, ChevronRight, Clock, ArrowUpRight
} from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, OperationalFlag } from '../types';

const FLAG_CONFIG: Record<OperationalFlag, { label: string; icon: any; style: string; action: string }> = {
  top10: {
    label: 'Top 10 Focus',
    icon: Star,
    style: 'bg-yellow-50 text-yellow-800 border-yellow-200',
    action: 'Prioritise on all platforms — keep qty at 1',
  },
  officeOnly: {
    label: 'Office Only',
    icon: MapPin,
    style: 'bg-blue-50 text-blue-800 border-blue-200',
    action: 'Stock is physically in office — can ship today',
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
    action: 'Set platform qty to 0 immediately',
  },
};

export default function Sales() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    const unsub1 = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const unsub2 = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { unsub1(); unsub2(); };
  }, []);

  const today = new Date().toISOString().split('T')[0];

  // Units updated today (dateIn = today)
  const todayUnits = useMemo(() =>
    units.filter(u => u.dateIn === today),
    [units, today]
  );

  // Platform update list — available units grouped by model for qty decisions
  const platformList = useMemo(() => {
    const map = new Map<string, { model: string; brand: string; category: string; count: number; flags: OperationalFlag[]; units: InventoryUnit[] }>();
    for (const u of units.filter(u => u.status === 'available')) {
      if (!map.has(u.model)) {
        map.set(u.model, { model: u.model, brand: u.brand, category: u.category, count: 0, flags: [], units: [] });
      }
      const entry = map.get(u.model)!;
      entry.count++;
      entry.units.push(u);
      for (const f of u.flags) {
        if (!entry.flags.includes(f)) entry.flags.push(f);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      // Top 10 first
      const aTop = a.flags.includes('top10') ? 1 : 0;
      const bTop = b.flags.includes('top10') ? 1 : 0;
      return bTop - aTop || b.count - a.count;
    });
  }, [units]);

  // Sold today
  const soldToday = useMemo(() => units.filter(u => u.saleDate === today), [units, today]);

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

      {/* Quick KPIs for sales team */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Available to Sell</p>
          <p className="text-4xl font-bold font-display tracking-tighter">{units.filter(u => u.status === 'available').length}</p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">In Office Now</p>
          <p className="text-4xl font-bold font-display tracking-tighter">
            {units.filter(u => u.status === 'available' && u.flags.includes('officeOnly')).length}
          </p>
        </div>
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-5">
          <p className="text-[8px] font-bold text-gray-400 uppercase tracking-widest font-mono mb-2">Top 10 Units</p>
          <p className="text-4xl font-bold font-display tracking-tighter">
            {units.filter(u => u.status === 'available' && u.flags.includes('top10')).length}
          </p>
        </div>
      </div>

      {/* Today's new stock */}
      {todayUnits.length > 0 && (
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 border-l-4 border-l-black">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-600 flex items-center gap-2">
              <Clock size={12} /> New Stock In Today — List These Now
            </h3>
          </div>
          <div className="divide-y divide-gray-50">
            {todayUnits.map(u => (
              <div key={u.id} className="px-6 py-4 flex items-center gap-6">
                <div className="flex-1">
                  <p className="text-sm font-bold">{u.model}</p>
                  <p className="text-[10px] text-gray-500 font-mono uppercase">{u.colour} · IMEI: {u.imei || '—'} · £{u.buyPrice}</p>
                </div>
                <span className="text-[9px] font-bold bg-black text-white px-3 py-1.5 font-mono uppercase tracking-widest">
                  Set Qty: 1 ↑
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform Quantity Reference */}
      <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Platform Quantity Reference</h3>
          <span className="text-[9px] text-gray-400 font-mono">Update daily on eBay / Swappa / Back Market</span>
        </div>

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
                  No available stock. Ingest a batch first.
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
    </div>
  );
}
