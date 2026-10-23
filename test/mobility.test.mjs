import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planSync, syncBack } from "../src/sync.mjs";

const BIN = fileURLToPath(new URL("../bin/noesis.mjs", import.meta.url));
const NL = String.fromCharCode(10);
function writeDoc(root, rel, body) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body);
  return p;
}

test("sync: brings newer and new files home, backs up overwrites, keeps identical", () => {
  const lib = mkdtempSync(join(tmpdir(), "noesis-lib-"));
  const copy = mkdtempSync(join(tmpdir(), "noesis-copy-"));
  writeDoc(lib, "notes/a.md", "old body");
  writeDoc(lib, "notes/same.md", "unchanged");
  writeDoc(copy, "notes/a.md", "new body from the road");
  writeDoc(copy, "notes/same.md", "unchanged");
  writeDoc(copy, "notes/new.md", "written while travelling");
  const future = new Date(Date.now() + 60000);
  utimesSync(join(copy, "notes/a.md"), future, future);

  const plan = planSync(lib, copy);
  assert.equal(plan.add, 1);
  assert.equal(plan.update, 1);
  assert.equal(plan.same, 1);

  const dry = syncBack(lib, copy, { dry: true });
  assert.equal(dry.applied, 0);
  assert.equal(readFileSync(join(lib, "notes/a.md"), "utf8"), "old body");

  const res = syncBack(lib, copy);
  assert.equal(res.applied, 2);
  assert.equal(readFileSync(join(lib, "notes/a.md"), "utf8"), "new body from the road");
  assert.equal(readFileSync(join(lib, "notes/new.md"), "utf8"), "written while travelling");
  assert.ok(res.backupDir && existsSync(res.backupDir));
  assert.equal(readFileSync(join(res.backupDir, "notes/a.md"), "utf8"), "old body");
  assert.ok(res.mapping && existsSync(res.mapping));
});

test("sync: never overwrites when the library is newer", () => {
  const lib = mkdtempSync(join(tmpdir(), "noesis-lib2-"));
  const copy = mkdtempSync(join(tmpdir(), "noesis-copy2-"));
  writeDoc(lib, "n.md", "library version");
  writeDoc(copy, "n.md", "stale copy");
  const past = new Date(Date.now() - 3600000);
  utimesSync(join(copy, "n.md"), past, past);
  const plan = planSync(lib, copy);
  assert.equal(plan.update, 0);
  assert.equal(plan.skip, 1);
  assert.equal(readFileSync(join(lib, "n.md"), "utf8"), "library version");
});

test("tidy: --yes moves loose entries and regenerates INDEX.md", () => {
  const root = mkdtempSync(join(tmpdir(), "noesis-tidy-"));
  for (const d of ["00-收件箱-INBOX", "03-知识库-knowledge", "05-归档-archive", "07-原始包-originals", "99-凭据-credentials"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeDoc(root, "loose.md", "# Loose" + NL + NL + "text" + NL);
  writeDoc(root, "bundle.zip", "PK");

  const plan = execFileSync(process.execPath, [BIN, "tidy", root], { encoding: "utf8" });
  assert.match(plan, /这是计划，还没有动任何文件/);
  assert.ok(existsSync(join(root, "loose.md")), "plan must not move anything");

  execFileSync(process.execPath, [BIN, "tidy", root, "--yes"], { encoding: "utf8" });
  assert.ok(existsSync(join(root, "03-知识库-knowledge/loose.md")));
  assert.ok(existsSync(join(root, "07-原始包-originals/bundle.zip")));
  assert.ok(!existsSync(join(root, "loose.md")));
  const index = readFileSync(join(root, "INDEX.md"), "utf8");
  assert.match(index, /03-知识库-knowledge/);
  assert.ok(readdirSync(root).some((n) => n.startsWith("_重组映射表-")), "mapping table written");
});

test("tidy: undo restores the previous layout", () => {
  const root = mkdtempSync(join(tmpdir(), "noesis-undo-"));
  for (const d of ["03-知识库-knowledge", "05-归档-archive", "07-原始包-originals"]) mkdirSync(join(root, d), { recursive: true });
  writeDoc(root, "note.md", "body");
  execFileSync(process.execPath, [BIN, "tidy", root, "--yes"], { encoding: "utf8" });
  const op = readdirSync(root).find((n) => n.startsWith("_重组映射表-") && n.endsWith(".csv"));
  assert.ok(op, "mapping table exists");
  execFileSync(process.execPath, [BIN, "undo", root, op], { encoding: "utf8" });
  assert.ok(existsSync(join(root, "note.md")), "undo restored the original path");
});