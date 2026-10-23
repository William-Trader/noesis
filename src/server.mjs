// Noesis · local server (zero dependencies).
//
// Local-first means local by default: the server binds 127.0.0.1 unless a host is
// given explicitly, and an optional token guards every API route.
import { createServer } from "node:http";
import { readFileSync, statSync, watch as fsWatch } from "node:fs";
import { join } from "node:path";
import { runSearch } from "./search.mjs";
import { createSearcher } from "./index.mjs";
import { linkAuthority, relatedDocs } from "./graph.mjs";
import { ensureState, countDrift, segmentBytes } from "./segments.mjs";
import { readCachedUpdate, currentVersion } from "./update.mjs";

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

function authorized(req, url, token) {
  if (!token) return true;
  if (url.searchParams.get("token") === token) return true;
  const h = req.headers.authorization || "";
  return h === "Bearer " + token;
}

// portOrOpts: number(向后兼容) 或 { port, host, token, watch, rebuild, bootMs, label, state }
export function startServer(idx, cfg, portOrOpts) {
  const opts = portOrOpts && typeof portOrOpts === "object" ? portOrOpts : { port: portOrOpts };
  const token = opts.token || cfg.token || process.env.NOESIS_TOKEN || "";
  const host = opts.host || cfg.host || "127.0.0.1";
  const state = { idx, searcher: createSearcher(idx, cfg), authority: null, bootMs: opts.bootMs || 0, rebuiltAt: 0, rebuilds: 0 };
  const textCache = new Map();
  let liveState = opts.state || null;
  let driftCache = { at: 0, value: 0 };

  const authority = () => {
    if (!state.authority) state.authority = linkAuthority(state.idx.docs);
    return state.authority;
  };

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

  const drift = () => {
    const now = Date.now();
    if (driftCache.value && now - driftCache.at < 5000) return driftCache.value;
    try {
      if (!liveState) liveState = ensureState(cfg);
      const v = countDrift(cfg, liveState);
      driftCache = { at: now, value: v };
      return v;
    } catch (e) { return driftCache.value || 0; }
  };

  const facets = () => {
    const dirs = new Map();
    const tags = new Map();
    for (const d of state.idx.docs) {
      if (d.kind === "passage") continue;
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

    if (p === "/api/health") { json(res, 200, { ok: true, docs: state.idx.N, rebuilds: state.rebuilds }); return; }
    if (p === "/api/version") {
      const cached = readCachedUpdate(join(cfg.indexDir, "update.json"));
      json(res, 200, {
        version: currentVersion(),
        latest: cached && cached.data ? cached.data.latest : null,
        updateAvailable: cached && cached.data ? !!cached.data.updateAvailable : false,
        releaseUrl: cached && cached.data ? cached.data.releaseUrl : null,
        checkedAt: cached ? new Date(cached.at).toISOString() : null
      });
      return;
    }
    if (!authorized(req, url, token)) { json(res, 401, { error: "unauthorized" }); return; }

    if (p === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 20) || 20, 200);
      const t0 = process.hrtime.bigint();
      const out = runSearch(state.idx, cfg, q, { limit, readText, searcher: state.searcher, authority: authority() });
      json(res, 200, {
        query: q, total: out.total, returned: out.returned, ms: Number(process.hrtime.bigint() - t0) / 1e6,
        as_of: new Date(state.idx.builtAt || 0).toISOString(), drift: drift(),
        hits: out.hits.map((h) => ({
          path: h.doc.path, title: h.doc.title, tags: h.doc.tags, section: h.section || null,
          score: h.score, snippet: h.snippet
        })),
      });
      return;
    }

    if (p === "/api/related") {
      const rel = url.searchParams.get("path") || "";
      const limit = Math.min(Number(url.searchParams.get("limit") || 10) || 10, 50);
      json(res, 200, { path: rel, related: relatedDocs(state.idx.docs, rel, { limit }) });
      return;
    }

    if (p === "/api/stats") {
      const docs = state.idx.docs.filter((d) => d.kind !== "passage").length;
      let bytes = 0;
      try {
        if (!liveState) liveState = ensureState(cfg);
        bytes = segmentBytes(cfg, liveState);
      } catch (e) { bytes = 0; }
      json(res, 200, {
        root: cfg.root, label: opts.label || null, documents: docs, passages: state.idx.N - docs,
        terms: state.idx.terms.size, segments: state.idx.stats ? state.idx.stats.segments : 1,
        indexBytes: bytes, indexBytesHuman: human(bytes),
        as_of: new Date(state.idx.builtAt || 0).toISOString(), drift: drift(),
        bootMs: Math.round(state.bootMs), rebuilds: state.rebuilds, rebuiltAt: state.rebuiltAt,
      });
      return;
    }

    if (p === "/api/facets") { json(res, 200, facets()); return; }

    if (p === "/api/doc") {
      const rel = url.searchParams.get("path") || "";
      const doc = state.idx.docs.find((d) => d.path === rel && d.kind !== "passage");
      if (!doc) { json(res, 404, { error: "not_found", path: rel }); return; }
      json(res, 200, { path: doc.path, title: doc.title, tags: doc.tags || [], text: readText(rel) });
      return;
    }

    if (p === "/" || p === "/index.html") {
      let html = UI_HTML;
      if (token) html = html.replace("</head>", "<script>window.__NOESIS_TOKEN__=" + JSON.stringify(token) + "</script></head>");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
      return;
    }
    json(res, 404, { error: "not_found", path: p });
  });

  const listenPort = opts.port == null ? 4317 : opts.port;
  server.listen(listenPort, host);

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
            state.authority = null;
            state.rebuilds += 1;
            state.rebuiltAt = Date.now();
            liveState = ensureState(cfg);
            driftCache = { at: 0, value: 0 };
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

  return {
    server, port: listenPort, host,
    setIndex: (next) => { state.idx = next; state.searcher = createSearcher(next, cfg); state.authority = null; }
  };
}
