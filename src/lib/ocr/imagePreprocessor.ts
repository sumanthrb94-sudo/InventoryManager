/**
 * Intelligent Image Preprocessing for OCR
 * Enhances images for better OCR accuracy
 */

export interface ImageStats {
  width: number;
  height: number;
  size: number;
  brightness: number;
  contrast: number;
  isOptimalForOCR: boolean;
}

export async function getImageStats(dataUrl: string): Promise<ImageStats> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) reject(new Error('Failed to get canvas context'));

      ctx!.drawImage(img, 0, 0);
      const imageData = ctx!.getImageData(0, 0, img.width, img.height);
      const data = imageData.data;

      // Calculate brightness and contrast
      let totalBrightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        totalBrightness += (r + g + b) / 3;
      }
      const avgBrightness = totalBrightness / (data.length / 4);

      // Calculate contrast
      let variance = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        variance += Math.pow(brightness - avgBrightness, 2);
      }
      const contrast = Math.sqrt(variance / (data.length / 4));

      const stats: ImageStats = {
        width: img.width,
        height: img.height,
        size: dataUrl.length,
        brightness: avgBrightness,
        contrast: contrast,
        isOptimalForOCR: avgBrightness > 50 && avgBrightness < 200 && contrast > 20,
      };

      resolve(stats);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export async function preprocessImageForOCR(dataUrl: string): Promise<string> {
  console.log('[OCR Preprocessor] Starting image preprocessing...');

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Failed to get canvas context');

        // Resize if image is too large (limit to 3000x3000)
        let width = img.width;
        let height = img.height;
        const maxDimension = 3000;

        if (width > maxDimension || height > maxDimension) {
          const ratio = Math.min(maxDimension / width, maxDimension / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
          console.log('[OCR Preprocessor] Resized image to', width, 'x', height);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw original image
        ctx.drawImage(img, 0, 0, width, height);

        // Get image data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Apply preprocessing filters
        // 1. Grayscale conversion
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        // 2. Contrast enhancement
        const contrast = 1.3;
        const intercept = 128 * (1 - contrast);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, Math.max(0, data[i] * contrast + intercept));
          data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * contrast + intercept));
          data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * contrast + intercept));
        }

        // 3. Simple threshold to binary (helps with noisy images)
        const threshold = 128;
        for (let i = 0; i < data.length; i += 4) {
          const value = data[i] > threshold ? 255 : 0;
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
        }

        ctx.putImageData(imageData, 0, 0);

        const processedDataUrl = canvas.toDataURL('image/png', 0.95);
        console.log('[OCR Preprocessor] Image preprocessing complete');
        resolve(processedDataUrl);
      } catch (error) {
        console.error('[OCR Preprocessor] Preprocessing failed:', error);
        // Return original if preprocessing fails
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      console.error('[OCR Preprocessor] Failed to load image');
      reject(new Error('Failed to load image for preprocessing'));
    };
    img.src = dataUrl;
  });
}

export async function validateImageForOCR(dataUrl: string): Promise<{
  isValid: boolean;
  message: string;
  stats?: ImageStats;
}> {
  try {
    const stats = await getImageStats(dataUrl);

    if (stats.size > 5242880) {
      // 5MB limit
      return {
        isValid: false,
        message: 'Image is too large (>5MB). Please select a smaller image.',
      };
    }

    if (stats.width < 100 || stats.height < 100) {
      return {
        isValid: false,
        message: 'Image is too small. Please select a larger image with visible text.',
      };
    }

    if (!stats.isOptimalForOCR) {
      console.warn('[OCR Validator] Image may have suboptimal quality:', stats);
      return {
        isValid: true,
        message: 'Image quality is suboptimal - preprocessing may be applied',
        stats,
      };
    }

    return {
      isValid: true,
      message: 'Image is suitable for OCR',
      stats,
    };
  } catch (error) {
    console.error('[OCR Validator] Validation failed:', error);
    return {
      isValid: true, // Allow to proceed anyway
      message: 'Could not validate image quality, attempting OCR anyway',
    };
  }
}
