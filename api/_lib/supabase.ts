import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!url || !key) {
  throw new Error(
    'Supabase env not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_KEY).',
  );
}

export const supabase = createClient(url, key);
