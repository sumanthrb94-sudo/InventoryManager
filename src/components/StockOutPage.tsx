import React, { useState, useEffect, useMemo } from 'react';
import { PackageMinus, Search, CheckCircle2, Clock, DollarSign } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import CopyImei from './CopyImei';


interface Props {
  onOpenUnit?: (unit: InventoryUnit) => void;
}

export default function StockOutPage({ onOpenUnit }: Props) {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    return u;
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const sold = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  const todaySold = sold.filter(u => u.saleDate === today || (!u.saleDate && u.dateIn === today));
  const yesterdaySold = sold.filter(u => u.saleDate === yesterday);
  const todayRevenue = todaySold.reduce((s, u) => s + (u.salePrice || 0), 0);
  const todayProfit = todaySold.reduce((s, u) => s + ((u.salePrice || 0) - u.buyPrice), 0);

  const recentSold = useMemo(() => {
    return [...sold]
      .sort((a, b) => new Date(b.saleDate || b.dateIn).getTime() - new Date(a.saleDate || a.dateIn).getTime())
      .slice(0, 60);
  }, [sold]);

  const filtered = useMemo(() => {
    if (!search.trim()) return recentSold;
    const q = search.toLowerCase();
    return recentSold.filter(u =>
      u.model.toLowerCase().includes(q) ||
      u.imei.includes(q) ||
      (u.salePrice + '').includes(q) ||
      (u.salePlatform || '').toLowerCase().includes(q)
    );
  }, [recentSold, search]);

  const PLATFORM_COLORS: Record<string, string> = {
    eBay: 'text-yellow-700 bg-yellow-50',
    Amazon: 'text-orange-700 bg-orange-50',
    OnBuy: 'text-blue-700 bg-blue-50',
    Backmarket: 'text-green-700 bg-green-50',
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
            <PackageMinus size={16} className="text-red-600" />
          </span>
          Stock Out
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Sales records · Model · IMEI · Sale Price
        </p>
      </div>

      {/* Today summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-red-50 border border-red-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-red-500">Today Sold</p>
          <p className="text-2xl font-bold font-display mt-1 text-red-700">{todaySold.length}</p>
          <p className="text-[8px] text-red-400 font-mono">units</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-green-600">Revenue</p>
          <p className="text-xl font-bold font-display mt-1 text-green-700">£{(todayRevenue/1000).toFixed(1)}k</p>
          <p className="text-[8px] text-green-500 font-mono">today</p>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-purple-600">Profit</p>
          <p className="text-xl font-bold font-display mt-1 text-purple-700">£{todayProfit.toLocaleString()}</p>
          <p className="text-[8px] text-purple-500 font-mono">today</p>
        </div>
      </div>

      {/* Yesterday's pill */}
      {yesterdaySold.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-xl">
          <Clock size={14} className="text-gray-400" />
          <span className="text-[10px] font-mono text-gray-300">Yesterday:</span>
          <span className="text-[10px] font-bold">{yesterdaySold.length} sold</span>
          <span className="text-[10px] font-mono text-gray-400">·</span>
          <span className="text-[10px] font-bold text-green-400">
            £{yesterdaySold.reduce((s, u) => s + (u.salePrice || 0), 0).toLocaleString()} revenue
          </span>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model, IMEI, sale price or platform…"
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-black transition-all"
        />
      </div>

      {/* Sold list */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Recent Sales</p>
          <span className="text-[9px] font-mono text-gray-400">{filtered.length} records</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
            <PackageMinus size={32} />
            <p className="text-xs font-mono">No sales records yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(u => {
              const margin = ((u.salePrice || 0) - u.buyPrice);
              return (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={14} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <CopyImei imei={u.imei} truncate={10} />
                      {u.salePlatform && (
                        <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full ${PLATFORM_COLORS[u.salePlatform] || 'bg-gray-100 text-gray-600'}`}>
                          {u.salePlatform}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold">£{(u.salePrice || 0).toLocaleString()}</p>
                    <p className={`text-[9px] font-mono ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {margin >= 0 ? '+' : ''}£{margin.toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
