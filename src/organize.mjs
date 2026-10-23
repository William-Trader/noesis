// Noesis · library mutations as transactions (zero dependencies).
//
// An agent may propose and apply a reorganisation, but every move is written to
// a mapping table BEFORE the filesystem changes, and the whole pass can be
// reversed with one undo. Nothing is ever deleted.
import { readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { allowedRootEntry, looksLikeSecret, LIBRARY_DIRS } from "./library.mjs";
import { undoMapping, appendJournal } from "./portable.mjs";

const INBOX = "00-收件箱-INBOX";
const ARCHIVE = [".zip", ".tar.gz", ".tgz", ".rar", ".7z", ".tar"];
const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod"];
const MAX_MOVES = 200;

function isArchive(name) {
  const n = name.toLowerCase();
  return ARCHIVE.some((e) => n.endsWith(e));
}

function looksLikeProject(dir) {
  return PROJECT_MARKERS.some((m) => existsSync(join(dir, m)));
}

function looksLikeSkill(dir) {
  return existsSync(join(dir, "SKILL.md"));
}

function looksLikeHandover(name) {
  const n = name.toLowerCase();
  return n.includes("handover") || n.includes("交接") || n.includes("说明书") || n === "manual.md";
}

// Where would this entry go? Heuristics only; the caller may override.
export function guessDestination(root, name, isDir) {
  const abs = join(root, name);
  if (looksLikeSecret(name, { rootLevel: true })) return { dir: "99-凭据-credentials", reason: "credential material" };
  if (isArchive(name)) return { dir: "07-原始包-originals", reason: "archive" };
  if (isDir && looksLikeSkill(abs)) return { dir: "01-技能-skills", reason: "skill directory" };
  if (isDir && looksLikeProject(abs)) return { dir: "04-项目-projects", reason: "project marker present" };
  if (looksLikeHandover(name)) return { dir: "06-交接-handovers", reason: "handover/manual document" };
  if (!isDir && /[.](md|markdown|txt)$/i.test(name)) return { dir: "03-知识库-knowledge", reason: "plain document" };
  if (isDir) return { dir: "05-归档-archive", reason: "unclassified directory" };
  return { dir: "05-归档-archive", reason: "unclassified file" };
}

function rootEntries(root) {
  return readdirSync(root)
    .filter((n) => !n.startsWith(".") && n !== ".DS_Store")
    .map((n) => {
      const abs = join(root, n);
      let isDir = false;
      try { isDir = statSync(abs).isDirectory(); } catch (e) { isDir = false; }
      return { name: n, isDir };
    });
}

function sizeOf(abs) {
  try {
    const st = statSync(abs);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const n of readdirSync(abs)) {
      if (n.startsWith(".")) continue;
      total += sizeOf(join(abs, n));
    }
    return total;
  } catch (e) { return 0; }
}

// Dry run: what should move where, and what is already in the way.
export function planOrganization(root, opts = {}) {
  const absRoot = resolve(root);
  const keep = opts.keep || [];
  const limit = opts.limit || 50;
  const items = [];
  const skipped = [];

  const consider = (name, isDir, from) => {
    if (keep.includes(name) || allowedRootEntry(name, keep)) return;
    const guess = guessDestination(absRoot, name, isDir);
    const dst = join(absRoot, guess.dir, name);
    items.push({
      src: join(absRoot, from ? join(from, name) : name),
      srcRel: from ? from + "/" + name : name,
      dst,
      dstRel: guess.dir + "/" + name,
      type: isDir ? "dir" : "file",
      reason: guess.reason,
      conflict: existsSync(dst),
      bytes: sizeOf(join(absRoot, from ? join(from, name) : name))
    });
  };

  for (const ent of rootEntries(absRoot)) consider(ent.name, ent.isDir, "");
  if (existsSync(join(absRoot, INBOX))) {
    for (const n of readdirSync(join(absRoot, INBOX))) {
      if (n.startsWith(".") || n === "README-怎么用.md") continue;
      let isDir = false;
      try { isDir = statSync(join(absRoot, INBOX, n)).isDirectory(); } catch (e) { isDir = false; }
      const guess = guessDestination(absRoot, n, isDir);
      const dst = join(absRoot, guess.dir, n);
      items.push({
        src: join(absRoot, INBOX, n), srcRel: INBOX + "/" + n,
        dst, dstRel: guess.dir + "/" + n,
        type: isDir ? "dir" : "file", reason: "from inbox: " + guess.reason,
        conflict: existsSync(dst), bytes: sizeOf(join(absRoot, INBOX, n))
      });
    }
  }

  items.sort((a, b) => b.bytes - a.bytes || a.srcRel.localeCompare(b.srcRel));
  const page = items.slice(0, limit);
  return {
    root: absRoot,
    total: items.length,
    returned: page.length,
    conflicts: items.filter((i) => i.conflict).length,
    bytes: items.reduce((n, i) => n + i.bytes, 0),
    items: page,
    skipped: skipped.length ? skipped : undefined,
    note: items.length > page.length ? "plan truncated; pass limit to see more" : undefined
  };
}

function inside(root, p) {
  const abs = resolve(p);
  return abs === root || abs.startsWith(root + "/");
}

function opFileName() {
  const d = new Date();
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  const stamp = "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const tag = Math.random().toString(36).slice(2, 6);
  return "_重组映射表-" + stamp + "-" + tag + ".csv";
}

// Apply moves: validate -> write the mapping table (WAL) -> move -> journal.
export function applyMoves(root, moves, opts = {}) {
  const absRoot = resolve(root);
  const actor = opts.actor || "agent";
  if (!Array.isArray(moves) || !moves.length) return { error: "moves must be a non-empty array" };
  if (moves.length > MAX_MOVES) return { error: "too many moves in one pass (max " + MAX_MOVES + ")" };

  const rows = [];
  const rejected = [];
  const seen = new Set();
  for (const m of moves) {
    const src = resolve(absRoot, String(m.src || ""));
    const dst = resolve(absRoot, String(m.dst || ""));
    if (!m.src || !m.dst) { rejected.push({ src: m.src, dst: m.dst, why: "missing src/dst" }); continue; }
    if (!inside(absRoot, src) || !inside(absRoot, dst)) { rejected.push({ src: m.src, dst: m.dst, why: "outside library root" }); continue; }
    if (String(m.src).includes(",") || String(m.dst).includes(",")) { rejected.push({ src: m.src, dst: m.dst, why: "comma in path (mapping table is CSV)" }); continue; }
    if (seen.has(src)) { rejected.push({ src: m.src, dst: m.dst, why: "duplicate src" }); continue; }
    seen.add(src);
    if (!existsSync(src)) { rejected.push({ src: m.src, dst: m.dst, why: "src missing" }); continue; }
    if (existsSync(dst)) { rejected.push({ src: m.src, dst: m.dst, why: "dst already exists (never overwrite)" }); continue; }
    rows.push({ src, dst, type: m.type || (statSync(src).isDirectory() ? "dir" : "file"), reason: m.reason || "" });
  }

  if (opts.dry) {
    return { dry: true, wouldMove: rows.length, rejected, mapping: rows.map((r) => ({ src: r.src, dst: r.dst, type: r.type })) };
  }
  if (!rows.length) return { applied: 0, rejected, error: "nothing valid to move" };

  const opId = opFileName();
  const csvPath = join(absRoot, opId);
  const csv = "src,dst,type\n" + rows.map((r) => r.src + "," + r.dst + "," + r.type).join("\n") + "\n";
  writeFileSync(csvPath, csv);

  let applied = 0;
  const failed = [];
  for (const row of rows) {
    try {
      mkdirFor(dirname(row.dst));
      execFileSync("mv", [row.src, row.dst]);
      applied += 1;
    } catch (e) {
      failed.push({ src: row.src, dst: row.dst, why: String(e && e.message ? e.message : e) });
    }
  }
  appendJournal(absRoot, { op: "organize", detail: opId + " · 移动 " + applied + "/" + rows.length + " 项（可用 undo 回滚）", actor });
  return {
    op_id: opId, file: csvPath, applied, rejected, failed,
    mapping: rows.map((r) => ({ src: r.src, dst: r.dst, type: r.type })),
    undo: "noesis_undo {\"op_id\": \"" + opId + "\"}"
  };
}

function mkdirFor(dir) {
  try { execFileSync("mkdir", ["-p", dir]); } catch (e) { /* mv will report it */ }
}

// Reverse one pass. opId is a mapping-table filename, never a path.
export function undoOp(root, opId, opts = {}) {
  const absRoot = resolve(root);
  const name = basename(String(opId || ""));
  if (!name || name !== String(opId)) return { error: "op_id must be a bare mapping-table filename" };
  if (!name.startsWith("_重组映射表-") || !name.endsWith(".csv")) return { error: "not a mapping table: " + name };
  const p = join(absRoot, name);
  if (!existsSync(p)) return { error: "mapping table not found: " + name };
  const res = undoMapping(absRoot, p, { dry: opts.dry, actor: opts.actor || "agent" });
  return Object.assign({ op_id: name }, res);
}
