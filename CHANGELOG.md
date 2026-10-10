# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

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
