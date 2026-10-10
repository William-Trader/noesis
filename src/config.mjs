// Noesis · configuration and path resolution (zero dependencies).
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const DEFAULTS = {
  index: ".noesis",
  extensions: [".md", ".markdown", ".mdx", ".txt"],
  exclude: [".git", "node_modules", ".noesis", "dist", "build", "vendor", ".obsidian"],
  bigrams: true,
  bm25: { k1: 1.2, b: 0.75 },
  titleFromHeading: true,
  snippetLength: 200,
  maxFileBytes: 8 * 1024 * 1024
};

export function loadConfig(rootDir, overrides = {}) {
  const root = resolve(rootDir || ".");
  const p = join(root, "kb.config.json");
  let user = {};
  if (existsSync(p)) {
    try { user = JSON.parse(readFileSync(p, "utf8")); } catch (e) { user = {}; }
  }
  const cfg = Object.assign({}, DEFAULTS, user, overrides);
  cfg.bm25 = Object.assign({}, DEFAULTS.bm25, user.bm25 || {}, overrides.bm25 || {});
  cfg.exclude = Array.from(new Set([].concat(DEFAULTS.exclude, user.exclude || [])));
  cfg.root = root;
  cfg.indexDir = join(root, cfg.index);
  return cfg;
}
