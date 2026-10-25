// Tiny key-value wrapper: Netlify Blobs in production, memory for tests (USE_MEMORY_STORE=1).
import { getStore } from '@netlify/blobs';

const memory = new Map();

export function store(name) {
  if (process.env.USE_MEMORY_STORE === '1') {
    if (!memory.has(name)) memory.set(name, new Map());
    const m = memory.get(name);
    return {
      get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
      set: async (k, v) => void m.set(k, JSON.stringify(v)),
      delete: async (k) => void m.delete(k),
      list: async (prefix = '') => [...m.keys()].filter((k) => k.startsWith(prefix)).sort(),
    };
  }
  const s = getStore({ name, consistency: 'strong' });
  return {
    get: (k) => s.get(k, { type: 'json' }),
    set: (k, v) => s.setJSON(k, v),
    delete: (k) => s.delete(k),
    list: async (prefix = '') => {
      const keys = [];
      for await (const page of s.list({ prefix, paginate: true })) keys.push(...page.blobs.map((b) => b.key));
      return keys.sort();
    },
  };
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
