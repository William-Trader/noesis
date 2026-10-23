// Contract tests for the v0.5 engine: segments, passages, phrases, authority, MCP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/noesis.mjs", import.meta.url));

function vault(files) {
  const root = mkdtempSync(join(tmpdir(), "noesis-engine-"));
  for (const [name, body] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root, args) {
  return execFileSync(process.execPath, [BIN, ...args, root], { encoding: "utf8" });
}

function search(root, q, extra) {
  const out = execFileSync(process.execPath, [BIN, "search", root, q, "--json"].concat(extra || []), { encoding: "utf8" });
  return JSON.parse(out);
}

function manifest(root) {
  return JSON.parse(readFileSync(join(root, ".noesis", "manifest.json"), "utf8"));
}

test("segments: an edit appends one segment instead of rewriting the vault", () => {
  const root = vault({
    "a.md": "---\ntitle: A\n---\n\n# A\n\nalpha body\n",
    "b.md": "---\ntitle: B\n---\n\n# B\n\nbeta body\n"
  });
  run(root, ["build"]);
  const m1 = manifest(root);
  assert.equal(m1.version, 2);
  assert.equal(m1.segments.length, 1);

  appendFileSync(join(root, "a.md"), "\ngamma added later\n");
  run(root, ["build"]);
  const m2 = manifest(root);
  assert.equal(m2.segments.length, 2, "changed file must append a segment");
  assert.equal(Object.keys(m2.docs).length, 2);

  const hit = search(root, "gamma");
  assert.equal(hit.total, 1);
  assert.equal(hit.hits[0].path, "a.md");
});

test("segments: removed notes disappear from results", () => {
  const root = vault({
    "keep.md": "# Keep\n\nkeepword here\n",
    "drop.md": "# Drop\n\ndropword here\n"
  });
  run(root, ["build"]);
  assert.equal(search(root, "dropword").total, 1);
  execFileSync("rm", [join(root, "drop.md")]);
  run(root, ["build"]);
  assert.equal(search(root, "dropword").total, 0);
  assert.equal(search(root, "keepword").total, 1);
});

test("as-of: time-travel search reads the state before the edit", () => {
  const root = vault({ "n.md": "# N\n\noldtoken only\n" });
  run(root, ["build"]);
  const t1 = Date.now();
  execFileSync("sleep", ["0.02"]);
  writeFileSync(join(root, "n.md"), "# N\n\nnewtoken only\n");
  run(root, ["build"]);

  assert.equal(search(root, "newtoken").total, 1);
  const past = search(root, "newtoken", ["--as-of", String(t1)]);
  assert.equal(past.total, 0, "the new text did not exist before t1");
  assert.equal(search(root, "oldtoken").total, 0);
  assert.equal(search(root, "oldtoken", ["--as-of", String(t1)]).total, 1);
});

test("passages: a long note returns the matching section, not just the file", () => {
  const filler = new Array(300).fill("filler line for length and nothing else").join("\n");
  const body = [
    "# Guide",
    "",
    "## Install",
    "",
    filler,
    "",
    "## Deploy",
    "",
    filler,
    "",
    "deploy stuff here with keyword omega.",
    "",
    "## Appendix",
    "",
    filler
  ].join("\n");
  const root = vault({ "long.md": body });
  assert.ok(body.length > 20000, "fixture must cross passageMinDocChars");
  run(root, ["build"]);
  const hit = search(root, "omega");
  assert.equal(hit.total, 1);
  assert.equal(hit.hits[0].section, "Guide > Deploy");
  assert.ok(hit.hits[0].snippet.includes("omega"));
});

test("total is counted before the limit and phrases are literal", () => {
  const root = vault({
    "a.md": "# A\n\nalpha beta together\n",
    "b.md": "# B\n\nalpha something entirely different beta\n"
  });
  run(root, ["build"]);

  const one = search(root, "alpha", ["--limit", "1"]);
  assert.equal(one.total, 2, "total must not be clipped by limit");
  assert.equal(one.returned, 1);

  const phrase = search(root, "\"alpha beta\"");
  assert.equal(phrase.total, 1, "phrase must match literal adjacency");
  assert.equal(phrase.hits[0].path, "a.md");
});

test("graph: authority is normalised and prefers the linked-to note", async () => {
  const { linkAuthority, relatedDocs } = await import("../src/graph.mjs");
  const docs = [
    { path: "hub.md", title: "Hub", kind: "doc", links: ["Leaf", "Other"] },
    { path: "leaf.md", title: "Leaf", kind: "doc", links: [] },
    { path: "other.md", title: "Other", kind: "doc", links: ["Leaf"] },
    { path: "psg", title: "x", kind: "passage", parent: "hub.md", links: [] }
  ];
  const a = linkAuthority(docs);
  assert.equal(a.length, 4);
  assert.equal(a[3], 0, "passages never carry authority");
  const leaf = a[1];
  assert.ok(leaf > a[3] && leaf <= 1);
  assert.ok(leaf > a[0], "linked-to note outranks the hub");
  const rel = relatedDocs(docs, "hub.md", { limit: 2 });
  assert.ok(rel.some((r) => r.path === "leaf.md"));
});

test("server: token guards the API but leaves health open", async () => {
  const { startServer } = await import("../src/server.mjs");
  const { loadConfig } = await import("../src/config.mjs");
  const { walk, parseDoc } = await import("../src/corpus.mjs");
  const { buildIndex } = await import("../src/index.mjs");

  const root = vault({ "s.md": "# S\n\nsecretword\n" });
  const cfg = loadConfig(root);
  const entries = walk(cfg.root, cfg).map((f) => { const d = parseDoc(f, cfg.root, cfg); return { doc: d, tokens: d.tokens }; });
  const idx = buildIndex(entries, cfg);
  const s = startServer(idx, cfg, { port: 0, token: "t0ken" });
  await new Promise((r) => s.server.on("listening", r));
  const base = "http://127.0.0.1:" + s.server.address().port;
  try {
    const denied = await fetch(base + "/api/search?q=secretword");
    assert.equal(denied.status, 401);
    const ok = await (await fetch(base + "/api/search?q=secretword&token=t0ken")).json();
    assert.equal(ok.total, 1);
    const h = await (await fetch(base + "/api/health")).json();
    assert.equal(h.ok, true);
  } finally { s.server.close(); }
});

test("mcp: initialize, tools/list and a search call", async () => {
  const { handleRpc } = await import("../src/mcp.mjs");
  const { loadConfig } = await import("../src/config.mjs");
  const { walk, parseDoc } = await import("../src/corpus.mjs");
  const { buildIndex } = await import("../src/index.mjs");
  const { readFileSync } = await import("node:fs");

  const root = vault({ "m.md": "# M\n\nfindme in the body\n" });
  const cfg = loadConfig(root);
  const entries = walk(cfg.root, cfg).map((f) => { const d = parseDoc(f, cfg.root, cfg); return { doc: d, tokens: d.tokens }; });
  const idx = buildIndex(entries, cfg);
  const ctx = { idx, cfg, readText: (p) => readFileSync(join(root, p), "utf8") };

  const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, ctx);
  assert.equal(init.result.serverInfo.name, "noesis");

  const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx);
  assert.ok(list.result.tools.some((t) => t.name === "noesis_search"));

  const call = await handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "noesis_search", arguments: { query: "findme" } } }, ctx);
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.total, 1);
  assert.equal(payload.hits[0].path, "m.md");
});
