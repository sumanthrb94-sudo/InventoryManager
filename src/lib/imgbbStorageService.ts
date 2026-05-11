/**
 * Imgbb Storage Service
 * Free image hosting - 25,600 images/month
 * No complex setup, just paste API key
 */

export interface UploadedImage {
  id: string;
  url: string;
  path: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  metadata?: Record<string, any>;
}

export interface UploadProgress {
  filename: string;
  progress: number;
  status: 'uploading' | 'completed' | 'failed';
  error?: string;
}

const IMGBB_API_KEY = import.meta.env.VITE_IMGBB_API_KEY;
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

class ImgbbStorageService {
  private static instance: ImgbbStorageService;

  private constructor() {
    if (!IMGBB_API_KEY) {
      console.warn('[Imgbb Storage] API key not found. Set VITE_IMGBB_API_KEY in .env');
    }
  }

  static getInstance(): ImgbbStorageService {
    if (!ImgbbStorageService.instance) {
      ImgbbStorageService.instance = new ImgbbStorageService();
    }
    return ImgbbStorageService.instance;
  }

  /**
   * Upload a single image to Imgbb
   * @param file Image file to upload
   * @param onProgress Optional progress callback
   * @returns Uploaded image metadata with URL
   */
  async uploadImage(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<UploadedImage> {
    try {
      if (!IMGBB_API_KEY) {
        throw new Error('Imgbb API key not configured. Set VITE_IMGBB_API_KEY in .env');
      }

      console.log(`[Imgbb Storage] Uploading ${file.name}`);
      onProgress?.(10);

      // Create FormData for Imgbb
      const formData = new FormData();
      formData.append('image', file);
      formData.append('key', IMGBB_API_KEY);

      // Upload with progress tracking
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 80) + 10; // 10-90%
          console.log(`[Imgbb Storage] Upload progress: ${progress}%`);
          onProgress?.(progress);
        }
      });

      // Promise wrapper for XHR
      const uploadPromise = new Promise<UploadedImage>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            if (response.success) {
              console.log(`[Imgbb Storage] Upload successful: ${response.data.url}`);

              const uploadedImage: UploadedImage = {
                id: response.data.id,
                url: response.data.url,
                path: response.data.filename,
                size: file.size,
                mimeType: file.type,
                uploadedAt: new Date().toISOString(),
                metadata: {
                  originalName: file.name,
                  imgbbId: response.data.id,
                  imgbbDeleteUrl: response.data.delete_url,
                },
              };

              resolve(uploadedImage);
            } else {
              reject(new Error(`Upload failed: ${response.error?.message || 'Unknown error'}`));
            }
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload was aborted'));
        });

        xhr.open('POST', IMGBB_UPLOAD_URL);
        xhr.send(formData);
      });

      const result = await uploadPromise;
      onProgress?.(100);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Imgbb Storage] Upload failed:`, errorMsg);
      onProgress?.(0);
      throw new Error(`Failed to upload image: ${errorMsg}`);
    }
  }

  /**
   * Batch upload multiple images
   * @param files Array of files to upload
   * @param onProgress Progress callback
   * @returns Array of uploaded images and failed uploads
   */
  async batchUploadImages(
    files: File[],
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ success: UploadedImage[]; failed: string[] }> {
    const success: UploadedImage[] = [];
    const failed: string[] = [];

    console.log(`[Imgbb Storage] Starting batch upload of ${files.length} images`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      try {
        onProgress?.({
          filename: file.name,
          progress: Math.round((i / files.length) * 100),
          status: 'uploading',
        });

        const uploaded = await this.uploadImage(file, (progress) => {
          onProgress?.({
            filename: file.name,
            progress: Math.round(((i + progress / 100) / files.length) * 100),
            status: progress === 100 ? 'completed' : 'uploading',
          });
        });

        success.push(uploaded);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failed.push(`${file.name}: ${errorMsg}`);
        onProgress?.({
          filename: file.name,
          progress: 0,
          status: 'failed',
          error: errorMsg,
        });
      }
    }

    console.log(`[Imgbb Storage] Batch complete: ${success.length} success, ${failed.length} failed`);
    return { success, failed };
  }

  /**
   * Delete an image from Imgbb
   * @param deleteUrl Imgbb delete URL
   */
  async deleteImage(deleteUrl: string): Promise<void> {
    try {
      console.log(`[Imgbb Storage] Deleting image`);
      const response = await fetch(deleteUrl);
      if (response.ok) {
        console.log(`[Imgbb Storage] Image deleted successfully`);
      } else {
        console.warn(`[Imgbb Storage] Delete request returned status ${response.status}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Imgbb Storage] Delete failed:`, errorMsg);
      throw new Error(`Failed to delete image: ${errorMsg}`);
    }
  }

  getStats() {
    return {
      provider: 'Imgbb',
      status: 'ready',
      tier: 'free (25,600 images/month)',
      apiKeyConfigured: !!IMGBB_API_KEY,
    };
  }
}

export const imgbbStorageService = ImgbbStorageService.getInstance();
