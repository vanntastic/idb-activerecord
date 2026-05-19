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

class Note extends ActiveRecord {
  static tableName = 'notes';
  static enableSync = true;
  static softDelete = true;

  static indexes = [
    { name: 'pinned_index', keyPath: 'pinned' }
  ];

  static validates = {
    content: { presence: true, length: { minimum: 1 } }
  };
}

class Label extends ActiveRecord {
  static tableName = 'labels';
  static enableSync = true;
  static softDelete = true;

  static validates = {
    name: { presence: true, length: { minimum: 1 } }
  };
}

// --- Setup ---

const API_URL = 'http://localhost:3001';
let currentUser = 'alice';

const db = new Database('sync-demo');
db.registerModel(Task);
db.registerModel(Note);
db.registerModel(Label);

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
  renderNotes();
  renderLabels();
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

async function addNote() {
  const content = document.getElementById('noteContent').value.trim();
  if (!content) return alert('Enter note content');

  await Note.create({ content, pinned: false, owner_id: currentUser });
  document.getElementById('noteContent').value = '';
  await renderNotes();
  await renderStatus();
}

async function togglePin(id) {
  const notes = await Note.where('owner_id', '=', currentUser).all();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  await note.update({ pinned: !note.pinned });
  await renderNotes();
  await renderStatus();
}

async function deleteNote(id) {
  const notes = await Note.where('owner_id', '=', currentUser).all();
  const note = notes.find(n => n.id === id);
  if (note) {
    await note.destroy();
    await renderNotes();
    await renderStatus();
  }
}

async function restoreNote(id) {
  const deleted = (await Note.onlyDeleted()).filter(n => n.owner_id === currentUser);
  if (!deleted.find(n => n.id === id)) return;
  await Note.restore(id);
  await renderNotes();
  await renderStatus();
}

async function renderNotes() {
  const notes = (await Note.where('owner_id', '=', currentUser).all()).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.id - b.id);
  const deleted = (await Note.onlyDeleted()).filter(n => n.owner_id === currentUser).sort((a, b) => a.id - b.id);
  const list = document.getElementById('noteList');
  list.innerHTML = '';

  if (notes.length === 0 && deleted.length === 0) {
    list.innerHTML = '<p style="color:#999">No notes yet. Add one above!</p>';
    return;
  }

  notes.forEach(note => {
    const li = document.createElement('div');
    li.className = `task-item${note.pinned ? ' pinned' : ''}`;
    li.innerHTML = `
      <span class="task-title">${escapeHtml(note.content)}</span>
      <span class="task-meta">v${note._version || 1}</span>
      <span class="task-status">${note.pinned ? '📌 pinned' : 'note'}</span>
      <button class="toggle-btn" onclick="togglePin(${note.id})">${note.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="delete-btn" onclick="deleteNote(${note.id})">Delete</button>
    `;
    list.appendChild(li);
  });

  if (deleted.length > 0) {
    const sep = document.createElement('div');
    sep.style.cssText = 'color:#64748b; font-size:0.8rem; padding:0.5rem 0; margin-top:0.5rem; border-top:1px solid #334155;';
    sep.textContent = `Deleted notes (${deleted.length}) — not yet synced:`;
    list.appendChild(sep);

    deleted.forEach(note => {
      const li = document.createElement('div');
      li.className = 'task-item deleted';
      li.innerHTML = `
        <span class="task-title">${escapeHtml(note.content)}</span>
        <span class="task-meta">v${note._version || 1}</span>
        <span class="task-status">deleted</span>
        <button class="toggle-btn" onclick="restoreNote(${note.id})">Restore</button>
      `;
      list.appendChild(li);
    });
  }
}

async function addLabel() {
  const name = document.getElementById('labelName').value.trim();
  const color = document.getElementById('labelColor').value || '#6366f1';
  if (!name) return alert('Enter a label name');

  await Label.create({ name, color, owner_id: currentUser });
  document.getElementById('labelName').value = '';
  await renderLabels();
  await renderStatus();
}

async function deleteLabel(id) {
  const labels = await Label.where('owner_id', '=', currentUser).all();
  const label = labels.find(l => l.id === id);
  if (label) {
    await label.destroy();
    await renderLabels();
    await renderStatus();
  }
}

async function renderLabels() {
  const labels = (await Label.where('owner_id', '=', currentUser).all()).sort((a, b) => a.id - b.id);
  const list = document.getElementById('labelList');
  list.innerHTML = '';

  if (labels.length === 0) {
    list.innerHTML = '<p style="color:#999">No labels yet. Labels table is created on first sync.</p>';
    return;
  }

  labels.forEach(label => {
    const li = document.createElement('div');
    li.className = 'task-item';
    li.innerHTML = `
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${escapeHtml(label.color || '#6366f1')};flex-shrink:0"></span>
      <span class="task-title">${escapeHtml(label.name)}</span>
      <span class="task-meta">v${label._version || 1}</span>
      <button class="delete-btn" onclick="deleteLabel(${label.id})">Delete</button>
    `;
    list.appendChild(li);
  });
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
    const opts = { strategy: ConflictStrategy.LAST_WRITE_WINS, onProgress: (msg) => { logAction(msg); } };
    const [taskResult, noteResult, labelResult] = await Promise.all([
      db.sync('tasks', adapter, opts),
      db.sync('notes', adapter, opts),
      db.sync('labels', adapter, opts)
    ]);

    const pushed = taskResult.pushed + noteResult.pushed + labelResult.pushed;
    const pulled = taskResult.pulled + noteResult.pulled + labelResult.pulled;
    const conflicts = taskResult.conflicts + noteResult.conflicts + labelResult.conflicts;
    const errors = taskResult.errors.length + noteResult.errors.length + labelResult.errors.length;
    logAction(`✅ Sync complete — pushed ${pushed}, pulled ${pulled}, conflicts ${conflicts}, errors ${errors}`);

    await renderTasks();
    await renderNotes();
    await renderLabels();
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

  const engine = db.getSyncEngine();
  const pending = connected
    ? (await engine.getPendingCount('tasks')) + (await engine.getPendingCount('notes')) + (await engine.getPendingCount('labels'))
    : 0;
  document.getElementById('pendingOps').textContent = String(pending);

  if (connected) {
    try {
      const [remoteTasks, remoteNotes, remoteLabels] = await Promise.all([
        adapter.pull({ table: 'tasks', where: { owner_id: currentUser } }),
        adapter.pull({ table: 'notes', where: { owner_id: currentUser } }),
        adapter.pull({ table: 'labels', where: { owner_id: currentUser } }).catch(() => [])
      ]);
      document.getElementById('remoteCount').textContent = String(remoteTasks.length + remoteNotes.length + remoteLabels.length);
    } catch {
      document.getElementById('remoteCount').textContent = '?';
    }
  } else {
    document.getElementById('remoteCount').textContent = '—';
  }

  const localTasks = (await Task.where('owner_id', '=', currentUser).all()).length;
  const localNotes = (await Note.where('owner_id', '=', currentUser).all()).length;
  const localLabels = (await Label.where('owner_id', '=', currentUser).all()).length;
  document.getElementById('localCount').textContent = String(localTasks + localNotes + localLabels);

  document.getElementById('userBadge').textContent = currentUser;
}

function switchUser(name) {
  currentUser = name;
  document.getElementById('btn-alice').className = name === 'alice' ? 'user-btn active' : 'user-btn';
  document.getElementById('btn-bob').className = name === 'bob' ? 'user-btn active' : 'user-btn';
  logAction(`Switched to user: ${name}`);
  renderStatus();
  renderTasks();
  renderNotes();
  renderLabels();
}

async function clearLocal() {
  if (!confirm('Clear all local tasks? This cannot be undone.')) return;

  // Hard delete everything from IndexedDB
  const idb = db.getDB();
  const tx = idb.transaction(['tasks', 'notes', 'labels', '__sync_changes', '__sync_meta'], 'readwrite');
  tx.objectStore('tasks').clear();
  tx.objectStore('notes').clear();
  tx.objectStore('labels').clear();
  tx.objectStore('__sync_changes').clear();
  tx.objectStore('__sync_meta').clear();

  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });

  logAction('Local database cleared');
  await renderTasks();
  await renderNotes();
  await renderLabels();
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
window.addNote = addNote;
window.togglePin = togglePin;
window.deleteNote = deleteNote;
window.restoreNote = restoreNote;
window.addLabel = addLabel;
window.deleteLabel = deleteLabel;
window.doSync = doSync;
window.switchUser = switchUser;
window.clearLocal = clearLocal;

init();
