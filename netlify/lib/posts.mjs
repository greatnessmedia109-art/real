import matter from 'gray-matter';
import { HttpError } from './http.mjs';
import { store, mapLimit } from './store.mjs';
import { getFile, listDir } from './github.mjs';

export const POSTS_DIR = 'content/posts';
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const today = () => new Date().toISOString().slice(0, 10);
const str = (v, max) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

export function assertSlug(slug) {
  if (!SLUG_RE.test(slug) || slug.length > 80) throw new HttpError(400, 'The web address can only use lowercase letters, numbers and hyphens.');
  return slug;
}

const dateStr = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export function parsePost(raw, slug) {
  const { data, content } = matter(raw);
  return {
    slug,
    title: str(data.title, 200),
    description: str(data.description, 400),
    date: dateStr(data.date),
    updated: dateStr(data.updated),
    tags: (Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(',')).map((t) => str(t, 40)).filter(Boolean),
    cover: str(data.cover, 300),
    coverAlt: str(data.coverAlt, 200),
    draft: data.draft === true || data.draft === 'true',
    body: content.replace(/^\n+/, ''),
  };
}

export function cleanPost(input, existing) {
  const title = str(input.title, 160);
  if (!title) throw new HttpError(400, 'Add a title before saving.');
  const body = String(input.body ?? '');
  if (body.length > 200_000) throw new HttpError(413, 'This post is too long.');
  const cover = str(input.cover, 300);
  if (cover && !/^(\/|https:\/\/)/.test(cover)) throw new HttpError(400, 'The cover image must be an uploaded image or an https link.');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : existing?.date || today();
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : []).map((t) => str(t, 40).replace(/[,\n]/g, ' ')).filter(Boolean))].slice(0, 10);
  const updated = existing && !existing.draft && date !== today() ? today() : existing?.updated && existing.updated !== date ? existing.updated : '';
  return {
    title,
    description: str(input.description, 300),
    date,
    updated,
    tags,
    cover,
    coverAlt: str(input.coverAlt, 200),
    draft: input.draft === true,
    body,
  };
}

export function serializePost(p) {
  const data = { title: p.title };
  if (p.description) data.description = p.description;
  data.date = p.date;
  if (p.updated) data.updated = p.updated;
  if (p.tags.length) data.tags = p.tags;
  if (p.cover) data.cover = p.cover;
  if (p.coverAlt) data.coverAlt = p.coverAlt;
  data.draft = p.draft;
  return matter.stringify(p.body.endsWith('\n') ? p.body : p.body + '\n', data);
}

export async function readPost(slug) {
  const f = await getFile(`${POSTS_DIR}/${assertSlug(slug)}.md`);
  return f ? parsePost(f.text, slug) : null;
}

// Lists posts. Metadata is cached per file hash so only changed files are downloaded.
export async function listPosts() {
  const files = (await listDir(POSTS_DIR)).filter((f) => f.name.endsWith('.md') && SLUG_RE.test(f.name.slice(0, -3)));
  const cache = store('postmeta');
  const rows = await mapLimit(files, 6, async (f) => {
    const slug = f.name.slice(0, -3);
    let meta = await cache.get(f.sha);
    if (!meta) {
      const file = await getFile(f.path);
      if (!file) return null;
      const p = parsePost(file.text, slug);
      meta = { title: p.title, date: p.date, updated: p.updated, tags: p.tags, draft: p.draft, description: p.description };
      await cache.set(f.sha, meta);
    }
    return { slug, ...meta };
  });
  return rows.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}
