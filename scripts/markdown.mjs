// Safe Markdown rendering shared by the site build.
// Raw HTML in posts is escaped and unsafe URLs are dropped, so a post can never run scripts.
import { Marked } from 'marked';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function safeUrl(u) {
  const url = String(u ?? '').trim();
  if (!url) return null;
  if (url.startsWith('#') || (url.startsWith('/') && !url.startsWith('//'))) return url;
  try {
    const p = new URL(url);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(p.protocol) ? url : null;
  } catch {
    // relative URL such as "images/a.png"; reject anything that looks like a scheme
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? null : url;
  }
}

const stripTags = (h) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function renderMarkdown(md) {
  const toc = [];
  const seen = new Map();
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      html({ text }) {
        return esc(text);
      },
      heading({ tokens, depth }) {
        const level = Math.min(Math.max(depth, 2), 4); // the post title is the only h1
        const inner = this.parser.parseInline(tokens);
        const plain = stripTags(inner).trim();
        let id = slugify(plain) || 'section';
        const n = seen.get(id) ?? 0;
        seen.set(id, n + 1);
        if (n) id = `${id}-${n + 1}`;
        if (level <= 3) toc.push({ level, text: plain, id });
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const safe = safeUrl(href);
        if (!safe) return inner;
        const external = /^https?:/i.test(safe);
        return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener"' : ''}>${inner}</a>`;
      },
      image({ href, title, text }) {
        const safe = safeUrl(href);
        if (!safe) return esc(text);
        const img = `<img src="${esc(safe)}" alt="${esc(text)}" loading="lazy" decoding="async">`;
        return title ? `<figure>${img}<figcaption>${esc(title)}</figcaption></figure>` : img;
      },
    },
  });
  const html = marked.parse(String(md ?? ''));
  const text = stripTags(html).replace(/\s+/g, ' ').trim();
  return { html, toc, text };
}
