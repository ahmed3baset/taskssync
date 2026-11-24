import { assets } from './assets.generated.js';

export { TaskHub } from './do.js';

function authorized(request, url, env) {
  if (!env.APP_TOKEN) return true;
  if (request.headers.get('Authorization') === `Bearer ${env.APP_TOKEN}`) return true;
  return url.searchParams.get('token') === env.APP_TOKEN;
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function asset(pathname) {
  const entry = assets[pathname] || assets['/index.html'];
  const bytes = Uint8Array.from(atob(entry.body), (char) => char.charCodeAt(0));
  const noCache = pathname === '/sw.js' || pathname.endsWith('.webmanifest');
  return new Response(bytes, {
    headers: {
      'Content-Type': entry.type,
      'Cache-Control': noCache ? 'no-cache, no-store, must-revalidate' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/config') {
      return json({ authRequired: Boolean(env.APP_TOKEN) });
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, store: 'durable-object-sqlite', realtime: true });
    }

    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
      if (!authorized(request, url, env)) {
        return json({ error: 'unauthorized' }, 401, { 'X-Auth-Required': '1' });
      }
      const stub = env.TASK_HUB.get(env.TASK_HUB.idFromName('global'));
      return stub.fetch(request);
    }

    return asset(url.pathname);
  },
};
