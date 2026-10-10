// Noesis · wiki-link graph: backlinks, orphans, hubs, dangling links.
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
