// Noesis · query layer: filters, ranking, snippets (zero dependencies).
import { tokenize } from "./tokenize.mjs";
import { createSearcher } from "./index.mjs";

export function parseQuery(raw) {
  const filters = { tags: [], paths: [], phrases: [], neg: [] };
  const terms = [];
  const s = String(raw == null ? "" : raw);
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) { filters.phrases.push(m[1]); continue; }
    const tok = m[2];
    if (tok.startsWith("tag:")) filters.tags.push(tok.slice(4).toLowerCase());
    else if (tok.startsWith("path:")) filters.paths.push(tok.slice(5).toLowerCase());
    else if (tok.startsWith("-") && tok.length > 1) filters.neg.push(tok.slice(1).toLowerCase());
    else terms.push(tok);
  }
  return { terms, filters, text: s };
}

export function snippetFrom(text, terms, maxLen) {
  if (!text) return "";
  const body = String(text).replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
  const flat = body.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  let best = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = lower.indexOf(t);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  maxLen = maxLen || 200;
  const start = best < 0 ? 0 : Math.max(0, best - Math.floor(maxLen / 3));
  let snip = flat.slice(start, start + maxLen);
  if (start > 0) snip = "…" + snip;
  if (start + maxLen < flat.length) snip = snip + "…";
  return snip;
}

export function runSearch(idx, cfg, rawQuery, opts) {
  opts = opts || {};
  const q = parseQuery(rawQuery);
  const searcher = createSearcher(idx, cfg);
  const queryText = q.terms.length ? q.terms.join(" ") : rawQuery;
  const result = searcher(queryText, { limit: 1e9 });
  let hits = result.hits;

  if (q.filters.tags.length) {
    hits = hits.filter((h) => {
      const tags = (h.doc.tags || []).map((x) => String(x).toLowerCase());
      return q.filters.tags.every((t) => tags.includes(t));
    });
  }
  if (q.filters.paths.length) {
    hits = hits.filter((h) => {
      const p = String(h.doc.path).toLowerCase();
      return q.filters.paths.every((x) => p.includes(x));
    });
  }
  if (q.filters.neg.length) {
    hits = hits.filter((h) => {
      const blob = (String(h.doc.path) + " " + String(h.doc.title) + " " + (h.doc.tags || []).join(" ")).toLowerCase();
      return !q.filters.neg.some((n) => blob.includes(n));
    });
  }
  hits = hits.slice(0, opts.limit || 10);
  if (opts.readText) {
    const qs = tokenize(queryText, { bigrams: cfg.bigrams });
    for (const h of hits) h.snippet = snippetFrom(opts.readText(h.doc.path), qs, cfg.snippetLength);
  }
  return { total: hits.length, hits, query: q };
}
