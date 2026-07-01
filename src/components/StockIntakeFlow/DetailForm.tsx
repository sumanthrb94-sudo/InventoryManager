import React, { useMemo } from 'react';
import { ChevronLeft, Lock, AlertTriangle, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useInventoryStore } from '../../lib/inventoryStore';
import { GRADE_OPTIONS, STORAGE_OPTIONS } from '../../lib/unitConstants';
import { GradeSelect, StorageSelect, SimTypeSelect } from '../FormSelects';
import ConfidenceBadge from '../OCR/ConfidenceBadge';
import DeviceComboBox from '../DeviceComboBox';
import type { OCRResult } from '../../lib/ocr/ocrEngine';

const normaliseImei = (s: string) => (s || '').replace(/\D/g, '');

const COLOUR_OPTIONS = [
  'Black','White','Blue','Green','Red','Pink','Purple','Yellow',
  'Gold','Silver','Graphite','Starlight','Midnight','Natural Titanium',
  'Black Titanium','White Titanium','Phantom Black','Phantom White',
  'Space Grey','Sierra Blue','Alpine Green','Coral','Mint','Cream',
  'Lavender','Desert Titanium','Pacific Blue','Rose Gold','Other',
];

// Constrained brand list — keeps Brand orthogonal to Model so the auto-fill
// pipeline (and any downstream filtering) can reason about them separately.
const BRAND_OPTIONS = [
  'Apple', 'Samsung', 'Google', 'OnePlus', 'Xiaomi', 'Huawei', 'OPPO', 'Vivo',
  'Motorola', 'Nokia', 'Other',
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
  simType: string;
  setSimType: (v: string) => void;
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
  ocrResult?: OCRResult;
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
  simType,
  setSimType,
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
  ocrResult,
}: Props) {
  const { suppliers, units } = useInventoryStore();

  const categories = [
    'iPhone', 'iPad', 'Apple Watch', 'Tablet',
    'Samsung S Series', 'Samsung A Series', 'Other'
  ];

  // Live IMEI duplicate detection against the inventory store.
  // Skipped for bulk intake where the IMEI field is optional/starting-seed.
  const imeiDigits = normaliseImei(imei);
  const duplicateUnit = useMemo(() => {
    if (intakeType !== 'single') return null;
    if (imeiDigits.length < 14) return null;
    return units.find(u => normaliseImei(u.imei) === imeiDigits) || null;
  }, [imeiDigits, units, intakeType]);
  const hasDuplicate = !!duplicateUnit;

  // Quantity input has a free-typing buffer so the user can clear it and
  // type "100" without the previous "1" snapping back the moment the
  // field is empty. We only push to the upstream `quantity` state when
  // the buffer parses to a real positive integer. Steppers, presets, and
  // blur all bypass the buffer and write directly.
  const [quantityInput, setQuantityInput] = React.useState(String(quantity || 1));
  React.useEffect(() => {
    // Keep the buffer in sync if upstream `quantity` changes (e.g. preset
    // tap), but don't fight the user mid-typing — only update when the
    // current buffer's parsed value differs from upstream.
    const parsed = parseInt(quantityInput, 10);
    if (parsed !== quantity && !Number.isNaN(quantity)) {
      setQuantityInput(String(quantity));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  const commitQuantity = (val: number) => {
    const clamped = Math.max(1, Math.min(999, Math.floor(val) || 1));
    setQuantity(clamped);
    setQuantityInput(String(clamped));
    setError('');
  };

  const QUANTITY_PRESETS = [10, 25, 50, 100];

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* IMEI - larger if bulk, reduced if single */}
        <div className={intakeType === 'bulk' ? 'col-span-2' : 'col-span-2'}>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">
              {intakeType === 'bulk' ? 'Starting IMEI (Optional)' : 'IMEI'}
            </label>
            {ocrResult?.device.imei.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.imei.confidence} label="OCR" showIcon={false} />
            )}
          </div>
          <input
            type="text"
            value={imei}
            onChange={e => setImei(e.target.value)}
            placeholder={intakeType === 'bulk' ? 'Leave blank for auto-generation' : '14-15 digits'}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
              hasDuplicate
                ? 'border-red-400 focus:ring-red-500 bg-red-50'
                : 'border-gray-300 focus:ring-blue-500'
            }`}
          />
          {hasDuplicate ? (
            <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">IMEI already in inventory</p>
                <p className="text-red-600">
                  {duplicateUnit!.model}
                  {duplicateUnit!.status ? ` · status: ${duplicateUnit!.status}` : ''}
                  {duplicateUnit!.dateIn ? ` · added ${duplicateUnit!.dateIn}` : ''}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 mt-1">
              {imei ? `Digits: ${imeiDigits.length}` : 'Optional for bulk'}
            </p>
          )}
        </div>

        {/* Quantity - bulk only */}
        {intakeType === 'bulk' && (
          <div className="col-span-2">
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Quantity</label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => commitQuantity(quantity - 1)}
                disabled={quantity <= 1}
                className="w-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Decrease quantity"
              >
                <Minus size={14} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={quantityInput}
                onChange={e => {
                  // Strip non-digits; keep the buffer as a string so the
                  // user can clear it without snapping back to "1".
                  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setQuantityInput(cleaned);
                  setError('');
                  const n = parseInt(cleaned, 10);
                  if (!Number.isNaN(n) && n >= 1) setQuantity(Math.min(999, n));
                }}
                onBlur={() => {
                  const n = parseInt(quantityInput, 10);
                  commitQuantity(Number.isNaN(n) || n < 1 ? 1 : n);
                }}
                onFocus={e => e.target.select()}
                placeholder="Type up to 999"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-center font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => commitQuantity(quantity + 1)}
                disabled={quantity >= 999}
                className="w-10 flex-shrink-0 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Increase quantity"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUANTITY_PRESETS.map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => commitQuantity(n)}
                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                    quantity === n
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 mt-1">Tap a preset, use ± , or type a value 1–999.</p>
          </div>
        )}

        {/* Model */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">Model *</label>
            {ocrResult?.device.model.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.model.confidence} label="OCR" showIcon={false} />
            )}
          </div>
          <DeviceComboBox
            units={units}
            brand={brand}
            model={model}
            onModelChange={setModel}
            onPick={entry => {
              // Mirror the catalog entry into the form so brand + model + the
              // suggested defaults (storage, colour, grade) stay in sync.
              if (entry.brand) setBrand(entry.brand);
              setModel(entry.model);
              if (!storage && entry.storages[0]) setStorage(entry.storages[0]);
              if (!colour && entry.colours[0]) setColour(entry.colours[0]);
              if (entry.topGrade) setGrade(entry.topGrade);
              if (!buyPrice && entry.medianBuyPrice) setBuyPrice(String(entry.medianBuyPrice));
            }}
            placeholder="e.g. iPhone 15 Pro Max  /  S21 FE 5G"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            Start typing or tap the arrow to pick from known devices in stock
          </p>
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
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">Brand *</label>
            {ocrResult?.device.brand.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.brand.confidence} label="OCR" showIcon={false} />
            )}
          </div>
          <select
            value={brand}
            onChange={e => setBrand(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Select brand</option>
            {BRAND_OPTIONS.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        {/* Storage */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">Storage</label>
            {ocrResult?.device.storage.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.storage.confidence} label="OCR" showIcon={false} />
            )}
          </div>
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
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">Grade</label>
            {ocrResult?.device.grade.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.grade.confidence} label="OCR" showIcon={false} />
            )}
          </div>
          <GradeSelect value={grade} onChange={setGrade} />
        </div>

        {/* SIM Type */}
        <SimTypeSelect value={simType} onChange={setSimType} />

        {/* Colour */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-bold text-gray-700 uppercase">Colour *</label>
            {ocrResult?.device.colour.confidence > 0 && (
              <ConfidenceBadge confidence={ocrResult.device.colour.confidence} label="OCR" showIcon={false} />
            )}
          </div>
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
          disabled={hasDuplicate}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {hasDuplicate
            ? 'IMEI Duplicate'
            : intakeType === 'bulk' && quantity > 1 ? 'Continue to Colors' : 'Review Units'}
        </button>
      </div>
    </motion.div>
  );
}
