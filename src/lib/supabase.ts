import { createClient } from '@supabase/supabase-js';

// Supabase credentials from environment
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://hpeyrtxcmiasvpfhsffu.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// Initialize Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// Storage bucket configuration
export const STORAGE_BUCKETS = {
  STOCK_INTAKE_IMAGES: 'stock-intake-images',
  DEVICE_PHOTOS: 'device-photos',
  BATCH_IMPORTS: 'batch-imports',
} as const;

// Storage paths
export const getStoragePath = {
  stockIntakeImage: (jobId: string, filename: string) =>
    `stock-intake/${jobId}/${filename}`,
  batchImportImage: (batchId: string, filename: string) =>
    `batch-import/${batchId}/${filename}`,
  devicePhoto: (deviceId: string, filename: string) =>
    `devices/${deviceId}/${filename}`,
} as const;

export type StorageClient = typeof supabase;
