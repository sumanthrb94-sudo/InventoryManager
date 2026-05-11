// OCR engine for stock intake.
//
// The previous version crashed in production with
// "Cannot read properties of null (reading 'SetImageFile')". Root cause:
// `createWorker` was pointed at `tesseract.js-core@v4` CDN paths while the
// installed `tesseract.js` resolved to a different release, so the wasm
// context never finished initialising. `recognize()` then dereferenced a
// null internal handle inside SetImageFile.
//
// Fix: pin all three artefacts (tesseract.js, tesseract.js-core, langdata)
// to one version, validate the worker exposes `recognize` before using it,
// give recognize() a hard timeout, and on failure tear down and rebuild
// the worker before the next retry.

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

const TESSERACT_VERSION = '5.1.1';
const TESSERACT_CORE_VERSION = '5.1.1';
const LANG = 'eng';

const WORKER_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}`;
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

const RECOGNIZE_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 2;

let tesseractModule: any = null;
let tesseractLoadError: Error | null = null;
let workerPromise: Promise<any> | null = null;

async function loadTesseract(): Promise<any> {
  if (tesseractLoadError) throw tesseractLoadError;
  if (tesseractModule) return tesseractModule;
  try {
    tesseractModule = await import('tesseract.js');
    return tesseractModule;
  } catch (err) {
    tesseractLoadError = err instanceof Error ? err : new Error(String(err));
    throw new Error(`Failed to load Tesseract.js: ${tesseractLoadError.message}`);
  }
}

async function buildWorker(): Promise<any> {
  const mod = await loadTesseract();
  console.log('[OCR] Initialising Tesseract worker (v' + TESSERACT_VERSION + ')…');
  const worker = await mod.createWorker(LANG, 1, {
    workerPath: WORKER_PATH,
    corePath: CORE_PATH,
    langPath: LANG_PATH,
    // No `logger` here — passing a callback breaks structured clone on some
    // browsers (the old DataCloneError) and silently leaves the worker in a
    // half-initialised state, which is what caused SetImageFile to read null.
  });

  if (!worker || typeof worker.recognize !== 'function') {
    throw new Error('Tesseract worker initialised in a bad state (no recognize fn)');
  }

  // Tune for phone-label / IMEI text: dense lines, mostly alphanumeric.
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
      tessedit_char_whitelist:
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:/+()-#%',
    });
  } catch (err) {
    console.warn('[OCR] setParameters failed (continuing):', err);
  }

  console.log('[OCR] Worker ready');
  return worker;
}

async function getWorker(): Promise<any> {
  if (!workerPromise) {
    workerPromise = buildWorker().catch(err => {
      workerPromise = null; // allow rebuild on next call
      throw err;
    });
  }
  return workerPromise;
}

async function resetWorker(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    const worker = await current;
    await worker.terminate();
  } catch {
    /* tearing down a bad worker — nothing to do */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

async function recognizeOnce(
  imageSource: string,
): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker();
  const result: any = await withTimeout<any>(
    worker.recognize(imageSource),
    RECOGNIZE_TIMEOUT_MS,
    'OCR recognize',
  );
  return {
    text: result?.data?.text ?? '',
    confidence: (result?.data?.confidence ?? 0) / 100,
  };
}

async function performOCRWithRetry(
  fileDataUrl: string,
  onProgress?: (progress: number) => void,
): Promise<{ text: string; confidence: number; retryCount: number }> {
  let lastError: Error | null = null;
  let source = fileDataUrl;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[OCR] Retry attempt ${attempt}/${MAX_RETRIES}…`);
        onProgress?.(20 + attempt * 10);
        // Backoff so a transient browser hiccup gets time to clear.
        await new Promise(res => setTimeout(res, 600 * attempt));
      }

      console.log('[OCR] Starting recognition (attempt', attempt + 1, ')…');
      const { text, confidence } = await recognizeOnce(source);
      console.log(
        '[OCR] Recognition complete, text length:', text.length,
        'confidence:', confidence,
      );
      return { text, confidence, retryCount: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[OCR] Attempt ${attempt + 1} failed:`, lastError.message);

      if (attempt < MAX_RETRIES) {
        // Strategy escalates per retry:
        //   1st failure → try with preprocessed image
        //   2nd failure → rebuild the worker from scratch (covers the
        //                 wasm-context-lost / SetImageFile-null case)
        if (attempt === 0) {
          try {
            console.log('[OCR] Attempting with preprocessed image…');
            source = await preprocessImageForOCR(fileDataUrl);
          } catch (preErr) {
            console.warn('[OCR] Preprocessing failed:', preErr);
          }
        } else {
          console.log('[OCR] Rebuilding worker after repeated failure…');
          await resetWorker();
        }
      }
    }
  }

  throw lastError || new Error('OCR processing failed after all retries');
}

export async function performOCR(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<OCRResult> {
  const startTime = Date.now();

  try {
    const fileDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

    console.log('[OCR] File read as data URL, size:', fileDataUrl.length);
    onProgress?.(5);

    const validation = await validateImageForOCR(fileDataUrl);
    console.log('[OCR] Image validation:', validation.message, validation.stats);

    if (!validation.isValid) {
      throw new Error(validation.message);
    }

    let processedUrl = fileDataUrl;
    let wasPreprocessed = false;

    if (validation.stats && !validation.stats.isOptimalForOCR) {
      console.log('[OCR] Preprocessing image due to suboptimal quality…');
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

    const { text, confidence, retryCount } = await performOCRWithRetry(
      processedUrl,
      onProgress,
    );

    onProgress?.(95);

    const device = extractDeviceFromText(text);

    onProgress?.(100);

    return {
      text,
      confidence,
      device,
      processingTime: Date.now() - startTime,
      preprocessed: wasPreprocessed || retryCount > 0,
      retryCount,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[OCR] Processing failed:', errorMsg);
    throw new Error(`OCR processing failed: ${errorMsg}`);
  }
}

export async function cleanupOCRWorker(): Promise<void> {
  await resetWorker();
}

export function isOCRSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof Blob !== 'undefined' &&
    typeof URL !== 'undefined' &&
    typeof FileReader !== 'undefined'
  );
}

export async function warmupOCR(): Promise<void> {
  try {
    await getWorker();
  } catch (err) {
    console.warn('[OCR] Warmup failed:', err);
  }
}
