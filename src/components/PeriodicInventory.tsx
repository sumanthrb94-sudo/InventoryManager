import React, { useMemo } from 'react';
import { InventoryUnit } from '../types';

interface Props {
  units: InventoryUnit[];
  onNavigate: (search: string) => void;
}

// Brand/series groups matching the periodic table layout concept
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
  value: number;
  searchTerm: string;
  ordinal: number; // "atomic number" = rank by count
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

export default function PeriodicInventory({ units, onNavigate }: Props) {
  const available = units.filter(u => u.status === 'available');

  const groups = useMemo(() => {
    return BRAND_GROUPS.map(group => {
      const groupUnits = available.filter(u => group.match(u.model));
      // Group into series
      const seriesMap: Record<string, { count: number; value: number; searchTerm: string }> = {};
      for (const u of groupUnits) {
        const sk = group.seriesFn(u.model);
        if (!seriesMap[sk]) seriesMap[sk] = { count: 0, value: 0, searchTerm: sk };
        seriesMap[sk].count++;
        seriesMap[sk].value += u.buyPrice;
      }
      const elements: Element[] = Object.entries(seriesMap)
        .map(([sk, d], i) => ({
          seriesKey: sk,
          symbol: makeSymbol(sk, group.id),
          count: d.count,
          value: d.value,
          searchTerm: d.searchTerm,
          ordinal: i + 1,
        }))
        .sort((a, b) => {
          // numeric sort by series number
          const na = parseInt(a.seriesKey.match(/\d+/)?.[0] || '0');
          const nb = parseInt(b.seriesKey.match(/\d+/)?.[0] || '0');
          return nb - na; // newest first
        })
        .map((el, i) => ({ ...el, ordinal: i + 1 }));

      const totalCount = groupUnits.length;
      const totalValue = groupUnits.reduce((s, u) => s + u.buyPrice, 0);

      return { ...group, elements, totalCount, totalValue };
    }).filter(g => g.elements.length > 0);
  }, [available]);

  if (groups.length === 0) return null;

  return (
    <div style={{ background: '#0f172a', borderRadius: 20, padding: '20px 16px', overflowX: 'auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
          <p style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>available</p>
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

      {/* Periodic rows — each brand group is a row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map(g => (
          <div key={g.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.15em',
                color: g.color.bg, fontWeight: 700, minWidth: 80, flexShrink: 0
              }}>
                {g.label}
              </div>
              <div style={{ flex: 1, height: 1, background: `${g.color.bg}30` }} />
              <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#475569' }}>
                £{g.totalValue.toLocaleString()} total
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {g.elements.map(el => (
                <button
                  key={el.seriesKey}
                  onClick={() => onNavigate(el.searchTerm)}
                  title={`${el.seriesKey} — ${el.count} in stock · £${el.value.toLocaleString()}`}
                  style={{
                    width: 72, height: 72,
                    background: el.count === 0 ? '#1e293b' : g.color.light,
                    border: `1.5px solid ${el.count === 0 ? '#334155' : g.color.border}`,
                    borderRadius: 8,
                    padding: '5px 4px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: el.count > 0 ? 'pointer' : 'default',
                    transition: 'transform 0.12s, box-shadow 0.12s',
                    opacity: el.count === 0 ? 0.4 : 1,
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (el.count > 0) {
                      (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
                      (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${g.color.bg}`;
                    }
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                  }}
                >
                  {/* Ordinal / atomic number */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                    <span style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: 700, color: g.color.text, opacity: 0.7 }}>
                      {el.ordinal}
                    </span>
                    <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 800, color: g.color.text }}>
                      {el.count}
                    </span>
                  </div>

                  {/* Symbol — centrepiece */}
                  <div style={{ textAlign: 'center', lineHeight: 1 }}>
                    <span style={{
                      fontSize: el.symbol.length > 4 ? 13 : 17,
                      fontWeight: 900,
                      color: g.color.text,
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
                      color: g.color.text,
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
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
