// Noesis · reproducible micro-benchmark (zero dependencies).
// Usage: node bench/benchmark.mjs [N]
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig } from "../src/config.mjs";
import { parseDoc } from "../src/corpus.mjs";
import { buildIndex, serializeIndex, deserializeIndex, createSearcher, indexStats } from "../src/index.mjs";

const N = Number(process.argv[2] || 2000);
const DIR = mkdtempSync(join(tmpdir(), "noesis-bench-"));

const CJK = ("知识 检索 索引 文档 语言 模型 数据 结构 算法 系统 网络 安全 性能 存储 优化 查询 排序 相关 更新 增量 分词 压缩 效率 知识库 本地 云端 笔记 链接 图谱 语义 向量 倒排 词项 频率").split(" ");
const EN = "search index document query ranking corpus token storage compact vector graph note link latency build memory".split(" ");

function rand(a) { return a[Math.floor(Math.random() * a.length)]; }

function makeDoc() {
  const title = rand(CJK) + rand(CJK) + rand(CJK);
  let body = "# " + title + "\n\n";
  const lines = 30 + Math.floor(Math.random() * 30);
  for (let k = 0; k < lines; k++) {
    let line = "";
    const m = 8 + Math.floor(Math.random() * 12);
    for (let j = 0; j < m; j++) {
      if (Math.random() < 0.62) line += rand(CJK);
      else { line += (line && !line.endsWith(" ") ? " " : "") + rand(EN); }
    }
    body += line + "。\n";
  }
  return "---\ntitle: " + title + "\ntags: [bench]\ndate: 2026-10-11\n---\n\n" + body;
}

let bytes = 0;
const tGen0 = performance.now();
const paths = [];
for (let i = 0; i < N; i++) {
  const sub = join(DIR, "d" + (i % 50));
  mkdirSync(sub, { recursive: true });
  const p = join(sub, "doc-" + i + ".md");
  const content = makeDoc();
  bytes += Buffer.byteLength(content);
  writeFileSync(p, content);
  paths.push(p);
}
const tGen = performance.now() - tGen0;

const cfg = loadConfig(DIR);
const tParse0 = performance.now();
const entries = [];
for (const p of paths) { const doc = parseDoc(p, DIR, cfg); entries.push({ doc, tokens: doc.tokens }); }
const tParse = performance.now() - tParse0;

const tBuild0 = performance.now();
const idx = buildIndex(entries, cfg);
const tBuild = performance.now() - tBuild0;

const tSer0 = performance.now();
const buf = serializeIndex(idx, {});
const tSer = performance.now() - tSer0;

const tDes0 = performance.now();
const back = deserializeIndex(buf);
const tDes = performance.now() - tDes0;

const search = createSearcher(back, cfg);
const queries = [];
for (let i = 0; i < 1000; i++) queries.push(rand(CJK) + " " + rand(CJK));
const tQ0 = performance.now();
let hitsSum = 0;
for (const q of queries) hitsSum += search(q, { limit: 10 }).total;
const tQ = performance.now() - tQ0;

const stats = indexStats(buf, back);
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

console.log("Noesis benchmark · N=" + N);
console.log("  corpus bytes      " + mb(bytes));
console.log("  docs              " + idx.N);
console.log("  terms             " + idx.terms.size);
console.log("  postings          " + stats.postings);
console.log("  index bytes       " + kb(buf.length) + "  (raw " + kb(stats.indexRawBytes) + ", ratio " + (buf.length / bytes * 100).toFixed(2) + "% of corpus)");
console.log("  generate          " + tGen.toFixed(0) + " ms");
console.log("  parse+tokenize    " + tParse.toFixed(0) + " ms  (" + (N / (tParse / 1000)).toFixed(0) + " docs/s)");
console.log("  build postings    " + tBuild.toFixed(0) + " ms");
console.log("  serialize         " + tSer.toFixed(0) + " ms");
console.log("  deserialize       " + tDes.toFixed(0) + " ms");
console.log("  search 1000 q     " + tQ.toFixed(0) + " ms  (" + (1000 / (tQ / 1000)).toFixed(0) + " q/s, avg " + (tQ / 1000).toFixed(3) + " ms/q)");
console.log("  total build       " + (tParse + tBuild + tSer).toFixed(0) + " ms");

rmSync(DIR, { recursive: true, force: true });
