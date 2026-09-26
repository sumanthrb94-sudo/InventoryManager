import React from 'react';
import { Package, PackagePlus, Truck, ShoppingBag, Clock, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  onSelect: (type: 'single' | 'bulk') => void;
  rtsCount?: number;
  soldLast72hCount?: number;
}

export default function IntakeTypeSelector({ onSelect, rtsCount = 0, soldLast72hCount = 0 }: Props) {
  return (
    <div className="space-y-4">
      {/* Info tiles row */}
      {(rtsCount > 0 || soldLast72hCount > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {rtsCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 sm:p-4 rounded-xl border-2 border-amber-200 bg-amber-50 hover:border-amber-300 transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Truck size={16} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-800 truncate">RTS (Last 72h)</p>
                  <p className="text-[9px] text-amber-600 font-mono">{rtsCount} unit{rtsCount === 1 ? '' : 's'} returned to supplier</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[8px] font-mono text-amber-600">
                <Clock size={10} />
                <span>72h timer</span>
              </div>
            </motion.div>
          )}
          {soldLast72hCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 sm:p-4 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:border-emerald-300 transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <ShoppingBag size={16} className="text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-emerald-800 truncate">Sold (Last 72h)</p>
                  <p className="text-[9px] text-emerald-600 font-mono">{soldLast72hCount} unit{soldLast72hCount === 1 ? '' : 's'} sold</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-[8px] font-mono text-emerald-600">
                <TrendingUp size={10} />
                <span>Rolling window</span>
              </div>
            </motion.div>
          )}
        </div>
      )}

      <p className="text-sm text-gray-600">Choose how you want to add stock:</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* Single Unit */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('single')}
          className="p-4 sm:p-6 rounded-2xl border-2 border-gray-200 hover:border-blue-500 transition-all hover:bg-blue-50 active:bg-blue-100 text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-blue-200 transition">
            <Package size={24} className="text-blue-600" />
          </div>
          <h3 className="font-bold text-gray-900 mb-0.5 sm:mb-1">Add Single Unit</h3>
          <p className="text-xs text-gray-500">Add one device with full details</p>
        </motion.button>

        {/* Bulk Stock */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect('bulk')}
          className="p-4 sm:p-6 rounded-2xl border-2 border-gray-200 hover:border-emerald-500 transition-all hover:bg-emerald-50 active:bg-emerald-100 text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-emerald-200 transition">
            <PackagePlus size={24} className="text-emerald-600" />
          </div>
          <h3 className="font-bold text-gray-900 mb-0.5 sm:mb-1">Bulk Stock (10+)</h3>
          <p className="text-xs text-gray-500">Add multiple units with colors</p>
        </motion.button>
      </div>
    </div>
  );
}
