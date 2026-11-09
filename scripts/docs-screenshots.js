import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const outputDirectory = resolve(root, '.docs-screenshots');
const origin = 'http://127.0.0.1:4173';
const siteBase = `${origin}/idb-activerecord/`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNpm(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npm, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function waitForServer(server, getServerError) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (getServerError()) throw getServerError();
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('Documentation preview stopped before it was ready');
    }
    try {
      const response = await fetch(siteBase);
      if (response.ok) return;
    } catch {
      // The preview server is not ready yet.
    }
    await delay(250);
  }
  throw new Error(`Documentation preview did not start at ${siteBase}`);
}

await runNpm(['run', 'docs:build']);
await mkdir(outputDirectory, { recursive: true });

let server;
let browser;
let serverError;
try {
  const vitepress = resolve(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vitepress.cmd' : 'vitepress'
  );
  server = spawn(vitepress, [
    'preview',
    'docs',
    '--host',
    '127.0.0.1',
    '--port',
    '4173',
    '--strictPort'
  ], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  server.once('error', error => {
    serverError = error;
    console.error(`Could not start VitePress preview: ${error.message}`);
  });

  await waitForServer(server, () => serverError);
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  for (const [name, path] of [
    ['home', ''],
    ['getting-started', 'guide/getting-started'],
    ['sync-overview', 'sync/overview']
  ]) {
    await page.goto(new URL(path, siteBase).href, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: resolve(outputDirectory, `${name}.png`),
      fullPage: true
    });
    console.log(`Saved ${name}.png`);
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise(resolvePromise => server.once('exit', resolvePromise)),
      delay(2_000)
    ]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}

console.log(`Documentation screenshots saved to ${outputDirectory}`);
