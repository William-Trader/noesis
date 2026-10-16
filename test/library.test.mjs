import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldLibrary, checkLibrary, findDuplicates, renderIndex, LIBRARY_DIRS, allowedRootEntry } from "../src/library.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "noesis-lib-")); }

test("scaffoldLibrary creates the numbered structure and library-level files", () => {
  const root = tmp();
  const r = scaffoldLibrary(root);
  for (const [name] of LIBRARY_DIRS) assert.ok(existsSync(join(root, name)), name + " should exist");
  assert.ok(existsSync(join(root, "INDEX.md")));
  assert.ok(existsSync(join(root, "_整理规范.md")));
  assert.ok(r.created.some((p) => p.startsWith("_重组映射表-")));
  const csv = readFileSync(join(root, r.created.find((p) => p.startsWith("_重组映射表-"))), "utf8");
  assert.equal(csv.trim(), "src,dst,type");
});

test("scaffoldLibrary is idempotent and never overwrites", () => {
  const root = tmp();
  scaffoldLibrary(root);
  writeFileSync(join(root, "INDEX.md"), "custom");
  const r2 = scaffoldLibrary(root);
  assert.equal(r2.created.filter((p) => p === "INDEX.md").length, 0);
  assert.equal(readFileSync(join(root, "INDEX.md"), "utf8"), "custom");
  assert.ok(r2.existed.includes("INDEX.md"));
});

test("checkLibrary flags stray root entries, missing dirs and leaked credentials", () => {
  const root = tmp();
  scaffoldLibrary(root);
  writeFileSync(join(root, "loose-note.md"), "x");
  mkdirSync(join(root, "some-project"));
  writeFileSync(join(root, "deploy-key.pem"), "k");
  const rep = checkLibrary(root);
  assert.equal(rep.ok, false);
  const names = rep.stray.map((s) => s.name);
  assert.ok(names.includes("loose-note.md"));
  assert.ok(names.includes("some-project"));
  assert.ok(rep.credentialsOutside.includes("deploy-key.pem"));
  mkdirSync(join(root, "04-项目-projects", "some-app", "src"), { recursive: true });
  writeFileSync(join(root, "04-项目-projects", "some-app", "src", "tokenize.mjs"), "// not a secret");
  writeFileSync(join(root, "04-项目-projects", "some-app", "src", "tokens.json"), "{}");
  const rep2 = checkLibrary(root);
  assert.ok(!rep2.credentialsOutside.some((p) => p.endsWith("tokenize.mjs")));
  assert.ok(!rep2.credentialsOutside.some((p) => p.endsWith("tokens.json")));
  writeFileSync(join(root, "04-项目-projects", "some-app", ".env"), "A=1");
  const rep3 = checkLibrary(root);
  assert.ok(!rep3.credentialsOutside.some((p) => p.endsWith("some-app/.env")), "project-local .env is not a leak");
  assert.ok(rep3.credentialsOutside.includes("deploy-key.pem"), "root-level key material is a leak");
  assert.ok(rep.notes.length > 0);
  const kept = checkLibrary(root, { keep: ["some-project"] });
  assert.ok(!kept.stray.map((s) => s.name).includes("some-project"));
});

test("checkLibrary passes on a clean scaffolded library", () => {
  const root = tmp();
  scaffoldLibrary(root);
  const rep = checkLibrary(root);
  assert.deepEqual(rep.missingDirs, []);
  assert.deepEqual(rep.stray, []);
  assert.equal(rep.ok, true, JSON.stringify(rep.notes));
});

test("findDuplicates trusts the hash, not the name or size alone", () => {
  const root = tmp();
  scaffoldLibrary(root);
  const d = join(root, "03-知识库-knowledge");
  writeFileSync(join(d, "a.md"), "same content");
  writeFileSync(join(d, "b.md"), "same content");
  writeFileSync(join(d, "c.md"), "different!");
  const res = findDuplicates(root);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].count, 2);
  assert.ok(res.wastedBytes > 0);
});

test("renderIndex lists top-level entries and per-directory items", () => {
  const root = tmp();
  scaffoldLibrary(root);
  writeFileSync(join(root, "03-知识库-knowledge", "note.md"), "# n");
  const md = renderIndex(root);
  assert.match(md, /## 顶层/);
  assert.match(md, /note\.md/);
  assert.match(md, /## 99-凭据-credentials/);
});

test("allowedRootEntry accepts library files and mapping tables only", () => {
  assert.ok(allowedRootEntry("04-项目-projects"));
  assert.ok(allowedRootEntry("INDEX.md"));
  assert.ok(allowedRootEntry("_重组映射表-20261016.csv"));
  assert.ok(!allowedRootEntry("random-thing"));
  assert.ok(allowedRootEntry("openclaw", ["openclaw"]));
  assert.ok(!allowedRootEntry("openclaw"));
});
