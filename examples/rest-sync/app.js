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

// --- Setup ---

const API_URL = 'http://localhost:3001';

const db = new Database('sync-demo', 1);
db.registerModel(Task);

const adapter = new RestAdapter();

// --- UI Logic ---

async function init() {
  await db.connect();

  try {
    await adapter.connect({
      url: API_URL,
      endpointPattern: '/{table}'
    });
  } catch (err) {
    document.getElementById('lastAction').textContent =
      `⚠️ Could not connect to ${API_URL}. Run: npm run example:sync-api`;
    console.error(err);
  }

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

async function renderStatus() {
  document.getElementById('connStatus').textContent = adapter.isConnected() ? 'Connected' : 'Disconnected';
  document.getElementById('connStatus').className = adapter.isConnected() ? 'status-ok' : 'status-err';
  document.getElementById('lastSync').textContent = adapter.state.lastPushAt?.toLocaleTimeString() || 'Never';
  document.getElementById('pendingOps').textContent = String(adapter.state.pendingOperations);

  if (adapter.isConnected()) {
    try {
      const remote = await adapter.pull({ table: 'tasks' });
      document.getElementById('remoteCount').textContent = String(remote.length);
    } catch {
      document.getElementById('remoteCount').textContent = '?';
    }
  } else {
    document.getElementById('remoteCount').textContent = '—';
  }
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
