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
  accent: '#271b09',
  eyebrow: 'Marketing news and tips',
  postsPerPage: 9,
  footer: '© {year} My Blog',
  // Newsletter sign-up (the "Subscribe" card)
  newsletter: {
    heading: 'Get marketing tips in your inbox',
    text: 'New marketing news and practical tips, sent when we publish. No spam.',
    placeholder: 'Your email address',
    button: 'Subscribe',
    consent: 'I agree to receive marketing emails. I can unsubscribe at any time.',
    thankYou: 'You are subscribed. Watch your inbox for our next update.',
  },
  // Free consultation (the "Book a call" card)
  lead: {
    heading: 'Book a free consultation with our SEO expert',
    text: 'Tell us about your business and we will reply within one business day with a time for your free call.',
    button: 'Register for my free call',
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
<a class="brand" href="/" aria-label="${esc(cfg.name)} home"><img src="/logo.png" alt="${esc(cfg.name)}" width="700" height="315"></a>
<nav class="site-nav" aria-label="Main"><a href="/">Latest news</a><a href="/#subscribe">Newsletter</a><a href="/audit/">Free website audit</a><a class="nav-cta" href="/#consultation">Free consultation</a></nav>
</div></header>
<main id="main">
${body}
</main>
<footer class="site-foot"><div class="wrap">
<div class="foot-brand"><img src="/logo.png" alt="${esc(cfg.name)}" width="700" height="315" loading="lazy"><p>${esc(cfg.tagline)}</p></div>
<nav class="foot-links" aria-label="Footer"><a href="/">Latest news</a><a href="/#subscribe">Newsletter</a><a href="/audit/">Free website audit</a><a href="/#consultation">Free consultation</a></nav>
<p class="copy">${footer}</p>
</div></footer>
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

  // A news-style card: picture (or a branded panel), kicker, title, summary
  const card = (p, h = 'h3', eager = false) => `<article class="card">
<a class="card-media" href="/blog/${p.slug}/" tabindex="-1" aria-hidden="true">${
    p.cover
      ? `<img src="${esc(p.cover)}" alt="" loading="${eager ? 'eager' : 'lazy'}">`
      : `<span class="ph">${esc(p.tags[0] || cfg.name)}</span>`
  }</a>
<div class="card-body">
<div class="meta">${p.tags[0] ? `<span class="kicker">${esc(p.tags[0])}</span>` : ''}<time datetime="${p.date}">${esc(fmtDate(p.date))}</time><span>${p.minutes} min read</span></div>
<${h}><a href="/blog/${p.slug}/">${esc(p.title)}</a></${h}>
<p>${esc(p.description)}</p>
<a class="more" href="/blog/${p.slug}/">Read article <span aria-hidden="true">&rarr;</span></a>
</div>
</article>`;

  // The two forms: newsletter + free consultation. Shown on the homepage and under every post.
  const N = cfg.newsletter;
  const L = cfg.lead;
  const antiBot = '<p class="hp" aria-hidden="true"><label>Leave this field empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>';
  const ctaSection = (p) => {
    const source = p
      ? `<input type="hidden" name="post_slug" value="${esc(p.slug)}"><input type="hidden" name="post_title" value="${esc(p.title)}">`
      : '';
    return `<section class="cta" aria-label="Stay in touch"><div class="wrap cta-grid">
<div class="cta-card cta-light" id="subscribe">
<p class="eyebrow">Newsletter</p>
<h2>${esc(N.heading)}</h2>
<p class="cta-text">${esc(N.text)}</p>
<form class="lead-form" method="post" action="/api/lead" data-lead>
<input type="hidden" name="type" value="newsletter">
${source}
${antiBot}
<div class="row">
<label><span class="sr">Email address</span><input type="email" name="email" required maxlength="200" autocomplete="email" placeholder="${esc(N.placeholder)}"></label>
<button type="submit">${esc(N.button)}</button>
</div>
${N.consent ? `<label class="check"><input type="checkbox" name="consent" value="yes" required><span>${esc(N.consent)}</span></label>` : ''}
<p class="lead-status" role="status" aria-live="polite"></p>
</form>
<p class="lead-done" tabindex="-1" hidden>${esc(N.thankYou)}</p>
</div>
<div class="cta-card cta-dark" id="consultation">
<p class="eyebrow">Free consultation</p>
<h2>${esc(L.heading)}</h2>
<p class="cta-text">${esc(L.text)}</p>
<form class="lead-form" method="post" action="/api/lead" data-lead>
<input type="hidden" name="type" value="consultation">
${source}
${antiBot}
<label>Your name<input type="text" name="name" required maxlength="120" autocomplete="name"></label>
<label>Email address<input type="email" name="email" required maxlength="200" autocomplete="email"></label>
${L.askPhone ? '<label><span>Phone <span class="opt">(optional)</span></span><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>' : ''}
${L.askMessage ? '<label><span>Tell us about your business <span class="opt">(optional)</span></span><textarea name="message" maxlength="3000" rows="3"></textarea></label>' : ''}
${L.consent ? `<label class="check"><input type="checkbox" name="consent" value="yes" required><span>${esc(L.consent)}</span></label>` : ''}
<button type="submit">${esc(L.button)}</button>
<p class="lead-status" role="status" aria-live="polite"></p>
</form>
<p class="lead-done" tabindex="-1" hidden>${esc(L.thankYou)}</p>
</div>
</div></section>`;
  };

  const pageUrl = (base, n) => (n === 1 ? base : `${base}page/${n}/`);

  async function writeListing({ base, title, intro, list, heading, description, jsonld = [], home = false }) {
    const per = Math.max(1, Number(cfg.postsPerPage) || 9);
    const pages = Math.max(1, Math.ceil(list.length / per));
    for (let n = 1; n <= pages; n++) {
      const slice = list.slice((n - 1) * per, n * per);
      const pager =
        pages > 1
          ? `<nav class="pager" aria-label="Pagination"><span>${n > 1 ? `<a rel="prev" href="${pageUrl(base, n - 1)}">&larr; Newer posts</a>` : ''}</span><span>Page ${n} of ${pages}</span><span>${n < pages ? `<a rel="next" href="${pageUrl(base, n + 1)}">Older posts &rarr;</a>` : ''}</span></nav>`
          : '';
      const showHome = home && n === 1;
      const top = showHome
        ? `<section class="hero"><div class="wrap">
<p class="eyebrow">${esc(cfg.eyebrow || '')}</p>
<h1>${esc(heading)}</h1>
${intro ? `<p class="hero-text">${esc(intro)}</p>` : ''}
<p class="hero-actions"><a class="btn" href="#consultation">Book a free consultation</a><a class="btn btn-ghost" href="#subscribe">Subscribe to the newsletter</a></p>
<p class="hero-link"><a href="/audit/">Free website audit: see what your site is costing you &rarr;</a></p>
</div></section>`
        : `<div class="wrap"><div class="intro"><h1>${esc(heading)}</h1>${intro ? `<p>${esc(intro)}</p>` : ''}</div></div>`;
      let listing;
      if (!slice.length) {
        listing = '<p class="empty">No posts yet. Publish your first post from the admin panel.</p>';
      } else if (showHome) {
        const [first, ...rest] = slice;
        listing = `<h2 class="section-title">Latest news</h2>
<div class="featured">${card(first, 'h3', true)}</div>
${rest.length ? `<div class="grid">${rest.map((p) => card(p)).join('\n')}</div>` : ''}`;
      } else {
        listing = `<div class="grid">${slice.map((p) => card(p, 'h2')).join('\n')}</div>`;
      }
      const body = `${top}
<div class="wrap listing">
${listing}
${pager}
</div>
${showHome ? ctaSection(null) : ''}`;
      await write(
        pageUrl(base, n).replace(/^\//, '') + 'index.html',
        layout({
          title: n === 1 ? title : `${title} (page ${n})`,
          description,
          urlPath: pageUrl(base, n),
          noindex: false,
          jsonld: n === 1 ? jsonld : [],
          scripts: showHome,
          body,
        }),
      );
    }
  }

  await writeListing({
    base: '/',
    home: true,
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
${ctaSection(p)}
${related.length ? `<div class="wrap related"><h2 class="section-title">Keep reading</h2><div class="grid">${related.map((r) => card(r, 'h3')).join('\n')}</div></div>` : ''}`;
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
    { loc: abs('/audit/'), lastmod: '' },
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
