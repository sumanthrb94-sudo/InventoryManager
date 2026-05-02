
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, ShoppingBag, X } from 'lucide-react';
import { notificationService, Notification } from '../lib/notificationService';

export default function NotificationToast() {
  const [activeNotification, setActiveNotification] = useState<Notification | null>(null);

  useEffect(() => {
    const unsub = notificationService.subscribe((notifications) => {
      const latest = notifications[0];
      if (latest && !latest.read) {
        // Show as toast if it's new (within last 5 seconds)
        const age = new Date().getTime() - new Date(latest.timestamp).getTime();
        if (age < 5000) {
          setActiveNotification(latest);
          const timer = setTimeout(() => setActiveNotification(null), 5000);
          return () => clearTimeout(timer);
        }
      }
    });
    return unsub;
  }, []);

  return (
    <div className="fixed top-6 right-6 z-[100] pointer-events-none">
      <AnimatePresence>
        {activeNotification && (
          <motion.div
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className="pointer-events-auto bg-black text-white p-4 rounded-2xl shadow-2xl border border-white/10 flex items-center gap-4 min-w-[320px] max-w-[400px]"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              activeNotification.type === 'sold' ? 'bg-emerald-500' : 'bg-blue-500'
            }`}>
              {activeNotification.type === 'sold' ? <ShoppingBag size={20} /> : <CheckCircle2 size={20} />}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-60 mb-0.5">
                {activeNotification.title}
              </h4>
              <p className="text-sm font-bold truncate leading-tight">
                {activeNotification.model}
              </p>
              <p className="text-[10px] text-gray-400 font-mono mt-1">
                {activeNotification.message}
              </p>
            </div>
            <button 
              onClick={() => setActiveNotification(null)}
              className="p-1 hover:bg-white/10 rounded-lg transition-all"
            >
              <X size={16} className="text-gray-500" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
