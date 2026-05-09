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
    if (units.length === 0) return [];

    const seen = new Set<string>();
    const list: Alert[] = [];

    // Build comprehensive series stats
    const seriesStats: Record<string, {
      availableCount: number;
      shsCount: number;
      listedCount: number;
      returnedCount: number;
    }> = {};

    // Get all unique series from all units
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

    // Generate alerts for each series
    for (const series of Array.from(allSeries).sort()) {
      const stats = seriesStats[series];

      // Priority 1: OUT OF STOCK (highest priority)
      if (stats.availableCount === 0) {
        const alertId = `outofstock-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
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

      // Priority 2: LOW STOCK (1-2 units only)
      if (stats.availableCount > 0 && stats.availableCount <= 2) {
        const alertId = `lowstock-${series}-${stats.availableCount}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
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

    // Sort by priority (descending) then by model name (ascending)
    return list.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.model.localeCompare(b.model);
    });
  }, [units]);

  if (alerts.length === 0) return null;

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
        {alerts.length > 0 ? (
          <motion.div
            initial={{ y: 0 }}
            animate={{ y: alerts.length > 6 ? `-${alerts.length * 60}px` : 0 }}
            transition={{
              duration: alerts.length > 6 ? alerts.length * 4 : 0,
              repeat: alerts.length > 6 ? Infinity : 0,
              ease: 'linear',
            }}
            style={{ paddingTop: 0 }}
          >
            {/* Show each alert exactly once - NO DUPLICATES */}
            {alerts.map(alert => (
              <div
                key={alert.id}
                style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid #f1f5f9',
                  borderLeft: `3px solid`,
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
