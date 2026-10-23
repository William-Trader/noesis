import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { checkUpdate, cmpVersion, currentVersion, readCachedUpdate } from "../src/update.mjs";

const BIN = fileURLToPath(new URL("../bin/noesis.mjs", import.meta.url));
const NL = String.fromCharCode(10);
function plain(s) {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) === 27) { const m = s.indexOf("m", i); i = m < 0 ? s.length : m; continue; }
    out += s[i];
  }
  return out;
}

test("version compare handles tags, prefixes and length", () => {
  assert.equal(cmpVersion("0.6.1", "0.6.0"), 1);
  assert.equal(cmpVersion("v0.7.0", "0.6.9"), 1);
  assert.equal(cmpVersion("1.0", "1.0.0"), 0);
  assert.equal(cmpVersion("0.6.0", "0.10.0"), -1);
  assert.equal(cmpVersion("v2.0.0-beta.1", "1.9.9"), 1);
});

test("update check reads GitHub latest, caches it, and degrades offline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noesis-upd-"));
  const cachePath = join(dir, "update.json");
  const srv = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ tag_name: "v9.9.9", html_url: "https://example.test/release", published_at: "2026-10-23T00:00:00Z" }));
  });
  await new Promise((r) => srv.listen(0, r));
  const url = "http://127.0.0.1:" + srv.address().port + "/latest";
  try {
    const live = await checkUpdate({ url, cachePath, current: "0.6.1", force: true });
    assert.equal(live.latest, "9.9.9");
    assert.equal(live.updateAvailable, true);
    assert.equal(live.cached, false);
    assert.ok(existsSync(cachePath));
  } finally { srv.close(); }

  const cached = await checkUpdate({ url, cachePath, current: "0.6.1" });
  assert.equal(cached.cached, true);
  assert.equal(cached.latest, "9.9.9");
  assert.equal(cached.updateAvailable, true);

  const offline = await checkUpdate({ url: "http://127.0.0.1:1/latest", cachePath, current: "0.6.1", force: true, timeoutMs: 300 });
  assert.ok(offline.error, "offline check must report an error, not throw");
  assert.equal(offline.latest, "9.9.9", "falls back to the cached answer");
  assert.equal(readCachedUpdate(cachePath).data.latest, "9.9.9");
  assert.equal(currentVersion(), JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});

test("empty vault builds, searches and reports without crashing", () => {
  const root = mkdtempSync(join(tmpdir(), "noesis-empty-"));
  const out = plain(execFileSync(process.execPath, [BIN, "build", root], { encoding: "utf8" }));
  assert.match(out, /文档 0/);
  const search = plain(execFileSync(process.execPath, [BIN, "search", root, "anything"], { encoding: "utf8" }));
  assert.match(search, /无结果/);
  const stats = JSON.parse(execFileSync(process.execPath, [BIN, "stats", root, "--json"], { encoding: "utf8" }));
  assert.equal(stats.documents, 0);
  assert.equal(stats.segments, 0);
});

test("missing directories fail with a friendly exit code, not a stack trace", () => {
  for (const cmd of ["onboard", "tidy"]) {
    let err = null;
    try { execFileSync(process.execPath, [BIN, cmd, "/tmp/noesis-missing-" + Date.now()], { encoding: "utf8", stdio: "pipe" }); }
    catch (e) { err = e; }
    assert.ok(err, cmd + " must exit non-zero");
    assert.equal(err.status, 2);
    assert.match(String(err.stderr), /目录不存在/);
  }
});