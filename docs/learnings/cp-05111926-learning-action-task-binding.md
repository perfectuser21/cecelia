# Learning — Learning 入库强制绑定 action_task_id

## Cortex Insight loophole 关闭：hasCodeFixSignal gate 不该做静默 early-return（2026-05-11）

### 根本原因

`cortex.js maybeCreateInsightTask()` 长期以 `if (!hasCodeFixSignal(content)) return;` 把不含 "bug/fix/修复/重构" 等关键词的 cortex_insight 直接放过。这条 gate 对"看上去像 bug 报告"的 insight 工作良好，但对**抽象类系统性 insight**（"Viability Gate 缺失"、"闭环断裂"、"派发率衰减"）天然失效——这些 insight 描述的是结构问题，本身不出现修复动词。后果可量化：8 天里 5 条 `relevance_score=9` 的 cortex_insight 零转化为代码 → 106 次本可预防的失败。

第二层根因：learnings 表没有 `action_task_id` 列。即便 `maybeCreateInsightTask` 成功创建了 dev task，learning → task 的反向链路只埋在 `tasks.payload->>'insight_learning_id'` 里，巡检 SQL 没法用 `WHERE action_task_id IS NULL` 一眼找出"未绑定 action 的孤儿 learning"。

第三层根因：`POST /api/brain/learnings-received` 接收 `task_id` 字段但只把它塞进 fix-task 的 payload，并未持久化到 learning 行本身——又一处"接收却丢弃"的破绽。

### 下次预防

- [ ] **关键词类 gate 不做静默 return，最多做 priority 加权**：含信号 → P1，不含 → P2。结构性约束（"每条 cortex_insight 必须有 action_task"）放到调用方 + DB 列上，不放在文本匹配上。
- [ ] **闭环数据必须有正反两条索引**：旧版只有 `tasks.payload->>'insight_learning_id'`（反向），现在补 `learnings.action_task_id`（正向）+ `idx_learnings_action_task_id WHERE action_task_id IS NOT NULL` 部分索引，巡检和数据修复都能直接跑。
- [ ] **API 路由接收到的 task_id / 标识字段必须立即持久化**：写一次代码前 grep `req.body.task_id` 的所有出现位置，确认每一处都进入 INSERT/UPDATE 而不是 console.log 或 payload 嵌套。
- [ ] **Schema version 改动必须同步 4 处**：migration 文件、`selfcheck.js EXPECTED_SCHEMA_VERSION`、`DEFINITION.md`、所有硬编码 `'270'` 的现有测试（这次漏了 selfcheck.test.js + learnings-vectorize.test.js，被 brain-unit shard 4 抓到才发现）。
- [ ] **feat: 改 brain/src 必须配套 smoke.sh**：lint-feature-has-smoke 在 PR 上才拦截，本地 local-precheck 不查；写 PRD 时就把 smoke 路径填到 DoD ARTIFACT 里。
- [ ] **worktree 长跑会被外部 quickcheck/janitor 清掉**：本次单 PR 内被清 3 次。如果可能，最终化阶段（rebase/push/learning）用 `/tmp/<short-name>` 一次性 worktree 而不是 `.claude/worktrees/`，可显著降低踩中清理脚本的概率。
