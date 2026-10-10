// Noesis · vault scanner + document parser (zero dependencies).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { parseFrontmatter } from "./frontmatter.mjs";
import { tokenize } from "./tokenize.mjs";

const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MDLINK = /\[[^\]]*\]\(([^)]+)\)/g;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const H1 = /^[ \t]*#(?!#)[ \t]+(.+?)[ \t]*$/m;

export function hashContent(buf) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 20);
}

export function walk(root, cfg) {
  const exts = new Set(cfg.extensions.map((e) => e.toLowerCase()));
  const excl = new Set(cfg.exclude);
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (excl.has(ent.name)) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && exts.has(extname(ent.name).toLowerCase())) out.push(full);
    }
  }
  return out.sort();
}

function normalizeTags(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v).split(/[,\s]+/).filter(Boolean);
}

export function parseDoc(fullPath, root, cfg) {
  const buf = readFileSync(fullPath);
  const stat = statSync(fullPath);
  const raw = buf.toString("utf8");
  const { data, content } = parseFrontmatter(raw);
  const rel = relative(root, fullPath).split("\\").join("/");

  let title = data.title ? String(data.title) : "";
  if (!title && cfg.titleFromHeading) {
    const h = H1.exec(content);
    if (h) title = h[1].trim();
  }
  if (!title) title = basename(fullPath).replace(/\.[^.]+$/, "");

  const links = [];
  let m;
  WIKILINK.lastIndex = 0;
  while ((m = WIKILINK.exec(content))) links.push(m[1].trim());
  MDLINK.lastIndex = 0;
  while ((m = MDLINK.exec(content))) {
    const href = m[1].trim();
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    links.push(href.split("#")[0]);
  }

  const headings = [];
  HEADING.lastIndex = 0;
  while ((m = HEADING.exec(content))) headings.push({ level: m[1].length, text: m[2].trim() });

  const tokens = tokenize(title + "\n" + content, { bigrams: cfg.bigrams });

  return {
    path: rel,
    title,
    tags: normalizeTags(data.tags),
    date: (data.date || data.created) ? String(data.date || data.created) : null,
    links,
    headings,
    frontmatter: data,
    length: tokens.length,
    tokens,
    bytes: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
    hash: hashContent(buf)
  };
}
