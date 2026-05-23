#!/usr/bin/env node
// Run both the static file server and the Turso proxy server for the Turso demo.


import { spawn } from 'node:child_process';

const staticServer = spawn('node', ['examples/server.js'], {
  stdio: 'inherit',
  env: { ...process.env }
});

const tursoServer = spawn('node', [
  '--env-file=examples/turso-sync/.env',
  'examples/turso-sync/server.js'
], {
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
