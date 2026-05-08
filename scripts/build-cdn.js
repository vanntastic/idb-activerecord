#!/usr/bin/env node

import esbuild from 'esbuild';

// Build IIFE bundle for CDN (unminified)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'IDBActiveRecord',
  outfile: 'dist/idb-activerecord.js',
  sourcemap: true,
});

// Build IIFE bundle for CDN (minified)
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'IDBActiveRecord',
  minify: true,
  outfile: 'dist/idb-activerecord.min.js',
  sourcemap: true,
});

console.log('✅ CDN bundles built:');
console.log('   dist/idb-activerecord.js');
console.log('   dist/idb-activerecord.min.js');
