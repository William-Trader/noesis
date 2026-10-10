# Index format specification

On disk, `.noesis/index.bin` is `gzip(COMPACT)`, where `COMPACT` is:

```
+--------+---------+---------+---------+---------+---------------------------+
| magic  | version | docCount| termCnt | avgdl   | ...sections...            |
| 8 bytes| u32 LE  | u32 LE  | u32 LE  | f64 LE  |                           |
+--------+---------+---------+---------+---------+---------------------------+
```

- `magic` = ASCII `NOESIS01` (8 bytes)
- `version` = 1
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
