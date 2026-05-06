import React from 'react';
import { X, Package, Boxes } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  onSelectSingle: () => void;
  onSelectBatch: () => void;
  onClose: () => void;
}

export default function AddDeliveryModal({ onSelectSingle, onSelectBatch, onClose }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-0 md:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold uppercase tracking-tight">Add Delivery</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-all text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest mb-4">Choose delivery type</p>

          {/* Single Unit */}
          <button
            onClick={onSelectSingle}
            className="w-full p-4 border-2 border-gray-200 rounded-2xl hover:border-emerald-500 hover:bg-emerald-50 transition-all active:scale-95 text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:bg-emerald-200 transition-all flex-shrink-0">
                <Package size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">Single Unit</p>
                <p className="text-[9px] text-gray-400 mt-0.5">Scan barcode or enter manually</p>
                <p className="text-[8px] text-gray-500 mt-1">Quick add one unit with auto-populated details</p>
              </div>
            </div>
          </button>

          {/* Batch */}
          <button
            onClick={onSelectBatch}
            className="w-full p-4 border-2 border-gray-200 rounded-2xl hover:border-blue-500 hover:bg-blue-50 transition-all active:scale-95 text-left group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-all flex-shrink-0">
                <Boxes size={18} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold">Batch from Supplier</p>
                <p className="text-[9px] text-gray-400 mt-0.5">Multiple units with same purchase order</p>
                <p className="text-[8px] text-gray-500 mt-1">Add delivery with invoice number & supplier info</p>
              </div>
            </button>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
