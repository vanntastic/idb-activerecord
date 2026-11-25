#!/usr/bin/env node

// idb-activerecord CLI
// Commands:
//   export-schema   Export SQLite / Turso DDL or JSON schema
//   erd generate    Export ERD to Mermaid, PlantUML, or SQLite DDL
//   erd generate-models  Generate TypeScript or JavaScript ActiveRecord models from Mermaid ERD

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  exportSchemaToSQL,
  exportSchemaToJSON
} from './schema-export.js';
import {
  generateERD,
  exportToMermaid,
  exportToPlantUML,
  parseMermaid,
  writeModelsToDisk
} from './erd.js';

interface ParsedArgs {
  command: string;
  subcommand?: string;
  options: Record<string, string | boolean>;
  positionals: string[];
}

function parseCliArgs(args: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg.startsWith('--no-')) {
      const key = arg.slice(5);
      options[key] = false;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  // Alias common short flags
  if (options.i && !options.input) options.input = options.i;
  if (options.o && !options.output) options.output = options.o;
  if (options.f && !options.format) options.format = options.f;

  const command = positionals[0] || '';
  const subcommand = positionals[1] || undefined;

  return { command, subcommand, options, positionals };
}

function getCurrentDir(): string {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).url) {
      return path.dirname(fileURLToPath((import.meta as any).url));
    }
  } catch {}
  return process.cwd();
}

function getPackageVersion(): string {
  try {
    const currentDir = getCurrentDir();
    const pkgPath = path.resolve(currentDir, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '2.1.0';
    }
  } catch {}
  return '2.1.0';
}

function printHelp(): void {
  const version = getPackageVersion();
  console.log(`
idb-activerecord v${version}
ActiveRecord ORM for IndexedDB & Turso Cloud Sync

USAGE:
  idb-activerecord <command> [options]

COMMANDS:
  export-schema       Export database schema to SQLite/Turso DDL or JSON
  erd generate        Generate ERD visualization (Mermaid, PlantUML, SQLite)
  erd generate-models Scaffold ActiveRecord model classes from Mermaid ERD

OPTIONS:
  --input, -i <path>   Input file (.js, .mjs, .ts, .mmd)
  --output, -o <path>  Output file or directory (defaults to stdout)
  --format, -f <type>  Target format (sqlite, turso, json, mermaid, plantuml)
  --sync-columns       Include sync metadata columns (updatedAt, version, deleted_at, owner_id)
  --lang <ts|js>       Model scaffolding language for generate-models (default: ts)
  --sync               Enable sync flag on scaffolded models
  --validation         Include validation rules on scaffolded models (default: true)
  --version, -v        Display CLI version
  --help, -h           Show this help message

EXAMPLES:
  # Export SQLite DDL from Mermaid ERD diagram
  idb-activerecord export-schema --input schema.mmd --format sqlite

  # Export SQLite DDL with sync metadata columns from JS database
  idb-activerecord export-schema --input ./src/db.js --sync-columns --output schema.sql

  # Generate Mermaid ERD from models or database
  idb-activerecord erd generate --input ./src/db.js --format mermaid

  # Scaffold TypeScript models from Mermaid ERD into src/models
  idb-activerecord erd generate-models --input schema.mmd --output ./src/models --sync
`);
}

function extractModelsOrDb(mod: any): any {
  if (!mod) {
    throw new Error('Exported module is empty or null');
  }

  // Check default export
  const def = mod.default;
  if (def) {
    if (typeof def === 'object' && def.models instanceof Map) {
      return def;
    }
    if (Array.isArray(def)) {
      return def;
    }
    if (typeof def === 'function' && (def.tableName || def.getColumnDefs)) {
      return [def];
    }
  }

  // Check named exports: db, database, models
  const db = mod.db || mod.database;
  if (db && typeof db === 'object' && db.models instanceof Map) {
    return db;
  }

  if (mod.models) {
    return Array.isArray(mod.models) ? mod.models : Object.values(mod.models);
  }

  // Scan all exports for ActiveRecord model classes
  const models: any[] = [];
  for (const [key, val] of Object.entries(mod)) {
    if (key === 'default') continue;
    const fn = val as any;
    if (
      typeof fn === 'function' &&
      (fn.prototype?.constructor === fn || fn.tableName || fn.getColumnDefs)
    ) {
      if (fn.tableName || fn.name) {
        models.push(fn);
      }
    }
  }

  if (models.length > 0) {
    return models;
  }

  throw new Error(
    'No Database instance or ActiveRecord model classes found in module exports. Export a default Database, { db }, or model classes.'
  );
}

async function loadInput(inputPath: string): Promise<any> {
  const resolved = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.mmd' || ext === '.mermaid') {
    const content = await fs.promises.readFile(resolved, 'utf-8');
    return parseMermaid(content);
  }

  if (ext === '.ts') {
    // Attempt bundle/evaluate via esbuild
    let esbuild: any;
    try {
      esbuild = await import('esbuild');
    } catch {
      throw new Error(
        `Cannot load TypeScript file "${inputPath}" without a TS loader (e.g. tsx, ts-node) or esbuild. Please compile to JavaScript first or install esbuild.`
      );
    }

    const tempDir = os.tmpdir();
    const tempFile = path.join(
      tempDir,
      `idb-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
    );

    try {
      await esbuild.build({
        entryPoints: [resolved],
        outfile: tempFile,
        bundle: true,
        platform: 'node',
        format: 'esm',
        external: [
          'idb-activerecord',
          'idb-activerecord/*',
          '@libsql/client',
          'react',
          'node:*'
        ]
      });
      const mod = await import(pathToFileURL(tempFile).href);
      return extractModelsOrDb(mod);
    } finally {
      try {
        await fs.promises.unlink(tempFile);
      } catch {}
    }
  }

  // Standard .js or .mjs file
  const mod = await import(pathToFileURL(resolved).href);
  return extractModelsOrDb(mod);
}

function writeOutput(content: string, outputPath?: string | boolean): void {
  if (typeof outputPath === 'string' && outputPath.length > 0) {
    const resolved = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    console.log(`✅ Output written to ${outputPath}`);
  } else {
    process.stdout.write(content);
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, subcommand, options } = parseCliArgs(argv);

  if (options.version || command === '--version' || command === '-v') {
    console.log(`idb-activerecord v${getPackageVersion()}`);
    return;
  }

  if (options.help || command === '--help' || command === '-h' || (!command && !subcommand)) {
    printHelp();
    return;
  }

  try {
    if (command === 'export-schema') {
      const inputPath = typeof options.input === 'string' ? options.input : undefined;
      if (!inputPath) {
        throw new Error(
          'Missing required argument: --input <file> (.js, .mjs, .ts, or .mmd)'
        );
      }

      const syncColumns = Boolean(options['sync-columns'] || options.syncColumns);
      const format = String(options.format || 'sqlite').toLowerCase();
      const loaded = await loadInput(inputPath);

      let output: string;
      if (format === 'json') {
        output = exportSchemaToJSON(loaded, { syncColumns });
      } else {
        output = exportSchemaToSQL(loaded, {
          syncColumns,
          format: format === 'turso' ? 'turso' : 'sqlite'
        });
      }

      writeOutput(output, options.output);
      return;
    }

    if (command === 'erd') {
      if (subcommand === 'generate') {
        const inputPath = typeof options.input === 'string' ? options.input : undefined;
        if (!inputPath) {
          throw new Error('Missing required argument: --input <file>');
        }

        const format = String(options.format || 'mermaid').toLowerCase();
        const loaded = await loadInput(inputPath);

        // If loaded is already ERDDocument, use it; otherwise generate ERD
        const erd =
          typeof loaded === 'object' && loaded !== null && 'entities' in loaded
            ? loaded
            : generateERD(loaded);

        let output: string;
        if (format === 'plantuml') {
          output = exportToPlantUML(erd);
        } else if (format === 'sqlite' || format === 'turso') {
          output = exportSchemaToSQL(erd, {
            syncColumns: Boolean(options['sync-columns'] || options.syncColumns)
          });
        } else {
          output = exportToMermaid(erd);
        }

        writeOutput(output, options.output);
        return;
      }

      if (subcommand === 'generate-models') {
        const inputPath = typeof options.input === 'string' ? options.input : undefined;
        if (!inputPath) {
          throw new Error('Missing required argument: --input <file.mmd>');
        }

        const outputDir = typeof options.output === 'string' ? options.output : undefined;
        if (!outputDir) {
          throw new Error('Missing required argument: --output <dir>');
        }

        const lang = String(options.lang || 'ts').toLowerCase() === 'js' ? 'javascript' : 'typescript';
        const includeSync = Boolean(options.sync);
        const includeValidation = options.validation !== false;

        const resolvedInput = path.resolve(process.cwd(), inputPath);
        if (!fs.existsSync(resolvedInput)) {
          throw new Error(`ERD input file not found: ${resolvedInput}`);
        }

        const content = await fs.promises.readFile(resolvedInput, 'utf-8');
        const erd = parseMermaid(content);

        const writtenFiles = await writeModelsToDisk(erd, {
          outputDir,
          language: lang,
          includeSync,
          includeValidation
        });

        console.log(`✅ Generated ${writtenFiles.length} model(s) in ${outputDir}:`);
        for (const file of writtenFiles) {
          console.log(`   - ${path.relative(process.cwd(), file)}`);
        }
        return;
      }

      throw new Error(`Unknown erd subcommand: "${subcommand}". Use "generate" or "generate-models".`);
    }

    throw new Error(`Unknown command: "${command}". Run "idb-activerecord --help" for usage.`);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message || String(err)}`);
    process.exitCode = 1;
  }
}

// Direct CLI invocation
function isDirectRun(): boolean {
  if (!process.argv || !process.argv[1]) return false;
  const scriptPath = path.resolve(process.argv[1]);
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).url) {
      return fileURLToPath((import.meta as any).url) === scriptPath;
    }
  } catch {}
  return false;
}

if (isDirectRun()) {
  runCli();
}
