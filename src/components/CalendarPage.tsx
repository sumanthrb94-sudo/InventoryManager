import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, X, ShoppingBag,
  PackagePlus, RotateCcw, Cpu, TrendingUp, Package
} from 'lucide-react';
import { InventoryUnit, Supplier } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';
import { formatIMEI } from '../lib/imeiUtils';
import { parseBrandModelStorage } from '../lib/modelStorage';

/** Mirror of the deriveSku helper in StockInPage — prefer pre-split fields,
 *  fall back to parsing legacy single-string `model` at runtime. */
function deriveSku(u: InventoryUnit): { brand: string; model: string; storage?: string } {
  if (u.brand && u.storage) {
    return { brand: u.brand, model: u.model, storage: u.storage };
  }
  const p = parseBrandModelStorage(u.model || '');
  return {
    brand: u.brand || p.brand,
    model: p.model || u.model,
    storage: u.storage || p.storage,
  };
}

interface SkuEventGroup {
  key: string;
  sku: { brand: string; model: string; storage?: string };
  colour: string;
  platform: string | undefined;
  events: DayEvent[];
}

/** Collapse a day's per-IMEI events into SKU groups so 14× identical
 *  "iPhone 15 Pro 256GB Natural Titanium" sales render as a single row.
 *  For 'sold' events the platform is part of the key (different platforms
 *  are operationally different sales). */
function groupDayEvents(events: DayEvent[], includePlatformInKey: boolean): SkuEventGroup[] {
  const map = new Map<string, SkuEventGroup>();
  for (const ev of events) {
    const sku = deriveSku(ev.unit);
    const colour = ev.unit.colour && ev.unit.colour !== 'Unknown' ? ev.unit.colour : '';
    const platform = includePlatformInKey ? (ev.platform || '') : '';
    const key = `${sku.brand}|${sku.model}|${sku.storage || ''}|${colour}|${platform}`;
    const existing = map.get(key);
    if (existing) {
      existing.events.push(ev);
    } else {
      map.set(key, { key, sku, colour, platform: includePlatformInKey ? ev.platform : undefined, events: [ev] });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.events.length - a.events.length);
}

type EventType = 'sold' | 'stock_in' | 'returned';

interface DayEvent {
  type: EventType;
  unit: InventoryUnit;
  platform?: string;
}

interface DaySummary {
  sold: DayEvent[];
  stock_in: DayEvent[];
  returned: DayEvent[];
  revenue: number;
}

const PLATFORM_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  eBay:       { bg: 'bg-yellow-100', text: 'text-yellow-800', dot: 'bg-yellow-400' },
  Amazon:     { bg: 'bg-orange-100', text: 'text-orange-800', dot: 'bg-orange-500' },
  OnBuy:      { bg: 'bg-blue-100',   text: 'text-blue-800',   dot: 'bg-blue-500'   },
  Backmarket: { bg: 'bg-green-100',  text: 'text-green-800',  dot: 'bg-green-500'  },
  Other:      { bg: 'bg-gray-100',   text: 'text-gray-700',   dot: 'bg-gray-400'   },
};

function toDateKey(d: Date) {
  return d.toISOString().split('T')[0];
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year: number, month: number) {
  // 0=Sun, shift to Mon=0
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

export default function CalendarPage() {
  const { units, suppliers }    = useInventoryStore();
  const [today]                 = useState(new Date());
  const [cursor, setCursor]     = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDate, setSelectedDate] = useState<string | null>(toDateKey(today));

  const hasAutoNavigated = useRef(false);

  // Auto-navigate once to the month with the most recent data
  useEffect(() => {
    if (hasAutoNavigated.current || units.length === 0) return;
    hasAutoNavigated.current = true;
    const dates = units
      .flatMap(u => [u.saleDate, u.dateIn])
      .filter((d): d is string => !!d)
      .sort()
      .reverse();
    if (dates.length > 0) {
      const mostRecent = new Date(dates[0] + 'T12:00:00');
      if (!isNaN(mostRecent.getTime())) {
        setCursor({ year: mostRecent.getFullYear(), month: mostRecent.getMonth() });
        setSelectedDate(dates[0]);
      }
    }
  }, [units]);

  // Build event map: dateKey → DaySummary
  const eventMap = useMemo(() => {
    const map = new Map<string, DaySummary>();

    const ensure = (d: string): DaySummary => {
      if (!map.has(d)) map.set(d, { sold: [], stock_in: [], returned: [], revenue: 0 });
      return map.get(d)!;
    };

    const toKey = (raw: string | undefined): string | null => {
      if (!raw) return null;
      // Strip time portion if present, normalise slashes to dashes
      const clean = raw.split('T')[0].replace(/\//g, '-');
      // Validate YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
      // Try JS Date parse as fallback
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      return null;
    };

    for (const unit of units) {
      // Stock in
      const stockKey = toKey(unit.dateIn);
      if (stockKey) {
        ensure(stockKey).stock_in.push({ type: 'stock_in', unit });
      }
      // Sold
      const rawSaleDate = unit.saleDate || (unit.status === 'sold' ? unit.dateIn : undefined);
      const soldKey = toKey(rawSaleDate);
      if (soldKey) {
        const day = ensure(soldKey);
        day.sold.push({ type: 'sold', unit, platform: unit.salePlatform });
        day.revenue += unit.salePrice ?? 0;
      }
      // Returned — use updatedAt date if available
      const returnKey = unit.status === 'returned' ? toKey(typeof unit.updatedAt === 'string' ? unit.updatedAt : (unit.updatedAt ? new Date(unit.updatedAt).toISOString() : '')) : null;
      if (returnKey) {
        ensure(returnKey).returned.push({ type: 'returned', unit });
      }
    }
    return map;
  }, [units]);

  const { year, month } = cursor;
  const totalDays  = daysInMonth(year, month);
  const startDay   = firstDayOfMonth(year, month);
  const todayKey   = toDateKey(today);
  const selectedSummary = selectedDate ? eventMap.get(selectedDate) : null;

  // Month-level stats
  const monthStats = useMemo(() => {
    let sold = 0, stockIn = 0, revenue = 0, returned = 0;
    for (let d = 1; d <= totalDays; d++) {
      const key = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const ev  = eventMap.get(key);
      if (ev) {
        sold     += ev.sold.length;
        stockIn  += ev.stock_in.length;
        revenue  += ev.revenue;
        returned += ev.returned.length;
      }
    }
    // Platform breakdown for the month
    const platforms: Record<string, number> = {};
    for (let d = 1; d <= totalDays; d++) {
      const key = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      eventMap.get(key)?.sold.forEach(e => {
        const p = e.platform || 'Other';
        platforms[p] = (platforms[p] || 0) + 1;
      });
    }
    return { sold, stockIn, revenue, returned, platforms };
  }, [eventMap, year, month, totalDays]);

  const prevMonth = () => setCursor(c => {
    const m = c.month === 0 ? 11 : c.month - 1;
    const y = c.month === 0 ? c.year - 1 : c.year;
    return { year: y, month: m };
  });
  const nextMonth = () => setCursor(c => {
    const m = c.month === 11 ? 0 : c.month + 1;
    const y = c.month === 11 ? c.year + 1 : c.year;
    return { year: y, month: m };
  });

  const monthName = new Date(year, month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tighter uppercase font-display">Activity Calendar</h2>
        <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mt-1">
          Date-wise · Sales · Stock in · Returns · IMEI Tracking
        </p>
      </div>

      {/* Month KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Sold',       value: monthStats.sold,    icon: <ShoppingBag size={13} />, color: 'text-black' },
          { label: 'Revenue',    value: `£${monthStats.revenue.toLocaleString()}`, icon: <TrendingUp size={13} />, color: 'text-emerald-600' },
          { label: 'Stock In',   value: monthStats.stockIn, icon: <PackagePlus size={13} />, color: 'text-blue-600' },
          { label: 'Returned',   value: monthStats.returned, icon: <RotateCcw size={13} />, color: 'text-orange-500' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
            <div className={`${k.color}`}>{k.icon}</div>
            <div>
              <p className="text-lg font-bold font-display tracking-tighter">{k.value}</p>
              <p className="text-[9px] text-gray-400 font-mono uppercase tracking-wider">{k.label} this month</p>
            </div>
          </div>
        ))}
      </div>

      {/* Platform breakdown */}
      {Object.keys(monthStats.platforms).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(monthStats.platforms)
            .sort((a,b) => (b[1] as number) - (a[1] as number))
            .map(([p, count]) => {
              const cfg = PLATFORM_COLORS[p] || PLATFORM_COLORS.Other;
              return (
                <span key={p} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold font-mono uppercase ${cfg.bg} ${cfg.text}`}>
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  {p} · {count} units
                </span>
              );
            })}
        </div>
      )}

      {/* Calendar */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Nav */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <button onClick={prevMonth} className="p-2 rounded-xl hover:bg-gray-100 transition-all">
            <ChevronLeft size={16} />
          </button>
          <h3 className="font-bold text-sm tracking-tight uppercase">{monthName}</h3>
          <button onClick={nextMonth} className="p-2 rounded-xl hover:bg-gray-100 transition-all">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {DAY_LABELS.map(d => (
            <div key={d} className="py-2 text-center text-[9px] font-bold font-mono uppercase tracking-widest text-gray-400">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7">
          {/* Empty cells for offset */}
          {Array.from({ length: startDay }).map((_, i) => (
            <div key={`e-${i}`} className="h-14 md:h-20 border-b border-r border-gray-50 bg-gray-50/30" />
          ))}

          {Array.from({ length: totalDays }).map((_, i) => {
            const day    = i + 1;
            const dateKey = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const ev     = eventMap.get(dateKey);
            const isToday    = dateKey === todayKey;
            const isSelected = dateKey === selectedDate;
            const hasSold    = (ev?.sold.length ?? 0) > 0;
            const hasStock   = (ev?.stock_in.length ?? 0) > 0;
            const hasReturn  = (ev?.returned.length ?? 0) > 0;

            return (
              <button
                key={dateKey}
                onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                className={`h-14 md:h-20 border-b border-r border-gray-50 p-1.5 text-left transition-all relative ${
                  isSelected ? 'bg-black' :
                  isToday    ? 'bg-gray-950' :
                  ev         ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'
                }`}
              >
                {/* Day number */}
                <span className={`text-[11px] font-bold font-mono block leading-none ${
                  isSelected || isToday ? 'text-white' : 'text-gray-700'
                }`}>
                  {String(day).padStart(2,'0')}
                </span>

                {/* Indicator dots */}
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {hasSold && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-green-400' : 'bg-green-500'}`} title={`${ev!.sold.length} sold`} />
                  )}
                  {hasStock && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-blue-300' : 'bg-blue-500'}`} title={`${ev!.stock_in.length} in`} />
                  )}
                  {hasReturn && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-orange-300' : 'bg-orange-400'}`} title={`${ev!.returned.length} returned`} />
                  )}
                </div>

                {/* Count badge on md+ */}
                {hasSold && (
                  <span className={`hidden md:block absolute bottom-1.5 right-1.5 text-[8px] font-bold font-mono px-1 py-0.5 rounded-md ${
                    isSelected ? 'bg-green-500 text-white' : 'bg-green-100 text-green-800'
                  }`}>
                    £{(ev?.revenue ?? 0).toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 px-5 py-3 border-t border-gray-100 bg-gray-50">
          {[
            { dot: 'bg-green-500',  label: 'Sold' },
            { dot: 'bg-blue-500',   label: 'Stock In' },
            { dot: 'bg-orange-400', label: 'Returned' },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${l.dot}`} />
              <span className="text-[9px] text-gray-500 font-mono uppercase tracking-wide">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Day detail panel */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
          >
            {/* Day header */}
            <div className="px-5 py-4 bg-gray-950 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-base">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <div className="flex items-center gap-4 mt-1.5">
                  {selectedSummary ? (
                    <>
                      <span className="text-[10px] text-green-400 font-mono">{selectedSummary.sold.length} sold · £{selectedSummary.revenue.toLocaleString()}</span>
                      <span className="text-[10px] text-blue-400 font-mono">{selectedSummary.stock_in.length} stock in</span>
                      {selectedSummary.returned.length > 0 && <span className="text-[10px] text-orange-400 font-mono">{selectedSummary.returned.length} returned</span>}
                    </>
                  ) : (
                    <span className="text-[10px] text-gray-500 font-mono">No activity recorded</span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedDate(null)} className="text-gray-500 hover:text-white transition-all">
                <X size={18} />
              </button>
            </div>

            {!selectedSummary ? (
              <div className="py-12 flex flex-col items-center text-gray-300 gap-3">
                <Package size={36} />
                <p className="text-xs font-mono text-gray-400 uppercase tracking-widest">No activity on this date</p>
              </div>
            ) : (
              <div>

                {/* Sales — SKU-grouped (platform is part of the key so the
                    same SKU sold on eBay vs Amazon stays in separate rows). */}
                {selectedSummary.sold.length > 0 && (
                  <Section
                    title="Sales"
                    count={selectedSummary.sold.length}
                    icon={<ShoppingBag size={13} />}
                    color="text-green-600"
                    defaultOpen={false}
                  >
                    {/* Platform pills */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(() => {
                        const pm: Record<string, number> = {};
                        selectedSummary.sold.forEach(e => { const p = e.platform || 'Other'; pm[p] = (pm[p]||0)+1; });
                        return Object.entries(pm).map(([p, c]) => {
                          const cfg = PLATFORM_COLORS[p] || PLATFORM_COLORS.Other;
                          return (
                            <span key={p} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono ${cfg.bg} ${cfg.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                              {p} · {c}
                            </span>
                          );
                        });
                      })()}
                    </div>
                    <div className="space-y-2">
                      {groupDayEvents(selectedSummary.sold, true).map(group => (
                        <SkuGroupRow key={group.key} group={group} suppliers={suppliers} type="sold" />
                      ))}
                    </div>
                  </Section>
                )}

                {/* Stock In — SKU-grouped */}
                {selectedSummary.stock_in.length > 0 && (
                  <Section title="Stock Received" count={selectedSummary.stock_in.length} icon={<PackagePlus size={13} />} color="text-blue-600">
                    <div className="space-y-2">
                      {groupDayEvents(selectedSummary.stock_in, false).map(group => (
                        <SkuGroupRow key={group.key} group={group} suppliers={suppliers} type="stock_in" />
                      ))}
                    </div>
                  </Section>
                )}

                {/* Returned — SKU-grouped */}
                {selectedSummary.returned.length > 0 && (
                  <Section title="Returns" count={selectedSummary.returned.length} icon={<RotateCcw size={13} />} color="text-orange-500">
                    <div className="space-y-2">
                      {groupDayEvents(selectedSummary.returned, false).map(group => (
                        <SkuGroupRow key={group.key} group={group} suppliers={suppliers} type="returned" />
                      ))}
                    </div>
                  </Section>
                )}

              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Section wrapper (collapsible accordion) ─────────────────────────────────
function Section({ title, count, icon, color, defaultOpen = false, children }: {
  key?: string; title: string; count: number; icon: React.ReactNode;
  color: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-50 last:border-0">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-5 py-3.5 hover:bg-gray-50 transition-all text-left"
      >
        <span className={`${color} flex-shrink-0`}>{icon}</span>
        <p className={`text-[11px] font-bold uppercase tracking-widest ${color} flex-1`}>{title}</p>
        <span className="text-[9px] font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full mr-2">{count}</span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 flex-shrink-0 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {/* Body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── SKU group row ──────────────────────────────────────────────────────────
// Collapses N identical-SKU events on the same day into a single expandable
// row with a ×N badge and chevron — expand to see per-IMEI children where the
// existing per-unit `UnitRow` still renders for the single-unit workflow.
function SkuGroupRow({
  group, suppliers, type,
}: {
  key?: string; group: SkuEventGroup; suppliers: Supplier[]; type: EventType;
}) {
  const [open, setOpen] = useState(false);
  const qty = group.events.length;
  const totalSalePrice = type === 'sold'
    ? group.events.reduce((s, e) => s + (e.unit.salePrice || 0), 0)
    : 0;
  const totalBP = type === 'stock_in'
    ? group.events.reduce((s, e) => s + (e.unit.buyPrice || 0), 0)
    : 0;
  const pCfg = group.platform ? (PLATFORM_COLORS[group.platform] || PLATFORM_COLORS.Other) : null;
  const titleParts = [
    group.sku.brand,
    group.sku.model,
    group.sku.storage,
    group.colour || null,
  ].filter(Boolean);

  // Single-event groups don't need an expansion control — render as a flat row
  // so the visual matches the original UnitRow for the common case.
  if (qty === 1) return <UnitRow event={group.events[0]} suppliers={suppliers} type={type} />;

  return (
    <div className="bg-gray-50 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-gray-100 transition-all"
      >
        <Cpu size={12} className="text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs font-bold truncate">{titleParts.join(' · ')}</p>
            <span className="text-[9px] font-bold text-gray-700 bg-gray-200 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
              ×{qty}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {type === 'sold' && totalSalePrice > 0 && (
            <span className="text-xs font-bold font-mono text-green-700">£{totalSalePrice.toLocaleString()}</span>
          )}
          {type === 'stock_in' && totalBP > 0 && (
            <span className="text-[10px] font-mono text-gray-600">BP £{totalBP.toLocaleString()}</span>
          )}
          {pCfg && group.platform && (
            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full font-mono ${pCfg.bg} ${pCfg.text}`}>
              {group.platform}
            </span>
          )}
        </div>
        <span className="p-1 text-gray-400 flex-shrink-0">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-white border-t border-gray-200"
          >
            <div className="p-2 space-y-2">
              {group.events.map(ev => (
                <UnitRow key={ev.unit.id} event={ev} suppliers={suppliers} type={type} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Unit row ────────────────────────────────────────────────────────────────
function UnitRow({ event, suppliers, type }: { key?: string; event: DayEvent; suppliers: Supplier[]; type: EventType }) {
  const { unit } = event;
  const supplier = suppliers.find(s => s.id === unit.supplierId);
  const pCfg = event.platform ? (PLATFORM_COLORS[event.platform] || PLATFORM_COLORS.Other) : null;

  return (
    <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
      <Cpu size={12} className="text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold truncate">{unit.model}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <p className="text-[9px] text-gray-500 font-mono">{formatIMEI(unit.imei) || '—'}</p>
          <span className="text-[9px] text-gray-400 font-mono">{unit.colour}</span>
          {supplier && <span className="text-[9px] text-gray-400 font-mono">via {supplier.name}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {type === 'sold' && unit.salePrice && (
          <span className="text-xs font-bold font-mono text-green-700">£{unit.salePrice}</span>
        )}
        {type === 'stock_in' && (
          <span className="text-[10px] font-mono text-gray-600">BP £{unit.buyPrice}</span>
        )}
        {pCfg && event.platform && (
          <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full font-mono ${pCfg.bg} ${pCfg.text}`}>
            {event.platform}
          </span>
        )}
      </div>
    </div>
  );
}
