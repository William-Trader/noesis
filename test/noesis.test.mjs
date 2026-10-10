// Noesis · unit tests (node:test, zero dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, tokenizeUnique, isCJK } from "../src/tokenize.mjs";
import { parseFrontmatter, parseYamlLite } from "../src/frontmatter.mjs";
import { ByteWriter, ByteReader } from "../src/varint.mjs";
import { buildIndex, serializeIndex, deserializeIndex, createSearcher, docTermMaps } from "../src/index.mjs";
import { parseQuery, snippetFrom } from "../src/search.mjs";
import { buildGraph } from "../src/graph.mjs";

const CFG = { bm25: { k1: 1.2, b: 0.75 }, bigrams: true, snippetLength: 120 };

test("tokenize: mixed CJK + latin produce unigrams, bigrams and words", () => {
  const t = tokenize("中文 BM25 search");
  assert.ok(t.includes("中"));
  assert.ok(t.includes("中文"));
  assert.ok(t.includes("bm25"));
  assert.ok(t.includes("search"));
});

test("tokenize: latin short single letters are dropped, digits kept", () => {
  const t = tokenize("a 1 x9");
  assert.ok(!t.includes("a"));
  assert.ok(t.includes("1"));
  assert.ok(t.includes("x9"));
});

test("isCJK detects Han", () => {
  assert.equal(isCJK("中"), true);
  assert.equal(isCJK("A"), false);
});

test("varint: LEB128 round-trip over boundaries", () => {
  const nums = [0, 1, 127, 128, 300, 16383, 16384, 70000, 2 ** 32];
  const w = new ByteWriter();
  for (const n of nums) w.uvarint(n);
  const r = new ByteReader(w.toUint8Array());
  assert.deepEqual(nums.map(() => r.uvarint()), nums);
});

test("frontmatter: scalars, lists, numbers, booleans", () => {
  const { data, content, hasFrontmatter } = parseFrontmatter("---\ntitle: Hi\ntags: [a, b]\nn: 3\nok: true\n---\nbody here");
  assert.equal(hasFrontmatter, true);
  assert.equal(data.title, "Hi");
  assert.deepEqual(data.tags, ["a", "b"]);
  assert.equal(data.n, 3);
  assert.equal(data.ok, true);
  assert.equal(content.trim(), "body here");
});

test("frontmatter: absent block leaves content untouched", () => {
  const { data, content } = parseFrontmatter("# no fm\nbody");
  assert.deepEqual(data, {});
  assert.equal(content, "# no fm\nbody");
});

test("yaml-lite: block list form", () => {
  const d = parseYamlLite("tags:\n  - x\n  - y\nn: 2");
  assert.deepEqual(d.tags, ["x", "y"]);
  assert.equal(d.n, 2);
});

test("index: build, serialize, deserialize, BM25 search", () => {
  const docs = [
    { path: "a.md", title: "A", tags: [], tokens: tokenize("中文分词 BM25 排序") },
    { path: "b.md", title: "B", tags: [], tokens: tokenize("english bm25 ranking function") }
  ];
  const idx = buildIndex(docs.map((d) => ({ doc: d, tokens: d.tokens })), CFG);
  assert.equal(idx.N, 2);
  const buf = serializeIndex(idx, {});
  const back = deserializeIndex(buf);
  assert.equal(back.N, 2);
  const search = createSearcher(back, CFG);
  assert.equal(search("bm25").total, 2);
  assert.equal(search("分词").hits[0].doc.path, "a.md");
  assert.equal(search("nonexistentterm").total, 0);
});

test("index: docTermMaps round-trips per-doc tf (incremental path)", () => {
  const docs = [
    { path: "a.md", title: "A", tags: [], tokens: tokenize("one two two") },
    { path: "b.md", title: "B", tags: [], tokens: tokenize("two three") }
  ];
  const idx = buildIndex(docs.map((d) => ({ doc: d, tokens: d.tokens })), CFG);
  const maps = docTermMaps(idx);
  assert.equal(maps.length, 2);
  assert.equal(maps[0].get("two"), 2);
  assert.equal(maps[1].get("two"), 1);
});

test("index: rebuild from term maps equals rebuild from tokens", () => {
  const docs = [
    { path: "a.md", title: "A", tags: [], tokens: tokenize("alpha beta beta") },
    { path: "b.md", title: "B", tags: [], tokens: tokenize("beta gamma") }
  ];
  const fromTokens = buildIndex(docs.map((d) => ({ doc: { ...d }, tokens: d.tokens })), CFG);
  const maps = docTermMaps(fromTokens);
  const fromMaps = buildIndex(docs.map((d, i) => ({ doc: { ...d }, termMap: maps[i] })), CFG);
  assert.equal(fromMaps.terms.get("beta").df, 2);
  assert.equal(fromMaps.avgdl, fromTokens.avgdl);
});

test("query parser: filters and negation", () => {
  const q = parseQuery("bm25 tag:search path:notes -draft");
  assert.deepEqual(q.terms, ["bm25"]);
  assert.deepEqual(q.filters.tags, ["search"]);
  assert.deepEqual(q.filters.paths, ["notes"]);
  assert.deepEqual(q.filters.neg, ["draft"]);
});

test("snippet: strips frontmatter and windows around the term", () => {
  const text = "---\ntitle: X\ntags: [a]\n---\n\nThe BM25 ranking function matters here a lot for search quality.";
  const s = snippetFrom(text, ["bm25"], 60);
  assert.ok(!s.includes("title: X"));
  assert.ok(s.toLowerCase().includes("bm25"));
});

test("graph: resolves by title/filename and finds orphans", () => {
  const docs = [
    { path: "README.md", title: "Home", links: ["BM25"], tags: [] },
    { path: "notes/bm25.md", title: "BM25", links: ["Home"], tags: [] },
    { path: "notes/orphan.md", title: "Lonely", links: [], tags: [] }
  ];
  const g = buildGraph(docs);
  assert.equal(g.dangling.length, 0);
  assert.deepEqual(g.orphans, ["notes/orphan.md"]);
  assert.equal(g.hubs[0].backlinks, 1);
});
