// Noesis · 资产库系统框架（零依赖）
//
// 把「资产库」从个人习惯固化成可执行约定，目的是：把仓库喂给 agent 时，
// agent 只读 README + docs/LIBRARY.md 就能按同一套规则整理，不靠猜。
//
//   01 编号顶层结构（00-收件箱 → 99-凭据），库根不散装
//   02 只移不删 + 映射表（每次移动可回滚）
//   03 内容级去重：先按体积分组，同组才算哈希；判重只认哈希
//   04 凭据隔离 99- / 成套压缩包不拆 / 元数据文件不搬
//   05 INDEX.md 是唯一索引，每次整理后重生成
//
// 三个能力：scaffoldLibrary 建档 · checkLibrary 体检 · findDuplicates 查重
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { join, relative, basename, resolve } from "node:path";
import { createHash } from "node:crypto";

export const LIBRARY_DIRS = [
  ["00-收件箱-INBOX", "新资产唯一入口：任何新东西先丢这，再由 agent 归类"],
  ["01-技能-skills", "技能资产（自研技能源码、技能工坊提案）"],
  ["02-记忆-memory", "记忆资产（全局记忆、每日日志）"],
  ["03-知识库-knowledge", "知识库（会话归档、策略、交易参考、检索库）"],
  ["04-项目-projects", "各项目源码/工程（每个项目独立 git）"],
  ["05-归档-archive", "退役/归档项目、历史备份"],
  ["06-交接-handovers", "交接包与说明文档"],
  ["07-原始包-originals", "压缩包原件（已解包的也留底）"],
  ["99-凭据-credentials", "密钥/证书/调用信息 —— 敏感，勿外传（chmod 600）"],
];

export const LIBRARY_ROOT_FILES = ["INDEX.md", "README.md", "_整理规范.md", "deploy.sh", "说明书.md", "MANUAL.md"];
export const MAPPING_PREFIX = "_重组映射表";

export function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

// 库级记录文件：映射表（_重组映射表-*.csv）与其他 `_*.csv` 台账，都允许留在库根。
export function isMappingFile(name) {
  return name.startsWith("_") && name.endsWith(".csv");
}

// 库级台账：_库位置.json（库在哪个盘）/ _库志.jsonl（做过什么）—— 都算库自己的记录。
export function isRecordFile(name) {
  return name.startsWith("_") && /\.(csv|json|jsonl)$/i.test(name);
}

// 库级入口脚本：_资产库检索.command 这类双击即用的启动器。
export function isLauncherFile(name) {
  return name.startsWith("_") && /\.(command|sh)$/i.test(name);
}

// 凭据判定只认「文件名/扩展名 + 位置」，不认路径里的关键词 ——
// 否则 src/tokenize.mjs、data/tokens.json 这类代码文件会被误报。
// 规则：
//   · 密钥材料（.pem/.key/.p12/.pfx、id_rsa 等）在任何位置都算凭据（vendor/venv 内除外）；
//   · `.env*` 只在**库根**算凭据 —— 项目自带的 .env 属于该项目，不该搬进 99-。
const SECRET_EXT = /\.(pem|key|p12|pfx)$/i;
const SECRET_NAME = /^(id_(rsa|dsa|ecdsa|ed25519)|credentials?\.(json|ya?ml)|secrets?\.(json|ya?ml|txt)|[^/]+\.secret)$/i;
const ENV_NAME = /^\.env(\.[\w.-]+)?$/i;
export const VENDOR_DIRS = new Set(["node_modules", "venv", ".venv", "site-packages", "dist", "build", ".git", "vendor", "__pycache__", ".noesis", "homebrew", ".cellar"]);

export function looksLikeSecret(file, opts = {}) {
  const b = basename(file);
  if (SECRET_EXT.test(b) || SECRET_NAME.test(b)) return true;
  if (ENV_NAME.test(b)) return opts.rootLevel === true;
  return false;
}

// 库根允许出现：编号目录 / 库级文件 / 映射表 / 调用方显式保留项（如活的 openclaw/）
export function allowedRootEntry(name, keep = []) {
  if (keep.includes(name)) return true;
  if (LIBRARY_DIRS.some((d) => d[0] === name)) return true;
  if (LIBRARY_ROOT_FILES.includes(name)) return true;
  if (isRecordFile(name) || isLauncherFile(name)) return true;
  return false;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".noesis", ".DS_Store"]);

export function walkAll(root, opts = {}) {
  const skip = new Set([...SKIP_DIRS, ...(opts.skipDirs || [])]);
  const out = [];
  const stack = [resolve(root)];
  while (stack.length) {
    const dir = stack.pop();
    let items = [];
    try { items = readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const it of items) {
      if (skip.has(it.name) || it.name.startsWith("._")) continue;
      const p = join(dir, it.name);
      if (it.isDirectory()) stack.push(p);
      else if (it.isFile()) out.push(p);
    }
  }
  return out.sort();
}

function sha256(file, maxBytes) {
  const st = statSync(file);
  if (maxBytes && st.size > maxBytes) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// 内容级去重：只对「同体积且 >1 份」的组算哈希（全量哈希太慢），判重只认哈希。
export function findDuplicates(root, opts = {}) {
  const maxHashBytes = opts.maxHashBytes || 512 * 1024 * 1024;
  const maxFiles = opts.maxFiles || 50000;
  const files = walkAll(root, opts).slice(0, maxFiles);
  const bySize = new Map();
  for (const f of files) {
    let st; try { st = statSync(f); } catch (e) { continue; }
    if (!st.size) continue;
    if (!bySize.has(st.size)) bySize.set(st.size, []);
    bySize.get(st.size).push(f);
  }
  const groups = [];
  let skipped = 0;
  for (const [, group] of bySize) {
    if (group.length < 2) continue;
    const byHash = new Map();
    for (const f of group) {
      const h = sha256(f, maxHashBytes);
      if (!h) { skipped += 1; continue; }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(f);
    }
    for (const [hash, paths] of byHash) {
      if (paths.length < 2) continue;
      const bytes = statSync(paths[0]).size;
      groups.push({ hash, bytes, count: paths.length, paths: paths.map((p) => relative(root, p)) });
    }
  }
  groups.sort((a, b) => b.bytes * (b.count - 1) - a.bytes * (a.count - 1));
  const wasted = groups.reduce((a, g) => a + g.bytes * (g.count - 1), 0);
  return { root: resolve(root), scanned: files.length, skippedHash: skipped, groups, wastedBytes: wasted };
}

export function scaffoldLibrary(root, opts = {}) {
  const abs = resolve(root);
  const created = [];
  const existed = [];
  mkdirSync(abs, { recursive: true });
  const put = (rel, content) => {
    const p = join(abs, rel);
    if (existsSync(p)) { existed.push(rel); return; }
    mkdirSync(join(abs, rel.split("/").slice(0, -1).join("/") || "."), { recursive: true });
    writeFileSync(p, content);
    created.push(rel);
  };
  const mkdir = (rel) => {
    const p = join(abs, rel);
    if (existsSync(p)) { existed.push(rel + "/"); return; }
    mkdirSync(p, { recursive: true });
    created.push(rel + "/");
  };
  for (const [name] of LIBRARY_DIRS) mkdir(name);
  if (!opts.dirsOnly) {
    put("_整理规范.md", specTemplate());
    put(join("00-收件箱-INBOX", "README-怎么用.md"), inboxTemplate());
    put("INDEX.md", indexTemplate());
    put(MAPPING_PREFIX + "-" + today() + ".csv", "src,dst,type\n");
    put("99-凭据-credentials/README.md", credentialsTemplate());
  }
  return { root: abs, created, existed };
}

export function checkLibrary(root, opts = {}) {
  const abs = resolve(root);
  const keep = opts.keep || [];
  if (!existsSync(abs)) return { root: abs, fatal: "目录不存在" };
  // 点开头的条目（.noesis 索引目录 / .DS_Store / .git 等）不算「库根散装」——它们是工具自身的产物。
  const entries = readdirSync(abs).filter((n) => !n.startsWith("."));
  const missingDirs = LIBRARY_DIRS.map((d) => d[0]).filter((n) => !existsSync(join(abs, n)));
  const stray = entries.filter((n) => !allowedRootEntry(n, keep));
  const mappingFiles = entries.filter(isMappingFile);
  const strayArchives = entries.filter((n) => /\.(tar\.gz|tgz|zip|rar|7z)$/i.test(n));
  const credentialsOutside = [];
  // 显式保留项（--keep，如活的 openclaw/ 状态目录）不参与凭据扫描：
  // 那是运行时自己的凭据，不属于库的整理范围。
  for (const f of walkAll(abs, { skipDirs: ["99-凭据-credentials", ...VENDOR_DIRS, ...keep] })) {
    const rel = relative(abs, f);
    const segs = rel.split("/");
    if (segs.some((s) => VENDOR_DIRS.has(s) || keep.includes(s))) continue;
    if (looksLikeSecret(f, { rootLevel: segs.length === 1 })) credentialsOutside.push(rel);
  }
  const notes = [];
  if (!existsSync(join(abs, "INDEX.md"))) notes.push("缺少 INDEX.md：整理后必须重生成索引");
  if (!mappingFiles.length) notes.push("库根没有 " + MAPPING_PREFIX + "-*.csv：移动前必须先落映射表");
  if (stray.length) notes.push("库根有 " + stray.length + " 个散装条目：按规范应归入编号目录");
  if (strayArchives.length) notes.push("库根有压缩包：原件应进 07-原始包-originals/");
  if (credentialsOutside.length) notes.push("凭据类文件出现在 99-凭据-credentials/ 之外");
  let dups = null;
  if (opts.checkDups) dups = findDuplicates(abs, opts);
  return {
    root: abs,
    dirs: LIBRARY_DIRS.length,
    missingDirs,
    stray: stray.map((n) => ({ name: n, isDir: existsSync(join(abs, n)) ? statSync(join(abs, n)).isDirectory() : false })),
    strayArchives,
    credentialsOutside,
    mappingFiles,
    notes,
    duplicates: dups ? { groups: dups.groups.length, wastedBytes: dups.wastedBytes } : null,
    ok: !missingDirs.length && !stray.length && !strayArchives.length && !credentialsOutside.length && notes.length === 0,
  };
}

export function renderIndex(root) {
  const abs = resolve(root);
  const lines = ["# 资产库 · INDEX", "", "> 生成 " + new Date().toISOString().slice(0, 16).replace("T", " ") + " · 根 " + abs, "", "## 顶层", "", "| 条目 | 类型 |", "|---|---|"];
  for (const n of readdirSync(abs).sort()) {
    if (n === ".DS_Store" || n.startsWith("._")) continue;
    const st = statSync(join(abs, n));
    lines.push("| " + n + " | " + (st.isDirectory() ? "目录" : "文件") + " |");
  }
  lines.push("");
  for (const [name] of LIBRARY_DIRS) {
    const p = join(abs, name);
    if (!existsSync(p)) continue;
    lines.push("## " + name, "");
    const items = readdirSync(p).filter((n) => n !== ".DS_Store" && !n.startsWith("._")).sort();
    if (!items.length) lines.push("- (空)");
    for (const it of items) {
      const st = statSync(join(p, it));
      lines.push("- " + it + (st.isDirectory() ? "/" : ""));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function specTemplate() {
  return [
    "# 资产库 · 整理规范",
    "",
    "> 由 Noesis 建档生成（noesis library init）。改这份文件即改约定，agent 以此为准。",
    "",
    "## 顶层结构（编号即顺序，库根不散装）",
    "",
    "| 目录 | 放什么 |",
    "|---|---|",
    ...LIBRARY_DIRS.map((d) => "| " + d[0] + "/ | " + d[1] + " |"),
    "| 库级文件 | INDEX.md / README.md / 说明书.md / _整理规范.md / deploy.sh / _重组映射表-*.csv / _库位置.json / _库志.jsonl / _*.command |",
    "",
    "## 规矩",
    "",
    "1. 只移不删：一切整理用「移动」，先落映射表 `_重组映射表-<日期>.csv`（src,dst,type），可回滚；删除需单独确认。",
    "2. 先入收件箱：新资产一律先进 `00-收件箱-INBOX/`，再归类，不直接散在库根。",
    "3. 不留双份：目标就位并核对后才清理原位，避免一个项目两处副本分叉。",
    "4. 不拆成套压缩包；原件放 `07-原始包-originals/`。",
    "5. 凭据单独隔离在 `99-凭据-credentials/`（chmod 600），不散落在根或项目里。",
    "6. 清理 macOS 元数据（`.DS_Store`、`._*`）。",
    "7. 每次整理后更新 `INDEX.md`。",
    "",
    "## 去重",
    "",
    "先按文件体积分组，只对同体积且 >1 份的组算哈希；**判重只认哈希**（后缀 `(1)`、`_时间戳` 多为不同版本）。删除走废纸篓，可回滚。",
    "",
    "## Agent 整理流程",
    "",
    "1. 盘点：`noesis library check <库> [--json]` —— 拿到散装条目、缺目录、凭据外泄、重复占用。",
    "2. 查重：`noesis library dups <库>` —— 只对同体积组算哈希，输出重复组与浪费空间。",
    "3. 落映射表：动手前先建 `_重组映射表-<日期>.csv`。",
    "4. 归位：移动（不复制）到编号目录；冲突目录先问清是合并还是改名，别覆盖。",
    "5. 校验：`noesis library check <库>` 复查库根归零；`noesis build <库>` 重建检索索引。",
    "6. 收尾：`noesis library index <库>` 重生成 INDEX.md；汇报释放体积与废纸篓位置。",
    "",
    "## 完成检查",
    "",
    "- 库根只剩编号目录 + 库级文件 + 映射表 + 显式保留项。",
    "- 重复组为 0（或已确认保留的版本冲突）。",
    "- 凭据只出现在 `99-凭据-credentials/`。",
    "- INDEX.md 与现状一致；映射表可反向还原。",
    ""
  ].join("\n");
}

function inboxTemplate() {
  return [
    "# 收件箱 · 怎么用",
    "",
    "新东西一律先进这里，再由 agent 按 `_整理规范.md` 归类到编号目录。",
    "",
    "- 别直接在库根新建散装文件/目录。",
    "- 归类后本目录应回到「只剩这份说明」的状态。",
    ""
  ].join("\n");
}

function credentialsTemplate() {
  return [
    "# 凭据目录",
    "",
    "密钥 / 证书 / 调用信息只放这里，chmod 600。",
    "",
    "- 不要提交进任何公开仓库。",
    "- 不要在对话、日志、代码里回显内容。",
    ""
  ].join("\n");
}

function indexTemplate() {
  return [
    "# 资产库 · INDEX",
    "",
    "> 由 `noesis library index <库>` 生成，勿手改。",
    ""
  ].join("\n");
}

export { sha256 };
