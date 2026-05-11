import { extractDeviceFromText, ExtractedDevice } from './deviceExtractor';

export interface OCRResult {
  text: string;
  confidence: number;
  device: ExtractedDevice;
  processingTime: number;
}

// Lazy load Tesseract to avoid blocking initial page load
let Tesseract: any = null;
let tesseractLoaded = false;
let tesseractError: Error | null = null;

async function loadTesseract() {
  if (tesseractLoaded) return Tesseract;
  if (tesseractError) throw tesseractError;

  try {
    const module = await import('tesseract.js');
    Tesseract = module;
    tesseractLoaded = true;
    return Tesseract;
  } catch (error) {
    tesseractError = error as Error;
    throw new Error(`Failed to load Tesseract.js: ${tesseractError.message}`);
  }
}

let worker: any = null;
let workerInitError: Error | null = null;

async function getWorker() {
  if (workerInitError) throw workerInitError;
  if (!worker) {
    try {
      const TesseractModule = await loadTesseract();
      worker = await TesseractModule.createWorker('eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        langPath: '/tesseract/lang-data',
      });
    } catch (error) {
      workerInitError = error as Error;
      console.warn('[OCR] Worker initialization failed, OCR will be disabled:', workerInitError.message);
      throw workerInitError;
    }
  }
  return worker;
}

export async function performOCR(file: File, onProgress?: (progress: number) => void): Promise<OCRResult> {
  const startTime = Date.now();

  try {
    // Read file as data URL (better for worker serialization)
    const fileDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    console.log('[OCR] File read as data URL, size:', fileDataUrl.length);

    // Get or create worker
    const tesseractWorker = await getWorker();
    onProgress?.(10);

    // Recognize text from image using data URL
    // Note: Cannot pass onProgress callback to logger due to Worker serialization.
    // The logger callback itself would be serialized, causing DataCloneError.
    // Progress is tracked at key milestones instead.
    const result = await tesseractWorker.recognize(fileDataUrl, 'eng');

    onProgress?.(95);

    const extractedText = result.data.text || '';
    const ocrConfidence = (result.data.confidence || 0) / 100;

    // Extract device information from OCR text
    const device = extractDeviceFromText(extractedText);

    onProgress?.(100);

    const processingTime = Date.now() - startTime;

    return {
      text: extractedText,
      confidence: ocrConfidence,
      device,
      processingTime,
    };
  } catch (error) {
    throw new Error(`OCR processing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function cleanupOCRWorker() {
  if (worker) {
    try {
      await worker.terminate();
      worker = null;
    } catch (error) {
      console.warn('Failed to terminate OCR worker:', error);
    }
  }
}

export function isOCRSupported(): boolean {
  return typeof Worker !== 'undefined' && typeof Blob !== 'undefined';
}
