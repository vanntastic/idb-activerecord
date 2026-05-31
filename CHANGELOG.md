# Changelog

## [1.2.3](https://github.com/vanntastic/idb-activerecord/compare/v1.2.2...v1.2.3) (2026-05-31)


### Bug Fixes

* add HTTP mode table name validation tests for the codeql security issue ([a6f3bbf](https://github.com/vanntastic/idb-activerecord/commit/a6f3bbfc315b74b5169b054e9948982159fe946a))

## [1.2.2](https://github.com/vanntastic/idb-activerecord/compare/v1.2.1...v1.2.2) (2026-05-31)


### Bug Fixes

* simplify release workflow and update CDN links to use semver range ([c0ee7ca](https://github.com/vanntastic/idb-activerecord/commit/c0ee7ca90ba3af21bee5a044709aeddebe308143))

## [1.2.1](https://github.com/vanntastic/idb-activerecord/compare/v1.2.0...v1.2.1) (2026-05-27)


### Documentation

* update CDN version reference to 1.2.0 ([9296d12](https://github.com/vanntastic/idb-activerecord/commit/9296d128216897f6238394525fa777ffe18ab347))

## [1.2.0](https://github.com/vanntastic/idb-activerecord/compare/v1.1.0...v1.2.0) (2026-05-26)


### Features

* extract adapters into separate imports - release-as: minor ([1a199c0](https://github.com/vanntastic/idb-activerecord/commit/1a199c00b74e6d966b4a9418e58a3c477ee4a75f))

## [1.1.0](https://github.com/vanntastic/idb-activerecord/compare/v1.0.2...v1.1.0) (2026-05-24)


### Features

* add automatic sync with debouncing and periodic polling ([13b5261](https://github.com/vanntastic/idb-activerecord/commit/13b5261d70bbde4c5a75dae4f9611aace6c3c681))
* add client-side schema derivation for automatic remote table creation ([08c1127](https://github.com/vanntastic/idb-activerecord/commit/08c112716167bb543c5d43e97fe73bf974f1d125))
* add HTTP mode to TursoAdapter for client-side usage via proxy server ([947ce11](https://github.com/vanntastic/idb-activerecord/commit/947ce11c4d2d1d7d3f735ee5020052b210d83e40))
* add multi-model sync support with Notes and Labels in rest-sync example ([3e994d4](https://github.com/vanntastic/idb-activerecord/commit/3e994d432b35a51cc2439aa587c6c03685fdca1f))
* add multi-user syncing algorithm ([6a7532c](https://github.com/vanntastic/idb-activerecord/commit/6a7532c26e0dfc5b86e92b98c27b31ad212f7914))
* add security reminder to AGENTS.md about never committing secrets ([c9fe0d2](https://github.com/vanntastic/idb-activerecord/commit/c9fe0d24e148d366ef44890629174dab9ab853f8))
* add sync adapter API with REST adapter implementation ([1aeb571](https://github.com/vanntastic/idb-activerecord/commit/1aeb5717efc33da511d7fcd889ae8e182fc292ed))
* add SyncServer module for ready-to-use HTTP server with sync adapters ([f7fd853](https://github.com/vanntastic/idb-activerecord/commit/f7fd8533404e550d5bd8f3611c688fea3326d6b0))
* add table option to push operations for explicit table targeting ([c365c3b](https://github.com/vanntastic/idb-activerecord/commit/c365c3bad30fc64b7dc47b22e3ff0b15cc58050a))
* add Turso sync example demonstrating TursoAdapter with real libSQL database ([93684a4](https://github.com/vanntastic/idb-activerecord/commit/93684a43b75c6c835ac10018b1e062953ff57cf0))
* add TursoAdapter for direct SQLite/libSQL database sync ([1fa5759](https://github.com/vanntastic/idb-activerecord/commit/1fa575986be08a78bedbe83217ed4cbe3a8c2175))
* add user-scoped sync filtering and model instance hydration ([93f2214](https://github.com/vanntastic/idb-activerecord/commit/93f22140947877aaac0af891db9b7015e87891ab))
* defer auto-sync to idle callback to avoid blocking UI rendering ([27fff55](https://github.com/vanntastic/idb-activerecord/commit/27fff5573f475a17bcfca99692fd6b61536f604e))
* enhance schema endpoint to alter existing tables and add missing columns ([4b3a79f](https://github.com/vanntastic/idb-activerecord/commit/4b3a79f1b55e9b0af926589b5655acee43f23b6f))
* move libsql client shimming into TursoAdapter for cleaner API ([b792ef6](https://github.com/vanntastic/idb-activerecord/commit/b792ef63e81c54ec4d0517942b7842c6291445e4))
* replace mock REST API with real SQLite-backed server in rest-sync example ([fb4e3e0](https://github.com/vanntastic/idb-activerecord/commit/fb4e3e02da98d49863e785d54550095134ee6fed))
* simplify multi-user sync API and auto-manage database version ([6a12140](https://github.com/vanntastic/idb-activerecord/commit/6a12140e3a8165041aed02bcb8845601b7135bf5))


### Bug Fixes

* filter tasks by current user in rest-sync example ([13d7a60](https://github.com/vanntastic/idb-activerecord/commit/13d7a6051991567b60f6a259d78035085f73fe50))
* force version 2 on fresh databases to trigger onupgradeneeded during connect ([04a13ab](https://github.com/vanntastic/idb-activerecord/commit/04a13ab3a36698fad264c50a2447b40d92bd13ad))
