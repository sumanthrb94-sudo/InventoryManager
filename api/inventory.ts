import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase';
import { handleOptions, ok, err } from './_lib/cors';

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

  // GET /api/inventory?status=available&limit=500&offset=0
  if (req.method === 'GET') {
    const { status, model, search, limit = '500', offset = '0', includeDeleted, deletedOnly } = req.query as Record<string, string>;
    let q = supabase.from('inventory_units').select('*').order('date_in', { ascending: false });

    if (deletedOnly === 'true') {
      q = q.not('deleted_at', 'is', null);
    } else if (includeDeleted !== 'true') {
      q = q.is('deleted_at', null);
    }

    if (status)  q = q.eq('status', status);
    if (model)   q = q.ilike('model', `%${model}%`);
    if (search)  q = q.or(`model.ilike.%${search}%,imei.ilike.%${search}%,colour.ilike.%${search}%`);

    q = q.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data, error } = await q;
    if (error) return err(res, error.message, 500);
    return ok(res, (data || []).map(dbToApp));
  }

  // POST /api/inventory — create a unit
  if (req.method === 'POST') {
    const body = req.body;
    if (!body?.model || !body?.status) return err(res, 'model and status are required');
    const id = body.id || Math.random().toString(36).substring(2, 11);
    const now = new Date().toISOString();
    const row = appToDb({ ...body, id, createdAt: body.createdAt || now, updatedAt: now });
    const { data, error } = await supabase.from('inventory_units').upsert(row).select().single();
    if (error) return err(res, error.message, 500);
    return ok(res, dbToApp(data), 201);
  }

  return err(res, 'Method not allowed', 405);
}
