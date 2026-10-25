export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const env = (name) => String(process.env[name] ?? '').trim();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export async function readJson(req, maxBytes = 6_000_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That request is too large.');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object') throw new Error('bad');
    return v;
  } catch {
    throw new HttpError(400, 'The request was not valid JSON.');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    'unknown'
  );
}

export function isHttps(req) {
  const proto = req.headers.get('x-forwarded-proto');
  return proto ? proto.split(',')[0].trim() === 'https' : new URL(req.url).protocol === 'https:';
}

export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
    return new URL(origin).host === host.split(',')[0].trim();
  } catch {
    return false;
  }
}
