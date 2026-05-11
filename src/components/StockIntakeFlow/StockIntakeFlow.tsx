import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { InventoryUnit } from '../../types';
import { dbService } from '../../lib/dbService';
import { notificationService } from '../../lib/notificationService';
import { useInventoryStore } from '../../lib/inventoryStore';
import { generateBatchId } from '../../lib/batchUtils';
import { registerSessionCreatedUnits } from '../../hooks/useRealTimeNotifications';
import type { OCRResult } from '../../lib/ocr/ocrEngine';
import IntakeTypeSelector from './IntakeTypeSelector';
import ImageCaptureInput from './ImageCaptureInput';
import DetailForm from './DetailForm';
import ReviewScreen from './ReviewScreen';
import ProcessingState from './ProcessingState';
import CompletionConfirmation from './CompletionConfirmation';

interface ColorVariant {
  id: string;
  name: string;
  quantity: number;
}

type Stage = 'type-selection' | 'image-input' | 'details' | 'color-distribution' | 'review' | 'processing' | 'complete';

interface Props {
  onClose: () => void;
}

export default function StockIntakeFlow({ onClose }: Props) {
  const { suppliers } = useInventoryStore();

  // Stage management
  const [stage, setStage] = useState<Stage>('type-selection');
  const [intakeType, setIntakeType] = useState<'single' | 'bulk'>('single');

  // Image & extraction
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [supabaseImageUrl, setSupabaseImageUrl] = useState<string>('');
  const [ocrResult, setOcrResult] = useState<OCRResult | undefined>();

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
    setStage('image-input');
  };

  const handleImageSelected = (file: File, preview: string, ocrData?: OCRResult, supabaseUrl?: string) => {
    setImageFile(file);
    setImagePreview(preview);
    setOcrResult(ocrData);
    if (supabaseUrl) {
      setSupabaseImageUrl(supabaseUrl);
      console.log('[StockIntakeFlow] Image URL from Supabase:', supabaseUrl);
    }

    // Pre-populate form fields from OCR result if available
    if (ocrData?.device) {
      if (ocrData.device.imei.confidence > 0.6) {
        setImei(ocrData.device.imei.value);
      }
      if (ocrData.device.brand.confidence > 0.6) {
        setBrand(ocrData.device.brand.value);
      }
      if (ocrData.device.model.confidence > 0.6) {
        setModel(ocrData.device.model.value);
      }
      if (ocrData.device.storage.confidence > 0.6) {
        setStorage(ocrData.device.storage.value);
      }
      if (ocrData.device.grade.confidence > 0.6) {
        setGrade(ocrData.device.grade.value);
      }
      if (ocrData.device.colour.confidence > 0.6) {
        setColour(ocrData.device.colour.value);
      }
    }

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
      // Single unit
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
        imageUrl: supabaseImageUrl || undefined,
        ownerId: 'shared',
        createdAt: now,
      };
      units.push(unit);
    } else {
      // Bulk with colors
      let unitIndex = 0;
      for (const color of colorVariants) {
        for (let i = 0; i < color.quantity; i++) {
          const cleanImei = imei.replace(/\D/g, '');
          const baseName = cleanImei || `bulk_${Date.now()}`;
          const unitId = `${baseName}-${String(unitIndex + 1).padStart(3, '0')}`;

          const unit: InventoryUnit = {
            id: unitId,
            imei: unitId,
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
            imageUrl: supabaseImageUrl || undefined,
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
      'image-input',
      'details',
      'color-distribution',
      'review',
    ];
    const currentIndex = stageSequence.indexOf(stage);
    if (currentIndex > 0) {
      setStage(stageSequence[currentIndex - 1]);
    }
  };

  const handleClose = () => {
    if (stage === 'processing') return; // Prevent closing during processing
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
                {stage === 'image-input' && (intakeType === 'single' ? 'Scan or Upload Item' : 'Bulk Stock Intake')}
                {stage === 'details' && 'Device Details'}
                {stage === 'color-distribution' && 'Color Distribution'}
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

            {stage === 'image-input' && (
              <motion.div
                key="image-input"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <ImageCaptureInput
                  onImageSelected={handleImageSelected}
                  onBack={handleBack}
                  intakeType={intakeType}
                />
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
                  ocrResult={ocrResult}
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
                    <div className="grid grid-cols-3 gap-3">
                      <input
                        type="text"
                        placeholder="Color name"
                        value={newColorName}
                        onChange={e => setNewColorName(e.target.value)}
                        className="col-span-2 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                      <input
                        type="number"
                        min="1"
                        max={quantity - colorTotalQty}
                        value={newColorQty}
                        onChange={e => setNewColorQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <button
                      onClick={addColorVariant}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition"
                    >
                      Add Color
                    </button>
                  </div>

                  {/* Color list */}
                  <div className="space-y-2">
                    {colorVariants.map(color => (
                      <div key={color.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">{color.name}</p>
                          <p className="text-xs text-gray-500">×{color.quantity}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            value={color.quantity}
                            onChange={e => updateColorQuantity(color.id, Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                          />
                          <button
                            onClick={() => removeColorVariant(color.id)}
                            className="p-1 hover:bg-red-100 text-red-600 rounded transition"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Validation status */}
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-xs font-mono text-gray-700">
                      Distribution: <span className={colorTotalQty === quantity ? 'text-green-600 font-bold' : 'text-amber-600'}>
                        {colorTotalQty} / {quantity}
                      </span>
                    </p>
                  </div>

                  {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
                </div>
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
