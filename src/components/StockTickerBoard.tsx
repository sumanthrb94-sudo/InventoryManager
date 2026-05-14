import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { subscribeRecentRemovals, SHSRemovalLogEntry } from '../lib/shsRemovalLog';

// Persistent SHS-removal tape.
//
// Source of truth: the `shsRemovals` Firestore collection, written by
// StockInPage whenever a pending SHS group is delisted. Every device,
// every session, every operator sees the same last 48h history — no
// per-device localStorage state, no dependency on whether a
// notification happened to fire while the user was mounted.

const WINDOW_HOURS = 48;
const REFRESH_TICK_MS = 60_000; // re-render once a minute so "5m"/"1h" advances

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

export default function StockTickerBoard() {
  const [items, setItems] = useState<SHSRemovalLogEntry[]>([]);
  const [, setTick]       = useState(0);

  // Live subscription to recent removals. Server-side filtered to the
  // last 48h, sorted newest-first.
  useEffect(() => {
    return subscribeRecentRemovals(setItems, WINDOW_HOURS);
  }, []);

  // Force a re-render every minute so the "Nm / Nh" labels stay current
  // even when no new removal arrives.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), REFRESH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const isEmpty = items.length === 0;

  // Single compact entry. Used for both the pinned-latest slot and the
  // scrolling marquee. Tight stock-ticker format: model • ×qty • Nh.
  const TickerEntry = ({ item, live }: { item: SHSRemovalLogEntry; live?: boolean }) => {
    const ts = new Date(item.removedAt).getTime();
    return (
      <span className="inline-flex items-center gap-1.5 flex-shrink-0 text-[10px] font-mono tracking-wider whitespace-nowrap">
        {live && (
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
        )}
        <span className="text-orange-200">{item.model}</span>
        <span className="text-orange-400/80">×{item.quantity}</span>
        <span className="text-slate-400">· {Number.isFinite(ts) ? shortAgo(ts) : '—'}</span>
      </span>
    );
  };

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
