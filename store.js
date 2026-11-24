'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalize(t) {
  return {
    id: String(t.id),
    text: String(t.text ?? '').slice(0, 500),
    done: Boolean(t.done),
    createdAt: Number(t.createdAt) || Date.now(),
    updatedAt: Number(t.updatedAt) || Date.now(),
  };
}

class FileStore {
  constructor() {
    this.dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
    this.file = path.join(this.dir, 'tasks.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.cache = this._read();
  }

  _read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(value) ? value.map(normalize) : [];
    } catch {
      return [];
    }
  }

  _write(tasks) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  async list() {
    return this.cache.map((t) => ({ ...t }));
  }

  async get(id) {
    const found = this.cache.find((t) => t.id === id);
    return found ? { ...found } : null;
  }

  async upsert(task) {
    const t = normalize(task);
    const index = this.cache.findIndex((x) => x.id === t.id);
    if (index === -1) this.cache.push(t);
    else this.cache[index] = t;
    this._write(this.cache);
    return { ...t };
  }

  async remove(id) {
    this.cache = this.cache.filter((t) => t.id !== id);
    this._write(this.cache);
  }
}

class PostgresStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    const url = new URL(connectionString);
    const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    const needSsl = url.searchParams.get('sslmode') === 'require' || !isLocal;

    this.pool = new Pool({
      connectionString,
      ssl: needSsl ? { rejectUnauthorized: false } : undefined,
    });

    this.ready = this.pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
  }

  async list() {
    await this.ready;
    const { rows } = await this.pool.query(
      'SELECT id, text, done, created_at AS "createdAt", updated_at AS "updatedAt" FROM tasks'
    );
    return rows.map(normalize);
  }

  async get(id) {
    await this.ready;
    const { rows } = await this.pool.query(
      'SELECT id, text, done, created_at AS "createdAt", updated_at AS "updatedAt" FROM tasks WHERE id = $1',
      [id]
    );
    return rows[0] ? normalize(rows[0]) : null;
  }

  async upsert(task) {
    await this.ready;
    const t = normalize(task);
    await this.pool.query(
      `INSERT INTO tasks (id, text, done, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET text = EXCLUDED.text, done = EXCLUDED.done, updated_at = EXCLUDED.updated_at`,
      [t.id, t.text, t.done, t.createdAt, t.updatedAt]
    );
    return t;
  }

  async remove(id) {
    await this.ready;
    await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
}

const store = process.env.DATABASE_URL
  ? new PostgresStore(process.env.DATABASE_URL)
  : new FileStore();

module.exports = store;
