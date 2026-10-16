<div align="center">

# Noesis · 诺伊斯

**零依赖、本地优先的知识框架。**
紧凑二进制索引 · BM25 · 中英混合检索 · 增量构建 · 双链图谱。

![dependencies](https://img.shields.io/badge/依赖-0-brightgreen)
![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![license](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)

[English](README.md) · [架构](docs/ARCHITECTURE.md) · [索引格式](docs/SPEC.md) · [检索语法](docs/QUERY.md) · [基准](docs/BENCHMARKS.md)

</div>

## 为什么再造一个知识库

大多数工具逼你在「笨重的桌面应用」「云端服务」「一堆没法检索的 Markdown」之间二选一。Noesis 是把第三种选项真正做对：

- **零依赖**：纯 Node ESM（`>=18`），无安装步骤、无 lockfile、无供应链风险，克隆即用。
- **存得起的索引**：整个索引就是一个 gzip 压缩的二进制——前缀压缩词表 + varint 倒排。实测约为语料体积的 **6%**（见 [基准](docs/BENCHMARKS.md)）。
- **贴着文本的检索**：BM25 排序 + 免词典中文分词（单字 + 二元组）+ 拉丁词，同一索引内中英混检。
- **默认可增量**：内容哈希 + 体积 + mtime 清单，未改动的笔记直接复用，不重解析。
- **是图谱不是文件夹**：`[[双链]]` 按路径 / 文件名 / 标题解析，给出反链、孤立笔记与断链。
- **刻意朴素**：纯文本 Markdown + YAML frontmatter，git 友好、可 diff、可长期保存；索引是派生数据，删了随时重建。

## 快速开始

```bash
git clone https://github.com/William-Trader/noesis.git
cd noesis

node bin/noesis.mjs init   my-vault     # 初始化知识库
node bin/noesis.mjs build  my-vault     # 构建 / 更新索引
node bin/noesis.mjs search my-vault 记账 bm25 tag:finance
node bin/noesis.mjs serve  my-vault     # http://127.0.0.1:4317
```

用自带的示例库体验：

```bash
node bin/noesis.mjs build  examples/demo-vault
node bin/noesis.mjs search examples/demo-vault 分词
```

## 命令

| 命令 | 说明 |
|---|---|
| `init [dir]` | 生成 `kb.config.json` 与起始笔记 |
| `build [dir] [--full]` | 构建或增量更新索引 |
| `search <dir> <query>` | BM25 检索（`tag:` `path:` `-排除`，"短语"） |
| `stats [dir]` | 索引统计（`--json`） |
| `graph [dir]` | 反链 / 孤立 / 枢纽 / 断链 |
| `doctor [dir]` | 体检：断链、缺标题、重复标题 |
| `serve [dir] [--port N]` | 本地检索服务 + 极简 UI |

## 笔记就是 Markdown

```markdown
---
title: BM25
tags: [search, 算法]
date: 2026-10-11
---

# BM25

经典排序函数，相关笔记：[[中文分词]]、[[本地优先]]。
```

- **Frontmatter**：`title` / `tags` / `date`（内置迷你 YAML 子集，无依赖）。
- **链接**：`[[双链]]` 与相对 Markdown 链接都会进入图谱。
- **标题**：优先 frontmatter，其次首个 H1，最后文件名。

## 索引结构

```
.noesis/index.bin        gzip( [header][meta][docTable][词表+倒排] )
.noesis/manifest.json    每文件 hash + 体积 + mtime（增量用）
```

词项用前缀压缩（front-coding）存储，倒排用 varint 间隔编码，词典规模随「共享前缀」而不是原文膨胀。完整格式见 [docs/SPEC.md](docs/SPEC.md)。

## 基准

可用 `node bench/benchmark.mjs [N]` 复现。Apple Silicon / Node 24 实测：

| 语料 | 文档 | 索引 | 占比 | 构建 | 检索 |
|---|---|---|---|---|---|
| 7.78 MB | 2,000 | 474 KB | 5.95% | 0.41 s | 0.42 ms/次 |
| 38.90 MB | 10,000 | 2.29 MB | 5.75% | 4.70 s | 7.5 ms/次 |

细节与说明见 [docs/BENCHMARKS.md](docs/BENCHMARKS.md)。

## 整理资产库（给 agent 的约定）

Noesis 不只做检索，也把「怎么整理一个资产库」固化成可执行约定。把本仓库喂给 agent，再指向你的库，它照章办事 —— 完整规范见 [docs/LIBRARY.md](docs/LIBRARY.md)。

```bash
node bin/noesis.mjs library init  my-library   # 按规范建档：编号目录 + _整理规范.md + INDEX.md
node bin/noesis.mjs library check my-library   # 体检：库根散装、缺目录、凭据外泄
node bin/noesis.mjs library dups  my-library   # 内容级查重（先按体积分组，组内才算哈希）
node bin/noesis.mjs library index my-library   # 重生成 INDEX.md
node bin/noesis.mjs build         my-library   # 重建检索索引
```

agent 必须遵守的五条：

1. **编号顶层结构** —— `00-收件箱-INBOX` … `99-凭据-credentials`，库根不散装。
2. **只移不删** —— 每次移动追加到 `_重组映射表-<日期>.csv`（`src,dst,type`），整轮整理可回滚。
3. **按内容去重** —— 先按体积分组、组内算哈希，**只认哈希不认文件名**；淘汰方进废纸篓，不用 `rm`。
4. **凭据隔离** —— 密钥证书只放 `99-凭据-credentials/`，chmod 600。
5. **每次整理后重生成 `INDEX.md`** —— 它是 agent 唯一采信的索引。

`library check --json` 直接给出机器可读的体检结果，agent 无需解析自然语言即可动手。

## 开发

```bash
node --test           # 单元测试（node:test，零依赖）
node bench/benchmark.mjs 5000
```

## 许可

**PolyForm 非商业许可 1.0.0** —— source-available，**不是** OSI 开源；仅限非商业用途。见 [LICENSE](LICENSE)。

---

*Noesis 只含框架，不含任何个人数据与凭据；知识库请自带。*
