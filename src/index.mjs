// Noesis · inverted index: compact build, binary (de)serialize, BM25 query.
// Zero dependencies. On disk: .noesis/index.bin = gzip( compact binary ).
import { gzipSync, gunzipSync } from "node:zlib";
import { ByteWriter, ByteReader } from "./varint.mjs";
import { tokenize, tokenizeUnique } from "./tokenize.mjs";

export const MAGIC = "NOESIS01";
export const VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

function termMapOf(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

// entries: [{ doc, termMap? , tokens? }]
export function buildIndex(entries, cfg) {
  const terms = new Map();
  let totalLen = 0;
  entries.forEach((ent, di) => {
    const tm = ent.termMap || termMapOf(ent.tokens || []);
    let len = 0;
    for (const pair of tm) {
      const term = pair[0];
      const tf = pair[1];
      len += tf;
      let e = terms.get(term);
      if (!e) { e = { df: 0, postings: [] }; terms.set(term, e); }
      e.df += 1;
      e.postings.push([di, tf]);
    }
    ent.doc.length = len;
    totalLen += len;
  });
  const N = entries.length;
  return {
    N,
    avgdl: N ? totalLen / N : 0,
    builtAt: Date.now(),
    docs: entries.map((e) => e.doc),
    terms
  };
}

export function serializeIndex(idx, stats) {
  const w = new ByteWriter(1 << 20);
  w.bytes(enc.encode(MAGIC));
  w.u32(VERSION);
  w.u32(idx.N);
  w.u32(idx.terms.size);
  w.f64(idx.avgdl);
  const metaBytes = enc.encode(JSON.stringify({ builtAt: idx.builtAt || Date.now(), stats: stats || {} }));
  w.u32(metaBytes.length); w.bytes(metaBytes);
  const docTable = idx.docs.map((d) => ({
    path: d.path, title: d.title, tags: d.tags, date: d.date,
    length: d.length, bytes: d.bytes, mtimeMs: d.mtimeMs, hash: d.hash,
    links: d.links || [], headings: d.headings || []
  }));
  const dtBytes = enc.encode(JSON.stringify(docTable));
  w.u32(dtBytes.length); w.bytes(dtBytes);
  const sorted = Array.from(idx.terms.keys()).sort();
  let prev = new Uint8Array(0);
  for (const term of sorted) {
    const e = idx.terms.get(term);
    const tb = enc.encode(term);
    let shared = 0;
    const max = Math.min(tb.length, prev.length);
    while (shared < max && tb[shared] === prev[shared]) shared += 1;
    w.uvarint(shared);
    w.uvarint(tb.length - shared);
    w.bytes(tb.subarray(shared));
    w.uvarint(e.df);
    const plist = e.postings;
    let pd = -1;
    for (const pair of plist) { w.uvarint(pair[0] - pd); pd = pair[0]; w.uvarint(pair[1]); }
    prev = tb;
  }
  return gzipSync(Buffer.from(w.toUint8Array()));
}

export function deserializeIndex(buf) {
  const raw = gunzipSync(buf);
  const u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const r = new ByteReader(u8);
  const magic = dec.decode(r.bytes(8));
  if (magic !== MAGIC) throw new Error("not a Noesis index (bad magic)");
  const version = r.u32();
  if (version !== VERSION) throw new Error("unsupported index version " + version);
  const N = r.u32();
  const termCount = r.u32();
  const avgdl = r.f64();
  const metaLen = r.u32();
  const meta = JSON.parse(dec.decode(r.bytes(metaLen)));
  const dtLen = r.u32();
  const docs = JSON.parse(dec.decode(r.bytes(dtLen)));
  const terms = new Map();
  let prev = new Uint8Array(0);
  for (let i = 0; i < termCount; i++) {
    const shared = r.uvarint();
    const suffixLen = r.uvarint();
    const suffix = r.bytes(suffixLen);
    const tb = new Uint8Array(shared + suffixLen);
    tb.set(prev.subarray(0, shared), 0);
    tb.set(suffix, shared);
    const term = dec.decode(tb);
    prev = tb;
    const df = r.uvarint();
    const postings = [];
    let pd = -1;
    for (let k = 0; k < df; k++) {
      pd += r.uvarint();
      postings.push([pd, r.uvarint()]);
    }
    terms.set(term, { df, postings });
  }
  return { N, avgdl, builtAt: meta.builtAt, stats: meta.stats, docs, terms };
}

export function indexStats(buf, idx) {
  let raw = 0;
  try { raw = gunzipSync(buf).length; } catch (e) { raw = 0; }
  let postings = 0;
  for (const e of idx.terms.values()) postings += e.df;
  return {
    documents: idx.N,
    terms: idx.terms.size,
    postings,
    avgDocLength: Math.round(idx.avgdl * 100) / 100,
    indexBytes: buf.length,
    indexRawBytes: raw,
    builtAt: idx.builtAt
  };
}

// Rebuild per-document term maps straight from a loaded index (enables incremental).
export function docTermMaps(idx) {
  const maps = idx.docs.map(() => new Map());
  for (const pair of idx.terms) {
    const term = pair[0];
    const e = pair[1];
    for (const pt of e.postings) maps[pt[0]].set(term, pt[1]);
  }
  return maps;
}

export function createSearcher(idx, cfg) {
  const k1 = cfg.bm25.k1;
  const b = cfg.bm25.b;
  const N = idx.N;
  const avgdl = idx.avgdl || 1;
  return function search(query, opts) {
    opts = opts || {};
    const qTerms = tokenizeUnique(query, { bigrams: cfg.bigrams });
    const scores = new Map();
    for (const qt of qTerms) {
      const e = idx.terms.get(qt);
      if (!e) continue;
      const idf = Math.log(1 + (N - e.df + 0.5) / (e.df + 0.5));
      for (const pt of e.postings) {
        const di = pt[0];
        const tf = pt[1];
        const dl = idx.docs[di].length || 1;
        const s = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));
        scores.set(di, (scores.get(di) || 0) + s);
      }
    }
    const hits = Array.from(scores.entries()).map((pair) => ({
      score: pair[1], doc: idx.docs[pair[0]]
    }));
    hits.sort((x, y) => y.score - x.score || String(x.doc.path).localeCompare(String(y.doc.path)));
    const limit = opts.limit || 10;
    return { total: hits.length, hits: hits.slice(0, limit), queryTerms: qTerms };
  };
}
