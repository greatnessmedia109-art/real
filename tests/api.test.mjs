import test from 'node:test';
import assert from 'node:assert/strict';

process.env.USE_MEMORY_STORE = '1';
process.env.GITHUB_REPO = 'me/blog';
process.env.GITHUB_TOKEN = 'ghp_test';
process.env.RESEND_API_KEY = 're_test';
process.env.LEAD_NOTIFY_EMAIL = 'owner@example.com';
const OWNER = { username: 'boss', password: 'correct horse battery' };

// ---- fake GitHub + Resend ----
const repo = new Map(); // path -> { b64, sha }
const emails = [];
let shaN = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.startsWith('https://api.resend.com/')) {
    emails.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  }
  const m = url.match(/^https:\/\/api\.github\.com\/repos\/me\/blog\/contents\/([^?]+)/);
  if (!m) return realFetch(url, init);
  const path = decodeURIComponent(m[1]);
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : {};
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  if (method === 'GET') {
    if (repo.has(path)) return reply({ type: 'file', sha: repo.get(path).sha, content: repo.get(path).b64 });
    const children = [...repo.entries()].filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'));
    if (children.length) return reply(children.map(([p, v]) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: v.sha })));
    return reply({ message: 'Not Found' }, 404);
  }
  if (method === 'PUT') {
    const cur = repo.get(path);
    if (cur && cur.sha !== body.sha) return reply({ message: 'sha mismatch' }, 409);
    repo.set(path, { b64: body.content, sha: 'sha' + ++shaN });
    return reply({ content: { sha: repo.get(path).sha } }, cur ? 200 : 201);
  }
  if (method === 'DELETE') {
    if (!repo.has(path) || repo.get(path).sha !== body.sha) return reply({ message: 'bad sha' }, 409);
    repo.delete(path);
    return reply({});
  }
  return reply({}, 500);
};

const { default: handler } = await import('../netlify/functions/api.mjs');

async function call(method, path, { body, cookie, headers = {}, ip = '1.1.1.1', form } = {}) {
  const h = { 'x-nf-client-connection-ip': ip, host: 'site.test', ...headers };
  if (cookie) h.cookie = cookie;
  let payload;
  if (form) {
    payload = new URLSearchParams(form);
  } else if (body !== undefined) {
    h['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await handler(new Request('https://site.test' + path, { method, headers: h, body: payload, redirect: 'manual' }));
  let data = null;
  try {
    data = await res.clone().json();
  } catch {}
  return { res, data, status: res.status, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test('admin is closed until an account is configured', async () => {
  const r = await call('POST', '/api/login', { body: OWNER });
  assert.equal(r.status, 503);
});

let ownerCookie;

test('login: wrong password rejected, right password sets a session', async () => {
  process.env.ADMIN_USERNAME = OWNER.username;
  process.env.ADMIN_PASSWORD = OWNER.password;
  assert.equal((await call('GET', '/api/posts')).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { username: 'boss', password: 'nope' }, ip: '9.9.9.9' })).status, 401);
  const ok = await call('POST', '/api/login', { body: OWNER });
  assert.equal(ok.status, 200);
  assert.match(ok.res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.res.headers.get('set-cookie'), /SameSite=Strict/);
  ownerCookie = ok.cookie;
  const me = await call('GET', '/api/me', { cookie: ownerCookie });
  assert.equal(me.data.user.role, 'owner');
  assert.equal(me.data.setup.github, true);
  assert.equal(me.data.setup.email, true);
});

test('a forged or tampered cookie is rejected', async () => {
  const [body, sig] = ownerCookie.replace('session=', '').split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'boss', r: 'owner', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal((await call('GET', '/api/me', { cookie: `session=${forged}.${sig}` })).status, 401);
  assert.equal((await call('GET', '/api/me', { cookie: `session=${body}.x${sig}` })).status, 401);
});

test('cross-site writes are blocked', async () => {
  const r = await call('PUT', '/api/posts/evil', { cookie: ownerCookie, headers: { origin: 'https://evil.test' }, body: { title: 'x', isNew: true } });
  assert.equal(r.status, 403);
});

test('posts: create, list, read, duplicate, update, delete', async () => {
  const body = { isNew: true, title: 'Hello: a "test"', description: 'Desc', tags: ['SEO', 'SEO', 'Tips'], body: '## Hi\n\nText', draft: false, date: '2026-10-20' };
  const c = await call('PUT', '/api/posts/hello-world', { cookie: ownerCookie, body });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  const file = Buffer.from(repo.get('content/posts/hello-world.md').b64, 'base64').toString();
  assert.match(file, /^---\ntitle: 'Hello: a "test"'/);
  assert.match(file, /draft: false/);
  assert.equal((await call('PUT', '/api/posts/hello-world', { cookie: ownerCookie, body })).status, 409);
  assert.equal((await call('PUT', '/api/posts/Bad_Slug', { cookie: ownerCookie, body })).status, 400);
  const list = await call('GET', '/api/posts', { cookie: ownerCookie });
  assert.equal(list.data.posts.length, 1);
  assert.deepEqual(list.data.posts[0].tags, ['SEO', 'Tips']);
  const one = await call('GET', '/api/posts/hello-world', { cookie: ownerCookie });
  assert.equal(one.data.post.title, 'Hello: a "test"');
  assert.equal(one.data.post.body.trim(), '## Hi\n\nText');
  const up = await call('PUT', '/api/posts/hello-world', { cookie: ownerCookie, body: { ...one.data.post, body: 'Changed', draft: true } });
  assert.equal(up.status, 200);
  assert.equal((await call('GET', '/api/posts', { cookie: ownerCookie })).data.posts[0].draft, true);
  assert.equal((await call('PUT', '/api/posts/hello-world', { cookie: ownerCookie, body: { title: '' } })).status, 400);
  assert.equal((await call('DELETE', '/api/posts/hello-world', { cookie: ownerCookie })).status, 200);
  assert.equal(repo.has('content/posts/hello-world.md'), false);
});

test('uploads accept real images only', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString('base64');
  const ok = await call('POST', '/api/upload', { cookie: ownerCookie, body: { name: 'My Photo.PNG', type: 'image/png', data: png } });
  assert.equal(ok.status, 200);
  assert.match(ok.data.url, /^\/uploads\/\d{4}\/\d{2}\/my-photo-[0-9a-f]{6}\.png$/);
  assert.ok(repo.has('static' + ok.data.url));
  const fake = Buffer.from('<script>alert(1)</script>').toString('base64');
  assert.equal((await call('POST', '/api/upload', { cookie: ownerCookie, body: { name: 'a.png', type: 'image/png', data: fake } })).status, 400);
  assert.equal((await call('POST', '/api/upload', { cookie: ownerCookie, body: { name: 'a.svg', type: 'image/svg+xml', data: fake } })).status, 400);
});

test('leads: stored, emailed, spam filtered, rate limited', async () => {
  const lead = { name: 'Ann <b>Lee</b>', email: 'ann@example.com', phone: '+91 98765 43210', message: 'Hi', post_slug: 'x', post_title: 'X post', consent: 'yes' };
  const r = await call('POST', '/api/lead', { body: lead, ip: '5.5.5.5' });
  assert.equal(r.status, 200);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].reply_to, 'ann@example.com');
  assert.ok(!emails[0].html.includes('<b>Lee'), 'html is escaped in notification email');

  assert.equal((await call('POST', '/api/lead', { body: { ...lead, website: 'http://spam' }, ip: '5.5.5.6' })).status, 200);
  assert.equal((await call('POST', '/api/lead', { body: { ...lead, t: String(Date.now()) }, ip: '5.5.5.7' })).status, 200);
  assert.equal(emails.length, 1, 'bots do not trigger email');
  assert.equal((await call('POST', '/api/lead', { body: { ...lead, email: 'nope' }, ip: '5.5.5.8' })).status, 400);

  const redirect = await call('POST', '/api/lead', { form: { name: 'Bo', email: 'bo@example.com' }, ip: '5.5.5.9' });
  assert.equal(redirect.status, 303);
  assert.equal(redirect.res.headers.get('location'), '/thanks/');

  assert.equal((await call('GET', '/api/leads')).status, 401);
  const list = await call('GET', '/api/leads', { cookie: ownerCookie });
  assert.equal(list.data.total, 2, 'only the two real leads were stored');
  const id = list.data.items[0].id;
  assert.equal((await call('PATCH', `/api/leads/${id}`, { cookie: ownerCookie, body: { status: 'contacted', note: 'called' } })).data.lead.status, 'contacted');
  assert.equal((await call('PATCH', `/api/leads/${id}`, { cookie: ownerCookie, body: { status: 'bogus' } })).status, 400);
  assert.equal((await call('DELETE', `/api/leads/${id}`, { cookie: ownerCookie })).status, 200);
  assert.equal((await call('GET', '/api/leads', { cookie: ownerCookie })).data.total, 1);

  let last;
  for (let i = 0; i < 6; i++) last = await call('POST', '/api/lead', { body: lead, ip: '6.6.6.6' });
  assert.equal(last.status, 429);
});

test('team: owner adds an editor; editor is limited; removal revokes access', async () => {
  assert.equal((await call('POST', '/api/users', { cookie: ownerCookie, body: { username: 'Sam', password: 'short' } })).status, 400);
  assert.equal((await call('POST', '/api/users', { cookie: ownerCookie, body: { username: 'Sam', password: 'a-long-enough-pass' } })).status, 201);
  assert.equal((await call('POST', '/api/users', { cookie: ownerCookie, body: { username: 'sam', password: 'a-long-enough-pass' } })).status, 409);
  const login = await call('POST', '/api/login', { body: { username: 'SAM', password: 'a-long-enough-pass' }, ip: '7.7.7.7' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'editor');
  const ed = login.cookie;
  assert.equal((await call('GET', '/api/posts', { cookie: ed })).status, 200);
  assert.equal((await call('GET', '/api/users', { cookie: ed })).status, 403);
  assert.equal((await call('POST', '/api/users', { cookie: ed, body: { username: 'x-y-z', password: 'a-long-enough-pass' } })).status, 403);
  assert.equal((await call('GET', '/api/settings', { cookie: ed })).status, 403);
  assert.equal((await call('PUT', '/api/users/sam', { cookie: ownerCookie, body: { password: 'another-long-pass' } })).status, 200);
  assert.equal((await call('POST', '/api/login', { body: { username: 'sam', password: 'a-long-enough-pass' }, ip: '7.7.7.8' })).status, 401);
  assert.equal((await call('DELETE', '/api/users/sam', { cookie: ownerCookie })).status, 200);
  assert.equal((await call('GET', '/api/posts', { cookie: ed })).status, 401);
});

test('settings: owner can read and update, bad values rejected', async () => {
  repo.set('site.config.json', { b64: Buffer.from(JSON.stringify({ name: 'Old', accent: '#0e7c66', postsPerPage: 9, author: 'A', lead: {} })).toString('base64'), sha: 'cfg1' });
  const g = await call('GET', '/api/settings', { cookie: ownerCookie });
  assert.equal(g.data.settings.name, 'Old');
  assert.equal((await call('PUT', '/api/settings', { cookie: ownerCookie, body: { name: 'New', accent: 'red' } })).status, 400);
  const p = await call('PUT', '/api/settings', { cookie: ownerCookie, body: { name: 'New', accent: '#112233', url: 'https://x.com/', lead: { heading: 'Hi', askPhone: true } } });
  assert.equal(p.status, 200);
  assert.equal(JSON.parse(Buffer.from(repo.get('site.config.json').b64, 'base64')).url, 'https://x.com');
});

test('login lockout after repeated failures', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/login', { body: { username: 'boss', password: 'wrong' + i }, ip: '8.8.8.8' });
  assert.equal(last.status, 429);
  const stillOk = await call('POST', '/api/login', { body: OWNER, ip: '8.8.8.8' });
  assert.equal(stillOk.status, 429, 'locked client cannot guess even with the right password');
});
