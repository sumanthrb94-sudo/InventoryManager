import React, { useState, useMemo } from 'react';
import { BarChart2, Star, FileText, Receipt, Download } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, Sale } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { recomputeSale } from '../lib/recomputeSale';
import { buildDedupeIndex } from '../lib/unifiedSales';
import CopyImei from './CopyImei';
import PDFReportButton from './PDFReportButton';
import ExcelReportButton from './ExcelReportButton';
import {
  calcSaleFinancials, getMarketplaceFee, marketplaceFromListingSite,
  DEFAULT_MARKETPLACE_FEES,
} from '../lib/platforms';
import type { Marketplace } from '../types';
import { MARKETPLACES } from '../types';

// ── Master-aligned helpers ────────────────────────────────────────────────
// All previously-legacy `calcNetProfit`/`platformTotalFee`/`platformCommission`/
// `PLATFORMS`/`PLATFORM_LIST`/`DEFAULT_POSTAGE_COST` callers now route through
// `calcSaleFinancials` so commission rates match the operator's SALES_REPORT
// master file (eBay 6.9% / Amazon 7.14% / OnBuy 7% / BM 12% — not the old
// 12.8 / 8 / 9 / 10 numbers).
type PlatformLabel = 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket' | 'Temu';
const PLATFORM_LABELS: readonly PlatformLabel[] = ['eBay', 'Amazon', 'OnBuy', 'Backmarket', 'Temu'];
const PLATFORM_TO_MARKETPLACE: Record<PlatformLabel, Marketplace> = {
  eBay: 'EBAY',
  Amazon: 'AMAZON',
  OnBuy: 'ONBUY',
  Backmarket: 'BM',
  Temu: 'TEMU',
};
const PLATFORM_BADGE: Record<PlatformLabel, string> = {
  eBay:       'bg-yellow-100 text-yellow-800 border-yellow-200',
  Amazon:     'bg-orange-100 text-orange-800 border-orange-200',
  OnBuy:      'bg-blue-100 text-blue-800 border-blue-200',
  Backmarket: 'bg-green-100 text-green-800 border-green-200',
  Temu:       'bg-pink-100 text-pink-800 border-pink-200',
};

/** Resolve a free-text platform string to a Marketplace enum value. */
function resolveMarketplace(platform: string | undefined | null): Marketplace | undefined {
  if (!platform) return undefined;
  return marketplaceFromListingSite(platform);
}

/** Master-aligned platform fee for one sale (commission + fixed-fee bundle). */
function platformFeeFor(platform: string | undefined, salePrice: number, buyPrice = 0): number {
  const mp = resolveMarketplace(platform);
  if (!mp) return 0;
  const f = calcSaleFinancials({ marketplace: mp, buyPrice, salePrice });
  // EBAY emits the full "T.COM" (com + ROF + FVF + 20% bundle); the others
  // only have a flat commission. Pick whichever the marketplace populates.
  return f.totalCom ?? f.commission ?? 0;
}

/** Master-aligned net profit for a sale row. */
function netProfitFor(
  platform: string | undefined,
  salePrice: number,
  buyPrice: number,
  postageOverride?: number,
): number {
  const mp = resolveMarketplace(platform);
  if (!mp) {
    // Unknown platform — fall back to SP - BP - postage with the legacy £8 default.
    const postage = postageOverride ?? 8;
    return +(salePrice - buyPrice - postage).toFixed(2);
  }
  const f = calcSaleFinancials({
    marketplace: mp,
    buyPrice,
    salePrice,
    postageOverride,
  });
  // EBAY exposes `netProfit` (GP - 5% promo); others use `grossProfit`.
  return f.netProfit ?? f.grossProfit;
}

/** Default postage for a row — marketplace-specific, with a generic £8 fallback. */
function defaultPostageFor(platform: string | undefined): number {
  const mp = resolveMarketplace(platform);
  return mp ? getMarketplaceFee(mp).postage : 8;
}

/** Master commission % shown in the legacy fee tables (6.9 / 7.14 / 7 / 12). */
function commissionPctFor(platform: string | undefined): number {
  const mp = resolveMarketplace(platform);
  return mp ? getMarketplaceFee(mp).commissionPct : 0;
}

type ReportTab = 'daily' | 'stock';

// ── CSV export helper ─────────────────────────────────────────────────────────
function exportCSV(filename: string, rows: Record<string, string | number | undefined>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = r[h] ?? '';
        return typeof v === 'string' && (v.includes(',') || v.includes('"'))
          ? `"${v.replace(/"/g, '""')}"`
          : v;
      }).join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportingPage() {
  const { units, suppliers, sales, accessoryStock } = useInventoryStore();
  const [tab, setTab]           = useState<ReportTab>('daily');
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().split('T')[0]);

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of suppliers) m[s.id] = s.name;
    return m;
  }, [suppliers]);

  const available = useMemo(() => units.filter(u => u.status === 'available'), [units]);
  const sold      = useMemo(() => units.filter(u => u.status === 'sold'), [units]);

  // ── Unified sales feed ──────────────────────────────────────────────────
  // Master-file `sales` collection is the source of truth. Each row is
  // recomputed live so commission/GP reflect current MARKETPLACE_FEES.
  // Legacy in-app sold units (no matching `sales` doc) are merged in so the
  // report stays correct during the migration window.
  const liveSales = useMemo<Sale[]>(() => sales.map(recomputeSale), [sales]);

  const allSalesUnified = useMemo<{
    rows: Array<{
      // Common projection used by the report grids/export
      date: string;            // ISO yyyy-mm-dd
      model: string;
      imei: string;
      orderNumber: string;
      buyPrice: number;
      salePrice: number;
      platform: string;        // human-readable platform label (eBay/Amazon/...)
      postageCost: number;
      grossProfit?: number;    // present for sales-collection rows (live recompute)
      _src: 'sale' | 'unit';
      _id: string;
    }>;
  }>(() => {
    const rows: any[] = [];
    // Map marketplace codes → friendly labels resolved back into MARKETPLACES
    // via marketplaceFromListingSite() when fees are calculated downstream.
    const mkToPlatform: Record<string, string> = {
      EBAY: 'eBay', AMAZON: 'Amazon', BM: 'Backmarket', ONBUY: 'OnBuy',
    };
    const unitById = new Map<string, InventoryUnit>();
    for (const u of units) unitById.set(u.id, u);
    // Accessory sales never link a unit — fall back to the live pool's
    // friendly name instead of raw SKU text when one matches.
    const accessoryBySku = new Map<string, string>();
    for (const a of accessoryStock) accessoryBySku.set(a.sku.trim().toUpperCase(), a.name);
    // A synthesised legacy-unit row's id IS the unit id, but a Sale doc's id
    // is `marketplace__orderNumber__imei` — the two id spaces never collide,
    // so comparing a unit id against a Set of sale ids never once caught a
    // duplicate. Every imported sale that also matched a unit was counted
    // twice (101 sales + 93 sold units → 194 rows, revenue inflated to
    // match). buildDedupeIndex (unifiedSales.ts) indexes the sale doc's
    // unitId and marketplace+orderNumber too, which is what actually catches
    // a unit already represented by a sale.
    const index = buildDedupeIndex(liveSales);
    for (const s of liveSales) {
      const u = s.unitId ? unitById.get(s.unitId) : undefined;
      const accessoryName = !u && s.sku ? accessoryBySku.get(s.sku.trim().toUpperCase()) : undefined;
      rows.push({
        date:        s.saleDate || '',
        model:       u?.model || accessoryName || s.sku || '',
        imei:        s.imei || u?.imei || '',
        orderNumber: s.orderNumber || '',
        buyPrice:    s.buyPrice || 0,
        salePrice:   s.salePrice || 0,
        platform:    mkToPlatform[s.marketplace] || s.marketplace || '',
        postageCost: s.postage ?? defaultPostageFor(mkToPlatform[s.marketplace]),
        grossProfit: s.grossProfit,
        _src: 'sale',
        _id:  s.id,
      });
    }
    // Legacy in-app sold units that don't already have a `sales` doc —
    // matched on unit id first (the load-bearing check), then falling back
    // to marketplace+orderNumber for the rare sale doc with no unitId set.
    for (const u of sold) {
      if (index.unitIds.has(u.id)) continue;
      const unitMarketplace = marketplaceFromListingSite(u.salePlatform || '');
      if (u.saleOrderId && unitMarketplace && index.keys.has(`${unitMarketplace}__${u.saleOrderId}`)) continue;
      rows.push({
        date:        u.saleDate || u.dateIn || '',
        model:       u.model,
        imei:        u.imei,
        orderNumber: u.saleOrderId || '',
        buyPrice:    u.buyPrice,
        salePrice:   u.salePrice || 0,
        platform:    u.salePlatform || '',
        postageCost: u.postageCost ?? defaultPostageFor(u.salePlatform),
        _src: 'unit',
        _id:  u.id,
      });
    }
    return { rows };
  }, [liveSales, sold, units, accessoryStock]);

  // Daily sales for selected date (sourced from unified feed)
  const dailySales = useMemo(
    () => allSalesUnified.rows.filter(r => r.date === dateFilter),
    [allSalesUnified, dateFilter],
  );

  const dailyRevenue = dailySales.reduce((s, r) => s + (r.salePrice || 0), 0);
  const dailyGrossProfit = dailySales.reduce((s, r) => s + ((r.salePrice || 0) - r.buyPrice), 0);
  const dailyNetProfit = dailySales.reduce((s, r) =>
    s + (r.grossProfit ?? netProfitFor(r.platform, r.salePrice || 0, r.buyPrice, r.postageCost)), 0);


  // Per-model stock report
  const modelReport = useMemo(() => {
    const map: Record<string, {
      model: string; inStock: number; stockValue: number;
      colours: Set<string>; supplierIds: Set<string>; dateIn: string;
      soldCount: number; revenue: number; cogs: number; netProfit: number;
    }> = {};

    for (const u of available) {
      if (!map[u.model]) map[u.model] = {
        model: u.model, inStock: 0, stockValue: 0,
        colours: new Set(), supplierIds: new Set(), dateIn: u.dateIn,
        soldCount: 0, revenue: 0, cogs: 0, netProfit: 0,
      };
      map[u.model].inStock++;
      map[u.model].stockValue += u.buyPrice;
      map[u.model].colours.add(u.colour);
      map[u.model].supplierIds.add(u.supplierId);
      if (u.dateIn < map[u.model].dateIn) map[u.model].dateIn = u.dateIn;
    }
    for (const u of sold) {
      if (!map[u.model]) map[u.model] = {
        model: u.model, inStock: 0, stockValue: 0,
        colours: new Set(), supplierIds: new Set(), dateIn: u.dateIn,
        soldCount: 0, revenue: 0, cogs: 0, netProfit: 0,
      };
      map[u.model].soldCount++;
      map[u.model].revenue += (u.salePrice || 0);
      map[u.model].cogs += u.buyPrice;
      map[u.model].netProfit += netProfitFor(
        u.salePlatform, u.salePrice || 0, u.buyPrice, u.postageCost,
      );
    }

    return Object.values(map).map(m => ({
      ...m,
      margin: m.revenue - m.cogs,
      sellThrough: m.soldCount + m.inStock > 0
        ? Math.round(m.soldCount / (m.soldCount + m.inStock) * 100)
        : 0,
      supplierNames: [...m.supplierIds].map(id => supplierMap[id] || 'Unknown').join(', '),
    })).sort((a, b) => b.stockValue - a.stockValue);
  }, [available, sold, supplierMap]);

  const totalInventoryValue = available.reduce((s, u) => s + u.buyPrice, 0);
  const quickSale = [...modelReport]
    .filter(m => m.soldCount >= 2)
    .sort((a, b) => b.sellThrough - a.sellThrough)
    .slice(0, 10);

  const TABS: { key: ReportTab; label: string }[] = [
    // Sales Log moved out — it duplicated Admin → Sales History row for row.
    // VAT Returns moved out — it was a SECOND VAT engine, on a rolling
    // 90-day window that matches no filing period, with platform fees
    // recomputed locally instead of using the fees actually imported from
    // the marketplace. Admin → Money → VAT is the single VAT figure now.
    { key: 'daily', label: 'Daily Sales' },
    { key: 'stock', label: 'Stock Report' },
  ];

  // ── CSV exports ────────────────────────────────────────────────────────────
  const exportDailySales = () => exportCSV(`daily-sales-${dateFilter}.csv`,
    dailySales.map(r => ({
      Date: r.date,
      Model: r.model,
      IMEI: r.imei,
      'Order Number': r.orderNumber || '',
      'Buy Price £': r.buyPrice,
      'Sale Price £': r.salePrice || 0,
      'Gross Margin £': (r.salePrice || 0) - r.buyPrice,
      'Platform Fee £': platformFeeFor(r.platform, r.salePrice || 0, r.buyPrice),
      'Postage £': r.postageCost ?? defaultPostageFor(r.platform),
      'Net Profit £': r.grossProfit ?? netProfitFor(r.platform, r.salePrice || 0, r.buyPrice, r.postageCost),
      Platform: r.platform || '',
      'Commission %': commissionPctFor(r.platform),
    }))
  );

  const exportStockReport = () => exportCSV(`stock-report-${new Date().toISOString().split('T')[0]}.csv`,
    modelReport.filter(m => m.inStock > 0).map(m => ({
      Model: m.model,
      'Qty Available': m.inStock,
      'Avg BP £': m.inStock > 0 ? Math.round(m.stockValue / m.inStock) : 0,
      'Stock Value £': m.stockValue,
      Colours: [...m.colours].join('; '),
      Supplier: m.supplierNames,
      'Sold Count': m.soldCount,
      'Sell Through %': m.sellThrough,
      'Total Net Profit £': Math.round(m.netProfit),
    }))
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tighter uppercase font-display flex items-center gap-3">
            <span className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
              <BarChart2 size={16} className="text-purple-700" />
            </span>
            Reporting
          </h2>
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
            Daily Sales · Stock Value · CSV exports
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelReportButton units={units} suppliers={suppliers} variant="outline" />
          <PDFReportButton units={units} suppliers={suppliers} variant="outline" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white border border-gray-100 shadow-sm rounded-3xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-gray-400">Inventory</p>
          <p className="text-xl font-bold font-display mt-1">£{(totalInventoryValue / 1000).toFixed(1)}k</p>
          <p className="text-[8px] text-gray-400 font-mono">{available.length} units</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-3xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-green-600">Revenue</p>
          <p className="text-xl font-bold font-display mt-1 text-green-700">
            £{(allSalesUnified.rows.reduce((s, r) => s + (r.salePrice || 0), 0) / 1000).toFixed(1)}k
          </p>
          <p className="text-[8px] text-green-500 font-mono">{allSalesUnified.rows.length} sold</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all ${
              tab === t.key ? 'bg-white shadow-sm text-black' : 'text-gray-400 hover:text-gray-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DAILY SALES ──────────────────────────────────────────────────────── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-black" />
            <div className="flex gap-3 ml-auto flex-wrap">
              <div className="text-right">
                <p className="text-[8px] font-mono text-gray-400 uppercase">Revenue</p>
                <p className="text-base font-bold text-green-600">£{dailyRevenue.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[8px] font-mono text-gray-400 uppercase">Gross Margin</p>
                <p className="text-base font-bold text-blue-600">£{dailyGrossProfit.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-[8px] font-mono text-gray-400 uppercase">Net Profit</p>
                <p className={`text-base font-bold ${dailyNetProfit >= 0 ? 'text-purple-600' : 'text-red-600'}`}>
                  £{dailyNetProfit.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[8px] font-mono text-gray-400 uppercase">Units</p>
                <p className="text-base font-bold">{dailySales.length}</p>
              </div>
            </div>
          </div>

          {/* Platform commission breakdown */}
          <div className="grid grid-cols-2 gap-2">
            {PLATFORM_LABELS.map(p => {
              const mp = PLATFORM_TO_MARKETPLACE[p];
              const fee = getMarketplaceFee(mp);
              const badge = PLATFORM_BADGE[p];
              const pSales = dailySales.filter(r => r.platform === p);
              const rev = pSales.reduce((s, r) => s + (r.salePrice || 0), 0);
              const totalFee = pSales.reduce((s, r) => s + platformFeeFor(p, r.salePrice || 0, r.buyPrice), 0);
              const fixedFeeLabel = fee.fixedFee ? ` + £${fee.fixedFee}` : '';
              return (
                <div key={p} className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${badge}`}>
                  <div>
                    <p className="text-[10px] font-bold">{p}</p>
                    <p className="text-[8px] font-mono opacity-70">{fee.commissionPct}%{fixedFeeLabel} · {pSales.length} units</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">£{rev.toLocaleString()}</p>
                    {totalFee > 0 && <p className="text-[8px] font-mono opacity-70">-£{totalFee.toFixed(2)} fees</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Sales for {dateFilter}</p>
              <button onClick={exportDailySales}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all">
                <Download size={11} /> Export CSV
              </button>
            </div>
            {dailySales.length === 0 ? (
              <p className="text-center text-gray-400 font-mono text-xs py-10">No sales on this date</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                      <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">IMEI</th>
                      <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Order #</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">BP</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">SP</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Fee+Post</th>
                      <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Net</th>
                      <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Platform</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dailySales.map(r => {
                      const sp = r.salePrice || 0;
                      const post = r.postageCost ?? defaultPostageFor(r.platform);
                      const fee = platformFeeFor(r.platform, sp, r.buyPrice);
                      const net = r.grossProfit ?? netProfitFor(r.platform, sp, r.buyPrice, r.postageCost);
                      return (
                        <tr key={r._id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-semibold max-w-[120px] truncate">{r.model}</td>
                          <td className="px-3 py-2.5"><CopyImei imei={r.imei} truncate={10} /></td>
                          <td className="px-3 py-2.5 font-mono text-gray-500 text-[9px]">{r.orderNumber || '—'}</td>
                          <td className="px-3 py-2.5 text-right font-mono">£{r.buyPrice}</td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold">£{sp}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-red-500 text-[9px]">-£{(fee + post).toFixed(2)}</td>
                          <td className={`px-3 py-2.5 text-right font-mono font-bold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {net >= 0 ? '+' : ''}£{Math.round(net)}
                          </td>
                          <td className="px-3 py-2.5 text-[10px]">{r.platform || '—'}</td>
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
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Star size={13} className="text-amber-500" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Top 10 Quick-Sale · Order Priority</p>
              </div>
              <div className="divide-y divide-gray-50">
                {quickSale.map((m, i) => (
                  <div key={m.model} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`text-[10px] font-mono font-bold w-5 ${i < 3 ? 'text-amber-500' : 'text-gray-400'}`}>{String(i + 1).padStart(2, '0')}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">{m.model}</p>
                      <p className="text-[9px] text-gray-400 font-mono">
                        {m.soldCount} sold · £{m.soldCount > 0 ? Math.round(m.netProfit / m.soldCount) : 0} avg net
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-600">{m.sellThrough}%</p>
                      <p className="text-[8px] text-gray-400 font-mono">sell-thru</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── STOCK REPORT ─────────────────────────────────────────────────────── */}
      {tab === 'stock' && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Stock Availability · All Models
            </p>
            <div className="flex items-center gap-3">
              <span className="text-[9px] font-mono text-gray-400">Total: £{totalInventoryValue.toLocaleString()}</span>
              <button onClick={exportStockReport}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all">
                <Download size={11} /> CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Qty</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Avg BP</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Value</th>
                  <th className="text-left px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Colours</th>
                  <th className="text-left px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Supplier</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">Sold</th>
                  <th className="text-right px-2 py-2 text-[9px] font-mono uppercase text-gray-400">ST%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {modelReport.filter(m => m.inStock > 0).map(m => (
                  <tr key={m.model} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-semibold max-w-[130px] truncate">{m.model}</td>
                    <td className="px-2 py-2 text-right font-mono font-bold">{m.inStock}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-600">
                      £{m.inStock > 0 ? Math.round(m.stockValue / m.inStock) : 0}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-blue-700">£{m.stockValue.toLocaleString()}</td>
                    <td className="px-2 py-2 text-[9px] text-gray-500 font-mono max-w-[80px] truncate">
                      {[...m.colours].join(', ')}
                    </td>
                    <td className="px-2 py-2 text-[9px] text-gray-500 font-mono max-w-[90px] truncate">
                      {m.supplierNames || '—'}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{m.soldCount}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        m.sellThrough >= 70 ? 'bg-emerald-100 text-emerald-700' :
                        m.sellThrough >= 40 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{m.sellThrough}%</span>
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

      {/* ── SALES LOG ────────────────────────────────────────────────────────── */}
    </div>
  );
}
