export interface ImageMetadata {
  id: string;
  filename: string;
  size: number;
  width: number;
  height: number;
  mimeType: string;
  dataUrl: string;
  timestamp: number;
  compressed: boolean;
  originalSize?: number;
}

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  metadata?: Partial<ImageMetadata>;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const COMPRESSION_QUALITY = 0.85;
const MAX_DIMENSION = 2048;

export class ImageService {
  private static instance: ImageService;
  private imageCache = new Map<string, ImageMetadata>();
  private storageKey = 'nexus_image_cache';

  private constructor() {
    this.loadCache();
  }

  static getInstance(): ImageService {
    if (!ImageService.instance) {
      ImageService.instance = new ImageService();
    }
    return ImageService.instance;
  }

  private loadCache() {
    try {
      const cached = localStorage.getItem(this.storageKey);
      if (cached) {
        const entries = JSON.parse(cached);
        this.imageCache = new Map(entries);
      }
    } catch {
      console.warn('Failed to load image cache from localStorage');
    }
  }

  private saveCache() {
    try {
      const entries = Array.from(this.imageCache.entries());
      localStorage.setItem(this.storageKey, JSON.stringify(entries));
    } catch {
      console.warn('Failed to save image cache to localStorage');
    }
  }

  async validateImage(file: File): Promise<ImageValidationResult> {
    // File type validation
    if (!file.type.startsWith('image/')) {
      return { valid: false, error: 'File must be an image' };
    }

    // File size validation
    if (file.size > MAX_IMAGE_SIZE) {
      return { valid: false, error: `Image too large (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)` };
    }

    try {
      // Get image dimensions
      const dimensions = await this.getImageDimensions(file);
      return {
        valid: true,
        metadata: {
          filename: file.name,
          size: file.size,
          mimeType: file.type,
          width: dimensions.width,
          height: dimensions.height,
          compressed: false,
        },
      };
    } catch (err) {
      return { valid: false, error: 'Invalid image file' };
    }
  }

  private getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => reject(new Error('Invalid image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async processImage(file: File): Promise<ImageMetadata> {
    // Check cache first
    const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) {
      console.log(`[ImageService] Using cached image: ${file.name}`);
      return cached;
    }

    try {
      // Validate image
      const validation = await this.validateImage(file);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Read and compress image
      const dataUrl = await this.readAndCompressImage(file);

      // Create metadata
      const metadata: ImageMetadata = {
        id: Math.random().toString(36).substring(2, 11),
        filename: file.name,
        size: file.size,
        width: validation.metadata?.width || 0,
        height: validation.metadata?.height || 0,
        mimeType: file.type,
        dataUrl,
        timestamp: Date.now(),
        compressed: dataUrl.length < file.size,
        originalSize: file.size > dataUrl.length ? file.size : undefined,
      };

      // Cache metadata (not the full dataUrl to save space)
      this.imageCache.set(cacheKey, metadata);
      this.saveCache();

      console.log(`[ImageService] Processed image: ${file.name} (${metadata.compressed ? 'compressed' : 'original'})`);
      return metadata;
    } catch (err) {
      throw new Error(`Image processing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private readAndCompressImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const img = new Image();

          img.onload = () => {
            // Check if compression is needed
            if (file.size <= 1024 * 1024) {
              // Small files: don't compress
              resolve(dataUrl);
              return;
            }

            // Large files: compress via canvas
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Scale down if too large
            if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
              const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas context unavailable');

            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL(file.type, COMPRESSION_QUALITY);
            resolve(compressed);
          };

          img.onerror = () => reject(new Error('Image processing failed'));
          img.src = dataUrl;
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  getMetadata(id: string): ImageMetadata | undefined {
    for (const meta of this.imageCache.values()) {
      if (meta.id === id) return meta;
    }
    return undefined;
  }

  clearCache() {
    this.imageCache.clear();
    localStorage.removeItem(this.storageKey);
  }

  getStats() {
    let totalSize = 0;
    let compressedCount = 0;

    for (const meta of this.imageCache.values()) {
      totalSize += meta.size;
      if (meta.compressed) compressedCount++;
    }

    return {
      cachedImages: this.imageCache.size,
      totalSize,
      compressedImages: compressedCount,
      compressionRate: compressedCount / (this.imageCache.size || 1),
    };
  }
}

export const imageService = ImageService.getInstance();
