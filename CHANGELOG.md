# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.6.1] - 2026-10-23

A small update: version awareness, plus the fixes from a full-project pass.

### Added
- **`noesis update [--force]`** — compares the local version with the latest GitHub release. The answer is cached in `.noesis/update.json` for six hours; an offline check degrades to the cached value (or a friendly error) and never fails the command. `NOESIS_UPDATE_URL` overrides the endpoint for testing/mirrors.
- **`noesis_update_check`** MCP tool, **`/api/version`** endpoint, and a UI chip when a newer release exists.
- `version` now reads `package.json` instead of a hand-maintained constant, so it cannot drift again.

### Fixed
- **Empty vault:** `build` on zero files wrote no manifest, so the next `search` claimed "no index". It now records an empty build, and searching an empty vault returns "无结果" with exit 0.
- **Missing directory:** `onboard` and `tidy` crashed with a stack trace; both now exit 2 with a plain message.
- **sync:** hashing is capped at 64 MB (size+mtime fallback above that), `.DS_Store` files are skipped, and pointing `--from` at the library itself is a no-op instead of pointless work.
- `/api/stats` byte calculation simplified; graph backlink insertion no longer relies on a comma expression; unused imports removed.

### Verified
- `node --test`: **47 tests, 0 failures**.
- `noesis update --json` against the live repository returns the released tag.

## [0.6.0] - 2026-10-23

### Added
- **`tidy` — one-click organise for beginners.** `noesis tidy <vault>` prints a plan (what moves where, and why) and changes nothing; `--yes` applies it, regenerates `INDEX.md` and can rebuild the index. Every pass is reversible through its mapping table.
- **`sync` — carry the library away and bring the edits home.** `noesis sync <vault> --from <copy> [--dry]` compares a portable copy with the live library and copies back only newer/added files. Anything it overwrites is first archived under `05-归档-archive/_sync-backup-<time>/`, and the mapping table makes the overwrite reversible. Nothing is deleted.
- **`undo`** — reverse one tidy/sync pass by its `op_id`.
- **`onboard`** — first-contact wizard: structure, stray entries, index freshness, candidate drives, plus a copy-paste paragraph to hand to any agent.
- **Agent handover kit:** [docs/HANDOVER.md](docs/HANDOVER.md) (the contract an agent follows), [docs/QUICKSTART-小白.md](docs/QUICKSTART-小白.md) (three sentences a non-technical user can paste), and [skills/noesis-library/SKILL.md](skills/noesis-library/SKILL.md) (the skill, shipped with the repo so it travels with the library).
- **MCP:** `noesis_tidy` (plan by default, `apply: true` to execute) and `noesis_sync` (dry run by default). Eleven tools total.

### Changed
- `library pack` remains the carry mechanism; `sync` is its return path, so the round trip is now complete in both directions.

### Safety
- `tidy`/`sync` never delete, never overwrite a destination silently, refuse paths outside the library root, cap a pass at 200 moves, and write the mapping table **before** touching the filesystem.

## [0.5.0] - 2026-10-23

### Added
- **Segment index (format `NOESIS02`)** — a build no longer rewrites the vault. It appends one segment with the documents that changed; queries merge segments (later wins) and compaction folds them back when it pays off. `manifest.json` is now v2: `{segments, docs, tombstones}`.
- **`--as-of <time>`** — time-travel search. Segments carry their build time, so `search --as-of 2026-10-01` answers from the state of the library on that day.
- **Passage index** — notes at or above `passageMinDocChars` (default 20 KB) are split on headings into passage rows that carry a parent pointer, a heading path and byte offsets. Ranking uses the best passage to boost its document, and the snippet is sliced from that section: results can answer "which section", not just "which file".
- **Graph authority** — `linkAuthority()` (PageRank, 20 iterations) feeds the ranking as `score × (1 + authorityBoost × authority)`; `relatedDocs()` (personalized PageRank) powers `noesis related` and `/api/related`.
- **MCP server** — `noesis mcp <dir>` speaks stdio JSON-RPC 2.0 with nine tools: `noesis_search`, `noesis_read`, `noesis_related`, `noesis_stats`, `noesis_library_check`, `noesis_library_log`, and the transactional trio `noesis_organize_plan` / `noesis_apply_moves` / `noesis_undo`.
- **Transactional library mutations** (`src/organize.mjs`) — a plan is always a dry run; applying writes the mapping table *before* touching the filesystem, refuses traversal and overwrites, never deletes, and returns an `op_id` that `undo` reverses. Capped at 200 moves per pass.
- Search responses now carry `as_of`, `drift`, `returned` and per-hit `section`.
- UI: freshness chip (index age + pending files), section chips on hits, token-aware requests.

### Changed
- The server binds **127.0.0.1 by default**; `--host 0.0.0.0` is explicit and `--token` / `NOESIS_TOKEN` guards every API route (health stays open). The UI injects the token for its own fetches.
- `build` reports segments, reused, parsed and removed counts instead of a single index size.
- `stats` reports documents, passages, segments, `as_of` and `drift`.

### Fixed
- **`total` was clipped by `limit`** — it is now counted before slicing, and `returned` is reported separately.
- **Quoted phrases were parsed but never enforced** — `"alpha beta"` returned documents where the words were far apart. Phrases are now verified literally against the file (whitespace-normalised), with a 2,000-candidate ceiling reported as `phraseTruncated`.
- **Markdown preview accepted `javascript:` links** — hrefs are now restricted to http(s), mailto, anchors and relative paths.

### Performance (measured on a real 1,210-note vault, Apple Silicon / Node 24)
- Full build (all rows + passages): **1.23 s**. Edit one note: **64 ms** (previously 630 ms on the same vault, because every edit rewrote the whole index).
- Index: **3.85 MB** for 1,210 documents / 4,001 passages (document-level baseline 2.92 MB, so passages cost +32%).
- `node --test`: **37 tests, 0 failures**.

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
