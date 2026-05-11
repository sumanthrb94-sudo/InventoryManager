import React from 'react';
import { ChevronLeft, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { InventoryUnit } from '../../types';

interface Props {
  units: InventoryUnit[];
  batchId: string;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  error: string;
}

export default function ReviewScreen({ units, batchId, onSubmit, onBack, error }: Props) {
  const totalValue = units.reduce((sum, u) => sum + u.buyPrice, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-1">Total Units</p>
          <p className="text-2xl font-bold text-blue-900">{units.length}</p>
        </div>
        <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">Total Value</p>
          <p className="text-2xl font-bold text-emerald-900">£{totalValue.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-700 mb-1">Batch ID</p>
          <p className="text-sm font-mono font-bold text-purple-900 truncate">{batchId}</p>
        </div>
      </div>

      {/* Units table - scrollable */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-bold text-gray-700">#</th>
              <th className="px-4 py-3 text-left font-bold text-gray-700">IMEI</th>
              <th className="px-4 py-3 text-left font-bold text-gray-700">Model</th>
              <th className="px-4 py-3 text-left font-bold text-gray-700">Colour</th>
              <th className="px-4 py-3 text-left font-bold text-gray-700">Storage</th>
              <th className="px-4 py-3 text-left font-bold text-gray-700">Grade</th>
              <th className="px-4 py-3 text-right font-bold text-gray-700">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {units.map((unit, idx) => (
              <tr key={unit.id} className="hover:bg-gray-50 transition">
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{String(idx + 1).padStart(2, '0')}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-xs truncate">{unit.imei}</td>
                <td className="px-4 py-3 text-gray-700 truncate">{unit.model}</td>
                <td className="px-4 py-3 text-gray-700">{unit.colour}</td>
                <td className="px-4 py-3 text-gray-600 text-xs">{unit.storage || '-'}</td>
                <td className="px-4 py-3 text-gray-600 font-semibold text-xs">{unit.grade || '-'}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900">£{unit.buyPrice.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Notes section if any */}
      {units.some(u => u.notes) && (
        <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-2">Notes</p>
          <ul className="space-y-1 text-sm text-amber-900">
            {units
              .filter(u => u.notes)
              .map((u, idx) => (
                <li key={u.id} className="text-xs">
                  <span className="font-mono text-amber-700">[{idx + 1}]</span> {u.notes}
                </li>
              ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="flex-1 py-3 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 transition flex items-center justify-center gap-2"
        >
          <ChevronLeft size={16} />
          Back to Edit
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 py-3 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition"
        >
          Confirm & Add to Stock ({units.length})
        </button>
      </div>
    </motion.div>
  );
}
