import React, { useState, useMemo } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../../types';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';
import { useInventoryStore } from '../../lib/inventoryStore';
import { generateBatchId } from '../../lib/batchUtils';
import { registerSessionCreatedUnits } from '../../hooks/useRealTimeNotifications';
import IntakeTypeSelector from './IntakeTypeSelector';
import DetailForm from './DetailForm';
import ReviewScreen from './ReviewScreen';
import ProcessingState from './ProcessingState';
import CompletionConfirmation from './CompletionConfirmation';
import BatchIMEIEntry, { PlannedUnit, CapturedUnit } from './BatchIMEIEntry';

interface ColorVariant {
  id: string;
  name: string;
  quantity: number;
}

type Stage = 'type-selection' | 'details' | 'color-distribution' | 'batch-imei' | 'review' | 'processing' | 'complete';

interface Props {
  onClose: () => void;
}

export default function StockIntakeFlow({ onClose }: Props) {
  const { suppliers } = useInventoryStore();

  // Stage management
  const [stage, setStage] = useState<Stage>('type-selection');
  const [intakeType, setIntakeType] = useState<'single' | 'bulk'>('single');

  // Form fields
  const [imei, setImei] = useState('');
  const [model, setModel] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [colour, setColour] = useState('');
  const [storage, setStorage] = useState('');
  const [grade, setGrade] = useState('A');
  const [buyPrice, setBuyPrice] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');

  // Bulk-specific
  const [quantity, setQuantity] = useState(1);
  const [colorVariants, setColorVariants] = useState<ColorVariant[]>([]);
  const [newColorName, setNewColorName] = useState('');
  const [newColorQty, setNewColorQty] = useState(1);
  const [plannedUnits, setPlannedUnits] = useState<PlannedUnit[]>([]);
  const [capturedUnits, setCapturedUnits] = useState<CapturedUnit[]>([]);

  // Processing
  const [unitsForReview, setUnitsForReview] = useState<InventoryUnit[]>([]);
  const [processingProgress, setProcessingProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState('');

  // Auto-generate batch ID based on supplier
  const generatedBatchId = useMemo(() => {
    if (!supplierId) return '';
    const supplier = suppliers.find(s => s.id === supplierId);
    return generateBatchId(supplier?.name || 'Unknown');
  }, [supplierId, suppliers]);

  // Color distribution validation
  const colorTotalQty = colorVariants.reduce((sum, c) => sum + c.quantity, 0);
  const isColorDistributionValid = quantity > 1 ? (colorVariants.length > 0 && colorTotalQty === quantity) : true;

  const handleTypeSelection = (type: 'single' | 'bulk') => {
    setIntakeType(type);
    setStage('details');
  };

  const addColorVariant = () => {
    if (!newColorName.trim() || newColorQty < 1) {
      setError('Enter color name and quantity');
      return;
    }

    if (colorVariants.some(c => c.name.toLowerCase() === newColorName.toLowerCase())) {
      setError('Color already added');
      return;
    }

    if (colorTotalQty + newColorQty > quantity) {
      setError(`Total would be ${colorTotalQty + newColorQty}, but batch quantity is ${quantity}`);
      return;
    }

    setColorVariants([
      ...colorVariants,
      {
        id: Math.random().toString(36).substr(2, 9),
        name: newColorName.trim(),
        quantity: newColorQty,
      },
    ]);
    setNewColorName('');
    setNewColorQty(1);
    setError('');
  };

  const removeColorVariant = (id: string) => {
    setColorVariants(colorVariants.filter(c => c.id !== id));
    setError('');
  };

  const updateColorQuantity = (id: string, newQty: number) => {
    const variant = colorVariants.find(c => c.id === id);
    if (!variant) return;

    const otherTotal = colorVariants.reduce((sum, c) => c.id === id ? sum : sum + c.quantity, 0);
    if (otherTotal + newQty > quantity) {
      setError(`Total would be ${otherTotal + newQty}, but batch quantity is ${quantity}`);
      return;
    }

    setColorVariants(colorVariants.map(c => c.id === id ? { ...c, quantity: newQty } : c));
    setError('');
  };

  const handleDetailSubmit = async () => {
    if (!model.trim()) { setError('Model is required'); return; }
    if (!buyPrice || isNaN(parseFloat(buyPrice))) { setError('Buy price is required'); return; }
    if (!colour) { setError('Colour is required'); return; }
    if (!supplierId) { setError('Supplier is required'); return; }

    // Server-side IMEI duplicate guard (single intake). DetailForm blocks
    // duplicates against the in-memory store; this catches the case where
    // the local store is stale (e.g. another device added the IMEI in the
    // meantime) before we waste the user's time on the review screen.
    if (intakeType === 'single') {
      const cleanImei = imei.replace(/\D/g, '');
      if (cleanImei.length >= 14) {
        try {
          const exists = await dbService.imeiExists(cleanImei);
          if (exists) {
            setError(`IMEI ${cleanImei} already exists in inventory`);
            return;
          }
        } catch (err) {
          console.warn('[Intake] imeiExists check failed, continuing:', err);
        }
      }
    }

    setError('');

    if (intakeType === 'bulk' && quantity > 1) {
      setStage('color-distribution');
    } else {
      // Single unit - go straight to review
      await buildUnitsForReview();
    }
  };

  const buildUnitsForReview = async () => {
    const bp = parseFloat(buyPrice) || 0;
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const bid = generatedBatchId;

    const units: InventoryUnit[] = [];

    if (intakeType === 'single' || quantity === 1) {
      const cleanImei = imei.replace(/\D/g, '');
      const unitId = cleanImei || `manual_${Date.now()}`;

      const unit: InventoryUnit = {
        id: unitId,
        imei: cleanImei,
        model: model.trim(),
        brand,
        category: category as any,
        colour,
        storage: storage || undefined,
        grade: grade || undefined,
        batchId: bid,
        buyPrice: bp,
        dateIn: today,
        supplierId,
        supplierName: suppliers.find(s => s.id === supplierId)?.name,
        stockLocation: 'office',
        status: 'available',
        flags: [],
        notes,
        platformListed: false,
        ownerId: 'shared',
        createdAt: now,
      };
      units.push(unit);
    } else {
      // Bulk with colors. Each planned unit may have a captured IMEI from
      // the BatchIMEIEntry step; fall back to the seed IMEI + sequential
      // suffix if the operator skipped a slot.
      const cleanImei = imei.replace(/\D/g, '');
      const baseName = cleanImei || `bulk_${Date.now()}`;
      let unitIndex = 0;
      for (const color of colorVariants) {
        for (let i = 0; i < color.quantity; i++) {
          const fallbackId = `${baseName}-${String(unitIndex + 1).padStart(3, '0')}`;
          const captured = capturedUnits[unitIndex];
          const usableImei =
            captured && captured.imei && !captured.skipped ? captured.imei : fallbackId;
          const unit: InventoryUnit = {
            id: usableImei,
            imei: usableImei,
            model: model.trim(),
            brand,
            category: category as any,
            colour: color.name,
            storage: storage || undefined,
            grade: grade || undefined,
            batchId: bid,
            buyPrice: bp,
            dateIn: today,
            supplierId,
            supplierName: suppliers.find(s => s.id === supplierId)?.name,
            stockLocation: 'office',
            status: 'available',
            flags: [],
            notes,
            platformListed: false,
            ownerId: 'shared',
            createdAt: now,
          };
          units.push(unit);
          unitIndex++;
        }
      }
    }

    setUnitsForReview(units);
    setBatchId(bid);
    setStage('review');
  };

  /**
   * Color Distribution → Batch IMEI Entry.
   * Expand the colour map into one PlannedUnit per physical phone in
   * batch order, then jump to the per-unit IMEI entry screen.
   */
  const handleColorDistributionSubmit = () => {
    if (!isColorDistributionValid) {
      setError(`Colour totals (${colorTotalQty}) must equal quantity (${quantity}).`);
      return;
    }
    setError('');
    const cleanImei = imei.replace(/\D/g, '');
    const baseName = cleanImei || `bulk_${Date.now()}`;
    const planned: PlannedUnit[] = [];
    let unitIndex = 0;
    for (const color of colorVariants) {
      for (let i = 0; i < color.quantity; i++) {
        planned.push({
          index: unitIndex,
          colour: color.name,
          unitId: `${baseName}-${String(unitIndex + 1).padStart(3, '0')}`,
        });
        unitIndex++;
      }
    }
    setPlannedUnits(planned);
    setCapturedUnits([]);
    setStage('batch-imei');
  };

  /** BatchIMEIEntry → Review */
  const handleBatchCaptureSubmit = async (captured: CapturedUnit[]) => {
    setCapturedUnits(captured);
    await buildUnitsForReview();
  };

  const handleReviewSubmit = async () => {
    setStage('processing');

    try {
      const entries = unitsForReview.map(u => ({
        collection: 'inventoryUnits',
        id: u.id,
        data: u,
      }));

      // Register units as session-created BEFORE database write
      // This ensures the deduplication set is populated before real-time notifications fire
      registerSessionCreatedUnits(unitsForReview.map(u => u.id));

      await dbService.bulkCreate(entries, (done, total) => {
        setProcessingProgress({ done, total });
      });

      // Trigger notification with batch count
      if (unitsForReview.length > 0) {
        notificationService.addNotification(
          'new_stock',
          unitsForReview[0],
          undefined,
          unitsForReview.length,
        );
      }

      setStage('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save units');
      setStage('review');
    }
  };

  const handleBack = () => {
    if (stage === 'complete') {
      onClose();
      return;
    }

    const stageSequence: Stage[] = [
      'type-selection',
      'details',
      'color-distribution',
      'batch-imei',
      'review',
    ];
    const currentIndex = stageSequence.indexOf(stage);
    if (currentIndex > 0) {
      setStage(stageSequence[currentIndex - 1]);
    }
  };

  const handleClose = () => {
    if (stage === 'processing') return;
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        {stage !== 'complete' && (
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {stage === 'type-selection' && 'Add Stock'}
                {stage === 'details' && (intakeType === 'single' ? 'Device Details' : 'Bulk Stock Details')}
                {stage === 'color-distribution' && 'Color Distribution'}
                {stage === 'batch-imei' && 'Enter IMEIs'}
                {stage === 'review' && 'Review Units'}
                {stage === 'processing' && 'Processing...'}
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                {intakeType === 'bulk' ? `Bulk intake - ${quantity} units` : 'Single unit intake'}
              </p>
            </div>
            {stage !== 'processing' && (
              <button onClick={handleClose} className="p-1 hover:bg-gray-100 rounded-lg transition">
                <X size={20} className="text-gray-400" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {stage === 'type-selection' && (
              <motion.div
                key="type-selection"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <IntakeTypeSelector onSelect={handleTypeSelection} />
              </motion.div>
            )}

            {stage === 'details' && (
              <motion.div
                key="details"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <DetailForm
                  intakeType={intakeType}
                  imei={imei}
                  setImei={setImei}
                  model={model}
                  setModel={setModel}
                  brand={brand}
                  setBrand={setBrand}
                  category={category}
                  setCategory={setCategory}
                  colour={colour}
                  setColour={setColour}
                  storage={storage}
                  setStorage={setStorage}
                  grade={grade}
                  setGrade={setGrade}
                  buyPrice={buyPrice}
                  setBuyPrice={setBuyPrice}
                  supplierId={supplierId}
                  setSupplierId={setSupplierId}
                  notes={notes}
                  setNotes={setNotes}
                  quantity={quantity}
                  setQuantity={setQuantity}
                  onSubmit={handleDetailSubmit}
                  onBack={handleBack}
                  error={error}
                  setError={setError}
                  batchId={generatedBatchId}
                />
              </motion.div>
            )}

            {stage === 'color-distribution' && (
              <motion.div
                key="color-distribution"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 mb-4">Color Distribution</h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Specify colors for {quantity} units. Total must equal {quantity}.
                    </p>
                  </div>

                  {/* Add color form */}
                  <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Color name"
                        value={newColorName}
                        onChange={e => { setNewColorName(e.target.value); if (error) setError(''); }}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex items-stretch gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setNewColorQty(Math.max(1, newColorQty - 1))}
                          disabled={newColorQty <= 1}
                          className="w-9 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-white disabled:opacity-40"
                          aria-label="Decrease"
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(newColorQty)}
                          onChange={e => {
                            const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
                            const n = parseInt(cleaned, 10);
                            if (!Number.isNaN(n) && n >= 1) setNewColorQty(n);
                            else if (cleaned === '') setNewColorQty(1);
                            if (error) setError('');
                          }}
                          onFocus={e => e.target.select()}
                          onBlur={() => { if (!newColorQty || newColorQty < 1) setNewColorQty(1); }}
                          className="w-14 px-2 py-2 text-center font-semibold tabular-nums border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => setNewColorQty(Math.min(quantity - colorTotalQty || 1, newColorQty + 1))}
                          disabled={colorTotalQty + newColorQty >= quantity}
                          className="w-9 flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-white disabled:opacity-40"
                          aria-label="Increase"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={addColorVariant}
                      disabled={!newColorName.trim() || colorTotalQty + newColorQty > quantity}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Add Color
                    </button>
                  </div>

                  {/* Color list */}
                  <div className="space-y-2">
                    {colorVariants.map(color => (
                      <div key={color.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{color.name}</p>
                          <p className="text-xs text-gray-500">×{color.quantity}</p>
                        </div>
                        <div className="flex items-stretch gap-1.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => updateColorQuantity(color.id, Math.max(1, color.quantity - 1))}
                            disabled={color.quantity <= 1}
                            className="w-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40"
                            aria-label="Decrease"
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={String(color.quantity)}
                            onChange={e => {
                              const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
                              const n = parseInt(cleaned, 10);
                              if (!Number.isNaN(n) && n >= 1) updateColorQuantity(color.id, n);
                            }}
                            onFocus={e => e.target.select()}
                            className="w-12 px-1 py-1.5 text-center font-semibold tabular-nums border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const otherTotal = colorVariants.reduce((s, c) => c.id === color.id ? s : s + c.quantity, 0);
                              if (otherTotal + color.quantity + 1 <= quantity) {
                                updateColorQuantity(color.id, color.quantity + 1);
                              }
                            }}
                            disabled={colorTotalQty >= quantity}
                            className="w-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-white disabled:opacity-40"
                            aria-label="Increase"
                          >
                            <Plus size={12} />
                          </button>
                          <button
                            onClick={() => removeColorVariant(color.id)}
                            className="p-1.5 ml-1 hover:bg-red-100 text-red-600 rounded transition"
                            aria-label="Remove colour"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`p-3 rounded-lg border ${
                    colorTotalQty === quantity
                      ? 'bg-emerald-50 border-emerald-200'
                      : colorTotalQty > quantity
                      ? 'bg-red-50 border-red-200'
                      : 'bg-blue-50 border-blue-200'
                  }`}>
                    <p className="text-xs font-mono text-gray-700">
                      Distribution: <span className={
                        colorTotalQty === quantity ? 'text-emerald-600 font-bold'
                        : colorTotalQty > quantity ? 'text-red-600 font-bold'
                        : 'text-amber-600 font-bold'
                      }>
                        {colorTotalQty} / {quantity}
                      </span>
                      {colorTotalQty > quantity && ` (over by ${colorTotalQty - quantity})`}
                      {colorTotalQty < quantity && ` (${quantity - colorTotalQty} more needed)`}
                    </p>
                  </div>

                  {error && colorTotalQty !== quantity && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleBack}
                      className="flex-shrink-0 py-3 px-4 border border-gray-200 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-600 hover:bg-gray-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleColorDistributionSubmit}
                      disabled={!isColorDistributionValid}
                      className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {!isColorDistributionValid
                        ? `Total ${colorTotalQty}/${quantity}`
                        : `Continue · Enter ${quantity} IMEI${quantity !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {stage === 'batch-imei' && (
              <motion.div
                key="batch-imei"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <BatchIMEIEntry
                  plannedUnits={plannedUnits}
                  baseImei={imei}
                  onSubmit={handleBatchCaptureSubmit}
                  onBack={handleBack}
                />
              </motion.div>
            )}

            {stage === 'review' && (
              <motion.div
                key="review"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ReviewScreen
                  units={unitsForReview}
                  batchId={batchId}
                  onSubmit={handleReviewSubmit}
                  onBack={handleBack}
                  error={error}
                />
              </motion.div>
            )}

            {stage === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ProcessingState progress={processingProgress} />
              </motion.div>
            )}

            {stage === 'complete' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <CompletionConfirmation
                  units={unitsForReview}
                  batchId={batchId}
                  onClose={onClose}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
