// Noesis · version check against GitHub releases (zero dependencies).
//
// Network is never on the hot path: results are cached in the index directory
// and every failure degrades to "unknown" instead of breaking a command.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

const REPO = "William-Trader/noesis";
const PKG = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export function currentVersion() {
  return PKG.version;
}

export function cmpVersion(a, b) {
  const parse = (v) => String(v == null ? "" : v).replace(/^v/i, "").split("-")[0].split(".").map((x) => Number(x) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function readCachedUpdate(cachePath) {
  if (!cachePath || !existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8"));
    if (!raw || !raw.data) return null;
    return { at: raw.at, data: raw.data };
  } catch (e) { return null; }
}

function writeCachedUpdate(cachePath, data) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ at: Date.now(), data }, null, 2));
  } catch (e) { /* cache is best-effort */ }
}

export async function checkUpdate(opts = {}) {
  const current = opts.current || currentVersion();
  const cachePath = opts.cachePath || null;
  const ttl = opts.ttlMs == null ? 6 * 3600 * 1000 : opts.ttlMs;
  const cache = readCachedUpdate(cachePath);

  if (!opts.force && cache && Date.now() - cache.at < ttl) {
    return Object.assign({ current }, cache.data, { cached: true, checkedAt: new Date(cache.at).toISOString() });
  }

  const url = opts.url || process.env.NOESIS_UPDATE_URL
    || "https://api.github.com/repos/" + (opts.repo || REPO) + "/releases/latest";
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "noesis/" + current, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(opts.timeoutMs || 4000)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const latest = String(j.tag_name || j.name || "").replace(/^v/i, "") || null;
    const data = {
      latest,
      updateAvailable: latest ? cmpVersion(latest, current) > 0 : false,
      releaseUrl: j.html_url || null,
      publishedAt: j.published_at || null,
      checkedAt: new Date().toISOString()
    };
    writeCachedUpdate(cachePath, data);
    return Object.assign({ current, cached: false }, data);
  } catch (e) {
    return {
      current,
      latest: cache && cache.data ? cache.data.latest : null,
      updateAvailable: cache && cache.data ? !!cache.data.updateAvailable : false,
      releaseUrl: cache && cache.data ? cache.data.releaseUrl : null,
      error: String(e && e.message ? e.message : e),
      cached: !!cache,
      checkedAt: cache ? new Date(cache.at).toISOString() : null
    };
  }
}
