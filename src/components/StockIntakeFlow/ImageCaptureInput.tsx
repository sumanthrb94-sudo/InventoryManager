import React, { useState, useRef } from 'react';
import { Camera, Image as ImageIcon, ChevronLeft, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import IMEIScanner from '../IMEIScanner';

interface Props {
  onImageSelected: (file: File, preview: string) => void;
  onBack: () => void;
  intakeType: 'single' | 'bulk';
}

export default function ImageCaptureInput({ onImageSelected, onBack, intakeType }: Props) {
  const [mode, setMode] = useState<'select' | 'camera' | 'gallery'>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      setPreview(dataUrl);
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const handleCameraScan = (value: string) => {
    // Create a virtual "file" from the scanned IMEI
    // This allows us to continue with the same flow
    const blob = new Blob([value], { type: 'text/plain' });
    const file = new File([blob], `scan_${Date.now()}.txt`, { type: 'text/plain' });
    setSelectedFile(file);
    setPreview(`data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23ddd' width='100' height='100'/%3E%3Ctext x='50' y='50' text-anchor='middle' dy='.3em' font-family='monospace' font-size='12'%3EScanned%3C/text%3E%3C/svg%3E`);
    setError('');
    setMode('select');
  };

  const handleCameraError = (err: string) => {
    setError(err);
    setMode('select');
  };

  const handleProceed = () => {
    if (!selectedFile) {
      setError('Please select an image or scan a barcode');
      return;
    }
    onImageSelected(selectedFile, preview);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

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
              onClick={() => setMode('gallery')}
              className="p-4 sm:p-6 rounded-2xl border-2 border-gray-200 hover:border-emerald-500 transition-all hover:bg-emerald-50 text-left group active:bg-emerald-100"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center mb-2 sm:mb-3 group-hover:bg-emerald-200 transition">
                <ImageIcon size={24} className="text-emerald-600" />
              </div>
              <h3 className="font-bold text-gray-900 mb-0.5 sm:mb-1">Upload</h3>
              <p className="text-xs text-gray-500">Select from gallery</p>
            </motion.button>
          </div>

          {/* Selected File Preview */}
          {selectedFile && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200"
            >
              <p className="text-xs font-mono text-gray-600 mb-2">✓ Selected: {selectedFile.name}</p>
              {preview && (
                <div className="w-full h-32 sm:h-40 rounded-lg overflow-hidden mb-3 bg-gray-200">
                  <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
              <button
                onClick={handleProceed}
                className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 active:bg-blue-800 transition"
              >
                Continue with This Image
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
            key="file-input-gallery"
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleGallerySelect}
            onClick={(e) => {
              // Reset value so same file can be selected again
              (e.target as HTMLInputElement).value = '';
            }}
            className="hidden"
            aria-label="Select image from gallery"
            style={{ display: 'none' }}
          />

          {/* Clickable upload area - REGULAR BUTTON (not motion.button) */}
          <button
            type="button"
            onClick={triggerFileInput}
            onTouchEnd={triggerFileInput}
            className="w-full p-6 sm:p-8 border-2 border-dashed border-gray-300 rounded-2xl text-center hover:border-blue-500 hover:bg-blue-50 active:bg-blue-100 transition cursor-pointer group text-center"
            style={{
              WebkitAppearance: 'none',
              appearance: 'none',
            }}
          >
            <Upload size={40} className="mx-auto text-gray-400 group-hover:text-blue-600 mb-3" />
            <p className="font-semibold text-gray-900">Choose an image</p>
            <p className="text-xs text-gray-500 mt-1">Tap to select from your phone</p>
          </button>

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
