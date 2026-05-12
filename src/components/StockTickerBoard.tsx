import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { notificationService, Notification } from '../lib/notificationService';

// Stock-style scrolling tape — narrow, single-purpose surface that only
// surfaces when an SHS unit has been REMOVED from pending stock due to
// a supplier supply issue. Message reads
//   "SHS UNIT <MODEL> × <QTY> REMOVED — PLEASE DELIST"
// so operators can action it (delist on the platform) without opening
// the notification bell. Every other notification stays in the bell.

interface TickerItem {
  id: string;
  model: string;
  quantity: number;
  timestamp: number;
}

export default function StockTickerBoard() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    // subscribe() fires immediately with the current notification list,
    // and again whenever the store mutates. We pick out the SHS-removed
    // entries, sort newest-first, and cap at 20 so the tape stays
    // bounded even after a long-running session.
    return notificationService.subscribe((notifications: Notification[]) => {
      const fresh = notifications.filter(n => n.type === 'shs_removed');
      if (!fresh.length) {
        setItems([]);
        return;
      }
      const next: TickerItem[] = fresh
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 20)
        .map(n => ({
          id: n.id,
          model: n.model || 'Unknown model',
          quantity: n.quantity && n.quantity > 0 ? n.quantity : 1,
          timestamp: new Date(n.timestamp).getTime(),
        }));
      setItems(next);
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="flex-shrink-0 h-8 md:h-9 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 overflow-hidden">
      <div className="h-full flex items-center px-4 md:px-6 gap-4">
        <motion.div
          animate={{ x: ['100%', '-100%'] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
          className="flex gap-8 whitespace-nowrap"
        >
          {/* Render the list twice so the marquee loops seamlessly. */}
          {[...items, ...items].map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="flex items-center gap-2 flex-shrink-0">
              <Trash2 size={13} className="text-orange-400" />
              <span className="text-[10px] font-mono text-orange-300 uppercase tracking-widest">
                SHS Unit · {item.model} × {item.quantity} Removed
              </span>
              <span className="text-[10px] font-mono text-amber-400 uppercase tracking-widest font-bold">
                Please Delist
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
