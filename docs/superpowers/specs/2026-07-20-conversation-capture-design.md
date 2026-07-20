# Design: 对话原始捕获（conversation raw capture）

- 状态: 已批准（三轮口头确认 + PrepPRD 确认，见 sprints/07201602-conversation-capture/prep-prd.md）
- Decision 锚点: f64adaaf-5313-4d1c-95a4-e4822de4b7f6 / 0c9e1652-f35b-4322-8687-8161f8be87f6
- Initiative: 5402c2e5-975a-41ac-9a5c-e07184aa2d7c

## 目的

Alex 每天用 Claude Code 对话时提到十几二十个话题/想法，任务当次往往只做完其中几个，其余的没有留下痕迹被忘掉。目标：把这些"说过但没落地"的话，从 `~/.claude/projects/*/*.jsonl` 原始会话文件里机械（不进 LLM）抽取出来，写进现有 `captures` 收件箱表，让 Alex 事后能在 Dashboard 收件箱回看。

## 约束

- 零 LLM 成本：纯 JSON 字段过滤，不调用任何 LLM。
- 不新建数据库表：复用已在生产验证过的 `captures`/`capture_atoms` 体系。
- 不复用被删除的 `conversation_captures`/`conversation_log_cursors` 表和相关逻辑（decision a823206d 已明确退役，根因是字段错位纯 bug，详见 architecture.md「前情提要」）。
- 不碰 `packages/engine`、不改 `~/.claude` 全局 hook 配置（避免跨包边界；用高频轮询替代真 Stop Hook，见 architecture.md「触发时机」决策表）。
- 不做摘要/去重/聚类层（先看原始文本），不做检索/追溯能力（下一期）。

## 成功标准

1. 会话里 Alex 打字说的真实内容（排除工具调用/代码 diff/工具执行结果）能在 10 分钟内出现在 `captures` 表（`source=conversation`）。
2. 同一段对话不会被重复写入两次。
3. 出错不会导致整轮扫描中断，也不会被静默吞掉——失败次数可观测。

## 方案（已确定，非选型讨论）

完整方案见 `docs/architecture/2026-07-20-conversation-capture/architecture.md`，本文档不重复对比表格，只摘要落地结构：

- **新模块** `packages/brain/src/conversation-capture.js`：
  - `extractUserTurns(filePath, sinceMs)` — 纯函数，逐行解析 JSONL，保留 `role=user` 且 content 为纯 text block（排除 `tool_result`/`assistant`）的轮次，产出 `{text, dedupeKey, timestamp}`。
  - `runConversationCapture(pool)` — 读 `working_memory` 里的 `conversation_capture_last_scan` sentinel 拿上次扫描时间，只处理 mtime 更新过的 `.jsonl` 文件，逐条 `pushCapture(pool, {content, source:'conversation', repo, dedupeKey})`，失败计数不抛出，跑完回写 sentinel。
- `packages/brain/src/routes/captures.js`：`VALID_SOURCES` 加入 `'conversation'`。
- `packages/brain/src/scheduler-jobs.js`：`JOBS` 数组新增一条 `conversation-capture` job，10 分钟自 gate，复用现成的 60s 轮询 + 错误隔离骨架。

## 数据流

```
~/.claude/projects/<slug>/*.jsonl (mtime 变化)
        │  每 60s 轮询，10min 自 gate
        ▼
runConversationCapture(pool)
        │  extractUserTurns() 过滤 role=user 纯文本
        ▼
pushCapture(pool, {source:'conversation', dedupeKey, ...})
        │  dedupe_key 幂等（ON CONFLICT DO UPDATE）
        ▼
captures 表（Dashboard 收件箱可见）
```

## 错误处理

- 单条消息写入失败（如超长内容触发约束错误）：`pushCapture` 内部已 catch，不抛出，返回 `null`；调用方计数 `errors++`。
- 整个扫描周期失败（如目录不可读）：`scheduler-jobs.js` 的 `runSchedulerJobsOnce` 外层已有统一 try/catch + timeout 隔离，不影响其余 job。
- 观测：每轮结果（`pushed`/`errors`）写入 `working_memory` sentinel，可被 `curl localhost:5221/api/brain/...` 或未来健康检查读取——这是本次设计相对轨道C最大的差异点：轨道C失败信息只进 `console.warn`，4 个月没人看到。

## 测试策略

- **Unit**：`extractUserTurns` 用内联 fixture（字符串数组模拟 JSONL 行）覆盖四类输入——纯文本 user 消息 / tool_result 伪装的 user 消息 / assistant 消息 / 格式损坏的行——断言只保留第一类。`VALID_SOURCES` 契约测试断言 `conversation` 被接受、非法值仍 400。
- **Integration**（连接走 `db-config.js` SSOT，指向 scratch DB，禁自建 `pg.Pool`）：
  1. 造一个临时 `.jsonl` fixture 文件，跑一次 `runConversationCapture(pool)`，查 `captures` 表断言新增 `source=conversation` 行、`content` 内容正确。
  2. 同一 fixture 不改动 mtime 的情况下再跑一次，断言 `captures` 表行数不变（dedupe 生效）。
  3. 人为把 `working_memory` 里的 `last_scan_at` sentinel 设为晚于 fixture 文件 mtime，再跑一次，断言该文件被跳过（无新增行）。
  4. 构造一次必然失败的写入（如 mock `pushCapture` 抛异常，或塞入触发 DB 约束的极端内容），断言 `runConversationCapture` 本身不抛出、返回的 `errors` 计数非零、sentinel 里能查到。
- **Trivial**：无（本设计没有纯配置项变更）。
- **E2E**：不适用——这是 Brain 后台任务，没有用户可交互的前端界面变更；验收标准 3 条（见上）已由 integration 测试覆盖。

## 范围边界（明确不做，防止执行时蔓延）

- 不加 LLM 摘要/日汇总层。
- 不做"最近某项目问到哪、走了哪条线"检索能力。
- 不改 Dashboard 前端（现有收件箱页面已经能按 `source` 筛选展示，`conversation` 是新枚举值，无需改前端代码）。
- 不接入真 Stop Hook / 不改 `packages/engine`。
