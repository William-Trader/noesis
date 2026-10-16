import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listedVolumes, readHome, recordHome, appendJournal, readJournal, undoMapping, packLibrary, librarySummary, manualText, JOURNAL, HOME_RECORD } from "../src/portable.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "noesis-port-")); }

test("listedVolumes reports the boot volume with free space", () => {
  const vols = listedVolumes();
  assert.ok(vols.length >= 1);
  const boot = vols.find((v) => v.mount === "/");
  assert.ok(boot, "boot volume should be listed");
  assert.equal(boot.writable, true);
  assert.ok(boot.freeGB > 0);
  assert.ok(!vols.some((v) => /\/(Recovery|VM)$/.test(v.mount)), "system volumes must not be candidates");
});

test("recordHome writes the marker and the journal records it", () => {
  const root = tmp();
  assert.equal(readHome(root).portable, false);
  const rec = recordHome(root, root, { note: "test" });
  assert.equal(rec.path, root);
  assert.equal(readHome(root).portable, true);
  assert.ok(existsSync(join(root, HOME_RECORD)));
  const log = readJournal(root);
  assert.equal(log.length, 1);
  assert.equal(log[0].op, "home");
  assert.ok(log[0].ts && log[0].host);
});

test("journal is append-only and readJournal honours the tail limit", () => {
  const root = tmp();
  appendJournal(root, { op: "a", detail: "1" });
  appendJournal(root, { op: "b", detail: "2" });
  appendJournal(root, { op: "c", detail: "3" });
  assert.equal(readJournal(root).length, 3);
  assert.deepEqual(readJournal(root, 2).map((r) => r.op), ["b", "c"]);
  assert.equal(readFileSync(join(root, JOURNAL), "utf8").trim().split("\n").length, 3);
});

test("undoMapping restores moved items and never overwrites an occupied source", () => {
  const root = tmp();
  const src = join(root, "orig", "a.md");
  const dst = join(root, "04-项目-projects", "a.md");
  const missing = join(root, "orig", "gone.md");
  mkdirSync(join(root, "orig"), { recursive: true });
  mkdirSync(join(root, "04-项目-projects"), { recursive: true });
  writeFileSync(src, "A");
  renameSync(src, dst);
  const csv = join(root, "_重组映射表-20261016.csv");
  writeFileSync(csv, "src,dst,type\n" + src + "," + dst + ",project\n" + missing + ",/nope/b.md,project\n");
  const dry = undoMapping(root, csv, { dry: true });
  assert.equal(dry.dry, true);
  assert.ok(!existsSync(src), "dry run moves nothing");
  const res = undoMapping(root, csv, {});
  assert.equal(res.applied, 1);
  assert.equal(readFileSync(src, "utf8"), "A");
  assert.ok(!existsSync(dst));
  writeFileSync(dst, "A2");
  const res2 = undoMapping(root, csv, {});
  assert.equal(res2.applied, 0, "must not overwrite an existing source");
  assert.equal(readFileSync(src, "utf8"), "A");
  assert.equal(readFileSync(dst, "utf8"), "A2");
});

test("manualText fills every placeholder and ships both languages", () => {
  const root = tmp();
  recordHome(root, root, {});
  const md = manualText(root, { lang: "both", noesisPath: "/x/bin/noesis.mjs" });
  assert.ok(md.indexOf("资产库使用说明书") >= 0);
  assert.ok(md.indexOf("Library manual (English)") >= 0);
  assert.ok(md.indexOf(root) >= 0);
  assert.ok(md.indexOf("/x/bin/noesis.mjs") >= 0);
  assert.ok(md.indexOf("{{") < 0, "no placeholders left");
  const zhOnly = manualText(root, { lang: "zh" });
  assert.ok(zhOnly.indexOf("Library manual (English)") < 0);
});

test("librarySummary lists top-level entries", () => {
  const root = tmp();
  mkdirSync(join(root, "04-项目-projects"));
  writeFileSync(join(root, "INDEX.md"), "x");
  const s = librarySummary(root);
  assert.ok(s.dirs.some((d) => d.name === "04-项目-projects" && d.isDir));
  assert.ok(s.dirs.some((d) => d.name === "INDEX.md" && !d.isDir));
  assert.equal(s.files, 1);
});

test("packLibrary dry-run builds excludes; real pack skips the rebuildable index", () => {
  const root = tmp();
  mkdirSync(join(root, "notes"));
  mkdirSync(join(root, ".noesis"));
  writeFileSync(join(root, "notes", "a.md"), "# A");
  writeFileSync(join(root, ".noesis", "index.bin"), "binary");
  const dry = packLibrary(root, join(tmpdir(), "x.tgz"), { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.cmd.indexOf("--exclude=./.noesis") >= 0);
  const out = join(tmpdir(), "noesis-pack-" + Date.now() + ".tar.gz");
  const res = packLibrary(root, out, {});
  assert.ok(existsSync(res.outPath));
  assert.ok(res.bytes > 0);
  const list = execFileSync("tar", ["-tzf", res.outPath], { encoding: "utf8" }).split("\n");
  assert.ok(list.some((l) => l.indexOf("notes/a.md") >= 0), "content packed");
  assert.ok(!list.some((l) => l.indexOf(".noesis") >= 0), "index excluded");
  assert.equal(readJournal(root)[0].op, "pack");
});
