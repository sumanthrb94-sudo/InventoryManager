import { supabase, STORAGE_BUCKETS, getStoragePath } from './supabase';

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

class SupabaseStorageService {
  private static instance: SupabaseStorageService;
  private uploadListeners: ((progress: UploadProgress) => void)[] = [];

  private constructor() {}

  static getInstance(): SupabaseStorageService {
    if (!SupabaseStorageService.instance) {
      SupabaseStorageService.instance = new SupabaseStorageService();
    }
    return SupabaseStorageService.instance;
  }

  /**
   * Upload a single image to Supabase Storage
   * @param file Image file to upload
   * @param bucketName Storage bucket name
   * @param storagePath Path within the bucket
   * @param onProgress Optional progress callback
   * @returns Uploaded image metadata
   */
  async uploadImage(
    file: File,
    bucketName: string,
    storagePath: string,
    onProgress?: (progress: number) => void
  ): Promise<UploadedImage> {
    try {
      console.log(`[Supabase Storage] Uploading ${file.name} to ${storagePath}`);

      // Create a unique filename to avoid collisions
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const ext = file.name.split('.').pop();
      const filename = `${timestamp}-${random}.${ext}`;
      const fullPath = `${storagePath}/${filename}`;

      // Upload file with progress tracking
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(fullPath, file, {
          cacheControl: '31536000',
          upsert: false,
          contentType: file.type,
        });

      if (error) {
        throw new Error(`Upload failed: ${error.message}`);
      }

      console.log(`[Supabase Storage] Upload successful: ${fullPath}`);
      onProgress?.(100);

      // Get public URL
      const { data: publicData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fullPath);

      const uploadedImage: UploadedImage = {
        id: filename,
        url: publicData.publicUrl,
        path: fullPath,
        size: file.size,
        mimeType: file.type,
        uploadedAt: new Date().toISOString(),
        metadata: {
          originalName: file.name,
          bucket: bucketName,
        },
      };

      return uploadedImage;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Supabase Storage] Upload failed:`, errorMsg);
      onProgress?.(0);
      throw new Error(`Failed to upload image: ${errorMsg}`);
    }
  }

  /**
   * Batch upload multiple images
   * @param files Array of files to upload
   * @param bucketName Storage bucket name
   * @param storagePathGenerator Function to generate storage path for each file
   * @param onProgress Progress callback
   * @returns Array of uploaded images and failed uploads
   */
  async batchUploadImages(
    files: File[],
    bucketName: string,
    storagePathGenerator: (file: File, index: number) => string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ success: UploadedImage[]; failed: string[] }> {
    const success: UploadedImage[] = [];
    const failed: string[] = [];

    console.log(`[Supabase Storage] Starting batch upload of ${files.length} images`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const storagePath = storagePathGenerator(file, i);

      try {
        onProgress?.({
          filename: file.name,
          progress: Math.round((i / files.length) * 100),
          status: 'uploading',
        });

        const uploaded = await this.uploadImage(
          file,
          bucketName,
          storagePath,
          (progress) => {
            onProgress?.({
              filename: file.name,
              progress: Math.round(((i + progress / 100) / files.length) * 100),
              status: progress === 100 ? 'completed' : 'uploading',
            });
          }
        );

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

    console.log(`[Supabase Storage] Batch complete: ${success.length} success, ${failed.length} failed`);
    return { success, failed };
  }

  /**
   * Delete an image from storage
   * @param bucketName Storage bucket name
   * @param storagePath Full path to the image
   */
  async deleteImage(bucketName: string, storagePath: string): Promise<void> {
    try {
      console.log(`[Supabase Storage] Deleting ${storagePath}`);
      const { error } = await supabase.storage.from(bucketName).remove([storagePath]);

      if (error) {
        throw new Error(`Delete failed: ${error.message}`);
      }

      console.log(`[Supabase Storage] Deleted successfully: ${storagePath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Supabase Storage] Delete failed:`, errorMsg);
      throw new Error(`Failed to delete image: ${errorMsg}`);
    }
  }

  /**
   * List images in a storage path
   * @param bucketName Storage bucket name
   * @param folderPath Folder path to list
   */
  async listImages(bucketName: string, folderPath: string): Promise<UploadedImage[]> {
    try {
      console.log(`[Supabase Storage] Listing images in ${folderPath}`);
      const { data, error } = await supabase.storage
        .from(bucketName)
        .list(folderPath);

      if (error) {
        throw new Error(`List failed: ${error.message}`);
      }

      // Convert file list to UploadedImage format
      const images: UploadedImage[] = data.map((file) => {
        const publicUrl = supabase.storage.from(bucketName).getPublicUrl(`${folderPath}/${file.name}`);
        return {
          id: file.id || file.name,
          url: publicUrl.data.publicUrl,
          path: `${folderPath}/${file.name}`,
          size: file.metadata?.size || 0,
          mimeType: file.metadata?.mimetype || 'image/unknown',
          uploadedAt: file.created_at || new Date().toISOString(),
        };
      });

      return images;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Supabase Storage] List failed:`, errorMsg);
      throw new Error(`Failed to list images: ${errorMsg}`);
    }
  }

  /**
   * Get download URL for an image
   * @param bucketName Storage bucket name
   * @param storagePath Full path to the image
   * @param expiresIn Expiration time in seconds (default 1 hour)
   */
  async getSignedUrl(
    bucketName: string,
    storagePath: string,
    expiresIn = 3600
  ): Promise<string> {
    try {
      const { data, error } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, expiresIn);

      if (error) {
        throw new Error(`Failed to create signed URL: ${error.message}`);
      }

      return data.signedUrl;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Supabase Storage] Signed URL creation failed:`, errorMsg);
      throw new Error(`Failed to get signed URL: ${errorMsg}`);
    }
  }

  /**
   * Check if a bucket exists, if not create it
   * @param bucketName Bucket name
   * @param options Bucket options
   */
  async ensureBucketExists(
    bucketName: string,
    options?: { public?: boolean }
  ): Promise<boolean> {
    try {
      console.log(`[Supabase Storage] Checking bucket: ${bucketName}`);

      // Try to list contents - if it works, bucket exists
      const { data, error } = await supabase.storage
        .from(bucketName)
        .list('', { limit: 1 });

      if (!error) {
        console.log(`[Supabase Storage] Bucket exists: ${bucketName}`);
        return true;
      }

      // If bucket doesn't exist, attempt to create it
      console.log(`[Supabase Storage] Creating bucket: ${bucketName}`);
      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: options?.public || false,
      });

      if (createError && !createError.message.includes('already exists')) {
        throw createError;
      }

      console.log(`[Supabase Storage] Bucket created/verified: ${bucketName}`);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Supabase Storage] Could not ensure bucket exists:`, errorMsg);
      // Return true anyway - may have permission issues but bucket might exist
      return true;
    }
  }

  subscribeProgress(callback: (progress: UploadProgress) => void): () => void {
    this.uploadListeners.push(callback);
    return () => {
      this.uploadListeners = this.uploadListeners.filter(l => l !== callback);
    };
  }

  getStats() {
    return {
      uploadListeners: this.uploadListeners.length,
      status: 'ready',
    };
  }
}

export const supabaseStorageService = SupabaseStorageService.getInstance();
