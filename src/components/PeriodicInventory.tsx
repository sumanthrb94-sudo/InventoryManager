import React, { useMemo, useState, useRef, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../types';
import ViewAllUnitsModal from './ViewAllUnitsModal';
import PeriodicTableSidebar from './PeriodicTableSidebar';

interface Props {
  units: InventoryUnit[];
  onNavigate: (search: string) => void;
}

const BRAND_GROUPS = [
  {
    id: 'apple-iphones',
    label: 'Apple iPhones',
    color: { bg: '#1d4ed8', light: '#dbeafe', text: '#1e3a8a', border: '#93c5fd' },
    match: (m: string) => /iphone/i.test(m),
    seriesFn: (m: string) => {
      const num = m.match(/\d+/)?.[0] || '';
      return `iPhone ${num}`;
    },
  },
  {
    id: 'apple-ipads',
    label: 'Apple iPads',
    color: { bg: '#7c3aed', light: '#ede9fe', text: '#4c1d95', border: '#c4b5fd' },
    match: (m: string) => /ipad/i.test(m),
    seriesFn: (m: string) => {
      const mL = m.toLowerCase();
      if (mL.includes('pro')) return 'iPad Pro';
      if (mL.includes('air')) return 'iPad Air';
      if (mL.includes('mini')) return 'iPad Mini';
      return 'iPad';
    },
  },
  {
    id: 'samsung-s',
    label: 'Samsung S Series',
    color: { bg: '#d97706', light: '#fef3c7', text: '#78350f', border: '#fcd34d' },
    match: (m: string) => /galaxy\s+s\d/i.test(m),
    seriesFn: (m: string) => {
      const numMatch = m.match(/S\s*(\d+)/i);
      return `Galaxy S${numMatch?.[1] || ''}`;
    },
  },
  {
    id: 'samsung-a',
    label: 'Samsung A Series',
    color: { bg: '#059669', light: '#d1fae5', text: '#064e3b', border: '#6ee7b7' },
    match: (m: string) => /galaxy\s+a\d/i.test(m),
    seriesFn: (m: string) => {
      const numMatch = m.match(/A\s*(\d+)/i);
      return `Galaxy A${numMatch?.[1] || ''}`;
    },
  },
  {
    id: 'samsung-tabs',
    label: 'Samsung Tabs',
    color: { bg: '#0891b2', light: '#cffafe', text: '#164e63', border: '#67e8f9' },
    match: (m: string) => /(galaxy\s+tab|galaxy\s+z)/i.test(m),
    seriesFn: (m: string) => {
      const mL = m.toLowerCase();
      if (mL.includes('fold')) return 'Z Fold';
      if (mL.includes('flip')) return 'Z Flip';
      const tabMatch = m.match(/Tab\s+(\w+\d*)/i);
      return tabMatch ? `Tab ${tabMatch[1]}` : 'Tab';
    },
  },
];

interface Element {
  seriesKey: string;
  symbol: string;
  count: number;
  shsCount: number;
  value: number;
  searchTerm: string;
  ordinal: number;
  variants: { colour: string; count: number }[];
  storageVariants: { storage: string; count: number }[];
  priceRange: { min: number; max: number };
}

// sort 64GB < 128GB < 256GB < 512GB < 1TB
function storageGb(s: string): number {
  const m = s.match(/(\d+)\s*(TB|GB)/i);
  if (!m) return 9999;
  return parseInt(m[1]) * (m[2].toUpperCase() === 'TB' ? 1024 : 1);
}

function makeSymbol(seriesKey: string, groupId: string): string {
  const mL = seriesKey.toLowerCase();
  if (groupId === 'apple-iphones') {
    const num = seriesKey.match(/\d+/)?.[0] || '';
    if (mL.includes('pro max')) return `i${num}PM`;
    if (mL.includes('pro')) return `i${num}P`;
    if (mL.includes('plus')) return `i${num}+`;
    if (mL.includes('mini')) return `i${num}M`;
    return `i${num}`;
  }
  if (groupId === 'apple-ipads') {
    if (mL.includes('pro')) return 'iPP';
    if (mL.includes('air')) return 'iPA';
    if (mL.includes('mini')) return 'iPM';
    return 'iPd';
  }
  if (groupId === 'samsung-s') {
    const num = seriesKey.match(/\d+/)?.[0] || '';
    if (mL.includes('ultra')) return `S${num}U`;
    if (mL.includes('plus')) return `S${num}+`;
    return `S${num}`;
  }
  if (groupId === 'samsung-a') {
    const num = seriesKey.match(/\d+/)?.[0] || '';
    return `A${num}`;
  }
  if (groupId === 'samsung-tabs') {
    if (mL.includes('fold')) return 'ZFd';
    if (mL.includes('flip')) return 'ZFp';
    const num = seriesKey.match(/\d+/)?.[0] || '';
    return `T${num}`;
  }
  return seriesKey.slice(0, 3).toUpperCase();
}

interface PopoverState {
  el: Element;
  color: { bg: string; light: string; text: string; border: string };
  rect: DOMRect;
}

// accent colour for variant count badge — derived from group light colour
function accentColor(light: string): string {
  if (light === '#dbeafe') return '#3b82f6';
  if (light === '#ede9fe') return '#8b5cf6';
  if (light === '#fef3c7') return '#f59e0b';
  if (light === '#d1fae5') return '#10b981';
  if (light === '#cffafe') return '#06b6d4';
  return '#94a3b8';
}

function Popover({
  state,
  onNavigate,
  onViewAll,
  onMouseEnter,
  onMouseLeave,
}: {
  state: PopoverState;
  onNavigate: (s: string) => void;
  onViewAll: (seriesKey: string, searchTerm: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { el, color, rect } = state;

  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove  = spaceBelow < 310;

  const style: React.CSSProperties = {
    position:     'fixed',
    left:         Math.max(8, Math.min(rect.left, window.innerWidth - 264)),
    zIndex:       9999,
    width:        252,
    background:   '#0f172a',
    border:       `1.5px solid ${color.bg}50`,
    borderRadius: 12,
    boxShadow:    `0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px ${color.bg}20`,
    overflow:     'hidden',
    pointerEvents: 'auto',
  };

  if (showAbove) {
    style.bottom = window.innerHeight - rect.top + 8;
  } else {
    style.top = rect.bottom + 8;
  }

  const accent = accentColor(color.light);

  return (
    <div style={style} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {/* Header */}
      <div style={{ background: color.bg, padding: '10px 12px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {el.seriesKey}
            </div>
            {el.count > 0 && (
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.65)', marginTop: 3, fontFamily: 'monospace' }}>
                Buy £{el.priceRange.min === el.priceRange.max
                  ? el.priceRange.min
                  : `${el.priceRange.min}–${el.priceRange.max}`}
                &nbsp;·&nbsp;£{el.value.toLocaleString()} total
              </div>
            )}
          </div>
          {/* Stock counts */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <div style={{ textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: 7, padding: '4px 8px', minWidth: 36 }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{el.count}</div>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>in office</div>
            </div>
            {el.shsCount > 0 && (
              <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.12)', borderRadius: 7, padding: '4px 8px', minWidth: 36, border: '1px solid rgba(253,230,138,0.4)' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fde68a', lineHeight: 1 }}>{el.shsCount}</div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>supplier</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Colour variants */}
      {el.variants.length > 0 && (
        <div style={{ padding: '8px 12px 6px' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Colour Variants — {el.variants.reduce((s, v) => s + v.count, 0)} units
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {el.variants.map(v => {
              const pct = Math.round((v.count / el.count) * 100);
              return (
                <div key={v.colour}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: '#cbd5e1', fontFamily: 'monospace' }}>{v.colour}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: '#f1f5f9' }}>{v.count}</span>
                      <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>{pct}%</span>
                    </div>
                  </div>
                  {/* mini progress bar */}
                  <div style={{ height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: accent, borderRadius: 2, transition: 'width 0.3s' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Storage variants */}
      {el.storageVariants.length > 0 && (
        <div style={{ padding: '7px 12px 5px', borderTop: '1px solid #1e293b' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Storage — {el.count} units
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {el.storageVariants.map(v => {
              const pct = Math.round((v.count / el.count) * 100);
              return (
                <div key={v.storage} style={{
                  background: '#1e293b', borderRadius: 6, padding: '4px 8px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                  minWidth: 48,
                }}>
                  <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: '#f1f5f9', lineHeight: 1 }}>{v.count}</span>
                  <span style={{ fontSize: 8, fontFamily: 'monospace', color: accent, letterSpacing: '0.04em' }}>{v.storage}</span>
                  <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#475569' }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SHS note */}
      {el.shsCount > 0 && (
        <div style={{ margin: '0 12px 6px', padding: '6px 8px', background: 'rgba(253,230,138,0.08)', borderRadius: 6, border: '1px solid rgba(253,230,138,0.15)' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#fde68a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>
            SHS — Listed with Supplier
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>
            {el.shsCount} unit{el.shsCount > 1 ? 's' : ''} held by supplier · order to fulfil
          </div>
        </div>
      )}

      {/* CTA */}
      {el.count > 0 && (
        <div style={{ padding: '6px 12px 10px' }}>
          <button
            onClick={() => onViewAll(el.seriesKey, el.searchTerm)}
            style={{
              width: '100%', padding: '7px', background: color.bg, border: 'none',
              borderRadius: 7, color: '#fff', fontSize: 10, fontWeight: 700,
              fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em',
              cursor: 'pointer',
            }}
          >
            View All {el.count} Units →
          </button>
        </div>
      )}
    </div>
  );
}

export default function PeriodicInventory({ units, onNavigate }: Props) {
  const available = units.filter(u => u.status === 'available');
  const incoming  = units.filter(u => u.status === 'incoming');

  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [viewAllModal, setViewAllModal] = useState<{ seriesKey: string; searchTerm: string } | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<{ seriesKey: string; searchTerm: string } | null>(null);
  // Refs for the hover grace-period timers
  const closeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const todaySold     = units.filter(u => u.status === 'sold' && (u.saleDate || u.dateIn) === today);
  const todayReturned = units.filter(u => u.status === 'returned' && u.returnDate === today);

  const groups = useMemo(() => {
    try {
    return BRAND_GROUPS.map(group => {
      const groupUnits    = available.filter(u => group.match(u.model));
      const groupIncoming = incoming.filter(u => group.match(u.model));

      const seriesMap: Record<string, {
        count: number; shsCount: number; value: number; searchTerm: string;
        variants: Record<string, number>; storages: Record<string, number>; prices: number[];
      }> = {};

      for (const u of groupUnits) {
        const sk = group.seriesFn(u.model);
        if (!seriesMap[sk]) seriesMap[sk] = { count: 0, shsCount: 0, value: 0, searchTerm: sk, variants: {}, storages: {}, prices: [] };
        seriesMap[sk].count++;
        seriesMap[sk].value += u.buyPrice;
        seriesMap[sk].prices.push(u.buyPrice);
        const col = u.colour || 'Unknown';
        seriesMap[sk].variants[col] = (seriesMap[sk].variants[col] || 0) + 1;
        if (u.storage) {
          seriesMap[sk].storages[u.storage] = (seriesMap[sk].storages[u.storage] || 0) + 1;
        }
      }

      for (const u of groupIncoming) {
        const sk = group.seriesFn(u.model);
        if (!seriesMap[sk]) seriesMap[sk] = { count: 0, shsCount: 0, value: 0, searchTerm: sk, variants: {}, storages: {}, prices: [] };
        seriesMap[sk].shsCount++;
      }

      const elements: Element[] = Object.entries(seriesMap)
        .map(([sk, d], i) => ({
          seriesKey:  sk,
          symbol:     makeSymbol(sk, group.id),
          count:      d.count,
          shsCount:   d.shsCount,
          value:      d.value,
          searchTerm: d.searchTerm,
          ordinal:    i + 1,
          variants: Object.entries(d.variants || {})
            .sort(([, a], [, b]) => b - a)
            .map(([colour, count]) => ({ colour, count })),
          storageVariants: Object.entries(d.storages || {})
            .sort(([a], [b]) => storageGb(a) - storageGb(b))
            .map(([storage, count]) => ({ storage, count })),
          priceRange: d.prices.length
            ? { min: Math.min(...d.prices), max: Math.max(...d.prices) }
            : { min: 0, max: 0 },
        }))
        .sort((a, b) => {
          const na = parseInt(a.seriesKey.match(/\d+/)?.[0] || '0');
          const nb = parseInt(b.seriesKey.match(/\d+/)?.[0] || '0');
          return nb - na;
        })
        .map((el, i) => ({ ...el, ordinal: i + 1 }));

      return {
        ...group, elements,
        totalCount: groupUnits.length,
        totalValue: groupUnits.reduce((s, u) => s + u.buyPrice, 0),
      };
    }).filter(g => g.elements.length > 0);
    } catch (e) {
      console.error('PeriodicInventory groups error:', e);
      return [];
    }
  }, [available, incoming]);

  // ── Hover handlers with grace-period so cursor can reach the popover ─────────
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPopover(null), 180);
  }, [cancelClose]);

  const handleElementEnter = useCallback((
    el: Element,
    color: { bg: string; light: string; text: string; border: string },
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    cancelClose();
    if (el.count === 0 && el.shsCount === 0) return;
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setPopover({ el, color, rect });
  }, [cancelClose]);

  if (groups.length === 0) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full lg:h-auto">
      <div className="lg:col-span-2">
        <div style={{ background: '#0f172a', borderRadius: 20, padding: '20px 16px', overflowX: 'auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#64748b', marginBottom: 2 }}>
                Inventory Periodic Table
              </p>
              <p style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em', textTransform: 'uppercase' }}>
                Stock Visibility
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8' }}>{available.length} units</p>
              <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>
                {incoming.length > 0 ? `+ ${incoming.length} w/ supplier` : 'in office'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, background: '#1e293b', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Sold Today</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#34d399' }}>{todaySold.length}</span>
            </div>
            <div style={{ flex: 1, background: '#1e293b', borderRadius: 8, padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#94a3b8' }}>Returned Today</span>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', color: '#fbbf24' }}>{todayReturned.length}</span>
            </div>
          </div>
        </div>

        {/* Group legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {groups.map(g => (
            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: g.color.bg }} />
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{g.label}</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#475569' }}>({g.totalCount})</span>
            </div>
          ))}
        </div>

        {/* Periodic rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(g => (
            <div key={g.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em', color: g.color.bg, fontWeight: 700, minWidth: 80, flexShrink: 0 }}>
                  {g.label}
                </div>
                <div style={{ flex: 1, height: 1, background: `${g.color.bg}30` }} />
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#475569' }}>£{g.totalValue.toLocaleString()} stock</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.elements.map(el => {
                  const isHovered = popover?.el.seriesKey === el.seriesKey;
                  const isEmpty   = el.count === 0 && el.shsCount === 0;
                  return (
                    <button
                      key={el.seriesKey}
                      onMouseEnter={e => handleElementEnter(el, g.color, e)}
                      onMouseLeave={scheduleClose}
                      onClick={() => {
                        if (el.count > 0) {
                          onNavigate(el.searchTerm);
                          setSelectedSeries({ seriesKey: el.seriesKey, searchTerm: el.searchTerm });
                        }
                      }}
                      title={isEmpty ? el.seriesKey : undefined}
                      style={{
                        width: 72, height: 72,
                        background: isEmpty ? '#1e293b' : isHovered ? g.color.bg : g.color.light,
                        border: `1.5px solid ${isEmpty ? '#334155' : isHovered ? g.color.bg : g.color.border}`,
                        borderRadius: 8,
                        padding: '5px 4px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        cursor: isEmpty ? 'default' : 'pointer',
                        transition: 'transform 0.1s, box-shadow 0.1s, background 0.1s',
                        transform: isHovered && !isEmpty ? 'scale(1.1)' : 'scale(1)',
                        boxShadow: isHovered && !isEmpty ? `0 0 0 2px ${g.color.bg}, 0 4px 12px rgba(0,0,0,0.3)` : 'none',
                        opacity: isEmpty ? 0.35 : 1,
                      }}
                    >
                      {/* Ordinal + count */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                        <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700, color: isHovered ? 'rgba(255,255,255,0.6)' : g.color.text, opacity: 0.7 }}>
                          {el.ordinal}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 800, color: isHovered ? '#fff' : g.color.text }}>
                            {el.count}
                          </span>
                          {el.shsCount > 0 && (
                            <span style={{ fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: '#fbbf24', lineHeight: 1 }}>
                              +{el.shsCount}S
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Symbol */}
                      <div style={{ textAlign: 'center', lineHeight: 1 }}>
                        <span style={{
                          fontSize: el.symbol.length > 4 ? 13 : 17,
                          fontWeight: 900,
                          color: isHovered ? '#fff' : g.color.text,
                          fontFamily: 'system-ui, sans-serif',
                          letterSpacing: '-0.04em',
                        }}>
                          {el.symbol}
                        </span>
                      </div>

                      {/* Series name */}
                      <div style={{ width: '100%', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 6.5, fontFamily: 'monospace',
                          color: isHovered ? 'rgba(255,255,255,0.8)' : g.color.text,
                          opacity: 0.75, lineHeight: 1.2, display: 'block',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {el.seriesKey}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {groups.some(g => g.elements.some(el => el.shsCount > 0)) && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#fbbf24', fontFamily: 'monospace', fontWeight: 700 }}>+NS</span>
            <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>= N units listed with supplier (hover for details)</span>
          </div>
        )}
      </div>
      </div>

      {/* Sidebar - visible on lg screens */}
      <div className="lg:col-span-1">
        <PeriodicTableSidebar
          seriesKey={selectedSeries?.seriesKey || null}
          searchTerm={selectedSeries?.searchTerm || null}
          units={units}
          onViewAll={(seriesKey, searchTerm) => {
            setViewAllModal({ seriesKey, searchTerm });
            setSelectedSeries(null);
          }}
        />
      </div>

      {/* Popover removed - replaced with sidebar on desktop, modal available on mobile */}
      {/* {popover && (
        <Popover
          state={popover}
          onNavigate={s => { onNavigate(s); setPopover(null); }}
          onViewAll={(seriesKey, searchTerm) => { setViewAllModal({ seriesKey, searchTerm }); setPopover(null); }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )} */}

      {/* View All Units Modal */}
      <AnimatePresence>
        {viewAllModal && (
          <ViewAllUnitsModal
            seriesKey={viewAllModal.seriesKey}
            searchTerm={viewAllModal.searchTerm}
            units={units}
            onClose={() => setViewAllModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
