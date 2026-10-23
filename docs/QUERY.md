# Query syntax

Noesis queries are a small, dependency-free language. Bare words are full-text terms; the rest are filters. Terms may be Chinese, English, or mixed.

## Terms

```
记账                 单条中文词（自动单字 + 二元组切分）
bm25 ranking         空格分隔的多个词（AND 语义：包含全部词项者得分）
```

Ranking is BM25; documents containing more of the query terms usually rank higher (no hard AND filter — match-all-then-rank).

## Filters

| Syntax | Meaning |
|---|---|
| `tag:search` | keep docs whose frontmatter `tags` include `search` (case-insensitive) |
| `path:notes/` | keep docs whose path contains `notes/` |
| `-draft` | drop docs whose path/title/tags contain `draft` |
| `"exact phrase"` | match the phrase literally (tokenised the same way) |

Filters combine with AND. Available in the CLI and the `/api/search` endpoint.

A quoted phrase is **verified literally** after ranking: candidates are filtered by a whitespace-normalised substring check against the file, so `"alpha beta"` will not match a document where the two words are a sentence apart. Verification is capped at 2,000 candidates; past that the response reports `phraseTruncated: true`.

## Examples

```bash
# notes tagged search that mention bm25
node bin/noesis.mjs search my-vault tag:search bm25

# anything about 分词 under notes/, excluding drafts
node bin/noesis.mjs search my-vault 分词 path:notes -draft

# machine-readable, 20 hits
node bin/noesis.mjs search my-vault 本地优先 --json --limit 20
```

## Snippets

CLI search reads the matched files and returns a window around the first query-term hit, with the frontmatter stripped. Use `--json` for structured output.

## Server API

```
GET /api/search?q=<query>&limit=10   -> { query, total, returned, ms, as_of, drift,
                                          hits:[{path,title,tags,section,score,snippet}] }
GET /api/related?path=<note>&limit=10 -> { path, related:[{path,title,score}] }
GET /api/stats                       -> documents, passages, segments, as_of, drift
GET /api/facets                      -> top directories and tags
GET /api/doc?path=<relative-path>    -> raw file text
GET /api/health                      -> { ok, docs, rebuilds }   (never requires a token)
```

`total` is counted before `limit` is applied; `returned` is the size of the page. `as_of` is the index build time and `drift` the number of files changed since then — a stale answer is visible, not silent.

When `--token` (or `NOESIS_TOKEN`) is set, every route except `/api/health` requires `?token=…` or `Authorization: Bearer …`. Without it the server binds `127.0.0.1` and is not reachable from the LAN.
