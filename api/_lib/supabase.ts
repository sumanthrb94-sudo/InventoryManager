import { createClient } from '@supabase/supabase-js';

const url  = process.env.SUPABASE_URL  || 'https://hpeyrtxcmiasvpfhsffu.supabase.co';
const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_KDMIfMqh05jniQ0dsh9kig_kBM6_GRH';

export const supabase = createClient(url, key);
