# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-10-16

### Added
- **Portable library** (`src/portable.mjs`, `docs/PORTABLE.md`): the library can be carried away, handed over, restored and audited as a whole — the point is being pleasant to live with, not showing off.
- `library volumes` — candidate drives with free space, so the **first contact asks the user which drive the library should live on** instead of guessing.
- `library home [--set D] [--move]` — show/record the library location (`_库位置.json`); `--move` runs rsync and never deletes the source folder.
- `library manual` — generates a bilingual `说明书.md` in the library root (templates: `src/manual.zh.md`, `src/manual.en.md`).
- `library pack` — handover bundle that excludes rebuildable weight (`.noesis`, `node_modules`, `venv`, ...).
- `library undo <csv> [--dry]` — reverses a reorganisation pass from its mapping table; never overwrites an existing file.
- `library log [--tail N] [--add "op:detail"]` — append-only trail `_库志.jsonl`; `home` / `manual` / `pack` / `undo` write to it automatically.
- **Bilingual UI** — one-click ZH/EN switch in the local search UI (persisted), plus shareable `?q=` links.
- Library roots may now hold `说明书.md`, `_库位置.json`, `_库志.jsonl` and `_*.command` launchers next to `_*.csv` records.

### Changed
- `library check` accepts the new library-level files (no false "stray entry" reports); volume display normalises the macOS data volume to the boot volume.

## [0.3.0] - 2026-10-16

### Added
- **`ui` command** — one command to build, serve and open the browser; the file watcher re-indexes on change.
- **Keyboard-first local UI** (`src/ui.html`, still zero dependencies): instant as-you-type search (debounced, stale requests aborted), CJK + Latin highlighting, directory/tag facets, rendered-Markdown preview pane, dark/light themes, mobile-aware layout.
- **Hot server**: index and searcher stay resident, note text cached by mtime; `runSearch` accepts a prebuilt searcher instead of rebuilding it per request.
- New API: `/api/facets`, `/api/doc?path=`, `/api/health`; `/api/search` now reports its own `ms`.

### Changed
- `serve` is the hot/cached server behind the new UI; `library open` is an alias for `ui`.
- The default exclude list also skips `venv`, `site-packages`, `homebrew`, `.cellar`, `Library`.

### Performance (measured on a 1,042-note vault)
- Full build **641 ms** · index **2.8 MB** / 191,547 terms · server-side search **~1 ms** · 50 sequential queries **0.31 s**.

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
