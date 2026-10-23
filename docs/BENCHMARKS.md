# Benchmarks

All numbers below are **measured**, not estimated, and reproducible on your machine:

```bash
node bench/benchmark.mjs 2000
node bench/benchmark.mjs 10000
```

The benchmark generates a synthetic mixed CJK + English corpus (frontmatter + ~30–60 lines per doc), writes it to a temp dir, then measures walking/parsing, index build, serialization, deserialization and 1000 queries.

## Environment

- Apple Silicon (arm64), macOS, Node 24
- Cold cache for generation; the search loop runs 1000 queries back-to-back

## Results

| corpus | docs | terms | postings | index | ratio | parse+tokenize | build | deserialize | search (1000 q) |
|---|---|---|---|---|---|---|---|---|---|
| 7.78 MB | 2,000 | 1,135 | 605,801 | 473.9 KB | 5.95% | 199 ms (10,043 docs/s) | 406 ms | 17 ms | 417 ms (0.42 ms/q) |
| 38.90 MB | 10,000 | 1,135 | 3,035,058 | 2,289.3 KB | 5.75% | 934 ms (10,709 docs/s) | 4,703 ms | 676 ms | 7,521 ms (7.5 ms/q) |

> "build" = parse + tokenize + postings + serialize. "ratio" = compressed index bytes / raw corpus bytes. "search" = end-to-end scoring of 1000 synthetic 2-term queries.

## Reading the numbers honestly

- **Storage scales sub-linearly with corpus size** because the term dictionary is front-coded and shared across documents; the ratio actually improves slightly from 2k to 10k docs (5.95% -> 5.75%).
- **Query latency grows with posting-list length.** Two-term queries over a 10k-doc corpus average 7.5 ms because each hit's posting list is scanned in full. For the intended scale (a personal vault, hundreds to a few thousand notes) queries are sub-millisecond; the 2000-doc row shows 0.42 ms.
- **This is a single-threaded, dependency-free baseline**, not a tuned engine. The obvious improvements — a top-k heap instead of full sort, skipping low-idf terms, posting-list compression, and an on-disk non-gzip layout for mmap — are listed as future work. No comparison to any other product is claimed here; run your own.

## Segment store (0.5.0, real library)

Measured on a **real 1,210-note asset library** (Apple Silicon, Node 24), not a synthetic corpus:

| operation | before (0.4.0, full rewrite) | 0.5.0 (segments) |
|---|---|---|
| full build, all rows + passages | 950 ms (doc-only) | **1,230 ms** |
| edit one note | 630 ms | **64 ms** |
| index size | 2.92 MB | **3.85 MB** (+32% for 4,001 passages) |

The 64 ms number is the whole point: the same edit used to cost 66% of a full build because the entire index was re-serialized. Now it writes one small segment (2.4 KB in the measurement above) and leaves the rest untouched.

Costs are stated honestly: passage rows for notes ≥ 20 KB add about a third to the index; raising `passageMinDocChars` trades section precision for size, and setting `passages: false` removes the cost entirely.

## What is *not* claimed

We make no cross-project speed or feature comparisons. The README's design goals (zero dependency, one compact index, mixed-script search, incremental builds) are properties you can verify directly from the format spec and the tests in this repository.
