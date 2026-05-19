import React, { useState, useMemo } from 'react';
import { BarChart2, Star, FileText, Receipt, Download } from 'lucide-react';
import { dbService } from '../lib/dbService';
import { InventoryUnit, Supplier, Sale } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { recomputeSale } from '../lib/recomputeSale';
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
type PlatformLabel = 'eBay' | 'Amazon' | 'OnBuy' | 'Backmarket';
const PLATFORM_LABELS: readonly PlatformLabel[] = ['eBay', 'Amazon', 'OnBuy', 'Backmarket'];
const PLATFORM_TO_MARKETPLACE: Record<PlatformLabel, Marketplace> = {
  eBay: 'EBAY',
  Amazon: 'AMAZON',
  OnBuy: 'ONBUY',
  Backmarket: 'BM',
};
const PLATFORM_BADGE: Record<PlatformLabel, string> = {
  eBay:       'bg-yellow-100 text-yellow-800 border-yellow-200',
  Amazon:     'bg-orange-100 text-orange-800 border-orange-200',
  OnBuy:      'bg-blue-100 text-blue-800 border-blue-200',
  Backmarket: 'bg-green-100 text-green-800 border-green-200',
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

type ReportTab = 'daily' | 'stock' | 'sales' | 'vat';

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
  const { units, suppliers, sales } = useInventoryStore();
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
    const seen = new Set<string>();
    const rows: any[] = [];
    // Map marketplace codes → friendly labels resolved back into MARKETPLACES
    // via marketplaceFromListingSite() when fees are calculated downstream.
    const mkToPlatform: Record<string, string> = {
      EBAY: 'eBay', AMAZON: 'Amazon', BM: 'Backmarket', ONBUY: 'OnBuy',
    };
    const unitById = new Map<string, InventoryUnit>();
    for (const u of units) unitById.set(u.id, u);
    for (const s of liveSales) {
      seen.add(s.id);
      const u = s.unitId ? unitById.get(s.unitId) : undefined;
      rows.push({
        date:        s.saleDate || '',
        model:       u?.model || s.sku || '',
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
    // Legacy in-app sold units that don't already have a `sales` doc
    for (const u of sold) {
      if (seen.has(u.id)) continue;
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
  }, [liveSales, sold, units]);

  // Daily sales for selected date (sourced from unified feed)
  const dailySales = useMemo(
    () => allSalesUnified.rows.filter(r => r.date === dateFilter),
    [allSalesUnified, dateFilter],
  );

  const dailyRevenue = dailySales.reduce((s, r) => s + (r.salePrice || 0), 0);
  const dailyGrossProfit = dailySales.reduce((s, r) => s + ((r.salePrice || 0) - r.buyPrice), 0);
  const dailyNetProfit = dailySales.reduce((s, r) =>
    s + (r.grossProfit ?? netProfitFor(r.platform, r.salePrice || 0, r.buyPrice, r.postageCost)), 0);

  // ── VAT MARGIN SCHEME (UK Second-Hand Goods) ─────────────────────────────
  const now = Date.now();
  const [vatPeriodDays, setVatPeriodDays] = React.useState(90);
  const vatSales = useMemo(() => allSalesUnified.rows.filter(r => {
    return r.date && (now - new Date(r.date).getTime()) <= vatPeriodDays * 86400000;
  }), [allSalesUnified, vatPeriodDays, now]);

  const vatData = useMemo(() => {
    let grossMargin = 0;
    let eligibleSales = 0;
    let outputVAT = 0;
    let platformFeesTotal = 0;
    let inputVAT = 0;

    for (const r of vatSales) {
      const sp = r.salePrice || 0;
      const bp = r.buyPrice || 0;
      const margin = sp - bp;
      if (margin > 0) {
        const vatOnMargin = +(margin / 6).toFixed(2);
        outputVAT += vatOnMargin;
        grossMargin += margin;
        eligibleSales++;
      }
      const fee = platformFeeFor(r.platform, sp, bp);
      const feeVAT = +(fee * 0.2 / 1.2).toFixed(2);
      platformFeesTotal += fee;
      inputVAT += feeVAT;
    }

    const netVATPayable = Math.max(0, +(outputVAT - inputVAT).toFixed(2));
    return {
      grossMargin,
      eligibleSales,
      outputVAT: +outputVAT.toFixed(2),
      inputVAT: +inputVAT.toFixed(2),
      netVATPayable,
      platformFeesTotal: +platformFeesTotal.toFixed(2),
    };
  }, [vatSales]);

  const vatRevenue = vatSales.reduce((s, r) => s + (r.salePrice || 0), 0);

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
    { key: 'daily', label: 'Daily Sales' },
    { key: 'stock', label: 'Stock Report' },
    { key: 'sales', label: 'Sales Log' },
    { key: 'vat',   label: 'VAT Returns' },
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

  const exportSalesLog = () => exportCSV(`sales-log-${new Date().toISOString().split('T')[0]}.csv`,
    [...allSalesUnified.rows]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => ({
        Date: r.date,
        'Order Number': r.orderNumber || '',
        Model: r.model,
        IMEI: r.imei,
        'Buy Price £': r.buyPrice,
        'Sale Price £': r.salePrice || 0,
        'Platform Fee £': platformFeeFor(r.platform, r.salePrice || 0, r.buyPrice),
        'Postage £': r.postageCost ?? defaultPostageFor(r.platform),
        'Net Profit £': r.grossProfit ?? netProfitFor(r.platform, r.salePrice || 0, r.buyPrice, r.postageCost),
        Platform: r.platform || '',
        'Commission %': commissionPctFor(r.platform),
      }))
  );

  const exportVAT = () => exportCSV(`vat-margin-scheme-${vatPeriodDays}d.csv`,
    vatSales.map(r => {
      const sp = r.salePrice || 0;
      const bp = r.buyPrice || 0;
      const margin = sp - bp;
      const vatOnMargin = margin > 0 ? +(margin / 6).toFixed(2) : 0;
      const fee = platformFeeFor(r.platform, sp, bp);
      const feeVAT = +(fee * 0.2 / 1.2).toFixed(2);
      return {
        Date: r.date,
        Model: r.model,
        IMEI: r.imei,
        'BP £': bp,
        'SP £': sp,
        'Margin £': margin,
        'Output VAT (Box 1) £': vatOnMargin,
        'Platform Fee £': fee.toFixed(2),
        'Input VAT (Box 4) £': feeVAT,
        Platform: r.platform || '',
      };
    })
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
            Daily Sales · Stock Value · VAT Returns · Margin Insights
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
        <div className="bg-purple-50 border border-purple-100 rounded-3xl p-3">
          <p className="text-[8px] font-mono uppercase tracking-widest text-purple-600">VAT Due</p>
          <p className="text-xl font-bold font-display mt-1 text-purple-700">£{vatData.netVATPayable.toLocaleString()}</p>
          <p className="text-[8px] text-purple-400 font-mono">last {vatPeriodDays}d</p>
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
      {tab === 'sales' && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
              Full Sales Log · {allSalesUnified.rows.length} records
            </p>
            <button onClick={exportSalesLog}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all">
              <Download size={11} /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2 text-[9px] font-mono uppercase text-gray-400">Date</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Model</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">IMEI</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Order #</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">SP</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Fee+Post</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Net</th>
                  <th className="text-left px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Platform</th>
                  <th className="text-right px-3 py-2 text-[9px] font-mono uppercase text-gray-400">Comm%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...allSalesUnified.rows]
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                  .map(r => {
                    const sp = r.salePrice || 0;
                    const post = r.postageCost ?? defaultPostageFor(r.platform);
                    const fee = platformFeeFor(r.platform, sp, r.buyPrice);
                    const net = r.grossProfit ?? netProfitFor(r.platform, sp, r.buyPrice, r.postageCost);
                    const commPct = commissionPctFor(r.platform);
                    return (
                      <tr key={r._id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-gray-500">{r.date}</td>
                        <td className="px-3 py-2 font-semibold max-w-[110px] truncate">{r.model}</td>
                        <td className="px-3 py-2"><CopyImei imei={r.imei} truncate={9} /></td>
                        <td className="px-3 py-2 font-mono text-gray-500 text-[9px]">{r.orderNumber || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">£{sp}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-500 text-[9px]">-£{(fee + post).toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${net >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {net >= 0 ? '+' : ''}£{Math.round(net)}
                        </td>
                        <td className="px-3 py-2 text-[10px]">{r.platform || '—'}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">
                          {commPct > 0 ? `${commPct}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VAT RETURNS ──────────────────────────────────────────────────────── */}
      {tab === 'vat' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <span className="text-lg flex-shrink-0">⚖️</span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800">VAT Margin Scheme Applied</p>
              <p className="text-[10px] text-amber-700 font-mono mt-1 leading-relaxed">
                HMRC <strong>Second-Hand Goods Margin Scheme (VAT Notice 718)</strong>.
                VAT is charged on your <strong>profit margin only</strong> (SP − BP) at 1/6.
                Platform fees (eBay, Amazon, OnBuy, Backmarket) include 20% VAT reclaimable as input VAT.
                Postage is a cost separate from VAT calculation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">VAT Period</p>
            {[{ l: 'Monthly', d: 30 }, { l: 'Quarterly (90d)', d: 90 }, { l: '6 Months', d: 180 }].map(o => (
              <button key={o.d} onClick={() => setVatPeriodDays(o.d)}
                className={`px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border transition-all ${
                  vatPeriodDays === o.d ? 'bg-black text-white border-black' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}>
                {o.l}
              </button>
            ))}
            <button onClick={exportVAT}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all">
              <Download size={11} /> Export CSV
            </button>
          </div>

          {/* HMRC-style VAT Return Summary */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-5 text-white">
            <div className="flex items-center gap-2 mb-5">
              <Receipt size={16} className="text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                HMRC VAT Return Summary · Last {vatPeriodDays} Days
              </p>
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
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">Gross revenue</p>
                <p className="text-xl font-bold font-display mt-2">£{vatRevenue.toLocaleString()}</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">Box 7 — Total Purchases</p>
                <p className="text-[8px] font-mono text-slate-500 mt-0.5">Platform fees paid</p>
                <p className="text-xl font-bold font-display mt-2">£{vatData.platformFeesTotal.toLocaleString()}</p>
              </div>
            </div>
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
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
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
                  {vatSales.map(r => {
                    const sp = r.salePrice || 0;
                    const bp = r.buyPrice || 0;
                    const margin = sp - bp;
                    const vatOnMargin = margin > 0 ? +(margin / 6).toFixed(2) : 0;
                    const fee = platformFeeFor(r.platform, sp, bp);
                    const feeVAT = +(fee * 0.2 / 1.2).toFixed(2);
                    return (
                      <tr key={r._id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-gray-500 text-[9px]">{r.date}</td>
                        <td className="px-3 py-2 font-semibold max-w-[100px] truncate">{r.model}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">£{bp}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold">£{sp}</td>
                        <td className={`px-3 py-2 text-right font-mono font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {margin >= 0 ? '+' : ''}£{margin}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-purple-600 font-bold">
                          {vatOnMargin > 0 ? `£${vatOnMargin}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">
                          {feeVAT > 0 ? `+£${feeVAT}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-[10px] text-gray-500">{r.platform || '—'}</td>
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

          <p className="text-[9px] text-gray-400 font-mono text-center leading-relaxed px-4">
            ⚠️ Estimate based on HMRC VAT Notice 718. Consult your accountant before filing.
            VAT threshold: £90,000 rolling 12-month turnover (2024/25).
          </p>
        </div>
      )}
    </div>
  );
}
