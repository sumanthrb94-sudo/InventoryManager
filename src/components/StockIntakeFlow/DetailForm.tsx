import React, { useMemo } from 'react';
import { ChevronLeft, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../../lib/inventoryStore';
import { GRADE_OPTIONS, STORAGE_OPTIONS } from '../../lib/unitConstants';
import { GradeSelect, StorageSelect } from '../FormSelects';

const COLOUR_OPTIONS = [
  'Black','White','Blue','Green','Red','Pink','Purple','Yellow',
  'Gold','Silver','Graphite','Starlight','Midnight','Natural Titanium',
  'Black Titanium','White Titanium','Phantom Black','Phantom White',
  'Space Grey','Sierra Blue','Alpine Green','Coral','Mint','Cream',
  'Lavender','Desert Titanium','Pacific Blue','Rose Gold','Other',
];

interface Props {
  intakeType: 'single' | 'bulk';
  imei: string;
  setImei: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  brand: string;
  setBrand: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  colour: string;
  setColour: (v: string) => void;
  storage: string;
  setStorage: (v: string) => void;
  grade: string;
  setGrade: (v: string) => void;
  buyPrice: string;
  setBuyPrice: (v: string) => void;
  supplierId: string;
  setSupplierId: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  quantity: number;
  setQuantity: (v: number) => void;
  onSubmit: () => Promise<void>;
  onBack: () => void;
  error: string;
  setError: (v: string) => void;
  batchId: string;
}

export default function DetailForm({
  intakeType,
  imei,
  setImei,
  model,
  setModel,
  brand,
  setBrand,
  category,
  setCategory,
  colour,
  setColour,
  storage,
  setStorage,
  grade,
  setGrade,
  buyPrice,
  setBuyPrice,
  supplierId,
  setSupplierId,
  notes,
  setNotes,
  quantity,
  setQuantity,
  onSubmit,
  onBack,
  error,
  setError,
  batchId,
}: Props) {
  const { suppliers } = useInventoryStore();

  const categories = [
    'iPhone', 'iPad', 'Apple Watch', 'Tablet',
    'Samsung S Series', 'Samsung A Series', 'Other'
  ];

  const handleQuantityChange = (val: number) => {
    setQuantity(Math.max(1, Math.min(999, val)));
    setError('');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6"
    >
      {/* Batch ID display (bulk only) */}
      {intakeType === 'bulk' && batchId && (
        <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-blue-600" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700">Auto-Generated Batch ID</p>
          </div>
          <p className="font-mono text-sm font-bold text-blue-900">{batchId}</p>
        </div>
      )}

      {/* Main form grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* IMEI - larger if bulk, reduced if single */}
        <div className={intakeType === 'bulk' ? 'col-span-2' : 'col-span-2'}>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
            {intakeType === 'bulk' ? 'Starting IMEI (Optional)' : 'IMEI'}
          </label>
          <input
            type="text"
            value={imei}
            onChange={e => setImei(e.target.value)}
            placeholder={intakeType === 'bulk' ? 'Leave blank for auto-generation' : '14-15 digits'}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {imei ? `Digits: ${imei.replace(/\D/g, '').length}` : 'Optional for bulk'}
          </p>
        </div>

        {/* Quantity - bulk only */}
        {intakeType === 'bulk' && (
          <div className="col-span-2">
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Quantity</label>
            <input
              type="number"
              min="1"
              max="999"
              value={quantity}
              onChange={e => handleQuantityChange(parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Model */}
        <div className="col-span-2">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Model *</label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="e.g. iPhone 15 Pro Max 256GB"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Category</label>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Auto-detect</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {/* Brand */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Brand</label>
          <input
            type="text"
            value={brand}
            onChange={e => setBrand(e.target.value)}
            placeholder="Apple, Samsung, etc"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Storage */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Storage</label>
          <select
            value={storage}
            onChange={e => setStorage(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select</option>
            {STORAGE_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Grade */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Grade</label>
          <GradeSelect value={grade} onChange={setGrade} />
        </div>

        {/* Colour */}
        <div className="col-span-2">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Colour *</label>
          <select
            value={colour}
            onChange={e => setColour(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a colour</option>
            {COLOUR_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Buy Price */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Buy Price £ *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={buyPrice}
            onChange={e => setBuyPrice(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Supplier */}
        <div>
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Supplier *</label>
          <select
            value={supplierId}
            onChange={e => setSupplierId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select supplier</option>
            {suppliers.map(sup => (
              <option key={sup.id} value={sup.id}>{sup.name}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="col-span-2">
          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Screen crack, Box missing"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 transition flex items-center justify-center gap-2"
        >
          <ChevronLeft size={16} />
          Back
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
        >
          {intakeType === 'bulk' && quantity > 1 ? 'Continue to Colors' : 'Review Units'}
        </button>
      </div>
    </motion.div>
  );
}
