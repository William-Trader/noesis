# 便携资产库 · Portable library

目标很朴素：**库要能被整个带走，痕迹要留得住，界面对人友好，机器负担要小。**

## 一、第一次接触（给 agent 的固定流程）

1. **先问用户**，不要自己决定，也不要自己搬：
   ```bash
   noesis library volumes <库>      # 列出候选盘位与可用空间
   ```
   问法建议：「这份资产库要放在哪个盘？（列出候选）」
   没挂外接盘就如实说，让用户插入移动硬盘后重跑。
2. **记录结论**（不移动文件）：
   ```bash
   noesis library home <库> --set "/Volumes/我的盘"
   ```
   会写 `_库位置.json` 并留痕；真正搬迁命令会打印出来，加 `--move` 才执行 rsync（**源目录永不自动删除**）。
3. **生成说明书交给用户**：
   ```bash
   noesis library manual <库>       # -> 说明书.md（中英双语）
   ```

## 二、带走（备份 / 换机 / 换 agent）

| 方式 | 命令 | 说明 |
|---|---|---|
| 整库拷贝 | `rsync -a "<库>/" "/Volumes/<盘>/<目录>/"` | 断点可续，源文件不动 |
| 便携打包 | `noesis library pack <库>` | 自动排除 `.noesis` 索引 / `node_modules` / `venv` 等可再生重物 |
| 接管 | 解压后 `library home` → `ui` | 索引自动重建，不依赖原机器 |

排除的就是「重且能再生」的东西：索引几秒就能重建，`node_modules` 换机器必重装。

## 三、恢复

每次整理都会落 `_重组映射表-<日期>.csv`（`src,dst,type`），可以**反向执行**：

```bash
noesis library undo <库> <映射表.csv> --dry   # 先看计划
noesis library undo <库> <映射表.csv>          # 真还原
```

规则：只处理「目标在、原位置不在」的行；原位置已有文件就跳过，**绝不覆盖**。

## 四、痕迹（可查询）

`_库志.jsonl` 只增不改，一行一条：时间 / 主机 / 动作 / 细节。

```bash
noesis library log <库> --tail 20
noesis library log <库> --add "note:把 X 归到 04-项目"
```

登记位置、生成说明书、打包、还原都会自动写一条。

## 五、界面与多语言

```bash
node bin/noesis.mjs ui <库>      # 或双击库根 _资产库检索.command
```

即时检索（不用回车）、`↑↓` 选择、`Enter` 预览、目录/标签筛选、`?q=` 可分享链接、暗/亮主题；
右上角一键**中英切换**（记住选择）。零依赖、无外部资源，界面是单个 HTML 字符串。

## 六、省资源原则

- 索引是**派生数据**：不进包、随删随建；增量构建只重解析改动过的文件。
- 服务端**常驻内存**：索引、searcher、笔记正文（按 mtime 缓存）都不反复读盘。
- `watch` 可按需关闭：`ui <库> --no-watch`。
- 一切零依赖：没有 `npm install`，没有构建步骤，没有后台常驻之外的东西。

---

## English summary

**First contact** — run `library volumes`, **ask the user which drive the library should live on**, record it with `library home --set <drive>`, then hand the user the generated `说明书.md` (`library manual`).

**Take it away** — `rsync` the folder, or `library pack` for a handover bundle that skips rebuildable weight (`.noesis` index, `node_modules`, `venv`). Unpack, run `library home`, then `ui`; the index rebuilds itself.

**Recover** — `library undo "<library>" <mapping.csv>` reverses a reorganisation pass from its mapping table (`--dry` first). Never overwrites an existing file.

**Traceability** — append-only `_库志.jsonl`; read it with `library log`.

**UI** — instant search, keyboard-first, facets, `?q=` links, dark/light, one-click ZH/EN switch. Zero dependencies, no external assets.
