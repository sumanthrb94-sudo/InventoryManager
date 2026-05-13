import React, { useState, useEffect } from 'react';
import { Trash2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { notificationService, Notification } from '../lib/notificationService';

// Persistent SHS-removal tape.
//
// Requirements (from user):
//   - Tape is visible 24/7 — not only when something new fires.
//   - Each SHS-removed event stays on the tape for 48 hours, with its
//     timestamp (date + time + timezone) so an operator can see
//     when a unit was actually delisted.
//
// We can't lean on notificationService here — it caps history at 24h.
// Persist our own list to localStorage with a 48h TTL, and reconcile
// with the notification stream on every render so events delivered
// while we're mounted get folded in.

interface TickerItem {
  id: string;
  model: string;
  quantity: number;
  removedAt: number; // ms epoch
}

const STORAGE_KEY = 'mpm:shs-removed-tape:v1';
const TTL_MS      = 48 * 60 * 60 * 1000;

function nowTzString(d: Date): string {
  // Intl.DateTimeFormat infers the user's local IANA zone. We render
  // both the date+time and the resolved short timezone name so the
  // operator can confirm "10:23 BST" vs "10:23 IST" etc.
  try {
    const fmt = new Intl.DateTimeFormat(undefined, {
      year:   'numeric',
      month:  'short',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    return fmt.format(d);
  } catch {
    return d.toISOString();
  }
}

function loadFromStorage(): TickerItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: TickerItem[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - TTL_MS;
    return parsed
      .filter(t => typeof t.removedAt === 'number' && t.removedAt >= cutoff)
      .sort((a, b) => b.removedAt - a.removedAt);
  } catch {
    return [];
  }
}

function saveToStorage(items: TickerItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    /* quota — non-fatal */
  }
}

export default function StockTickerBoard() {
  const [items, setItems] = useState<TickerItem[]>(() => loadFromStorage());

  // Reconcile with notificationService whenever the notification list
  // mutates. Any shs_removed entry we haven't already captured gets
  // folded into the persistent tape with the notification's own
  // timestamp.
  useEffect(() => {
    const merge = (notifications: Notification[]) => {
      setItems(prev => {
        const byId = new Map(prev.map(t => [t.id, t]));
        for (const n of notifications) {
          if (n.type !== 'shs_removed') continue;
          if (byId.has(n.id)) continue;
          const removedAt = new Date(n.timestamp).getTime();
          if (!Number.isFinite(removedAt)) continue;
          byId.set(n.id, {
            id: n.id,
            model: n.model || 'Unknown model',
            quantity: n.quantity && n.quantity > 0 ? n.quantity : 1,
            removedAt,
          });
        }
        // Re-apply 48h cutoff (handles items aging out while mounted)
        const cutoff = Date.now() - TTL_MS;
        const next = Array.from(byId.values())
          .filter(t => t.removedAt >= cutoff)
          .sort((a, b) => b.removedAt - a.removedAt);
        saveToStorage(next);
        return next;
      });
    };
    return notificationService.subscribe(merge);
  }, []);

  // Re-evaluate TTL once a minute so items age off without needing a
  // notification mutation to trigger the cleanup.
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - TTL_MS;
      setItems(prev => {
        const next = prev.filter(t => t.removedAt >= cutoff);
        if (next.length === prev.length) return prev;
        saveToStorage(next);
        return next;
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const isEmpty = items.length === 0;

  return (
    <div className="flex-shrink-0 h-8 md:h-9 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 overflow-hidden">
      <div className="h-full flex items-center px-4 md:px-6 gap-4">
        {/* Persistent left-side label so the operator always knows what
         * surface this is, even when no recent removals exist. */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pr-4 border-r border-slate-700">
          <Trash2 size={12} className="text-orange-400" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-orange-300/80">
            SHS Removed · last 48h
          </span>
        </div>

        {/* Right column — either idle text or marquee. The flex-1 +
         * overflow-hidden + relative wrapper clips the marquee to its
         * own column so the scrolling content can't bleed back into
         * the persistent label on the left. */}
        <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden relative">
          {isEmpty ? (
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">
              No delisting actions in the last 48 hours
            </span>
          ) : (
            <motion.div
              animate={{ x: ['100%', '-100%'] }}
              transition={{ duration: 55, repeat: Infinity, ease: 'linear' }}
              className="flex gap-8 whitespace-nowrap absolute left-0 will-change-transform"
            >
              {/* Doubled list for a seamless marquee loop. */}
              {[...items, ...items].map((item, idx) => (
                <div key={`${item.id}-${idx}`} className="flex items-center gap-2 flex-shrink-0">
                  <Trash2 size={13} className="text-orange-400" />
                  <span className="text-[10px] font-mono text-orange-300 uppercase tracking-widest">
                    SHS Unit · {item.model} × {item.quantity} Removed
                  </span>
                  <span className="text-[10px] font-mono text-amber-400 uppercase tracking-widest font-bold">
                    Please Delist
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-300/80 uppercase tracking-widest">
                    <Clock size={10} />
                    {nowTzString(new Date(item.removedAt))}
                  </span>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
