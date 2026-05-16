#!/usr/bin/env node
// Runs the static file server and the REST sync API server together.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COLORS = {
  static: '\x1b[36m', // cyan
  api: '\x1b[35m',    // magenta
  reset: '\x1b[0m'
};

const procs = [
  { name: 'static', script: path.join(__dirname, 'server.js') },
  { name: 'api', script: path.join(__dirname, 'rest-sync', 'server.js') }
];

const children = procs.map(({ name, script }) => {
  const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `${COLORS[name]}[${name}]${COLORS.reset}`;

  const prefix = (stream) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) console.log(`${tag} ${line}`);
    });
  };

  prefix(child.stdout);
  prefix(child.stderr);

  child.on('exit', (code) => {
    console.log(`${tag} exited with code ${code}`);
    shutdown(code ?? 0);
  });

  return child;
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
