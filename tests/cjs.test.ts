// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

describe('CommonJS (CJS) Compatibility Smoke Tests', () => {
  beforeAll(() => {
    const cjsDir = path.resolve('dist/cjs');
    const indexCjs = path.join(cjsDir, 'index.cjs');
    if (!fs.existsSync(indexCjs)) {
      const buildScript = path.resolve('scripts/build-cjs.js');
      execFileSync(process.execPath, [buildScript], {
        stdio: 'pipe',
        env: process.env
      });
    }
  });
  it('requires main entry point (dist/cjs/index.cjs)', () => {
    const indexPath = path.resolve('dist/cjs/index.cjs');
    expect(fs.existsSync(indexPath)).toBe(true);
    const mod = require(indexPath);

    expect(typeof mod.ActiveRecord).toBe('function');
    expect(typeof mod.Database).toBe('function');
    expect(typeof mod.QueryBuilder).toBe('function');
    expect(typeof mod.Migration).toBe('function');
    expect(typeof mod.TableBuilder).toBe('function');
    expect(typeof mod.exportSchemaToSQL).toBe('function');
    expect(typeof mod.generateSqliteDDL).toBe('function');
    expect(typeof mod.singularize).toBe('function');
  });

  it('requires agent helpers (dist/cjs/agent.cjs)', () => {
    const agentPath = path.resolve('dist/cjs/agent.cjs');
    expect(fs.existsSync(agentPath)).toBe(true);
    const mod = require(agentPath);

    expect(typeof mod.AgentContext).toBe('object');
    expect(typeof mod.whyIsntThisWorking).toBe('function');
    expect(typeof mod.generateCodeFor).toBe('function');
    expect(typeof mod.explainDatabase).toBe('function');
  });

  it('requires ERD tooling (dist/cjs/erd.cjs)', () => {
    const erdPath = path.resolve('dist/cjs/erd.cjs');
    expect(fs.existsSync(erdPath)).toBe(true);
    const mod = require(erdPath);

    expect(typeof mod.generateERD).toBe('function');
    expect(typeof mod.exportToMermaid).toBe('function');
    expect(typeof mod.exportToPlantUML).toBe('function');
    expect(typeof mod.exportToSQL).toBe('function');
    expect(typeof mod.parseMermaid).toBe('function');
    expect(typeof mod.generateModels).toBe('function');
    expect(typeof mod.writeModelsToDisk).toBe('function');
  });

  it('requires server helpers (dist/cjs/server.cjs)', () => {
    const serverPath = path.resolve('dist/cjs/server.cjs');
    expect(fs.existsSync(serverPath)).toBe(true);
    const mod = require(serverPath);

    expect(typeof mod.createSyncHandler).toBe('function');
  });

  it('requires adapters (dist/cjs/adapters/turso-adapter.cjs, sqlite-adapter.cjs)', () => {
    const tursoPath = path.resolve('dist/cjs/adapters/turso-adapter.cjs');
    const sqlitePath = path.resolve('dist/cjs/adapters/sqlite-adapter.cjs');

    expect(fs.existsSync(tursoPath)).toBe(true);
    expect(fs.existsSync(sqlitePath)).toBe(true);

    const tursoMod = require(tursoPath);
    expect(typeof tursoMod.TursoAdapter).toBe('function');
    expect(typeof tursoMod.TursoStorageAdapter).toBe('function');

    const sqliteMod = require(sqlitePath);
    expect(typeof sqliteMod.SQLiteAdapter).toBe('function');
  });

  it('requires react hooks (dist/cjs/react.cjs)', () => {
    const reactPath = path.resolve('dist/cjs/react.cjs');
    expect(fs.existsSync(reactPath)).toBe(true);
    const mod = require(reactPath);

    expect(typeof mod.useLiveQuery).toBe('function');
  });

  it('requires schema-export (dist/cjs/schema-export.cjs)', () => {
    const schemaPath = path.resolve('dist/cjs/schema-export.cjs');
    expect(fs.existsSync(schemaPath)).toBe(true);
    const mod = require(schemaPath);

    expect(typeof mod.exportSchemaToSQL).toBe('function');
    expect(typeof mod.generateSqliteDDL).toBe('function');
    expect(typeof mod.exportSchemaToJSON).toBe('function');
  });
});
