import type { VercelRequest, VercelResponse } from '@vercel/node';

// Origin allow-list comes from env. Comma-separated list, e.g.
// CORS_ALLOWED_ORIGINS="https://app.mobilephonemarket.com,https://staging.mobilephonemarket.com"
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function pickOrigin(req: VercelRequest): string | null {
  const origin = (req.headers.origin as string | undefined) || '';
  if (!origin) return null;
  if (ALLOWED_ORIGINS.length === 0) return null; // closed by default
  if (ALLOWED_ORIGINS.includes('*')) return origin;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = pickOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCors(req, res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function ok(res: VercelResponse, data: unknown, status = 200) {
  // setCors already applied via handleOptions / explicit call in handlers
  return res.status(status).json({ ok: true, data });
}

export function err(res: VercelResponse, message: string, status = 400) {
  return res.status(status).json({ ok: false, error: message });
}
