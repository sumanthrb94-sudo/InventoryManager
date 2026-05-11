import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, ChevronLeft, Upload, AlertCircle, CheckCircle2, Loader, Cloud } from 'lucide-react';
import { motion } from 'motion/react';
import IMEIScanner from '../IMEIScanner';
import OcrProgress from '../OCR/OcrProgress';
import { performOCR, isOCRSupported } from '../../lib/ocr/ocrEngine';
import { ocrCache } from '../../lib/ocr/ocrCacheService';
import { imageService, type ImageMetadata } from '../../lib/imageService';
import { imgbbStorageService } from '../../lib/imgbbStorageService';
import type { OCRResult } from '../../lib/ocr/ocrEngine';

interface Props {
  onImageSelected: (file: File, preview: string, ocrResult?: OCRResult, supabaseUrl?: string) => void;
  onBack: () => void;
  intakeType: 'single' | 'bulk';
}

interface ImageState {
  metadata?: ImageMetadata;
  file: File | null;
  previewUrl: string;
  supabaseUrl?: string;
  isValidating: boolean;
  isUploading: boolean;
  uploadProgress: number;
  validationError: string;
  uploadError: string;
}

export default function ImageCaptureInput({ onImageSelected, onBack, intakeType }: Props) {
  const [mode, setMode] = useState<'select' | 'camera' | 'gallery'>('select');
  const [imageState, setImageState] = useState<ImageState>({
    file: null,
    previewUrl: '',
    isValidating: false,
    isUploading: false,
    uploadProgress: 0,
    validationError: '',
    uploadError: '',
  });
  const [error, setError] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processTimeoutRef = useRef<NodeJS.Timeout>();
  const jobIdRef = useRef(`intake_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  const handleGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    console.log('[Gallery] File selected:', {
      filename: file?.name,
      size: file?.size,
      type: file?.type,
      exists: !!file
    });

    if (!file) {
      console.warn('[Gallery] No file selected');
      setError('No file was selected');
      return;
    }

    try {
      setImageState(prev => ({ ...prev, isValidating: true, validationError: '' }));
      setError('');

      console.log('[Gallery] Starting image processing...');

      // Validate and process image using the service
      const metadata = await imageService.processImage(file);

      console.log('[Gallery] Image processed successfully:', {
        width: metadata.width,
        height: metadata.height,
        compressed: metadata.compressed
      });

      // Update state with processed image
      setImageState(prev => {
        console.log('[Gallery] Setting image state with metadata and preview');
        return {
          ...prev,
          file,
          metadata,
          previewUrl: metadata.dataUrl,
          isValidating: false,
          validationError: '',
        };
      });

      // Drop back to the select view so the preview, upload progress
      // and OCR result actually render — they live in that block.
      setMode('select');

      // Upload to Imgbb in background
      uploadToImgbb(file, metadata);

      // Trigger OCR in background (non-blocking) if supported
      if (isOCRSupported()) {
        if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
        processTimeoutRef.current = setTimeout(() => {
          console.log('[Gallery] Starting OCR processing...');
          performOCROnFile(file, metadata);
        }, 500); // Wait for image to load
      } else {
        console.log('[Gallery] OCR not supported on this device');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to process image';
      console.error('[Gallery] Error processing image:', errorMsg, err);
      setImageState(prev => ({
        ...prev,
        isValidating: false,
        validationError: errorMsg,
      }));
      setError(errorMsg);
    }
  };

  const uploadToImgbb = async (file: File, metadata: ImageMetadata) => {
    try {
      console.log('[Imgbb] Starting upload:', file.name);
      setImageState(prev => ({ ...prev, isUploading: true, uploadError: '' }));

      const uploadedImage = await imgbbStorageService.uploadImage(
        file,
        (progress) => {
          console.log(`[Imgbb] Upload progress: ${progress}%`);
          setImageState(prev => ({ ...prev, uploadProgress: progress }));
        }
      );

      console.log('[Imgbb] Upload successful:', uploadedImage.url);
      setImageState(prev => ({
        ...prev,
        supabaseUrl: uploadedImage.url,
        isUploading: false,
        uploadProgress: 100,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Upload failed';
      console.error('[Imgbb] Upload error:', errorMsg);
      setImageState(prev => ({
        ...prev,
        isUploading: false,
        uploadProgress: 0,
        uploadError: errorMsg,
      }));
    }
  };

  const performOCROnFile = async (file: File, metadata?: ImageMetadata) => {
    try {
      setIsOcrProcessing(true);
      setOcrProgress(0);

      // Check cache first
      const cached = await ocrCache.get(file);
      if (cached) {
        console.log('[OCR] Cache hit:', metadata?.filename);
        setOcrResult(cached);
        setIsOcrProcessing(false);
        setOcrProgress(100);
        return;
      }

      console.log('[OCR] Processing image:', metadata?.filename);

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('OCR processing timeout (>30s)')), 30000)
      );

      // Race OCR against timeout
      const result = await Promise.race([
        performOCR(file, (progress) => {
          setOcrProgress(progress);
        }),
        timeoutPromise as Promise<any>
      ]);

      // Cache result
      await ocrCache.set(file, result);
      setOcrResult(result);
      console.log('[OCR] Processing complete, confidence:', result.confidence);
      setIsOcrProcessing(false);
      setOcrProgress(100);
    } catch (err) {
      // OCR is optional - fail gracefully without blocking the workflow
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn('[OCR] Processing skipped (optional):', errorMsg);
      setIsOcrProcessing(false);
      setOcrProgress(0);
      setOcrResult(undefined);
      // Don't show error to user - OCR is nice-to-have enhancement
    }
  };

  const handleCameraScan = (value: string) => {
    // Create a virtual "file" from the scanned IMEI
    const blob = new Blob([value], { type: 'text/plain' });
    const file = new File([blob], `scan_${Date.now()}.txt`, { type: 'text/plain' });
    const svgPreview = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ddd' width='100' height='100'/%3E%3Ctext x='50' y='50' text-anchor='middle' dy='.3em' font-family='monospace' font-size='12'%3EScanned%3C/text%3E%3C/svg%3E`;

    setImageState({
      file,
      previewUrl: svgPreview,
      isValidating: false,
      validationError: '',
      metadata: {
        id: Date.now().toString(),
        filename: `scan_${Date.now()}.txt`,
        size: blob.size,
        width: 100,
        height: 100,
        mimeType: 'text/plain',
        dataUrl: svgPreview,
        timestamp: Date.now(),
        compressed: false,
      },
    });
    setError('');
    setMode('select');
  };

  const handleCameraError = (err: string) => {
    setError(err);
    setMode('select');
  };

  const handleProceed = () => {
    if (!imageState.file) {
      setError('Please select an image or scan a barcode');
      return;
    }
    if (imageState.isUploading) {
      setError('Please wait for upload to complete');
      return;
    }
    // Proceed regardless of OCR status - it's optional for auto-fill
    onImageSelected(imageState.file, imageState.previewUrl, ocrResult, imageState.supabaseUrl);
  };

  useEffect(() => {
    return () => {
      if (processTimeoutRef.current) clearTimeout(processTimeoutRef.current);
    };
  }, []);


  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto">
      {mode === 'select' && (
        <>
          {/* Mode Selection - Responsive Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setMode('camera')}
              className="p-4 sm:p-6 rounded-2xl border-2 border-gray-200 hover:border-blue-500 transition-all hover:bg-blue-50 text-left group active:bg-blue-100"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-blue-200 transition">
                <Camera size={24} className="text-blue-600" />
              </div>
              <h3 className="font-bold text-gray-900 mb-0.5 sm:mb-1">Scan</h3>
              <p className="text-xs text-gray-500">Use camera to scan barcode</p>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                console.log('[Gallery] Upload button clicked, changing mode to gallery');
                setMode('gallery');
              }}
              className="p-4 sm:p-6 rounded-2xl border-2 border-gray-200 hover:border-emerald-500 transition-all hover:bg-emerald-50 text-left group active:bg-emerald-100"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-emerald-200 transition">
                <ImageIcon size={24} className="text-emerald-600" />
              </div>
              <h3 className="font-bold text-gray-900 mb-0.5 sm:mb-1">Upload</h3>
              <p className="text-xs text-gray-500">Select from gallery</p>
            </motion.button>
          </div>

          {/* Image Processing State */}
          {imageState.isValidating && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-blue-50 rounded-xl border border-blue-200 flex items-center gap-3"
            >
              <Loader size={18} className="text-blue-600 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-blue-900">Validating and processing image...</p>
                <p className="text-xs text-blue-700">Checking dimensions, compressing if needed</p>
              </div>
            </motion.div>
          )}

          {/* Validation Error */}
          {imageState.validationError && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 bg-red-50 rounded-lg border border-red-200 flex items-start gap-2"
            >
              <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{imageState.validationError}</p>
            </motion.div>
          )}

          {/* Selected Image Preview */}
          {imageState.file && !imageState.isValidating && !imageState.validationError && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
            >
              {/* Image Info */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-gray-700 truncate flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
                    {imageState.file.name}
                  </p>
                  {imageState.metadata && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {imageState.metadata.width}×{imageState.metadata.height}px
                      {imageState.metadata.compressed && ' (compressed)'}
                    </p>
                  )}
                </div>
              </div>

              {/* Preview Image */}
              {imageState.previewUrl && (
                <div className="w-full h-32 sm:h-40 rounded-lg overflow-hidden mb-3 bg-gray-200">
                  <img
                    src={imageState.previewUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              )}

              {/* Cloudinary Upload Progress */}
              {imageState.isUploading && (
                <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Cloud size={16} className="text-blue-600 animate-pulse" />
                    <p className="text-sm font-semibold text-blue-900">Uploading image...</p>
                  </div>
                  <div className="w-full h-2 bg-blue-200 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${imageState.uploadProgress}%` }}
                      transition={{ duration: 0.3 }}
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
                    />
                  </div>
                  <p className="text-xs text-blue-600 mt-1">{imageState.uploadProgress}%</p>
                </div>
              )}

              {/* Firebase Storage Upload Error */}
              {imageState.uploadError && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3 p-3 bg-orange-50 rounded-lg border border-orange-200 flex items-start gap-2"
                >
                  <AlertCircle size={16} className="text-orange-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-orange-700">{imageState.uploadError}</p>
                    <p className="text-xs text-orange-600 mt-1">Image saved locally but cloud upload failed. You can retry later.</p>
                  </div>
                </motion.div>
              )}

              {/* Cloudinary Upload Success */}
              {imageState.supabaseUrl && !imageState.isUploading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200 text-xs flex items-start gap-2"
                >
                  <CheckCircle2 size={14} className="text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-blue-700">✓ Image uploaded</p>
                </motion.div>
              )}


              {/* OCR Progress */}
              {isOcrProcessing && (
                <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <OcrProgress progress={ocrProgress} isProcessing={isOcrProcessing} />
                </div>
              )}

              {/* OCR Results Summary */}
              {ocrResult && !isOcrProcessing && (
                <div className="mb-3 p-2 bg-emerald-50 rounded-lg border border-emerald-200 text-xs">
                  <p className="text-emerald-700 font-semibold mb-1">✓ Auto-detected information:</p>
                  <div className="space-y-1 text-emerald-600">
                    {ocrResult.device.imei.confidence > 0 && <p>• IMEI: {ocrResult.device.imei.value}</p>}
                    {ocrResult.device.brand.confidence > 0 && <p>• Brand: {ocrResult.device.brand.value}</p>}
                    {ocrResult.device.model.confidence > 0 && <p>• Model: {ocrResult.device.model.value}</p>}
                    {ocrResult.device.storage.confidence > 0 && <p>• Storage: {ocrResult.device.storage.value}</p>}
                    {ocrResult.device.grade.confidence > 0 && <p>• Grade: {ocrResult.device.grade.value}</p>}
                    {ocrResult.device.colour.confidence > 0 && <p>• Colour: {ocrResult.device.colour.value}</p>}
                  </div>
                </div>
              )}

              {/* Action Button - Only blocks during upload, OCR runs in background */}
              <button
                onClick={handleProceed}
                disabled={imageState.isUploading}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {imageState.isUploading ? 'Uploading...' : 'Continue with This Image'}
              </button>
            </motion.div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
              {error}
            </div>
          )}
        </>
      )}

      {/* Camera Mode */}
      {mode === 'camera' && (
        <div className="space-y-3">
          <div className="relative rounded-2xl overflow-hidden h-48 sm:h-60 bg-black">
            <IMEIScanner
              onScan={handleCameraScan}
              onError={handleCameraError}
            />
          </div>
          <button
            onClick={() => setMode('select')}
            className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 active:bg-gray-100 transition flex items-center justify-center gap-2"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        </div>
      )}

      {/* Gallery Mode */}
      {mode === 'gallery' && (
        <div className="space-y-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            id="gallery-file-input"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
            onChange={(e) => {
              console.log('[FileInput] onChange triggered:', {
                files: e.target.files?.length,
                file: e.target.files?.[0]?.name
              });
              handleGallerySelect(e);
            }}
            className="sr-only"
            aria-label="Select image from gallery"
          />

          {/* Clickable upload area using label */}
          <label
            htmlFor="gallery-file-input"
            className="block w-full p-6 sm:p-8 border-2 border-dashed border-gray-300 rounded-2xl text-center hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 transition cursor-pointer group"
          >
            <Upload size={40} className="mx-auto text-gray-400 group-hover:text-blue-600 mb-3" />
            <p className="font-semibold text-gray-900">Choose an image</p>
            <p className="text-xs text-gray-500 mt-1">Tap to select from your phone</p>
          </label>

          {error && (
            <div className="p-2 bg-red-50 text-red-700 rounded-lg text-xs border border-red-200">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => setMode('select')}
            className="w-full py-2.5 border border-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-50 active:bg-gray-100 transition flex items-center justify-center gap-2"
          >
            <ChevronLeft size={16} />
            Back
          </button>
        </div>
      )}
    </div>
  );
}
