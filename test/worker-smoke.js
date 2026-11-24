'use strict';

const WebSocket = require('ws');

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:3200';

async function main() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) break;
    } catch {
      /* worker still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log('health:', health);
  const config = await fetch(`${BASE}/api/config`).then((r) => r.json());
  console.log('config:', config);

  const socket = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const snapshots = [];
  socket.on('message', (raw) => snapshots.push(JSON.parse(raw.toString())));
  await new Promise((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });

  const task = { id: `cf-${Date.now()}`, text: 'اختبار مباشر', done: false, createdAt: Date.now() };
  const created = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  console.log('create:', created.status);

  await new Promise((resolve) => setTimeout(resolve, 400));
  const tasks = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  if (!tasks.some((t) => t.id === task.id)) throw new Error('task missing after create');
  if (!snapshots.some((m) => m.type === 'snapshot' && m.tasks.some((t) => t.id === task.id))) {
    throw new Error('no WebSocket broadcast');
  }
  console.log('create + broadcast: OK');

  const patched = await fetch(`${BASE}/api/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...task, done: true }),
  });
  console.log('toggle:', patched.status);
  const afterToggle = await patched.json();
  if (!afterToggle.done) throw new Error('toggle failed');

  const deleted = await fetch(`${BASE}/api/tasks/${task.id}`, { method: 'DELETE' });
  console.log('delete:', deleted.status);
  const finalTasks = await fetch(`${BASE}/api/tasks`).then((r) => r.json());
  if (finalTasks.some((t) => t.id === task.id)) throw new Error('task still present after delete');
  console.log('toggle + delete + broadcast: OK');

  for (const path of ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png']) {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) throw new Error(`static ${path} failed: ${res.status}`);
  }
  console.log('static assets + PWA files: OK');

  socket.close();
  console.log('ALL GOOD');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
