// Local test server: serves dist/ and the API, with GitHub faked on disk. Used by browser tests.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.USE_MEMORY_STORE = '1';
process.env.GITHUB_REPO = 'me/blog';
process.env.GITHUB_TOKEN = 'x';
process.env.ADMIN_USERNAME = 'boss';
process.env.ADMIN_PASSWORD = 'correct horse battery';

const root = path.resolve(process.argv[2] || '.');
const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'fakerepo-'));
await fs.cp(path.join(root, 'content'), path.join(repo, 'content'), { recursive: true });
await fs.copyFile(path.join(root, 'site.config.json'), path.join(repo, 'site.config.json'));

const realFetch = globalThis.fetch;
let n = 0;
globalThis.fetch = async (url, init = {}) => {
  const m = String(url).match(/^https:\/\/api\.github\.com\/repos\/me\/blog\/contents\/([^?]+)/);
  if (!m) return realFetch(url, init);
  const rel = decodeURIComponent(m[1]);
  const file = path.join(repo, rel);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  const shaOf = async (f) => 'sha-' + (await fs.stat(f)).mtimeMs + '-' + (await fs.stat(f)).size;
  if (method === 'GET') {
    try {
      const st = await fs.stat(file);
      if (st.isDirectory()) {
        const names = await fs.readdir(file);
        return res(await Promise.all(names.map(async (name) => ({ type: 'file', name, path: rel + '/' + name, sha: await shaOf(path.join(file, name)) }))));
      }
      return res({ type: 'file', sha: await shaOf(file), content: (await fs.readFile(file)).toString('base64') });
    } catch {
      return res({ message: 'Not Found' }, 404);
    }
  }
  if (method === 'PUT') {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(body.content, 'base64'));
    return res({ ok: ++n });
  }
  if (method === 'DELETE') {
    await fs.rm(file);
    return res({});
  }
  return res({}, 500);
};

const { default: handler } = await import(path.resolve(root, 'netlify/functions/api.mjs'));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.png': 'image/png', '.webp': 'image/webp' };
const dist = path.join(root, 'dist');
const csp = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'";

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8888');
  try {
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handler(new Request(url, { method: req.method, headers: { ...req.headers, host: 'localhost:8888' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, redirect: 'manual' }));
      const headers = Object.fromEntries(r.headers);
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = path.join(dist, decodeURIComponent(url.pathname));
    if (!p.startsWith(dist)) throw new Error('bad path');
    try { if ((await fs.stat(p)).isDirectory()) p = path.join(p, 'index.html'); } catch {}
    const data = await fs.readFile(p);
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'content-security-policy': csp });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(8888, () => console.log('ready http://localhost:8888 repo=' + repo));
