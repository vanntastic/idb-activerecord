#!/usr/bin/env node

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// Build CommonJS bundles for all exported entry points
await esbuild.build({
  entryPoints: {
    index: 'src/index.ts',
    agent: 'src/agent.ts',
    erd: 'src/erd.ts',
    server: 'src/server.ts',
    'sync-server': 'src/sync-server.ts',
    'adapters/turso-adapter': 'src/adapters/turso-adapter.ts',
    'adapters/sqlite-adapter': 'src/adapters/sqlite-adapter.ts',
    react: 'src/react.ts',
    'schema-export': 'src/schema-export.ts'
  },
  outdir: 'dist/cjs',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: [
    '@libsql/client',
    'react',
    'esbuild',
    'idb-activerecord',
    'idb-activerecord/*'
  ],
  sourcemap: true,
  write: true
});

// Ensure executable permissions on CLI entry point
const cliJsPath = path.resolve('dist/cli.js');
if (fs.existsSync(cliJsPath)) {
  fs.chmodSync(cliJsPath, 0o755);
}

console.log('✅ CommonJS builds & CLI permissions configured:');
console.log('   dist/cjs/*.cjs');
