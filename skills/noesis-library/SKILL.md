---
name: "noesis-library"
description: "把 Noesis 知识库当成可运营的资产：首触体检、一键整理（计划→确认→执行→可撤销）、打包带走、从移动副本回写更新、检索与新鲜度检查。触发：用户说「帮我一键整理」「库太乱了」「把库带走/拷到移动硬盘」「把移动硬盘上的改动拷回来」「找一下…」或给出一个知识库目录让你接手。"
---

# Noesis 知识库管家

## 何时用

用户把一个知识库目录交给你，或说出「整理 / 带走 / 拷回 / 找东西 / 这个库健康吗」这类话。
先读同目录的 `docs/HANDOVER.md`——那是完整契约；本文件是可执行的最短路径。

## 硬规则（先记住这五条）

1. **只移不删。** 删除必须用户单独、明确要求。
2. **先计划，后执行。** 整理的第一步永远是只读计划；没有用户确认，不加 `--yes`。
3. **不覆盖。** 目标存在就跳过并汇报。
4. **不绕过引擎。** 用 `noesis tidy` / `apply_moves`，不要自己 `mv`。
5. **索引是派生的。** 整理后 `--build` 重建，不要把 `.noesis/` 当资产打包。

## 首触（只读，30 秒）

```bash
noesis onboard <库>
noesis library check <库> --json
noesis stats <库> --json
```

把 `stray` / `missingDirs` / `credentialsOutside` / `drift` 翻译成人话，再决定下一步。

## 一键整理

```bash
noesis tidy <库>                 # 计划：移动什么、去哪、为什么
noesis tidy <库> --yes --build   # 用户确认后：执行 + 重建索引
```

执行后必须汇报：移动数 / 跳过数（含冲突原因）/ `op_id` / 撤销命令 / 索引文档数。

## 携带与回写

```bash
noesis library pack <库> --out <盘>/<库名>.tar.gz
noesis sync <库> --from <盘上的副本> --dry   # 先看差异
noesis sync <库> --from <盘上的副本>         # 再回写（旧文件自动备份）
```

`sync` 只回写副本里更新/新增的文件，相同内容跳过，覆盖前备份，从不删除。

## 检索

```bash
noesis search <库> "关键词" --limit 5 --json
noesis related <库> <某篇笔记> --json
```

结果里的 `section` 是命中的段落，优先引用它，而不是整篇文件。

## 验收

- `library check` 的 `ok` 为 true，或冲突已逐条解释；
- `stats` 的 `drift` 为 0；
- 汇报里带 `op_id`；
- 没有任何文件被删除。

## 常见失败

| 报错 | 含义 | 处理 |
|---|---|---|
| `src missing` | 计划过期（文件已被移动） | 重新跑一次计划，不要手改路径 |
| `dst already exists` | 保护机制 | 跳过并汇报，让用户决定改名或合并 |
| `outside library root` | 路径越界 | 拒绝执行，汇报越界路径 |
| 盘只读 | `EROFS` | 停止，汇报挂载状态 |