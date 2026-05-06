import React, { useMemo, useState, useRef, useEffect } from 'react';
import { InventoryUnit } from '../types';

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
  count: number;       // available in office
  shsCount: number;    // listed with supplier (incoming)
  value: number;
  searchTerm: string;
  ordinal: number;
  variants: { colour: string; count: number; models: string[] }[];
  priceRange: { min: number; max: number };
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

function Popover({ state, onClose, onNavigate }: {
  state: PopoverState;
  onClose: () => void;
  onNavigate: (s: string) => void;
}) {
  const { el, color, rect } = state;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Position: above or below the element
  const spaceBelow = window.innerHeight - rect.bottom;
  const showAbove  = spaceBelow < 280;

  const style: React.CSSProperties = {
    position: 'fixed',
    left:     Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
    zIndex:   9999,
    width:    248,
    background: '#0f172a',
    border: `1.5px solid ${color.bg}40`,
    borderRadius: 12,
    boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${color.bg}20`,
    overflow: 'hidden',
  };

  if (showAbove) {
    style.bottom = window.innerHeight - rect.top + 6;
  } else {
    style.top = rect.bottom + 6;
  }

  return (
    <div ref={ref} style={style}>
      {/* Header */}
      <div style={{ background: color.bg, padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
            {el.seriesKey}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{el.count}</div>
              <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>in office</div>
            </div>
            {el.shsCount > 0 && (
              <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.15)', borderRadius: 6, padding: '2px 6px' }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#fde68a', lineHeight: 1 }}>{el.shsCount}</div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>w/ supplier</div>
              </div>
            )}
          </div>
        </div>
        {el.count > 0 && (
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 3, fontFamily: 'monospace' }}>
            Buy £{el.priceRange.min === el.priceRange.max
              ? el.priceRange.min
              : `${el.priceRange.min}–${el.priceRange.max}`}
            &nbsp;·&nbsp;
            £{el.value.toLocaleString()} stock value
          </div>
        )}
      </div>

      {/* Colour variants */}
      {el.variants.length > 0 && (
        <div style={{ padding: '8px 12px 4px' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#475569', marginBottom: 6 }}>
            Colour Variants
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {el.variants.map(v => (
              <div key={v.colour} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{v.colour}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                  background: color.bg + '25',
                  color: color.light === '#dbeafe' ? '#60a5fa' : color.light === '#fef3c7' ? '#fbbf24' : color.light === '#d1fae5' ? '#34d399' : color.light === '#cffafe' ? '#22d3ee' : '#a78bfa',
                  padding: '1px 6px', borderRadius: 4,
                }}>
                  {v.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      <div style={{ padding: '8px 12px 10px' }}>
        <button
          onClick={() => { onNavigate(el.searchTerm); onClose(); }}
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
    </div>
  );
}

export default function PeriodicInventory({ units, onNavigate }: Props) {
  const available = units.filter(u => u.status === 'available');
  const incoming  = units.filter(u => u.status === 'incoming');

  const [popover, setPopover] = useState<PopoverState | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const todaySold     = units.filter(u => u.status === 'sold' && (u.saleDate || u.dateIn) === today);
  const todayReturned = units.filter(u => u.status === 'returned' && u.returnDate === today);

  const groups = useMemo(() => {
    return BRAND_GROUPS.map(group => {
      const groupUnits    = available.filter(u => group.match(u.model));
      const groupIncoming = incoming.filter(u => group.match(u.model));

      const seriesMap: Record<string, {
        count: number; shsCount: number; value: number; searchTerm: string;
        variants: Record<string, number>; prices: number[];
      }> = {};

      for (const u of groupUnits) {
        const sk = group.seriesFn(u.model);
        if (!seriesMap[sk]) seriesMap[sk] = { count: 0, shsCount: 0, value: 0, searchTerm: sk, variants: {}, prices: [] };
        seriesMap[sk].count++;
        seriesMap[sk].value += u.buyPrice;
        seriesMap[sk].prices.push(u.buyPrice);
        const col = u.colour || 'Unknown';
        seriesMap[sk].variants[col] = (seriesMap[sk].variants[col] || 0) + 1;
      }

      for (const u of groupIncoming) {
        const sk = group.seriesFn(u.model);
        if (!seriesMap[sk]) seriesMap[sk] = { count: 0, shsCount: 0, value: 0, searchTerm: sk, variants: {}, prices: [] };
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
          variants: Object.entries(d.variants)
            .sort(([, a], [, b]) => b - a)
            .map(([colour, count]) => ({ colour, count, models: [] })),
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

      const totalCount = groupUnits.length;
      const totalValue = groupUnits.reduce((s, u) => s + u.buyPrice, 0);

      return { ...group, elements, totalCount, totalValue };
    }).filter(g => g.elements.length > 0);
  }, [available, incoming]);

  if (groups.length === 0) return null;

  const handleElementClick = (
    el: Element,
    color: { bg: string; light: string; text: string; border: string },
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (el.count === 0 && el.shsCount === 0) return;
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setPopover(prev => prev?.el.seriesKey === el.seriesKey ? null : { el, color, rect });
  };

  return (
    <>
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
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {g.label}
              </span>
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
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#475569' }}>
                  £{g.totalValue.toLocaleString()} stock
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {g.elements.map(el => {
                  const isSelected = popover?.el.seriesKey === el.seriesKey;
                  const isEmpty = el.count === 0 && el.shsCount === 0;
                  return (
                    <button
                      key={el.seriesKey}
                      onClick={e => handleElementClick(el, g.color, e)}
                      style={{
                        width: 72, height: 72,
                        background: isEmpty ? '#1e293b' : isSelected ? g.color.bg : g.color.light,
                        border: `1.5px solid ${isEmpty ? '#334155' : isSelected ? g.color.bg : g.color.border}`,
                        borderRadius: 8,
                        padding: '5px 4px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        cursor: isEmpty ? 'default' : 'pointer',
                        transition: 'transform 0.12s, box-shadow 0.12s',
                        opacity: isEmpty ? 0.4 : 1,
                        position: 'relative',
                        outline: isSelected ? `2px solid ${g.color.bg}` : 'none',
                        outlineOffset: 2,
                      }}
                      onMouseEnter={e => {
                        if (!isEmpty && !isSelected) {
                          (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
                          (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${g.color.bg}`;
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) {
                          (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                        }
                      }}
                    >
                      {/* Top row: ordinal + stock count */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                        <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700, color: isSelected ? 'rgba(255,255,255,0.6)' : g.color.text, opacity: 0.7 }}>
                          {el.ordinal}
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                          <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 800, color: isSelected ? '#fff' : g.color.text }}>
                            {el.count}
                          </span>
                          {el.shsCount > 0 && (
                            <span style={{ fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: isSelected ? '#fde68a' : '#d97706', lineHeight: 1 }}>
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
                          color: isSelected ? '#fff' : g.color.text,
                          fontFamily: 'system-ui, sans-serif',
                          letterSpacing: '-0.04em',
                        }}>
                          {el.symbol}
                        </span>
                      </div>

                      {/* Series name */}
                      <div style={{ width: '100%', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 6.5,
                          fontFamily: 'monospace',
                          color: isSelected ? 'rgba(255,255,255,0.8)' : g.color.text,
                          opacity: 0.75,
                          lineHeight: 1.2,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
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

        {/* Legend for SHS indicator */}
        {groups.some(g => g.elements.some(el => el.shsCount > 0)) && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, color: '#d97706', fontFamily: 'monospace', fontWeight: 700 }}>+NS</span>
            <span style={{ fontSize: 8, color: '#475569', fontFamily: 'monospace' }}>= N units listed with supplier (SHS — click for details)</span>
          </div>
        )}
      </div>

      {/* Popover rendered outside the overflow container */}
      {popover && (
        <Popover state={popover} onClose={() => setPopover(null)} onNavigate={onNavigate} />
      )}
    </>
  );
}
