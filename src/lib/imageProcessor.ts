/**
 * Image processing utility for extracting device information from images.
 * Supports IMEI extraction from barcodes and pattern matching.
 */

export interface ExtractedDeviceInfo {
  imei?: string;
  model?: string;
  grade?: string;
  storage?: string;
}

/**
 * Parse barcode label to extract model, grade, storage info
 */
export function parseBarcode(text: string): ExtractedDeviceInfo {
  const result: ExtractedDeviceInfo = {};

  // Extract model (e.g., "SAMSUNG S21 FE 5G", "IPHONE 15 PRO")
  const modelMatch = text.match(/^([A-Z][\w\s\d]+?)(?:Grade|Memory|[A-Z]{2,}|$)/i);
  if (modelMatch) {
    result.model = modelMatch[1].trim();
  }

  // Extract grade (e.g., "Grade A", "Grade B")
  const gradeMatch = text.match(/Grade\s+([A-C]|Refurbished)/i);
  if (gradeMatch) {
    result.grade = gradeMatch[1].toUpperCase();
  }

  // Extract storage (e.g., "Memory 128GB", "128GB", "256GB")
  const storageMatch = text.match(/(?:Memory\s+)?(\d+(?:GB|TB))/i);
  if (storageMatch) {
    result.storage = storageMatch[1].toUpperCase();
  }

  return result;
}

/**
 * Extract IMEI from image file or text
 * Returns IMEI if found (14-15 digits), otherwise empty
 */
export function extractIMEI(text: string): string {
  // Look for 14-15 consecutive digits
  const match = text.match(/\b(\d{14,15})\b/);
  if (match) {
    return match[1];
  }

  // Fallback: extract all digits if they form a valid IMEI
  const allDigits = text.replace(/\D/g, '');
  if (allDigits.length >= 14 && allDigits.length <= 15) {
    return allDigits;
  }

  return '';
}

/**
 * Detect device category from model name
 */
export function detectCategory(model: string): string {
  const m = model.toUpperCase();
  if (m.includes('IPAD')) return 'iPad';
  if (/APPLE WATCH|WATCH ULTRA|WATCH SE/.test(m)) return 'Apple Watch';
  if (m.includes('IPHONE')) return 'iPhone';
  if (/GALAXY TAB|TAB A\d|TAB S\d/.test(m)) return 'Tablet';
  if (m.includes('SAMSUNG') || m.includes('GALAXY'))
    return /\bA\d{2,3}\b|GALAXY A/.test(m) ? 'Samsung A Series' : 'Samsung S Series';
  return 'Other';
}

/**
 * Detect device brand from category
 */
export function detectBrand(category: string): string {
  if (['iPhone', 'iPad', 'Apple Watch'].includes(category)) return 'Apple';
  if (['Samsung S Series', 'Samsung A Series', 'Tablet'].includes(category)) return 'Samsung';
  return 'Other';
}

/**
 * Process uploaded image file - returns extracted text
 * Note: Full OCR would require Google Vision API or similar
 * For MVP, we focus on barcode extraction which is handled by IMEIScanner
 */
export async function processImageFile(file: File): Promise<string> {
  // For now, return a placeholder message
  // In production, this would integrate with OCR service
  return `Image file: ${file.name}`;
}
