// Noesis · tiny local server: /api/search + /api/stats + minimal UI (zero deps).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSearch } from "./search.mjs";

const PAGE = [
  "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
  "<title>Noesis</title><style>",
  "body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:820px;margin:6vh auto;padding:0 18px;color:#1b1f27;background:#fafbfc}",
  "h1{font-size:20px;margin:0 0 14px}input{width:100%;padding:12px 14px;font-size:16px;border:1px solid #d7dbe0;border-radius:10px;outline:none}",
  "input:focus{border-color:#6b7cff}.meta{color:#7a8493;font-size:13px;margin:10px 0}",
  ".hit{padding:12px 0;border-bottom:1px solid #eceff3}.t{font-weight:600}.p{color:#7a8493;font-size:12px}.s{color:#4a5260;font-size:14px;margin-top:4px}",
  "mark{background:#fff2a8}</style></head><body>",
  "<h1>Noesis · 本地知识检索</h1>",
  "<input id=\"q\" placeholder=\"输入关键词，回车检索…\" autofocus>",
  "<div class=\"meta\" id=\"meta\"></div><div id=\"out\"></div>",
  "<script>",
  "var q=document.getElementById('q'),out=document.getElementById('out'),meta=document.getElementById('meta');",
  "function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}",
  "function run(){var v=q.value.trim();if(!v){out.innerHTML='';meta.textContent='';return;}",
  "fetch('/api/search?limit=20&q='+encodeURIComponent(v)).then(function(r){return r.json();}).then(function(d){",
  "meta.textContent='命中 '+d.total+' 条';out.innerHTML='';",
  "d.hits.forEach(function(h){var el=document.createElement('div');el.className='hit';",
  "el.innerHTML='<div class=\"t\">'+esc(h.title)+'</div><div class=\"p\">'+esc(h.path)+'</div><div class=\"s\">'+esc(h.snippet||'')+'</div>';",
  "out.appendChild(el);});});}",
  "q.addEventListener('keydown',function(e){if(e.key==='Enter')run();});",
  "</script></body></html>"
].join("\n");

export function startServer(idx, cfg, port) {
  const readText = (p) => { try { return readFileSync(join(cfg.root, p), "utf8"); } catch (e) { return ""; } };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q") || "";
      const limit = Number(url.searchParams.get("limit") || 10);
      const out = runSearch(idx, cfg, q, { limit, readText });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        query: q, total: out.total,
        hits: out.hits.map((h) => ({ path: h.doc.path, title: h.doc.title, tags: h.doc.tags, score: h.score, snippet: h.snippet }))
      }));
      return;
    }
    if (url.pathname === "/api/stats") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(idx.stats || {}));
      return;
    }
    if (url.pathname.startsWith("/doc/")) {
      const p = decodeURIComponent(url.pathname.slice(5));
      try {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(readText(p));
      } catch (e) { res.writeHead(404); res.end("not found"); }
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  const listenPort = port || 4317;
  server.listen(listenPort);
  return { server, port: listenPort };
}
