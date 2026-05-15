import React, { useMemo } from 'react';
import { ChevronRight, Truck } from 'lucide-react';
import { InventoryUnit } from '../types';
import { useInventoryStore } from '../lib/inventoryStore';

interface Props {
  seriesKey: string | null;
  searchTerm: string | null;
  units: InventoryUnit[];
  onViewAll: (seriesKey: string, searchTerm: string) => void;
}

interface Element {
  seriesKey: string;
  count: number;
  shsCount: number;
  variants: { colour: string; count: number; storages: { storage: string; count: number }[] }[];
  priceRange: { min: number; max: number };
}

function calculateElement(seriesKey: string, searchTerm: string, units: InventoryUnit[]): Element | null {
  // Find matching units by series key (exact match on the series name from periodic table)
  const matching = units.filter(u => {
    const model = u.model.toLowerCase();
    const search = searchTerm.toLowerCase();

    // Match by model containing the exact series key
    // For "Galaxy S23" search for models with "Galaxy S23" or "S23"
    // For "iPhone 15" search for models with "iPhone 15" or "15"
    return model.includes(search) || model.includes(seriesKey.toLowerCase());
  });

  const available = matching.filter(u => u.status === 'available');
  const incoming = matching.filter(u => u.status === 'incoming' && u.active !== false);

  if (available.length === 0 && incoming.length === 0) return null;

  const variants: Record<string, { count: number; storages: Record<string, number> }> = {};
  const prices: number[] = [];

  for (const u of available) {
    const colour = u.colour || 'Unknown';
    if (!variants[colour]) {
      variants[colour] = { count: 0, storages: {} };
    }
    variants[colour].count += 1;

    const storage = u.storage || 'Unknown';
    variants[colour].storages[storage] = (variants[colour].storages[storage] || 0) + 1;

    prices.push(u.buyPrice);
  }

  const variantArray = Object.entries(variants).map(([colour, data]) => ({
    colour,
    count: data.count,
    storages: Object.entries(data.storages).map(([storage, count]) => ({ storage, count })),
  }));

  return {
    seriesKey: seriesKey,
    count: available.length,
    shsCount: incoming.length,
    variants: variantArray.sort((a, b) => b.count - a.count),
    priceRange: {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
    },
  };
}

function getBrandColor(seriesKey: string): { bg: string; text: string; accent: string; light: string } {
  const lower = seriesKey.toLowerCase();
  if (lower.includes('iphone')) {
    return { bg: '#1d4ed8', text: '#1e3a8a', accent: '#3b82f6', light: '#dbeafe' };
  }
  if (lower.includes('ipad')) {
    return { bg: '#7c3aed', text: '#4c1d95', accent: '#8b5cf6', light: '#ede9fe' };
  }
  if (lower.includes('galaxy s') || lower.includes('s-series')) {
    return { bg: '#d97706', text: '#78350f', accent: '#f59e0b', light: '#fef3c7' };
  }
  if (lower.includes('galaxy a') || lower.includes('a-series')) {
    return { bg: '#059669', text: '#064e3b', accent: '#10b981', light: '#d1fae5' };
  }
  if (lower.includes('galaxy z') || lower.includes('tab') || lower.includes('samsung')) {
    return { bg: '#0891b2', text: '#164e63', accent: '#06b6d4', light: '#cffafe' };
  }
  return { bg: '#6b7280', text: '#374151', accent: '#9ca3af', light: '#f3f4f6' };
}

export default function PeriodicTableSidebar({ seriesKey, searchTerm, units, onViewAll }: Props) {
  const element = useMemo(() => {
    if (!seriesKey || !searchTerm) return null;
    return calculateElement(seriesKey, searchTerm, units);
  }, [seriesKey, searchTerm, units]);

  const brandColor = seriesKey ? getBrandColor(seriesKey) : null;

  if (!element) {
    return (
      <div className="hidden lg:flex lg:flex-col h-full bg-white border-l border-gray-200 p-6 justify-center items-center text-center">
        <p className="text-sm text-gray-400 font-mono">Click a series to view details</p>
      </div>
    );
  }

  const maxVariants = Math.max(...element.variants.map(v => v.count), 1);

  if (!brandColor) {
    return (
      <div className="hidden lg:flex lg:flex-col h-full bg-white border-l border-gray-200 p-6 justify-center items-center text-center">
        <p className="text-sm text-gray-400 font-mono">No data</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full border-l rounded-2xl overflow-hidden" style={{ background: brandColor.light }}>
      {/* Header */}
      <div className="px-6 py-4 border-b" style={{ background: brandColor.bg, borderColor: brandColor.accent }}>
        <h3 className="text-lg font-bold text-white">{element.seriesKey}</h3>
        <p className="text-xs text-white font-mono mt-1 opacity-80">
          {element.priceRange.min === element.priceRange.max
            ? `£${element.priceRange.min}`
            : `£${element.priceRange.min}–${element.priceRange.max}`}
        </p>
      </div>

      {/* Stock counts */}
      <div className="px-6 py-4 border-b border-gray-200 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-50 rounded-lg p-3">
            <p className="text-xs text-emerald-600 font-mono font-bold uppercase tracking-widest">In Office</p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{element.count}</p>
          </div>
          {element.shsCount > 0 && (
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-xs text-amber-600 font-mono font-bold uppercase tracking-widest">SHS</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{element.shsCount}</p>
            </div>
          )}
        </div>
      </div>

      {/* Colour variants with storage */}
      {element.variants.length > 0 && (
        <div className="px-6 py-4 border-b flex-1 overflow-hidden flex flex-col" style={{ borderColor: brandColor.light }}>
          <p className="text-xs font-mono font-bold uppercase tracking-widest mb-3 flex-shrink-0" style={{ color: brandColor.text }}>Colour Variants</p>
          <div className="space-y-3 overflow-y-auto flex-1">
            {element.variants.slice(0, 5).map(v => {
              const pct = Math.round((v.count / element.count) * 100);
              return (
                <div key={v.colour}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium" style={{ color: brandColor.text }}>{v.colour}</span>
                    <span className="text-xs font-bold" style={{ color: brandColor.text }}>{v.count}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: brandColor.light }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        background: brandColor.accent,
                      }}
                      className="h-full rounded-full transition-all"
                    />
                  </div>
                  {v.storages.length > 0 && (
                    <div className="ml-2 space-y-1">
                      {v.storages.map(s => (
                        <span
                          key={s.storage}
                          className="text-xs font-mono font-bold bg-gray-100 text-gray-700 px-2 py-1 rounded block"
                        >
                          {s.count} × {s.storage}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SHS note */}
      {element.shsCount > 0 && (
        <div className="px-6 py-4 border-b border-gray-200 bg-amber-50/50">
          <div className="flex items-start gap-2">
            <Truck size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-widest">Supplier Direct</p>
              <p className="text-xs text-amber-600 mt-1 font-mono">
                {element.shsCount} unit{element.shsCount > 1 ? 's' : ''} held by supplier
              </p>
            </div>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="px-6 py-4 mt-auto">
        <button
          onClick={() => {
            if (searchTerm) onViewAll(element.seriesKey, searchTerm);
          }}
          className="w-full flex items-center justify-between px-4 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-all text-sm font-bold"
        >
          View All {element.count} Units
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
