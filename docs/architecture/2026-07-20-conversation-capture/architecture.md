# Architecture: 对话原始捕获（conversation raw capture）

- Initiative: `5402c2e5-975a-41ac-9a5c-e07184aa2d7c`
- Decision 锚点: `f64adaaf-5313-4d1c-95a4-e4822de4b7f6`
- 日期: 2026-07-20

## 概述

Alex 每天用 Claude Code 对话时会提到十几二十个话题/想法，但当次任务往往只做完其中几个，其余的没有留下痕迹。目标：把这些"说过但没落地"的话，从本机 `~/.claude/projects/*/*.jsonl` 原始会话文件里机械筛出来，写进现有的 `captures` 收件箱表，让 Alex 事后能在 Dashboard 收件箱里回看。

**核心约束：不进 LLM。** JSONL 里每条记录自带 `message.role` 字段（`user`/`assistant`），assistant 消息里的代码编辑是 `tool_use` block、工具执行结果注入回来的是 `tool_result` block（这类 `tool_result` 消息在 JSONL 里 role 也标 `user`，必须排除），真人打字的内容是纯 `text` block。用一个纯 JSON 字段过滤函数就能把这三类分开，零 token 成本。

## 前情提要：为什么不是重建"轨道C"

Brain 里曾有功能几乎同名的 `conversation-digest.js`（2026-07-19 decision `a823206d` 拍板退役，migration 353 删表）。生产实锤：4 个月 `conversation_captures` 表 0 行写入，`conversation_log_cursors` 攒了 118,294 行死指针（59,325 pending + 58,969 error）。

根因排查（本次新查明，此前设计文档未写清楚）：`conversation-digest.js` 的 `INSERT INTO conversation_captures (source_file, project_slug, capture_type, raw_content, status)` 用的字段，跟 migration 194 实际建表字段（`session_id/session_date/area/summary/key_decisions/key_insights/action_items/author/made_by`）**从上线第一天起就完全对不上**，每次写入都触发 Postgres "column does not exist"，被 `catch(e){console.warn}` 悄悄吞掉，没人告警。轨道C 还额外做了一层"调 Cortex LLM 提炼 decisions/ideas"，比本次范围重。

结论：原设计的**意图**和本次基本一致，死因是纯工程 bug（字段错位 + 静默吞异常）+ 范围过重（LLM 提炼环节引入了额外失败面）。本次方案用完全不同、更轻的实现规避同类坑：

1. **不新建表，不用原来的字段拼法** —— 直接对接已经在生产验证过的 `captures`/`capture_atoms` 体系（`packages/brain/src/capture-inbox.js` 的 `pushCapture()`），字段映射只有一处，且已被 P1 collectors 复用验证过。
2. **不进 LLM** —— 消除了轨道C最重的一个失败面（Cortex 调用失败/超时/JSON 解析失败）。
3. **失败不静默** —— 每次运行结果（成功数/失败数）写 `working_memory` sentinel，可被 `capture-aging`/健康检查/人工 curl 观测到，不会再出现"死了4个月没人发现"的情况。
4. **有集成测试实锤"真的写进去了"** —— 这是原设计从未做过的一步，本次 Task 2 直接对真实 captures 表断言新增行存在、字段正确、二次运行不重复。

## 触发时机：即时 vs 每日，为什么合并成一个高频轮询 job

Alex 要求"会话结束即时 + 每日兜底"两层都要。工程实现上没有拆成两个 job，而是**一个 job，10 分钟自 gate**，理由：

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 真 Stop Hook | 改 `~/.claude/settings.json` hook 配置 + `packages/engine` 新脚本，会话一结束立刻调 Brain API | 跨 `packages/engine`/`packages/brain` 两个包边界（CLAUDE.md 边界规则：Hooks 归 engine，不是 Brain 器官）；改全局 hook 配置风险面更大，且对已在跑的所有历史 session 类型（headless/relay/交互）都要兼容 |
| B. 高频轮询（**选用**） | `scheduler-jobs.js` 新增一个 job，复用现成的 60s 轮询骨架 + 自带 10 分钟间隔 gate；每次跑：扫 `.jsonl` 文件 mtime，只处理"上次扫描之后有更新"的文件 | 10 分钟延迟不算"即时"但足够满足"别等到第二天才看到"的诉求；纯 brain 包内闭环，不碰 engine/不改全局 hook 配置；同一个 job 天然兼具"每日兜底"语义——只要 Brain 一直在跑，永远不会漏超过一个 gate 周期 |

选 B。这不是偷工减料，是把"即时"和"兜底"用同一套幂等扫描逻辑实现——如果哪次轮询因为 Brain 重启错过了，下一次轮询会用 sentinel 里记的 `last_scan_at` 往前补，不会丢数据，效果上等价于"总有一层兜底"。

## 数据模型变更

**不新建表。** 只改两处：

1. `packages/brain/src/routes/captures.js:11`
   ```js
   const VALID_SOURCES = ['harness', 'dashboard', 'feishu', 'api', 'conversation'];
   ```
2. `working_memory` 表新增一个 key（复用已有表，不建新表）：`conversation_capture_last_scan` → `{ last_scan_at, pushed, errors }`，跟 `scheduler-jobs.js` 现有的 `writeSentinel()` 是同一种模式。

`captures` 表本身字段不变，写入时：
- `content` = 抽出来的 user 原始文本（截 2000 字符，`pushCapture` 已处理）
- `source` = `'conversation'`
- `repo` = 会话所在的 project slug（`~/.claude/projects/<slug>/`，通常对应 repo 目录名）
- `nature` = 留空（不定性，跟自由输入一致，走 triage 的默认路径）
- `dedupe_key` = `sha1(fileBaseName + ':' + entry.uuid)`（JSONL 每条记录自带 `uuid` 字段，缺失时退化为 `fileBaseName + ':' + lineIndex`）——这是防重的关键：同一条 user 消息不管被扫到几次，只会有一行 `captures` 记录。

## 模块变更

| 模块 | 变更类型 | 说明 |
|------|---------|------|
| `packages/brain/src/conversation-capture.js` | 新建 | 核心抽取器：`extractUserTurns(filePath, sinceMs)` 纯函数（无副作用，逐行 JSON.parse + 字段过滤）+ `runConversationCapture(pool)`（扫目录、调用抽取、push、写 sentinel） |
| `packages/brain/src/routes/captures.js` | 修改 | `VALID_SOURCES` 加 `'conversation'` |
| `packages/brain/src/scheduler-jobs.js` | 修改 | `JOBS` 数组新增一条 `conversation-capture` job（`needsPool: true`, 复用现成骨架） |

## 关键决策

| 决策 | 选项A | 选项B | 选择 | 理由 |
|---|---|---|---|---|
| LLM 是否参与提取 | 用 LLM 提炼摘要 | 纯机械字段过滤 | B | Alex 明确要求零 LLM 成本；同时消除轨道C最大的失败面 |
| 即时触发方式 | 真 Stop Hook | 高频轮询自 gate | B | 避免跨 engine/brain 包边界；轮询 + sentinel 兜底效果等价 |
| 是否复用被删的 `conversation_captures`/`conversation_log_cursors` | 复用/重建 | 完全不碰，改用现有 `captures` + `working_memory` | 不复用 | 字段错位是原设计死因，绕开整条旧链路 |
| 摘要/去重/聚类层 | 加一层日汇总 LLM 摘要 | 不加，先看原始文本 | 不加 | Alex 明确选择"先落地原始捕获"，摘要层是下一期 |
| 检索/追溯能力（"最近某项目问到哪"） | 本次一起做 | 不做 | 不做 | Alex 明确排除，范围收敛 |

## 测试策略

- **单元测试**（Task 1）：`extractUserTurns` 用固定 JSONL fixture（含纯文本 user 消息、tool_result 伪装的 user 消息、assistant 消息、格式损坏的行）断言只留下真人文本；`VALID_SOURCES` 契约测试断言 `'conversation'` 被接受、非法值仍被拒绝。
- **集成测试**（Task 2，集成测试 owner）：连真实（scratch）DB 跑一次 `runConversationCapture(pool)`，断言：① `captures` 表确实新增了行、`source='conversation'`、`content` 内容正确；② 同一份 fixture 再跑一次，行数不增（dedupe 生效）；③ mtime 早于 `last_scan_at` 的文件不会被重新处理；④ 人为制造一次写入失败（如塞入超长/畸形内容触发异常），断言不抛出、`errors` 计数非零、sentinel 里能看到——直接对着"轨道C 静默吞异常 4 个月没人发现"这个历史失败模式验证。
