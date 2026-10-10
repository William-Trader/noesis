# Architecture

Noesis is deliberately small: eight core modules, one CLI, one optional server, zero runtime dependencies.

## Module map

| Module | Responsibility |
|---|---|
| `src/varint.mjs` | LEB128 varints + growable `ByteWriter` / `ByteReader` |
| `src/tokenize.mjs` | CJK + Latin tokenizer (unigram + bigram + words) |
| `src/frontmatter.mjs` | Frontmatter splitter + a tiny YAML subset |
| `src/corpus.mjs` | Directory walk, document parsing, hashing |
| `src/index.mjs` | Inverted index build, binary (de)serialize, BM25 |
| `src/search.mjs` | Query parsing, filters, snippets |
| `src/graph.mjs` | Wiki-link resolution, backlinks, orphans, dangling |
| `src/server.mjs` | Local HTTP server (`/api/search`, `/api/stats`, minimal UI) |
| `bin/noesis.mjs` | CLI: init / build / search / stats / graph / doctor / serve |

## Data flow

```
vault/**/*.md
   |  walk()                     -> file list (respects exclude + extensions)
   v
parseDoc()                       -> { path,title,tags,links,headings,tokens,hash,mtime,bytes }
   |  (skipped when unchanged, via manifest)
   v
buildIndex(entries)              -> inverted index { N, avgdl, docs[], terms: Map }
   |
   v
serializeIndex() -> gzip -> .noesis/index.bin
                            + .noesis/manifest.json
```

At query time the CLI/server only needs `index.bin`: load -> BM25 -> rank -> (optional) read the few matched files for snippets.

## Incremental builds

`manifest.json` records `{mtimeMs, bytes, hash}` per path.

1. Walk the vault; for each file compare `mtimeMs` and `bytes` against the manifest.
2. **Unchanged** -> reuse the document row and its per-document term map, reconstructed from the previous index with `docTermMaps()`. No file read.
3. **Changed / new** -> re-parse.
4. **Removed** -> dropped.
5. Rebuild the postings from all entries and rewrite `index.bin`.

The trick that avoids storing the corpus twice: a loaded index can be inverted back into per-document term->tf maps. So a single `index.bin` is enough to drive an incremental rebuild — no separate forward-index file.

## Binary format

See [SPEC.md](SPEC.md) for the byte layout. Design choices:

- **Front-coded term dictionary.** Terms are sorted and stored as `(sharedPrefixBytes, suffixBytes, suffix)`. The dictionary scales with what terms *share*, not raw length.
- **Gap-encoded postings.** `delta(docId)` then `tf`, both varints, ascending doc ids.
- **gzip over everything.** The JSON doc table compresses well, so the wrapper pays for itself.
- **Little-endian fixed fields** for counts/offsets; varints elsewhere.

## Deliberate trade-offs

- **Tokenizer is dictionary-free.** Unigram + bigram CJK gives higher recall and needs zero data files, at the cost of a larger index than a good segmenter. For a local KB this is the right call.
- **No positions.** No phrase/proximity ranking; snippets are recovered by reading the matched file. Keeps the index compact.
- **Full posting scan per query.** Simple and cache-friendly up to tens of thousands of docs; a top-k heap is the obvious next optimisation for very large vaults (see [BENCHMARKS](BENCHMARKS.md)).
- **One process, one vault.** No daemon, no background watcher; `build` is explicit.
