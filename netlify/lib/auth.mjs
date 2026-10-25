import crypto from 'node:crypto';
import { env, parseCookies, HttpError, isHttps } from './http.mjs';
import { store } from './store.mjs';

const SESSION_DAYS = 7;
const COOKIE = 'session';
export const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
export const sha256hex = (s) => sha(s).toString('hex');
const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function secret() {
  return env('SESSION_SECRET') || sha256hex(`session:${env('ADMIN_USERNAME')}:${env('ADMIN_PASSWORD')}`);
}

export const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

// ---- password hashing for team members (scrypt) ----
const scrypt = (pw, salt) =>
  new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, { N: 16384 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}

const DUMMY = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || DUMMY).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use a password with at least 10 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
}

// ---- sessions ----
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}

function verify(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export function sessionCookie(req, user) {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const token = sign({ u: user.username, r: user.role, exp });
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`;
}

export const clearCookie = (req) => `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;

export const ownerUsername = () => normalizeUsername(env('ADMIN_USERNAME'));

export async function getSession(req) {
  const p = verify(parseCookies(req)[COOKIE]);
  if (!p) return null;
  if (p.r === 'owner') {
    return p.u === ownerUsername() && env('ADMIN_PASSWORD') ? { username: p.u, role: 'owner' } : null;
  }
  const u = await store('users').get(p.u);
  return u ? { username: u.username, role: 'editor' } : null; // removed users lose access at once
}

export async function requireUser(req, { owner = false } = {}) {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, 'Sign in to continue.');
  if (owner && s.role !== 'owner') throw new HttpError(403, 'Only the owner can do that.');
  return s;
}

// ---- login with throttling ----
export async function throttle(key, { max, windowMs }) {
  const rl = store('ratelimit');
  const now = Date.now();
  let rec = await rl.get(key);
  if (!rec || now - rec.first > windowMs) rec = { count: 0, first: now };
  return { rec, blocked: rec.count >= max, save: () => rl.set(key, { ...rec, count: rec.count + 1 }), clear: () => rl.delete(key) };
}

export async function login(username, password, ipKey) {
  const name = normalizeUsername(username);
  if (!name || typeof password !== 'string' || password.length > 200) throw new HttpError(400, 'Enter your username and password.');
  const byIp = await throttle(`login-ip:${ipKey}`, { max: 10, windowMs: 15 * 60_000 });
  const byUser = await throttle(`login-user:${sha256hex(name)}`, { max: 30, windowMs: 15 * 60_000 });
  if (byIp.blocked || byUser.blocked) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');

  let user = null;
  const ownerPw = env('ADMIN_PASSWORD');
  if (ownerPw && ownerUsername() && name === ownerUsername()) {
    if (safeEqual(password, ownerPw)) user = { username: name, role: 'owner' };
  } else {
    const rec = await store('users').get(name);
    const ok = await verifyPassword(password, rec?.hash); // runs even when the user is missing
    if (rec && ok) user = { username: rec.username, role: 'editor' };
  }
  if (!user) {
    await byIp.save();
    await byUser.save();
    throw new HttpError(401, 'That username or password is not right.');
  }
  await byIp.clear();
  await byUser.clear();
  return user;
}
