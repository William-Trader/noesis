// Noesis · wiki-link graph: backlinks, orphans, hubs, dangling links, authority.
// Resolves links by exact path, path without extension, unique filename, then unique title.

export function buildGraph(docs) {
  const byPath = new Map();
  const byBase = new Map();
  const byTitle = new Map();

  docs.forEach((d, i) => {
    const p = String(d.path);
    byPath.set(p, i);
    byPath.set(p.replace(/\.[^.]+$/, ""), i);
    const base = p.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(i);
    const title = String(d.title || "").trim().toLowerCase();
    if (title) {
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(i);
    }
  });

  function resolve(t) {
    const tt = t.trim();
    if (byPath.has(tt)) return byPath.get(tt);
    const noExt = tt.replace(/\.[^.]+$/, "");
    if (byPath.has(noExt)) return byPath.get(noExt);
    const base = noExt.split("/").pop().toLowerCase();
    const b = byBase.get(base);
    if (b && b.length === 1) return b[0];
    const ti = byTitle.get(tt.toLowerCase());
    if (ti && ti.length === 1) return ti[0];
    return undefined;
  }

  const edges = docs.map(() => []);
  const back = docs.map(() => []);
  const dangling = [];

  docs.forEach((d, i) => {
    for (const raw of (d.links || [])) {
      const t = String(raw).trim();
      const target = resolve(t);
      if (target === undefined) { dangling.push({ from: d.path, to: t }); continue; }
      if (target === i) continue;
      if (!edges[i].includes(target)) edges[i].push(target);
      if (!back[target].includes(i)) back[target].push(i);
    }
  });

  const orphans = [];
  docs.forEach((d, i) => { if (back[i].length === 0 && edges[i].length === 0) orphans.push(d.path); });
  const hubs = docs.map((d, i) => ({ path: d.path, title: d.title, backlinks: back[i].length }))
    .sort((a, b) => b.backlinks - a.backlinks);

  return { edges, back, dangling, orphans, hubs, docCount: docs.length };
}

// PageRank over the wiki-link graph, normalised to 0..1 per row.
// Passages (kind === "passage") score 0 and never contribute.
export function linkAuthority(docs, opts = {}) {
  const damping = opts.damping || 0.85;
  const iters = opts.iters || 20;
  const score = new Float64Array(docs.length);
  const idxs = [];
  for (let i = 0; i < docs.length; i += 1) if (docs[i].kind !== "passage") idxs.push(i);
  const n = idxs.length;
  if (!n) return score;
  const local = idxs.map((i) => docs[i]);
  const g = buildGraph(local);
  const out = g.edges;
  let s = new Float64Array(n).fill(1 / n);
  for (let it = 0; it < iters; it += 1) {
    const next = new Float64Array(n).fill((1 - damping) / n);
    let leak = 0;
    for (let k = 0; k < n; k += 1) {
      if (!out[k].length) { leak += damping * s[k] / n; continue; }
      const share = damping * s[k] / out[k].length;
      for (const t of out[k]) next[t] += share;
    }
    for (let k = 0; k < n; k += 1) next[k] += leak;
    s = next;
  }
  let max = 0;
  for (const v of s) if (v > max) max = v;
  for (let k = 0; k < n; k += 1) score[idxs[k]] = max ? s[k] / max : 0;
  return score;
}

// Undirected personalized PageRank from one document: "what is near this note".
export function relatedDocs(docs, path, opts = {}) {
  const limit = opts.limit || 10;
  const damping = opts.damping || 0.85;
  const iters = opts.iters || 8;
  const idxs = [];
  const pos = new Map();
  for (let i = 0; i < docs.length; i += 1) {
    if (docs[i].kind === "passage") continue;
    pos.set(docs[i].path, idxs.length);
    idxs.push(i);
  }
  const seed = pos.get(path);
  if (seed === undefined) return [];
  const local = idxs.map((i) => docs[i]);
  const g = buildGraph(local);
  const adj = local.map(() => new Set());
  for (let i = 0; i < g.edges.length; i += 1) {
    for (const t of g.edges[i]) { adj[i].add(t); adj[t].add(i); }
  }
  let s = new Float64Array(local.length);
  s[seed] = 1;
  for (let it = 0; it < iters; it += 1) {
    const next = new Float64Array(local.length);
    next[seed] += (1 - damping);
    for (let i = 0; i < local.length; i += 1) {
      const links = adj[i];
      if (!links.size) { next[seed] += damping * s[i] / local.length; continue; }
      const share = damping * s[i] / links.size;
      for (const t of links) next[t] += share;
    }
    s = next;
  }
  const rows = [];
  for (let i = 0; i < local.length; i += 1) {
    if (i === seed || s[i] <= 0) continue;
    rows.push({ path: local[i].path, title: local[i].title, score: s[i] });
  }
  rows.sort((a, b) => b.score - a.score || String(a.path).localeCompare(String(b.path)));
  return rows.slice(0, limit).map((r) => ({ path: r.path, title: r.title, score: Math.round(r.score * 10000) / 10000 }));
}
