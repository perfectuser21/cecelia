---
repo: cecelia
review_date: 2026-03-20
scope: daily-24h
risk_score: 5
mode: deep
decision: NEEDS_FIX
---

## 审查摘要

- 变更文件数：110+ / 发现问题：L1: 0, L2: 2, L3: 2 / 安全: 1 / AI免疫: 1 / 测试缺口: 1
- 主要变更模块：`packages/brain/src/executor.js`（路由三连修复）、`slot-allocator.js`（Codex 并发上限）、`content-pipeline-executors.js`（新功能）、3 个 migrations

---

## L1 问题（必须修）

无。

---

## L2 问题（建议修）

### [L2-001] Codex 任务被计入本机 Claude 槽位消耗，导致本地派发容量虚减

- **文件**：`packages/brain/src/slot-allocator.js:174-186`
- **问题**：`countAutoDispatchInProgress()` 统计的是所有 `in_progress` 且非 Cecelia 内部任务，包含了 `codex_qa`/`codex_dev`/`codex_playwright` 等运行在西安远程机器的 Codex 任务。这些任务不消耗本机 CPU/内存资源，但被加入 `totalRunning` 计入本机 `effectiveSlots` 的可用量计算中，导致本机 Claude Code 任务实际可用槽位被压缩。
- **风险**：有 Codex 任务运行时，本机可用槽位错误偏低，Brain 不必要地抑制本机 Claude 任务派发。
- **建议修复**：`countAutoDispatchInProgress()` 应排除 Codex 任务：
  ```sql
  AND task_type NOT IN ('codex_qa', 'codex_dev', 'codex_playwright')
  ```
  或在 `calculateSlotBudget()` 中单独计算本地任务数。

### [L2-002] getCodexMaxConcurrent 在单机在线但 effectiveSlots=0 时触发全阻断，无法降级

- **文件**：`packages/brain/src/slot-allocator.js:38-46`
- **问题**：`getCodexMaxConcurrent()` 中降级分支条件是 `!m4?.online && !m1?.online`，即两台机器都不在线才触发 `CODEX_FALLBACK_CONCURRENT=3`。当仅一台机器在线但 effectiveSlots=0（资源已满），且另一台 null（cache 未刷新）时：`remoteSlots = 0`，`!m4?.online = false`，降级分支不触发，返回 `Math.min(0, 5) = 0`，完全阻断 Codex 任务派发。
- **风险**：Fleet cache 数据偶发缺失时，Codex 派发被意外完全阻断，任务积压。
- **建议修复**：条件改为 `(m4 === null || m4 === undefined) && (m1 === null || m1 === undefined)`，区分"cache 缺失"与"机器在线但满载"两种情况。

---

## 安全问题

### [SEC-001] content-pipeline-executors.js 存在 Shell 命令注入风险

- **文件**：`packages/brain/src/content-pipeline-executors.js:72-74`
- **严重性**：HIGH
- **问题**：`notebookId`（来自 `task.payload?.notebook_id`）和 `keyword`（来自 `task.payload?.pipeline_keyword || task.title`）直接拼接到 shell 命令字符串中：
  ```js
  run(`notebooklm use ${notebookId} 2>&1`);
  run(`notebooklm ask "...${keyword}..." --json 2>&1`, 120000);
  ```
  如果 Brain 任务的 payload 包含 shell 元字符（例如 `"; rm -rf /tmp; echo "`），将触发命令注入。
- **风险**：虽然任务由 Brain 内部派发，但如果攻击者或 AI 幻觉生成了包含元字符的 payload，将在 Brain 进程权限下执行任意命令。
- **建议修复**：对 `notebookId` 和 `keyword` 做白名单验证（仅允许字母/数字/中文/中划线），或改用 `spawn()` 传递参数数组替代 `execSync()`（最安全）。

---

## AI 免疫发现

### [AI-001] 路由逻辑一天内三次修复，测试覆盖对"并行 PR 覆盖"场景不足

- **相关 PRs**：#1192 → #1195（回退）→ #1198（再修复）
- **发现**：executor 路由核心逻辑（`DEV_ONLY_TYPES` + `triggerCodexBridge` 分支）在同一天被修改了 3 次，且 #1195 被 #1198 完全否定。这是 AI 生成代码的典型"fix-a-fix"模式——没有端对端测试覆盖路由决策。
- **建议**：为 `triggerCeceliaRun()` 添加集成测试，断言不同 `task_type` 的路由目标（Claude Code vs Codex Bridge vs MiniMax）。

---

## 测试缺口

| 文件 | 缺口类型 | 标记 |
|------|---------|------|
| `content-pipeline-executors.js` | 完整新功能，无对应测试 | T1 |
| `executor.js:triggerCeceliaRun 路由分支` | 路由决策无集成测试 | T2 |

---

## L3 记录（不阻塞）

- `migrations/163_add_content_publish_jobs.sql`：`task_id` 列未加外键约束（与 migration 162 中 `task_id UUID REFERENCES tasks(id) ON DELETE SET NULL` 不一致），任务删除后可能产生孤儿引用。
- `executor.js:isProcessAlive`（行 676）：该函数仅使用 `process.kill(pid, 0)`，未做 Linux/macOS 平台分支，而 watchdog.js 中同名函数有平台分支。当前 Mac mini 环境无影响，但跨平台部署时可能失效。
