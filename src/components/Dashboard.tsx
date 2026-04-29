import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Package, CircleDollarSign, Star,
  ArrowUpRight, ArrowDownRight, Clock
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';

export default function Dashboard() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    const unsub1 = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const unsub2 = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { unsub1(); unsub2(); };
  }, []);

  // --- KPIs ---
  const available = units.filter(u => u.status === 'available');
  const sold = units.filter(u => u.status === 'sold');
  const totalValue = available.reduce((s, u) => s + u.buyPrice, 0);
  const top10Units = available.filter(u => u.flags.includes('top10'));

  // Today's arrivals
  const today = new Date().toISOString().split('T')[0];
  const todayArrivals = units.filter(u => u.dateIn === today);

  // --- Category breakdown ---
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of available) {
      map[u.category] = (map[u.category] || 0) + 1;
    }
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [available]);

  // --- Top 10 models by stock count ---
  const topModels = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { count: 0, value: 0 };
      map[u.model].count++;
      map[u.model].value += u.buyPrice;
    }
    return Object.entries(map)
      .map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [available]);

  // --- Recent arrivals (last 7 days) ---
  const recentArrivals = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return units
      .filter(u => new Date(u.dateIn) >= cutoff)
      .sort((a, b) => b.dateIn.localeCompare(a.dateIn))
      .slice(0, 8);
  }, [units]);

  return (
    <div className="space-y-8 pb-12">
      {/* Page title */}
      <div>
        <h2 className="text-3xl font-bold tracking-tighter uppercase font-display">Operations Hub</h2>
        <div className="h-px w-16 bg-black mt-2" />
        <p className="text-xs text-gray-400 font-mono mt-2 uppercase tracking-widest">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Units In Stock"
          value={available.length.toString()}
          sub={`${sold.length} sold total`}
          icon={<Package size={18} />}
          trend={todayArrivals.length > 0 ? `+${todayArrivals.length} today` : undefined}
          trendUp={true}
        />
        <KPICard
          label="Stock Value"
          value={`£${totalValue.toLocaleString()}`}
          sub="At buy price"
          icon={<CircleDollarSign size={18} />}
        />
        <KPICard
          label="Top 10 Focus"
          value={top10Units.length.toString()}
          sub="Units flagged"
          icon={<Star size={18} />}
        />
        <KPICard
          label="Suppliers Active"
          value={suppliers.length.toString()}
          sub="In network"
          icon={<TrendingUp size={18} />}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Category chart */}
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-6 lg:col-span-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-6">Stock by Category</h3>
          {categoryData.length === 0 ? (
            <EmptyState label="No inventory yet" />
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} barSize={28}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false} />
                  <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} stroke="#00000050" />
                  <YAxis fontSize={9} tickLine={false} axisLine={false} stroke="#00000050" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 0, fontSize: 11 }}
                    itemStyle={{ color: '#000' }}
                    cursor={{ fill: '#f9fafb' }}
                  />
                  <Bar dataKey="count" name="Units">
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#000000' : i === 1 ? '#374151' : '#6b7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Today's arrivals / recent activity */}
        <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-6">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-6">
            Recent Arrivals
            {todayArrivals.length > 0 && (
              <span className="ml-2 bg-black text-white text-[8px] px-2 py-0.5 font-mono">{todayArrivals.length} today</span>
            )}
          </h3>
          {recentArrivals.length === 0 ? (
            <EmptyState label="No recent arrivals" />
          ) : (
            <div className="space-y-3">
              {recentArrivals.map(u => (
                <div key={u.id} className="flex items-start gap-3 group">
                  <div className={`w-1.5 h-1.5 mt-1.5 rounded-full flex-shrink-0 ${u.dateIn === today ? 'bg-black' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <p className="text-[9px] text-gray-400 font-mono uppercase">{u.colour} · £{u.buyPrice}</p>
                  </div>
                  <span className="text-[9px] text-gray-400 font-mono flex-shrink-0">
                    {new Date(u.dateIn).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top 10 Models table */}
      <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Top Models by Stock</h3>
          <span className="text-[9px] text-gray-400 font-mono uppercase">Platform Qty Guide</span>
        </div>
        {topModels.length === 0 ? (
          <div className="p-12 text-center">
            <EmptyState label="No inventory data yet" />
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 text-[8px] text-gray-400 uppercase tracking-[0.25em] font-mono bg-gray-50">
                <th className="px-6 py-3 font-bold">#</th>
                <th className="px-6 py-3 font-bold">Model</th>
                <th className="px-6 py-3 font-bold">Units Available</th>
                <th className="px-6 py-3 font-bold">Stock Value</th>
                <th className="px-6 py-3 font-bold">Platform Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topModels.map((m, i) => (
                <tr key={m.model} className="hover:bg-gray-50 transition-all">
                  <td className="px-6 py-3 text-[10px] font-mono text-gray-400">{String(i + 1).padStart(2, '0')}</td>
                  <td className="px-6 py-3">
                    <p className="text-xs font-bold">{m.model}</p>
                  </td>
                  <td className="px-6 py-3">
                    <span className="text-lg font-bold font-display tracking-tighter">{m.count}</span>
                  </td>
                  <td className="px-6 py-3 font-mono text-sm font-bold">£{m.value.toLocaleString()}</td>
                  <td className="px-6 py-3">
                    <span className={`text-[9px] font-bold uppercase px-2 py-1 font-mono ${m.count > 0 ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>
                      {m.count > 0 ? 'Set Qty: 1' : 'Set Qty: 0'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, icon, trend, trendUp }: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  trend?: string; trendUp?: boolean;
}) {
  return (
    <div className="bg-white border border-gray-200 shadow-md border-0 ring-1 ring-gray-100 p-6 flex flex-col justify-between hover:border-gray-400 transition-all cursor-default">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-gray-50 text-gray-500">{icon}</div>
        {trend && (
          <span className={`text-[9px] font-mono font-bold flex items-center gap-1 ${trendUp ? 'text-black' : 'text-gray-400'}`}>
            {trendUp ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="text-[8px] text-gray-400 uppercase tracking-[0.25em] font-mono mb-1">{label}</p>
        <p className="text-3xl font-bold tracking-tighter font-display">{value}</p>
        {sub && <p className="text-[9px] text-gray-400 font-mono mt-1 uppercase">{sub}</p>}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-300">
      <Package size={32} className="mb-2" />
      <p className="text-xs font-mono">{label}</p>
    </div>
  );
}
