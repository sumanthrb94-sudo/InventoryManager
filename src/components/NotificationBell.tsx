import React, { useState, useEffect, useRef } from 'react';
import { Bell, ShoppingBag, PackagePlus, X, CheckCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { notificationService, Notification } from '../lib/notificationService';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell({ unreadCount }: { unreadCount: number }) {
  const [open, setOpen]               = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => notificationService.subscribe(setNotifications), []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(o => !o);
    if (!open) notificationService.markAllAsRead();
  };

  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const grouped: { label: string; items: Notification[] }[] = [];
  const todayItems     = notifications.filter(n => n.timestamp.startsWith(today));
  const yesterdayItems = notifications.filter(n => n.timestamp.startsWith(yesterday));
  const olderItems     = notifications.filter(n =>
    !n.timestamp.startsWith(today) && !n.timestamp.startsWith(yesterday)
  );
  if (todayItems.length)     grouped.push({ label: 'Today',     items: todayItems });
  if (yesterdayItems.length) grouped.push({ label: 'Yesterday', items: yesterdayItems });
  if (olderItems.length)     grouped.push({ label: 'Earlier',   items: olderItems });

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative flex items-center justify-center w-9 h-9 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-all"
        aria-label="Notifications"
      >
        <Bell size={16} className={unreadCount > 0 ? 'text-black' : 'text-gray-400'} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-black text-white text-[9px] font-bold rounded-full flex items-center justify-center font-mono"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Notification panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 w-80 bg-white border border-gray-200 rounded-2xl shadow-2xl z-[200] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Bell size={13} className="text-gray-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-black">Live Activity</span>
              </div>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <button
                    onClick={() => notificationService.markAllAsRead()}
                    className="flex items-center gap-1 text-[9px] font-mono text-gray-400 hover:text-black transition-colors"
                  >
                    <CheckCheck size={11} />
                    All read
                  </button>
                )}
                <button onClick={() => setOpen(false)} className="p-0.5 text-gray-400 hover:text-black">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="max-h-[420px] overflow-y-auto">
              {grouped.length === 0 ? (
                <div className="py-12 flex flex-col items-center gap-2 text-gray-300">
                  <Bell size={28} />
                  <p className="text-[10px] font-mono uppercase tracking-widest">No activity yet</p>
                  <p className="text-[9px] font-mono text-gray-300">Sales and stock updates appear here</p>
                </div>
              ) : (
                grouped.map(group => (
                  <div key={group.label}>
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 font-mono">
                        {group.label}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {group.items.map(n => (
                        <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${n.read ? 'opacity-60' : 'bg-white'}`}>
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            n.type === 'sold' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                          }`}>
                            {n.type === 'sold'
                              ? <ShoppingBag size={13} />
                              : <PackagePlus size={13} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold truncate">{n.model}</p>
                            <p className="text-[9px] font-mono text-gray-400 mt-0.5 leading-relaxed">
                              {n.type === 'sold' ? 'Sold' : 'Added to stock'} · IMEI ···{n.unitId.slice(-4)}
                            </p>
                          </div>
                          <span className="text-[8px] font-mono text-gray-300 flex-shrink-0 mt-0.5">
                            {timeAgo(n.timestamp)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50">
              <p className="text-[8px] font-mono text-gray-300 uppercase tracking-widest text-center">
                Real-time · Today's activity persists across sessions
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
