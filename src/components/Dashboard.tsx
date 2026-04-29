import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Package, CircleDollarSign, Star,
  ArrowUpRight, ChevronRight, Truck, ShoppingBag
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';

export interface NavAction {
  tab: 'inventory' | 'suppliers' | 'scan' | 'calendar';
  filters?: {
    status?: string;
    model?: string;
    search?: string;
    supplierId?: string;
  };
}

interface Props {
  onNavigate: (action: NavAction) => void;
}

export default function Dashboard({ onNavigate }: Props) {
  const [units, setUnits]       = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const available    = units.filter(u => u.status === 'available');
  const sold         = units.filter(u => u.status === 'sold');
  const returned     = units.filter(u => u.status === 'returned');
  const totalValue   = available.reduce((s, u) => s + u.buyPrice, 0);
  const top10Units   = available.filter(u => u.flags.includes('top10'));
  const today        = new Date().toISOString().split('T')[0];
  const todayArrivals = units.filter(u => u.dateIn === today);
  const todaySold    = sold.filter(u => (u.saleDate || u.dateIn) === today);

  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of available) map[u.category] = (map[u.category] || 0) + 1;
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [available]);

  const topModels = useMemo(() => {
    const map: Record<string, { count: number; value: number }> = {};
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { count: 0, value: 0 };
      map[u.model].count++;
      map[u.model].value += u.buyPrice;
    }
    return Object.entries(map).map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }, [available]);

  // Platform breakdown of sales
  const platformSales = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of sold) {
      const p = u.salePlatform || 'Unknown';
      map[p] = (map[p] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [sold]);

  const PLATFORM_COLORS: Record<string, string> = {
    eBay:'bg-yellow-100 text-yellow-800', Amazon:'bg-orange-100 text-orange-800',
    OnBuy:'bg-blue-100 text-blue-800', Backmarket:'bg-green-100 text-green-800',
  };

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Operations Hub</h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
        </p>
      </div>

      {/* KPI Cards — ALL CLICKABLE */}
      <div className="grid grid-cols-2 gap-3">
        <KPICard
          label="Office Stock" value={available.length}
          sub="Units available" icon={<Package size={16}/>}
          badge={todayArrivals.length > 0 ? `+${todayArrivals.length} today` : undefined}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'available' } })}
        />
        <KPICard
          label="Stock Value" value={`£${totalValue.toLocaleString()}`}
          sub="At buy price" icon={<CircleDollarSign size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'available' } })}
        />
        <KPICard
          label="Sold Total" value={sold.length}
          sub={`${todaySold.length} sold today`} icon={<ShoppingBag size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'sold' } })}
        />
        <KPICard
          label="Returned" value={returned.length}
          sub="Back in pipeline" icon={<TrendingUp size={16}/>}
          onClick={() => onNavigate({ tab:'inventory', filters:{ status:'returned' } })}
        />
      </div>

      {/* Platform sales pills */}
      {platformSales.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Sales by Platform</p>
          <div className="flex flex-wrap gap-2">
            {platformSales.map(([p, c]) => (
              <span key={p} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono ${PLATFORM_COLORS[p] || 'bg-gray-100 text-gray-700'}`}>
                {p} · {c} sold
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suppliers clickable */}
      <button
        onClick={() => onNavigate({ tab:'suppliers' })}
        className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center justify-between hover:bg-gray-50 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
            <Truck size={15} className="text-gray-600"/>
          </div>
          <div className="text-left">
            <p className="text-sm font-bold">{suppliers.length} Suppliers</p>
            <p className="text-[10px] text-gray-400 font-mono">View order history & details</p>
          </div>
        </div>
        <ChevronRight size={16} className="text-gray-400"/>
      </button>

      {/* Category chart */}
      {categoryData.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Stock by Category</p>
            <button onClick={() => onNavigate({ tab:'inventory' })} className="text-[9px] text-gray-400 font-mono underline">See all →</button>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="#00000010" vertical={false}/>
                <XAxis dataKey="name" fontSize={8} tickLine={false} axisLine={false} stroke="#00000050"
                  tickFormatter={n => n.replace('Samsung ','S.').replace('Apple Watch','Watch')}/>
                <YAxis fontSize={8} tickLine={false} axisLine={false} stroke="#00000050"/>
                <Tooltip contentStyle={{ borderRadius:8, fontSize:11, border:'1px solid #e5e7eb' }} cursor={{ fill:'#f9fafb' }}/>
                <Bar dataKey="count" name="Units" radius={[4,4,0,0]}>
                  {categoryData.map((_, i) => <Cell key={i} fill={i===0?'#000':i===1?'#374151':i===2?'#6b7280':'#9ca3af'}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Clickable category chips */}
          <div className="flex flex-wrap gap-2 mt-3">
            {categoryData.map(c => (
              <button key={c.name} onClick={() => onNavigate({ tab:'inventory', filters:{ search: c.name } })}
                className="text-[9px] font-bold font-mono bg-gray-100 hover:bg-black hover:text-white px-2.5 py-1 rounded-full transition-all">
                {c.name.replace('Samsung ','')} · {c.count}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Top 10 models — clickable rows */}
      {topModels.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Top Models · Office Stock</p>
            <span className="text-[9px] text-gray-400 font-mono">eBay / Amazon / OnBuy / Backmarket</span>
          </div>
          <div className="divide-y divide-gray-50">
            {topModels.map((m, i) => (
              <button
                key={m.model}
                onClick={() => onNavigate({ tab:'inventory', filters:{ search: m.model, status:'available' } })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
              >
                <span className="text-[10px] font-mono text-gray-400 w-5 flex-shrink-0">{String(i+1).padStart(2,'0')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{m.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono">£{m.value.toLocaleString()} value</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold font-display leading-tight">{m.count}</p>
                  <p className="text-[8px] text-gray-400 font-mono">in stock</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {units.length === 0 && (
        <div className="py-20 flex flex-col items-center gap-3 border-2 border-dashed border-gray-200 rounded-2xl">
          <Package size={48} className="text-gray-200"/>
          <p className="text-gray-400 font-mono text-sm text-center px-4">No data yet.<br/>Import your Excel sheet to get started.</p>
        </div>
      )}
    </div>
  );
}

function KPICard({ label, value, sub, icon, badge, onClick }: {
  label: string; value: number | string; sub?: string;
  icon: React.ReactNode; badge?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm text-left hover:shadow-md hover:border-gray-300 active:scale-[0.98] transition-all group w-full"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center text-gray-600 group-hover:bg-black group-hover:text-white transition-all">
          {icon}
        </div>
        {badge && <span className="text-[8px] bg-black text-white px-2 py-0.5 rounded-full font-mono font-bold">{badge}</span>}
        <ChevronRight size={13} className="text-gray-300 group-hover:text-black transition-all"/>
      </div>
      <p className="text-[8px] text-gray-400 uppercase tracking-widest font-mono">{label}</p>
      <p className="text-2xl font-bold tracking-tighter font-display mt-0.5">{value}</p>
      {sub && <p className="text-[9px] text-gray-400 font-mono mt-0.5">{sub}</p>}
    </button>
  );
}
