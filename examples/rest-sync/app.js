// REST Sync Adapter Example — Multi-User Demo
// Demonstrates SyncEngine with change tracking, soft deletes, and conflict resolution.

import { Database, ActiveRecord, RestAdapter, ConflictStrategy } from '../../dist/index.js';

// --- Models ---

class Task extends ActiveRecord {
  static tableName = 'tasks';
  static enableSync = true;
  static softDelete = true;

  static indexes = [
    { name: 'status_index', keyPath: 'status' }
  ];

  static validates = {
    title: { presence: true, length: { minimum: 1 } }
  };
}

// --- Setup ---

const API_URL = 'http://localhost:3001';
let currentUser = 'alice';

const db = new Database('sync-demo');
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
    logAction(`⚠️ Could not connect to ${API_URL}. Run: npm run example:sync-api`);
    console.error(err);
  }

  renderStatus();
  renderTasks();
}

function logAction(msg) {
  const el = document.getElementById('lastAction');
  el.textContent = msg;
  console.log('[sync]', msg);
}

async function addTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) return alert('Enter a task title');

  await Task.create({ title, status: 'pending', owner_id: currentUser });
  document.getElementById('taskTitle').value = '';
  await renderTasks();
  await renderStatus();
}

async function toggleTask(id) {
  const tasks = await Task.where('owner_id', '=', currentUser).all();
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const newStatus = task.status === 'done' ? 'pending' : 'done';
  await task.update({ status: newStatus });
  await renderTasks();
  await renderStatus();
}

async function deleteTask(id) {
  const tasks = await Task.where('owner_id', '=', currentUser).all();
  const task = tasks.find(t => t.id === id);
  if (task) {
    await task.destroy();
    await renderTasks();
    await renderStatus();
  }
}

async function restoreTask(id) {
  const deleted = (await Task.onlyDeleted()).filter(t => t.owner_id === currentUser);
  if (!deleted.find(t => t.id === id)) return;
  await Task.restore(id);
  await renderTasks();
  await renderStatus();
}

async function renderTasks() {
  const tasks = (await Task.where('owner_id', '=', currentUser).all()).sort((a, b) => a.id - b.id);
  const deleted = (await Task.onlyDeleted()).filter(t => t.owner_id === currentUser).sort((a, b) => a.id - b.id);
  const list = document.getElementById('taskList');
  list.innerHTML = '';

  if (tasks.length === 0 && deleted.length === 0) {
    list.innerHTML = '<p style="color:#999">No tasks yet. Add one above!</p>';
    return;
  }

  tasks.forEach(task => {
    const li = document.createElement('div');
    li.className = `task-item ${task.status}`;
    li.innerHTML = `
      <span class="task-title">${escapeHtml(task.title)}</span>
      <span class="task-meta">v${task._version || 1}</span>
      <span class="task-status">${task.status}</span>
      <button class="toggle-btn" onclick="toggleTask(${task.id})">${task.status === 'done' ? 'Undo' : 'Done'}</button>
      <button class="delete-btn" onclick="deleteTask(${task.id})">Delete</button>
    `;
    list.appendChild(li);
  });

  if (deleted.length > 0) {
    const sep = document.createElement('div');
    sep.style.cssText = 'color:#64748b; font-size:0.8rem; padding:0.5rem 0; margin-top:0.5rem; border-top:1px solid #334155;';
    sep.textContent = `Deleted tasks (${deleted.length}) — not yet synced:`;
    list.appendChild(sep);

    deleted.forEach(task => {
      const li = document.createElement('div');
      li.className = 'task-item deleted';
      li.innerHTML = `
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-meta">v${task._version || 1}</span>
        <span class="task-status">deleted</span>
        <button class="toggle-btn" onclick="restoreTask(${task.id})">Restore</button>
      `;
      list.appendChild(li);
    });
  }
}

async function doSync() {
  if (!adapter.isConnected()) {
    logAction('⚠️ Adapter not connected');
    return;
  }

  logAction('Sync started...');

  try {
    const result = await db.sync('tasks', adapter, {
      strategy: ConflictStrategy.LAST_WRITE_WINS,
      onProgress: (msg) => { logAction(msg); }
    });

    logAction(
      `✅ Sync complete — pushed ${result.pushed}, pulled ${result.pulled}, ` +
      `conflicts ${result.conflicts}, errors ${result.errors.length}`
    );

    await renderTasks();
    await renderStatus();
  } catch (err) {
    logAction(`❌ Sync failed: ${err.message}`);
    console.error(err);
  }
}

async function renderStatus() {
  const connected = adapter.isConnected();
  document.getElementById('connStatus').textContent = connected ? 'Connected' : 'Disconnected';
  document.getElementById('connStatus').className = connected ? 'status-ok' : 'status-err';

  const pending = connected ? await db.getSyncEngine().getPendingCount('tasks') : 0;
  document.getElementById('pendingOps').textContent = String(pending);

  if (connected) {
    try {
      const remote = await adapter.pull({ table: 'tasks', where: { owner_id: currentUser } });
      document.getElementById('remoteCount').textContent = String(remote.length);
    } catch {
      document.getElementById('remoteCount').textContent = '?';
    }
  } else {
    document.getElementById('remoteCount').textContent = '—';
  }

  const local = (await Task.where('owner_id', '=', currentUser).all()).length;
  document.getElementById('localCount').textContent = String(local);

  document.getElementById('userBadge').textContent = currentUser;
}

function switchUser(name) {
  currentUser = name;
  document.getElementById('btn-alice').className = name === 'alice' ? 'user-btn active' : 'user-btn';
  document.getElementById('btn-bob').className = name === 'bob' ? 'user-btn active' : 'user-btn';
  logAction(`Switched to user: ${name}`);
  renderStatus();
  renderTasks();
}

async function clearLocal() {
  if (!confirm('Clear all local tasks? This cannot be undone.')) return;

  // Hard delete everything from IndexedDB
  const idb = db.getDB();
  const tx = idb.transaction(['tasks', '__sync_changes', '__sync_meta'], 'readwrite');
  tx.objectStore('tasks').clear();
  tx.objectStore('__sync_changes').clear();
  tx.objectStore('__sync_meta').clear();

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });

  logAction('Local database cleared');
  await renderTasks();
  await renderStatus();
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
window.restoreTask = restoreTask;
window.doSync = doSync;
window.switchUser = switchUser;
window.clearLocal = clearLocal;

init();
