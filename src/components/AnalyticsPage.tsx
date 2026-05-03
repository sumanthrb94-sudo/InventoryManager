import React, { useState, useEffect, useMemo } from 'react';
import {
  Zap, TrendingUp, TrendingDown, AlertTriangle,
  Clock, Package, ChevronRight,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier } from '../types';
import CollapsibleSection from './CollapsibleSection';

type Period = 7 | 30 | 90;

const PLATFORM_HEX: Record<string, string> = {
  eBay: '#f59e0b',
  Amazon: '#f97316',
  OnBuy: '#3b82f6',
  Backmarket: '#10b981',
};

export default function AnalyticsPage() {
  const [units, setUnits]         = useState<InventoryUnit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [period, setPeriod]       = useState<Period>(30);

  useEffect(() => {
    const u = dbService.subscribeToCollection('inventoryUnits', setUnits);
    const s = dbService.subscribeToCollection('suppliers', setSuppliers);
    return () => { u(); s(); };
  }, []);

  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const sold      = useMemo(() => units.filter(u => u.status === 'sold'),      [units]);
  const available = useMemo(() => units.filter(u => u.status === 'available'), [units]);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  // ── Helper: ISO date string N days before today ─────────────────────────
  function daysAgo(n: number) {
    const d = new Date(todayStr);
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
  }

  // ── Sales Velocity Trend ─────────────────────────────────────────────────
  const trendData = useMemo(() => {
    return Array.from({ length: period }, (_, i) => {
      const dateStr = daysAgo(period - 1 - i);
      const d = new Date(dateStr);
      const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const count = sold.filter(u => (u.saleDate || u.dateIn) === dateStr).length;
      return { dateStr, label, units: count };
    });
  }, [sold, period, todayStr]);

  const totalSoldInPeriod = useMemo(
    () => trendData.reduce((s, d) => s + d.units, 0),
    [trendData],
  );

  const prevPeriodTotal = useMemo(() => {
    let n = 0;
    for (let i = period * 2; i > period; i--) {
      const dateStr = daysAgo(i);
      n += sold.filter(u => (u.saleDate || u.dateIn) === dateStr).length;
    }
    return n;
  }, [sold, period, todayStr]);

  const periodDelta = prevPeriodTotal > 0
    ? Math.round((totalSoldInPeriod - prevPeriodTotal) / prevPeriodTotal * 100)
    : null;

  // ── Platform Scorecard ───────────────────────────────────────────────────
  const platformStats = useMemo(() => {
    return ['eBay', 'Amazon', 'OnBuy', 'Backmarket'].map(p => {
      const pSold = sold.filter(u => u.salePlatform === p);
      let totalDays = 0;
      let withDate   = 0;
      for (const u of pSold) {
        if (u.saleDate && u.dateIn) {
          totalDays += Math.max(0,
            (new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / 86400000,
          );
          withDate++;
        }
      }
      return {
        platform:      p,
        count:         pSold.length,
        avgSalePrice:  pSold.length ? Math.round(pSold.reduce((s, u) => s + (u.salePrice || 0), 0) / pSold.length) : 0,
        avgDaysToSell: withDate ? Math.round(totalDays / withDate) : null,
      };
    });
  }, [sold]);

  // ── Model Velocity ───────────────────────────────────────────────────────
  const modelVelocity = useMemo(() => {
    const map: Record<string, { sold: number; totalDays: number; inStock: number }> = {};

    for (const u of sold) {
      if (!map[u.model]) map[u.model] = { sold: 0, totalDays: 0, inStock: 0 };
      map[u.model].sold++;
      if (u.saleDate && u.dateIn) {
        map[u.model].totalDays += Math.max(0,
          (new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / 86400000,
        );
      }
    }
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { sold: 0, totalDays: 0, inStock: 0 };
      map[u.model].inStock++;
    }

    return Object.entries(map)
      .filter(([, m]) => m.sold >= 2)
      .map(([model, m]) => ({
        model,
        sold:        m.sold,
        inStock:     m.inStock,
        avgDays:     Math.round(m.totalDays / m.sold),
        sellThrough: Math.round(m.sold / (m.sold + m.inStock) * 100),
      }))
      .sort((a, b) => a.avgDays - b.avgDays);
  }, [sold, available]);

  const fastMovers = useMemo(
    () => modelVelocity.filter(m => m.avgDays <= 14).slice(0, 12),
    [modelVelocity],
  );
  const slowMovers = useMemo(
    () => [...modelVelocity].reverse().filter(m => m.avgDays > 30).slice(0, 12),
    [modelVelocity],
  );

  // ── Aged Stock Distribution ──────────────────────────────────────────────
  const agedBuckets = useMemo(() => {
    const buckets = [
      { label: '0 – 30 days',  min: 0,  max: 30,       bar: 'bg-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
      { label: '31 – 60 days', min: 31, max: 60,       bar: 'bg-amber-400',   bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-700'   },
      { label: '61 – 90 days', min: 61, max: 90,       bar: 'bg-orange-500',  bg: 'bg-orange-50',  border: 'border-orange-100',  text: 'text-orange-700'  },
      { label: '90+ days',     min: 91, max: Infinity,  bar: 'bg-red-500',     bg: 'bg-red-50',     border: 'border-red-100',     text: 'text-red-700'     },
    ];
    return buckets.map(b => {
      const inBucket = available.filter(u => {
        if (!u.dateIn) return false;
        const age = Math.floor((Date.now() - new Date(u.dateIn).getTime()) / 86400000);
        return age >= b.min && age <= b.max;
      });
      return { ...b, count: inBucket.length, value: inBucket.reduce((s, u) => s + u.buyPrice, 0) };
    });
  }, [available]);

  // ── Sales Calendar Heatmap (last 13 weeks) ───────────────────────────────
  const heatmapWeeks = useMemo(() => {
    const salesByDate: Record<string, number> = {};
    for (const u of sold) {
      const d = u.saleDate || u.dateIn;
      if (d) salesByDate[d] = (salesByDate[d] || 0) + 1;
    }
    const maxVal = Math.max(...Object.values(salesByDate), 1);

    // End on last complete Sunday
    const end = new Date(todayStr);
    end.setDate(end.getDate() - end.getDay());

    const weeks: { date: string; count: number; label: string }[][] = [];
    for (let w = 12; w >= 0; w--) {
      const week: { date: string; count: number; label: string }[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(end);
        day.setDate(end.getDate() - w * 7 + d);
        const dateStr = day.toISOString().split('T')[0];
        week.push({
          date:  dateStr,
          count: salesByDate[dateStr] || 0,
          label: day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        });
      }
      weeks.push(week);
    }
    return { weeks, maxVal };
  }, [sold, todayStr]);

  // ── Reorder Alerts ───────────────────────────────────────────────────────
  const reorderAlerts = useMemo(() => {
    const velocityMap: Record<string, number> = {};
    for (const m of modelVelocity) velocityMap[m.model] = m.avgDays;

    const map: Record<string, { sold: number; inStock: number }> = {};
    for (const u of sold) {
      if (!map[u.model]) map[u.model] = { sold: 0, inStock: 0 };
      map[u.model].sold++;
    }
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { sold: 0, inStock: 0 };
      map[u.model].inStock++;
    }
    return Object.entries(map)
      .map(([model, m]) => ({
        model,
        ...m,
        sellThrough: Math.round(m.sold / (m.sold + m.inStock) * 100),
        avgDays:     velocityMap[model] ?? null,
      }))
      .filter(m => m.sellThrough >= 65 && m.inStock <= 3 && m.sold >= 2)
      .sort((a, b) => {
        if (a.inStock !== b.inStock) return a.inStock - b.inStock;
        return b.sellThrough - a.sellThrough;
      })
      .slice(0, 15);
  }, [sold, available, modelVelocity]);

  // ── Supplier Performance ─────────────────────────────────────────────────
  const supplierPerf = useMemo(() => {
    const map: Record<string, { name: string; bought: number; soldCount: number; totalDays: number; withDate: number }> = {};
    for (const u of units) {
      if (!map[u.supplierId]) map[u.supplierId] = { name: supplierMap[u.supplierId] || 'Unknown', bought: 0, soldCount: 0, totalDays: 0, withDate: 0 };
      map[u.supplierId].bought++;
      if (u.status === 'sold') {
        map[u.supplierId].soldCount++;
        if (u.saleDate && u.dateIn) {
          map[u.supplierId].totalDays += Math.max(0,
            (new Date(u.saleDate).getTime() - new Date(u.dateIn).getTime()) / 86400000,
          );
          map[u.supplierId].withDate++;
        }
      }
    }
    return Object.values(map)
      .filter(s => s.bought > 0)
      .map(s => ({
        name:          s.name,
        bought:        s.bought,
        soldCount:     s.soldCount,
        inStock:       s.bought - s.soldCount,
        sellThrough:   Math.round(s.soldCount / s.bought * 100),
        avgDaysToSell: s.withDate ? Math.round(s.totalDays / s.withDate) : null,
      }))
      .sort((a, b) => b.sellThrough - a.sellThrough);
  }, [units, supplierMap]);

  // ── Heatmap cell colour ──────────────────────────────────────────────────
  function heatColor(count: number, max: number) {
    if (count === 0) return 'bg-gray-100';
    const ratio = count / max;
    if (ratio < 0.25) return 'bg-emerald-200';
    if (ratio < 0.5)  return 'bg-emerald-400';
    if (ratio < 0.75) return 'bg-emerald-600';
    return 'bg-emerald-800';
  }

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="space-y-5 pb-24 md:pb-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
            <span className="w-8 h-8 bg-violet-100 rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-violet-700" />
            </span>
            Insights
          </h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
            Velocity · Demand · Aging · Platform Intelligence
          </p>
        </div>
        {/* Period toggle */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {([7, 30, 90] as Period[]).map(d => (
            <button key={d} onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${
                period === d ? 'bg-white shadow-sm text-black' : 'text-gray-400 hover:text-gray-600'
              }`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* ── 1. SALES VELOCITY TREND ── */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-start justify-between">
          <div>
            <p className="text-[9px] font-mono uppercase tracking-widest text-gray-400">Units Sold · Last {period} Days</p>
            <div className="flex items-baseline gap-3 mt-1">
              <p className="text-4xl font-bold font-display tracking-tighter">{totalSoldInPeriod}</p>
              <p className="text-xs text-gray-400 font-mono">units</p>
              {periodDelta !== null && (
                <span className={`flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${
                  periodDelta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                }`}>
                  {periodDelta >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                  {periodDelta >= 0 ? '+' : ''}{periodDelta}% vs prev
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="h-40 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="velocityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#000" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#000" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
              <XAxis dataKey="label" fontSize={7} tickLine={false} axisLine={false} stroke="#aaa"
                interval={period === 7 ? 0 : period === 30 ? 5 : 13}
              />
              <YAxis fontSize={7} tickLine={false} axisLine={false} stroke="#aaa" allowDecimals={false}/>
              <Tooltip
                contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e5e7eb' }}
                formatter={(v: number) => [`${v} units`, 'Sold']}
              />
              <Area type="monotone" dataKey="units" stroke="#000" strokeWidth={2}
                fill="url(#velocityGrad)" dot={false} activeDot={{ r: 3, fill: '#000' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 2. PLATFORM SCORECARD ── */}
      <CollapsibleSection title="Platform Scorecard" accent="border-l-amber-400" defaultOpen={true}>
        <div className="p-4 space-y-4">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2">
            {platformStats.map(p => (
              <div key={p.platform} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest">{p.platform}</span>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PLATFORM_HEX[p.platform] || '#aaa' }}/>
                </div>
                <p className="text-2xl font-bold font-display leading-tight">{p.count}</p>
                <p className="text-[8px] font-mono text-gray-400 mb-2">units sold</p>
                <div className="flex gap-4 border-t border-gray-100 pt-2">
                  <div>
                    <p className="text-[10px] font-bold font-mono">£{p.avgSalePrice}</p>
                    <p className="text-[7px] text-gray-400 font-mono uppercase">avg price</p>
                  </div>
                  <div>
                    <p className={`text-[10px] font-bold font-mono ${
                      p.avgDaysToSell === null ? 'text-gray-400'
                      : p.avgDaysToSell <= 14  ? 'text-emerald-600'
                      : p.avgDaysToSell <= 30  ? 'text-amber-600'
                      : 'text-red-600'
                    }`}>
                      {p.avgDaysToSell !== null ? `${p.avgDaysToSell}d` : '—'}
                    </p>
                    <p className="text-[7px] text-gray-400 font-mono uppercase">avg to sell</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Bar chart */}
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platformStats} barSize={30} margin={{ top: 0, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false}/>
                <XAxis dataKey="platform" fontSize={8} tickLine={false} axisLine={false}/>
                <YAxis fontSize={8} tickLine={false} axisLine={false} allowDecimals={false}/>
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e5e7eb' }}
                  formatter={(v: number) => [`${v}`, 'Units Sold']}
                />
                <Bar dataKey="count" name="Units Sold" radius={[4, 4, 0, 0]}>
                  {platformStats.map(p => (
                    <Cell key={p.platform} fill={PLATFORM_HEX[p.platform] || '#6b7280'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CollapsibleSection>

      {/* ── 3. FAST vs SLOW MOVERS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {/* Fast Movers */}
        <CollapsibleSection
          title="Fast Movers"
          count={fastMovers.length}
          meta="≤ 14d avg"
          accent="border-l-emerald-500"
          defaultOpen={true}
        >
          {fastMovers.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-gray-300">
              <Zap size={24}/>
              <p className="text-[10px] font-mono">Need more sales data</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {fastMovers.map((m, i) => (
                <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`text-[9px] font-mono font-bold w-5 flex-shrink-0 ${i < 3 ? 'text-emerald-600' : 'text-gray-300'}`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{m.model}</p>
                    <p className="text-[8px] font-mono text-gray-400 mt-0.5">
                      {m.sold} sold · {m.inStock} in stock · {m.sellThrough}% ST
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-emerald-600">{m.avgDays}d</p>
                    <p className="text-[7px] font-mono text-gray-400">avg</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {/* Slow Movers */}
        <CollapsibleSection
          title="Slow Movers"
          count={slowMovers.length}
          meta="> 30d avg"
          accent="border-l-red-400"
          defaultOpen={true}
        >
          {slowMovers.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-gray-300">
              <Clock size={24}/>
              <p className="text-[10px] font-mono">No slow movers yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {slowMovers.map((m, i) => (
                <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-[9px] font-mono font-bold w-5 flex-shrink-0 text-gray-300">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate">{m.model}</p>
                    <p className="text-[8px] font-mono text-gray-400 mt-0.5">
                      {m.sold} sold · {m.inStock} in stock · {m.sellThrough}% ST
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-red-500">{m.avgDays}d</p>
                    <p className="text-[7px] font-mono text-gray-400">avg</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>

      {/* ── 4. AGED STOCK DISTRIBUTION ── */}
      <CollapsibleSection
        title="Aged Stock"
        count={available.length}
        meta={`${available.length} units`}
        accent="border-l-orange-400"
        defaultOpen={true}
      >
        <div className="p-4 space-y-3">
          {agedBuckets.map(b => {
            const pct = available.length > 0 ? Math.round(b.count / available.length * 100) : 0;
            return (
              <div key={b.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${b.bar}`}/>
                    <span className="text-[10px] font-bold font-mono">{b.label}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-[9px] font-mono text-gray-400">£{b.value.toLocaleString()}</span>
                    <span className="text-[10px] font-bold w-12 text-right">{b.count} units</span>
                    <span className="text-[8px] font-mono text-gray-400 w-7 text-right">{pct}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${b.bar} rounded-full transition-all duration-700`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {agedBuckets[3].count > 0 && (
            <div className="mt-2 bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle size={13} className="text-red-500 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="text-[9px] font-bold text-red-700 uppercase tracking-widest">Action Required</p>
                <p className="text-[9px] text-red-600 font-mono mt-0.5 leading-relaxed">
                  {agedBuckets[3].count} units unsold 90+ days · consider a price drop or platform change.
                </p>
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* ── 5. SALES CALENDAR HEATMAP ── */}
      <CollapsibleSection title="Sales Calendar · Last 13 Weeks" accent="border-l-blue-400" defaultOpen={false}>
        <div className="p-4">
          <div className="flex gap-1">
            {/* Day labels */}
            <div className="flex flex-col gap-0.5 mr-1 mt-0">
              {DAY_LABELS.map((l, i) => (
                <div key={i} className="w-3 h-4 flex items-center justify-end">
                  <span className="text-[7px] font-mono text-gray-300">{i % 2 === 1 ? l : ''}</span>
                </div>
              ))}
            </div>
            {/* Week columns */}
            <div className="flex gap-0.5 overflow-x-auto pb-1">
              {heatmapWeeks.weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.5">
                  {week.map((day, di) => (
                    <div
                      key={di}
                      title={`${day.label}: ${day.count} sold`}
                      className={`w-4 h-4 rounded-sm cursor-default transition-opacity hover:opacity-70 ${heatColor(day.count, heatmapWeeks.maxVal)}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[8px] font-mono text-gray-400">Less</span>
            {['bg-gray-100', 'bg-emerald-200', 'bg-emerald-400', 'bg-emerald-600', 'bg-emerald-800'].map((c, i) => (
              <div key={i} className={`w-3 h-3 rounded-sm ${c}`}/>
            ))}
            <span className="text-[8px] font-mono text-gray-400">More</span>
          </div>
        </div>
      </CollapsibleSection>

      {/* ── 6. REORDER ALERTS ── */}
      {reorderAlerts.length > 0 && (
        <CollapsibleSection
          title="Reorder Alerts"
          count={reorderAlerts.length}
          meta="High ST · Low stock"
          accent="border-l-red-500"
          defaultOpen={true}
        >
          <div className="divide-y divide-gray-50">
            {reorderAlerts.map(m => (
              <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={12} className="text-red-500"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{m.model}</p>
                  <p className="text-[8px] font-mono text-gray-400 mt-0.5">
                    {m.soldCount} sold · {m.sellThrough}% sell-through
                    {m.avgDays !== null ? ` · ${m.avgDays}d avg sell` : ''}
                  </p>
                </div>
                <span className={`text-[9px] font-bold px-2 py-1 rounded-lg flex-shrink-0 ${
                  m.inStock === 0
                    ? 'bg-red-100 text-red-700'
                    : m.inStock <= 1
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {m.inStock === 0 ? 'OUT' : `${m.inStock} left`}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── 7. SUPPLIER PERFORMANCE ── */}
      {supplierPerf.length > 0 && (
        <CollapsibleSection
          title="Supplier Performance"
          count={supplierPerf.length}
          accent="border-l-indigo-400"
          defaultOpen={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[9px] font-mono uppercase text-gray-400">Supplier</th>
                  <th className="text-right px-3 py-2.5 text-[9px] font-mono uppercase text-gray-400">Bought</th>
                  <th className="text-right px-3 py-2.5 text-[9px] font-mono uppercase text-gray-400">Sold</th>
                  <th className="text-right px-3 py-2.5 text-[9px] font-mono uppercase text-gray-400">In Stock</th>
                  <th className="text-right px-3 py-2.5 text-[9px] font-mono uppercase text-gray-400">Sell-Thru</th>
                  <th className="text-right px-3 py-2.5 text-[9px] font-mono uppercase text-gray-400">Avg Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {supplierPerf.map(s => (
                  <tr key={s.name} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-semibold max-w-[150px] truncate">{s.name}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.bought}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.soldCount}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{s.inStock}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        s.sellThrough >= 70 ? 'bg-emerald-100 text-emerald-700'
                        : s.sellThrough >= 40 ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                      }`}>
                        {s.sellThrough}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                      {s.avgDaysToSell !== null ? `${s.avgDaysToSell}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
            <p className="text-[8px] font-mono text-gray-400 uppercase tracking-widest">
              Sell-thru = units sold ÷ total units received · Avg days = stock-in to sale date
            </p>
          </div>
        </CollapsibleSection>
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
