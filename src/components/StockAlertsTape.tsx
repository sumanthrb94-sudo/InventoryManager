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
    const seen = new Set<string>();
    const list: Alert[] = [];

    // Group by series for efficient alert generation
    const seriesMap: Record<string, { outOfStock: number; lowStock: number; shs: number; listed: number; returned: number }> = {};

    for (const u of units) {
      const series = u.model.split(' ').slice(0, 2).join(' ');
      if (!seriesMap[series]) {
        seriesMap[series] = { outOfStock: 0, lowStock: 0, shs: 0, listed: 0, returned: 0 };
      }

      if (u.status === 'available') {
        if (u.platformListed || u.listingSites?.length > 0) {
          seriesMap[series].listed++;
        }
      } else if (u.status === 'incoming') {
        seriesMap[series].shs++;
      } else if (u.status === 'returned') {
        seriesMap[series].returned++;
      }
    }

    // Out of stock: series with 0 available
    const available = units.filter(u => u.status === 'available');
    const availableSeries = new Set(available.map(u => u.model.split(' ').slice(0, 2).join(' ')));

    const allSeries = new Set([
      ...Array.from(units).map(u => u.model.split(' ').slice(0, 2).join(' '))
    ]);

    for (const series of allSeries) {
      if (!availableSeries.has(series)) {
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
      } else {
        // Check for low stock (only 1-2 units available)
        const count = available.filter(u => u.model.split(' ').slice(0, 2).join(' ') === series).length;
        if (count > 0 && count <= 2) {
          const alertId = `lowstock-${series}-${count}`;
          if (!seen.has(alertId)) {
            seen.add(alertId);
            list.push({
              id: alertId,
              type: 'lowstock',
              model: series,
              detail: `Only ${count} unit${count > 1 ? 's' : ''} left`,
              icon: <TrendingDown size={14} />,
              color: 'text-amber-600',
              bg: 'bg-amber-50 border-amber-200',
              priority: 80,
            });
          }
        }
      }

      // SHS (Supplier Holding Stock)
      if (seriesMap[series]?.shs > 0) {
        const alertId = `shs-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'shs',
            model: series,
            detail: `${seriesMap[series].shs} with supplier`,
            icon: <Truck size={14} />,
            color: 'text-blue-600',
            bg: 'bg-blue-50 border-blue-200',
            priority: 40,
          });
        }
      }

      // Listed
      if (seriesMap[series]?.listed > 0) {
        const alertId = `listed-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'listed',
            model: series,
            detail: `${seriesMap[series].listed} listed for sale`,
            icon: <ShoppingBag size={14} />,
            color: 'text-green-600',
            bg: 'bg-green-50 border-green-200',
            priority: 30,
          });
        }
      }

      // Returned
      if (seriesMap[series]?.returned > 0) {
        const alertId = `returned-${series}`;
        if (!seen.has(alertId)) {
          seen.add(alertId);
          list.push({
            id: alertId,
            type: 'returned',
            model: series,
            detail: `${seriesMap[series].returned} returned`,
            icon: <RefreshCw size={14} />,
            color: 'text-orange-600',
            bg: 'bg-orange-50 border-orange-200',
            priority: 20,
          });
        }
      }
    }

    // Sort by priority (descending) then by model name
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

      {/* Scrolling alerts */}
      <div style={{
        maxHeight: 'calc(70vh - 32px)',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}>
        <motion.div
          initial={{ y: 0 }}
          animate={{ y: -2000 }}
          transition={{
            duration: alerts.length * 3,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{ paddingTop: 0 }}
        >
          {/* First pass */}
          {alerts.map(alert => (
            <div
              key={`${alert.id}-1`}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #f1f5f9',
                borderLeft: `3px solid`,
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

          {/* Second pass (seamless loop) */}
          {alerts.map(alert => (
            <div
              key={`${alert.id}-2`}
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid #f1f5f9',
                borderLeft: `3px solid`,
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
      </div>
    </div>
  );
}
