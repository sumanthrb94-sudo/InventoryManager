import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { InventoryUnit } from '../../types';

interface Props {
  units: InventoryUnit[];
  batchId: string;
  onClose: () => void;
}

export default function CompletionConfirmation({ units, batchId, onClose }: Props) {
  const totalValue = units.reduce((sum, u) => sum + u.buyPrice, 0);

  // Auto-close after 5 seconds if user doesn't interact
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-12 space-y-8"
    >
      {/* Success checkmark animation */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      >
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
          <CheckCircle2 size={56} className="text-white" />
        </div>
      </motion.div>

      {/* Success message */}
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold text-gray-900">Stock Added Successfully!</h2>
        <p className="text-sm text-gray-600">
          {units.length} unit{units.length !== 1 ? 's' : ''} have been added to your inventory
        </p>
      </div>

      {/* Summary cards */}
      <div className="w-full space-y-3">
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-1">Batch ID</p>
          <p className="text-lg font-mono font-bold text-blue-900">{batchId}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Total Units</p>
            <p className="text-2xl font-bold text-emerald-900">{units.length}</p>
          </div>

          <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-700 mb-1">Total Value</p>
            <p className="text-2xl font-bold text-purple-900">£{totalValue.toFixed(2)}</p>
          </div>
        </div>

        {/* Date info */}
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1">Date Added</p>
          <p className="text-sm font-semibold text-gray-900">
            {new Date().toLocaleDateString('en-GB', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
      </div>

      {/* Unit summary if bulk */}
      {units.length > 1 && (
        <div className="w-full p-4 bg-gray-50 rounded-xl border border-gray-200 max-h-40 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Added Units</p>
          <div className="space-y-1 text-xs">
            {units.map((u, idx) => (
              <div key={u.id} className="flex items-center justify-between py-1 border-b border-gray-200">
                <span className="text-gray-600">
                  <span className="font-mono font-bold text-gray-700">[{String(idx + 1).padStart(2, '0')}]</span> {u.colour}
                </span>
                <span className="font-semibold text-gray-900">£{u.buyPrice.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action button */}
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClose}
        className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-lg font-semibold hover:shadow-lg transition flex items-center justify-center gap-2"
      >
        Back to Stock
        <ArrowRight size={18} />
      </motion.button>

      {/* Auto-close hint */}
      <p className="text-[10px] text-gray-400 uppercase tracking-widest">
        Closing in 5 seconds...
      </p>
    </motion.div>
  );
}
