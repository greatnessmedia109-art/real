import { env, HttpError } from './http.mjs';

export function ghConfig() {
  const repo = env('GITHUB_REPO').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  return { repo, token: env('GITHUB_TOKEN'), branch: env('GITHUB_BRANCH') || 'main' };
}

export const githubConfigured = () => {
  const c = ghConfig();
  return Boolean(c.repo && c.token);
};

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

async function gh(method, apiPath, body) {
  const { repo, token } = ghConfig();
  if (!repo || !token) throw new HttpError(503, 'GitHub is not connected yet. Add GITHUB_REPO and GITHUB_TOKEN in Netlify (see the setup guide).');
  const res = await fetch(`https://api.github.com/repos/${repo}/${apiPath}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'seo-blog-admin',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && method === 'GET') return null;
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch {}
    const hint =
      res.status === 401 ? 'GitHub rejected the token. Create a new one and update GITHUB_TOKEN.'
      : res.status === 403 || res.status === 404 ? 'The token cannot write to this repository. Give it "Contents: Read and write" access to the repo.'
      : `GitHub said: ${detail || res.status}`;
    const err = new HttpError(res.status === 409 || res.status === 422 ? 409 : 502, hint);
    err.github = res.status;
    throw err;
  }
  return res.status === 204 ? {} : res.json();
}

export async function getFile(path) {
  const { branch } = ghConfig();
  const data = await gh('GET', `contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
  if (!data || Array.isArray(data) || data.type !== 'file') return null;
  return { sha: data.sha, text: Buffer.from(data.content || '', 'base64').toString('utf8') };
}

export async function listDir(path) {
  const { branch } = ghConfig();
  const data = await gh('GET', `contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
  return Array.isArray(data) ? data.filter((f) => f.type === 'file').map((f) => ({ name: f.name, path: f.path, sha: f.sha })) : [];
}

// Create or update a file. content: string or Buffer.
export async function putFile(path, content, message) {
  const { branch } = ghConfig();
  const b64 = Buffer.from(content).toString('base64');
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await getFile(path);
    try {
      return await gh('PUT', `contents/${enc(path)}`, { message, content: b64, branch, ...(existing ? { sha: existing.sha } : {}) });
    } catch (err) {
      if (err.github !== 409 && err.github !== 422) throw err;
      if (attempt === 1) throw new HttpError(409, 'The file changed while saving. Reload and try again.');
    }
  }
}

export async function deleteFile(path, message) {
  const { branch } = ghConfig();
  const existing = await getFile(path);
  if (!existing) return false;
  await gh('DELETE', `contents/${enc(path)}`, { message, sha: existing.sha, branch });
  return true;
}
