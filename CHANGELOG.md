# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-16

### Added
- **Library conventions** — the asset-library system framework, now shipped with the project: numbered top-level structure, move-only reversible reorganisation, content-level dedupe, credentials isolation, generated `INDEX.md`.
- `src/library.mjs`: `scaffoldLibrary` (create the numbered structure + `_整理规范.md` + `INDEX.md` + mapping table), `checkLibrary` (stray root entries, missing dirs, leaked credentials, archive-at-root, optional duplicate scan), `findDuplicates` (size-group first, hash only within a group, trust the hash), `renderIndex`.
- CLI: `library init` / `library check` / `library dups` / `library index` (`--json`, `--keep`, `--dups`, `--dirs-only`).
- [docs/LIBRARY.md](docs/LIBRARY.md): the full spec plus the step-by-step agent workflow, so an agent pointed at this repo organises a vault by the book.
- Unit tests for the library module.

## [0.1.0] - 2026-10-11

### Added
- Zero-dependency core: varints, tokenizer, frontmatter, corpus walker, inverted index, BM25 search, link graph.
- Compact binary index (front-coded term dictionary + varint postings), gzip-compressed.
- Incremental builds via a content-hash / size / mtime manifest.
- CJK + Latin tokenizer (unigram + bigram + words), dictionary-free.
- Wiki-link graph: backlinks, orphans, hubs, dangling-link reports.
- CLI: `init` / `build` / `search` / `stats` / `graph` / `doctor` / `serve`.
- Local server with `/api/search`, `/api/stats` and a minimal search UI.
- Unit tests (`node:test`) and a reproducible micro-benchmark.
