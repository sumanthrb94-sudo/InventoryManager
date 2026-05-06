import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_lib/supabase';
import { handleOptions, ok, err } from './_lib/cors';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405);

  const { from, to } = req.query as Record<string, string>;

  // Fetch all units
  const { data: units, error } = await supabase
    .from('inventory_units')
    .select('id, status, buy_price, sale_price, sale_date, date_in, model, colour, supplier_id, postage_cost, sale_platform')
    .order('date_in', { ascending: false })
    .limit(15000);

  if (error) return err(res, error.message, 500);

  const rows = units || [];

  // Filter sold units by date range
  const soldAll = rows.filter(u => u.status === 'sold');
  const soldFiltered = from || to
    ? soldAll.filter(u => {
        const d = u.sale_date || '';
        return (!from || d >= from) && (!to || d <= to);
      })
    : soldAll;

  const totalRevenue  = soldFiltered.reduce((s, u) => s + (u.sale_price || 0), 0);
  const totalCost     = soldFiltered.reduce((s, u) => s + (u.buy_price || 0), 0);
  const totalPostage  = soldFiltered.reduce((s, u) => s + (u.postage_cost || 8), 0);
  const grossProfit   = totalRevenue - totalCost - totalPostage;

  // Inventory health
  const available     = rows.filter(u => u.status === 'available');
  const incoming      = rows.filter(u => u.status === 'incoming');
  const returned      = rows.filter(u => u.status === 'returned');
  const stockValue    = available.reduce((s, u) => s + (u.buy_price || 0), 0);

  // Top models by units sold
  const modelCounts: Record<string, number> = {};
  soldFiltered.forEach(u => { modelCounts[u.model] = (modelCounts[u.model] || 0) + 1; });
  const topModels = Object.entries(modelCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([model, count]) => ({ model, count }));

  // Platform breakdown
  const platformRevenue: Record<string, { count: number; revenue: number }> = {};
  soldFiltered.forEach(u => {
    const p = u.sale_platform || 'Unknown';
    if (!platformRevenue[p]) platformRevenue[p] = { count: 0, revenue: 0 };
    platformRevenue[p].count++;
    platformRevenue[p].revenue += u.sale_price || 0;
  });

  // Daily sales (last 30 days)
  const dailySales: Record<string, { count: number; revenue: number }> = {};
  soldFiltered.forEach(u => {
    const d = (u.sale_date || '').slice(0, 10);
    if (!d) return;
    if (!dailySales[d]) dailySales[d] = { count: 0, revenue: 0 };
    dailySales[d].count++;
    dailySales[d].revenue += u.sale_price || 0;
  });

  return ok(res, {
    kpis: {
      totalSold:     soldFiltered.length,
      totalRevenue,
      totalCost,
      totalPostage,
      grossProfit,
      margin:        totalRevenue > 0 ? Math.round((grossProfit / totalRevenue) * 100) : 0,
      avgProfit:     soldFiltered.length > 0 ? Math.round(grossProfit / soldFiltered.length) : 0,
    },
    inventory: {
      available:  available.length,
      incoming:   incoming.length,
      returned:   returned.length,
      stockValue,
    },
    topModels,
    platformBreakdown: Object.entries(platformRevenue).map(([platform, d]) => ({ platform, ...d })),
    dailySales: Object.entries(dailySales)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, ...d })),
  });
}
