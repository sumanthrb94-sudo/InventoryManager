import React from 'react';
import { Package, PackagePlus } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  onSelect: (type: 'single' | 'bulk') => void;
}

export default function IntakeTypeSelector({ onSelect }: Props) {
  return (
    <div className="space-y-4">
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
