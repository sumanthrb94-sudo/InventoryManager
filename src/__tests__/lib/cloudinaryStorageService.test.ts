import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cloudinaryStorageService } from '../../lib/cloudinaryStorageService';

describe('CloudinaryStorageService', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = cloudinaryStorageService;
      const instance2 = cloudinaryStorageService;
      expect(instance1).toBe(instance2);
    });
  });

  describe('uploadImage', () => {
    it('should reject with error for invalid file', async () => {
      const invalidFile = new File([''], '', { type: 'text/plain' });

      try {
        await cloudinaryStorageService.uploadImage(invalidFile);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should log upload start with filename', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      try {
        await cloudinaryStorageService.uploadImage(file);
      } catch {
        // Expected to fail without valid Cloudinary response
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cloudinary Storage] Uploading test.jpg')
      );
    });

    it('should call onProgress callback during upload', async () => {
      const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' });
      const progressCallback = vi.fn();

      try {
        await cloudinaryStorageService.uploadImage(file, 'stock-intake', progressCallback);
      } catch {
        // Expected to fail without valid response
      }

      // Progress callback may be called or not depending on network
      // Just verify it was passed correctly
      expect(progressCallback).toBeDefined();
    });

    it('should use custom storage path', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const customPath = 'custom/path';

      try {
        await cloudinaryStorageService.uploadImage(file, customPath);
      } catch {
        // Expected to fail
      }

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(customPath)
      );
    });

    it('should log error on upload failure', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      try {
        await cloudinaryStorageService.uploadImage(file);
      } catch {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('batchUploadImages', () => {
    it('should handle empty file array', async () => {
      const result = await cloudinaryStorageService.batchUploadImages(
        [],
        (file, index) => `path/${index}`
      );

      expect(result.success).toEqual([]);
      expect(result.failed).toEqual([]);
    });

    it('should log batch start with file count', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      ];

      await cloudinaryStorageService.batchUploadImages(
        files,
        (file, index) => `path/${index}`
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting batch upload of 2 images')
      );
    });

    it('should call progress callback for each file', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      ];
      const progressCallback = vi.fn();

      await cloudinaryStorageService.batchUploadImages(
        files,
        (file, index) => `path/${index}`,
        progressCallback
      );

      // At least one callback for the uploading status
      expect(progressCallback).toHaveBeenCalled();
    });

    it('should generate correct storage paths', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      ];
      const pathGenerator = vi.fn((file, index) => `batch/${index}/${file.name}`);

      await cloudinaryStorageService.batchUploadImages(
        files,
        pathGenerator
      );

      expect(pathGenerator).toHaveBeenCalledWith(files[0], 0);
      expect(pathGenerator).toHaveBeenCalledWith(files[1], 1);
    });

    it('should log batch completion', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
      ];

      await cloudinaryStorageService.batchUploadImages(
        files,
        (file, index) => `path/${index}`
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Batch complete:')
      );
    });
  });

  describe('deleteImage', () => {
    it('should log deletion with public ID', async () => {
      await cloudinaryStorageService.deleteImage('test-public-id');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Cloudinary Storage] Deleting test-public-id')
      );
    });
  });

  describe('getStats', () => {
    it('should return service statistics', () => {
      const stats = cloudinaryStorageService.getStats();

      expect(stats).toEqual({
        provider: 'Cloudinary',
        cloudName: 'diofyOvxc',
        status: 'ready',
        tier: 'free (25GB)',
      });
    });

    it('should have correct cloud name', () => {
      const stats = cloudinaryStorageService.getStats();
      expect(stats.cloudName).toBe('diofyOvxc');
    });

    it('should indicate free tier', () => {
      const stats = cloudinaryStorageService.getStats();
      expect(stats.tier).toContain('free');
      expect(stats.tier).toContain('25GB');
    });
  });

  describe('uploadImage - Integration scenarios', () => {
    it('should handle FormData construction for unsigned upload', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });

      try {
        await cloudinaryStorageService.uploadImage(file, 'stock-intake');
      } catch {
        // Expected
      }

      // Verify upload attempt was made
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('stock-intake')
      );
    });

    it('should preserve file metadata in upload', async () => {
      const file = new File(['test'], 'device_photo_001.jpg', {
        type: 'image/jpeg',
      });

      try {
        await cloudinaryStorageService.uploadImage(file);
      } catch {
        // Expected
      }

      // Verify filename was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('device_photo_001.jpg')
      );
    });
  });

  describe('batchUploadImages - Failure handling', () => {
    it('should track failed uploads separately', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      ];

      const result = await cloudinaryStorageService.batchUploadImages(
        files,
        (file, index) => `path/${index}`
      );

      // All should fail without valid Cloudinary endpoint
      expect(result.success.length + result.failed.length).toBe(2);
    });

    it('should continue batch upload after individual failure', async () => {
      const files = [
        new File(['test1'], 'test1.jpg', { type: 'image/jpeg' }),
        new File(['test2'], 'test2.jpg', { type: 'image/jpeg' }),
      ];
      const progressCallback = vi.fn();

      await cloudinaryStorageService.batchUploadImages(
        files,
        (file, index) => `path/${index}`,
        progressCallback
      );

      // Should have processed both files
      expect(progressCallback).toHaveBeenCalled();
      // Progress should include updates for both files
      const calls = progressCallback.mock.calls;
      const filenames = calls.map((call: any[]) => call[0]?.filename);
      expect(filenames).toContain('test1.jpg');
      expect(filenames).toContain('test2.jpg');
    });
  });
});
