import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, Package, CircleDollarSign,
  ChevronRight, Truck, ShoppingBag, Trash2, AlertTriangle, CheckCircle2, X,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';
import { getOnHandValue } from '../lib/inventorySummary';
import CopyImei from './CopyImei';
import PeriodicInventory from './PeriodicInventory';
import CollapsibleSection from './CollapsibleSection';



export interface NavAction {
  tab: 'inventory' | 'suppliers' | 'scan' | 'calendar' | 'sales';
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

type ResetState = 'idle' | 'confirming' | 'resetting' | 'done' | 'error';

export default function Dashboard({ onNavigate }: Props) {
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [resetState, setResetState] = useState<ResetState>('idle');

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const handleResetConfirm = async () => {
    setResetState('resetting');
    try {
      await dbService.resetDatabase();
      setResetState('done');
      setTimeout(() => setResetState('idle'), 4000);
    } catch {
      setResetState('error');
      setTimeout(() => setResetState('idle'), 4000);
    }
  };

  const available    = units.filter(u => u.status === 'available');
  const sold         = units.filter(u => u.status === 'sold');
  const returned     = units.filter(u => u.status === 'returned');
  const totalValue   = getOnHandValue(units);
  const top10Units   = available.filter(u => u.flags.includes('top10'));
  const today        = new Date().toISOString().split('T')[0];
  const yesterday    = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const todayArrivals = units.filter(u => u.dateIn === today);
  const todaySold    = sold.filter(u => (u.saleDate || u.dateIn) === today);
  const yesterdaySold = sold.filter(u => (u.saleDate || '') === yesterday || (u.dateIn === yesterday && !u.saleDate));

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

  const top10Sold = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {};
    for (const u of sold) {
      if (!map[u.model]) map[u.model] = { count: 0, revenue: 0 };
      map[u.model].count++;
      map[u.model].revenue += (u.salePrice || 0);
    }
    return Object.entries(map).map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }, [sold]);

  const seriesModels = useMemo(() => {
    const map: Record<string, { count: number; value: number; category: string; seriesName: string; shortSymbol: string; searchTerm: string }> = {};
    for (const u of available) {
      const mLower = u.model.toLowerCase();
      let seriesName = u.model;
      let shortSymbol = u.model.substring(0, 3).toUpperCase();
      let searchTerm = u.model;

      if (mLower.includes('iphone')) {
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        seriesName = `Apple ${num} Series`;
        shortSymbol = `a${num}`;
        searchTerm = `iPhone ${num}`;
      } else if (mLower.includes('galaxy s')) {
        const numMatch = u.model.match(/s\d+/i);
        const num = numMatch ? numMatch[0].toUpperCase() : 'S';
        seriesName = `Samsung ${num} Series`;
        shortSymbol = `S${num.replace('S', '')}`;
        searchTerm = `Galaxy ${num}`;
      } else if (mLower.includes('galaxy a')) {
        const numMatch = u.model.match(/a\d+/i);
        const num = numMatch ? numMatch[0].toUpperCase() : 'A';
        seriesName = `Samsung ${num} Series`;
        shortSymbol = `S${num.replace('A', '')}`;
        searchTerm = `Galaxy ${num}`;
      } else if (mLower.includes('galaxy z')) {
        const isFold = mLower.includes('fold');
        const isFlip = mLower.includes('flip');
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        const type = isFold ? 'Fold' : isFlip ? 'Flip' : 'Z';
        seriesName = `Samsung Z ${type} ${num} Series`;
        shortSymbol = `S${isFold ? 'Fd' : isFlip ? 'Fp' : 'Z'}${num}`;
        searchTerm = `Galaxy Z ${type} ${num}`;
      } else if (mLower.includes('pixel')) {
        const numMatch = u.model.match(/\d+/);
        const num = numMatch ? numMatch[0] : '';
        seriesName = `Google ${num} Series`;
        shortSymbol = `G${num}`;
        searchTerm = `Pixel ${num}`;
      } else if (mLower.includes('ipad')) {
        if (mLower.includes('pro')) { seriesName = 'Apple iPad Pro Series'; shortSymbol = 'aPP'; searchTerm = 'iPad Pro'; }
        else if (mLower.includes('air')) { seriesName = 'Apple iPad Air Series'; shortSymbol = 'aPA'; searchTerm = 'iPad Air'; }
        else if (mLower.includes('mini')) { seriesName = 'Apple iPad Mini Series'; shortSymbol = 'aPM'; searchTerm = 'iPad Mini'; }
        else { seriesName = 'Apple iPad Series'; shortSymbol = 'aPd'; searchTerm = 'iPad'; }
      } else if (mLower.includes('watch')) {
        if (mLower.includes('apple')) {
          const numMatch = u.model.match(/\d+/);
          if (mLower.includes('ultra')) { seriesName = 'Apple Watch Ultra'; shortSymbol = 'aWU'; searchTerm = 'Watch Ultra'; }
          else if (mLower.includes('se')) { seriesName = 'Apple Watch SE'; shortSymbol = 'aWS'; searchTerm = 'Watch SE'; }
          else { seriesName = `Apple Watch ${numMatch ? numMatch[0] : ''} Series`; shortSymbol = `aW${numMatch ? numMatch[0] : ''}`; searchTerm = `Watch Series ${numMatch ? numMatch[0] : ''}`; }
        } else if (mLower.includes('galaxy')) {
          const numMatch = u.model.match(/\d+/);
          seriesName = `Samsung Watch ${numMatch ? numMatch[0] : ''} Series`; shortSymbol = `sW${numMatch ? numMatch[0] : ''}`; searchTerm = `Galaxy Watch ${numMatch ? numMatch[0] : ''}`;
        }
      } else if (mLower.includes('macbook')) {
        if (mLower.includes('pro')) { seriesName = 'Apple MacBook Pro Series'; shortSymbol = 'aBP'; searchTerm = 'MacBook Pro'; }
        else if (mLower.includes('air')) { seriesName = 'Apple MacBook Air Series'; shortSymbol = 'aBA'; searchTerm = 'MacBook Air'; }
        else { seriesName = 'Apple MacBook Series'; shortSymbol = 'aMB'; searchTerm = 'MacBook'; }
      } else if (mLower.includes('airpods')) {
        if (mLower.includes('pro')) { seriesName = 'Apple AirPods Pro'; shortSymbol = 'aPP'; searchTerm = 'AirPods Pro'; }
        else if (mLower.includes('max')) { seriesName = 'Apple AirPods Max'; shortSymbol = 'aPM'; searchTerm = 'AirPods Max'; }
        else { seriesName = 'Apple AirPods Series'; shortSymbol = 'aAP'; searchTerm = 'AirPods'; }
      } else {
        const parts = u.model.split(' ');
        seriesName = `${parts[0] || ''} ${parts[1] || ''} Series`.trim();
        searchTerm = parts.slice(0, 2).join(' ');
      }

      if (!map[seriesName]) map[seriesName] = { count: 0, value: 0, category: u.category || 'Other', seriesName, shortSymbol, searchTerm };
      map[seriesName].count++;
      map[seriesName].value += u.buyPrice;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [available]);


  // Aged Inventory (Longest unsold)
  const oldestUnits = useMemo(() => {
    return [...available]
      .filter(u => u.dateIn)
      .sort((a, b) => new Date(a.dateIn).getTime() - new Date(b.dateIn).getTime())
      .slice(0, 10)
      .map(u => {
        const daysOld = Math.floor((new Date().getTime() - new Date(u.dateIn).getTime()) / (1000 * 3600 * 24));
        return { ...u, daysOld };
      });
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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Operations Hub</h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>

        {/* Inline reset flow — no native confirm/alert dialogs */}
        <div className="flex-shrink-0">
          {resetState === 'idle' && (
            <button
              onClick={() => setResetState('confirming')}
              className="flex items-center gap-2 px-3 py-2 border border-red-100 bg-red-50 text-red-500 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-red-100 transition-all"
            >
              <Trash2 size={12} />
              Reset DB
            </button>
          )}

          {resetState === 'confirming' && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <AlertTriangle size={12} className="text-red-600 flex-shrink-0" />
              <span className="text-[9px] font-bold text-red-700 uppercase tracking-widest">Delete all data?</span>
              <button
                onClick={handleResetConfirm}
                className="px-2 py-1 bg-red-600 text-white rounded-lg text-[9px] font-bold uppercase tracking-widest hover:bg-red-700 transition-all"
              >
                Yes
              </button>
              <button
                onClick={() => setResetState('idle')}
                className="p-1 text-red-400 hover:text-red-700 transition-all"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {resetState === 'resetting' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-xl">
              <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Resetting…</span>
            </div>
          )}

          {resetState === 'done' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
              <CheckCircle2 size={12} className="text-emerald-600" />
              <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-widest">Reset complete</span>
            </div>
          )}

          {resetState === 'error' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
              <X size={12} className="text-red-600" />
              <span className="text-[9px] font-bold text-red-700 uppercase tracking-widest">Reset failed</span>
            </div>
          )}
        </div>
      </div>

      <PeriodicInventory
        units={units}
        onNavigate={(search) => onNavigate({ tab: 'inventory', filters: { search, status: 'available' } })}
      />

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

      {/* Yesterday's Sales */}
      <CollapsibleSection
        title="Yesterday's Sales"
        count={yesterdaySold.length}
        meta={yesterdaySold.length > 0 ? `£${yesterdaySold.reduce((s,u)=>s+(u.salePrice||0),0).toLocaleString()}` : undefined}
        accent="border-l-gray-700"
        defaultOpen={true}
      >
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-4 text-white">
          <p className="text-[9px] text-gray-500 font-mono mb-3">{new Date(Date.now()-86400000).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</p>
          {yesterdaySold.length === 0 ? (
            <p className="text-[10px] text-gray-500 font-mono">No sales recorded for yesterday.</p>
          ) : (
            <div className="space-y-1.5">
              {yesterdaySold.slice(0, 5).map(u => (
                <button key={u.id}
                  onClick={() => onNavigate({ tab:'inventory', filters:{ search: u.imei } })}
                  className="w-full flex items-center justify-between bg-white/5 hover:bg-white/10 rounded-lg px-3 py-2 transition-all text-left"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <p className="text-[9px] text-gray-400 font-mono">{u.colour} · {u.salePlatform || 'Unknown platform'}</p>
                  </div>
                  <span className="text-sm font-bold text-green-400 ml-2 flex-shrink-0">£{(u.salePrice || 0).toLocaleString()}</span>
                </button>
              ))}
              {yesterdaySold.length > 5 && (
                <p className="text-[9px] text-gray-500 font-mono text-center pt-1">+{yesterdaySold.length - 5} more sold yesterday</p>
              )}
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Top 10 Sold Products */}
      {top10Sold.length > 0 && (
        <CollapsibleSection
          title="Top 10 Sold Products"
          meta="All time · by volume"
          accent="border-l-emerald-500"
          defaultOpen={false}
        >
          <div className="divide-y divide-gray-50">
            {top10Sold.map((m, i) => (
              <button key={m.model}
                onClick={() => onNavigate({ tab:'inventory', filters:{ search: m.model, status:'sold' } })}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
              >
                <span className={`text-[10px] font-mono w-5 flex-shrink-0 font-bold ${i < 3 ? 'text-amber-500' : 'text-gray-400'}`}>{String(i+1).padStart(2,'0')}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{m.model}</p>
                  <p className="text-[9px] text-gray-400 font-mono">£{m.revenue.toLocaleString()} revenue</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold font-display leading-tight text-green-600">{m.count}</p>
                  <p className="text-[8px] text-gray-400 font-mono">sold</p>
                </div>
                <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Sales by Platform */}
      {platformSales.length > 0 && (
        <CollapsibleSection title="Sales by Platform" count={sold.length} accent="border-l-blue-400" defaultOpen={false}>
          <div className="p-4 flex flex-wrap gap-2">
            {platformSales.map(([p, c]) => (
              <span key={p} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono ${PLATFORM_COLORS[p] || 'bg-gray-100 text-gray-700'}`}>
                {p} · {c} sold
              </span>
            ))}
          </div>
        </CollapsibleSection>
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

      {/* Stock by Category chart */}
      {categoryData.length > 0 && (
        <CollapsibleSection title="Stock by Category" count={available.length} accent="border-l-purple-400" defaultOpen={false}>
          <div className="p-4">
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
            <div className="flex flex-wrap gap-2 mt-3">
              {categoryData.map(c => (
                <button key={c.name} onClick={() => onNavigate({ tab:'inventory', filters:{ search: c.name } })}
                  className="text-[9px] font-bold font-mono bg-gray-100 hover:bg-black hover:text-white px-2.5 py-1 rounded-full transition-all">
                  {c.name.replace('Samsung ','')} · {c.count}
                </button>
              ))}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Top Models — Office Stock */}
      {topModels.length > 0 && (
        <CollapsibleSection title="Top Models · Office Stock" count={topModels.length} accent="border-l-gray-500" defaultOpen={false}>
          <div className="divide-y divide-gray-50">
            {topModels.map((m, i) => (
              <button key={m.model}
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
        </CollapsibleSection>
      )}

      {/* Oldest Unsold Stock */}
      {oldestUnits.length > 0 && (
        <CollapsibleSection
          title="Oldest Unsold Stock"
          count={oldestUnits.length}
          meta={oldestUnits[0] ? `${oldestUnits[0].daysOld}d oldest` : undefined}
          accent="border-l-orange-400"
          defaultOpen={false}
        >
          <div className="divide-y divide-gray-50">
            {oldestUnits.map(u => {
              const supplier = suppliers.find(s => s.id === u.supplierId);
              return (
                <button key={u.id}
                  onClick={() => onNavigate({ tab:'inventory', filters:{ search: u.imei } })}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-all text-left group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{u.model}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-gray-400 font-mono">{u.colour}</span>
                      <span className="text-[9px] text-gray-300">·</span>
                      <CopyImei imei={u.imei} truncate={10} />
                      <span className="text-[9px] text-gray-300">·</span>
                      <span className="text-[9px] text-gray-400 font-mono">{supplier?.name || 'Unknown'}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xl font-bold font-display leading-tight text-orange-600">{u.daysOld}</p>
                    <p className="text-[8px] text-gray-400 font-mono">days</p>
                  </div>
                  <ChevronRight size={14} className="text-gray-300 group-hover:text-black transition-all flex-shrink-0"/>
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* placeholder removed — periodic table now at top */}

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
