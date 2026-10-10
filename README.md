<div align="center">

# Noesis

**A zero-dependency, local-first knowledge framework.**
Compact binary index · BM25 · CJK + Latin search · incremental builds · wiki-link graph.

![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)

[中文](README.zh-CN.md) · [Architecture](docs/ARCHITECTURE.md) · [Index spec](docs/SPEC.md) · [Query syntax](docs/QUERY.md) · [Benchmarks](docs/BENCHMARKS.md)

</div>

## Why another knowledge base?

Most tools make you choose between a heavy desktop app, a cloud service, or a folder of Markdown with no search. Noesis is the third option, done properly.

- **Zero dependencies.** Plain Node ESM (`>=18`). No install step, no lockfile, no supply-chain surface. Clone and run.
- **Storage you can live with.** The whole index is one gzip-compressed binary: a front-coded term dictionary plus varint postings. Measured at **~6% of corpus size** (see [Benchmarks](docs/BENCHMARKS.md)).
- **Search that fits the text.** BM25 ranking with dictionary-free CJK tokenisation (unigram + bigram) *and* Latin words, in one index.
- **Incremental by default.** A content-hash + size + mtime manifest means unchanged notes are reused, never re-parsed.
- **A graph, not a folder.** `[[wikilinks]]` resolve by path, filename or title; get backlinks, orphans and dangling links.
- **Boring on purpose.** Plain-text Markdown + YAML frontmatter. Git-native and diffable. The index is derived data — delete it and rebuild.

## Quickstart

```bash
git clone https://github.com/William-Trader/noesis.git
cd noesis

node bin/noesis.mjs init   my-vault     # scaffold a vault
node bin/noesis.mjs build  my-vault     # build / update the index
node bin/noesis.mjs search my-vault 记账 bm25 tag:finance
node bin/noesis.mjs serve  my-vault     # http://127.0.0.1:4317
```

Try it on the bundled demo vault:

```bash
node bin/noesis.mjs build  examples/demo-vault
node bin/noesis.mjs search examples/demo-vault 分词
```

## Commands

| Command | Description |
|---|---|
| `init [dir]` | Create `kb.config.json` and a starter note |
| `build [dir] [--full]` | Build or incrementally update the index |
| `search <dir> <query>` | BM25 search (`tag:` `path:` `-exclude`, "phrases") |
| `stats [dir]` | Index statistics (`--json`) |
| `graph [dir]` | Backlinks, orphans, hubs, dangling links |
| `doctor [dir]` | Health check: broken links, missing/duplicate titles |
| `serve [dir] [--port N]` | Local search server + minimal UI |

## Notes are just Markdown

```markdown
---
title: BM25
tags: [search, 算法]
date: 2026-10-11
---

# BM25

经典排序函数，相关笔记：[[中文分词]]、[[本地优先]]。
```

- **Frontmatter** — `title`, `tags`, `date` (a tiny YAML subset, no dependency).
- **Links** — `[[wikilinks]]` and relative Markdown links feed the graph.
- **Titles** fall back to the first H1, then the filename.

## How the index works

```
.noesis/index.bin        gzip( [header][meta][docTable][termDict+postings] )
.noesis/manifest.json    per-file hash + size + mtime (incremental)
```

Terms are stored front-coded (shared-prefix compressed) and postings are varint gap-encoded, so the dictionary scales with shared prefixes rather than raw text. Full format: [docs/SPEC.md](docs/SPEC.md).

## Benchmarks

Reproducible via `node bench/benchmark.mjs [N]`. Measured on Apple Silicon / Node 24:

| corpus | docs | index size | ratio | build | search |
|---|---|---|---|---|---|
| 7.78 MB | 2,000 | 474 KB | 5.95% | 0.41 s | 0.42 ms/query |
| 38.90 MB | 10,000 | 2.29 MB | 5.75% | 4.70 s | 7.5 ms/query |

Details and caveats: [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

## Development

```bash
node --test           # unit tests (node:test, zero deps)
node bench/benchmark.mjs 5000
```

## License

**PolyForm Noncommercial License 1.0.0** — source-available, *not* OSI open-source. Non-commercial use only. See [LICENSE](LICENSE).

---

*Noesis ships as a framework. It contains no personal data and no credentials; bring your own vault.*
