# 资产库系统框架 · Library conventions

Noesis 不只是检索：它把「怎么整理一个资产库」也固化成了可执行约定。
把本仓库喂给 agent，再指向你的库，agent 就按这份文件办事 —— 不靠猜、不靠记性。

> 本文件是唯一权威约定。`noesis library init` 会把它写到你的库根 `_整理规范.md`，改那份即改约定。

## 1. 顶层结构（编号即顺序，库根不散装）

| 目录 | 放什么 |
|---|---|
| `00-收件箱-INBOX/` | **新资产唯一入口**：任何新东西先丢这，再由 agent 归类 |
| `01-技能-skills/` | 技能资产（自研技能源码、技能工坊提案）|
| `02-记忆-memory/` | 记忆资产（全局记忆、每日日志）|
| `03-知识库-knowledge/` | 知识库（会话归档、策略、参考、检索库）|
| `04-项目-projects/` | 各项目源码/工程（每个项目独立 git）|
| `05-归档-archive/` | 退役/归档项目、历史备份 |
| `06-交接-handovers/` | 交接包与说明文档 |
| `07-原始包-originals/` | 压缩包原件（已解包的也留底）|
| `99-凭据-credentials/` | 密钥/证书/调用信息 —— 敏感，勿外传（chmod 600）|

库根只允许出现以上编号目录 + 库级文件（`INDEX.md` / `README.md` / `_整理规范.md` / `deploy.sh`）
+ 映射表（`_重组映射表-*.csv`）+ 调用方显式保留项（`--keep`，例如活的 `openclaw/` 状态目录）。

## 2. 七条规矩

1. **只移不删**：一切整理用「移动」，动手前先落 `_重组映射表-<日期>.csv`，可回滚；删除需单独确认。
2. **先入收件箱**：新资产一律先进 `00-收件箱-INBOX/`，再归类，不直接散在库根。
3. **不留双份**：目标就位并核对后才清理原位，避免一个项目两处副本分叉。
4. **不拆成套压缩包**；原件放 `07-原始包-originals/`。
5. **凭据隔离**在 `99-凭据-credentials/`，不散落在根或项目里。
6. **清理 macOS 元数据**（`.DS_Store`、`._*`）。
7. **每次整理后更新 `INDEX.md`**。

## 3. 去重（内容级，不是文件名级）

先按**文件体积**分组，只对「同体积且 >1 份」的组算哈希。**判重只认哈希**：
`(1)` 后缀、`_时间戳`、`WM_` 前缀多数是不同版本，按文件名判重会误杀。

保留优先级：库根散文件 > 库根精品目录 > 深层嵌套；同分时路径更短优先。
淘汰方走废纸篓（可回滚），不用 `rm`。

```bash
noesis library dups my-library            # 列出重复组 + 可回收体积
noesis library dups my-library --json     # 机器可读，agent 直接消费
```

## 4. 映射表格式

`_重组映射表-<日期>.csv`，三列，每次移动追加一行，出错按 `src,dst` 反向 `mv` 全量还原：

```csv
src,dst,type
/path/before,name,/path/after/name,project
```

`type` 取值：`project` / `archive` / `originals` / `handover` / `personal-note` / `artifact` / `dedup-trash`。

## 5. INDEX.md

库的唯一索引，**机器生成**（`noesis library index`），不要手改：
顶层条目表 → 每个编号目录的条目清单（子目录带 `/`）。每次整理后重生成。

## 6. Agent 整理流程（照做即可）

```bash
noesis library check my-library --json     # 1 盘点：散装条目 / 缺目录 / 凭据外泄 / 重复
noesis library dups  my-library --json     # 2 查重：同体积组算哈希，输出重复组与浪费空间
# 3 落映射表：_重组映射表-<日期>.csv（动手前）
# 4 归位：移动（不复制）到编号目录；同名冲突先问清合并还是改名，别覆盖
noesis library check my-library            # 5 校验：库根归零
noesis library index my-library            # 6 收尾：重生成 INDEX.md
noesis build         my-library            #    重建检索索引
```

汇报时给出：释放体积、废纸篓位置、仍待决的版本冲突。

## 7. 完成检查

- 库根只剩编号目录 + 库级文件 + 映射表 + 显式保留项（`library check` 无散装项）。
- 重复组为 0，或已确认保留的版本冲突。
- 凭据只出现在 `99-凭据-credentials/`。
- `INDEX.md` 与现状一致；映射表能反向还原。

---

## English summary

Noesis also encodes *how to organise a library*. Point an agent at this repo plus your vault:

1. **Numbered top level** (`00-INBOX` … `99-credentials`); nothing loose at the root.
2. **Move, never delete** — append every move to `_重组映射表-<date>.csv` so any pass is reversible.
3. **Deduplicate by content** — group by size, hash within groups, trust the hash, never the filename; discard to the trash.
4. **Isolate secrets** under `99-凭据-credentials/` (`chmod 600`).
5. **Regenerate `INDEX.md`** after every pass; it is the only index the agent trusts.

Commands: `library init` · `library check` · `library dups` · `library index`.
