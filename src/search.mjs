// Noesis · query layer: filters, ranking, phrase verification, snippets.
//
// Three things this layer is strict about:
//   1. total is counted before the limit is applied (pagination needs it);
//   2. a quoted "phrase" is verified literally, not just tokenised;
//   3. passage rows boost their parent document and supply the snippet.
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

// Collapse whitespace without a regex, so phrase matching is literal.
export function squashSpace(s) {
  let out = "";
  let prevSpace = false;
  const text = String(s == null ? "" : s).toLowerCase();
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const isSpace = ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
    if (isSpace) {
      if (!prevSpace) out += " ";
      prevSpace = true;
    } else {
      out += ch;
      prevSpace = false;
    }
  }
  return out.trim();
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

function matchesFilters(doc, filters) {
  if (filters.tags.length) {
    const tags = (doc.tags || []).map((x) => String(x).toLowerCase());
    if (!filters.tags.every((t) => tags.includes(t))) return false;
  }
  if (filters.paths.length) {
    const p = String(doc.path).toLowerCase();
    if (!filters.paths.every((x) => p.includes(x))) return false;
  }
  if (filters.neg.length) {
    const blob = (String(doc.path) + " " + String(doc.title) + " " + (doc.tags || []).join(" ")).toLowerCase();
    if (filters.neg.some((n) => blob.includes(n))) return false;
  }
  return true;
}

export function runSearch(idx, cfg, rawQuery, opts) {
  opts = opts || {};
  const q = parseQuery(rawQuery);
  const limit = opts.limit || 10;
  const phrases = q.filters.phrases;
  if (!q.terms.length && !phrases.length) {
    return { total: 0, returned: 0, hits: [], query: q, phrases: 0, phraseTruncated: false };
  }

  const searcher = opts.searcher || createSearcher(idx, cfg);
  const queryText = q.terms.length ? q.terms.join(" ") : phrases.join(" ");
  const result = searcher(queryText, { limit: idx.N + 1 });

  const docHits = [];
  const best = new Map();
  for (const h of result.hits) {
    if (h.doc.kind === "passage") {
      const cur = best.get(h.doc.parent);
      if (!cur || h.score > cur.score) best.set(h.doc.parent, h);
    } else {
      docHits.push({ score: h.score, doc: h.doc, di: h.di });
    }
  }

  const passageBoost = cfg.passageBoost == null ? 0.35 : cfg.passageBoost;
  for (const h of docHits) {
    const p = best.get(h.doc.path);
    if (p) {
      h.docScore = h.score;
      h.score = h.score + passageBoost * p.score;
      h.section = p.doc.heading || "";
      h.range = { start: p.doc.start, end: p.doc.end };
    }
  }

  let hits = docHits.filter((h) => matchesFilters(h.doc, q.filters));

  const authority = opts.authority;
  if (authority && cfg.authorityBoost) {
    for (const h of hits) {
      const a = authority[h.di] || 0;
      if (a > 0) h.score = h.score * (1 + cfg.authorityBoost * a);
    }
  }

  let phraseTruncated = false;
  if (phrases.length && opts.readText) {
    const want = phrases.map(squashSpace).filter(Boolean);
    const verifyLimit = opts.verifyLimit || 2000;
    if (hits.length > verifyLimit) phraseTruncated = true;
    const pool = hits.slice(0, verifyLimit);
    hits = pool.filter((h) => {
      const text = squashSpace(opts.readText(h.doc.path));
      return want.every((p) => text.includes(p));
    });
  }

  const total = hits.length;
  hits.sort((x, y) => y.score - x.score || String(x.doc.path).localeCompare(String(y.doc.path)));
  const page = hits.slice(0, limit);

  if (opts.readText) {
    const qs = tokenize(queryText, { bigrams: cfg.bigrams });
    for (const h of page) {
      let text = "";
      if (h.range && h.doc.bodyStart != null) {
        const full = opts.readText(h.doc.path);
        text = full.slice(h.doc.bodyStart + h.range.start, h.doc.bodyStart + h.range.end);
      }
      if (!text) text = opts.readText(h.doc.path);
      h.snippet = snippetFrom(text, qs, cfg.snippetLength);
    }
  }

  return { total, returned: page.length, hits: page, query: q, phrases: phrases.length, phraseTruncated };
}
