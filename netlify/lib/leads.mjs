import crypto from 'node:crypto';
import { HttpError, env } from './http.mjs';
import { store, mapLimit } from './store.mjs';
import { throttle, secret } from './auth.mjs';
import { sendLeadEmail } from './mail.mjs';

const clip = (v, n) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
export const STATUSES = ['new', 'contacted', 'won', 'lost'];

export async function createLead(fields, ip) {
  // Bots tend to fill the hidden field or submit instantly. Pretend it worked so they move on.
  if (clip(fields.website, 10)) return { stored: false };
  const t = Number(fields.t);
  if (t && Date.now() - t < 2500) return { stored: false };

  const name = clip(fields.name, 120);
  const email = clip(fields.email, 200).toLowerCase();
  const phone = clip(fields.phone, 40);
  if (!name) throw new HttpError(400, 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (phone && !/^[0-9+()\-.\s]{5,40}$/.test(phone)) throw new HttpError(400, 'Please enter a valid phone number.');

  const ipHash = crypto.createHmac('sha256', secret()).update(ip).digest('hex').slice(0, 24);
  const limit = await throttle(`lead:${ipHash}`, { max: 5, windowMs: 3600_000 });
  if (limit.blocked) throw new HttpError(429, 'Too many submissions from this connection. Please try again later.');
  await limit.save();

  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) if (fields[k]) utm[k] = clip(fields[k], 120);
  const lead = {
    id: new Date().toISOString().replace(/\D/g, '') + '-' + crypto.randomBytes(3).toString('hex'),
    createdAt: new Date().toISOString(),
    name,
    email,
    phone,
    message: clip(fields.message, 3000),
    postSlug: clip(fields.post_slug, 80),
    postTitle: clip(fields.post_title, 200),
    referrer: clip(fields.referrer, 300),
    utm,
    consent: Boolean(fields.consent),
    status: 'new',
    note: '',
  };
  await store('leads').set(lead.id, lead);
  const siteUrl = (env('SITE_URL') || env('URL')).replace(/\/+$/, '');
  lead.emailed = await sendLeadEmail(lead, siteUrl);
  return { stored: true, lead };
}

export async function listLeads(offset = 0, limit = 100) {
  const s = store('leads');
  const keys = (await s.list()).reverse();
  const slice = keys.slice(offset, offset + limit);
  const items = (await mapLimit(slice, 10, (k) => s.get(k))).filter(Boolean);
  return { total: keys.length, items };
}

export async function updateLead(id, patch) {
  const s = store('leads');
  const lead = await s.get(id);
  if (!lead) throw new HttpError(404, 'That lead no longer exists.');
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) throw new HttpError(400, 'Unknown status.');
    lead.status = patch.status;
  }
  if (patch.note !== undefined) lead.note = clip(patch.note, 1000);
  await s.set(id, lead);
  return lead;
}

export async function deleteLead(id) {
  await store('leads').delete(id);
}
