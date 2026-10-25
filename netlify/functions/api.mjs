import crypto from 'node:crypto';
import { HttpError, json, readJson, clientIp, sameOrigin, env } from '../lib/http.mjs';
import * as auth from '../lib/auth.mjs';
import { store } from '../lib/store.mjs';
import { putFile, deleteFile, getFile, githubConfigured, ghConfig } from '../lib/github.mjs';
import { listPosts, readPost, cleanPost, serializePost, assertSlug, POSTS_DIR } from '../lib/posts.mjs';
import { createLead, listLeads, updateLead, deleteLead } from '../lib/leads.mjs';
import { emailConfigured } from '../lib/mail.mjs';

export const config = { path: '/api/*' };

const slugify = (s) =>
  String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');

const IMAGE_TYPES = {
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/gif': { ext: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};

const SETTINGS_FILE = 'site.config.json';
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === true || v === 'true';

function cleanSettings(i, current) {
  const l = i.lead || {};
  const accent = text(i.accent, 7);
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) throw new HttpError(400, 'The accent colour must look like #0e7c66.');
  const url = text(i.url, 200).replace(/\/+$/, '');
  if (url && !/^https:\/\/[^\s/]+$/.test(url)) throw new HttpError(400, 'The site address must look like https://www.example.com');
  const per = Number(i.postsPerPage) || current.postsPerPage || 9;
  return {
    ...current,
    name: text(i.name, 80) || current.name,
    tagline: text(i.tagline, 120),
    description: text(i.description, 300),
    url,
    author: text(i.author, 80) || current.author,
    accent: accent || current.accent,
    postsPerPage: Math.min(30, Math.max(3, per)),
    footer: text(i.footer, 200),
    lead: {
      heading: text(l.heading, 120),
      text: text(l.text, 300),
      button: text(l.button, 40) || 'Send my details',
      askPhone: bool(l.askPhone),
      askMessage: bool(l.askMessage),
      consent: text(l.consent, 200),
      thankYou: text(l.thankYou, 200),
    },
  };
}

async function loadSettings() {
  const f = await getFile(SETTINGS_FILE);
  if (!f) throw new HttpError(404, 'site.config.json was not found in your repository.');
  return JSON.parse(f.text);
}

async function route(req, url) {
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const method = req.method;
  const [a, b] = parts;

  // ---------- public ----------
  if (a === 'lead' && method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    const fields = ct.includes('application/json') ? await readJson(req, 50_000) : Object.fromEntries(await req.formData());
    const wantsJson = (req.headers.get('accept') || '').includes('application/json') || ct.includes('application/json');
    try {
      await createLead(fields, clientIp(req));
    } catch (err) {
      if (wantsJson || !(err instanceof HttpError)) throw err;
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Could not send</title><p style="font:18px/1.5 system-ui;max-width:32rem;margin:15vh auto;padding:0 1rem">${err.message.replace(/[<>&]/g, '')}<br><br><a href="javascript:history.back()">Go back</a></p>`, {
        status: err.status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (wantsJson) return json({ ok: true });
    return new Response(null, { status: 303, headers: { location: '/thanks/' } });
  }

  if (a === 'login' && method === 'POST') {
    if (!sameOrigin(req)) throw new HttpError(403, 'Blocked a cross-site request.');
    if (!env('ADMIN_USERNAME') || !env('ADMIN_PASSWORD'))
      throw new HttpError(503, 'No admin account yet. Add ADMIN_USERNAME and ADMIN_PASSWORD in Netlify, then redeploy.');
    const body = await readJson(req, 5_000);
    const ipKey = crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 24);
    const user = await auth.login(body.username, body.password, ipKey);
    return json({ user }, 200, { 'set-cookie': auth.sessionCookie(req, user) });
  }
  if (a === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': auth.clearCookie(req) });

  // ---------- everything below needs a signed-in user ----------
  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'Blocked a cross-site request.');
  const user = await auth.requireUser(req);
  const by = `${user.username} via admin`;

  if (a === 'me' && method === 'GET') {
    const gh = ghConfig();
    return json({
      user,
      setup: { github: githubConfigured(), repo: gh.repo, email: emailConfigured() },
    });
  }

  // posts
  if (a === 'posts') {
    if (!b && method === 'GET') return json({ posts: await listPosts() });
    if (b && method === 'GET') {
      const post = await readPost(assertSlug(b));
      if (!post) throw new HttpError(404, 'That post does not exist.');
      return json({ post });
    }
    if (b && method === 'PUT') {
      assertSlug(b);
      const body = await readJson(req, 1_000_000);
      const existing = await readPost(b);
      if (body.isNew && existing) throw new HttpError(409, 'A post with that web address already exists. Change the web address.');
      if (!body.isNew && !existing) throw new HttpError(404, 'That post no longer exists.');
      const post = cleanPost(body, existing);
      await putFile(`${POSTS_DIR}/${b}.md`, serializePost(post), `${existing ? 'Update' : 'Add'} post "${post.title}" (${by})`);
      return json({ post: { slug: b, ...post } });
    }
    if (b && method === 'DELETE') {
      assertSlug(b);
      const ok = await deleteFile(`${POSTS_DIR}/${b}.md`, `Delete post ${b} (${by})`);
      if (!ok) throw new HttpError(404, 'That post does not exist.');
      return json({ ok: true });
    }
  }

  // image upload
  if (a === 'upload' && method === 'POST') {
    const body = await readJson(req, 5_500_000);
    const type = IMAGE_TYPES[body.type];
    if (!type) throw new HttpError(400, 'Upload a JPG, PNG, WebP or GIF image.');
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length || buf.length > 3_500_000) throw new HttpError(413, 'Images must be under 3.5 MB.');
    if (!type.magic.every((byte, i) => buf[i] === byte) || (type.ext === 'webp' && buf.subarray(8, 12).toString() !== 'WEBP'))
      throw new HttpError(400, 'That file is not a real image.');
    const base = slugify(String(body.name || 'image').replace(/\.[a-z0-9]+$/i, '')) || 'image';
    const d = new Date();
    const rel = `uploads/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${base}-${crypto.randomBytes(3).toString('hex')}.${type.ext}`;
    await putFile(`static/${rel}`, buf, `Upload image ${base} (${by})`);
    return json({ url: `/${rel}` });
  }

  // leads
  if (a === 'leads') {
    if (!b && method === 'GET') {
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      return json(await listLeads(offset, Math.min(200, Number(url.searchParams.get('limit')) || 100)));
    }
    if (b && method === 'PATCH') return json({ lead: await updateLead(b, await readJson(req, 5_000)) });
    if (b && method === 'DELETE') {
      await deleteLead(b);
      return json({ ok: true });
    }
  }

  // ---------- owner only ----------
  if (a === 'settings') {
    await auth.requireUser(req, { owner: true });
    if (method === 'GET') return json({ settings: await loadSettings() });
    if (method === 'PUT') {
      const next = cleanSettings(await readJson(req, 20_000), await loadSettings());
      await putFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', `Update site settings (${by})`);
      return json({ settings: next });
    }
  }

  if (a === 'users') {
    await auth.requireUser(req, { owner: true });
    const users = store('users');
    if (!b && method === 'GET') {
      const list = await Promise.all((await users.list()).map((k) => users.get(k)));
      return json({
        owner: auth.ownerUsername(),
        users: list.filter(Boolean).map((u) => ({ username: u.username, createdAt: u.createdAt })).sort((x, y) => x.username.localeCompare(y.username)),
      });
    }
    if (!b && method === 'POST') {
      const body = await readJson(req, 5_000);
      const username = auth.normalizeUsername(body.username);
      if (!auth.USERNAME_RE.test(username)) throw new HttpError(400, 'Usernames use 3 to 40 letters, numbers, dots, hyphens or underscores.');
      if (username === auth.ownerUsername() || (await users.get(username))) throw new HttpError(409, 'That username is already taken.');
      auth.checkPasswordStrength(body.password);
      await users.set(username, { username, hash: await auth.hashPassword(body.password), createdAt: new Date().toISOString(), createdBy: user.username });
      return json({ ok: true, username }, 201);
    }
    if (b && method === 'PUT') {
      const rec = await users.get(auth.normalizeUsername(b));
      if (!rec) throw new HttpError(404, 'That user does not exist.');
      const body = await readJson(req, 5_000);
      auth.checkPasswordStrength(body.password);
      rec.hash = await auth.hashPassword(body.password);
      await users.set(rec.username, rec);
      return json({ ok: true });
    }
    if (b && method === 'DELETE') {
      await users.delete(auth.normalizeUsername(b));
      return json({ ok: true });
    }
  }

  throw new HttpError(404, 'Not found.');
}

export default async (req) => {
  try {
    return await route(req, new URL(req.url));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong on the server. Try again in a moment.' }, 500);
  }
};
