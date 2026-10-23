// Noesis · MCP server (stdio JSON-RPC 2.0, zero dependencies).
//
// An agent should not have to shell out and parse terminal output to read a
// library. This exposes the same engine as tools, so search, reading, related
// notes and library health all speak structured JSON.
import { createInterface } from "node:readline";
import { runSearch } from "./search.mjs";
import { createSearcher } from "./index.mjs";
import { linkAuthority, relatedDocs } from "./graph.mjs";
import { checkLibrary } from "./library.mjs";
import { readJournal } from "./portable.mjs";
import { planOrganization, applyMoves, undoOp } from "./organize.mjs";

const VERSION = "0.5.0";
const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "noesis_search",
    description: "BM25 search over the local library. Supports tag:, path:, -exclude and \"quoted phrases\". Returns document hits with the best section and a snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "search query" },
        limit: { type: "number", description: "max hits (default 10)" }
      },
      required: ["query"]
    }
  },
  {
    name: "noesis_read",
    description: "Read a note by path, optionally only one heading section.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        section: { type: "string", description: "heading text to slice to" }
      },
      required: ["path"]
    }
  },
  {
    name: "noesis_related",
    description: "Notes nearest to a given note on the wiki-link graph (personalized PageRank).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, limit: { type: "number" } },
      required: ["path"]
    }
  },
  {
    name: "noesis_stats",
    description: "Index health: documents, passages, terms, segments, built-at and drift.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "noesis_library_check",
    description: "Check the asset-library conventions: stray root entries, missing dirs, leaked credentials, archive placement.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" }, keep: { type: "array", items: { type: "string" } } }
    }
  },
  {
    name: "noesis_library_log",
    description: "Read the append-only library journal (_库志.jsonl).",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" }, tail: { type: "number" } }
    }
  },
  {
    name: "noesis_organize_plan",
    description: "Dry run: propose where loose root entries and inbox items should go. Writes nothing. Always call this before noesis_apply_moves.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        limit: { type: "number", description: "max items to return (default 50)" },
        keep: { type: "array", items: { type: "string" }, description: "root entries to leave alone" }
      }
    }
  },
  {
    name: "noesis_apply_moves",
    description: "Move files inside the library. Writes the mapping table FIRST, never overwrites, never deletes. Returns an op_id that noesis_undo can reverse.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        moves: {
          type: "array",
          items: {
            type: "object",
            properties: { src: { type: "string" }, dst: { type: "string" }, type: { type: "string" } },
            required: ["src", "dst"]
          }
        },
        dry: { type: "boolean" },
        actor: { type: "string" }
      },
      required: ["moves"]
    }
  },
  {
    name: "noesis_undo",
    description: "Reverse one apply_moves pass from its mapping table. Never overwrites an existing file.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        op_id: { type: "string", description: "value returned by noesis_apply_moves" },
        dry: { type: "boolean" },
        actor: { type: "string" }
      },
      required: ["op_id"]
    }
  }
];

function sectionOf(text, heading) {
  if (!heading) return text;
  const lines = String(text).split("\n");
  const want = heading.toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let h = 0;
    while (h < line.length && line[h] === "#") h += 1;
    if (!h || h > 6 || (line[h] !== " " && line[h] !== "\t")) continue;
    const title = line.slice(h + 1).trim().toLowerCase();
    if (start < 0 && title === want) { start = i; level = h; continue; }
    if (start >= 0 && h <= level) return lines.slice(start, i).join("\n");
  }
  return start >= 0 ? lines.slice(start).join("\n") : text;
}

function asText(obj) {
  return { content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] };
}

export async function handleRpc(msg, ctx) {
  const id = msg && msg.id != null ? msg.id : null;
  const method = msg && msg.method;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "noesis", version: VERSION } });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return reply({});
  if (method === "tools/list") return reply({ tools: TOOLS });
  if (method !== "tools/call") return fail(-32601, "method not found: " + method);

  const name = msg.params && msg.params.name;
  const args = (msg.params && msg.params.arguments) || {};
  const idx = ctx.idx;
  const cfg = ctx.cfg;

  if (name === "noesis_search") {
    const out = runSearch(idx, cfg, String(args.query || ""), {
      limit: args.limit || 10,
      searcher: ctx.searcher || (ctx.searcher = createSearcher(idx, cfg)),
      authority: ctx.authority || (ctx.authority = linkAuthority(idx.docs)),
      readText: ctx.readText
    });
    return reply(asText({
      total: out.total, returned: out.returned,
      as_of: new Date(idx.builtAt || 0).toISOString(),
      hits: out.hits.map((h) => ({
        path: h.doc.path, title: h.doc.title, section: h.section || null,
        score: Math.round(h.score * 1000) / 1000, snippet: h.snippet
      }))
    }));
  }

  if (name === "noesis_read") {
    const p = String(args.path || "");
    const doc = idx.docs.find((d) => d.path === p && d.kind !== "passage");
    if (!doc) return reply(asText({ error: "not_found", path: p }));
    const text = ctx.readText ? ctx.readText(p) : "";
    return reply(asText({ path: p, title: doc.title, tags: doc.tags || [], text: sectionOf(text, args.section) }));
  }

  if (name === "noesis_related") {
    return reply(asText({ path: args.path, related: relatedDocs(idx.docs, String(args.path || ""), { limit: args.limit || 10 }) }));
  }

  if (name === "noesis_stats") {
    const docs = idx.docs.filter((d) => d.kind !== "passage").length;
    let postings = 0;
    for (const e of idx.terms.values()) postings += e.df;
    return reply(asText({
      documents: docs, passages: idx.N - docs, terms: idx.terms.size, postings,
      segments: idx.stats ? idx.stats.segments : 1,
      builtAt: idx.builtAt, as_of: new Date(idx.builtAt || 0).toISOString()
    }));
  }

  if (name === "noesis_library_check") {
    const root = String(args.root || cfg.root);
    return reply(asText(checkLibrary(root, { keep: args.keep || [] })));
  }

  if (name === "noesis_library_log") {
    const root = String(args.root || cfg.root);
    return reply(asText({ root, rows: readJournal(root, args.tail || 20) }));
  }

  if (name === "noesis_organize_plan") {
    const root = String(args.root || cfg.root);
    return reply(asText(planOrganization(root, { limit: args.limit || 50, keep: args.keep || [] })));
  }

  if (name === "noesis_apply_moves") {
    const root = String(args.root || cfg.root);
    const res = applyMoves(root, args.moves, { dry: !!args.dry, actor: args.actor || "mcp" });
    return reply(asText(res));
  }

  if (name === "noesis_undo") {
    const root = String(args.root || cfg.root);
    const res = undoOp(root, args.op_id, { dry: !!args.dry, actor: args.actor || "mcp" });
    return reply(asText(res));
  }

  return reply(asText({ error: "unknown tool", name }));
}

export function startMcp(idx, cfg, opts) {
  const ctx = {
    idx, cfg,
    readText: opts && opts.readText,
    state: opts && opts.state,
    searcher: createSearcher(idx, cfg),
    authority: null
  };
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
      return;
    }
    let out;
    try { out = await handleRpc(msg, ctx); } catch (e) {
      out = { jsonrpc: "2.0", id: msg.id != null ? msg.id : null, error: { code: -32603, message: String(e && e.message ? e.message : e) } };
    }
    if (out) process.stdout.write(JSON.stringify(out) + "\n");
  });
  rl.on("close", () => process.exit(0));
  return rl;
}
