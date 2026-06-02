import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShoppingBag, Package, X, AlertCircle, RefreshCw, Truck, ChevronLeft, ChevronRight } from 'lucide-react';
import { notificationService, Notification } from '../lib/notificationService';

// Banner auto-dismiss window. Short by design: 2 seconds is enough for the
// operator to register the event without the banner blocking the screen.
// The panel (Bell dropdown) keeps a 24-hour retention so dismissing the
// banner here doesn't lose the notification — markAsRead just flags read.
const DISPLAY_MS = 2000;

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

  // Auto-dismiss the current banner after DISPLAY_MS. Runs for every
  // notification — including a lone one — because the panel's 24h
  // retention means dismissing the toast no longer loses the entry.
  // Without this, a single banner stayed on screen until the user
  // clicked the X, blocking content.
  useEffect(() => {
    if (!autoHide || queue.length === 0) return;
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
      // Reached the end of the queue — flag every banner as read (keeps
      // them in the panel for the 24h retention) and clear the local
      // toast queue so the banner UI goes away.
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
  // Icon and color mapping for different notification types.
  //
  // NOTE: `accent` is *border + glow only* — we used to put a translucent
  // `bg-<color>/20` here too, but Tailwind cascade order let that tint
  // override the solid `bg-gray-900` on the outer div, so the whole toast
  // rendered as a 20%-opacity rectangle and you could see the page through
  // it. The dark base now stays solid; colour comes from the accent border,
  // the badge tile, and the icon colour.
  const typeConfig = {
    sold: { icon: ShoppingBag, accent: 'border-emerald-500/40', badge: 'bg-emerald-500', icon_color: 'text-emerald-400' },
    loss_sell: { icon: AlertCircle, accent: 'border-red-500/40', badge: 'bg-red-500', icon_color: 'text-red-400' },
    new_stock: { icon: Package, accent: 'border-blue-500/40', badge: 'bg-blue-500', icon_color: 'text-blue-400' },
    return_processed: { icon: RefreshCw, accent: 'border-amber-500/40', badge: 'bg-amber-500', icon_color: 'text-amber-400' },
    shs_received: { icon: Truck, accent: 'border-purple-500/40', badge: 'bg-purple-500', icon_color: 'text-purple-400' },
    shs_removed: { icon: AlertCircle, accent: 'border-orange-500/40', badge: 'bg-orange-500', icon_color: 'text-orange-400' },
    unit_repaired: { icon: RefreshCw, accent: 'border-indigo-500/40', badge: 'bg-indigo-500', icon_color: 'text-indigo-400' },
  };

  const config = typeConfig[notification.type] || typeConfig.new_stock;
  const Icon = config.icon;

  return (
    <div className={`w-full md:w-[440px] bg-gray-900 text-white px-4 py-3 rounded-lg shadow-xl border ${config.accent}`}>
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
