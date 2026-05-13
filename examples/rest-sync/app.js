// REST Sync Adapter Example
// Demonstrates syncing local IndexedDB with a remote REST API

import { Database, ActiveRecord, RestAdapter, ConflictStrategy } from '../../dist/index.js';

// --- Models ---

class Task extends ActiveRecord {
  static tableName = 'tasks';

  static indexes = [
    { name: 'status_index', keyPath: 'status' }
  ];

  static validates = {
    title: { presence: true, length: { minimum: 1 } }
  };
}

// --- Mock REST API (in-memory for demo) ---

const mockServer = {
  tasks: [],
  nextId: 1,

  handle(req) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    // Health check
    if (path === '/health') {
      return Response.json({ status: 'ok' });
    }

    // Schema
    if (path.startsWith('/schema/')) {
      return Response.json({
        name: 'tasks',
        columns: [
          { name: 'id', type: 'integer', nullable: false },
          { name: 'title', type: 'string', nullable: false },
          { name: 'status', type: 'string', nullable: true },
          { name: 'updatedAt', type: 'datetime', nullable: true }
        ],
        indexes: []
      });
    }

    // Migrations
    if (path === '/migrations') {
      return Response.json({ applied: true });
    }

    // Tasks endpoint
    if (path === '/tasks') {
      if (method === 'GET') {
        let results = [...this.tasks];
        const since = url.searchParams.get('since');
        if (since) {
          const sinceDate = new Date(since);
          results = results.filter(t => new Date(t.updatedAt) > sinceDate);
        }
        return Response.json(results);
      }

      if (method === 'POST') {
        return req.json().then(body => {
          const records = Array.isArray(body) ? body : [body];
          for (const rec of records) {
            if (rec.id) {
              // Update existing
              const idx = this.tasks.findIndex(t => t.id === rec.id);
              if (idx >= 0) {
                this.tasks[idx] = { ...rec, updatedAt: new Date().toISOString() };
              } else {
                this.tasks.push({ ...rec, updatedAt: new Date().toISOString() });
              }
            } else {
              // Create new
              rec.id = this.nextId++;
              rec.updatedAt = new Date().toISOString();
              this.tasks.push(rec);
            }
          }
          return Response.json({ pushed: records.length });
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Override fetch to route through mock server
const originalFetch = window.fetch;
window.fetch = function(url, init) {
  if (String(url).startsWith('http://mock-api')) {
    return mockServer.handle({ url: String(url), method: init?.method || 'GET', json: () => Promise.resolve(init?.body ? JSON.parse(init.body) : {}) });
  }
  return originalFetch(url, init);
};

// --- Setup ---

const db = new Database('sync-demo', 1);
db.registerModel(Task);

const adapter = new RestAdapter();

// --- UI Logic ---

async function init() {
  await db.connect();
  await adapter.connect({
    url: 'http://mock-api',
    endpointPattern: '/{table}'
  });

  renderStatus();
  renderTasks();
}

async function addTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return alert('Enter a task title');

  await Task.create({ title, status: 'pending' });
  document.getElementById('taskTitle').value = '';
  renderTasks();
}

async function toggleTask(id) {
  const tasks = await Task.all();
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const newStatus = task.status === 'done' ? 'pending' : 'done';
  await task.update({ status: newStatus });
  renderTasks();
}

async function deleteTask(id) {
  const tasks = await Task.all();
  const task = tasks.find(t => t.id === id);
  if (task) {
    await task.destroy();
    renderTasks();
  }
}

async function renderTasks() {
  const tasks = (await Task.all()).sort((a, b) => a.id - b.id);
  const list = document.getElementById('taskList');
  list.innerHTML = '';

  if (tasks.length === 0) {
    list.innerHTML = '<p style="color:#999">No tasks yet. Add one above!</p>';
    return;
  }

  tasks.forEach(task => {
    const li = document.createElement('div');
    li.className = `task-item ${task.status}`;
    li.innerHTML = `
      <span class="task-title">${escapeHtml(task.title)}</span>
      <span class="task-status">${task.status}</span>
      <button class="toggle-btn" onclick="toggleTask(${task.id})">${task.status === 'done' ? 'Undo' : 'Done'}</button>
      <button class="delete-btn" onclick="deleteTask(${task.id})">Delete</button>
    `;
    list.appendChild(li);
  });
}

async function syncPush() {
  const tasks = await Task.all();
  const result = await adapter.push(tasks);
  document.getElementById('lastAction').textContent = `Pushed ${result.pushed} tasks`;
  renderStatus();
}

async function syncPull() {
  const remote = await adapter.pull({ table: 'tasks' });
  document.getElementById('lastAction').textContent = `Pulled ${remote.length} tasks from remote`;

  // Merge: update local with remote (simple replace for demo)
  const localTasks = await Task.all();
  for (const lt of localTasks) {
    await lt.destroy();
  }
  for (const rt of remote) {
    await Task.create(rt);
  }

  renderTasks();
  renderStatus();
}

async function resolveDemo() {
  const local = { id: 1, title: 'Local Task', status: 'pending', updatedAt: new Date('2024-01-01').toISOString() };
  const remote = { id: 1, title: 'Remote Task', status: 'done', updatedAt: new Date('2024-02-01').toISOString() };

  const winner = await adapter.resolveConflict(
    local,
    remote,
    ConflictStrategy.LAST_WRITE_WINS
  );

  document.getElementById('lastAction').textContent =
    `Conflict resolved: "${winner.title}" wins (strategy: lastWriteWins)`;
}

function renderStatus() {
  document.getElementById('connStatus').textContent = adapter.isConnected() ? 'Connected' : 'Disconnected';
  document.getElementById('connStatus').className = adapter.isConnected() ? 'status-ok' : 'status-err';
  document.getElementById('lastSync').textContent = adapter.state.lastPushAt?.toLocaleTimeString() || 'Never';
  document.getElementById('pendingOps').textContent = String(adapter.state.pendingOperations);
  document.getElementById('remoteCount').textContent = String(mockServer.tasks.length);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Expose to window for inline onclick handlers
window.addTask = addTask;
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.syncPush = syncPush;
window.syncPull = syncPull;
window.resolveDemo = resolveDemo;

init();
