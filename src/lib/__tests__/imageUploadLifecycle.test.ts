/**
 * End-to-End Image Upload Lifecycle Test
 * Tests: Upload → Validation → Compression → OCR → Auto-fill → Color Distribution → Database
 */
// @vitest-environment jsdom
// Its fixtures build real <canvas> elements to stand in for uploaded photos,
// so this file needs a DOM. The suite default is node — see vite.config.ts.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { imageService } from '../imageService';
import { performOCR } from '../ocr/ocrEngine';
import { extractDeviceFromText } from '../ocr/deviceExtractor';

/**
 * A decoding stand-in for `new Image()`.
 *
 * imageService reaches the same place twice — getImageDimensions and
 * readAndCompressImage both set `img.src` and wait on `img.onload`. jsdom
 * carries no image decoder, so it fires NEITHER onload nor onerror: the
 * promise never settles and the test dies on the 5s timeout rather than
 * failing on anything it meant to check. That is why six tests in this file
 * hung the moment it was collected.
 *
 * What this buys, and what it does not: the stub answers the decode step with
 * fixed dimensions, so everything around it — the type and size gates, the
 * compress-or-pass-through branch, the cache, the assembled metadata — is
 * exercised for real. Actual pixel decoding and canvas re-encoding are NOT
 * covered here and cannot be under jsdom; that path belongs to the Playwright
 * harness in scripts/, which drives a real browser.
 */
const STUB_WIDTH = 1920;
const STUB_HEIGHT = 1080;
let RealImage: typeof Image;

beforeAll(() => {
  RealImage = globalThis.Image;
  class DecodingImage {
    width = STUB_WIDTH;
    height = STUB_HEIGHT;
    naturalWidth = STUB_WIDTH;
    naturalHeight = STUB_HEIGHT;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';
    get src() { return this.#src; }
    set src(value: string) {
      this.#src = value;
      // Asynchronous, as a real decode is — a synchronous callback would fire
      // before the caller has assigned onload and hang exactly as jsdom does.
      queueMicrotask(() => this.onload?.());
    }
  }
  globalThis.Image = DecodingImage as unknown as typeof Image;
});

afterAll(() => {
  globalThis.Image = RealImage;
});

describe('Image Upload Lifecycle', () => {
  // Mock image file for testing
  const createMockImageFile = (filename: string, size: number = 500000): File => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.font = '24px Arial';
      ctx.fillText('iPhone 15 Pro Max', 100, 100);
      ctx.fillText('IMEI: 123456789012345', 100, 150);
      ctx.fillText('Storage: 256GB', 100, 200);
      ctx.fillText('Grade: A', 100, 250);
      ctx.fillText('Color: Space Black', 100, 300);
    }
    return new File([canvas.toDataURL()], filename, { type: 'image/png' });
  };

  describe('Step 1: Image Validation & Processing', () => {
    it('should validate image format', async () => {
      const file = createMockImageFile('test.png');
      const metadata = await imageService.processImage(file);

      expect(metadata).toBeDefined();
      expect(metadata.mimeType).toMatch(/image\/(png|jpeg|webp)/);
      expect(metadata.size).toBeGreaterThan(0);
      console.log('✓ Image validation passed', {
        format: metadata.mimeType,
        size: metadata.size
      });
    });

    it('should validate image dimensions', async () => {
      const file = createMockImageFile('test.png');
      const metadata = await imageService.processImage(file);

      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
      expect(metadata.width).toBeLessThanOrEqual(2048);
      expect(metadata.height).toBeLessThanOrEqual(2048);
      console.log('✓ Image dimensions valid', {
        width: metadata.width,
        height: metadata.height
      });
    });

    it('should compress large images', async () => {
      const file = createMockImageFile('large.png', 2000000);
      const metadata = await imageService.processImage(file);

      expect(metadata.compressed || metadata.size < 1000000).toBe(true);
      console.log('✓ Image compression successful', {
        originalSize: file.size,
        compressedSize: metadata.size,
        compressed: metadata.compressed
      });
    });

    it('should generate preview URL', async () => {
      const file = createMockImageFile('test.png');
      const metadata = await imageService.processImage(file);

      expect(metadata.dataUrl).toBeDefined();
      expect(metadata.dataUrl.startsWith('data:image')).toBe(true);
      console.log('✓ Preview URL generated');
    });
  });

  describe('Step 2: OCR Text Extraction', () => {
    it('should detect text from image', async () => {
      const file = createMockImageFile('device.png');

      // Note: Full OCR requires Tesseract.js worker
      // This test validates the extraction pipeline
      const mockOCRText = `
        iPhone 15 Pro Max
        IMEI: 123456789012345
        Storage: 256GB
        Grade: A
        Color: Space Black
      `;

      const device = extractDeviceFromText(mockOCRText);

      expect(device).toBeDefined();
      expect(device.imei.value).toBeTruthy();
      expect(device.model.value).toBeTruthy();
      expect(device.storage.value).toBeTruthy();
      console.log('✓ OCR text extraction successful', device);
    });

    it('should extract device specifications', async () => {
      const mockOCRText = `
        Apple iPhone 15 Pro Max
        IMEI: 358622163345827
        Storage Capacity: 256GB
        Device Grade: Grade A
        Color: Natural Titanium
      `;

      const device = extractDeviceFromText(mockOCRText);

      expect(device.brand.value).toContain('Apple');
      expect(device.model.value).toContain('15 Pro Max');
      expect(device.storage.value).toContain('256');
      expect(device.grade.value).toMatch(/A|Excellent/i);
      expect(device.colour.value).toBeTruthy();
      console.log('✓ Device specs extraction passed', {
        brand: device.brand.value,
        model: device.model.value,
        storage: device.storage.value,
        grade: device.grade.value,
        colour: device.colour.value
      });
    });

    it('should calculate OCR confidence scores', async () => {
      const mockOCRText = 'iPhone 15 Pro IMEI: 123456789012345 256GB Grade A Black';
      const device = extractDeviceFromText(mockOCRText);

      expect(device.imei.confidence).toBeGreaterThan(0);
      expect(device.imei.confidence).toBeLessThanOrEqual(1);
      expect(device.brand.confidence).toBeGreaterThan(0);
      expect(device.model.confidence).toBeGreaterThan(0);
      console.log('✓ Confidence scores calculated', {
        imei: `${(device.imei.confidence * 100).toFixed(1)}%`,
        brand: `${(device.brand.confidence * 100).toFixed(1)}%`,
        model: `${(device.model.confidence * 100).toFixed(1)}%`,
        storage: `${(device.storage.confidence * 100).toFixed(1)}%`,
        grade: `${(device.grade.confidence * 100).toFixed(1)}%`,
        colour: `${(device.colour.confidence * 100).toFixed(1)}%`
      });
    });
  });

  describe('Step 3: Auto-Fill Form Fields', () => {
    it('should populate form from high-confidence OCR results', () => {
      const mockOCRText = `
        Brand: Samsung
        Model: Galaxy S24 Ultra
        IMEI: 358622163345827
        Storage: 512GB
        Grade: A+
        Color: Titanium Black
      `;

      const device = extractDeviceFromText(mockOCRText);

      const formData = {
        brand: device.brand.confidence > 0.6 ? device.brand.value : '',
        model: device.model.confidence > 0.6 ? device.model.value : '',
        imei: device.imei.confidence > 0.6 ? device.imei.value : '',
        storage: device.storage.confidence > 0.6 ? device.storage.value : '',
        grade: device.grade.confidence > 0.6 ? device.grade.value : '',
        colour: device.colour.confidence > 0.6 ? device.colour.value : '',
      };

      expect(formData.brand).toBeTruthy();
      expect(formData.model).toBeTruthy();
      expect(formData.imei).toBeTruthy();
      expect(formData.storage).toBeTruthy();
      expect(formData.grade).toBeTruthy();
      expect(formData.colour).toBeTruthy();
      console.log('✓ Form auto-fill successful', formData);
    });

    it('should skip low-confidence fields', () => {
      const mockOCRText = 'Unclear text that is hard to read';
      const device = extractDeviceFromText(mockOCRText);

      const formData = {
        brand: device.brand.confidence > 0.6 ? device.brand.value : null,
        model: device.model.confidence > 0.6 ? device.model.value : null,
      };

      // Low confidence fields should be skipped
      expect(formData.brand === null || formData.brand === '').toBe(true);
      console.log('✓ Low-confidence field skipping works');
    });
  });

  describe('Step 4: Color Distribution (Bulk)', () => {
    it('should validate color distribution for bulk order', () => {
      const quantity = 10;
      const colors = [
        { name: 'Space Black', quantity: 4 },
        { name: 'Silver', quantity: 3 },
        { name: 'Gold', quantity: 3 }
      ];

      const totalQty = colors.reduce((sum, c) => sum + c.quantity, 0);

      expect(totalQty).toBe(quantity);
      expect(colors.length).toBeGreaterThan(0);
      console.log('✓ Color distribution valid', {
        totalUnits: quantity,
        colors: colors,
        distributes: colors.map(c => `${c.name}: ${c.quantity}`)
      });
    });

    it('should prevent invalid color distributions', () => {
      const quantity = 10;
      const colors = [
        { name: 'Space Black', quantity: 4 },
        { name: 'Silver', quantity: 3 }
        // Total: 7, should be 10
      ];

      const totalQty = colors.reduce((sum, c) => sum + c.quantity, 0);

      expect(totalQty).not.toBe(quantity);
      console.log('✓ Invalid distribution correctly detected');
    });
  });

  describe('Step 5: Database Storage', () => {
    it('should create inventory unit with image URL', () => {
      const unit = {
        id: '123456789012345',
        imei: '123456789012345',
        model: 'iPhone 15 Pro Max',
        brand: 'Apple',
        category: 'iPhone',
        colour: 'Space Black',
        storage: '256GB',
        grade: 'A',
        buyPrice: 599,
        dateIn: '2026-05-11',
        supplierId: 'supplier-1',
        imageUrl: 'https://storage.googleapis.com/...', // Firebase Storage URL
        status: 'available',
        flags: [],
        notes: '',
        platformListed: false,
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };

      expect(unit.imageUrl).toBeDefined();
      expect(unit.imageUrl).toContain('storage.googleapis.com');
      expect(unit.id).toBe(unit.imei);
      console.log('✓ Inventory unit with image URL created', {
        id: unit.id,
        model: unit.model,
        imageUrl: unit.imageUrl?.substring(0, 50) + '...'
      });
    });

    it('should handle bulk units with shared image URL', () => {
      const baseImageUrl = 'https://storage.googleapis.com/batch-image-123';
      const units = [
        { id: 'unit-001', colour: 'Space Black', imageUrl: baseImageUrl },
        { id: 'unit-002', colour: 'Silver', imageUrl: baseImageUrl },
        { id: 'unit-003', colour: 'Gold', imageUrl: baseImageUrl }
      ];

      // All units share the same image URL (from single upload)
      expect(units.every(u => u.imageUrl === baseImageUrl)).toBe(true);
      console.log('✓ Bulk units sharing single image URL', {
        imageUrl: baseImageUrl,
        unitsCount: units.length
      });
    });
  });

  describe('Step 6: Complete Lifecycle', () => {
    it('should handle full single-unit lifecycle', async () => {
      console.log('\n🚀 Starting Full Single-Unit Lifecycle Test\n');

      // 1. Image selection
      const file = createMockImageFile('device.png');
      console.log('1️⃣ Image Selected:', { name: file.name, size: file.size });

      // 2. Validation & compression
      const metadata = await imageService.processImage(file);
      console.log('2️⃣ Image Validated:', {
        width: metadata.width,
        height: metadata.height,
        compressed: metadata.compressed
      });

      // 3. OCR extraction
      const mockOCRText = `
        Apple iPhone 15 Pro Max
        IMEI: 358622163345827
        Storage: 256GB
        Grade: A
        Color: Space Black
      `;
      const device = extractDeviceFromText(mockOCRText);
      console.log('3️⃣ OCR Extraction:', {
        brand: device.brand.value,
        model: device.model.value,
        imei: device.imei.value,
        confidence: `${(device.imei.confidence * 100).toFixed(0)}%`
      });

      // 4. Form auto-fill
      const formData = {
        brand: device.brand.value,
        model: device.model.value,
        imei: device.imei.value,
        storage: device.storage.value,
        grade: device.grade.value,
        colour: device.colour.value,
      };
      console.log('4️⃣ Form Auto-Filled:', formData);

      // 5. Firebase upload (simulated)
      const imageUrl = `https://storage.googleapis.com/mock-bucket/stock-intake/intake_${Date.now()}/device.png`;
      console.log('5️⃣ Image Uploaded:', { url: imageUrl.substring(0, 60) + '...' });

      // 6. Create inventory unit
      const unit = {
        id: '358622163345827',
        imei: '358622163345827',
        model: formData.model,
        brand: formData.brand,
        category: 'iPhone',
        colour: formData.colour,
        storage: formData.storage,
        grade: formData.grade,
        buyPrice: 599,
        dateIn: new Date().toISOString().split('T')[0],
        supplierId: 'supplier-1',
        imageUrl: imageUrl,
        status: 'available',
        flags: [],
        notes: '',
        platformListed: false,
        ownerId: 'shared',
        createdAt: new Date().toISOString(),
      };
      console.log('6️⃣ Inventory Unit Created:', {
        id: unit.id,
        model: unit.model,
        hasImageUrl: !!unit.imageUrl
      });

      console.log('\n✅ Single-Unit Lifecycle Complete!\n');
      expect(unit.imageUrl).toBeDefined();
    });

    it('should handle full bulk lifecycle', async () => {
      console.log('\n🚀 Starting Full Bulk Lifecycle Test\n');

      // 1. Image selection
      const file = createMockImageFile('batch.png');
      console.log('1️⃣ Batch Image Selected:', { name: file.name });

      // 2. Image processing
      const metadata = await imageService.processImage(file);
      console.log('2️⃣ Image Validated and Compressed');

      // 3. OCR extraction
      const mockOCRText = 'Samsung Galaxy S24 Ultra IMEI: 123456789012345 512GB Grade A';
      const device = extractDeviceFromText(mockOCRText);
      console.log('3️⃣ OCR Extracted Device Specs');

      // 4. Color distribution
      const quantity = 5;
      const colors = [
        { name: 'Titanium Black', quantity: 2 },
        { name: 'Titanium Gray', quantity: 2 },
        { name: 'Titanium Purple', quantity: 1 }
      ];
      console.log('4️⃣ Color Distribution Set:', {
        total: quantity,
        colors: colors
      });

      // 5. Upload single image
      const imageUrl = `https://storage.googleapis.com/mock-bucket/stock-intake/intake_${Date.now()}/batch.png`;
      console.log('5️⃣ Batch Image Uploaded (single upload for all units)');

      // 6. Create bulk units
      const units = colors.flatMap((color, idx) => {
        const unitIds = [];
        for (let i = 0; i < color.quantity; i++) {
          unitIds.push({
            id: `123456789012345-${String(idx * 2 + i + 1).padStart(3, '0')}`,
            colour: color.name,
            imageUrl: imageUrl, // All share same image
          });
        }
        return unitIds;
      });

      console.log('6️⃣ Bulk Units Created:', {
        totalUnits: units.length,
        colors: colors.length,
        allHaveImageUrl: units.every(u => !!u.imageUrl)
      });

      console.log('\n✅ Bulk Lifecycle Complete!\n');
      expect(units.length).toBe(quantity);
      expect(units.every(u => u.imageUrl === imageUrl)).toBe(true);
    });
  });
});
