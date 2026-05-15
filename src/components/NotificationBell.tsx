import React, { useState, useEffect, useRef } from 'react';
import { Bell, ShoppingBag, PackagePlus, X, CheckCheck, AlertCircle, RefreshCw, Truck } from 'lucide-react';
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
    // Don't auto-mark as read - let user see all notifications
    // Notifications stay until explicitly dismissed
  };

  const today     = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Check for notifications older than 24 hours
  const cutoff24h = new Date();
  cutoff24h.setHours(cutoff24h.getHours() - 24);
  const veryOldNotifications = notifications.filter(n => new Date(n.timestamp) < cutoff24h);

  const grouped: { label: string; items: Notification[] }[] = [];
  const todayItems     = notifications.filter(n => n.timestamp.startsWith(today));
  const yesterdayItems = notifications.filter(n => n.timestamp.startsWith(yesterday));
  const olderItems     = notifications.filter(n =>
    !n.timestamp.startsWith(today) && !n.timestamp.startsWith(yesterday)
  );
  if (todayItems.length)     grouped.push({ label: 'Today',     items: todayItems });
  if (yesterdayItems.length) grouped.push({ label: 'Yesterday', items: yesterdayItems });
  if (olderItems.length)     grouped.push({ label: 'Earlier',   items: olderItems });

  // Get the color of the most recent unread notification
  const getLatestNotificationColor = () => {
    const unreadNotifications = notifications.filter(n => !n.read);
    if (unreadNotifications.length === 0) return 'bg-gray-400';

    const typeColors: Record<string, string> = {
      sold: 'bg-emerald-500',
      loss_sell: 'bg-red-500',
      new_stock: 'bg-blue-500',
      return_processed: 'bg-amber-500',
      shs_received: 'bg-purple-500',
      shs_removed: 'bg-orange-500',
    };
    return typeColors[unreadNotifications[0].type] || 'bg-gray-500';
  };

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
              className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 ${getLatestNotificationColor()} text-white text-[9px] font-bold rounded-full flex items-center justify-center font-mono`}
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
            className="fixed sm:absolute right-0 bottom-0 sm:top-12 w-full sm:w-80 h-[90vh] sm:h-auto max-h-[90vh] sm:max-h-[600px] bg-white sm:border sm:border-gray-200 rounded-t-3xl sm:rounded-3xl shadow-2xl z-[200] flex flex-col"
          >
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Bell size={13} className="text-gray-500" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-black">Live Activity</span>
              </div>
              <div className="flex items-center gap-2">
                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={() => notificationService.markAllAsRead()}
                      className="flex items-center gap-1 text-[9px] font-mono text-gray-400 hover:text-black transition-colors"
                      title="Mark all as read"
                    >
                      <CheckCheck size={11} />
                      Read
                    </button>
                    {veryOldNotifications.length > 0 && (
                      <button
                        onClick={() => notificationService.clearOldNotifications(24)}
                        className="flex items-center gap-1 text-[9px] font-mono text-amber-400 hover:text-amber-600 transition-colors"
                        title="Clear notifications older than 24 hours"
                      >
                        <X size={11} />
                        Clear
                      </button>
                    )}
                  </>
                )}
                <button onClick={() => setOpen(false)} className="p-0.5 text-gray-400 hover:text-black">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
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
                      {group.items.map(n => {
                        const typeConfig: Record<string, { bg: string; icon: React.ReactNode; label: string; badgeBg: string }> = {
                          sold: { bg: 'bg-emerald-100 text-emerald-600', icon: <ShoppingBag size={13} />, label: 'Sold', badgeBg: 'bg-emerald-500' },
                          loss_sell: { bg: 'bg-red-100 text-red-600', icon: <AlertCircle size={13} />, label: 'Loss Sell', badgeBg: 'bg-red-500' },
                          new_stock: { bg: 'bg-blue-100 text-blue-600', icon: <PackagePlus size={13} />, label: 'New Stock', badgeBg: 'bg-blue-500' },
                          return_processed: { bg: 'bg-amber-100 text-amber-600', icon: <RefreshCw size={13} />, label: 'Return', badgeBg: 'bg-amber-500' },
                          shs_received: { bg: 'bg-purple-100 text-purple-600', icon: <Truck size={13} />, label: 'SHS Received', badgeBg: 'bg-purple-500' },
                          shs_removed: { bg: 'bg-orange-100 text-orange-600', icon: <AlertCircle size={13} />, label: 'SHS Inactive', badgeBg: 'bg-orange-500' },
                          unit_repaired: { bg: 'bg-indigo-100 text-indigo-600', icon: <RefreshCw size={13} />, label: 'Repaired', badgeBg: 'bg-indigo-500' },
                        };
                        const config = typeConfig[n.type] || typeConfig.new_stock;
                        return (
                        <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${n.read ? 'opacity-60' : 'bg-white'}`}>
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                            {config.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-[11px] font-bold truncate">{n.model}</p>
                              {n.quantity && n.quantity > 1 && (
                                <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[8px] font-bold text-white ${config.badgeBg} flex-shrink-0`}>
                                  ×{n.quantity}
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] font-mono text-gray-400 mt-0.5 leading-relaxed">
                              {config.label} · {n.message}
                            </p>
                            {n.profitAmount !== undefined && (
                              <p className={`text-[8px] font-bold mt-1 ${n.profitAmount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {n.profitAmount >= 0 ? '✓ Profit' : '⚠ Loss'}: £{Math.abs(n.profitAmount).toFixed(2)}
                              </p>
                            )}
                          </div>
                          <span className="text-[8px] font-mono text-gray-300 flex-shrink-0 mt-0.5">
                            {timeAgo(n.timestamp)}
                          </span>
                        </div>
                      );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-4 py-2.5 border-t border-gray-100 bg-gray-50">
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
