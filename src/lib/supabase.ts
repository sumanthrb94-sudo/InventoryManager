import { createClient } from '@supabase/supabase-js';

// Supabase credentials from environment — no fallback so a missing config fails
// loudly at boot instead of silently leaking a real project URL/key from source.
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase env not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

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
