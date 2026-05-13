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
  activerecord.ts       # Base ActiveRecord class (CRUD, callbacks, validation, relationships)
  database.ts           # Database connection and model registration
  query-builder.ts      # Chainable query builder
  migration.ts          # Migration and TableBuilder classes
  types.ts              # Shared TypeScript interfaces (ModelConfig, ValidationRule)
  sync-adapter.ts       # SyncAdapter interface, BaseAdapter, conflict resolution
  adapters/
    rest-adapter.ts     # Generic REST API sync adapter

tests/                  # Unit tests
  activerecord.test.ts  # Validation, callbacks
  database.test.ts      # Database instantiation
  query-builder.test.ts # Query logic
  relationships.test.ts # hasOne, hasMany, belongsTo
  migration.test.ts     # TableBuilder
  transactions.test.ts  # beginTransaction
  sync-adapter.test.ts  # BaseAdapter, RestAdapter, conflict resolution
  mocks/
    indexeddb.ts        # Mock IDBDatabase/IDBTransaction for tests

scripts/
  build-cdn.js          # esbuild script that produces dist/idb-activerecord[.min].js

examples/
  index.html            # Browser demo UI
  app.js                # Demo consuming dist/index.js
  server.js             # Simple Node.js HTTP server for the demo (serves from project root)

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

## Commit Messages

All commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Common types:
- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation changes only
- `test` — adding or updating tests
- `refactor` — code change that neither fixes a bug nor adds a feature
- `chore` — build process, tooling, or dependency updates
- `perf` — performance improvement

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
5. Run `npm test -- --run` to confirm all 52+ tests pass
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
