// Multi-Device Sync Example — self-contained reconciliation demo.
//
// Two independent IndexedDB databases ("phone" and "laptop") sync against a
// shared in-memory CloudAdapter. This mirrors the real-world scenario where a
// phone holds thousands of records and a laptop with only a few local records
// pulls them all down on first sync — while still pushing its own local edits.
//
// No backend is required: the "cloud" is just a JS object that implements the
// SyncAdapter interface (the same contract TursoAdapter / SQLiteAdapter fulfil).

import { Database, ActiveRecord, BaseAdapter, ConflictStrategy } from '../../dist/index.js';

// ---------------------------------------------------------------------------
// In-memory cloud adapter — implements the SyncAdapter contract.
// ---------------------------------------------------------------------------

class CloudAdapter extends BaseAdapter {
  constructor() {
    super();
    this.rows = new Map(); // id -> record
  }

  async connect() { this.connected = true; }
  async disconnect() { this.connected = false; }

  async ensureTable() { /* schema-less in memory */ }
  async getRemoteSchema(table) { return { name: table, columns: [], indexes: [] }; }
  async applyMigration() { /* no-op */ }

  // Pull records changed since `query.since` (incremental sync). On the first
  // sync `since` is undefined, so every row is returned.
  async pull(query) {
    const since = query.since ? new Date(query.since).getTime() : null;
    const out = [];
    for (const rec of this.rows.values()) {
      if (since !== null) {
        const t = new Date(rec.updatedAt || 0).getTime();
        if (t <= since) continue;
      }
      out.push({ ...rec });
    }
    return out;
  }

  // Upsert each pushed record by id (last write wins at the storage layer).
  async push(records) {
    for (const rec of records) {
      this.rows.set(rec.id, { ...rec });
    }
    return { pushed: records.length, pulled: 0, conflicts: 0, errors: [], timestamp: new Date() };
  }

  list() { return Array.from(this.rows.values()); }
  clear() { this.rows.clear(); }
}

// ---------------------------------------------------------------------------
// Models — one class per device so each binds to its own IndexedDB connection
// (ActiveRecord stores the connection as a static, so the classes must differ).
// ---------------------------------------------------------------------------

function makeTaskModel() {
  return class Task extends ActiveRecord {
    static tableName = 'tasks';
    static enableSync = true;
    static softDelete = true;
    static columns = {
      title: { type: 'string', nullable: false },
      status: { type: 'string', default: 'pending' }
    };
  };
}

const PhoneTask = makeTaskModel();
const LaptopTask = makeTaskModel();

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const cloud = new CloudAdapter();
let phoneDb, laptopDb;

const DB_PHONE = 'md-phone';
const DB_LAPTOP = 'md-laptop';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const logEl = document.getElementById('log');

function log(actor, message, cls = 'info') {
  const line = document.createElement('div');
  line.className = 'line';
  const stamp = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="dim">${stamp}</span> ` +
    `<span class="t-${actor}">[${actor}]</span> ` +
    `<span class="t-${cls}">${message}</span>`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function logResult(actor, label, result) {
  log(actor,
    `${label} → pushed <b>${result.pushed}</b>, pulled <b>${result.pulled}</b>, ` +
    `conflicts <b>${result.conflicts}</b>`,
    'result');
}

// ---------------------------------------------------------------------------
// Database setup / reset
// ---------------------------------------------------------------------------

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

async function setupDatabases() {
  phoneDb = new Database(DB_PHONE);
  phoneDb.registerModel(PhoneTask);
  await phoneDb.connect();

  laptopDb = new Database(DB_LAPTOP);
  laptopDb.registerModel(LaptopTask);
  await laptopDb.connect();
}

async function resetDemo() {
  setBusy(true);
  log('info', 'Resetting demo — clearing both devices and the cloud…');
  if (phoneDb) await phoneDb.close();
  if (laptopDb) await laptopDb.close();
  cloud.clear();
  await deleteDatabase(DB_PHONE);
  await deleteDatabase(DB_LAPTOP);
  await setupDatabases();

  // Give the laptop a couple of unique local tasks up front so the first
  // laptop sync demonstrates a simultaneous push (local) + pull (phone's data).
  await LaptopTask.create({ title: 'Laptop note: buy coffee', status: 'pending' });
  await LaptopTask.create({ title: 'Laptop note: review PR', status: 'pending' });
  log('laptop', 'Seeded 2 laptop-only tasks.');

  await renderAll();
  log('info', 'Ready. Try: 1) Seed phone → 2) Sync phone → 3) Sync laptop.');
  setBusy(false);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function seedPhone() {
  const count = parseInt(document.getElementById('seedCount').value, 10);
  setBusy(true);
  log('mobile', `Creating ${count.toLocaleString()} tasks on the phone…`);
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    await PhoneTask.create({
      title: `Phone task #${i + 1}`,
      status: i % 4 === 0 ? 'completed' : 'pending'
    });
  }
  const ms = Math.round(performance.now() - t0);
  log('mobile', `Created ${count.toLocaleString()} tasks in ${ms} ms.`);
  await renderAll();
  setBusy(false);
}

async function syncPhone() {
  setBusy(true);
  log('mobile', 'Syncing with cloud…');
  const result = await phoneDb.sync('tasks', cloud, {
    strategy: ConflictStrategy.LAST_WRITE_WINS,
    onProgress: (m) => log('mobile', m, 'info')
  });
  logResult('mobile', 'Phone sync', result);
  await renderAll();
  setBusy(false);
}

async function syncLaptop() {
  setBusy(true);
  log('laptop', 'Syncing with cloud…');
  const result = await laptopDb.sync('tasks', cloud, {
    strategy: ConflictStrategy.LAST_WRITE_WINS,
    onProgress: (m) => log('laptop', m, 'info')
  });
  logResult('laptop', 'Laptop sync', result);
  await renderAll();
  setBusy(false);
}

async function editFirst(Model, actor) {
  const rows = await Model.all();
  if (rows.length === 0) { log(actor, 'No tasks to edit.'); return; }
  const task = rows[0];
  await task.update({ title: `${task.title} (edited on ${actor})` });
  log(actor, `Edited "${task.id}" → version ${task._version}. Sync to propagate.`);
  await renderAll();
}

async function deleteFirst(Model, actor) {
  const rows = await Model.all();
  if (rows.length === 0) { log(actor, 'No tasks to delete.'); return; }
  const task = rows[0];
  await task.destroy();
  log(actor, `Soft-deleted "${task.id}". Sync to propagate the tombstone.`);
  await renderAll();
}

async function addLaptopTask() {
  const n = (await LaptopTask.all()).length + 1;
  await LaptopTask.create({ title: `Laptop-only task #${n}`, status: 'pending' });
  log('laptop', 'Added a laptop-only task. Sync to push it to the cloud.');
  await renderAll();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const SAMPLE = 6;

function renderList(listEl, moreEl, rows, total) {
  listEl.innerHTML = '';
  rows.slice(0, SAMPLE).forEach((r) => {
    const li = document.createElement('li');
    if (r._deletedAt) li.classList.add('deleted');
    const title = document.createElement('span');
    title.textContent = r.title;
    const v = document.createElement('span');
    v.className = 'vtag';
    v.textContent = `v${r._version ?? 1}`;
    li.append(title, v);
    listEl.appendChild(li);
  });
  moreEl.textContent = total > SAMPLE ? `… and ${(total - SAMPLE).toLocaleString()} more` : '';
}

async function renderAll() {
  // Phone
  const phoneRows = await PhoneTask.withDeleted();
  document.getElementById('mobileCount').textContent = phoneRows.filter(r => !r._deletedAt).length.toLocaleString();
  renderList(document.getElementById('mobileList'), document.getElementById('mobileMore'), phoneRows, phoneRows.length);

  // Laptop
  const laptopRows = await LaptopTask.withDeleted();
  document.getElementById('laptopCount').textContent = laptopRows.filter(r => !r._deletedAt).length.toLocaleString();
  renderList(document.getElementById('laptopList'), document.getElementById('laptopMore'), laptopRows, laptopRows.length);

  // Cloud
  const cloudRows = cloud.list();
  document.getElementById('cloudCount').textContent = cloudRows.length.toLocaleString();
  renderList(document.getElementById('cloudList'), document.getElementById('cloudMore'), cloudRows, cloudRows.length);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const buttons = [
  'seedBtn', 'syncMobileBtn', 'syncLaptopBtn', 'resetBtn',
  'mobileEditBtn', 'mobileDeleteBtn', 'laptopAddBtn', 'laptopEditBtn', 'cloudPeekBtn'
];

function setBusy(busy) {
  buttons.forEach((id) => { document.getElementById(id).disabled = busy; });
}

document.getElementById('seedBtn').addEventListener('click', seedPhone);
document.getElementById('syncMobileBtn').addEventListener('click', syncPhone);
document.getElementById('syncLaptopBtn').addEventListener('click', syncLaptop);
document.getElementById('resetBtn').addEventListener('click', resetDemo);
document.getElementById('mobileEditBtn').addEventListener('click', () => editFirst(PhoneTask, 'mobile'));
document.getElementById('mobileDeleteBtn').addEventListener('click', () => deleteFirst(PhoneTask, 'mobile'));
document.getElementById('laptopAddBtn').addEventListener('click', addLaptopTask);
document.getElementById('laptopEditBtn').addEventListener('click', () => editFirst(LaptopTask, 'laptop'));
document.getElementById('cloudPeekBtn').addEventListener('click', renderAll);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  log('info', 'Booting multi-device sync demo…');
  await cloud.connect();
  await resetDemo();
})();
