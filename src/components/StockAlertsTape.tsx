import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, TrendingDown, Truck, ShoppingBag, RefreshCw } from 'lucide-react';
import { InventoryUnit } from '../types';

interface Props {
  units: InventoryUnit[];
}

interface Alert {
  id: string;
  type: 'outofstock' | 'lowstock' | 'shs' | 'listed' | 'returned';
  model: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  priority: number; // Higher = more important
}

export default function StockAlertsTape({ units }: Props) {
  const alerts = useMemo(() => {
    if (!units || !Array.isArray(units) || units.length === 0) return [];

    console.log('[StockAlertsTape] Received units:', units.length, 'Total models:', new Set(units.map(u => u.model)).size);

    const seen = new Set<string>();
    const list: Alert[] = [];

    // Build comprehensive series stats
    const seriesStats: Record<string, {
      availableCount: number;
      shsCount: number;
      listedCount: number;
      returnedCount: number;
    }> = {};

    // Get all unique series from all units and build stats
    const allSeries = new Set<string>();

    for (const u of units) {
      const series = u.model.split(' ').slice(0, 2).join(' ');
      allSeries.add(series);

      if (!seriesStats[series]) {
        seriesStats[series] = { availableCount: 0, shsCount: 0, listedCount: 0, returnedCount: 0 };
      }

      if (u.status === 'available') {
        seriesStats[series].availableCount++;
        if (u.platformListed || (u.listingSites && u.listingSites.length > 0)) {
          seriesStats[series].listedCount++;
        }
      } else if (u.status === 'incoming') {
        seriesStats[series].shsCount++;
      } else if (u.status === 'returned') {
        seriesStats[series].returnedCount++;
      }
    }

    // Debug: show all series with available counts
    const seriesInfo = Array.from(allSeries).map(s => ({
      series: s,
      available: seriesStats[s].availableCount,
      shs: seriesStats[s].shsCount,
      listed: seriesStats[s].listedCount,
      returned: seriesStats[s].returnedCount,
    }));
    console.log('[StockAlertsTape] Series with counts:', seriesInfo);

    // Debug: Show which series have 1-2 available
    const lowStockCandidates = seriesInfo.filter(s => s.available >= 1 && s.available <= 2);
    console.log('[StockAlertsTape] Low stock candidates (should trigger alerts):', lowStockCandidates);


    // Generate alerts for each series - BULLETPROOF DETECTION
    for (const series of Array.from(allSeries).sort()) {
      if (!seriesStats[series]) continue; // Safety check

      const stats = seriesStats[series];
      const totalUnitsInSeries = units.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;

      console.log(`[StockAlertsTape] Series: "${series}" | total: ${totalUnitsInSeries} | available: ${stats.availableCount} | shs: ${stats.shsCount} | listed: ${stats.listedCount} | returned: ${stats.returnedCount}`);

      // Priority 1: OUT OF STOCK - Series exists in data but NO available units
      if (totalUnitsInSeries > 0 && stats.availableCount === 0) {
        const alertId = `outofstock-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          console.log(`[StockAlertsTape] OUT OF STOCK: ${series} (total: ${totalUnitsInSeries}, available: ${stats.availableCount})`);
          list.push({
            id: alertId,
            type: 'outofstock',
            model: series,
            detail: 'Out of Stock',
            icon: <AlertCircle size={14} />,
            color: 'text-red-600',
            bg: 'bg-red-50 border-red-200',
            priority: 100,
          });
        }
      }

      // Priority 2: LOW STOCK - Only 1-2 available units
      if (stats.availableCount > 0 && stats.availableCount <= 2) {
        const alertId = `lowstock-${series}-${stats.availableCount}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          console.log(`[StockAlertsTape] LOW STOCK: ${series} (available: ${stats.availableCount})`);
          list.push({
            id: alertId,
            type: 'lowstock',
            model: series,
            detail: `Only ${stats.availableCount} unit${stats.availableCount === 1 ? '' : 's'} left`,
            icon: <TrendingDown size={14} />,
            color: 'text-amber-600',
            bg: 'bg-amber-50 border-amber-200',
            priority: 80,
          });
        }
      }

      // Priority 3: SHS (with supplier)
      if (stats.shsCount > 0) {
        const alertId = `shs-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'shs',
            model: series,
            detail: `${stats.shsCount} with supplier`,
            icon: <Truck size={14} />,
            color: 'text-blue-600',
            bg: 'bg-blue-50 border-blue-200',
            priority: 50,
          });
        }
      }

      // Priority 4: LISTED
      if (stats.listedCount > 0) {
        const alertId = `listed-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'listed',
            model: series,
            detail: `${stats.listedCount} listed for sale`,
            icon: <ShoppingBag size={14} />,
            color: 'text-green-600',
            bg: 'bg-green-50 border-green-200',
            priority: 30,
          });
        }
      }

      // Priority 5: RETURNED
      if (stats.returnedCount > 0) {
        const alertId = `returned-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'returned',
            model: series,
            detail: `${stats.returnedCount} returned`,
            icon: <RefreshCw size={14} />,
            color: 'text-orange-600',
            bg: 'bg-orange-50 border-orange-200',
            priority: 20,
          });
        }
      }
    }

    console.log(`[StockAlertsTape] Total alerts generated: ${list.length}`, list);

    // Sort by priority (descending) then by model name (ascending)
    return list.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.model.localeCompare(b.model);
    });
  }, [units]);

  // Integrated as right-side panel - responsive layout
  return (
    <div className="w-full bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between flex-shrink-0">
        <p className="text-xs font-bold uppercase tracking-tight text-gray-900">
          Stock Alerts
        </p>
        <p className="text-[9px] text-gray-500 font-mono">
          {alerts.length}
        </p>
      </div>

      {/* Scrollable alerts - vertical scroll */}
      <div className="overflow-y-auto flex-1 custom-scrollbar">
        {alerts.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-2.5 ${alert.bg}`}
              >
                <div className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${alert.color}`}>
                  {alert.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">
                    {alert.model}
                  </p>
                  <p className="text-[11px] text-gray-600 font-mono mt-0.5 line-clamp-2">
                    {alert.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 px-4 flex flex-col items-center gap-2 text-gray-400 text-center">
            <p className="text-xs font-mono">All good!</p>
          </div>
        )}
      </div>
    </div>
  );
}
