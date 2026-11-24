'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const store = require('./store');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = Number(process.env.PORT) || 3000;
const APP_TOKEN = process.env.APP_TOKEN || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

function authorized(req) {
  return !APP_TOKEN || req.get('authorization') === `Bearer ${APP_TOKEN}`;
}

function requireAuth(req, res, next) {
  if (!authorized(req)) {
    res.set('X-Auth-Required', '1');
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function parseTask(body) {
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
  if (!text) throw new Error('TEXT_REQUIRED');
  return {
    id: typeof body.id === 'string' && body.id ? body.id : crypto.randomUUID(),
    text,
    done: body.done === true || body.done === 'true',
    createdAt: Number(body.createdAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

async function snapshot(ws) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'snapshot', tasks: await store.list() }));
}

async function broadcast() {
  const message = JSON.stringify({ type: 'snapshot', tasks: await store.list() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

app.get('/api/config', (_req, res) => {
  res.json({ authRequired: Boolean(APP_TOKEN) });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, store: process.env.DATABASE_URL ? 'postgres' : 'file' });
});

app.get('/api/tasks', requireAuth, async (_req, res) => {
  try {
    res.json(await store.list());
  } catch (error) {
    console.error('GET tasks failed:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  try {
    const task = parseTask(req.body);
    await store.upsert(task);
    await broadcast();
    res.status(201).json(task);
  } catch (error) {
    if (error.message === 'TEXT_REQUIRED') return res.status(400).json({ error: 'text_required' });
    console.error('POST task failed:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const existing = await store.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const task = parseTask({ ...existing, ...req.body, id: req.params.id });
    await store.upsert(task);
    await broadcast();
    res.json(task);
  } catch (error) {
    if (error.message === 'TEXT_REQUIRED') return res.status(400).json({ error: 'text_required' });
    console.error('PATCH task failed:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    await store.remove(req.params.id);
    await broadcast();
    res.status(204).end();
  } catch (error) {
    console.error('DELETE task failed:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

app.get('/sw.js', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

app.use(
  express.static(PUBLIC_DIR, {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.webmanifest')) res.set('Cache-Control', 'no-cache');
    },
  })
);

app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

server.on('upgrade', (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  if (APP_TOKEN && url.searchParams.get('token') !== APP_TOKEN) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  snapshot(ws).catch((error) => console.error('WS snapshot failed:', error));
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);
heartbeat.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TasksSync ready → http://localhost:${PORT}`);
  console.log(`Storage → ${process.env.DATABASE_URL ? 'Postgres' : 'data/tasks.json'}`);
  if (APP_TOKEN) console.log('Access token → enabled');
});
