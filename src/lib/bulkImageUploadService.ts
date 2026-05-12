import { imageService, ImageMetadata } from './imageService';

export interface BulkUploadJob {
  id: string;
  files: File[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  processedCount: number;
  failedCount: number;
  results: Map<string, ImageMetadata | Error>;
  startTime: number;
  endTime?: number;
}

export interface BulkUploadProgress {
  jobId: string;
  processed: number;
  total: number;
  failed: number;
  percentage: number;
  elapsedMs: number;
  estimatedRemainingMs: number;
  currentFile?: string;
}

export class BulkImageUploadService {
  private static instance: BulkImageUploadService;
  private jobs = new Map<string, BulkUploadJob>();
  private progressListeners: ((progress: BulkUploadProgress) => void)[] = [];
  private readonly MAX_CONCURRENT = 3; // Process 3 images in parallel
  private readonly RETRY_ATTEMPTS = 2;

  private constructor() {}

  static getInstance(): BulkImageUploadService {
    if (!BulkImageUploadService.instance) {
      BulkImageUploadService.instance = new BulkImageUploadService();
    }
    return BulkImageUploadService.instance;
  }

  createJob(files: File[]): BulkUploadJob {
    const jobId = `bulk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const job: BulkUploadJob = {
      id: jobId,
      files,
      status: 'pending',
      progress: 0,
      processedCount: 0,
      failedCount: 0,
      results: new Map(),
      startTime: Date.now(),
    };
    this.jobs.set(jobId, job);
    console.log(`[BulkUpload] Job created: ${jobId} with ${files.length} files`);
    return job;
  }

  async processJob(jobId: string): Promise<BulkUploadJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    job.status = 'processing';
    job.startTime = Date.now();

    try {
      // Process files in chunks based on MAX_CONCURRENT
      const chunks = this.chunkArray(job.files, this.MAX_CONCURRENT);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];

        // Process each file in parallel within the chunk
        const promises = chunk.map((file, index) => {
          const fileIndex = chunkIndex * this.MAX_CONCURRENT + index;
          return this.processFileWithRetry(job, file, fileIndex);
        });

        await Promise.all(promises);
      }

      job.status = 'completed';
      job.endTime = Date.now();
      console.log(`[BulkUpload] Job completed: ${jobId} (${job.processedCount} success, ${job.failedCount} failed)`);
    } catch (err) {
      job.status = 'failed';
      job.endTime = Date.now();
      console.error(`[BulkUpload] Job failed: ${jobId}`, err);
    }

    return job;
  }

  private async processFileWithRetry(
    job: BulkUploadJob,
    file: File,
    fileIndex: number,
    attempt = 1
  ): Promise<void> {
    try {
      this.emitProgress(job, file.name);

      // Process image
      const metadata = await imageService.processImage(file);

      // Store result
      job.results.set(file.name, metadata);
      job.processedCount++;
      job.progress = Math.round((job.processedCount / job.files.length) * 100);

      console.log(`[BulkUpload] Processed: ${file.name} (${job.processedCount}/${job.files.length})`);
      this.emitProgress(job, file.name);
    } catch (err) {
      if (attempt < this.RETRY_ATTEMPTS) {
        console.warn(`[BulkUpload] Retry ${attempt}/${this.RETRY_ATTEMPTS} for ${file.name}`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Exponential backoff
        await this.processFileWithRetry(job, file, fileIndex, attempt + 1);
      } else {
        job.results.set(file.name, err instanceof Error ? err : new Error(String(err)));
        job.failedCount++;
        job.progress = Math.round(((job.processedCount + job.failedCount) / job.files.length) * 100);
        console.error(`[BulkUpload] Failed permanently: ${file.name}`, err);
        this.emitProgress(job, file.name);
      }
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private emitProgress(job: BulkUploadJob, currentFile?: string): void {
    const elapsedMs = Date.now() - job.startTime;
    const itemsProcessed = job.processedCount + job.failedCount;
    const itemsRemaining = job.files.length - itemsProcessed;

    let estimatedRemainingMs = 0;
    if (itemsProcessed > 0 && itemsRemaining > 0) {
      const avgTimePerItem = elapsedMs / itemsProcessed;
      estimatedRemainingMs = Math.round(avgTimePerItem * itemsRemaining);
    }

    const progress: BulkUploadProgress = {
      jobId: job.id,
      processed: itemsProcessed,
      total: job.files.length,
      failed: job.failedCount,
      percentage: job.progress,
      elapsedMs,
      estimatedRemainingMs,
      currentFile,
    };

    this.progressListeners.forEach(listener => {
      try {
        listener(progress);
      } catch (err) {
        console.warn('[BulkUpload] Progress listener error:', err);
      }
    });
  }

  subscribeProgress(callback: (progress: BulkUploadProgress) => void): () => void {
    this.progressListeners.push(callback);
    return () => {
      this.progressListeners = this.progressListeners.filter(l => l !== callback);
    };
  }

  getJob(jobId: string): BulkUploadJob | undefined {
    return this.jobs.get(jobId);
  }

  getResults(jobId: string): { success: ImageMetadata[]; failed: string[] } | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    const success: ImageMetadata[] = [];
    const failed: string[] = [];

    for (const [filename, result] of job.results.entries()) {
      if (result instanceof Error) {
        failed.push(`${filename}: ${result.message}`);
      } else {
        success.push(result);
      }
    }

    return { success, failed };
  }

  clearJob(jobId: string): void {
    this.jobs.delete(jobId);
    console.log(`[BulkUpload] Job cleared: ${jobId}`);
  }

  getStats() {
    const jobs = Array.from(this.jobs.values());
    const completedJobs = jobs.filter(j => j.status === 'completed');
    const totalFilesProcessed = completedJobs.reduce((sum, j) => sum + j.processedCount, 0);
    const totalFilesFailed = completedJobs.reduce((sum, j) => sum + j.failedCount, 0);

    return {
      totalJobs: jobs.length,
      completedJobs: completedJobs.length,
      totalFilesProcessed,
      totalFilesFailed,
      successRate: totalFilesProcessed / (totalFilesProcessed + totalFilesFailed || 1),
    };
  }
}

export const bulkImageUploadService = BulkImageUploadService.getInstance();
