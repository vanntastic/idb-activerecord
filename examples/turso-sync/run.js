#!/usr/bin/env node
// Run both the static file server and the Turso proxy server for the Turso demo.


import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

const staticServer = spawn('node', ['examples/server.js'], {
  stdio: 'inherit',
  env: { ...process.env }
});

const tursoArgs = [];
if (fs.existsSync(envPath)) {
  tursoArgs.push(`--env-file=${envPath}`);
}
tursoArgs.push(path.join(__dirname, 'server.js'));

const tursoServer = spawn('node', tursoArgs, {
  stdio: 'inherit',
  env: { ...process.env }
});

const shutdown = () => {
  staticServer.kill();
  tursoServer.kill();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

staticServer.on('exit', (code) => {
  console.log(`Static server exited with code ${code}`);
  tursoServer.kill();
  process.exit(code);
});

tursoServer.on('exit', (code) => {
  console.log(`Turso server exited with code ${code}`);
  staticServer.kill();
  process.exit(code);
});
