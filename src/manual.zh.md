# 资产库使用说明书

> 由 `noesis library manual` 自动生成；库结构变了重新生成一次即可。

## 这是什么

一个**可以直接拷贝带走**的资产库：笔记是纯文本 Markdown，索引是派生数据（删了能重建），
目录按编号分好。任何 agent 拿到整份目录就能立即接管，不依赖这台机器的任何残留。

## 库在哪里

- 路径：`{{ROOT}}`
- 卷：`{{VOLUME}}`（可用 {{FREE}}）
- 主机：{{HOST}}

## 怎么打开

```bash
双击库根的 `_资产库检索.command`              # 建索引 + 起本地界面 + 开浏览器
node {{NOESIS}}/bin/noesis.mjs ui "{{ROOT}}"   # 等价命令
```

界面可**中英切换**；快捷键：`/` 聚焦 · `↑↓` 选择 · `Enter` 预览 · `Esc` 清空。

## 目录一目了然

{{DIRS}}

## 备份 / 带走

```bash
# 整库拷到外接盘（rsync 断点可续，源文件不动）
rsync -a --delete "{{ROOT}}/" "/Volumes/<你的盘>/openclaw资产库/"

# 打包交接：自动排除索引 / node_modules / venv 等可再生重物
node {{NOESIS}}/bin/noesis.mjs library pack "{{ROOT}}"
```

把包给下一个 agent，解压后跑一次 `library home` + `ui` 就能用。

## 恢复文件

每次整理都会落一份 `_重组映射表-<日期>.csv`（`src,dst,type`）。反悔了就反向执行：

```bash
node {{NOESIS}}/bin/noesis.mjs library undo "{{ROOT}}" <映射表.csv> --dry   # 先看计划
node {{NOESIS}}/bin/noesis.mjs library undo "{{ROOT}}" <映射表.csv>          # 真还原
```

## 痕迹可查

关键动作追加写入 `_库志.jsonl`（一行一条：时间 / 主机 / 动作 / 细节），只增不改：

```bash
node {{NOESIS}}/bin/noesis.mjs library log "{{ROOT}}" --tail 20
```

## 换盘 / 换机器

1. 整份库拷到新盘（或新机）；
2. 在新位置跑一次 `library home "{{ROOT}}"` 记录位置；
3. 跑 `ui`，索引自动重建（索引不进包，省空间省时间）。

## 给下一个 agent

- **第一次接触先问用户**：这份库要放在哪个盘（`library volumes` 列候选），不要自行搬动。
- 确认后用 `library home <库> --set <盘>` 记录，再 `library manual` 生成这份说明书交给用户。
- 整理时遵守 `_整理规范.md`：只移不删、先落映射表、按内容去重、凭据隔离、更新 INDEX.md。
- 省着用：优先用 `ui` 的即时检索与 `library check` 体检，不要全库重扫。
