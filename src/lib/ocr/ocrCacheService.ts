import { OCRResult } from './ocrEngine';

interface CachedOCRResult {
  result: OCRResult;
  timestamp: number;
  ttl: number; // 30 days in milliseconds
}

class OCRCacheService {
  private cache: Map<string, CachedOCRResult> = new Map();
  private readonly DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  async hashFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async get(file: File): Promise<OCRResult | null> {
    const key = await this.hashFile(file);
    const cached = this.cache.get(key);

    if (!cached) return null;

    // Check if cache has expired
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.result;
  }

  async set(file: File, result: OCRResult): Promise<void> {
    const key = await this.hashFile(file);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: this.DEFAULT_TTL,
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      hits: 0, // Could track this if needed
      misses: 0,
    };
  }
}

export const ocrCache = new OCRCacheService();
