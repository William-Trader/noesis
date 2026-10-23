// Noesis · portable round-trip (zero dependencies).
//
// The library leaves on a drive and comes back with edits. This brings those
// edits home without losing anything: a file that would be overwritten is first
// copied into an archive backup, and the mapping table records where it went.
import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { walkAll } from "./library.mjs";
import { appendJournal } from "./portable.mjs";

const SKIP = [".git", "node_modules", ".noesis", "dist", "build", "venv", ".venv", "__pycache__", "site-packages", ".DS_Store", "homebrew", ".cellar"];
const META = ["_重组映射表", "_库志", "_库位置"];

function sha(file, limit) {
  const st = statSync(file);
  if (limit && st.size > limit) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function mtimeMs(file) {
  try { return Math.floor(statSync(file).mtimeMs); } catch (e) { return 0; }
}

function stamp() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : String(n));
  return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function isMeta(rel) {
  return META.some((m) => rel.startsWith(m));
}

// Compare a carried copy against the live library and report what would come back.
export function planSync(root, fromDir, opts = {}) {
  const from = walkAll(fromDir, { skipDirs: SKIP });
  const items = [];
  for (const f of from) {
    const rel = relative(fromDir, f).split("\\").join("/");
    if (!rel || rel.startsWith("._") || isMeta(rel)) continue;
    const dst = join(root, rel);
    let action = "add";
    let why = "missing in library";
    if (existsSync(dst)) {
      const a = sha(f, opts.maxHashBytes);
      const b = sha(dst, opts.maxHashBytes);
      if (a && b && a === b) { action = "same"; why = "identical"; }
      else if (mtimeMs(f) > mtimeMs(dst)) { action = "update"; why = "copy is newer"; }
      else { action = "skip"; why = "library is newer or equal"; }
    }
    items.push({ rel, src: f, dst, action, why, bytes: statSync(f).size, mtimeMs: mtimeMs(f) });
  }
  const count = (a) => items.filter((i) => i.action === a).length;
  return {
    root, from: fromDir, total: items.length,
    add: count("add"), update: count("update"), same: count("same"), skip: count("skip"),
    items: items.filter((i) => i.action === "add" || i.action === "update"),
    hidden: count("same") + count("skip")
  };
}

// Copy planned files home. Overwrites are backed up first; nothing is deleted.
export function syncBack(root, fromDir, opts = {}) {
  const plan = planSync(root, fromDir, opts);
  if (opts.dry || !plan.items.length) return Object.assign({ dry: !!opts.dry, applied: 0 }, plan);

  const backupDir = join(root, "05-归档-archive", "_sync-backup-" + stamp());
  const rows = [];
  let applied = 0;
  for (const it of plan.items) {
    try {
      mkdirSync(dirname(it.dst), { recursive: true });
      if (it.action === "update") {
        const bak = join(backupDir, it.rel);
        mkdirSync(dirname(bak), { recursive: true });
        copyFileSync(it.dst, bak);
        rows.push({ src: bak, dst: it.dst, type: "file" });
      }
      copyFileSync(it.src, it.dst);
      applied += 1;
    } catch (e) { it.error = String(e && e.message ? e.message : e); }
  }

  let mapping = null;
  if (rows.length) {
    mapping = join(root, "_重组映射表-sync-" + stamp() + ".csv");
    writeFileSync(mapping, "src,dst,type\n" + rows.map((r) => r.src + "," + r.dst + "," + r.type).join("\n") + "\n");
  }

  appendJournal(root, {
    op: "sync",
    detail: "从 " + fromDir + " 回写 " + applied + " 个文件（新增 " + plan.add + " / 更新 " + plan.update + "，备份 " + (rows.length ? backupDir : "无") + "）",
    actor: opts.actor || "agent"
  });
  return Object.assign({ dry: false, applied, backupDir: rows.length ? backupDir : null, mapping }, plan);
}
