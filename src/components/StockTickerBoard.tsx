import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Trash2, TrendingDown } from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../lib/inventoryStore';
import { notificationService } from '../lib/notificationService';

interface TickerItem {
  id: string;
  model: string;
  type: 'out_of_stock' | 'shs_removed';
  timestamp: number;
}

export default function StockTickerBoard() {
  const { units } = useInventoryStore();
  const [items, setItems] = useState<TickerItem[]>([]);
  const [seenNotificationIds, setSeenNotificationIds] = useState<Set<string>>(new Set());
  const [outOfStockModels, setOutOfStockModels] = useState<Set<string>>(new Set());
  const prevUnitsRef = useRef<Map<string, number>>(new Map());

  // Track available units per model and detect when stock goes out
  useEffect(() => {
    const currentInventory = new Map<string, number>();
    units.forEach(u => {
      if (u.status === 'available') {
        const count = (currentInventory.get(u.model) || 0) + 1;
        currentInventory.set(u.model, count);
      }
    });

    // Check for models that went out of stock
    prevUnitsRef.current.forEach((prevCount, model) => {
      const currentCount = currentInventory.get(model) || 0;
      if (prevCount > 0 && currentCount === 0 && !outOfStockModels.has(model)) {
        const newItem: TickerItem = {
          id: `outofstock_${Date.now()}_${model}`,
          model,
          type: 'out_of_stock',
          timestamp: Date.now(),
        };
        setItems(prev => [newItem, ...prev].slice(0, 20));
        setOutOfStockModels(prev => new Set([...prev, model]));
      }
    });

    prevUnitsRef.current = currentInventory;
  }, [units, outOfStockModels]);

  // Track SHS removed notifications
  useEffect(() => {
    return notificationService.subscribe((notifications) => {
      notifications.forEach(n => {
        if (n.type === 'shs_removed' && !seenNotificationIds.has(n.id)) {
          const newItem: TickerItem = {
            id: n.id,
            model: n.model,
            type: 'shs_removed',
            timestamp: Date.now(),
          };
          setItems(prev => [newItem, ...prev].slice(0, 20));
          setSeenNotificationIds(prev => new Set([...prev, n.id]));
        }
      });
    });
  }, [seenNotificationIds]);

  if (items.length === 0) return null;

  return (
    <div className="flex-shrink-0 h-8 md:h-9 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 overflow-hidden">
      <div className="h-full flex items-center px-4 md:px-6 gap-4">
        <motion.div
          animate={{ x: ['100%', '-100%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className="flex gap-6 whitespace-nowrap"
        >
          {[...items, ...items].map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="flex items-center gap-2 flex-shrink-0">
              {item.type === 'out_of_stock' && (
                <>
                  <TrendingDown size={13} className="text-red-400" />
                  <span className="text-[10px] font-mono text-red-300 uppercase tracking-widest">
                    {item.model} · OUT OF STOCK
                  </span>
                </>
              )}
              {item.type === 'shs_removed' && (
                <>
                  <Trash2 size={13} className="text-orange-400" />
                  <span className="text-[10px] font-mono text-orange-300 uppercase tracking-widest">
                    {item.model} · SHS Removed
                  </span>
                </>
              )}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
