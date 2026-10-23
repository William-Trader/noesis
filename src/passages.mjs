// Noesis · heading-anchored passage splitter (zero dependencies).
//
// A long note is a bad retrieval unit: you match one sentence and get a 3,000
// token file. Splitting on headings gives passage-level ranking and exact
// quotes, while every passage keeps a parent pointer back to its file.
//
// Offsets are byte-ish (UTF-16 code unit) indexes into the body, so a passage
// can be re-read from disk without storing its text twice.

function headingOf(line) {
  let i = 0;
  while (i < line.length && line[i] === "#") i += 1;
  if (i === 0 || i > 6) return null;
  if (line[i] !== " " && line[i] !== "\t") return null;
  const text = line.slice(i + 1).trim();
  if (!text) return null;
  return { level: i, text };
}

export function splitPassages(content, opts = {}) {
  const maxChars = opts.maxChars || 900;
  const minChars = opts.minChars || 120;
  const lines = String(content == null ? "" : content).split("\n");
  const out = [];
  const stack = [];
  let buf = [];
  let start = 0;
  let pos = 0;

  const pushChunk = (text, s, e, heading) => {
    if (!text.trim()) return;
    const last = out[out.length - 1];
    // A short tail must not be dropped: fold it into the previous passage.
    if (text.trim().length < minChars && last && last.heading === heading) {
      last.text = last.text + "\n" + text;
      last.end = e;
      return;
    }
    out.push({ heading, text, start: s, end: e });
  };

  const flush = (end) => {
    if (!buf.length) return;
    const heading = stack.map((h) => h.text).join(" > ");
    const text = buf.join("\n");
    if (text.length <= maxChars) {
      pushChunk(text, start, end, heading);
    } else {
      let chunk = "";
      let chunkStart = start;
      let cursor = start;
      for (const line of buf) {
        if (chunk && chunk.length + line.length + 1 > maxChars) {
          pushChunk(chunk, chunkStart, cursor - 1, heading);
          chunk = "";
          chunkStart = cursor;
        }
        chunk += (chunk ? "\n" : "") + line;
        cursor += line.length + 1;
      }
      pushChunk(chunk, chunkStart, end, heading);
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineStart = pos;
    pos += line.length + 1;
    const h = headingOf(line);
    if (h) {
      flush(lineStart);
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      stack.push(h);
      start = lineStart;
      buf.push(line);
    } else {
      if (!buf.length) start = lineStart;
      buf.push(line);
    }
  }
  flush(pos);
  return out;
}

export function passageKey(path, i) {
  return "psg:" + path + "#" + i;
}
