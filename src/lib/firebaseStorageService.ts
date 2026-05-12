import { storage } from './firebase';
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from 'firebase/storage';

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

class FirebaseStorageService {
  private static instance: FirebaseStorageService;

  private constructor() {}

  static getInstance(): FirebaseStorageService {
    if (!FirebaseStorageService.instance) {
      FirebaseStorageService.instance = new FirebaseStorageService();
    }
    return FirebaseStorageService.instance;
  }

  /**
   * Upload a single image to Firebase Storage
   * @param file Image file to upload
   * @param storagePath Path within storage bucket
   * @param onProgress Optional progress callback
   * @returns Uploaded image metadata with download URL
   */
  async uploadImage(
    file: File,
    storagePath: string,
    onProgress?: (progress: number) => void
  ): Promise<UploadedImage> {
    try {
      console.log(`[Firebase Storage] Uploading ${file.name} to ${storagePath}`);

      // Create unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 9);
      const ext = file.name.split('.').pop();
      const filename = `${timestamp}-${random}.${ext}`;
      const fullPath = `${storagePath}/${filename}`;

      // Upload file
      const fileRef = ref(storage, fullPath);
      await uploadBytes(fileRef, file, {
        contentType: file.type,
        customMetadata: {
          originalName: file.name,
        },
      });

      console.log(`[Firebase Storage] Upload successful: ${fullPath}`);
      onProgress?.(100);

      // Get download URL
      const downloadUrl = await getDownloadURL(fileRef);

      const uploadedImage: UploadedImage = {
        id: filename,
        url: downloadUrl,
        path: fullPath,
        size: file.size,
        mimeType: file.type,
        uploadedAt: new Date().toISOString(),
        metadata: {
          originalName: file.name,
        },
      };

      return uploadedImage;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Firebase Storage] Upload failed:`, errorMsg);
      onProgress?.(0);
      throw new Error(`Failed to upload image: ${errorMsg}`);
    }
  }

  /**
   * Batch upload multiple images
   * @param files Array of files to upload
   * @param storagePathGenerator Function to generate storage path for each file
   * @param onProgress Progress callback
   * @returns Array of uploaded images and failed uploads
   */
  async batchUploadImages(
    files: File[],
    storagePathGenerator: (file: File, index: number) => string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ success: UploadedImage[]; failed: string[] }> {
    const success: UploadedImage[] = [];
    const failed: string[] = [];

    console.log(`[Firebase Storage] Starting batch upload of ${files.length} images`);

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

    console.log(`[Firebase Storage] Batch complete: ${success.length} success, ${failed.length} failed`);
    return { success, failed };
  }

  /**
   * Delete an image from storage
   * @param storagePath Full path to the image
   */
  async deleteImage(storagePath: string): Promise<void> {
    try {
      console.log(`[Firebase Storage] Deleting ${storagePath}`);
      const fileRef = ref(storage, storagePath);
      await deleteObject(fileRef);
      console.log(`[Firebase Storage] Deleted successfully: ${storagePath}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Firebase Storage] Delete failed:`, errorMsg);
      throw new Error(`Failed to delete image: ${errorMsg}`);
    }
  }

  /**
   * List images in a storage path
   * @param folderPath Folder path to list
   */
  async listImages(folderPath: string): Promise<UploadedImage[]> {
    try {
      console.log(`[Firebase Storage] Listing images in ${folderPath}`);
      const folderRef = ref(storage, folderPath);
      const result = await listAll(folderRef);

      const images: UploadedImage[] = [];

      for (const fileRef of result.items) {
        const url = await getDownloadURL(fileRef);
        images.push({
          id: fileRef.name,
          url,
          path: fileRef.fullPath,
          size: 0, // Firebase doesn't provide size in listAll
          mimeType: 'image/unknown',
          uploadedAt: new Date().toISOString(),
        });
      }

      return images;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Firebase Storage] List failed:`, errorMsg);
      throw new Error(`Failed to list images: ${errorMsg}`);
    }
  }

  getStats() {
    return {
      status: 'ready',
    };
  }
}

export const firebaseStorageService = FirebaseStorageService.getInstance();
