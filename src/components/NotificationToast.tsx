import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Package, X } from 'lucide-react';
import { notificationService, Notification } from '../lib/notificationService';

const DISPLAY_MS = 5000;
const MAX_VISIBLE = 3;

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
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-6 md:top-6 z-[200] pointer-events-none flex flex-col gap-2 items-stretch md:items-end">
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

  const isSold = notification.type === 'sold';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="pointer-events-auto w-full md:w-[360px] bg-gray-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-3"
    >
      <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${isSold ? 'bg-emerald-500' : 'bg-blue-500'}`}>
        {isSold ? <ShoppingBag size={16} /> : <Package size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">{notification.title}</p>
        <p className="text-sm font-semibold truncate leading-snug">{notification.model}</p>
        <p className="text-[10px] text-gray-500 font-mono truncate">{notification.message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="p-1.5 hover:bg-white/10 rounded-lg transition-all flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={13} className="text-gray-500" />
      </button>
    </motion.div>
  );
}
