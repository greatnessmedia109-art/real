// Static site generator: content/posts/*.md  ->  dist/
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { renderMarkdown, esc, slugify } from './markdown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const DEFAULT_CONFIG = {
  name: 'My Blog',
  tagline: 'Practical guides, written to be found.',
  description: 'Practical guides and advice.',
  url: '',
  language: 'en',
  author: 'Editorial team',
  accent: '#0e7c66',
  postsPerPage: 9,
  footer: '© {year} My Blog',
  lead: {
    heading: 'Want help with this?',
    text: 'Leave your details and we will reply within one business day.',
    button: 'Send my details',
    askPhone: true,
    askMessage: true,
    consent: 'I agree to be contacted about my enquiry.',
    thankYou: 'Thanks. We have your details and will be in touch soon.',
  },
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function toDateString(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function excerptFrom(text, max = 155) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 80)).replace(/[,.;:!\s]+$/, '') + '…';
}

export async function loadPosts(contentDir) {
  let files = [];
  try {
    files = (await fs.readdir(contentDir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const posts = [];
  for (const file of files) {
    const slug = file.slice(0, -3);
    if (!SLUG_RE.test(slug)) {
      console.warn(`skip ${file}: file name must be lowercase letters, numbers and hyphens`);
      continue;
    }
    const raw = await fs.readFile(path.join(contentDir, file), 'utf8');
    const { data, content } = matter(raw);
    if (!data.title) {
      console.warn(`skip ${file}: missing title`);
      continue;
    }
    if (data.draft === true || data.draft === 'true') continue;
    const rendered = renderMarkdown(content);
    const words = rendered.text ? rendered.text.split(/\s+/).length : 0;
    const tags = (Array.isArray(data.tags) ? data.tags : String(data.tags || '').split(','))
      .map((t) => String(t).trim())
      .filter(Boolean);
    posts.push({
      slug,
      title: String(data.title),
      description: String(data.description || '').trim() || excerptFrom(rendered.text),
      date: toDateString(data.date) || '1970-01-01',
      updated: toDateString(data.updated),
      tags,
      cover: data.cover ? String(data.cover) : '',
      coverAlt: data.coverAlt ? String(data.coverAlt) : '',
      html: rendered.html,
      toc: rendered.toc,
      minutes: Math.max(1, Math.round(words / 220)),
    });
  }
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));
  return posts;
}

export async function build({ root = ROOT, out = path.join(ROOT, 'dist'), contentDir = path.join(ROOT, 'content/posts') } = {}) {
  let userConfig = {};
  try {
    userConfig = JSON.parse(await fs.readFile(path.join(root, 'site.config.json'), 'utf8'));
  } catch (err) {
    console.warn('site.config.json missing or invalid, using defaults:', err.message);
  }
  const cfg = merge(DEFAULT_CONFIG, userConfig);
  if (!HEX_RE.test(cfg.accent)) cfg.accent = DEFAULT_CONFIG.accent;
  const siteUrl = String(process.env.SITE_URL || cfg.url || process.env.URL || 'https://example.com').replace(/\/+$/, '');
  const abs = (p) => (/^https?:\/\//i.test(p) ? p : siteUrl + (p.startsWith('/') ? p : '/' + p));
  const locale = cfg.language || 'en';
  const fmtDate = (d) =>
    new Date(d + 'T00:00:00Z').toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  const write = async (rel, data) => {
    const file = path.join(out, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  };

  // Static files, admin panel, assets
  await fs.cp(path.join(root, 'static'), out, { recursive: true }).catch(() => {});
  await fs.cp(path.join(root, 'admin'), path.join(out, 'admin'), { recursive: true }).catch(() => {});
  try {
    await fs.mkdir(path.join(out, 'admin/vendor'), { recursive: true });
    const markedUmd = path.join(root, 'node_modules/marked/lib/marked.umd.js');
    await fs.copyFile(markedUmd, path.join(out, 'admin/vendor/marked.umd.js'));
  } catch {
    console.warn('could not copy marked for the admin preview (run npm install)');
  }
  const cssSrc = `:root{--accent:${cfg.accent}}\n` + (await fs.readFile(path.join(HERE, 'site.css'), 'utf8'));
  const jsSrc = await fs.readFile(path.join(HERE, 'site.js'), 'utf8');
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
  const cssPath = `/assets/site.${hash(cssSrc)}.css`;
  const jsPath = `/assets/site.${hash(jsSrc)}.js`;
  await write(cssPath, cssSrc);
  await write(jsPath, jsSrc);
  await write('assets/manifest.json', JSON.stringify({ css: cssPath, js: jsPath }));

  const posts = await loadPosts(contentDir);
  const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
  const footer = esc(String(cfg.footer).replace('{year}', new Date().getFullYear()));

  function layout({ title, description, urlPath, ogType = 'website', image = '', noindex = false, jsonld = [], body, scripts = false }) {
    const fullTitle = title === cfg.name ? title : `${title} | ${cfg.name}`;
    const canonical = abs(urlPath);
    const img = image ? abs(image) : '';
    return `<!doctype html>
<html lang="${esc(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<meta property="og:site_name" content="${esc(cfg.name)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
${img ? `<meta property="og:image" content="${esc(img)}">\n` : ''}<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
${img ? `<meta name="twitter:image" content="${esc(img)}">\n` : ''}<meta name="theme-color" content="${esc(cfg.accent)}">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.name)}" href="/rss.xml">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${cssPath}">
${jsonld.map(ld).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
<a class="brand" href="/">${esc(cfg.name)}</a>
<nav class="site-nav" aria-label="Main"><a href="/">All posts</a><a href="/rss.xml">RSS</a></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="site-foot"><div class="wrap"><span>${footer}</span><span><a href="/rss.xml">RSS</a> &nbsp; <a href="/sitemap.xml">Sitemap</a></span></div></footer>
${scripts ? `<script src="${jsPath}" defer></script>` : ''}
</body>
</html>
`;
  }

  const tagMap = new Map(); // slug -> { name, posts }
  for (const p of posts) {
    for (const t of p.tags) {
      const s = slugify(t);
      if (!s) continue;
      if (!tagMap.has(s)) tagMap.set(s, { name: t, posts: [] });
      tagMap.get(s).posts.push(p);
    }
  }
  const tagLinks = (p) =>
    p.tags.length
      ? `<div class="tags">${p.tags
          .filter((t) => slugify(t))
          .map((t) => `<a href="/tag/${slugify(t)}/">${esc(t)}</a>`)
          .join('')}</div>`
      : '';

  const indexItem = (p, h = 'h2') => `<li>
<div><time datetime="${p.date}">${esc(fmtDate(p.date))}</time><span class="reading">${p.minutes} min read</span></div>
<div><${h}><a href="/blog/${p.slug}/">${esc(p.title)}</a></${h}><p>${esc(p.description)}</p>${tagLinks(p)}</div>
</li>`;

  const pageUrl = (base, n) => (n === 1 ? base : `${base}page/${n}/`);

  async function writeListing({ base, title, intro, list, heading, description, jsonld = [] }) {
    const per = Math.max(1, Number(cfg.postsPerPage) || 9);
    const pages = Math.max(1, Math.ceil(list.length / per));
    for (let n = 1; n <= pages; n++) {
      const slice = list.slice((n - 1) * per, n * per);
      const pager =
        pages > 1
          ? `<nav class="pager" aria-label="Pagination"><span>${n > 1 ? `<a rel="prev" href="${pageUrl(base, n - 1)}">Newer posts</a>` : ''}</span><span>Page ${n} of ${pages}</span><span>${n < pages ? `<a rel="next" href="${pageUrl(base, n + 1)}">Older posts</a>` : ''}</span></nav>`
          : '';
      const body = `<div class="wrap">
<div class="intro"><h1>${esc(heading)}</h1>${intro ? `<p>${esc(intro)}</p>` : ''}</div>
${slice.length ? `<ol class="index">${slice.map((p) => indexItem(p)).join('\n')}</ol>` : '<p class="empty">No posts yet. Publish your first post from the admin panel.</p>'}
${pager}
</div>`;
      await write(
        pageUrl(base, n).replace(/^\//, '') + 'index.html',
        layout({
          title: n === 1 ? title : `${title} (page ${n})`,
          description,
          urlPath: pageUrl(base, n),
          noindex: false,
          jsonld: n === 1 ? jsonld : [],
          body,
        }),
      );
    }
  }

  await writeListing({
    base: '/',
    title: cfg.name,
    heading: cfg.tagline || cfg.name,
    intro: cfg.description,
    list: posts,
    description: cfg.description,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.name, url: siteUrl, description: cfg.description }],
  });

  for (const [slug, t] of tagMap) {
    await writeListing({
      base: `/tag/${slug}/`,
      title: `${t.name} articles`,
      heading: t.name,
      intro: `${t.posts.length} ${t.posts.length === 1 ? 'post' : 'posts'} tagged ${t.name}.`,
      list: t.posts,
      description: `All ${cfg.name} posts about ${t.name}.`,
    });
  }

  // Lead form
  const L = cfg.lead;
  const leadBlock = (p) => `<section class="lead" id="get-in-touch" aria-labelledby="lead-h"><div class="wrap">
<div><h2 id="lead-h">${esc(L.heading)}</h2><p class="lead-text">${esc(L.text)}</p></div>
<div>
<form class="lead-form" method="post" action="/api/lead" data-lead>
<input type="hidden" name="post_slug" value="${esc(p.slug)}">
<input type="hidden" name="post_title" value="${esc(p.title)}">
<p class="hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
<label>Your name<input type="text" name="name" required maxlength="120" autocomplete="name"></label>
<label>Email address<input type="email" name="email" required maxlength="200" autocomplete="email"></label>
${L.askPhone ? '<label><span>Phone <span class="opt">(optional)</span></span><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>' : ''}
${L.askMessage ? '<label><span>How can we help? <span class="opt">(optional)</span></span><textarea name="message" maxlength="3000" rows="4"></textarea></label>' : ''}
${L.consent ? `<label class="check"><input type="checkbox" name="consent" value="yes" required><span>${esc(L.consent)}</span></label>` : ''}
<button type="submit">${esc(L.button)}</button>
<p class="lead-status" role="status" aria-live="polite"></p>
</form>
<p class="lead-done" tabindex="-1" hidden>${esc(L.thankYou)}</p>
</div>
</div></section>`;

  // Posts
  for (const p of posts) {
    const url = `/blog/${p.slug}/`;
    const related = [
      ...posts.filter((o) => o.slug !== p.slug && o.tags.some((t) => p.tags.includes(t))),
      ...posts.filter((o) => o.slug !== p.slug && !o.tags.some((t) => p.tags.includes(t))),
    ].slice(0, 3);
    const toc = p.toc.length >= 3
      ? `<nav class="toc" aria-label="On this page"><div class="toc-inner"><h2>On this page</h2><ol>${p.toc
          .map((h) => `<li class="l${h.level}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
          .join('')}</ol></div></nav>`
      : '<div></div>';
    const body = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.title)}</span></nav>
<article>
<header class="post-head">
<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.description)}</p>
<div class="byline"><span>${esc(cfg.author)}</span><time datetime="${p.date}">${esc(fmtDate(p.date))}</time>${p.updated && p.updated !== p.date ? `<span>Updated <time datetime="${p.updated}">${esc(fmtDate(p.updated))}</time></span>` : ''}<span>${p.minutes} min read</span></div>
</header>
${p.cover ? `<figure class="post-cover"><img src="${esc(p.cover)}" alt="${esc(p.coverAlt)}" fetchpriority="high"></figure>` : ''}
<div class="post-grid">
${toc}
<div class="prose">
${p.html}
${p.tags.length ? tagLinks(p) : ''}
</div>
</div>
</article>
</div>
${leadBlock(p)}
${related.length ? `<div class="wrap related"><h2>Keep reading</h2><ol class="index">${related.map((r) => indexItem(r, 'h3')).join('\n')}</ol></div>` : ''}`;
    const published = `${p.date}T00:00:00Z`;
    await write(
      `blog/${p.slug}/index.html`,
      layout({
        title: p.title,
        description: p.description,
        urlPath: url,
        ogType: 'article',
        image: p.cover,
        scripts: true,
        body,
        jsonld: [
          {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: p.title,
            description: p.description,
            datePublished: published,
            dateModified: `${p.updated || p.date}T00:00:00Z`,
            author: { '@type': 'Person', name: cfg.author },
            publisher: { '@type': 'Organization', name: cfg.name, url: siteUrl },
            mainEntityOfPage: abs(url),
            ...(p.cover ? { image: abs(p.cover) } : {}),
            ...(p.tags.length ? { keywords: p.tags.join(', ') } : {}),
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: abs('/') },
              { '@type': 'ListItem', position: 2, name: p.title, item: abs(url) },
            ],
          },
        ],
      }),
    );
  }

  // Utility pages
  await write(
    '404.html',
    layout({
      title: 'Page not found',
      description: 'This page does not exist.',
      urlPath: '/404.html',
      noindex: true,
      body: `<div class="wrap page-plain"><h1>Page not found</h1><p>That address does not match a page here. <a href="/">Browse all posts</a>.</p></div>`,
    }),
  );
  await write(
    'thanks/index.html',
    layout({
      title: 'Thank you',
      description: 'Your details were sent.',
      urlPath: '/thanks/',
      noindex: true,
      body: `<div class="wrap page-plain"><h1>Thank you</h1><p>${esc(L.thankYou)}</p><p><a href="/">Back to all posts</a></p></div>`,
    }),
  );

  // Feeds and crawl files
  const xml = (s) => esc(s);
  const urls = [
    { loc: abs('/'), lastmod: posts[0] ? posts[0].updated || posts[0].date : '' },
    ...[...tagMap.keys()].map((s) => ({ loc: abs(`/tag/${s}/`), lastmod: '' })),
    ...posts.map((p) => ({ loc: abs(`/blog/${p.slug}/`), lastmod: p.updated || p.date })),
  ];
  await write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `<url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
      .join('\n')}\n</urlset>\n`,
  );
  await write(
    'rss.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>\n<title>${xml(cfg.name)}</title>\n<link>${xml(abs('/'))}</link>\n<description>${xml(cfg.description)}</description>\n<language>${xml(locale)}</language>\n<atom:link href="${xml(abs('/rss.xml'))}" rel="self" type="application/rss+xml"/>\n${posts
      .slice(0, 20)
      .map(
        (p) =>
          `<item><title>${xml(p.title)}</title><link>${xml(abs(`/blog/${p.slug}/`))}</link><guid>${xml(abs(`/blog/${p.slug}/`))}</guid><pubDate>${new Date(p.date + 'T00:00:00Z').toUTCString()}</pubDate><description>${xml(p.description)}</description></item>`,
      )
      .join('\n')}\n</channel></rss>\n`,
  );
  await write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${abs('/sitemap.xml')}\n`);

  console.log(`Built ${posts.length} post(s), ${tagMap.size} tag page(s) -> ${path.relative(process.cwd(), out) || out}`);
  return { posts, out, siteUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
