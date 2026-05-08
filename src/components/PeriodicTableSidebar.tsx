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
  variants: { colour: string; count: number }[];
  storageVariants: { storage: string; count: number }[];
  priceRange: { min: number; max: number };
}

function calculateElement(searchTerm: string, units: InventoryUnit[]): Element | null {
  const q = searchTerm.toLowerCase();
  const matching = units.filter(u =>
    u.model.toLowerCase().includes(q) ||
    (u.model.includes('iPhone') && q.includes('iphone')) ||
    (u.model.includes('iPad') && q.includes('ipad')) ||
    (u.model.includes('Galaxy') && (q.includes('galaxy') || q.includes('samsung')))
  );

  const available = matching.filter(u => u.status === 'available');
  const incoming = matching.filter(u => u.status === 'incoming');

  if (available.length === 0 && incoming.length === 0) return null;

  const variants: Record<string, number> = {};
  const storages: Record<string, number> = {};
  const prices: number[] = [];

  for (const u of available) {
    const colour = u.colour || 'Unknown';
    variants[colour] = (variants[colour] || 0) + 1;
    const storage = u.storage || 'Unknown';
    storages[storage] = (storages[storage] || 0) + 1;
    prices.push(u.buyPrice);
  }

  const variantArray = Object.entries(variants).map(([colour, count]) => ({ colour, count }));
  const storageArray = Object.entries(storages).map(([storage, count]) => ({ storage, count }));

  return {
    seriesKey: searchTerm,
    count: available.length,
    shsCount: incoming.length,
    variants: variantArray.sort((a, b) => b.count - a.count),
    storageVariants: storageArray,
    priceRange: {
      min: prices.length > 0 ? Math.min(...prices) : 0,
      max: prices.length > 0 ? Math.max(...prices) : 0,
    },
  };
}

function accentColor(hue: number): string {
  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#06b6d4'];
  return colors[hue % colors.length];
}

export default function PeriodicTableSidebar({ seriesKey, searchTerm, units, onViewAll }: Props) {
  const element = useMemo(() => {
    if (!seriesKey || !searchTerm) return null;
    return calculateElement(searchTerm, units);
  }, [seriesKey, searchTerm, units]);

  if (!element) {
    return (
      <div className="hidden lg:flex lg:flex-col h-full bg-white border-l border-gray-200 p-6 justify-center items-center text-center">
        <p className="text-sm text-gray-400 font-mono">Click a series to view details</p>
      </div>
    );
  }

  const maxVariants = Math.max(...element.variants.map(v => v.count), 1);
  const accent = accentColor(element.seriesKey.charCodeAt(0));

  return (
    <div className="hidden lg:flex lg:flex-col h-full bg-gradient-to-b from-gray-50 to-white border-l border-gray-200 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-bold text-gray-900">{element.seriesKey}</h3>
        <p className="text-xs text-gray-500 font-mono mt-1">
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

      {/* Colour variants */}
      {element.variants.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-200">
          <p className="text-xs text-gray-600 font-mono font-bold uppercase tracking-widest mb-3">Colour Variants</p>
          <div className="space-y-2">
            {element.variants.slice(0, 5).map(v => {
              const pct = Math.round((v.count / element.count) * 100);
              return (
                <div key={v.colour}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 font-medium">{v.colour}</span>
                    <span className="text-xs font-bold text-gray-900">{v.count}</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      style={{
                        width: `${pct}%`,
                        background: accent,
                      }}
                      className="h-full rounded-full transition-all"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Storage variants */}
      {element.storageVariants.length > 0 && (
        <div className="px-6 py-4 border-b border-gray-200">
          <p className="text-xs text-gray-600 font-mono font-bold uppercase tracking-widest mb-3">Storage Options</p>
          <div className="flex flex-wrap gap-2">
            {element.storageVariants.map(v => (
              <span
                key={v.storage}
                className="text-xs font-mono font-bold bg-gray-100 text-gray-700 px-2 py-1 rounded"
              >
                {v.count} × {v.storage}
              </span>
            ))}
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
