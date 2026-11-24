'use strict';

(() => {
  const TOKEN_KEY = 'taskssync.token';
  const TASKS_KEY = 'taskssync.tasks.v1';
  const QUEUE_KEY = 'taskssync.queue.v1';

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const emptyEl = $('empty');
  const statusEl = $('status');
  const inputEl = $('taskInput');

  let token = localStorage.getItem(TOKEN_KEY) || '';
  let tasks = readJSON(TASKS_KEY, []);
  let queue = readJSON(QUEUE_KEY, []);
  let filter = 'all';
  let flushing = false;
  let wsOpen = false;
  let ws = null;
  let booting = true;

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return Array.isArray(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  }

  function uid() {
    if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sortTasks() {
    tasks.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(`/api${path}`, { ...options, headers });
  }

  function setStatus(kind) {
    const states = {
      live: ['●', 'متصل مباشر', 'ok'],
      online: ['●', 'متصل', 'ok'],
      syncing: ['◌', queue.length ? `جاري المزامنة (${queue.length})` : 'جاري المزامنة', 'busy'],
      offline: ['○', 'بدون اتصال — التغييرات محفوظة', 'off'],
    };
    const [icon, label, cls] = states[kind] || states.online;
    statusEl.textContent = `${icon} ${label}`;
    statusEl.className = `status ${cls}`;
  }

  function showAuth(message) {
    if (message) $('authMessage').textContent = message;
    $('authOverlay').hidden = false;
    setTimeout(() => $('authInput').focus(), 50);
  }

  async function refresh() {
    if (queue.length || flushing) return;
    const res = await api('/tasks', { cache: 'no-store' });
    if (res.status === 401) {
      showAuth('التوكن غير صحيح، اكتبه تاني.');
      throw new Error('auth');
    }
    if (!res.ok) throw new Error('sync');
    tasks = await res.json();
    sortTasks();
    writeJSON(TASKS_KEY, tasks);
    render();
    setStatus(wsOpen ? 'live' : 'online');
  }

  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    setStatus('syncing');
    let unauthorized = false;

    while (queue.length) {
      const op = queue[0];
      try {
        const res = await api(op.path, {
          method: op.method,
          body: op.body ? JSON.stringify(op.body) : undefined,
        });
        if (res.status === 401) {
          unauthorized = true;
          break;
        }
        if (!res.ok) throw new Error('bad response');
        queue.shift();
        writeJSON(QUEUE_KEY, queue);
      } catch {
        break;
      }
    }

    flushing = false;
    if (unauthorized) {
      showAuth('التوكن غير صحيح، اكتبه تاني.');
      setStatus('offline');
      return;
    }
    if (!queue.length) {
      await refresh().catch(() => {});
    } else {
      setStatus(navigator.onLine ? 'online' : 'offline');
    }
  }

  function mutate(change) {
    const result = change();
    writeJSON(TASKS_KEY, tasks);
    render();

    const ops = Array.isArray(result) ? result : result ? [result] : [];
    if (!ops.length) return;
    queue.push(...ops);
    writeJSON(QUEUE_KEY, queue);
    setStatus(navigator.onLine ? 'syncing' : 'offline');
    flush();
  }

  function addTask(text) {
    text = text.trim().slice(0, 500);
    if (!text) return;
    const task = {
      id: uid(),
      text,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    mutate(() => {
      tasks.unshift(task);
      return { method: 'POST', path: '/tasks', body: task };
    });
    inputEl.value = '';
    inputEl.focus();
  }

  function toggleTask(id) {
    mutate(() => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return null;
      task.done = !task.done;
      task.updatedAt = Date.now();
      return {
        method: 'PATCH',
        path: `/tasks/${encodeURIComponent(id)}`,
        body: { ...task },
      };
    });
  }

  function renameTask(id, text) {
    text = text.trim().slice(0, 500);
    if (!text) return;
    mutate(() => {
      const task = tasks.find((t) => t.id === id);
      if (!task || task.text === text) return null;
      task.text = text;
      task.updatedAt = Date.now();
      return {
        method: 'PATCH',
        path: `/tasks/${encodeURIComponent(id)}`,
        body: { ...task },
      };
    });
  }

  function deleteTask(id) {
    mutate(() => {
      tasks = tasks.filter((t) => t.id !== id);
      return { method: 'DELETE', path: `/tasks/${encodeURIComponent(id)}` };
    });
  }

  function clearDone() {
    const ids = tasks.filter((t) => t.done).map((t) => t.id);
    if (!ids.length) return;
    mutate(() => {
      tasks = tasks.filter((t) => !t.done);
      return ids.map((id) => ({ method: 'DELETE', path: `/tasks/${encodeURIComponent(id)}` }));
    });
  }

  function startEdit(li, task) {
    const existing = li.querySelector('.task-text');
    if (!existing) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = task.text;
    input.maxLength = 500;
    let settled = false;

    const finish = (save) => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (save && value && value !== task.text) renameTask(task.id, value);
      else render();
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));

    existing.replaceWith(input);
    input.focus();
    input.select();
  }

  function makeItem(task) {
    const li = document.createElement('li');
    li.className = `item${task.done ? ' done' : ''}`;

    const label = document.createElement('label');
    label.className = 'check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(task.done);
    checkbox.setAttribute('aria-label', 'تغيير حالة التاسك');
    checkbox.addEventListener('change', () => toggleTask(task.id));
    const box = document.createElement('span');
    box.className = 'box';
    box.textContent = '✓';
    label.append(checkbox, box);

    const text = document.createElement('button');
    text.type = 'button';
    text.className = 'task-text';
    text.textContent = task.text;
    text.title = 'اضغط للتعديل';
    text.addEventListener('click', () => startEdit(li, task));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.textContent = '✕';
    del.title = 'حذف';
    del.setAttribute('aria-label', 'حذف التاسك');
    del.addEventListener('click', () => deleteTask(task.id));

    li.append(label, text, del);
    return li;
  }

  function render() {
    const all = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    $('countAll').textContent = all;
    $('countActive').textContent = all - done;
    $('countDone').textContent = done;
    $('clearDone').disabled = done === 0;

    document.querySelectorAll('.filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    const visible = tasks.filter((t) =>
      filter === 'all' ? true : filter === 'done' ? t.done : !t.done
    );

    listEl.replaceChildren(...visible.map(makeItem));
    emptyEl.hidden = visible.length > 0;
    $('emptyTitle').textContent =
      filter === 'done' ? 'مفيش تاسكات مكتملة' : filter === 'active' ? 'مفيش تاسكات نشطة' : 'القائمة فاضية';
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `${scheme}://${location.host}/ws${query}`;

    try {
      ws = new WebSocket(url);
    } catch {
      setTimeout(connect, 3000);
      return;
    }

    ws.onopen = () => {
      wsOpen = true;
      setStatus('live');
      if (!queue.length) refresh().catch(() => {});
    };

    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'snapshot' && !queue.length && !flushing) {
        tasks = Array.isArray(message.tasks) ? message.tasks : [];
        sortTasks();
        writeJSON(TASKS_KEY, tasks);
        render();
        setStatus('live');
      }
    };

    ws.onclose = () => {
      wsOpen = false;
      if (!booting) setStatus(navigator.onLine ? 'online' : 'offline');
      setTimeout(connect, 2500);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  async function boot() {
    sortTasks();
    render();
    setStatus(navigator.onLine ? 'online' : 'offline');

    try {
      const config = await fetch('/api/config', { cache: 'no-store' }).then((r) => r.json());
      if (config.authRequired && !token) {
        showAuth();
        return;
      }
    } catch {
      /* offline: use local cache */
    }

    booting = false;
    await refresh().catch(() => {});
    connect();
  }

  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = $('authInput').value.trim();
    if (!value) return;
    token = value;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
    $('authOverlay').hidden = true;
    $('authInput').value = '';
    booting = false;
    await refresh().catch(() => {});
    connect();
  });

  $('addForm').addEventListener('submit', (event) => {
    event.preventDefault();
    addTask(inputEl.value);
  });

  document.querySelectorAll('.filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      render();
    });
  });

  $('clearDone').addEventListener('click', clearDone);

  $('syncBtn').addEventListener('click', async () => {
    await flush();
    await refresh().catch(() => {});
    connect();
  });

  window.addEventListener('online', () => {
    setStatus('syncing');
    flush();
    refresh().catch(() => {});
    connect();
  });

  window.addEventListener('offline', () => setStatus('offline'));

  window.addEventListener('storage', (event) => {
    if (event.key === TASKS_KEY) {
      tasks = readJSON(TASKS_KEY, []);
      sortTasks();
      render();
    }
    if (event.key === QUEUE_KEY) queue = readJSON(QUEUE_KEY, []);
  });

  registerSW();
  boot();
})();
