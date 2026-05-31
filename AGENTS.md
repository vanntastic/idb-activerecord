# AGENTS.md

Guidelines for AI agents working in this repository.

## Project Overview

`idb-activerecord` is a TypeScript library that provides an ActiveRecord-style ORM for the browser's IndexedDB API. It is published on npm and distributed via CDN (jsDelivr).

## Stack

- **Language**: TypeScript 5.x (strict mode)
- **Runtime target**: Browser (ES2020, DOM lib)
- **Module format**: ESM (`"type": "module"`)
- **Build tool**: `tsc` for type declarations + `esbuild` for CDN bundles
- **Test framework**: Vitest 1.x with jsdom environment
- **Package manager**: npm

## Repository Structure

```
src/                    # Source files (TypeScript)
  index.ts              # Public API re-exports
  activerecord.ts       # Base ActiveRecord class (CRUD, callbacks, validation, relationships, soft delete, sync hooks)
  database.ts           # Database connection, model registration, sync stores
  query-builder.ts      # Chainable query builder (auto-filters _deletedAt records)
  migration.ts          # Migration and TableBuilder classes
  types.ts              # Shared TypeScript interfaces (ModelConfig, ValidationRule)
  sync-adapter.ts       # SyncAdapter interface, BaseAdapter, conflict resolution
  sync-engine.ts        # Multi-user SyncEngine: change tracking, merge, tombstones
  adapters/

tests/                  # Unit tests
  activerecord.test.ts  # Validation, callbacks
  database.test.ts      # Database instantiation
  query-builder.test.ts # Query logic
  relationships.test.ts # hasOne, hasMany, belongsTo
  migration.test.ts     # TableBuilder
  transactions.test.ts  # beginTransaction
  sync-adapter.test.ts  # BaseAdapter, TursoAdapter, conflict resolution
  sync-engine.test.ts   # SyncEngine push/pull/merge, version conflicts, tombstones
  mocks/
    indexeddb.ts        # Mock IDBDatabase/IDBTransaction for tests

scripts/
  build-cdn.js          # esbuild script that produces dist/idb-activerecord[.min].js

examples/
  index.html            # Landing page linking to all examples
  server.js             # Static file server (port 8080)
  run-all.js            # Runs both static + sync API servers in parallel
  basic-crud/           # Simple CRUD demo
    index.html
    app.js
    README.md
  sqlite-sync/          # Multi-user sync demo with SQLite backend
    index.html
    app.js
    server.js           # SQLite-backed REST API (port 3001, uses node:sqlite)
    README.md

.github/workflows/
  ci.yml                # Runs tests on PRs to main

dist/                   # Compiled output (not committed)
  index.js              # ESM entry point
  idb-activerecord.js   # IIFE bundle for CDN
  idb-activerecord.min.js # Minified IIFE bundle for CDN
```

## Build

```bash
npm run build          # tsc + esbuild CDN bundles
npm run build:types    # tsc only (ESM + type declarations)
npm run build:cdn      # esbuild only (IIFE bundles)
```

Output goes to `dist/`. All imports within `src/` must use `.js` extensions (required for browser ESM).

## Testing

```bash
npm test               # vitest in watch mode
npm test -- --run      # single run (used in CI)
npm run test:coverage  # with v8 coverage report
```

Tests run in a jsdom environment. IndexedDB is not available in jsdom, so tests are isolated:
- **CRUD / queries** are tested against a mock IDBDatabase in `tests/mocks/indexeddb.ts`
- **Validation, callbacks, relationships, migrations** are tested by calling methods directly without a real IDB connection

When adding new features, add corresponding unit tests. Do not delete or weaken existing tests.

## Code Conventions

- All source files live in `src/`, compiled to `dist/`
- All imports between source files **must** include `.js` extensions (e.g. `import { QueryBuilder } from './query-builder.js'`)
- TypeScript strict mode is enabled — no implicit `any`, no skipped null checks
- Static class properties are used for model configuration (`tableName`, `indexes`, `validates`, `beforeCreate`, etc.)
- Instance creation uses `Object.create(this.prototype)` rather than `new this()` to avoid generic TypeScript issues
- Do not add comments or documentation unless explicitly asked
- **Never commit secrets** - API keys, tokens, passwords, or credentials. Use environment variables and `.env.example` templates. The `.gitignore` already excludes `.env` files.
- **Before committing**, run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` and fix any reported unused variables or parameters. Do not leave unused imports or locals in committed code.

## Commit Messages

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types:
- `feat` — a new feature (**minor version bump**)
- `fix` — a bug fix (**patch version bump**)
- `perf` — performance improvement (**patch version bump**)
- `docs` — documentation changes only (no version bump)
- `test` — adding or updating tests (no version bump)
- `refactor` — code change that neither fixes a bug nor adds a feature (no version bump)
- `chore` — build process, tooling, or dependency updates (no version bump)

Examples:
```
feat: add hasOne relationship method
fix: resolve missing .js extensions in ESM imports
docs: update README with CDN quick start example
test: add unit tests for TableBuilder unique index
chore: add esbuild CDN bundle script
```

Breaking changes must include `!` after the type and a `BREAKING CHANGE:` footer:
```
feat!: rename where() shorthand signature

BREAKING CHANGE: where(field, value) now requires explicit operator as second argument
```

## Adding a New Feature

1. Implement in the appropriate `src/` file
2. Export it from `src/index.ts` if it's part of the public API
3. Add unit tests in `tests/`
4. Update `README.md` if the public API changes
5. Run `npm test -- --run` to confirm all 60+ tests pass
6. Run `npm run build` to confirm the build succeeds

## Publishing

```bash
npm run build          # always runs automatically via prepublishOnly
npm publish
```

The CDN bundle is automatically available on jsDelivr after publish:
```
https://cdn.jsdelivr.net/npm/idb-activerecord@<version>/dist/idb-activerecord.min.js
```

## CI

GitHub Actions runs `npm test -- --run` on every PR targeting `main` (`.github/workflows/ci.yml`).
