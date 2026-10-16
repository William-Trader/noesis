import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { walk, parseDoc } from "../src/corpus.mjs";
import { buildIndex } from "../src/index.mjs";
import { startServer } from "../src/server.mjs";

function vault() {
  const root = mkdtempSync(join(tmpdir(), "noesis-srv-"));
  mkdirSync(join(root, "04-项目-projects", "alpha"), { recursive: true });
  mkdirSync(join(root, "03-知识库-knowledge"), { recursive: true });
  writeFileSync(join(root, "03-知识库-knowledge", "bm25.md"), "---\ntitle: BM25 排序\ntags: [search, 算法]\n---\n\n# BM25\n\n经典排序函数，中文分词配合使用。\n");
  writeFileSync(join(root, "04-项目-projects", "alpha", "readme.md"), "# Alpha\n\n项目说明：检索排序 ok。\n");
  const cfg = loadConfig(root);
  const entries = walk(cfg.root, cfg).map((f) => { const d = parseDoc(f, cfg.root, cfg); return { doc: d, tokens: d.tokens }; });
  return { root, cfg, idx: buildIndex(entries, cfg) };
}

function listen(server) {
  return new Promise((r) => server.on("listening", () => r(server.address().port)));
}

test("server serves the UI and the JSON APIs over a random port", async () => {
  const { cfg, idx } = vault();
  const s = startServer(idx, cfg, { port: 0 });
  const port = await listen(s.server);
  const base = "http://127.0.0.1:" + port;
  try {
    const page = await (await fetch(base + "/")).text();
    assert.match(page, /Noesis/);
    assert.match(page, /api\/search/);

    const sr = await (await fetch(base + "/api/search?q=" + encodeURIComponent("排序"))).json();
    assert.ok(sr.total >= 1);
    assert.ok(typeof sr.ms === "number");
    assert.ok(sr.hits.some((h) => h.path.includes("bm25.md")));
    assert.ok(sr.hits[0].snippet && sr.hits[0].snippet.length > 0);

    const st = await (await fetch(base + "/api/stats")).json();
    assert.equal(st.documents, 2);
    assert.ok(st.indexBytesHuman);

    const fa = await (await fetch(base + "/api/facets")).json();
    assert.ok(fa.dirs.some((d) => d.name === "03-知识库-knowledge"));
    assert.ok(fa.tags.some((t) => t.name === "算法"));

    const doc = await (await fetch(base + "/api/doc?path=" + encodeURIComponent("03-知识库-knowledge/bm25.md"))).json();
    assert.match(doc.text, /经典排序函数/);
    assert.equal(doc.title, "BM25 排序");

    const miss = await fetch(base + "/api/doc?path=nope.md");
    assert.equal(miss.status, 404);

    const h = await (await fetch(base + "/api/health")).json();
    assert.equal(h.ok, true);
  } finally { s.server.close(); }
});

test("server reuses one searcher across requests (hot path)", async () => {
  const { cfg, idx } = vault();
  const s = startServer(idx, cfg, { port: 0 });
  const port = await listen(s.server);
  const base = "http://127.0.0.1:" + port;
  try {
    const a = await (await fetch(base + "/api/search?q=" + encodeURIComponent("检索"))).json();
    const b = await (await fetch(base + "/api/search?q=" + encodeURIComponent("中文分词"))).json();
    assert.ok(a.total >= 1 && b.total >= 1);
    assert.equal(typeof a.ms, "number");
  } finally { s.server.close(); }
});
