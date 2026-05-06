import type { VercelRequest, VercelResponse } from '@vercel/node';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export function setCors(res: VercelResponse) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

export function handleOptions(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function ok(res: VercelResponse, data: unknown, status = 200) {
  setCors(res);
  return res.status(status).json({ ok: true, data });
}

export function err(res: VercelResponse, message: string, status = 400) {
  setCors(res);
  return res.status(status).json({ ok: false, error: message });
}
