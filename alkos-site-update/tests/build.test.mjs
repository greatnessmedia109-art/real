import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('build output: SEO tags, lead form, safe markdown, drafts hidden', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'blog-'));
  const content = path.join(tmp, 'posts');
  await fs.mkdir(content);
  await fs.writeFile(path.join(content, 'safe-post.md'), `---
title: "Safe & sound <post>"
description: A description
date: '2026-10-01'
tags: [Alpha, Beta]
---
## First

<script>alert(1)</script>

[bad](javascript:alert(1)) and [good](https://example.org) and ![x](javascript:alert(2))

## Second

### Third
`);
  await fs.writeFile(path.join(content, 'secret-draft.md'), `---\ntitle: Draft\ndraft: true\n---\nHidden`);
  process.env.SITE_URL = 'https://blog.test';
  const out = path.join(tmp, 'dist');
  await build({ root, out, contentDir: content });

  const html = await fs.readFile(path.join(out, 'blog/safe-post/index.html'), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/blog\.test\/blog\/safe-post\/">/);
  assert.match(html, /<title>Safe &amp; sound &lt;post&gt; \| Alkos<\/title>/);
  assert.match(html, /"@type":"BlogPosting"/);
  assert.match(html, /<form class="lead-form"[^>]+action="\/api\/lead"/);
  assert.ok(!/<script>alert/.test(html), 'raw script tags are escaped');
  assert.ok(!/href="javascript:/i.test(html) && !/src="javascript:/i.test(html), 'javascript: URLs are removed');
  assert.match(html, /href="https:\/\/example\.org" rel="noopener"/);
  assert.match(html, /class="toc"/);
  assert.match(html, /name="type" value="newsletter"/);
  assert.match(html, /name="type" value="consultation"/);
  assert.ok(!/href="\/rss\.xml"/.test(html.replace(/<link[^>]+>/g, '')), 'no visible RSS link');
  assert.ok(!/>Sitemap</.test(html), 'no visible sitemap link');
  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /blog\.test\/blog\/safe-post\//);
  assert.ok(!sitemap.includes('secret-draft'));
  await assert.rejects(fs.access(path.join(out, 'blog/secret-draft/index.html')));
  const home = await fs.readFile(path.join(out, 'index.html'), 'utf8');
  assert.match(home, /\/blog\/safe-post\//);
  assert.match(home, /id="subscribe"/);
  assert.match(home, /id="consultation"/);
  assert.match(home, /src="\/logo\.png"/);
  assert.match(await fs.readFile(path.join(out, 'robots.txt'), 'utf8'), /Disallow: \/admin\//);
  await fs.access(path.join(out, 'tag/alpha/index.html'));
  await fs.access(path.join(out, 'admin/vendor/marked.umd.js'));
});
