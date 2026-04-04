# Learning: content-pipeline 重启误杀根因与修复

**PR**: fix(brain): 修复 content-pipeline 重启误杀 + 僵尸子任务堆积

---

### 根本原因

**问题 1：Brain 重启后 content-pipeline 任务被误判为 orphan**

`orchestrateContentPipelines()` 将 `content-pipeline` 父任务标记为 `in_progress`，但不生成任何进程（`run_id = null`，`pid = null`）。任务纯粹在 Brain 内存中通过 `executeQueuedContentTasks()` 内联执行。

Brain 重启时，`syncOrphanTasksOnStartup()` 查询所有 `in_progress` 任务，发现这些任务既无 `run_id` 也无存活进程，将其判定为孤儿 orphan。由于 `watchdog_retry_count >= QUARANTINE_AFTER_KILLS(2)`，直接标记 `failed` 而不再重试。

结果：每次 Brain 重启都杀掉所有活跃 content-pipeline。今天（2026-04-04）Brain 重启 2 次，9/10 流水线全部失败，内容生成 KR 进度 = 1%。

**问题 2：父任务失败后子任务滞留 queued 状态（僵尸子任务）**

parent pipeline 被标记 `failed` 后，已创建的 `content-copywriting` / `content-copy-review` 等子任务仍留在 `queued`。`executeQueuedContentTasks()` 未检查父任务状态，继续执行这些「僵尸子任务」，执行后 `advanceContentPipeline()` 无法推进（父已 failed），资源浪费，且可能触发 `_contentExecutorBusy` 长时间占用。

---

### 修复方案

**Fix 1（executor.js）**：在 `syncOrphanTasksOnStartup` 中，对 `run_id = null` 的任务特判：直接 requeue 并重置 `watchdog_retry_count = 0`，跳过 orphan kill 逻辑。核心判断：无 run_id = 从未生成进程 = 内联编排任务，Brain 重启不等于进程死亡。

**Fix 2（content-pipeline-orchestrator.js）**：在 `executeQueuedContentTasks` 的每个 stage 循环中，批量查询子任务的父 pipeline 状态，对父任务不在 `queued/in_progress` 的子任务标记 `cancelled` 并跳过。

---

### 下次预防

- [ ] 凡标记 `in_progress` 但不生成进程的编排任务，应在 DB 中设置 `execution_mode = 'orchestration'`，使 orphan 检测可区分类型
- [ ] `syncOrphanTasksOnStartup` 应有单元测试覆盖 `run_id = null` 的分支（已在本 PR 补充）
- [ ] 内联 executor（`executeQueuedContentTasks`）应在循环开始时批量过滤僵尸子任务（已在本 PR 修复）
- [ ] Brain 重启后记录日志 `[startup-sync] Inline task requeued`，便于追踪
