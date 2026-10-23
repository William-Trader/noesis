// Noesis · segment store (append-only index, zero dependencies).
//
// A build no longer rewrites the whole index: it appends one segment with the
// documents that changed. Queries merge segments in order, later segments win,
// and compaction folds them back into one when it pays off.
//
// On disk:
//   .noesis/manifest.json   { version:2, segments:[{file,builtAt,rows}], docs:{path:{...}} }
//   .noesis/segments/seg-00001.bin
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { serializeIndex, deserializeIndex, buildIndex, mergeIndexes } from "./index.mjs";
import { walk } from "./corpus.mjs";

export const MANIFEST_VERSION = 2;
export const SEG_DIR = "segments";
export const MAX_SEGMENTS = 8;

function pad(n) {
  let s = String(n);
  while (s.length < 5) s = "0" + s;
  return s;
}

export function segmentDir(cfg) {
  return join(cfg.indexDir, SEG_DIR);
}

export function manifestPath(cfg) {
  return join(cfg.indexDir, "manifest.json");
}

export function readManifest(cfg) {
  const p = manifestPath(cfg);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { return null; }
}

export function saveManifest(cfg, state) {
  mkdirSync(cfg.indexDir, { recursive: true });
  writeFileSync(manifestPath(cfg), JSON.stringify(state));
}

function nextSegmentIndex(dir) {
  let max = -1;
  try {
    for (const f of readdirSync(dir)) {
      if (!f.startsWith("seg-") || !f.endsWith(".bin")) continue;
      const n = Number(f.slice(4, f.length - 4));
      if (Number.isFinite(n) && n > max) max = n;
    }
  } catch (e) { /* empty dir */ }
  return max + 1;
}

function legacyIndexPath(cfg) {
  return join(cfg.indexDir, "index.bin");
}

// Create a state, migrating a v1 index.bin into segment 0 when needed.
export function ensureState(cfg) {
  const m = readManifest(cfg);
  if (m && m.version === MANIFEST_VERSION && Array.isArray(m.segments)) return m;

  const legacy = legacyIndexPath(cfg);
  if (existsSync(legacy)) {
    try {
      const idx = deserializeIndex(readFileSync(legacy));
      const dir = segmentDir(cfg);
      mkdirSync(dir, { recursive: true });
      const rows = idx.docs.map((d) => {
        const row = Object.assign({}, d);
        row.key = row.key || "doc:" + row.path;
        row.kind = row.kind || "doc";
        return row;
      });
      const file = "seg-" + pad(0) + ".bin";
      const bytes = serializeIndex({ N: idx.N, avgdl: idx.avgdl, builtAt: idx.builtAt || Date.now(), docs: rows, terms: idx.terms }, idx.stats || {}, { segment: true });
      writeFileSync(join(dir, file), bytes);
      const state = { version: MANIFEST_VERSION, builtAt: idx.builtAt || Date.now(), segments: [{ file, builtAt: idx.builtAt || Date.now(), rows: rows.length }], docs: {} };
      for (const d of rows) {
        if (d.kind === "passage") continue;
        state.docs[d.path] = { mtimeMs: d.mtimeMs, bytes: d.bytes, hash: d.hash, length: d.length, seg: 0, key: d.key };
      }
      saveManifest(cfg, state);
      try { unlinkSync(legacy); } catch (e) { /* keep it if locked */ }
      return state;
    } catch (e) { /* fall through to an empty state */ }
  }
  return { version: MANIFEST_VERSION, builtAt: 0, segments: [], docs: {} };
}

export function writeSegment(cfg, entries, stats) {
  const dir = segmentDir(cfg);
  mkdirSync(dir, { recursive: true });
  const idx = buildIndex(entries, cfg);
  const buf = serializeIndex(idx, stats || {}, { segment: true });
  const n = nextSegmentIndex(dir);
  const file = "seg-" + pad(n) + ".bin";
  writeFileSync(join(dir, file), buf);
  return { file, rows: idx.docs.length, bytes: buf.length, builtAt: idx.builtAt, idx };
}

// Load and merge segments. opts.asOf restricts to segments built at/before a time,
// which gives time-travel search for free (later segment still wins per path).
export function loadVault(cfg, opts = {}) {
  const state = opts.state || ensureState(cfg);
  const asOf = opts.asOf || 0;
  const segs = state.segments.filter((s) => !asOf || (s.builtAt || 0) <= asOf);
  const parts = [];
  const claimed = new Map();
  const tombs = new Map();
  for (const t of state.tombstones || []) {
    if (asOf && t.at > asOf) continue;
    const prev = tombs.get(t.path);
    if (!prev || t.at > prev) tombs.set(t.path, t.at);
  }

  // Newest first: the first claim wins, so an older duplicate is dropped.
  const loaded = [];
  for (let i = 0; i < segs.length; i += 1) {
    const p = join(segmentDir(cfg), segs[i].file);
    if (!existsSync(p)) continue;
    let idx;
    try { idx = deserializeIndex(readFileSync(p)); } catch (e) { continue; }
    loaded.push({ segIndex: i, meta: segs[i], idx });
  }
  for (let j = loaded.length - 1; j >= 0; j -= 1) {
    const item = loaded[j];
    for (const d of item.idx.docs) {
      const key = d.key || (d.kind === "passage" ? "psg:" + d.path + "#" + d.start : "doc:" + d.path);
      if (claimed.has(key)) continue;
      const dead = tombs.get(d.path);
      if (dead !== undefined && dead >= (item.meta.builtAt || 0)) continue;
      claimed.set(key, { segIndex: item.segIndex, key });
    }
  }

  const docs = [];
  for (const item of loaded) {
    const idMap = new Int32Array(item.idx.docs.length).fill(-1);
    for (let r = 0; r < item.idx.docs.length; r += 1) {
      const d = item.idx.docs[r];
      const key = d.key || (d.kind === "passage" ? "psg:" + d.path + "#" + d.start : "doc:" + d.path);
      const c = claimed.get(key);
      if (!c || c.segIndex !== item.segIndex) continue;
      idMap[r] = docs.length;
      docs.push(d);
    }
    parts.push({ idx: item.idx, idMap });
  }

  const merged = mergeIndexes(parts, docs);
  merged.builtAt = state.builtAt || merged.builtAt;
  merged.stats = { segments: loaded.length, rows: docs.length };
  return { idx: merged, state, segments: loaded.length, asOf };
}

// Fold every live row into a single segment.
export function compact(cfg, state) {
  const loaded = loadVault(cfg, { state });
  const dir = segmentDir(cfg);
  mkdirSync(dir, { recursive: true });
  const file = "seg-" + pad(nextSegmentIndex(dir)) + ".bin";
  const buf = serializeIndex(loaded.idx, { compacted: true }, { segment: true });
  writeFileSync(join(dir, file), buf);

  const old = state.segments.map((s) => s.file);
  state.segments = [{ file, builtAt: Date.now(), rows: loaded.idx.N }];
  state.builtAt = Date.now();
  state.tombstones = [];
  for (const k of Object.keys(state.docs)) state.docs[k].seg = 0;
  saveManifest(cfg, state);
  for (const f of old) {
    try { unlinkSync(join(dir, f)); } catch (e) { /* already gone */ }
  }
  return { file, rows: loaded.idx.N, bytes: buf.length };
}

export function segmentBytes(cfg, state) {
  let total = 0;
  for (const s of state.segments) {
    try { total += statSync(join(segmentDir(cfg), s.file)).size; } catch (e) { /* ignore */ }
  }
  return total;
}

// How many files on disk disagree with the manifest (index freshness).
export function countDrift(cfg, state) {
  let drift = 0;
  const seen = new Set();
  const files = walk(cfg.root, cfg);
  for (const f of files) {
    const rel = f.slice(cfg.root.length + 1).split("\\").join("/");
    seen.add(rel);
    const rec = state.docs[rel];
    if (!rec) { drift += 1; continue; }
    let st;
    try { st = statSync(f); } catch (e) { drift += 1; continue; }
    if (rec.mtimeMs !== Math.floor(st.mtimeMs) || rec.bytes !== st.size) drift += 1;
  }
  for (const rel of Object.keys(state.docs)) if (!seen.has(rel)) drift += 1;
  return drift;
}
