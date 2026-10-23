# Index format specification

Since 0.5.0 the index is a set of segments. On disk, each `.noesis/segments/seg-NNNNN.bin` is `gzip(COMPACT)` and `COMPACT` is:

```
+--------+---------+---------+---------+---------+---------------------------+
| magic  | version | docCount| termCnt | avgdl   | ...sections...            |
| 8 bytes| u32 LE  | u32 LE  | u32 LE  | f64 LE  |                           |
+--------+---------+---------+---------+---------+---------------------------+
```

- `magic` = ASCII `NOESIS02` for segments (8 bytes). `NOESIS01` files are still readable and are migrated into segment 0 on the next build.
- `version` = 2 for segments (`NOESIS01` stays version 1)
- `docCount` = N
- `termCnt` = number of distinct terms
- `avgdl` = average document length in tokens (IEEE-754 double, little-endian)

Then three length-prefixed sections, each prefixed by a `u32` byte length:

1. **meta** — UTF-8 JSON: `{ builtAt, stats }`
2. **docTable** — UTF-8 JSON array of `{ path, title, tags, date, length, bytes, mtimeMs, hash, links, headings }`
3. **termDict+postings** — `termCnt` entries, **sorted by term** (UTF-8 byte order). Each entry:

```
sharedPrefixBytes  uvarint   bytes shared with the previous term
suffixBytes        uvarint
suffix             <suffixBytes> raw bytes (UTF-8)
df                 uvarint   number of documents containing the term
postings: df times, ascending docId:
    docIdGap       uvarint   docId - previousDocId   (previous starts at -1)
    tf             uvarint   term frequency in that document
```

Reconstruction: `term = prevTermBytes[0..sharedPrefixBytes] + suffix`, decoded as UTF-8.

## Encoding primitives

- **uvarint**: LEB128, little-endian groups of 7 bits, high bit = continue.
- **u32 / f64**: little-endian, fixed width.
- All byte offsets are implicit (sequential decode); there are no back-pointers.

## Ranking

BM25 with configurable `k1` (default 1.2) and `b` (default 0.75):

```
idf(t)      = ln(1 + (N - df(t) + 0.5) / (df(t) + 0.5))
score(d,t)  = idf(t) * tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl(d) / avgdl))
score(d)    = sum over query terms of score(d,t)
```

Matches are ranked by score, ties broken by path.

## Manifest

`.noesis/manifest.json` is a small JSON document, not compressed:

```
{ "version": 1, "builtAt": <ms>, "docs": { "<path>": { "mtimeMs", "bytes", "hash", "length" } } }
```

It is the only input to incremental builds; delete it (with `index.bin`) to force a full rebuild.

## Compatibility

The format is versioned by the `magic`/`version` header. A reader that sees an unknown magic or version must refuse to load rather than guess. The index is derived from the vault, so an incompatible format is always recoverable by deleting `.noesis/` and rebuilding.

## Segments and the manifest

A build writes one new segment containing the changed rows (a document row, or a passage row). It never rewrites older segments.

`.noesis/manifest.json` (version 2):

```json
{
  "version": 2,
  "builtAt": 1792735430368,
  "segments": [{ "file": "seg-00003.bin", "builtAt": 1792735430368, "rows": 6 }],
  "docs": { "notes/a.md": { "mtimeMs": 0, "bytes": 0, "hash": "...", "length": 42, "seg": 0, "key": "doc:notes/a.md" } },
  "tombstones": [{ "path": "notes/old.md", "at": 1792735430368 }]
}
```

**Read path.** Segments are loaded newest-first; the first claim of a row key wins, so an older duplicate is dropped. A row is skipped when a tombstone for its path is at least as new as the segment that holds it. Selected segments are then merged into one posting map (`mergeIndexes`) and the BM25 searcher runs over the result.

**Row keys.** `doc:<path>` for documents, `psg:<path>#<ordinal>` for passages. Keys are what make re-indexing a single file idempotent.

**Time travel.** `--as-of <time>` keeps only segments built at or before that time and ignores tombstones recorded after it. Compaction rewrites history into one segment, so as-of queries only reach back to the oldest surviving segment.

**Compaction.** When more than 8 segments accumulate (or on `--full`), every live row is folded into one segment and the old files are removed. Tombstones are cleared at the same moment.
