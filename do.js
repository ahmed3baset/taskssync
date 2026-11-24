'use strict';

function normalize(task) {
  return {
    id: String(task.id),
    text: String(task.text ?? '').slice(0, 500),
    done: Boolean(task.done),
    createdAt: Number(task.createdAt) || Date.now(),
    updatedAt: Number(task.updatedAt) || Date.now(),
  };
}

function parseTask(body, fallback = null) {
  const source = { ...(fallback || {}), ...(body || {}) };
  const text = typeof source.text === 'string' ? source.text.trim().slice(0, 500) : '';
  if (!text) throw new Error('TEXT_REQUIRED');
  return normalize({
    ...source,
    id: typeof source.id === 'string' && source.id ? source.id : crypto.randomUUID(),
    text,
    done: source.done === true || source.done === 'true' || source.done === 1,
    createdAt: Number(source.createdAt) || Date.now(),
    updatedAt: Date.now(),
  });
}

export class TaskHub {
  constructor(state) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  list() {
    const rows = this.sql
      .exec('SELECT id, text, done, created_at, updated_at FROM tasks ORDER BY created_at DESC')
      .toArray();
    return rows.map((row) =>
      normalize({
        id: row.id,
        text: row.text,
        done: row.done,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
    );
  }

  get(id) {
    const row = this.sql
      .exec('SELECT id, text, done, created_at, updated_at FROM tasks WHERE id = ?', id)
      .toArray()[0];
    if (!row) return null;
    return normalize({
      id: row.id,
      text: row.text,
      done: row.done,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  upsert(task) {
    this.sql.exec(
      `INSERT INTO tasks (id, text, done, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         done = excluded.done,
         updated_at = excluded.updated_at`,
      task.id,
      task.text,
      task.done ? 1 : 0,
      task.createdAt,
      task.updatedAt
    );
  }

  remove(id) {
    this.sql.exec('DELETE FROM tasks WHERE id = ?', id);
  }

  broadcast() {
    const message = JSON.stringify({ type: 'snapshot', tasks: this.list() });
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        /* a dead socket gets cleaned up by the runtime */
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 400 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'snapshot', tasks: this.list() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/api/tasks' && request.method === 'GET') {
      return json(this.list());
    }

    if (url.pathname === '/api/tasks' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'invalid_json' }, 400);
      }
      try {
        const task = parseTask(body);
        this.upsert(task);
        this.broadcast();
        return json(task, 201);
      } catch (error) {
        if (error.message === 'TEXT_REQUIRED') return json({ error: 'text_required' }, 400);
        throw error;
      }
    }

    const match = url.pathname.match(/^\/api\/tasks\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);

      if (request.method === 'PATCH') {
        const existing = this.get(id);
        if (!existing) return json({ error: 'not_found' }, 404);
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: 'invalid_json' }, 400);
        }
        try {
          const task = parseTask(body, existing);
          this.upsert({ ...task, id });
          this.broadcast();
          return json(task);
        } catch (error) {
          if (error.message === 'TEXT_REQUIRED') return json({ error: 'text_required' }, 400);
          throw error;
        }
      }

      if (request.method === 'DELETE') {
        this.remove(id);
        this.broadcast();
        return new Response(null, { status: 204 });
      }
    }

    return json({ error: 'not_found' }, 404);
  }

  webSocketMessage() {
    /* the client only listens for snapshots; ignore incoming pings/messages */
  }

  webSocketClose() {
    /* hibernation API handles cleanup */
  }

  webSocketError() {
    /* hibernation API handles cleanup */
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
