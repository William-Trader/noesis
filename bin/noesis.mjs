#!/usr/bin/env node
// Noesis · command line interface (zero dependencies).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join, relative, resolve, basename } from "node:path";
import { loadConfig } from "../src/config.mjs";
import { walk, parseDoc } from "../src/corpus.mjs";
import { tokenize } from "../src/tokenize.mjs";
import { runSearch } from "../src/search.mjs";
import { buildGraph, linkAuthority, relatedDocs } from "../src/graph.mjs";
import { startServer } from "../src/server.mjs";
import { startMcp } from "../src/mcp.mjs";
import { spawn } from "node:child_process";
import { scaffoldLibrary, checkLibrary, findDuplicates, renderIndex, LIBRARY_DIRS } from "../src/library.mjs";
import { listedVolumes, currentVolume, displayVolume, readHome, recordHome, readJournal, appendJournal, undoMapping, packLibrary, manualText, JOURNAL, HOME_RECORD, MANUAL_FILE } from "../src/portable.mjs";
import { ensureState, saveManifest, writeSegment, loadVault, compact, segmentDir, segmentBytes, countDrift, SEG_DIR, MAX_SEGMENTS } from "../src/segments.mjs";
import { passageKey } from "../src/passages.mjs";
import { planOrganization, applyMoves, undoOp } from "../src/organize.mjs";
import { planSync, syncBack } from "../src/sync.mjs";

const VERSION = "0.5.0";
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
  "  build [dir] [--full]    构建/更新索引 (默认增量：只追加变化的段)",
  "  search <dir> <query>    检索 (tag: / path: / -排除 / \"短语\")",
  "  related <dir> <note>    双链图上的一阶相关笔记",
  "  stats [dir]             索引统计",
  "  graph [dir]             双链图 (--orphans --dangling)",
  "  doctor [dir]            体检 (断链/缺标题/重复标题)",
  "  serve [dir] [--port N]  本地检索服务 (默认只绑 127.0.0.1)",
  "  ui [dir]                一键：增量构建 + 起服务 + 开浏览器",
  "  mcp [dir]               以 MCP (stdio JSON-RPC) 暴露检索与库工具",
  "  tidy [dir] [--yes]      一键整理：先出计划，--yes 才执行（可撤销）",
  "  sync [dir] --from <副本>  把移动副本里的更新拷回来（旧文件先备份）",
  "  onboard [dir]           小白引导：体检 + 给 agent 的交接话术",
  "  undo <dir> <op_id>      撤销一次整理（按映射表反向还原）",
  "  library ...             资产库建档 / 体检 / 查重 / 台账 (见 library help)",
  "",
  "选项:",
  "  --json      机器可读输出",
  "  --limit N   结果条数 (默认 10)",
  "  --full      全量重建 (重写为单段并压实)",
  "  --as-of T   按时间切片检索 (ISO 时间或毫秒时间戳)",
  "  --host H    绑定地址 (默认 127.0.0.1；0.0.0.0 需显式指定)",
  "  --token T   可选访问令牌 (也可用 NOESIS_TOKEN)",
  "  --no-passages  关闭段落索引 (只做文件级检索)",
  "",
  "零依赖 · 段式二进制索引 · BM25 · 段落级命中 · 中英混合分词 · 图权重重排"
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
    else if (a === "--dirs-only") flags.dirsOnly = true;
    else if (a === "--dups") flags.dups = true;
    else if (a === "--keep") { (flags.keep = flags.keep || []).push(argv[++i]); }
    else if (a === "--quiet") flags.quiet = true;
    else if (a === "--no-open") flags.noOpen = true;
    else if (a === "--no-watch") flags.noWatch = true;
    else if (a === "--no-passages") flags.noPassages = true;
    else if (a === "--set") flags.set = argv[++i];
    else if (a === "--move") flags.move = true;
    else if (a === "--tail") flags.tail = Number(argv[++i]);
    else if (a === "--add") flags.add = argv[++i];
    else if (a === "--lang") flags.lang = argv[++i];
    else if (a === "--out") flags.out = argv[++i];
    else if (a === "--dry") flags.dry = true;
    else if (a === "--actor") flags.actor = argv[++i];
    else if (a === "--noesis-path") flags.noesisPath = argv[++i];
    else if (a === "--label") flags.label = argv[++i];
    else if (a === "--host") flags.host = argv[++i];
    else if (a === "--token") flags.token = argv[++i];
    else if (a === "--as-of") flags.asOf = argv[++i];
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--from") flags.from = argv[++i];
    else if (a === "--build") flags.build = true;
    else if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "-v" || a === "--version") flags.version = true;
    else rest.push(a);
  }
  return { flags, rest };
}

function asOfMs(v) {
  if (v == null) return 0;
  const n = Number(v);
  if (Number.isFinite(n) && String(n).length >= 10) return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function loadVaultOrExit(cfg, flags) {
  const asOf = asOfMs(flags && flags.asOf);
  const loaded = loadVault(cfg, { asOf });
  if (!loaded.idx.N) {
    console.error(C.rd + "未找到索引: " + join(cfg.indexDir, SEG_DIR) + C.r + "\n先运行: noesis build " + cfg.root);
    process.exit(2);
  }
  return loaded;
}

// One document expands into a doc row plus one row per heading passage.
function docEntries(doc, cfg) {
  const row = Object.assign({}, doc);
  row.key = "doc:" + doc.path;
  row.kind = "doc";
  delete row.tokens;
  delete row.passages;
  delete row.frontmatter;
  const out = [{ doc: row, tokens: doc.tokens }];
  if (cfg.passages !== false && doc.passages) {
    for (let i = 0; i < doc.passages.length; i += 1) {
      const p = doc.passages[i];
      out.push({
        doc: {
          path: doc.path, key: passageKey(doc.path, i), kind: "passage", parent: doc.path,
          title: p.heading || doc.title, heading: p.heading, start: p.start, end: p.end,
          bodyStart: doc.bodyStart, tags: doc.tags, date: doc.date,
          links: [], headings: [], bytes: p.text.length, mtimeMs: doc.mtimeMs, hash: doc.hash
        },
        tokens: tokenize(p.heading + "\n" + p.text, { bigrams: cfg.bigrams })
      });
    }
  }
  return out;
}

function build(root, flags) {
  flags = flags || {};
  const cfg = loadConfig(root);
  if (flags.noPassages) cfg.passages = false;
  mkdirSync(cfg.indexDir, { recursive: true });
  const t0 = Date.now();
  const state = ensureState(cfg);
  const files = walk(cfg.root, cfg);
  const rels = new Set(files.map((f) => relative(cfg.root, f).split("\\").join("/")));

  const changed = [];
  let reused = 0;
  for (const f of files) {
    const rel = relative(cfg.root, f).split("\\").join("/");
    const st = statSync(f);
    const mtimeMs = Math.floor(st.mtimeMs);
    const rec = state.docs[rel];
    if (!flags.full && rec && rec.mtimeMs === mtimeMs && rec.bytes === st.size) { reused += 1; continue; }
    const doc = parseDoc(f, cfg.root, cfg);
    changed.push({ rel, doc, mtimeMs: doc.mtimeMs, bytes: doc.bytes });
  }

  let removed = 0;
  for (const rel of Object.keys(state.docs)) if (!rels.has(rel)) removed += 1;

  let seg = null;
  let compacted = false;
  if (changed.length || removed) {
    if (changed.length) {
      const entries = [];
      for (const c of changed) for (const e of docEntries(c.doc, cfg)) entries.push(e);
      seg = writeSegment(cfg, entries, { files: changed.length });
      const segIndex = state.segments.length;
      state.segments.push({ file: seg.file, builtAt: seg.builtAt, rows: seg.rows });
      for (const c of changed) {
        state.docs[c.rel] = {
          mtimeMs: c.mtimeMs, bytes: c.bytes, hash: c.doc.hash,
          length: c.doc.length, seg: segIndex, key: "doc:" + c.rel
        };
      }
    }
    const removedPaths = [];
    for (const rel of Object.keys(state.docs)) {
      if (!rels.has(rel)) { removedPaths.push(rel); delete state.docs[rel]; }
    }
    if (removedPaths.length) {
      state.tombstones = state.tombstones || [];
      const at = Date.now();
      for (const rel of removedPaths) state.tombstones.push({ path: rel, at });
      const oldest = state.segments.length ? state.segments[0].builtAt : 0;
      state.tombstones = state.tombstones.filter((t) => t.at >= oldest).slice(-500);
    }
    state.builtAt = Date.now();
    saveManifest(cfg, state);

    if (flags.full && seg) {
      const dir = segmentDir(cfg);
      for (const s of state.segments) {
        if (s.file === seg.file) continue;
        try { unlinkSync(join(dir, s.file)); } catch (e) { /* gone */ }
      }
      state.segments = [{ file: seg.file, builtAt: seg.builtAt, rows: seg.rows }];
      state.tombstones = [];
      for (const k of Object.keys(state.docs)) state.docs[k].seg = 0;
      saveManifest(cfg, state);
    }

    if (state.segments.length > MAX_SEGMENTS) {
      compact(cfg, state);
      compacted = true;
    }
  }

  const stats = {
    files: files.length, documents: Object.keys(state.docs).length,
    reused, parsed: changed.length, removed,
    segments: state.segments.length, compacted, ms: Date.now() - t0
  };
  if (flags.quiet) return loadVault(cfg, { state }).idx;
  if (flags.json) { console.log(JSON.stringify(stats, null, 2)); return; }
  console.log(C.g + "✓ 索引已更新" + C.r + "  " + cfg.root);
  console.log("  " + C.dim + "文档" + C.r + " " + stats.documents + "   " + C.dim + "段" + C.r + " " + stats.segments + "   " + C.dim + "复用" + C.r + " " + reused + "   " + C.dim + "重解析" + C.r + " " + stats.parsed + "   " + C.dim + "移除" + C.r + " " + removed + "   " + C.dim + "耗时" + C.r + " " + stats.ms + "ms");
  return null;
}

function cmdSearch(root, query, flags) {
  const cfg = loadConfig(root);
  const loaded = loadVaultOrExit(cfg, flags);
  const readText = (p) => { try { return readFileSync(join(cfg.root, p), "utf8"); } catch (e) { return ""; } };
  const authority = linkAuthority(loaded.idx.docs);
  const out = runSearch(loaded.idx, cfg, query, { limit: flags.limit || 10, readText, authority });
  if (flags.json) {
    console.log(JSON.stringify({
      query, total: out.total, returned: out.returned,
      as_of: new Date(loaded.idx.builtAt || 0).toISOString(),
      hits: out.hits.map((h) => ({
        path: h.doc.path, title: h.doc.title, tags: h.doc.tags,
        section: h.section || null, score: Math.round(h.score * 1000) / 1000, snippet: h.snippet
      }))
    }, null, 2));
    return;
  }
  if (!out.total) { console.log(C.y + "无结果: " + query + C.r); return; }
  console.log(C.b + out.total + C.r + " 条命中 " + C.dim + "(显示前 " + out.returned + ")" + C.r);
  out.hits.forEach((h, i) => {
    const sec = h.section ? C.dim + " › " + h.section + C.r : "";
    console.log("\n " + C.cy + (i + 1) + "." + C.r + " " + C.b + h.doc.title + C.r + "  " + C.dim + h.doc.path + C.r + sec + "  " + C.y + h.score.toFixed(2) + C.r);
    if (h.snippet) console.log("    " + h.snippet);
  });
}

function cmdRelated(root, path, flags) {
  const cfg = loadConfig(root);
  const loaded = loadVaultOrExit(cfg, flags);
  const rows = relatedDocs(loaded.idx.docs, path, { limit: flags.limit || 10 });
  if (flags.json) { console.log(JSON.stringify({ path, related: rows }, null, 2)); return; }
  console.log(C.b + "相关笔记" + C.r + "  " + (path || "(未指定)"));
  if (!rows.length) { console.log("  " + C.dim + "没有双链邻居" + C.r); return; }
  rows.forEach((r) => console.log("  " + C.dim + r.score.toFixed(4) + C.r + "  " + r.path + "  " + C.dim + (r.title || "") + C.r));
}

function cmdStats(root, flags) {
  const cfg = loadConfig(root);
  const loaded = loadVaultOrExit(cfg, flags);
  const idx = loaded.idx;
  let postings = 0;
  for (const e of idx.terms.values()) postings += e.df;
  const docs = idx.docs.filter((d) => d.kind !== "passage").length;
  const s = {
    documents: docs,
    passages: idx.N - docs,
    terms: idx.terms.size,
    postings,
    avgDocLength: Math.round((idx.avgdlDocs || idx.avgdl) * 100) / 100,
    indexBytes: segmentBytes(cfg, loaded.state),
    segments: loaded.segments,
    builtAt: idx.builtAt,
    asOf: new Date(idx.builtAt || 0).toISOString(),
    drift: countDrift(cfg, loaded.state)
  };
  if (flags.json) { console.log(JSON.stringify(s, null, 2)); return; }
  console.log(C.b + "Noesis · 索引统计" + C.r + "  " + cfg.root);
  console.log("  文档      " + s.documents + "   " + C.dim + "段落 " + s.passages + C.r);
  console.log("  词项      " + s.terms);
  console.log("  倒排项    " + s.postings);
  console.log("  平均长度  " + s.avgDocLength);
  console.log("  索引大小  " + human(s.indexBytes) + "   " + C.dim + "段 " + s.segments + C.r);
  console.log("  构建时间  " + s.asOf + "   " + C.dim + "待更新 " + s.drift + " 个文件" + C.r);
}

function cmdGraph(root, flags) {
  const cfg = loadConfig(root);
  const loaded = loadVaultOrExit(cfg, flags);
  const docs = loaded.idx.docs.filter((d) => d.kind !== "passage");
  const g = buildGraph(docs);
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
  const loaded = loadVaultOrExit(cfg, flags);
  const docs = loaded.idx.docs.filter((d) => d.kind !== "passage");
  const g = buildGraph(docs);
  const titles = new Map();
  const problems = { no_title: [], duplicate_title: [], empty: [], oversized: [] };
  for (const d of docs) {
    if (!d.title || !String(d.title).trim()) problems.no_title.push(d.path);
    const key = String(d.title || d.path).trim().toLowerCase();
    if (!titles.has(key)) titles.set(key, []);
    titles.get(key).push(d.path);
    if (!d.length) problems.empty.push(d.path);
    if (d.bytes > cfg.maxFileBytes) problems.oversized.push(d.path);
  }
  for (const pair of titles) if (pair[1].length > 1) problems.duplicate_title.push(pair[1]);
  const summary = { documents: docs.length, orphans: g.orphans.length, dangling: g.dangling.length, ...problems };
  if (flags.json) { console.log(JSON.stringify(summary, null, 2)); return; }
  console.log(C.b + "Noesis · 体检" + C.r + "  " + cfg.root);
  console.log("  文档 " + docs.length + "  |  " + C.y + "孤立 " + g.orphans.length + C.r + "  |  " + C.rd + "断链 " + g.dangling.length + C.r + "  |  无标题 " + problems.no_title.length + "  |  重复标题 " + problems.duplicate_title.length);
  g.dangling.slice(0, 20).forEach((d) => console.log("  " + C.rd + "断链" + C.r + " " + d.from + " -> " + d.to));
}

function cmdInit(dir) {
  const root = resolve(dir || ".");
  mkdirSync(root, { recursive: true });
  const cfgPath = join(root, "kb.config.json");
  if (!existsSync(cfgPath)) {
    writeFileSync(cfgPath, JSON.stringify({ index: ".noesis", extensions: [".md", ".markdown", ".txt"], bigrams: true, passages: true, bm25: { k1: 1.2, b: 0.75 } }, null, 2) + "\n");
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

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch (e) {}
}

function cmdUi(dir, flags) {
  const cfg = loadConfig(dir);
  const t0 = Date.now();
  const idx = build(cfg.root, { full: flags.full, quiet: true, noPassages: flags.noPassages });
  const bootMs = Date.now() - t0;
  const rebuild = () => build(cfg.root, { quiet: true });
  const s = startServer(idx, cfg, {
    port: flags.port, watch: !flags.noWatch, rebuild, bootMs, label: flags.label,
    host: flags.host, token: flags.token
  });
  const url = "http://127.0.0.1:" + s.port + "/";
  console.log(C.g + "✓ Noesis 已就绪" + C.r + "  " + url);
  console.log("  " + C.dim + "文档" + C.r + " " + idx.N + "   " + C.dim + "索引加载" + C.r + " " + bootMs + "ms   " + C.dim + "watch" + C.r + " " + (flags.noWatch ? "off" : "on（改动自动重建）"));
  console.log("  " + C.dim + "快捷键" + C.r + " / 聚焦 · ↑↓ 选择 · Enter 预览 · Esc 清空 · 点筛选条按目录/标签收窄");
  if (!flags.noOpen) openBrowser(url);
  return s.server;
}

function cmdMcp(dir) {
  const cfg = loadConfig(dir);
  const loaded = loadVaultOrExit(cfg, {});
  const readText = (p) => { try { return readFileSync(join(cfg.root, p), "utf8"); } catch (e) { return ""; } };
  startMcp(loaded.idx, cfg, { readText, state: loaded.state });
}

function cmdTidy(dir, flags) {
  const cfg = loadConfig(dir);
  const keep = flags.keep || [];
  const preview = planOrganization(cfg.root, { keep, limit: flags.limit || 20 });
  if (!preview.total) {
    console.log(C.g + "✓ 库根已干净" + C.r + "  没有需要归档的散装条目。");
    return;
  }
  console.log(C.b + "一键整理 · 计划" + C.r + "  " + cfg.root);
  console.log("  " + C.dim + "共 " + preview.total + " 项 · " + human(preview.bytes) + (preview.conflicts ? " · " + preview.conflicts + " 项目标已存在（会跳过）" : "") + C.r);
  preview.items.forEach((i) => {
    console.log("  " + (i.conflict ? C.y + "跳过" + C.r : C.cy + "移动" + C.r) + "  " + i.srcRel + C.dim + "  ->  " + C.dstRel + "  (" + i.reason + ")" + C.r);
  });
  if (preview.total > preview.items.length) console.log("  " + C.dim + "… 其余 " + (preview.total - preview.items.length) + " 项未显示" + C.r);

  if (!flags.yes) {
    console.log("\n" + C.y + "这是计划，还没有动任何文件。" + C.r + " 确认执行：");
    console.log("  " + C.cy + "noesis tidy \"" + cfg.root + "\" --yes" + C.r);
    return;
  }

  const full = planOrganization(cfg.root, { keep, limit: 10000 });
  const moves = full.items.filter((i) => !i.conflict).map((i) => ({ src: i.srcRel, dst: i.dstRel, reason: i.reason }));
  const res = applyMoves(cfg.root, moves, { actor: flags.actor || "agent" });
  console.log("\n" + C.g + "✓ 整理完成" + C.r + "  移动 " + (res.applied || 0) + " 项" + (res.rejected && res.rejected.length ? "，跳过 " + res.rejected.length + " 项" : ""));
  if (res.op_id) console.log("  " + C.dim + "映射表" + C.r + " " + res.op_id + "   " + C.dim + "撤销: noesis undo \"" + cfg.root + "\" " + res.op_id + C.r);
  try {
    writeFileSync(join(cfg.root, "INDEX.md"), renderIndex(cfg.root));
    console.log("  " + C.dim + "INDEX.md 已重生成" + C.r);
  } catch (e) { /* 库根只读时忽略 */ }
  if (flags.build) {
    const idx = build(cfg.root, { quiet: true });
    console.log("  " + C.dim + "检索索引已更新（" + idx.N + " 行）" + C.r);
  }
}

function cmdSync(dir, flags) {
  const cfg = loadConfig(dir);
  if (!flags.from) {
    console.error(C.rd + "缺少 --from" + C.r + "  用法: noesis sync <库> --from <移动副本目录> [--dry]");
    process.exit(1);
  }
  const from = resolve(flags.from);
  if (!existsSync(from)) { console.error(C.rd + "副本目录不存在: " + from + C.r); process.exit(2); }
  const plan = planSync(cfg.root, from);
  console.log(C.b + "拷回更新 · 对比" + C.r + "  " + from + C.dim + "  ->  " + cfg.root + C.r);
  console.log("  新增 " + plan.add + "   " + "更新 " + plan.update + "   " + C.dim + "相同 " + plan.same + " · 库内较新/相同 " + plan.skip + C.r);
  plan.items.slice(0, flags.limit || 20).forEach((i) => {
    console.log("  " + (i.action === "add" ? C.g + "新增" + C.r : C.cy + "更新" + C.r) + "  " + i.rel + C.dim + "  (" + i.why + ")" + C.r);
  });
  if (flags.dry) { console.log("\n" + C.y + "dry-run：未写入任何文件。" + C.r); return; }
  if (!plan.items.length) { console.log("\n" + C.g + "✓ 没有需要回写的文件" + C.r); return; }
  const res = syncBack(cfg.root, from, { actor: flags.actor || "agent" });
  console.log("\n" + C.g + "✓ 已回写 " + res.applied + " 个文件" + C.r);
  if (res.backupDir) console.log("  " + C.dim + "被覆盖的旧文件已备份到" + C.r + " " + res.backupDir);
  if (res.mapping) console.log("  " + C.dim + "映射表" + C.r + " " + res.mapping);
}

function cmdOnboard(dir, flags) {
  const root = resolve(dir || ".");
  const rep = checkLibrary(root, { keep: flags.keep || [] });
  const vols = listedVolumes();
  const hasIndex = existsSync(join(root, ".noesis", "manifest.json"));
  console.log(C.b + "Noesis · 小白引导" + C.r + "  " + root);
  console.log("");
  console.log("  库结构    " + (rep.missingDirs.length ? C.y + "缺 " + rep.missingDirs.length + " 个编号目录" + C.r : C.g + "完整" + C.r));
  console.log("  库根散装  " + (rep.stray.length ? C.y + rep.stray.length + " 项" + C.r : C.g + "0" + C.r));
  console.log("  检索索引  " + (hasIndex ? C.g + "已建立" + C.r : C.y + "还没有（先跑 noesis build）" + C.r));
  console.log("  候选盘位  " + (vols.length ? vols.map((v) => v.name + " " + v.freeGB + "GB").join(" · ") : "无"));
  console.log("");
  console.log(C.b + "把下面这段话直接发给你的 agent：" + C.r);
  console.log(C.dim + "------------------------------------------------------------" + C.r);
  console.log("这是我的 Noesis 知识库：" + root);
  console.log("请先读 Noesis 仓库里的 docs/HANDOVER.md 和 skills/noesis-library/SKILL.md，然后帮我一键整理：");
  console.log("1) 先跑体检和整理计划给我看；2) 我确认后再执行；3) 汇报移动了什么、为什么、怎么撤销。");
  console.log(C.dim + "------------------------------------------------------------" + C.r);
  console.log("");
  console.log("常用命令：");
  console.log("  noesis build \"" + root + "\"        建立/更新检索索引");
  console.log("  noesis tidy  \"" + root + "\"        一键整理（先看计划，加 --yes 执行）");
  console.log("  noesis library pack \"" + root + "\"  打包带走（不含可重建的索引）");
  console.log("  noesis sync  \"" + root + "\" --from <副本>   把副本里的更新拷回来");
}

function cmdLibrary(action, dir, flags, extra) {
  const keep = flags.keep || [];
  extra = extra || [];

  if (action === "volumes") {
    const vols = listedVolumes();
    if (flags.json) { console.log(JSON.stringify(vols, null, 2)); return; }
    console.log(C.b + "候选盘位" + C.r + "（第一次接触请先问用户：这份库放哪个盘？）");
    vols.forEach((v) => {
      console.log("  " + (v.external ? C.cy + "[外接]" + C.r : C.dim + "[本机]" + C.r) + " " + v.name);
      console.log("      " + v.mount + "   可用 " + v.freeGB + " GB / 共 " + v.totalGB + " GB" + (v.writable ? "" : C.y + "  (只读)" + C.r));
    });
    if (!vols.some((v) => v.external)) console.log("\n" + C.y + "! 当前没有挂载外接盘：要用移动硬盘就先插入，再重跑本命令。" + C.r);
    return;
  }

  if (action === "home") {
    const home = readHome(dir);
    const target = flags.set;
    if (!target) {
      if (flags.json) { console.log(JSON.stringify(home, null, 2)); return; }
      console.log(C.b + "库位置" + C.r + "  " + home.root);
      console.log("  卷        " + home.volume + "   可用 " + (home.freeGB == null ? "?" : home.freeGB + " GB"));
      console.log("  主机      " + home.host);
      console.log("  已登记    " + (home.portable ? C.g + "是" + C.r + " (" + home.record.recordedAt + ")" : C.y + "否 —— 跑 library home --set <盘> 记录" + C.r));
      return;
    }
    const vols = listedVolumes();
    const vol = vols.find((v) => v.mount === target || v.name === target);
    const dest = vol ? vol.mount : target;
    if (!existsSync(dest)) { console.error(C.rd + "目标盘不存在或未挂载: " + dest + C.r); process.exit(2); }
    if (vol && !vol.writable) { console.error(C.rd + "目标盘只读: " + dest + C.r); process.exit(2); }
    // 已经在目标盘上就不谈「搬迁」，只记录 —— 免得给出误导性的复制命令。
    const cur = currentVolume(home.root);
    if (vol && cur.mount === displayVolume(vol.mount)) {
      const rec0 = recordHome(home.root, dest, { note: "已在目标盘 " + vol.name });
      console.log(C.g + "✓ 已登记库位置" + C.r + "  " + rec0.path + "  (卷 " + rec0.volume + ")");
      console.log("  " + C.dim + "库已经在这个盘上，无需搬迁。" + C.r);
      return;
    }
    const destLib = join(dest, basename(home.root));
    if (flags.move) {
      console.log(C.b + "复制中" + C.r + "  " + home.root + "  ->  " + destLib);
      execFileSync("rsync", ["-a", home.root + "/", destLib + "/"], { stdio: "inherit" });
      appendJournal(home.root, { op: "move", detail: "rsync 复制到 " + destLib + "（源未删）", actor: "agent" });
      console.log(C.g + "✓ 复制完成" + C.r + "  源库仍在原地：" + home.root);
      console.log("  " + C.y + "确认新位置可用后，是否删除源目录由你决定（本工具不自动删）。" + C.r);
      console.log("  新位置登记: noesis library home \"" + destLib + "\" --set \"" + dest + "\"");
      return;
    }
    const rec = recordHome(home.root, dest, { note: "目标 " + destLib });
    console.log(C.g + "✓ 已登记库位置" + C.r + "  " + rec.path + "  (卷 " + rec.volume + ")");
    console.log("  真正搬过去（源文件不会删）：");
    console.log("    " + C.cy + "noesis library home \"" + home.root + "\" --set \"" + dest + "\" --move" + C.r);
    return;
  }

  if (action === "manual") {
    const out = manualText(dir, { lang: flags.lang || "both", noesisPath: flags.noesisPath || "<noesis>/bin/noesis.mjs" });
    const p = flags.out ? resolve(flags.out) : join(resolve(dir), MANUAL_FILE);
    writeFileSync(p, out);
    appendJournal(dir, { op: "manual", detail: "生成说明书 " + p, actor: "agent" });
    if (flags.json) { console.log(JSON.stringify({ path: p, lines: out.split("\n").length }, null, 2)); return; }
    console.log(C.g + "✓ 说明书已生成" + C.r + "  " + p + C.dim + "  (" + out.split("\n").length + " 行 · 中英双语)" + C.r);
    console.log("  把这份文件直接交给用户即可。");
    return;
  }

  if (action === "log") {
    const add = flags.add;
    if (add) {
      const i = add.indexOf(":");
      appendJournal(dir, { op: i > 0 ? add.slice(0, i) : "note", detail: i > 0 ? add.slice(i + 1) : add, actor: flags.actor || "agent" });
      console.log(C.g + "✓ 已记入 " + JOURNAL + C.r + "  " + add);
      return;
    }
    const rows = readJournal(dir, flags.tail || 20);
    if (flags.json) { console.log(JSON.stringify(rows, null, 2)); return; }
    console.log(C.b + "库志" + C.r + "  " + join(resolve(dir), JOURNAL) + C.dim + "  (最近 " + rows.length + " 条)" + C.r);
    if (!rows.length) { console.log("  " + C.dim + "（还没有记录）" + C.r); return; }
    rows.forEach((r) => console.log("  " + C.dim + (r.ts || "") + C.r + "  " + C.cy + (r.op || "?") + C.r + "  " + (r.detail || "") + C.dim + (r.host ? "  @" + r.host : "") + C.r));
    return;
  }

  if (action === "undo") {
    const csv = extra[0];
    if (!csv) { console.error(C.rd + "用法: library undo <库> <映射表.csv> [--dry]" + C.r); process.exit(1); }
    const csvPath = csv[0] === "/" ? csv : join(resolve(dir), csv);
    if (!existsSync(csvPath)) { console.error(C.rd + "找不到映射表: " + csvPath + C.r); process.exit(2); }
    const res = undoMapping(dir, csvPath, { dry: flags.dry });
    if (flags.json) { console.log(JSON.stringify(res, null, 2)); return; }
    console.log(C.b + "映射表反向还原" + C.r + "  " + basename(csvPath) + (res.dry ? C.y + "  (dry-run，未改动)" + C.r : ""));
    const TAG = { restore: C.g + "还原" + C.r, restored: C.g + "已还原" + C.r, "skip-exists": C.y + "跳过(原位置已存在)" + C.r, "skip-missing": C.dim + "跳过(找不到)" + C.r, failed: C.rd + "失败" + C.r };
    res.plan.forEach((p) => console.log("  " + (TAG[p.action] || p.action) + " " + p.src));
    console.log((res.dry ? "计划还原 " : "实际还原 ") + (res.dry ? res.plan.filter((p) => p.action === "restore").length : res.applied) + " 项");
    return;
  }

  if (action === "pack") {
    const out = packLibrary(dir, flags.out, { dryRun: flags.dry });
    if (flags.json) { console.log(JSON.stringify(out, null, 2)); return; }
    if (out.dryRun) { console.log(C.b + "打包命令（dry-run）" + C.r + "\n  " + out.cmd); return; }
    console.log(C.g + "✓ 便携包已生成" + C.r + "  " + out.outPath + C.dim + "  (" + human(out.bytes) + ")" + C.r);
    console.log("  交给下一个 agent：解压 → library home <库> --set <盘> → ui <库>");
    return;
  }

  if (action === "init") {
    const r = scaffoldLibrary(dir, { dirsOnly: flags.dirsOnly });
    if (flags.json) { console.log(JSON.stringify(r, null, 2)); return; }
    console.log(C.g + "✓ 资产库已建档" + C.r + "  " + r.root);
    console.log("  " + C.dim + "新建" + C.r + " " + r.created.length + "   " + C.dim + "已存在" + C.r + " " + r.existed.length);
    r.created.slice(0, 20).forEach((p) => console.log("  " + C.g + "+" + C.r + " " + p));
    console.log("\n下一步:  noesis library check " + r.root + "  然后按 _整理规范.md 归类");
    return;
  }
  if (action === "check") {
    const rep = checkLibrary(dir, { keep, checkDups: flags.dups, maxHashBytes: flags.maxHashBytes });
    if (flags.json) { console.log(JSON.stringify(rep, null, 2)); return; }
    console.log(C.b + "Noesis · 资产库体检" + C.r + "  " + rep.root);
    console.log("  编号目录 " + rep.dirs + "  |  缺失 " + rep.missingDirs.length + "  |  库根散装 " + rep.stray.length + "  |  映射表 " + rep.mappingFiles.length);
    if (rep.missingDirs.length) { console.log("\n" + C.y + "缺失目录" + C.r); rep.missingDirs.forEach((d) => console.log("  " + d)); }
    if (rep.stray.length) { console.log("\n" + C.y + "库根散装条目 (应归入编号目录)" + C.r); rep.stray.slice(0, 30).forEach((s) => console.log("  " + (s.isDir ? "[dir]  " : "[file] ") + s.name)); }
    if (rep.strayArchives.length) { console.log("\n" + C.y + "库根压缩包 (应进 07-原始包-originals/)" + C.r); rep.strayArchives.forEach((n) => console.log("  " + n)); }
    if (rep.credentialsOutside.length) { console.log("\n" + C.rd + "凭据类文件出现在 99-凭据-credentials/ 之外" + C.r); rep.credentialsOutside.slice(0, 20).forEach((n) => console.log("  " + n)); }
    if (rep.duplicates) console.log("\n重复组 " + rep.duplicates.groups + "  浪费 " + human(rep.duplicates.wastedBytes));
    console.log("\n" + (rep.ok ? C.g + "✓ 库根合规" + C.r : C.y + "! " + rep.notes.length + " 条待处理" + C.r));
    rep.notes.forEach((n) => console.log("  - " + n));
    return;
  }
  if (action === "dups") {
    const d = findDuplicates(dir, { maxHashBytes: flags.maxHashBytes });
    if (flags.json) { console.log(JSON.stringify(d, null, 2)); return; }
    console.log(C.b + "Noesis · 查重" + C.r + "  " + d.root + C.dim + "  (扫描 " + d.scanned + " 个文件)" + C.r);
    if (!d.groups.length) { console.log(C.g + "✓ 无内容级重复" + C.r); return; }
    console.log("  重复组 " + d.groups.length + "  可回收 " + human(d.wastedBytes));
    d.groups.slice(0, 20).forEach((g, i) => {
      console.log("\n " + (i + 1) + ". " + human(g.bytes) + " x" + g.count + "  " + C.dim + g.hash.slice(0, 12) + C.r);
      g.paths.forEach((p, j) => console.log("    " + (j === 0 ? C.g + "keep" + C.r : C.rd + "dup " + C.r) + " " + p));
    });
    return;
  }
  if (action === "index") {
    const root = resolve(dir);
    const out = renderIndex(root);
    const p = join(root, "INDEX.md");
    writeFileSync(p, out);
    if (flags.json) { console.log(JSON.stringify({ root, path: p, lines: out.split("\n").length }, null, 2)); return; }
    console.log(C.g + "✓ INDEX.md 已重生成" + C.r + "  " + p + C.dim + "  (" + out.split("\n").length + " 行)" + C.r);
    return;
  }
  if (action === "open") return cmdUi(dir, flags);
  console.error(C.rd + "library 子命令: init | check | dups | index | open | volumes | home | manual | log | undo | pack" + C.r);
  process.exit(1);
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
  if (cmd === "related") return cmdRelated(rest[0] || ".", rest[1] || "", flags);
  if (cmd === "stats") return cmdStats(rest[0] || ".", flags);
  if (cmd === "graph") return cmdGraph(rest[0] || ".", flags);
  if (cmd === "doctor") return cmdDoctor(rest[0] || ".", flags);
  if (cmd === "mcp") return cmdMcp(rest[0] || ".");
  if (cmd === "tidy") return cmdTidy(rest[0] || ".", flags);
  if (cmd === "sync") return cmdSync(rest[0] || ".", flags);
  if (cmd === "onboard") return cmdOnboard(rest[0] || ".", flags);
  if (cmd === "undo") {
    const r = undoOp(rest[0] || ".", rest[1] || "", { dry: flags.dry, actor: flags.actor || "agent" });
    if (flags.json) { console.log(JSON.stringify(r, null, 2)); return; }
    if (r.error) { console.error(C.rd + r.error + C.r); process.exit(2); }
    console.log(C.b + "撤销" + C.r + "  " + (r.op_id || "") + (r.dry ? C.y + "  (dry-run)" + C.r : ""));
    (r.plan || []).forEach((p) => console.log("  " + p.action + "  " + p.src));
    console.log((r.dry ? "计划还原 " : "已还原 ") + r.applied + " 项");
    return;
  }
  if (cmd === "library") return cmdLibrary(rest[0] || "check", rest[1] || ".", flags, rest.slice(2));
  if (cmd === "ui") return cmdUi(rest[0] || ".", flags);
  if (cmd === "serve") {
    const cfg = loadConfig(rest[0] || ".");
    const loaded = loadVaultOrExit(cfg, flags);
    const s = startServer(loaded.idx, cfg, { port: flags.port, host: flags.host, token: flags.token, watch: false });
    console.log(C.g + "✓" + C.r + " Noesis 服务已启动  http://" + (flags.host || "127.0.0.1") + ":" + s.port);
    return s.server;
  }
  console.error(C.rd + "未知命令: " + cmd + C.r + "\n\n" + HELP);
  process.exit(1);
}

main();
