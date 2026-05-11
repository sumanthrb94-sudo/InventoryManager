import { extractDeviceFromText, ExtractedDevice } from './deviceExtractor';
import { preprocessImageForOCR, validateImageForOCR } from './imagePreprocessor';

export interface OCRResult {
  text: string;
  confidence: number;
  device: ExtractedDevice;
  processingTime: number;
  preprocessed: boolean;
  retryCount: number;
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
      console.log('[OCR] Initializing Tesseract worker with CDN...');

      // Use CDN-hosted Tesseract files for production reliability
      // This avoids need to manage local files and works globally
      worker = await TesseractModule.createWorker('eng', 1, {
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v4/tesseract-core.wasm.js',
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v4/dist/worker.min.js',
        langPath: 'https://cdn.jsdelivr.net/npm/tesseract.js-data/4.0.0',
      });

      console.log('[OCR] Worker initialized successfully');
    } catch (error) {
      workerInitError = error as Error;
      console.error('[OCR] Worker initialization failed:', workerInitError.message);
      throw workerInitError;
    }
  }
  return worker;
}

async function performOCRWithRetry(
  fileDataUrl: string,
  maxRetries: number = 2,
  onProgress?: (progress: number) => void
): Promise<{ text: string; confidence: number; retryCount: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[OCR] Retry attempt ${attempt}/${maxRetries}...`);
        onProgress?.(10 + attempt * 5);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }

      let tesseractWorker;
      try {
        tesseractWorker = await getWorker();
      } catch (error) {
        console.error('[OCR] Worker initialization failed, reinitializing...', error);
        // Force reinitialize
        worker = null;
        workerInitError = null;
        tesseractWorker = await getWorker();
      }

      console.log('[OCR] Starting recognition (attempt', attempt + 1, ')...');
      const result = await tesseractWorker.recognize(fileDataUrl, 'eng');

      const extractedText = result.data.text || '';
      const ocrConfidence = (result.data.confidence || 0) / 100;

      console.log('[OCR] Recognition complete, text length:', extractedText.length, 'confidence:', ocrConfidence);
      return { text: extractedText, confidence: ocrConfidence, retryCount: attempt };
    } catch (error) {
      lastError = error as Error;
      console.warn(`[OCR] Attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < maxRetries) {
        // Try with preprocessing on retry
        console.log('[OCR] Attempting with preprocessed image...');
        try {
          const preprocessedUrl = await preprocessImageForOCR(fileDataUrl);
          fileDataUrl = preprocessedUrl;
        } catch (preprocessError) {
          console.warn('[OCR] Preprocessing failed:', preprocessError);
        }
      }
    }
  }

  throw lastError || new Error('OCR processing failed after all retries');
}

export async function performOCR(file: File, onProgress?: (progress: number) => void): Promise<OCRResult> {
  const startTime = Date.now();

  try {
    // Read file as data URL
    const fileDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    console.log('[OCR] File read as data URL, size:', fileDataUrl.length);
    onProgress?.(5);

    // Validate image quality
    const validation = await validateImageForOCR(fileDataUrl);
    console.log('[OCR] Image validation:', validation.message, validation.stats);

    let processedUrl = fileDataUrl;
    let wasPreprocessed = false;

    // Preprocess if image quality is suboptimal
    if (validation.stats && !validation.stats.isOptimalForOCR) {
      console.log('[OCR] Preprocessing image due to suboptimal quality...');
      onProgress?.(10);
      try {
        processedUrl = await preprocessImageForOCR(fileDataUrl);
        wasPreprocessed = true;
        console.log('[OCR] Image preprocessed successfully');
      } catch (error) {
        console.warn('[OCR] Preprocessing failed, continuing with original:', error);
      }
    }

    onProgress?.(20);

    // Perform OCR with retry logic
    const { text: extractedText, confidence: ocrConfidence, retryCount } = await performOCRWithRetry(
      processedUrl,
      2,
      onProgress
    );

    onProgress?.(95);

    // Extract device information from OCR text
    const device = extractDeviceFromText(extractedText);

    onProgress?.(100);

    const processingTime = Date.now() - startTime;

    return {
      text: extractedText,
      confidence: ocrConfidence,
      device,
      processingTime,
      preprocessed: wasPreprocessed,
      retryCount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[OCR] Processing failed:', errorMsg);
    throw new Error(`OCR processing failed: ${errorMsg}`);
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
