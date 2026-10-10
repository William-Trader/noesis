#!/usr/bin/env node
// Noesis · command line interface (zero dependencies).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { walk, parseDoc } from "../src/corpus.mjs";
import { buildIndex, serializeIndex, deserializeIndex, indexStats, docTermMaps } from "../src/index.mjs";
import { runSearch } from "../src/search.mjs";
import { buildGraph } from "../src/graph.mjs";
import { startServer } from "../src/server.mjs";

const VERSION = "0.1.0";
const C = { r: "\u001b[0m", dim: "\u001b[2m", b: "\u001b[1m", g: "\u001b[32m", y: "\u001b[33m", rd: "\u001b[31m", cy: "\u001b[36m" };

function human(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

const HELP = [
  "Noesis " + VERSION + " · 零依赖本地知识框架",
  "",
  "用法: noesis <command> [dir] [options]",
  "",
  "命令:",
  "  init [dir]              初始化知识库 (生成 kb.config.json + 示例)",
  "  build [dir] [--full]    构建/更新索引 (默认增量)",
  "  search <dir> <query>    检索 (支持 tag: / path: / -排除 / \"短语\")",
  "  stats [dir]             索引统计",
  "  graph [dir] [--orphans --dangling]  双链图",
  "  doctor [dir]            体检 (断链/缺标题/重复标题)",
  "  serve [dir] [--port N]  本地检索服务",
  "",
  "选项:",
  "  --json    机器可读输出",
  "  --limit N 结果条数 (默认 10)",
  "  --full    全量重建 (忽略增量缓存)",
  "",
  "零依赖 · 紧凑二进制索引 · BM25 · 中英混合分词 · 增量构建"
].join("\n");

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") flags.json = true;
    else if (a === "--full") flags.full = true;
    else if (a === "--orphans") flags.orphans = true;
    else if (a === "--dangling") flags.dangling = true;
    else if (a === "--limit") flags.limit = Number(argv[++i]);
    else if (a === "--port") flags.port = Number(argv[++i]);
    else if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "-v" || a === "--version") flags.version = true;
    else rest.push(a);
  }
  return { flags, rest };
}

function loadIndexOrExit(cfg) {
  const p = join(cfg.indexDir, "index.bin");
  if (!existsSync(p)) {
    console.error(C.rd + "未找到索引: " + p + C.r + "\n先运行: noesis build " + cfg.root);
    process.exit(2);
  }
  return deserializeIndex(readFileSync(p));
}

function build(root, flags) {
  const cfg = loadConfig(root);
  const indexPath = join(cfg.indexDir, "index.bin");
  const manifestPath = join(cfg.indexDir, "manifest.json");
  mkdirSync(cfg.indexDir, { recursive: true });
  const t0 = Date.now();
  const files = walk(cfg.root, cfg);
  const rels = new Set(files.map((f) => relative(cfg.root, f).split("\\").join("/")));

  let prev = null;
  let prevMaps = null;
  let manifest = null;
  if (!flags.full && existsSync(indexPath) && existsSync(manifestPath)) {
    try {
      prev = deserializeIndex(readFileSync(indexPath));
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      prevMaps = docTermMaps(prev);
    } catch (e) { prev = null; manifest = null; prevMaps = null; }
  }

  const prevByPath = new Map();
  if (prev) prev.docs.forEach((d, i) => prevByPath.set(d.path, i));

  const entries = [];
  let reused = 0;
  let parsed = 0;
  for (const f of files) {
    const rel = relative(cfg.root, f).split("\\").join("/");
    const st = statSync(f);
    const mtimeMs = Math.floor(st.mtimeMs);
    const bytes = st.size;
    const rec = manifest && manifest.docs ? manifest.docs[rel] : null;
    const pi = prevByPath.get(rel);
    if (rec && pi !== undefined && rec.mtimeMs === mtimeMs && rec.bytes === bytes && prevMaps[pi]) {
      entries.push({ doc: prev.docs[pi], termMap: prevMaps[pi] });
      reused += 1;
    } else {
      const doc = parseDoc(f, cfg.root, cfg);
      entries.push({ doc, tokens: doc.tokens });
      parsed += 1;
    }
  }

  let removed = 0;
  if (prev) prev.docs.forEach((d) => { if (!rels.has(d.path)) removed += 1; });

  const idx = buildIndex(entries, cfg);
  const stats = { files: files.length, reused, parsed, removed, ms: Date.now() - t0 };
  idx.stats = stats;
  const newManifest = { version: 1, builtAt: Date.now(), docs: {} };
  for (const ent of entries) {
    newManifest.docs[ent.doc.path] = { mtimeMs: ent.doc.mtimeMs, bytes: ent.doc.bytes, hash: ent.doc.hash, length: ent.doc.length };
  }
  const buf = serializeIndex(idx, stats);
  writeFileSync(indexPath, buf);
  writeFileSync(manifestPath, JSON.stringify(newManifest));

  const out = { root: cfg.root, indexBytes: buf.length, documents: idx.N, terms: idx.terms.size, reused, parsed, removed, ms: stats.ms };
  if (flags.json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(C.g + "✓ 索引已构建" + C.r + "  " + cfg.root);
  console.log("  " + C.dim + "文档" + C.r + " " + idx.N + "   " + C.dim + "词项" + C.r + " " + idx.terms.size + "   " + C.dim + "索引" + C.r + " " + human(buf.length));
  console.log("  " + C.dim + "复用" + C.r + " " + reused + "   " + C.dim + "重解析" + C.r + " " + parsed + "   " + C.dim + "移除" + C.r + " " + removed + "   " + C.dim + "耗时" + C.r + " " + stats.ms + "ms");
  return idx;
}

function cmdSearch(root, query, flags) {
  const cfg = loadConfig(root);
  const idx = loadIndexOrExit(cfg);
  const readText = (p) => { try { return readFileSync(join(cfg.root, p), "utf8"); } catch (e) { return ""; } };
  const out = runSearch(idx, cfg, query, { limit: flags.limit || 10, readText });
  if (flags.json) { console.log(JSON.stringify({ query, total: out.total, hits: out.hits.map((h) => ({ path: h.doc.path, title: h.doc.title, tags: h.doc.tags, score: Math.round(h.score * 1000) / 1000, snippet: h.snippet })) }, null, 2)); return; }
  if (!out.total) { console.log(C.y + "无结果: " + query + C.r); return; }
  console.log(C.b + out.total + C.r + " 条命中 " + C.dim + "(显示前 " + out.hits.length + ")" + C.r);
  out.hits.forEach((h, i) => {
    console.log("\n " + C.cy + (i + 1) + "." + C.r + " " + C.b + h.doc.title + C.r + "  " + C.dim + h.doc.path + C.r + "  " + C.y + h.score.toFixed(2) + C.r);
    if (h.snippet) console.log("    " + h.snippet);
  });
}

function cmdStats(root, flags) {
  const cfg = loadConfig(root);
  const p = join(cfg.indexDir, "index.bin");
  if (!existsSync(p)) { console.error("未找到索引"); process.exit(2); }
  const buf = readFileSync(p);
  const idx = deserializeIndex(buf);
  const s = indexStats(buf, idx);
  if (flags.json) { console.log(JSON.stringify(s, null, 2)); return; }
  console.log(C.b + "Noesis · 索引统计" + C.r + "  " + cfg.root);
  console.log("  文档      " + s.documents);
  console.log("  词项      " + s.terms);
  console.log("  倒排项    " + s.postings);
  console.log("  平均长度  " + s.avgDocLength);
  console.log("  索引大小  " + human(s.indexBytes) + C.dim + " (压缩前 " + human(s.indexRawBytes) + ")" + C.r);
}

function cmdGraph(root, flags) {
  const cfg = loadConfig(root);
  const idx = loadIndexOrExit(cfg);
  const g = buildGraph(idx.docs);
  if (flags.json) { console.log(JSON.stringify({ orphans: g.orphans, dangling: g.dangling, hubs: g.hubs.slice(0, 20), docCount: g.docCount }, null, 2)); return; }
  console.log(C.b + "Noesis · 双链图" + C.r + "  文档 " + g.docCount);
  if (flags.orphans || (!flags.dangling)) {
    console.log("\n" + C.y + "孤立笔记 (" + g.orphans.length + ")" + C.r);
    g.orphans.slice(0, 30).forEach((p) => console.log("  " + p));
  }
  if (flags.dangling) {
    console.log("\n" + C.rd + "断链 (" + g.dangling.length + ")" + C.r);
    g.dangling.slice(0, 30).forEach((d) => console.log("  " + d.from + "  ->  " + d.to));
  }
  console.log("\n" + C.g + "枢纽 (backlinks 最多)" + C.r);
  g.hubs.slice(0, 10).forEach((h) => console.log("  " + String(h.backlinks).padStart(3) + "  " + h.path));
}

function cmdDoctor(root, flags) {
  const cfg = loadConfig(root);
  const idx = loadIndexOrExit(cfg);
  const g = buildGraph(idx.docs);
  const titles = new Map();
  const problems = { no_title: [], duplicate_title: [], empty: [], oversized: [] };
  for (const d of idx.docs) {
    if (!d.title || !String(d.title).trim()) problems.no_title.push(d.path);
    const key = String(d.title || d.path).trim().toLowerCase();
    if (!titles.has(key)) titles.set(key, []);
    titles.get(key).push(d.path);
    if (!d.length) problems.empty.push(d.path);
    if (d.bytes > cfg.maxFileBytes) problems.oversized.push(d.path);
  }
  for (const pair of titles) if (pair[1].length > 1) problems.duplicate_title.push(pair[1]);
  const summary = { documents: idx.N, orphans: g.orphans.length, dangling: g.dangling.length, ...problems };
  if (flags.json) { console.log(JSON.stringify(summary, null, 2)); return; }
  console.log(C.b + "Noesis · 体检" + C.r + "  " + cfg.root);
  console.log("  文档 " + idx.N + "  |  " + C.y + "孤立 " + g.orphans.length + C.r + "  |  " + C.rd + "断链 " + g.dangling.length + C.r + "  |  无标题 " + problems.no_title.length + "  |  重复标题 " + problems.duplicate_title.length);
  g.dangling.slice(0, 20).forEach((d) => console.log("  " + C.rd + "断链" + C.r + " " + d.from + " -> " + d.to));
}

function cmdInit(dir) {
  const root = resolve(dir || ".");
  mkdirSync(root, { recursive: true });
  const cfgPath = join(root, "kb.config.json");
  if (!existsSync(cfgPath)) {
    writeFileSync(cfgPath, JSON.stringify({ index: ".noesis", extensions: [".md", ".markdown", ".txt"], bigrams: true, bm25: { k1: 1.2, b: 0.75 } }, null, 2) + "\n");
    console.log(C.g + "✓" + C.r + " 已创建 " + cfgPath);
  }
  const inbox = join(root, "inbox");
  mkdirSync(inbox, { recursive: true });
  const seed = join(inbox, "welcome.md");
  if (!existsSync(seed)) {
    writeFileSync(seed, "---\ntitle: 欢迎使用 Noesis\ntags: [meta, start]\ndate: " + new Date().toISOString().slice(0, 10) + "\n---\n\n# 欢迎使用 Noesis\n\n把笔记放进这个目录，然后运行 build 建立索引。\n\n- 支持 双链 [[welcome]]\n- 支持 标签 tag:meta\n- 支持 中英混合检索\n");
    console.log(C.g + "✓" + C.r + " 已创建 " + seed);
  }
  console.log("\n下一步:  noesis build " + root);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const { flags, rest } = parseArgs(argv.slice(1));
  if (!cmd || cmd === "help" || flags.help) { console.log(HELP); return; }
  if (cmd === "version" || flags.version) { console.log(VERSION); return; }
  if (cmd === "init") return cmdInit(rest[0]);
  if (cmd === "build") return build(rest[0] || ".", flags);
  if (cmd === "search") return cmdSearch(rest[0] || ".", rest.slice(1).join(" "), flags);
  if (cmd === "stats") return cmdStats(rest[0] || ".", flags);
  if (cmd === "graph") return cmdGraph(rest[0] || ".", flags);
  if (cmd === "doctor") return cmdDoctor(rest[0] || ".", flags);
  if (cmd === "serve") {
    const cfg = loadConfig(rest[0] || ".");
    const idx = loadIndexOrExit(cfg);
    const s = startServer(idx, cfg, flags.port);
    console.log(C.g + "✓" + C.r + " Noesis 服务已启动  http://127.0.0.1:" + s.port);
    return s.server;
  }
  console.error(C.rd + "未知命令: " + cmd + C.r + "\n\n" + HELP);
  process.exit(1);
}

main();
