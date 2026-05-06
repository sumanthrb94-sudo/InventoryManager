import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Package, X, AlertCircle, RefreshCw, Truck } from 'lucide-react';
import { notificationService, Notification } from '../lib/notificationService';

const DISPLAY_MS = Infinity; // Persistent notifications
const MAX_VISIBLE = 10;

export default function NotificationToast() {
  const [queue, setQueue]   = useState<Notification[]>([]);
  const shownIds            = useRef<Set<string>>(new Set());

  useEffect(() => {
    return notificationService.subscribe((notifications) => {
      const fresh = notifications.filter(n => {
        const age = Date.now() - new Date(n.timestamp).getTime();
        return !n.read && age < 10_000 && !shownIds.current.has(n.id);
      });
      if (!fresh.length) return;
      fresh.forEach(n => shownIds.current.add(n.id));
      setQueue(prev => [...fresh, ...prev].slice(0, MAX_VISIBLE));
    });
  }, []);

  const dismiss = (id: string) => {
    setQueue(prev => prev.filter(n => n.id !== id));
    notificationService.markAsRead(id);
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-none flex flex-col gap-3 items-center max-w-[calc(100vw-2rem)] md:max-w-[400px]">
      <AnimatePresence initial={false}>
        {queue.map(n => (
          <ToastCard key={n.id} notification={n} onDismiss={() => dismiss(n.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ notification, onDismiss }: { key?: React.Key; notification: Notification; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, DISPLAY_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  // Icon and color mapping for different notification types
  const typeConfig = {
    sold: { icon: ShoppingBag, bg: 'bg-emerald-500/20 border-emerald-500/30', badge: 'bg-emerald-500', icon_color: 'text-emerald-400' },
    loss_sell: { icon: AlertCircle, bg: 'bg-red-500/20 border-red-500/30', badge: 'bg-red-500', icon_color: 'text-red-400' },
    new_stock: { icon: Package, bg: 'bg-blue-500/20 border-blue-500/30', badge: 'bg-blue-500', icon_color: 'text-blue-400' },
    return_processed: { icon: RefreshCw, bg: 'bg-amber-500/20 border-amber-500/30', badge: 'bg-amber-500', icon_color: 'text-amber-400' },
    shs_received: { icon: Truck, bg: 'bg-purple-500/20 border-purple-500/30', badge: 'bg-purple-500', icon_color: 'text-purple-400' },
  };

  const config = typeConfig[notification.type];
  const Icon = config.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`pointer-events-auto w-full md:w-[420px] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl border border-white/5 flex items-start gap-3 backdrop-blur-sm ${config.bg}`}
    >
      <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center ${config.badge}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[9px] font-bold uppercase tracking-widest mb-0.5 ${config.icon_color}`}>{notification.title}</p>
        <p className="text-sm font-semibold truncate leading-snug text-white">{notification.model}</p>
        <p className="text-[10px] text-gray-400 font-mono mt-0.5 line-clamp-2">{notification.message}</p>
        {notification.profitAmount !== undefined && (
          <p className={`text-[9px] font-bold mt-1 ${notification.profitAmount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {notification.profitAmount >= 0 ? '✓ Profit' : '⚠ Loss'}: £{Math.abs(notification.profitAmount).toFixed(2)}
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="p-1 hover:bg-white/10 rounded-lg transition-all flex-shrink-0 mt-0.5"
        aria-label="Dismiss"
      >
        <X size={14} className="text-gray-500" />
      </button>
    </motion.div>
  );
}
