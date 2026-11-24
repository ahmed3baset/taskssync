'use strict';

const WebSocket = require('ws');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TOKEN = process.env.APP_TOKEN || '';
const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(60);
  }
  throw new Error(`timeout: ${label}`);
}

async function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('server did not start');
}

function openClient(messages) {
  const url = BASE.replace(/^http/, 'ws') + '/ws' + (TOKEN ? `?token=${encodeURIComponent(TOKEN)}` : '');
  const ws = new WebSocket(url);
  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()));
  });
  return ws;
}

function hasTask(messages, id, done) {
  return messages.some((m) => {
    if (m.type !== 'snapshot') return false;
    const task = (m.tasks || []).find((t) => t.id === id);
    return task && (done === undefined || task.done === done);
  });
}

function wasRemoved(messages, id) {
  return messages.some(
    (m) => m.type === 'snapshot' && !(m.tasks || []).some((t) => t.id === id)
  );
}

async function main() {
  const health = await waitReady();
  console.log('health:', health);

  const config = await fetch(`${BASE}/api/config`).then((r) => r.json());
  console.log('config:', config);

  const a = [];
  const b = [];
  const wsA = openClient(a);
  const wsB = openClient(b);
  await waitFor('both sockets open', () => wsA.readyState === 1 && wsB.readyState === 1);
  await waitFor('initial snapshots', () => a.length > 0 && b.length > 0);

  const id = `smoke-${Date.now()}`;
  const task = { id, text: 'اختبار المزامنة', done: false, createdAt: Date.now() };

  const created = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  if (created.status !== 201) throw new Error(`POST failed: ${created.status}`);
  await waitFor('create broadcast → A', () => hasTask(a, id, false));
  await waitFor('create broadcast → B', () => hasTask(b, id, false));
  console.log('create + broadcast: OK');

  const patched = await fetch(`${BASE}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...task, done: true }),
  });
  if (!patched.ok) throw new Error(`PATCH failed: ${patched.status}`);
  await waitFor('patch broadcast → A', () => hasTask(a, id, true));
  await waitFor('patch broadcast → B', () => hasTask(b, id, true));
  console.log('toggle + broadcast: OK');

  const removed = await fetch(`${BASE}/api/tasks/${id}`, { method: 'DELETE', headers });
  if (removed.status !== 204) throw new Error(`DELETE failed: ${removed.status}`);
  await waitFor('delete broadcast → A', () => wasRemoved(a, id));
  await waitFor('delete broadcast → B', () => wasRemoved(b, id));
  console.log('delete + broadcast: OK');

  const page = await fetch(`${BASE}/`);
  const html = await page.text();
  if (page.status !== 200 || !html.includes('تاسكاتي')) throw new Error('index.html failed');
  for (const path of ['/styles.css', '/app.js', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png']) {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  }
  console.log('static assets + PWA files: OK');

  wsA.close();
  wsB.close();
  console.log('ALL GOOD');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
