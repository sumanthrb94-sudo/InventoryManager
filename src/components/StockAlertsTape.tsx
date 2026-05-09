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
    console.log('[StockAlertsTape] Series with counts:', Array.from(allSeries).map(s => ({
      series: s,
      available: seriesStats[s].availableCount,
      shs: seriesStats[s].shsCount,
      listed: seriesStats[s].listedCount,
      returned: seriesStats[s].returnedCount,
    })));


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

  // Always show the tape for debugging, even if 0 alerts
  return (
    <div style={{
      position: 'fixed',
      right: 0,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 180,
      maxHeight: '70vh',
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '12px 0 0 12px',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
      overflow: 'hidden',
      zIndex: 40,
    }}>
      {/* Header */}
      <div style={{
        padding: '8px 10px',
        borderBottom: '1px solid #e2e8f0',
        background: '#f8fafc',
      }}>
        <p style={{
          fontSize: 8,
          fontFamily: 'monospace',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: '#64748b',
          margin: 0,
        }}>
          Stock Alerts
        </p>
      </div>

      {/* Scrolling alerts - NO DUPLICATES */}
      <div style={{
        maxHeight: 'calc(70vh - 32px)',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        {/* Debug: show alert count */}
        <div style={{ padding: '4px 10px', fontSize: 7, color: '#94a3b8', borderBottom: '1px solid #f1f5f9' }}>
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </div>

        {alerts.length > 0 ? (
          <motion.div
            initial={{ y: 0 }}
            animate={{ y: alerts.length > 3 ? `-${(alerts.length * 60)}px` : 0 }}
            transition={{
              duration: alerts.length > 3 ? alerts.length * 2.5 : 0,
              repeat: 0,
              ease: 'linear',
            }}
          >
            {/* Render alerts TWICE for seamless infinite scroll without duplication */}
            {[...alerts, ...alerts].map((alert, idx) => (
              <div
                key={`${alert.id}-${idx}`}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid #f1f5f9',
                  borderLeft: `3px solid currentColor`,
                  minHeight: 60,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
                className={alert.bg}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }} className={alert.color}>
                    {alert.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: 9,
                      fontWeight: 700,
                      margin: '0 0 2px 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: '#1e293b',
                    }}>
                      {alert.model}
                    </p>
                    <p style={{
                      fontSize: 7.5,
                      margin: 0,
                      color: '#64748b',
                      fontFamily: 'monospace',
                    }}>
                      {alert.detail}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : (
          <div style={{
            padding: '12px 10px',
            textAlign: 'center',
            color: '#94a3b8',
            fontSize: 8,
            fontFamily: 'monospace',
          }}>
            All good!
          </div>
        )}
      </div>
    </div>
  );
}
