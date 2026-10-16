// Noesis · local server (zero dependencies).
// 易用性：键盘优先的即时检索 UI（/ 聚焦 · ↑↓ 选择 · Enter 预览 · Esc 清空）+ 目录/标签筛选。
// 性能：索引与 searcher 常驻内存、文档按 mtime 缓存、watch 变更后自动重建 —— 检索永远是热的、新的。
import { createServer } from "node:http";
import { readFileSync, statSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import { runSearch } from "./search.mjs";
import { createSearcher } from "./index.mjs";

const UI_HTML = readFileSync(new URL("./ui.html", import.meta.url), "utf8");

function human(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

// portOrOpts: number(向后兼容) 或 { port, watch, rebuild, bootMs, label }
// label：界面顶栏显示的名字（不填则显示 vault 绝对路径）—— 公开截图时用它避免暴露本机路径。
export function startServer(idx, cfg, portOrOpts) {
  const opts = portOrOpts && typeof portOrOpts === "object" ? portOrOpts : { port: portOrOpts };
  const state = { idx, searcher: createSearcher(idx, cfg), bootMs: opts.bootMs || 0, rebuiltAt: 0, rebuilds: 0 };
  const textCache = new Map();

  const readText = (p) => {
    try {
      const abs = join(cfg.root, p);
      const st = statSync(abs);
      const hit = textCache.get(p);
      if (hit && hit.mtimeMs === st.mtimeMs) return hit.text;
      const text = readFileSync(abs, "utf8");
      if (textCache.size > 500) textCache.clear();
      textCache.set(p, { mtimeMs: st.mtimeMs, text });
      return text;
    } catch (e) { return ""; }
  };

  const facets = () => {
    const dirs = new Map();
    const tags = new Map();
    for (const d of state.idx.docs) {
      const top = String(d.path).split("/")[0];
      if (!top || top === String(d.path)) continue;
      dirs.set(top, (dirs.get(top) || 0) + 1);
      for (const t of d.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    }
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
    return { dirs: top(dirs, 24), tags: top(tags, 30) };
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    if (p === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 20) || 20, 200);
      const t0 = process.hrtime.bigint();
      const out = runSearch(state.idx, cfg, q, { limit, readText, searcher: state.searcher });
      json(res, 200, {
        query: q, total: out.total, ms: Number(process.hrtime.bigint() - t0) / 1e6,
        hits: out.hits.map((h) => ({ path: h.doc.path, title: h.doc.title, tags: h.doc.tags, score: h.score, snippet: h.snippet })),
      });
      return;
    }

    if (p === "/api/stats") {
      const s = state.idx.stats || {};
      json(res, 200, {
        root: cfg.root, label: opts.label || null, documents: state.idx.N, terms: state.idx.terms.size,
        indexBytes: s.indexBytes || 0, indexBytesHuman: human(s.indexBytes || 0),
        bootMs: Math.round(state.bootMs), rebuilds: state.rebuilds, rebuiltAt: state.rebuiltAt,
      });
      return;
    }

    if (p === "/api/facets") { json(res, 200, facets()); return; }

    if (p === "/api/doc") {
      const rel = url.searchParams.get("path") || "";
      const doc = state.idx.docs.find((d) => d.path === rel);
      if (!doc) { json(res, 404, { error: "not_found", path: rel }); return; }
      json(res, 200, { path: doc.path, title: doc.title, tags: doc.tags || [], text: readText(rel) });
      return;
    }

    if (p === "/api/health") { json(res, 200, { ok: true, docs: state.idx.N, rebuilds: state.rebuilds }); return; }

    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(UI_HTML);
      return;
    }
    json(res, 404, { error: "not_found", path: p });
  });

  const listenPort = opts.port == null ? 4317 : opts.port;
  server.listen(listenPort);

  // watch：内容变更后自动增量重建，检索结果永不过期（无人工刷新）。
  if (opts.watch && typeof opts.rebuild === "function") {
    let timer = null;
    let running = false;
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (running) return;
        running = true;
        try {
          const next = await opts.rebuild();
          if (next) {
            state.idx = next;
            state.searcher = createSearcher(next, cfg);
            state.rebuilds += 1;
            state.rebuiltAt = Date.now();
            textCache.clear();
          }
        } catch (e) { /* 重建失败不影响已加载索引 */ }
        running = false;
      }, 350);
    };
    try {
      const w = fsWatch(cfg.root, { recursive: true }, (ev, f) => {
        if (f && String(f).includes(".noesis")) return;
        trigger();
      });
      server.on("close", () => { try { w.close(); } catch (e) {} });
    } catch (e) { /* 平台不支持 recursive watch 时静默降级 */ }
  }

  return { server, port: listenPort, setIndex: (next) => { state.idx = next; state.searcher = createSearcher(next, cfg); } };
}
