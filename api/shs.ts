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

  // GET /api/shs — SHS (incoming) units = listed with supplier.
  // ?includeDeleted=true also returns soft-deleted items (kept 48h for testing).
  // ?deletedOnly=true returns only soft-deleted items.
  if (req.method === 'GET') {
    const { includeDeleted, deletedOnly } = req.query as Record<string, string>;
    let q = supabase
      .from('inventory_units')
      .select('*')
      .eq('status', 'incoming')
      .order('created_at', { ascending: false });
    if (deletedOnly === 'true') {
      q = q.not('deleted_at', 'is', null);
    } else if (includeDeleted !== 'true') {
      q = q.is('deleted_at', null);
    }
    const { data, error } = await q;
    if (error) return err(res, error.message, 500);
    return ok(res, (data || []).map(dbToApp));
  }

  // POST /api/shs — create a new SHS listing
  if (req.method === 'POST') {
    const body = req.body;
    if (!body?.model) return err(res, 'model is required');
    const id = body.id || Math.random().toString(36).substring(2, 11);
    const now = new Date().toISOString();
    const row = appToDb({
      ...body,
      id,
      status: 'incoming',
      imei: body.imei || null,
      flags: body.flags || [],
      listingSites: body.listingSites || [],
      notes: body.notes || 'SHS - Listed with supplier',
      createdAt: body.createdAt || now,
      updatedAt: now,
    });
    const { data, error } = await supabase.from('inventory_units').upsert(row).select().single();
    if (error) return err(res, error.message, 500);
    return ok(res, dbToApp(data), 201);
  }

  // PUT /api/shs/:id/receive — mark SHS unit as received (needs IMEI)
  return err(res, 'Method not allowed', 405);
}
