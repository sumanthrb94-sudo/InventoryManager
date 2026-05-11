import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Package, X, AlertCircle, RefreshCw, Truck, ChevronLeft, ChevronRight } from 'lucide-react';
import { notificationService, Notification } from '../lib/notificationService';

const DISPLAY_MS = 5000; // Auto-dismiss after 5 seconds

export default function NotificationToast() {
  const [queue, setQueue]     = useState<Notification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autoHide, setAutoHide] = useState(true);
  const shownIds              = useRef<Set<string>>(new Set());
  const dismissTimeoutRef     = useRef<NodeJS.Timeout>();

  useEffect(() => {
    return notificationService.subscribe((notifications) => {
      // Show newly added unread notifications (only show once per session)
      const fresh = notifications.filter(n => {
        return !n.read && !shownIds.current.has(n.id);
      });
      if (!fresh.length) return;
      fresh.forEach(n => shownIds.current.add(n.id));
      setQueue(prev => [...fresh, ...prev]);
      setCurrentIndex(0);
      setAutoHide(true);
    });
  }, []);

  // Auto-dismiss current notification if multiple exist
  useEffect(() => {
    if (!autoHide || queue.length <= 1) return;

    if (dismissTimeoutRef.current) clearTimeout(dismissTimeoutRef.current);
    dismissTimeoutRef.current = setTimeout(() => {
      nextNotification();
    }, DISPLAY_MS);

    return () => {
      if (dismissTimeoutRef.current) clearTimeout(dismissTimeoutRef.current);
    };
  }, [autoHide, queue.length, currentIndex]);

  const nextNotification = () => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      // Dismiss all when reaching end
      dismissAll();
    }
  };

  const prevNotification = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setAutoHide(false); // Pause auto-dismiss when navigating
    }
  };

  const dismiss = () => {
    const current = queue[currentIndex];
    notificationService.markAsRead(current.id);
    const updated = queue.filter((_, i) => i !== currentIndex);
    setQueue(updated);
    if (currentIndex >= updated.length && currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const dismissAll = () => {
    queue.forEach(n => notificationService.markAsRead(n.id));
    setQueue([]);
    setCurrentIndex(0);
  };

  if (queue.length === 0) return null;

  const currentNotification = queue[currentIndex];
  const hasMultiple = queue.length > 1;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] pointer-events-none flex flex-col gap-3 items-center max-w-[calc(100vw-2rem)] md:max-w-[440px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentNotification.id}
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="w-full pointer-events-auto"
        >
          <ToastCard
            notification={currentNotification}
            onDismiss={dismiss}
            onDismissAll={dismissAll}
            hasMultiple={hasMultiple}
            currentIndex={currentIndex}
            totalCount={queue.length}
            onNext={nextNotification}
            onPrev={prevNotification}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ToastCard({
  notification,
  onDismiss,
  onDismissAll,
  hasMultiple,
  currentIndex,
  totalCount,
  onNext,
  onPrev,
}: {
  notification: Notification;
  onDismiss: () => void;
  onDismissAll: () => void;
  hasMultiple: boolean;
  currentIndex: number;
  totalCount: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  // Icon and color mapping for different notification types
  const typeConfig = {
    sold: { icon: ShoppingBag, bg: 'bg-emerald-500/20 border-emerald-500/30', badge: 'bg-emerald-500', icon_color: 'text-emerald-400' },
    loss_sell: { icon: AlertCircle, bg: 'bg-red-500/20 border-red-500/30', badge: 'bg-red-500', icon_color: 'text-red-400' },
    new_stock: { icon: Package, bg: 'bg-blue-500/20 border-blue-500/30', badge: 'bg-blue-500', icon_color: 'text-blue-400' },
    return_processed: { icon: RefreshCw, bg: 'bg-amber-500/20 border-amber-500/30', badge: 'bg-amber-500', icon_color: 'text-amber-400' },
    shs_received: { icon: Truck, bg: 'bg-purple-500/20 border-purple-500/30', badge: 'bg-purple-500', icon_color: 'text-purple-400' },
    shs_removed: { icon: AlertCircle, bg: 'bg-orange-500/20 border-orange-500/30', badge: 'bg-orange-500', icon_color: 'text-orange-400' },
    unit_repaired: { icon: RefreshCw, bg: 'bg-indigo-500/20 border-indigo-500/30', badge: 'bg-indigo-500', icon_color: 'text-indigo-400' },
  };

  const config = typeConfig[notification.type] || typeConfig.new_stock;
  const Icon = config.icon;

  return (
    <div className={`w-full md:w-[440px] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl border border-white/5 backdrop-blur-sm ${config.bg}`}>
      {/* Header with close button */}
      <div className="flex items-start gap-3 mb-2">
        <div className={`w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center ${config.badge}`}>
          <Icon size={18} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className={`text-[9px] font-bold uppercase tracking-widest ${config.icon_color}`}>{notification.title}</p>
            {notification.quantity && notification.quantity > 1 && (
              <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[8px] font-bold ${config.badge} text-white`}>
                ×{notification.quantity}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold truncate leading-snug text-white">{notification.model}</p>
          <p className="text-[10px] text-gray-400 font-mono mt-0.5">{notification.message}</p>
          {notification.profitAmount !== undefined && (
            <p className={`text-[9px] font-bold mt-1 ${notification.profitAmount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {notification.profitAmount >= 0 ? '✓ Profit' : '⚠ Loss'}: £{Math.abs(notification.profitAmount).toFixed(2)}
            </p>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-white/10 rounded-lg transition-all flex-shrink-0"
          aria-label="Dismiss"
        >
          <X size={14} className="text-gray-500" />
        </button>
      </div>

      {/* Navigation (only show if multiple notifications) */}
      {hasMultiple && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 mt-2">
          <button
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-all disabled:opacity-30 disabled:cursor-default flex-shrink-0"
            aria-label="Previous notification"
          >
            <ChevronLeft size={14} className="text-gray-400" />
          </button>

          <div className="flex-1 text-center">
            <p className="text-[9px] font-mono text-gray-400">
              {currentIndex + 1} <span className="text-gray-600">of</span> {totalCount}
            </p>
          </div>

          <button
            onClick={onNext}
            disabled={currentIndex === totalCount - 1}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-all disabled:opacity-30 disabled:cursor-default flex-shrink-0"
            aria-label="Next notification"
          >
            <ChevronRight size={14} className="text-gray-400" />
          </button>

          <button
            onClick={onDismissAll}
            className="px-2 py-1 text-[8px] font-bold text-gray-400 hover:text-white hover:bg-white/10 rounded transition-all"
            aria-label="Dismiss all"
          >
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
