// Noesis · 便携资产库（零依赖）：库位置 · 痕迹日志 · 一键恢复 · 便携打包 · 说明书
//
// 设计目标（宜人 + 省资源，不是炫技）：
//   1 第一次接触先问清「库放在哪个盘」，并记下来（_库位置.json）
//   2 整库可直接拷贝带走；换台机器 / 换个 agent 立刻接管
//   3 备份与恢复有据可依：映射表能反向执行（undo），操作留痕（_库志.jsonl）
//   4 打包交接排除可再生的重物（索引 / node_modules / venv），省空间省时间
//   5 说明书自动生成，中英双语，给人也给下一个 agent 看
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, accessSync, constants } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

export const JOURNAL = "_库志.jsonl";
export const HOME_RECORD = "_库位置.json";
export const MANUAL_FILE = "说明书.md";
export const PACK_EXCLUDES = [
  "node_modules", ".git", ".noesis", "venv", ".venv", "site-packages", "__pycache__",
  ".Trash", "Library", ".DS_Store", "*.log", "dist", "build", "homebrew", ".cellar",
];

const MANUAL_ZH = readFileSync(new URL("./manual.zh.md", import.meta.url), "utf8");
const MANUAL_EN = readFileSync(new URL("./manual.en.md", import.meta.url), "utf8");

function gb(kb) { return Math.round((kb / 1048576) * 10) / 10; }

function dfRow(target) {
  const out = execFileSync("df", ["-k", "-P", target], { encoding: "utf8" });
  const p = out.trim().split("\n")[1].trim().split(/\s+/);
  return { mount: p.slice(5).join(" "), totalKB: Number(p[1]), availKB: Number(p[3]) };
}

// 候选盘位：本机卷 + /Volumes/*（外接盘 / 移动硬盘），带可用空间与可写性。
export function listedVolumes() {
  let rows = [];
  try {
    const out = execFileSync("df", ["-k", "-P"], { encoding: "utf8" });
    rows = out.trim().split("\n").slice(1).map((line) => {
      const p = line.trim().split(/\s+/);
      return { mount: p.slice(5).join(" "), totalKB: Number(p[1]), availKB: Number(p[3]) };
    });
  } catch (e) { return []; }
  const skip = /^\/(System|dev|private)|\/(Recovery|VM)$/;
  return rows
    .filter((r) => r.mount === "/" || r.mount.indexOf("/Volumes/") === 0)
    .filter((r) => !skip.test(r.mount))
    .map((r) => {
      // macOS 上对 "/" 做 W_OK 会被 SIP 拒绝（EACCES），但启动卷当然可写 —— 特殊处理，别误报只读。
      let writable = r.mount === "/";
      if (!writable) { try { accessSync(r.mount, constants.W_OK); writable = true; } catch (e) {} }
      return {
        mount: r.mount,
        name: r.mount === "/" ? "本机内置盘 (Macintosh HD)" : basename(r.mount),
        external: r.mount !== "/",
        totalGB: gb(r.totalKB), freeGB: gb(r.availKB), writable,
      };
    });
}

// macOS 把用户主目录挂在 /System/Volumes/Data 上（firmlink），展示时归一成启动卷，免得用户困惑。
export function displayVolume(mount) {
  if (!mount) return mount;
  if (mount === "/" || mount.indexOf("/System/Volumes/") === 0) return "/ (Macintosh HD)";
  return mount;
}

export function currentVolume(root) {
  try {
    const r = dfRow(resolve(root));
    return { mount: displayVolume(r.mount), freeGB: gb(r.availKB), totalGB: gb(r.totalKB) };
  } catch (e) { return { mount: null, freeGB: null, totalGB: null }; }
}

export function appendJournal(root, entry) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), host: hostname() }, entry));
  const p = join(resolve(root), JOURNAL);
  try {
    const prev = existsSync(p) ? readFileSync(p, "utf8") : "";
    writeFileSync(p, prev + line + "\n");
  } catch (e) {}
  return line;
}

export function readJournal(root, limit) {
  const p = join(resolve(root), JOURNAL);
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
  const pick = limit ? lines.slice(-limit) : lines;
  return pick.map((l) => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });
}

export function readHome(root) {
  const p = join(resolve(root), HOME_RECORD);
  let record = null;
  if (existsSync(p)) { try { record = JSON.parse(readFileSync(p, "utf8")); } catch (e) { record = null; } }
  const vol = currentVolume(root);
  return {
    root: resolve(root), host: hostname(), volume: vol.mount, freeGB: vol.freeGB, totalGB: vol.totalGB,
    portable: !!record && record.path === resolve(root), record,
  };
}

export function recordHome(root, target, opts) {
  opts = opts || {};
  const abs = resolve(root);
  const vol = currentVolume(target || abs);
  const rec = {
    path: abs, volume: vol.mount, recordedAt: new Date().toISOString(),
    recordedBy: opts.actor || "agent", note: opts.note || "", host: hostname(),
  };
  writeFileSync(join(abs, HOME_RECORD), JSON.stringify(rec, null, 2) + "\n");
  appendJournal(abs, { op: "home", detail: "库位置记为 " + abs + " (卷 " + vol.mount + ")", actor: rec.recordedBy });
  return rec;
}

// 反向执行映射表：dst 移回 src。只处理「dst 在、src 不在」的行，绝不覆盖已有文件。
export function undoMapping(root, csvPath, opts) {
  opts = opts || {};
  const abs = resolve(root);
  const rows = readFileSync(csvPath, "utf8").split("\n").filter(Boolean).slice(1);
  const plan = [];
  for (const row of rows) {
    const parts = row.split(",");
    if (parts.length < 2) continue;
    const src = parts[0].trim(), dst = parts[1].trim();
    if (!src || !dst || src[0] !== "/" || dst[0] !== "/") continue;
    const dstThere = existsSync(dst), srcThere = existsSync(src);
    if (dstThere && !srcThere) plan.push({ src, dst, action: "restore" });
    else if (dstThere && srcThere) plan.push({ src, dst, action: "skip-exists" });
    else plan.push({ src, dst, action: "skip-missing" });
  }
  let applied = 0;
  if (!opts.dry) {
    for (const item of plan) {
      if (item.action !== "restore") continue;
      try {
        mkdirSync(dirname(item.src), { recursive: true });
        execFileSync("mv", [item.dst, item.src]);
        applied += 1;
        item.action = "restored";
      } catch (e) { item.action = "failed"; }
    }
    if (applied) appendJournal(abs, { op: "undo", detail: "按 " + basename(csvPath) + " 还原 " + applied + " 项", actor: opts.actor || "agent" });
  }
  return { csv: csvPath, plan, applied, dry: !!opts.dry };
}

export function packLibrary(root, outPath, opts) {
  opts = opts || {};
  const abs = resolve(root);
  const out = outPath || join(dirname(abs), basename(abs) + "-portable-" + new Date().toISOString().slice(0, 10) + ".tar.gz");
  const excludes = [].concat(opts.exclude || PACK_EXCLUDES);
  const args = ["-czf", out, "-C", abs];
  for (const e of excludes) args.push("--exclude=./" + e);
  args.push(".");
  if (opts.dryRun) return { outPath: out, dryRun: true, cmd: "tar " + args.join(" ") };
  execFileSync("tar", args, { stdio: "pipe" });
  const bytes = statSync(out).size;
  appendJournal(abs, { op: "pack", detail: "打包 " + out + " (" + Math.round(bytes / 1048576) + " MB)", actor: opts.actor || "agent" });
  return { outPath: out, bytes };
}

export function librarySummary(root) {
  const abs = resolve(root);
  const dirs = [];
  let files = 0;
  for (const name of readdirSync(abs)) {
    if (name === ".DS_Store" || name.indexOf("._") === 0) continue;
    const st = statSync(join(abs, name));
    if (st.isDirectory()) dirs.push({ name, isDir: true });
    else { dirs.push({ name, isDir: false, bytes: st.size }); files += 1; }
  }
  return { root: abs, dirs, files };
}

export function manualText(root, opts) {
  opts = opts || {};
  const lang = opts.lang || "both";
  const home = opts.home || readHome(root);
  const dirs = librarySummary(root).dirs.filter((d) => d.isDir).map((d) => "- `" + d.name + "/`").join("\n");
  const vars = {
    ROOT: home.root,
    VOLUME: home.volume == null ? "(未知)" : home.volume,
    FREE: home.freeGB == null ? "未知" : home.freeGB + " GB",
    HOST: home.host,
    DIRS: dirs,
    NOESIS: opts.noesisPath || "<noesis>",
  };
  const fill = (tpl) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] == null ? m : String(vars[k])));
  let out = "";
  if (lang === "zh" || lang === "both") out += fill(MANUAL_ZH);
  if (lang === "en" || lang === "both") out += (out ? "" : "") + fill(MANUAL_EN);
  return out;
}
