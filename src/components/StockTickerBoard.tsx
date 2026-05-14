import React, { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
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

// Compact "time-ago" for the tape. Real stock tickers use short codes
// (5m, 2h, 1d) — full timestamps eat the row and force the model name
// to truncate. The full datetime is still available in the bell panel.
function shortAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000)           return 'now';
  const m = Math.floor(diff / 60_000);
  if (m < 60)                  return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)                  return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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

  // Single compact entry. Used for both the pinned-latest slot and the
  // scrolling marquee. Tight stock-ticker format: model • ×qty • Nh.
  const TickerEntry = ({ item, live }: { item: TickerItem; live?: boolean }) => (
    <span className="inline-flex items-center gap-1.5 flex-shrink-0 text-[10px] font-mono tracking-wider whitespace-nowrap">
      {live && (
        <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
      )}
      <span className="text-orange-200">{item.model}</span>
      <span className="text-orange-400/80">×{item.quantity}</span>
      <span className="text-slate-400">· {shortAgo(item.removedAt)}</span>
    </span>
  );

  return (
    <div className="flex-shrink-0 h-7 md:h-8 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 overflow-hidden">
      <div className="h-full flex items-center px-3 md:px-4 gap-3">
        {/* Compact left label. Stays visible even with zero entries. */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pr-3 border-r border-slate-700/80">
          <Trash2 size={11} className="text-orange-400" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-orange-300/80">
            SHS Delist · 48h
          </span>
        </div>

        {/* Pinned latest entry — short form, no extra prose. */}
        {!isEmpty && (
          <div className="flex-shrink-0 pr-3 border-r border-slate-700/80 max-w-[40%] overflow-hidden">
            <TickerEntry item={items[0]} live />
          </div>
        )}

        {/* Right column — marquee of older entries, or idle text. */}
        <div className="flex-1 min-w-0 h-full flex items-center overflow-hidden relative">
          {isEmpty ? (
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
              No delisting actions · last 48h
            </span>
          ) : items.length > 1 ? (
            <motion.div
              animate={{ x: ['100%', '-100%'] }}
              transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
              className="flex gap-6 whitespace-nowrap absolute left-0 will-change-transform"
            >
              {[...items.slice(1), ...items.slice(1)].map((item, idx) => (
                <TickerEntry key={`${item.id}-${idx}`} item={item} />
              ))}
            </motion.div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
