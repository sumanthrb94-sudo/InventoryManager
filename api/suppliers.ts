import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase';
import { handleOptions, ok, err, setCors } from './_lib/cors';
import { requireAdmin } from './_lib/auth';
import { pickSupplier, randomId } from './_lib/validate';

function toCamel(s: string) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }
function toSnake(s: string) { return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`); }
const dbToApp = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
const appToDb = (obj: Record<string, any>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  const caller = await requireAdmin(req, res);
  if (!caller) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('suppliers').select('*').order('created_at', { ascending: false });
    if (error) return err(res, error.message, 500);
    return ok(res, (data || []).map(dbToApp));
  }

  if (req.method === 'POST') {
    const body = pickSupplier(req.body);
    if (!body.name) return err(res, 'name is required');
    const id = (typeof body.id === 'string' && body.id) || randomId();
    const now = new Date().toISOString();
    const row = appToDb({
      ...body,
      id,
      ownerId: caller.email,
      createdAt: now,
      updatedAt: now,
    });
    const { data, error } = await supabase.from('suppliers').upsert(row).select().single();
    if (error) return err(res, error.message, 500);
    return ok(res, dbToApp(data), 201);
  }

  return err(res, 'Method not allowed', 405);
}
