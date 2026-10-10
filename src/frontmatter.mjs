// Noesis · frontmatter block + a tiny YAML subset (zero dependencies).

function coerce(raw) {
  const t = String(raw).trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  if (t.startsWith("[") && t.endsWith("]")) {
    return t.slice(1, -1).split(",").map((x) => coerce(x)).filter((x) => x !== "");
  }
  return t;
}

export function parseYamlLite(src) {
  const data = {};
  let key = null;
  for (const rawLine of String(src).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const li = /^\s*-\s+(.*)$/.exec(line);
    if (li && key !== null) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(coerce(li[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_\-.\/]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) {
      key = kv[1];
      data[key] = kv[2] === "" ? [] : coerce(kv[2]);
    }
  }
  return data;
}

export function parseFrontmatter(src) {
  let text = String(src);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.startsWith("---")) return { data: {}, content: text, hasFrontmatter: false };
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, content: text, hasFrontmatter: false };
  return { data: parseYamlLite(m[1]), content: text.slice(m[0].length), hasFrontmatter: true };
}
