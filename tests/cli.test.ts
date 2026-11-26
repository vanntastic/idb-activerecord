// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runCli } from '../src/cli.js';

describe('CLI Tooling (src/cli.ts & bin/idb-activerecord)', () => {
  let tempDir: string;
  let stdoutSpy: any;
  let stderrSpy: any;
  let logSpy: any;
  let errorSpy: any;
  let capturedStdout: string[];
  let capturedStderr: string[];

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'idb-cli-test-'));
    capturedStdout = [];
    capturedStderr = [];

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((str: any) => {
      capturedStdout.push(String(str));
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((str: any) => {
      capturedStderr.push(String(str));
      return true;
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      capturedStdout.push(args.map(String).join(' ') + '\n');
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      capturedStderr.push(args.map(String).join(' ') + '\n');
    });
  });

  afterEach(async () => {
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    logSpy?.mockRestore();
    errorSpy?.mockRestore();
    process.exitCode = undefined;
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('help & version flags', () => {
    it('--version prints version', async () => {
      await runCli(['--version']);
      const output = capturedStdout.join('');
      expect(output).toContain('idb-activerecord v');
    });

    it('--help prints usage guide', async () => {
      await runCli(['--help']);
      const output = capturedStdout.join('');
      expect(output).toContain('USAGE:');
      expect(output).toContain('export-schema');
      expect(output).toContain('erd generate');
      expect(output).toContain('erd generate-models');
    });
  });

  describe('export-schema command', () => {
    it('exports SQLite DDL from Mermaid ERD input to stdout', async () => {
      const mmdFile = path.join(tempDir, 'schema.mmd');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    tasks {
        string id PK
        string title
        boolean done
    }
`,
        'utf-8'
      );

      await runCli(['export-schema', '--input', mmdFile, '--format', 'sqlite']);
      const output = capturedStdout.join('');
      expect(output).toContain('CREATE TABLE IF NOT EXISTS "tasks" (');
      expect(output).toContain('"id" TEXT PRIMARY KEY NOT NULL');
      expect(output).toContain('"title" TEXT');
      expect(output).toContain('"done" BOOLEAN');
    });

    it('exports structured JSON schema when format is json', async () => {
      const mmdFile = path.join(tempDir, 'schema.mmd');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    notes {
        string id PK
        string content
    }
`,
        'utf-8'
      );

      await runCli(['export-schema', '--input', mmdFile, '--format', 'json']);
      const output = capturedStdout.join('');
      const parsed = JSON.parse(output);
      expect(parsed.tables).toBeDefined();
      expect(parsed.tables[0].name).toBe('notes');
    });

    it('writes output to file when --output is provided', async () => {
      const mmdFile = path.join(tempDir, 'schema.mmd');
      const sqlOut = path.join(tempDir, 'schema.sql');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    items {
        string id PK
        string label
    }
`,
        'utf-8'
      );

      await runCli(['export-schema', '--input', mmdFile, '--output', sqlOut]);
      expect(fs.existsSync(sqlOut)).toBe(true);
      const content = await fs.promises.readFile(sqlOut, 'utf-8');
      expect(content).toContain('CREATE TABLE IF NOT EXISTS "items"');
    });

    it('includes sync metadata columns when --sync-columns is passed', async () => {
      const mmdFile = path.join(tempDir, 'sync-schema.mmd');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    devices {
        string id PK
        string model
    }
`,
        'utf-8'
      );

      await runCli(['export-schema', '--input', mmdFile, '--sync-columns']);
      const output = capturedStdout.join('');
      expect(output).toContain('"updatedAt" TEXT NOT NULL DEFAULT \'\'');
      expect(output).toContain('"version" INTEGER NOT NULL DEFAULT 1');
      expect(output).toContain('"deleted_at" TEXT');
      expect(output).toContain('"owner_id" TEXT DEFAULT \'demo\'');
    });
  });

  describe('erd generate command', () => {
    it('generates Mermaid ERD by default', async () => {
      const mmdFile = path.join(tempDir, 'in.mmd');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    users {
        string id PK
        string name
    }
    posts {
        string id PK
        string title
    }
    users ||--o{ posts : "userId"
`,
        'utf-8'
      );

      await runCli(['erd', 'generate', '--input', mmdFile, '--format', 'mermaid']);
      const output = capturedStdout.join('');
      expect(output).toContain('erDiagram');
      expect(output).toContain('users ||--o{ posts : "userId"');
    });

    it('generates PlantUML syntax with --format plantuml', async () => {
      const mmdFile = path.join(tempDir, 'in.mmd');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    accounts {
        string id PK
        string email UK
    }
`,
        'utf-8'
      );

      await runCli(['erd', 'generate', '--input', mmdFile, '--format', 'plantuml']);
      const output = capturedStdout.join('');
      expect(output).toContain('@startuml');
      expect(output).toContain('entity "accounts" as accounts {');
      expect(output).toContain('@enduml');
    });
  });

  describe('erd generate-models command', () => {
    it('scaffolds ActiveRecord models into destination directory', async () => {
      const mmdFile = path.join(tempDir, 'models.mmd');
      const modelsDir = path.join(tempDir, 'scaffolded-models');
      await fs.promises.writeFile(
        mmdFile,
        `
erDiagram
    customers {
        string id PK
        string name
        string email UK
    }
    orders {
        string id PK
        string customerId FK
        real total
    }
    customers ||--o{ orders : "customerId"
`,
        'utf-8'
      );

      await runCli([
        'erd',
        'generate-models',
        '--input',
        mmdFile,
        '--output',
        modelsDir,
        '--lang',
        'ts',
        '--sync'
      ]);

      expect(fs.existsSync(modelsDir)).toBe(true);
      const customerFile = path.join(modelsDir, 'customer.ts');
      const orderFile = path.join(modelsDir, 'order.ts');
      expect(fs.existsSync(customerFile)).toBe(true);
      expect(fs.existsSync(orderFile)).toBe(true);

      const customerCode = await fs.promises.readFile(customerFile, 'utf-8');
      expect(customerCode).toContain('class Customer extends ActiveRecord<Customer>');
      expect(customerCode).toContain('static enableSync = true;');
      expect(customerCode).toContain("orders: 'orders'");

      const orderCode = await fs.promises.readFile(orderFile, 'utf-8');
      expect(orderCode).toContain('class Order extends ActiveRecord<Order>');
      expect(orderCode).toContain("customer: 'customers'");
    });
  });

  describe('error handling', () => {
    it('reports error on missing input argument', async () => {
      await runCli(['export-schema']);
      expect(process.exitCode).toBe(1);
      const err = capturedStderr.join('');
      expect(err).toContain('Missing required argument: --input');
    });

    it('reports error on unknown command', async () => {
      await runCli(['unknown-command']);
      expect(process.exitCode).toBe(1);
      const err = capturedStderr.join('');
      expect(err).toContain('Unknown command');
    });
  });

  describe('Direct executable execution (smoke test)', () => {
    it('executes ./dist/cli.js --version via shell without errors', () => {
      const cliPath = path.resolve('dist/cli.js');
      if (fs.existsSync(cliPath)) {
        const out = execFileSync(cliPath, ['--version'], { encoding: 'utf-8' });
        expect(out).toContain('idb-activerecord v');
      }
    });

    it('executes ./dist/cli.js --help via shell without errors', () => {
      const cliPath = path.resolve('dist/cli.js');
      if (fs.existsSync(cliPath)) {
        const out = execFileSync(cliPath, ['--help'], { encoding: 'utf-8' });
        expect(out).toContain('USAGE:');
      }
    });
  });
});
