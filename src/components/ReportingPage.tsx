import React, { useState, useEffect, useMemo } from 'react';
import { BarChart2, TrendingUp, Star, AlertTriangle, FileText, Receipt } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit } from '../types';
import CopyImei from './CopyImei';
import { PLATFORMS, PLATFORM_LIST, platformCommission, platformCommissionAmt } from '../lib/platforms';


type ReportTab = 'daily' | 'stock' | 'sales' | 'vat';



export default function ReportingPage() {
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [tab, setTab] = useState<ReportTab>('daily');
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => { const u = dbService.subscribeToCollection('inventoryUnits', setUnits); return u; }, []);

  const available = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  const sold = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  // Daily sales for selected date
  const dailySales = useMemo(() =>
    sold.filter(u => u.saleDate === dateFilter || (!u.saleDate && u.dateIn === dateFilter)),
    [sold, dateFilter]);

  const dailyRevenue = dailySales.reduce((s, u) => s + (u.salePrice || 0), 0);
  const dailyProfit = dailySales.reduce((s, u) => s + ((u.salePrice || 0) - u.buyPrice), 0);

  // ── VAT MARGIN SCHEME (UK Second-Hand Goods) ──────────────────────────────
  // Only VAT on PROFIT MARGIN, not full sale price.
  // VAT = (SP - BP) × 1/6  — only if margin > 0
  // Source: HMRC VAT Notice 718 — Second-hand goods margin scheme
  const now = Date.now();
  const [vatPeriodDays, setVatPeriodDays] = React.useState(90);
  const vatSales = useMemo(() => sold.filter(u => {
    const d = u.saleDate || u.dateIn;
    return d && (now - new Date(d).getTime()) <= vatPeriodDays * 86400000;
  }), [sold, vatPeriodDays]);

  const vatData = useMemo(() => {
    let grossMargin = 0;       // total positive margins
    let eligibleSales = 0;     // count with positive margin
    let outputVAT = 0;         // VAT on margins (Box 1)
    let platformFeesTotal = 0; // platform commission paid
    let inputVAT = 0;          // VAT reclaimable on platform fees (Box 4)

    for (const u of vatSales) {
      const sp = u.salePrice || 0;
      const bp = u.buyPrice || 0;
      const margin = sp - bp;
      if (margin > 0) {
        const vatOnMargin = +(margin / 6).toFixed(2);
        outputVAT += vatOnMargin;
        grossMargin += margin;
        eligibleSales++;
      }
      // Platform fees include 20% VAT — reclaimable as input
      const commPct = platformCommission(u.salePlatform || '') / 100;
      const fee = +(sp * commPct).toFixed(2);
      const feeVAT = +(fee * 0.2 / 1.2).toFixed(2); // VAT element of fee
      platformFeesTotal += fee;
      inputVAT += feeVAT;
    }

    const netVATPayable = Math.max(0, +(outputVAT - inputVAT).toFixed(2));
    return { grossMargin, eligibleSales, outputVAT: +outputVAT.toFixed(2), inputVAT: +inputVAT.toFixed(2), netVATPayable, platformFeesTotal: +platformFeesTotal.toFixed(2) };
  }, [vatSales]);

  const vatRevenue = vatSales.reduce((s, u) => s + (u.salePrice || 0), 0);


  // Per-model stock report
  const modelReport = useMemo(() => {
    const map: Record<string, { model: string; inStock: number; stockValue: number; colours: Set<string>; suppliers: Set<string>; dateIn: string; soldCount: number; revenue: number; cogs: number }> = {};
    for (const u of available) {
      if (!map[u.model]) map[u.model] = { model: u.model, inStock: 0, stockValue: 0, colours: new Set(), suppliers: new Set(), dateIn: u.dateIn, soldCount: 0, revenue: 0, cogs: 0 };
      map[u.model].inStock++;
      map[u.model].stockValue += u.buyPrice;
      map[u.model].colours.add(u.colour);
      map[u.model].suppliers.add(u.supplierId);
      if (u.dateIn < map[u.model].dateIn) map[u.model].dateIn = u.dateIn;
    }
    for (const u of sold) {
      if (!map[u.model]) map[u.model] = { model: u.model, inStock: 0, stockValue: 0, colours: new Set(), suppliers: new Set(), dateIn: u.dateIn, soldCount: 0, revenue: 0, cogs: 0 };
      map[u.model].soldCount++;
      map[u.model].revenue += (u.salePrice || 0);
      map[u.model].cogs += u.buyPrice;
    }
    return Object.values(map).map(m => ({
      ...m,
      margin: m.revenue - m.cogs,
      sellThrough: m.soldCount + m.inStock > 0 ? Math.round(m.soldCount / (m.soldCount + m.inStock) * 100) : 0,
    })).sort((a, b) => b.stockValue - a.stockValue);
  }, [available, sold]);

  const totalInventoryValue = available.reduce((s, u) => s + u.buyPrice, 0);
  const quickSale = [...modelReport].filter(m => m.soldCount >= 2).sort((a, b) => b.sellThrough - a.sellThrough).slice(0, 10);

  const TABS: { key: ReportTab; label: string }[] = [
    { key: 'daily', label: 'Daily Sales' },
    { key: 'stock', label: 'Stock Report' },
    { key: 'sales', label: 'Sales Log' },
    { key: 'vat', label: 'VAT Returns' },
  ];

  return (
    <div className="space-y-5 pb-24 md:pb-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
          <span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center"><BarChart2 size={16} className="text-purple-700" /></span>
          Reporting
        </h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">Daily Sales · Stock Value · VAT Returns · Margin Insights</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-gray-400">Inventory</p>
          <p className="text-xl font-bold font-display mt-1">£{(totalInventoryValue/1000).toFixed(1)}k</p>
          <p className="text-[8px] text-gray-400 font-mono">{available.length} units</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-green-600">Revenue</p>
          <p className="text-xl font-bold font-display mt-1 text-green-700">£{(sold.reduce((s,u)=>s+(u.salePrice||0),0)/1000).toFixed(1)}k</p>
          <p className="text-[8px] text-green-500 font-mono">{sold.length} sold</p>
        </div>
        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-purple-600">VAT Due</p>
          <p className="text-xl font-bold font-display mt-1 text-purple-700">£{vatData.netVATPayable.toLocaleString()}</p>
          <p className="text-[8px] text-purple-400 font-mono">last 90 days</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${tab === t.key ? 'bg-white shadow-sm text-black' : 'text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* DAILY SALES */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black" />
            <div className="flex gap-3 ml-auto">
              <div className="text-right"><p className="text-[8px] font-mono text-gray-400 uppercase">Revenue</p><p className="text-base font-bold text-green-600">£{dailyRevenue.toLocaleString()}</p></div>
              <div className="text-right"><p className="text-[8px] font-mono text-gray-400 uppercase">Profit</p><p className="text-base font-bold text-purple-600">£{dailyProfit.toLocaleString()}</p></div>
              <div className="text-right"><p className="text-[8px] font-mono text-gray-400 uppercase">Units</p><p className="text-base font-bold">{dailySales.length}</p></div>
            </div>
          </div>

          {/* Platform commission breakdown */}
          <div className="grid grid-cols-2 gap-2">
            {PLATFORM_LIST.map(p => {
              const cfg = PLATFORMS[p];
              const pSales = dailySales.filter(u => u.salePlatform === p);
              const rev = pSales.reduce((s,u) => s+(u.salePrice||0), 0);
              const comm = +(rev * cfg.commission / 100).toFixed(2);
              return (
                <div key={p} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${cfg.badge}`}>
                  <div>
                    <p className="text-[10px] font-bold">{p}</p>
                    <p className="text-[8px] font-mono opacity-70">{cfg.commission}% comm · {pSales.length} units</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">£{rev.toLocaleString()}</p>
                    {comm > 0 && <p className="text-[8px] font-mono opacity-70">-£{comm} fees</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sales for {dateFilter}</p></div>
            {dailySales.length === 0 ? (
              <p className="text-center text-gray-400 font-mono text-xs py-10">No sales on this date</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                      <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">IMEI</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">BP</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">SP</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Margin</th>
                      <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Platform</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Comm%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dailySales.map(u => {
                      const m = (u.salePrice||0) - u.buyPrice;
                      const comm = platformCommission(u.salePlatform||'');
                      return (
                        <tr key={u.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-semibold max-w-[120px] truncate">{u.model}</td>
                          <td className="px-3 py-2.5"><CopyImei imei={u.imei} truncate={10} /></td>
                          <td className="px-3 py-2.5 text-right font-mono">£{u.buyPrice}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold">£{u.salePrice||0}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold ${m>=0?'text-green-600':'text-red-500'}`}>{m>=0?'+':''}£{m}</td>
                      <td className="px-3 py-2.5 text-[10px]">{u.salePlatform||'—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-gray-500">{platformCommission(u.salePlatform||'')>0?`${platformCommission(u.salePlatform||'')}%`:'—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {/* Quick-sale top 10 */}
          {quickSale.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Star size={13} className="text-amber-500" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Top 10 Quick-Sale · Order Priority</p>
              </div>
              <div className="divide-y divide-gray-50">
                {quickSale.map((m, i) => (
                  <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`text-[10px] font-mono font-bold w-5 ${i<3?'text-amber-500':'text-gray-400'}`}>{String(i+1).padStart(2,'0')}</span>
                    <div className="flex-1 min-w-0"><p className="text-xs font-bold truncate">{m.model}</p><p className="text-[9px] text-gray-400 font-mono">{m.soldCount} sold · £{Math.round(m.margin/m.soldCount)} avg margin</p></div>
                    <div className="text-right"><p className="text-sm font-bold text-emerald-600">{m.sellThrough}%</p><p className="text-[8px] text-gray-400 font-mono">sell-thru</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STOCK REPORT */}
      {tab === 'stock' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Stock Availability · All Models</p>
            <span className="text-[9px] font-mono text-gray-400">Total: £{totalInventoryValue.toLocaleString()}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Qty</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">BP Avg</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Value</th>
                  <th className="text-left px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Colours</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Sold</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">ST%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {modelReport.filter(m => m.inStock > 0).map(m => (
                  <tr key={m.model} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-semibold max-w-[130px] truncate">{m.model}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{m.inStock}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-600">£{m.inStock>0?Math.round(m.stockValue/m.inStock):0}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-blue-700">£{m.stockValue.toLocaleString()}</td>
                    <td className="px-2 py-2 text-[9px] text-gray-500 font-mono max-w-[80px] truncate">{[...m.colours].join(', ')}</td>
                    <td className="px-2 py-2 text-right font-mono">{m.soldCount}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${m.sellThrough>=70?'bg-emerald-100 text-emerald-700':m.sellThrough>=40?'bg-amber-100 text-amber-700':'bg-red-100 text-red-700'}`}>{m.sellThrough}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex justify-between">
            <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">Total Stock Value</span>
            <span className="text-sm font-bold">£{totalInventoryValue.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* SALES LOG */}
      {tab === 'sales' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Full Sales Log · {sold.length} records</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Date</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">IMEI</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Order #</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">SP</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Margin</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Platform</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Comm%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...sold].sort((a,b)=>new Date(b.saleDate||b.dateIn).getTime()-new Date(a.saleDate||a.dateIn).getTime()).map(u => {
                  const m = (u.salePrice||0) - u.buyPrice;
                  const comm = platformCommission(u.salePlatform||'');
                  const commAmt = platformCommissionAmt(u.salePlatform||'', u.salePrice||0);
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-gray-500">{u.saleDate||u.dateIn}</td>
                      <td className="px-3 py-2 font-semibold max-w-[110px] truncate">{u.model}</td>
                      <td className="px-3 py-2"><CopyImei imei={u.imei} truncate={9} /></td>
                      <td className="px-3 py-2 font-mono text-gray-500 text-[9px]">{u.saleOrderId||'—'}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">£{u.salePrice||0}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${m>=0?'text-green-600':'text-red-500'}`}>{m>=0?'+':''}£{m}</td>
                      <td className="px-3 py-2 text-[10px]">{u.salePlatform||'—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-500">{platformCommission(u.salePlatform||'')>0?`${platformCommission(u.salePlatform||'')}% / £${platformCommissionAmt(u.salePlatform||'', u.salePrice||0)}`:'—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VAT RETURNS — UK Margin Scheme */}
      {tab === 'vat' && (
        <div className="space-y-4">

          {/* Scheme explainer */}
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <span className="text-lg flex-shrink-0">⚖️</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800">VAT Margin Scheme Applied</p>
              <p className="text-[10px] text-amber-700 font-mono mt-1 leading-relaxed">
                As a UK second-hand phone reseller you use HMRC&apos;s <strong>Second-Hand Goods Margin Scheme (VAT Notice 718)</strong>.
                VAT is charged on your <strong>profit margin only</strong> (SP − BP) at 1/6 — not on the full sale price.
                Platform fees (eBay, Amazon, OnBuy, Backmarket) include 20% VAT which you can reclaim as input VAT.
              </p>
            </div>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">VAT Period</p>
            {[{l:'Monthly',d:30},{l:'Quarterly (90d)',d:90},{l:'6 Months',d:180}].map(o=>(
              <button key={o.d} onClick={()=>setVatPeriodDays(o.d)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${
                  vatPeriodDays===o.d?'bg-black text-white border-black':'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {o.l}
              </button>
            ))}
          </div>

          {/* HMRC-style VAT Return Summary */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-5">
              <Receipt size={16} className="text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">HMRC VAT Return Summary · Last {vatPeriodDays} Days</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">Box 1 — Output VAT</p>
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">VAT on your margins (1/6)</p>
                <p className="text-2xl font-bold font-display mt-2 text-yellow-300">£{vatData.outputVAT.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">Box 4 — Input VAT</p>
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">VAT on platform fees (reclaimable)</p>
                <p className="text-2xl font-bold font-display mt-2 text-emerald-300">£{vatData.inputVAT.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">Box 6 — Total Sales</p>
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">Gross revenue (ex-VAT)</p>
                <p className="text-xl font-bold font-display mt-2">£{vatRevenue.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">Box 7 — Total Purchases</p>
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">Platform fees paid</p>
                <p className="text-xl font-bold font-display mt-2">£{vatData.platformFeesTotal.toLocaleString()}</p>
              </div>
            </div>
            {/* Net payable highlight */}
            <div className="mt-4 bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-300">Net VAT Payable to HMRC</p>
                <p className="text-[9px] text-slate-400 font-mono mt-0.5">Box 1 minus Box 4</p>
              </div>
              <p className="text-3xl font-bold font-display text-yellow-300">£{vatData.netVATPayable.toLocaleString()}</p>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[8px] text-slate-500 font-mono">Eligible sales</p><p className="text-base font-bold">{vatData.eligibleSales}</p></div>
              <div><p className="text-[8px] text-slate-500 font-mono">Total margin</p><p className="text-base font-bold text-emerald-300">£{vatData.grossMargin.toLocaleString()}</p></div>
              <div><p className="text-[8px] text-slate-500 font-mono">Transactions</p><p className="text-base font-bold">{vatSales.length}</p></div>
            </div>
          </div>

          {/* Per-transaction breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Margin Scheme Transactions</p>
              <span className="text-[9px] font-mono text-gray-400">VAT = margin ÷ 6</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Date</th>
                    <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">BP</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">SP</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Margin</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">VAT (÷6)</th>
                    <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Fee VAT↩</th>
                    <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Platform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {vatSales.map(u => {
                    const sp = u.salePrice || 0;
                    const bp = u.buyPrice || 0;
                    const margin = sp - bp;
                    const vatOnMargin = margin > 0 ? +(margin / 6).toFixed(2) : 0;
                    const commPct = platformCommission(u.salePlatform || '') / 100;
                    const fee = +(sp * commPct).toFixed(2);
                    const feeVAT = +(fee * 0.2 / 1.2).toFixed(2);
                    return (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-gray-500 text-[9px]">{u.saleDate||u.dateIn}</td>
                        <td className="px-3 py-2 font-semibold max-w-[100px] truncate">{u.model}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">£{bp}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">£{sp}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${margin>=0?'text-green-600':'text-red-500'}`}>{margin>=0?'+':''}£{margin}</td>
                        <td className="px-3 py-2 text-right font-mono text-purple-600 font-bold">{vatOnMargin > 0 ? `£${vatOnMargin}` : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">{feeVAT > 0 ? `+£${feeVAT}` : '—'}</td>
                        <td className="px-3 py-2 text-[10px] text-gray-500">{u.salePlatform||'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-[9px] font-mono uppercase tracking-widest font-bold text-gray-600">Totals</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-green-700">£{vatData.grossMargin.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-purple-700">£{vatData.outputVAT.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-emerald-700">£{vatData.inputVAT.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-[9px] text-gray-400 font-mono text-center leading-relaxed px-4">
            ⚠️ This is an estimate based on the Second-Hand Goods Margin Scheme (HMRC VAT Notice 718).
            Consult your accountant before filing. VAT threshold: £90,000 rolling 12-month turnover (2024/25).
          </p>
        </div>
      )}
    </div>
  );
}
