import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_lib/supabase';
import { handleOptions, ok, err } from '../_lib/cors';

function toCamel(s: string) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }
function toSnake(s: string) { return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`); }

function dbToApp(row: Record<string, any>) {
  const obj = Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));
  if (!Array.isArray(obj.flags)) obj.flags = [];
  if (!Array.isArray(obj.listingSites)) obj.listingSites = [];
  return obj;
}

function appToDb(obj: Record<string, any>) {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([k, v]) => v !== undefined && k !== 'supplierName')
      .map(([k, v]) => [toSnake(k), v]),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;

  const { id } = req.query as { id: string };
  if (!id) return err(res, 'id is required');

  // GET /api/inventory/:id
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('inventory_units').select('*').eq('id', id).single();
    if (error) return err(res, error.message, error.code === 'PGRST116' ? 404 : 500);
    return ok(res, dbToApp(data));
  }

  // PUT /api/inventory/:id — full or partial update
  if (req.method === 'PUT') {
    const now = new Date().toISOString();
    const row = appToDb({ ...req.body, id, updatedAt: now });
    const { data, error } = await supabase
      .from('inventory_units').upsert(row).select().single();
    if (error) return err(res, error.message, 500);
    return ok(res, dbToApp(data));
  }

  // DELETE /api/inventory/:id — soft delete (sets deleted_at). Pass ?hard=true to remove.
  if (req.method === 'DELETE') {
    const hard = String((req.query as Record<string, string>).hard || '') === 'true';
    if (hard) {
      const { error } = await supabase.from('inventory_units').delete().eq('id', id);
      if (error) return err(res, error.message, 500);
      return ok(res, { deleted: id, hard: true });
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('inventory_units')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', id).select().single();
    if (error) return err(res, error.message, 500);
    return ok(res, { deleted: id, deletedAt: now, unit: dbToApp(data) });
  }

  return err(res, 'Method not allowed', 405);
}
